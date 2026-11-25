'use strict';
const assert = require('node:assert/strict'), crypto = require('node:crypto');
const { test } = require('node:test');
const { ensureTelegramActionWebhook: ensure, telegramWebhookFailureDiagnostics: diagnostics } = require('../server/telegramBotApi');
const { createTelegramWebhookState, webhookIdentity } = require('../server/telegramWebhookState');
const enabled = process.env.RUN_TELEGRAM_WEBHOOK_POSTGRES === '1';

function clients() {
  const url = new URL(process.env.DATABASE_URL);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Only a loopback disposable database is allowed');
  assert.ok(process.env.GITHUB_ACTIONS === 'true' && url.pathname === '/ci' || /^\/myaipa_telegram_webhook_[a-z0-9_]+$/.test(url.pathname),
    'Only the disposable CI database or an execution-owned test database is allowed');
  const { PrismaClient } = require('@prisma/client');
  const make = () => new PrismaClient({ datasources: { db: { url: url.href } }, __internal: { configOverride: c => ({ ...c, relativeEnvPaths: {} }) } });
  return [make(), make()];
}
async function isolated(work) {
  const [db, other] = clients();
  const token = '9' + BigInt('0x' + crypto.randomBytes(12).toString('hex')).toString() + ':synthetic_fixture';
  const config = { webhookUrl: 'https://example.invalid/synthetic-callback', webhookSecret: crypto.randomBytes(32).toString('hex') };
  const { key } = webhookIdentity({ token, ...config }); let owns = false;
  const provider = { calls: [], fail: false };
  const options = (prisma, credential = token) => ({ token: credential,
    stateStore: createTelegramWebhookState({ prisma, token: credential, ...config }),
    fetchImpl: async url => {
      const method = url.split('/').pop(); assert.ok(['getWebhookInfo', 'setWebhook'].includes(method)); provider.calls.push(method);
      if (method === 'setWebhook' && provider.fail) throw new DOMException('Synthetic lost reply', 'TimeoutError');
      return { ok: true, status: 200, json: async () => ({ ok: true, result: method === 'setWebhook' ? true
        : { url: config.webhookUrl, allowed_updates: ['callback_query'] } }) };
    } });
  try {
    assert.equal(await db.runtimeStore.findUnique({ where: { key } }), null, 'Never overwrite a prior row'); owns = true;
    await work({ db, other, key, config, provider, options, token });
  } finally {
    try { if (owns) { await db.runtimeStore.deleteMany({ where: { key } }); assert.equal(await db.runtimeStore.count({ where: { key } }), 0); } }
    finally { await Promise.all([db.$disconnect(), other.$disconnect()]); }
  }
}

test('real PostgreSQL: two startups dispatch once, restarted exact configuration reads only', { skip: !enabled, timeout: 30000 }, () => isolated(async ({ db, other, key, config, provider, options }) => {
  const results = await Promise.allSettled([ensure(config, options(db)), ensure(config, options(other))]);
  assert.ok(results.some(result => result.status === 'fulfilled'));
  assert.equal(provider.calls.filter(method => method === 'setWebhook').length, 1);
  const before = await db.runtimeStore.findUnique({ where: { key } }); assert.equal(before.data.status, 'verified');
  provider.calls = []; assert.equal((await ensure(config, options(other))).reused, true);
  assert.deepEqual(provider.calls, ['getWebhookInfo']); assert.deepEqual(await db.runtimeStore.findUnique({ where: { key } }), before);
}));

test('real PostgreSQL: lost provider reply persists uncertainty across instances and credential rotation', { skip: !enabled, timeout: 30000 }, () => isolated(async ({ db, other, key, config, provider, options, token }) => {
  provider.fail = true;
  await assert.rejects(ensure(config, options(db)), { code: 'TELEGRAM_WEBHOOK_REQUEST_TIMEOUT' });
  const before = await db.runtimeStore.findUnique({ where: { key } }); assert.equal(before.data.status, 'uncertain');
  provider.calls = [];
  await assert.rejects(ensure(config, options(other, token.replace(':synthetic_fixture', ':rotated_fixture'))), { code: 'TELEGRAM_WEBHOOK_STATE_INSPECT_FIRST' });
  assert.deepEqual(provider.calls, ['getWebhookInfo']); assert.deepEqual(await db.runtimeStore.findUnique({ where: { key } }), before);
}));

