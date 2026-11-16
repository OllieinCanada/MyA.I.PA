const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { runProvisioningStep, provisioningStateKey } = require('../server/provisioningState');
const enabled = process.env.RUN_DATABASE_INTEGRATION === '1';

async function fixture(t, { dispatchDelay = 0, loseCompletion = false } = {}) {
  const url = new URL(process.env.DATABASE_URL);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname));
  assert.match(url.pathname, /^\/myaipa_recovery_drill_[a-z0-9_]+$/);
  const { PrismaClient } = require('@prisma/client');
  const db = new PrismaClient({ datasources: { db: { url: url.href } },
    __internal: { configOverride: config => ({ ...config, relativeEnvPaths: {} }) } });
  const idempotencyKey = `synthetic-timeout-${crypto.randomUUID()}`;
  const key = provisioningStateKey('twilio-number', idempotencyKey);
  t.after(async () => {
    try { await db.runtimeStore.deleteMany({ where: { key } }); }
    finally { await db.$disconnect(); }
  });
  let transactions = 0;
  const prisma = {
    runtimeStore: db.runtimeStore,
    $transaction: async (fn, options) => {
      const ordinal = ++transactions;
      if (ordinal === 2) assert.deepEqual(options, { timeout: 10000 });
      return db.$transaction(async tx => {
        const result = await fn(tx);
        // Real server delay after the dispatch marker write, before commit.
        if (ordinal === 2 && dispatchDelay) {
          await tx.$queryRaw`SELECT pg_sleep(${dispatchDelay})::text AS waited`;
        }
        if (ordinal === 3 && loseCompletion) {
          throw Object.assign(Error('Synthetic completion persistence failure'), { code: 'P2028' });
        }
        return result;
      }, options);
    },
  };
  return { db, key, args: { prisma, kind: 'twilio-number', idempotencyKey,
    contextHash: 'synthetic-only', verifyCompleted: async () => true } };
}

test('real SQL dispatch exceeding five seconds commits under ten; simultaneous replay purchases once',
  { skip: !enabled, timeout: 30000 }, async t => {
    const f = await fixture(t, { dispatchDelay: 5.3 });
    let purchases = 0, entered, release;
    const started = new Promise(resolve => { entered = resolve; });
    const wait = new Promise(resolve => { release = resolve; });
    const args = { ...f.args, execute: async () => {
      purchases++; entered(); await wait; return { twilioSid: 'synthetic-only' };
    } };
    const first = runProvisioningStep(args);
    // Observe rejection immediately too, so a failed transaction cannot strand the test.
    const outcome = first.then(value => ({ value }), error => ({ error }));
    const admission = await Promise.race([started.then(() => true), outcome.then(() => false)]);
    if (!admission) throw (await outcome).error || Error('Dispatch was never admitted');
    try {
      await assert.rejects(runProvisioningStep(args), { code: 'PROVISIONING_ALREADY_IN_PROGRESS' });
    } finally { release(); await outcome; }
    const result = await outcome;
    if (result.error) throw result.error;
    assert.equal((await runProvisioningStep(args)).reused, true);
    assert.equal(purchases, 1);
    assert.equal((await f.db.runtimeStore.findUnique({ where: { key: f.key } })).data.status, 'completed');
  });

test('real SQL dispatch beyond ten seconds rolls back and makes zero provider calls',
  { skip: !enabled, timeout: 30000 }, async t => {
    const f = await fixture(t, { dispatchDelay: 10.3 }); let purchases = 0;
    await assert.rejects(runProvisioningStep({ ...f.args, execute: async () => { purchases++; return {}; } }),
      { code: 'P2028' });
    const row = (await f.db.runtimeStore.findUnique({ where: { key: f.key } })).data;
    assert.equal(row.status, 'failed');
    assert.equal(row.dispatchStartedAt, null);
    assert.equal(purchases, 0);
  });

test('real SQL completion failure retains dispatch evidence and refuses duplicate purchase',
  { skip: !enabled, timeout: 15000 }, async t => {
    const f = await fixture(t, { loseCompletion: true }); let purchases = 0;
    const args = { ...f.args, execute: async () => { purchases++; return { twilioSid: 'synthetic-only' }; } };
    await assert.rejects(runProvisioningStep(args), { code: 'P2028' });
    await assert.rejects(runProvisioningStep(args), { code: 'PROVISIONING_RECONCILIATION_REQUIRED' });
    const row = (await f.db.runtimeStore.findUnique({ where: { key: f.key } })).data;
    assert.ok(row.dispatchStartedAt);
    assert.equal(purchases, 1);
  });
