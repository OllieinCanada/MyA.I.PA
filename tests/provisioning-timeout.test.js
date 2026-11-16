const test = require('node:test');
const assert = require('node:assert/strict');
const { runProvisioningStep, provisioningStateKey } = require('../server/provisioningState');

// Deterministic transaction/rollback model, not PostgreSQL timing evidence.
// Only the dispatch transaction receives simulated database latency.
function fixture({ dispatchMs = 0, completionUncertain = false } = {}) {
  let rows = new Map(), tail = Promise.resolve(), transactions = 0;
  const calls = [];
  function store(map) {
    return {
      findUnique: async ({ where }) => map.has(where.key)
        ? { key: where.key, data: structuredClone(map.get(where.key)) } : null,
      upsert: async ({ where, update, create }) => {
        const data = structuredClone(map.has(where.key) ? update.data : create.data);
        map.set(where.key, data); return { key: where.key, data };
      },
    };
  }
  const prisma = {
    runtimeStore: { findUnique: args => store(rows).findUnique(args) },
    async $transaction(callback, options) {
      const previous = tail;
      let unlock;
      tail = new Promise(resolve => { unlock = resolve; });
      await previous;
      const working = new Map(structuredClone([...rows]));
      const ordinal = ++transactions;
      calls.push({ ordinal, options });
      try {
        const result = await callback({ runtimeStore: store(working), $queryRaw: async () => [] });
        if (ordinal === 2 && dispatchMs > (options?.timeout ?? 5000)) {
          throw Object.assign(Error('Synthetic expired transaction at commit'), { code: 'P2028' });
        }
        if (ordinal === 3 && completionUncertain) {
          throw Object.assign(Error('Synthetic lost completion acknowledgement'), { code: 'P2028' });
        }
        rows = working;
        return result;
      } finally { unlock(); }
    },
  };
  return { prisma, calls, read: key => structuredClone(rows.get(key)) };
}

function input(prisma, execute) {
  return { prisma, kind: 'twilio-number', idempotencyKey: 'synthetic-timeout',
    contextHash: 'synthetic-context', execute, verifyCompleted: async () => true };
}

test('5282ms dispatch transaction fits explicit 10-second bound and replay creates once', async () => {
  const f = fixture({ dispatchMs: 5282 }); let purchases = 0;
  const args = input(f.prisma, async () => { purchases++; return { twilioSid: 'synthetic-number' }; });
  await runProvisioningStep(args);
  assert.deepEqual(f.calls[1].options, { timeout: 10000 });
  assert.equal(f.calls[0].options, undefined, 'claim budget is unchanged');
  assert.equal(f.calls[2].options, undefined, 'completion budget is unchanged');
  assert.equal((await runProvisioningStep(args)).reused, true);
  assert.equal(purchases, 1);
});

test('over-budget dispatch rolls back marker and never invokes purchase', async () => {
  const f = fixture({ dispatchMs: 10001 }); let purchases = 0;
  const args = input(f.prisma, async () => { purchases++; return {}; });
  await assert.rejects(runProvisioningStep(args), { code: 'P2028' });
  const row = f.read(provisioningStateKey(args.kind, args.idempotencyKey));
  assert.equal(row.dispatchStartedAt, null);
  assert.equal(row.status, 'failed');
  assert.equal(purchases, 0);
  assert.equal(f.calls.length, 3, 'no automatic transaction retry');
});

test('simultaneous attempts retain one lease and one purchase with slow dispatch', async () => {
  const f = fixture({ dispatchMs: 5282 }); let purchases = 0, entered, release;
  const started = new Promise(resolve => { entered = resolve; });
  const wait = new Promise(resolve => { release = resolve; });
  const args = input(f.prisma, async () => { purchases++; entered(); await wait; return { twilioSid: 'synthetic-number' }; });
  const first = runProvisioningStep(args);
  await started;
  try {
    await assert.rejects(runProvisioningStep(args), { code: 'PROVISIONING_ALREADY_IN_PROGRESS' });
  } finally { release(); }
  await first;
  assert.equal((await runProvisioningStep(args)).reused, true);
  assert.equal(purchases, 1);
});

test('lost provider response keeps dispatch evidence and refuses another purchase', async () => {
  const f = fixture({ dispatchMs: 5282 }); let purchases = 0;
  const args = input(f.prisma, async () => {
    purchases++;
    throw Object.assign(Error('Synthetic provider timeout'), { code: 'ETIMEDOUT' });
  });
  await assert.rejects(runProvisioningStep(args), { code: 'ETIMEDOUT' });
  await assert.rejects(runProvisioningStep(args), { code: 'PROVISIONING_RECONCILIATION_REQUIRED' });
  assert.ok(f.read(provisioningStateKey(args.kind, args.idempotencyKey)).dispatchStartedAt);
  assert.equal(purchases, 1);
});

test('database failure after purchase preserves uncertainty and refuses re-creation', async () => {
  const f = fixture({ dispatchMs: 5282, completionUncertain: true }); let purchases = 0;
  const args = input(f.prisma, async () => { purchases++; return { twilioSid: 'synthetic-number' }; });
  await assert.rejects(runProvisioningStep(args), { code: 'P2028' });
  await assert.rejects(runProvisioningStep(args), { code: 'PROVISIONING_RECONCILIATION_REQUIRED' });
  assert.equal(purchases, 1);
});
