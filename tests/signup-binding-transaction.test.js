'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createBindingTransaction, LOCK } = require('../server/signupBindingTransaction');
function fixture(answers = [true]) {
  let clock = 0, active = false, admissions = 0, callbacks = 0;
  const options = [], waits = [];
  const run = createBindingTransaction({ now: () => clock, random: () => 0, sleep: async ms => {
    assert.equal(active, false, 'Never sleep inside a transaction'); waits.push(ms); clock += ms;
  } });
  const prisma = { $transaction: async (fn, opts) => {
    admissions++; active = true; options.push(opts);
    try { return await fn({ $queryRaw: async (sql, key) => {
      assert.match(sql.join(''), /pg_try_advisory_xact_lock/); assert.equal(key, LOCK);
      const answer = answers.length > 1 ? answers.shift() : answers[0];
      if (answer instanceof Error) throw answer;
      return answer === undefined ? [] : [{ acquired: answer }];
    } }); } finally { active = false; }
  } };
  const work = async () => { callbacks++; return 'saved'; };
  return { run, prisma, work, waits, options, tick: ms => { clock += ms; },
    get admissions() { return admissions; }, get callbacks() { return callbacks; }, get clock() { return clock; } };
}
test('confirmed contention waits outside transactions, then admits the callback once', async () => {
  const f = fixture([false, false, true]);
  assert.equal(await f.run(f.prisma, f.work), 'saved');
  assert.equal(f.admissions, 3); assert.equal(f.callbacks, 1); assert.deepEqual(f.waits, [100, 200]);
  assert.deepEqual(f.options[0], { maxWait: 2000, timeout: 10000 });
});
test('persistent contention is bounded and performs zero mapping callbacks', async () => {
  const f = fixture([false]); await assert.rejects(f.run(f.prisma, f.work), { code: 'SIGNUP_BUSINESS_MAPPING_BUSY' });
  assert.equal(f.callbacks, 0); assert.equal(f.clock, 20000); assert.ok(f.admissions <= 200);
  for (const options of f.options) { assert.ok(options.timeout > 0 && options.timeout <= 10000); assert.ok(options.maxWait <= 2000); }
});
test('late lock admission still gives actual mapping work its full bounded transaction allowance', async () => {
  const f = fixture([false, true]);
  const run = createBindingTransaction({ now: () => f.clock, random: () => 0, sleep: async () => f.tick(19000) });
  assert.equal(await run(f.prisma, f.work), 'saved');
  assert.equal(f.options.at(-1).timeout, 10000); assert.equal(f.callbacks, 1);
});
test('even a broken clock cannot create an unbounded admission loop', async () => {
  let calls = 0;
  const run = createBindingTransaction({ now: () => 0, sleep: async () => {} });
  await assert.rejects(run({ $transaction: async fn => { calls++; return fn({ $queryRaw: async () => [{ acquired: false }] }); } }, () => assert.fail()), { code: 'SIGNUP_BUSINESS_MAPPING_BUSY' });
  assert.equal(calls, 200);
});
test('pool/lock/expired transaction failures are not retried or mistaken for confirmed contention', async () => {
  for (const code of ['P2028', 'P2024', 'ECONNRESET']) {
    const error = Object.assign(Error('synthetic transaction error'), { code }), f = fixture([error]);
    await assert.rejects(f.run(f.prisma, f.work), e => e === error && e.signupDiagnosticStage === 'business-mapping');
    assert.equal(f.admissions, 1); assert.equal(f.callbacks, 0); assert.equal(f.waits.length, 0);
  }
});
test('missing/malformed lock proof refuses before mutation', async () => {
  for (const answer of [undefined, 'true', 1, null]) {
    const f = fixture([answer]); await assert.rejects(f.run(f.prisma, f.work), { code: 'SIGNUP_BUSINESS_LOCK_UNVERIFIED' });
    assert.equal(f.callbacks, 0); assert.equal(f.admissions, 1);
  }
});
test('a frozen database failure is propagated unchanged, not masked by diagnostic decoration', async () => {
  const error = Object.freeze(Object.assign(Error('frozen synthetic failure'), { code: 'P2028' })), f = fixture([error]);
  await assert.rejects(f.run(f.prisma, f.work), e => e === error);
  assert.equal(f.admissions, 1); assert.equal(f.callbacks, 0);
});
test('callback errors, including uncertain outcomes, are never replayed', async () => {
  for (const code of ['P2028', 'SIGNUP_CLOSED', 'AGENT_MAPPING_OWNERSHIP_CONFLICT']) {
    const f = fixture(); let writes = 0;
    await assert.rejects(f.run(f.prisma, async () => { writes++; throw Object.assign(Error('synthetic callback'), { code }); }), { code });
    assert.equal(writes, 1); assert.equal(f.admissions, 1); assert.deepEqual(f.waits, []);
  }
});
test('commit acknowledgement lost after mutation does not authorize another transaction', async () => {
  const f = fixture(), transaction = f.prisma.$transaction; let commits = 0;
  f.prisma.$transaction = async (...args) => { await transaction(...args); commits++; throw Object.assign(Error('ack lost'), { code: 'ECONNRESET' }); };
  await assert.rejects(f.run(f.prisma, f.work), { code: 'ECONNRESET' });
  assert.equal(f.callbacks, 1); assert.equal(commits, 1); assert.equal(f.admissions, 1);
});
test('waiting for a transaction cannot admit work after the overall budget expired', async () => {
  const f = fixture(), transaction = f.prisma.$transaction;
  f.prisma.$transaction = async (...args) => { f.tick(20001); return transaction(...args); };
  await assert.rejects(f.run(f.prisma, f.work), { code: 'SIGNUP_BUSINESS_MAPPING_BUSY' }); assert.equal(f.callbacks, 0);
});
test('fresh work observes lifecycle changes made while it was waiting', async () => {
  const f = fixture([false, true]); let closed = false;
  const run = createBindingTransaction({ now: () => 0, sleep: async () => { closed = true; } });
  await assert.rejects(run(f.prisma, async () => { assert.equal(closed, true); throw Object.assign(Error('closed'), { code: 'SIGNUP_CLOSED' }); }), { code: 'SIGNUP_CLOSED' });
  assert.equal(f.admissions, 2);
});
