'use strict';
const assert = require('node:assert/strict'), crypto = require('node:crypto');
const { test } = require('node:test');
const { ensureTelegramActionWebhook: ensure } = require('../server/telegramBotApi');
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