test('real PostgreSQL: held advisory lock, rollback and lost commit acknowledgement cannot dispatch', { skip: !enabled, timeout: 30000 }, () => isolated(async ({ db, other, key, config, provider, options }) => {
  let release, acquired;
  const held = new Promise(resolve => { acquired = resolve; }), unlock = new Promise(resolve => { release = resolve; });
  const lock = other.$transaction(async tx => { await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))::text`; acquired(); await unlock; }, { timeout: 10000 });
  try { await Promise.race([held, lock]); await assert.rejects(ensure(config, options(db)), { code: 'TELEGRAM_WEBHOOK_STATE_BUSY' }); }
  finally { release(); await lock; }
  assert.equal(await db.runtimeStore.findUnique({ where: { key } }), null);
  const rollback = { runtimeStore: db.runtimeStore, $transaction: (work, settings) => db.$transaction(async tx => {
    await work(tx); throw Error('Synthetic rollback');
  }, settings) };
  await assert.rejects(ensure(config, options(rollback)), { code: 'TELEGRAM_WEBHOOK_STATE_UNAVAILABLE' });
  assert.equal(await db.runtimeStore.findUnique({ where: { key } }), null);
  const lostCommit = { runtimeStore: db.runtimeStore, $transaction: async (work, settings) => {
    await db.$transaction(work, settings); throw Error('Synthetic lost commit reply');
  } };
  await assert.rejects(ensure(config, options(lostCommit)), { code: 'TELEGRAM_WEBHOOK_STATE_UNAVAILABLE' });
  assert.equal((await db.runtimeStore.findUnique({ where: { key } })).data.status, 'uncertain');
  await assert.rejects(ensure(config, options(other)), { code: 'TELEGRAM_WEBHOOK_STATE_INSPECT_FIRST' });
  assert.equal(provider.calls.includes('setWebhook'), false);
}));

// Only this execution-owned fixture's transaction is decorated; the real
// reader, lock, upsert, commit and Prisma deadline are otherwise unchanged.
function slowWrites(db, seconds, selectedWrite) {
  let writes = 0;
  return { runtimeStore: db.runtimeStore, $transaction: (work, settings) => db.$transaction(tx => work({
    $queryRaw: (...args) => tx.$queryRaw(...args),
    runtimeStore: {
      findUnique: args => tx.runtimeStore.findUnique(args),
      upsert: async args => {
        if (++writes === selectedWrite) await tx.$queryRaw`SELECT true AS slept FROM pg_sleep(${seconds}::double precision)`;
        return tx.runtimeStore.upsert(args);
      },
    },
  }), settings) };
}

test('real PostgreSQL: old 2-second deadline expires; bounded 5-second verification admits slow database work',
  { skip: !enabled, timeout: 30000 }, () => isolated(async ({ db, key, config, provider, options }) => {
    await assert.rejects(db.$transaction(async tx => {
      await tx.$queryRaw`SELECT true AS slept FROM pg_sleep(2.25)`;
      await tx.runtimeStore.findUnique({ where: { key } });
    }, { maxWait: 1000, timeout: 2000 }), { code: 'P2028' });
    assert.equal(await db.runtimeStore.findUnique({ where: { key } }), null);
    assert.equal((await ensure(config, options(slowWrites(db, 3, 3)))).configured, true);
    assert.equal((await db.runtimeStore.findUnique({ where: { key } })).data.status, 'verified');
    assert.equal(provider.calls.filter(method => method === 'setWebhook').length, 1);
  }));

test('real PostgreSQL: work beyond 5 seconds rolls back verification, retains acknowledgement and never repeats setup',
  { skip: !enabled, timeout: 30000 }, () => isolated(async ({ db, other, key, config, provider, options }) => {
    await assert.rejects(ensure(config, options(slowWrites(db, 5.25, 3))), error => {
      const d = diagnostics(error);
      assert.equal(d.databaseCode, 'P2028'); assert.equal(d.databaseOperation, 'verify');
      assert.equal(d.databasePhase, 'write'); assert.equal(d.timeoutMs, 5000);
      assert.equal(d.automaticRetry, false); assert.ok(d.elapsedMs >= 5000 && d.elapsedMs < 10000);
      return true;
    });
    assert.equal((await db.runtimeStore.findUnique({ where: { key } })).data.status, 'acknowledged');
    assert.equal(provider.calls.filter(method => method === 'setWebhook').length, 1);
    provider.calls = [];
    assert.equal((await ensure(config, options(other))).reused, true);
    assert.deepEqual(provider.calls, ['getWebhookInfo']);
    assert.equal((await db.runtimeStore.findUnique({ where: { key } })).data.status, 'verified');
  }));

for (const operation of ['acknowledge', 'verify'])
test(`real PostgreSQL: lost ${operation} commit reply retains phase and prevents a second setup across restart`,
  { skip: !enabled, timeout: 30000 }, () => isolated(async ({ db, other, key, config, provider, options }) => {
    let transactions = 0;
    const selected = operation === 'acknowledge' ? 2 : 3;
    const lostReply = { runtimeStore: db.runtimeStore, $transaction: async (work, settings) => {
      const result = await db.$transaction(work, settings);
      if (++transactions === selected) throw Object.assign(Error('PRIVATE lost reply'), { code: 'P1001' });
      return result;
    } };
    await assert.rejects(ensure(config, options(lostReply)), error => {
      const d = diagnostics(error);
      assert.equal(d.databaseCode, 'P1001'); assert.equal(d.databaseOperation, operation);
      assert.equal(d.databasePhase, 'commit'); assert.equal(d.automaticRetry, false);
      assert.doesNotMatch(JSON.stringify([error, d]), /PRIVATE|postgresql/); return true;
    });
    assert.equal((await db.runtimeStore.findUnique({ where: { key } })).data.status,
      operation === 'acknowledge' ? 'acknowledged' : 'verified');
    assert.equal(provider.calls.filter(method => method === 'setWebhook').length, 1);
    provider.calls = [];
    assert.equal((await ensure(config, options(other))).reused, true);
    assert.deepEqual(provider.calls, ['getWebhookInfo']);
  }));

test('real PostgreSQL: exhausted single-connection pool has bounded admission and no dispatch',
  { skip: !enabled, timeout: 30000 }, () => isolated(async ({ db, key, config, options, provider }) => {
    // clients() already validated loopback and disposable database identity.
    const url = new URL(process.env.DATABASE_URL); url.searchParams.set('connection_limit', '1');
    const { PrismaClient } = require('@prisma/client');
    const single = new PrismaClient({ datasources: { db: { url: url.href } },
      __internal: { configOverride: c => ({ ...c, relativeEnvPaths: {} }) } });
    let release, acquired;
    const held = new Promise(resolve => { acquired = resolve; }), unlock = new Promise(resolve => { release = resolve; });
    const holder = single.$transaction(async tx => {
      await tx.$queryRaw`SELECT true AS connected`; acquired(); await unlock;
    }, { timeout: 10000 });
    try {
      await Promise.race([held, holder]);
      await assert.rejects(options(single).stateStore.claim(null), error => {
        const d = diagnostics(error);
        assert.ok(['P2024', 'P2028'].includes(d.databaseCode));
        assert.equal(d.databaseOperation, 'claim'); assert.equal(d.databasePhase, 'transaction_start');
        assert.equal(d.maxWaitMs, 2000); assert.equal(d.automaticRetry, false);
        assert.ok(d.elapsedMs >= 1800 && d.elapsedMs < 7000); return true;
      });
      assert.equal(await db.runtimeStore.findUnique({ where: { key } }), null);
      assert.deepEqual(provider.calls, []);
    } finally { release(); try { await holder; } finally { await single.$disconnect(); } }
  }));

test('real PostgreSQL: genuine SQL failure retains allowlisted Prisma code and rolls back without dispatch',
  { skip: !enabled, timeout: 30000 }, () => isolated(async ({ db, key, config, options, provider }) => {
    const failing = { runtimeStore: db.runtimeStore, $transaction: (work, settings) => db.$transaction(tx => work({
      $queryRaw: (...args) => tx.$queryRaw(...args),
      runtimeStore: {
        findUnique: args => tx.runtimeStore.findUnique(args),
        upsert: async () => { await tx.$queryRaw`SELECT 1 / 0 AS synthetic_failure`; },
      },
    }), settings) };
    await assert.rejects(ensure(config, options(failing)), error => {
      const d = diagnostics(error);
      assert.equal(d.databaseCode, 'P2010'); assert.equal(d.databaseOperation, 'claim');
      assert.equal(d.databasePhase, 'write'); assert.equal(d.automaticRetry, false);
      assert.doesNotMatch(JSON.stringify([error, d]), /SELECT|division|postgresql|synthetic_failure/); return true;
    });
    assert.equal(await db.runtimeStore.findUnique({ where: { key } }), null);
    assert.deepEqual(provider.calls, ['getWebhookInfo']);
  }));
