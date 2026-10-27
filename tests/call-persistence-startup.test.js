const test = require('node:test');
const assert = require('node:assert/strict');
const { persistCall } = require('../server/callPersistence');

const identity = { businessId: 1, callerId: 2, externalProvider: 'vapi', externalId: 'synthetic-startup' };
const expired = () => Object.assign(Error('Transaction already closed'), {
  code: 'P2028', meta: { error: 'A query cannot be executed on an expired transaction.' },
});
const write = db => persistCall({ db, identity, createData: { ...identity, status: 'COMPLETED' }, updateData: row => row });

function database(fail) {
  const seen = { attempts: 0, reads: 0, writes: 0, configurations: 0 };
  const db = { $transaction: async (fn, options) => {
    const attempt = ++seen.attempts;
    assert.deepEqual(options, { maxWait: 500, timeout: 3000 });
    const result = await fn({
      $queryRaw: async query => {
        if ((query.strings || query).join('').includes('FOR UPDATE')) { seen.reads++; fail('read', attempt); }
        else { seen.configurations++; fail('configure', attempt); }
        return [];
      },
      call: {
        create: async ({ data }) => { seen.writes++; fail('write', attempt); return { id: 3, ...data }; },
      },
    });
    fail('commit', attempt);
    return result;
  } };
  return { db, seen };
}

test('an expired transaction before any Call work retries once in a fresh transaction', async () => {
  const { db, seen } = database((stage, attempt) => { if (stage === 'configure' && attempt === 1) throw expired(); });
  const saved = await write(db);
  assert.equal(saved.id, 3);
  assert.deepEqual(seen, { attempts: 2, reads: 1, writes: 1, configurations: 2 });
});

test('persistent startup expiry stops after two transactions without reading or writing calls', async () => {
  const { db, seen } = database(stage => { if (stage === 'configure') throw expired(); });
  await assert.rejects(write(db), { code: 'P2028' });
  assert.deepEqual(seen, { attempts: 2, reads: 0, writes: 0, configurations: 2 });
});

test('other startup failures and transaction acquisition errors are not retried', async () => {
  for (const error of [Object.assign(Error('offline'), { code: 'P1001' }), Object.assign(Error('Unknown transaction'), { code: 'P2028' })]) {
    const { db, seen } = database(stage => { if (stage === 'configure') throw error; });
    await assert.rejects(write(db), e => e === error);
    assert.equal(seen.attempts, 1);
  }
  let attempts = 0;
  await assert.rejects(write({ $transaction: async () => { attempts++; throw expired(); } }), { code: 'P2028' });
  assert.equal(attempts, 1, 'the callback must have begun before a startup retry is safe');
});

test('expired transactions after configuration, reads, writes or commit are not retried', async () => {
  for (const failedStage of ['read', 'write', 'commit']) {
    const { db, seen } = database(stage => { if (stage === failedStage) throw expired(); });
    await assert.rejects(write(db), { code: 'P2028' });
    assert.equal(seen.attempts, 1, failedStage);
  }
});

test('startup expiry and uniqueness recovery share one retry budget', async () => {
  const unique = Object.assign(Error('Synthetic collision'), { code: 'P2002', meta: { modelName: 'Call', target: ['externalProvider', 'externalId'] } });
  const { db, seen } = database((stage, attempt) => {
    if (stage === 'configure' && attempt === 1) throw expired();
    if (stage === 'write') throw unique;
  });
  await assert.rejects(write(db), e => e === unique);
  assert.equal(seen.attempts, 2);
  assert.equal(seen.writes, 1);
});
