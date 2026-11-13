const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { dispatchPrepared } = require('../scripts/recovery-notification-state');
const { openNotificationStore } = require('../scripts/recovery-notification-store');
const model = require('../scripts/recovery-notification-model');
const preparationPolicy = require('./fixtures/recovery-policy.synthetic.json');
const { spawn, spawnSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const busy = 'RECOVERY_NOTIFICATION_LOCKED_REQUIRES_REVIEW_OR_LATER_SAMPLE';
const report = (sequence = 1) => ({ checkedAt: new Date(Date.UTC(2026, 10, 2) + sequence * 1000).toISOString(), severity: 'critical', issues: [{ code: 'BACKUP_FAILED', severity: 'critical' }] });
function fixture(t) {
  const parent = path.resolve(os.tmpdir()), directory = fs.mkdtempSync(path.join(parent, 'recovery-notice-fixture-receipt-'));
  const store = openNotificationStore({ directory, monitorId: 'synthetic-monitor' }); store.initialize();
  t.after(() => { assert.ok(path.resolve(directory).startsWith(parent + path.sep) && path.basename(directory).startsWith('recovery-notice-fixture-receipt-')); fs.rmSync(directory, { recursive: true, force: true }); });
  const filename = path.join(directory, 'notification-state.json'), lock = path.join(directory, 'notification-state.lock');
  return { store, directory, filename, lock, raw: () => JSON.parse(fs.readFileSync(filename, 'utf8')) };
}
const dispatch = (f, transports) => dispatchPrepared(report(), { store: f.store, transports, approvedActivation: true, preparationPolicy });
function blockReceiptTransactions(t, f, options = {}) {
  const mkdir = fs.mkdirSync; let armed = false, collisions = 0;
  const mock = t.mock.method(fs, 'mkdirSync', (target, ...args) => {
    if (target === f.lock && armed && collisions < (options.count ?? 2)) {
      collisions++;
      assert.equal(f.raw().events[0].attempts.telegram.status, 'started_outcome_unconfirmed');
      if (options.onCollision) { armed = false; options.onCollision(collisions); armed = true; }
      throw Object.assign(Error('synthetic known busy lock'), { code: 'EEXIST' });
    }
    return mkdir(target, ...args);
  });
  return { arm: () => { armed = true; }, get collisions() { return collisions; }, restore: () => mock.mock.restore() };
}

test('receipt persistence retries a known busy lock, never the accepted transport or durable claim', async t => {
  const f = fixture(t), blocked = blockReceiptTransactions(t, f), calls = [];
  await dispatch(f, { telegram: async message => { calls.push(message.idempotencyKey); blocked.arm(); return { accepted: true }; }, email: async message => { calls.push(message.idempotencyKey); return { accepted: true }; } });
  blocked.restore();
  assert.equal(blocked.collisions, 2); assert.equal(calls.length, 2); assert.equal(new Set(calls).size, 2);
  assert.equal(f.store.readState().events[0].attempts.telegram.status, 'accepted_not_recipient_receipt');
  assert.equal(f.store.readState().events[0].attempts.email.status, 'accepted_not_recipient_receipt');
});

for (const [kind, expected] of [['unknown', 'outcome_unconfirmed'], ['rejected', 'rejected_requires_review']]) {
  test(`busy receipt persistence preserves ${kind} evidence without inferring acceptance`, async t => {
    const f = fixture(t), blocked = blockReceiptTransactions(t, f); let calls = 0;
    await dispatch(f, { telegram: async () => { calls++; blocked.arm(); throw Object.assign(Error('synthetic response'), kind === 'rejected' ? { definiteRejection: true } : {}); }, email: async () => { calls++; return { accepted: true }; } });
    blocked.restore(); assert.equal(blocked.collisions, 2); assert.equal(calls, 2);
    assert.equal(f.store.readState().events[0].attempts.telegram.status, expected);
  });
}

test('exhausted receipt-lock budget preserves the owned lock and unknown intent; resume never resends it', async t => {
  const f = fixture(t), mkdir = fs.mkdirSync; let collisions = 0, calls = 0;
  const owner = path.join(f.lock, 'owner.json'), ownerBytes = 'synthetic-test-owned-lock';
  const mock = t.mock.method(fs, 'mkdirSync', (target, ...args) => { if (target === f.lock && fs.existsSync(owner)) collisions++; return mkdir(target, ...args); });
  await assert.rejects(dispatch(f, { telegram: async () => { calls++; mkdir(f.lock); fs.writeFileSync(owner, ownerBytes); return { accepted: true }; }, email: async () => { calls++; return { accepted: true }; } }), { code: busy });
  mock.mock.restore();
  assert.ok(collisions > 1 && collisions <= 20, 'bounded receipt-only attempts');
  assert.equal(calls, 1); assert.equal(fs.readFileSync(owner, 'utf8'), ownerBytes);
  assert.equal(f.raw().events[0].attempts.telegram.status, 'started_outcome_unconfirmed');
  // Only the synthetic lock owner removes its own lock; production code must not.
  fs.unlinkSync(owner); fs.rmdirSync(f.lock);
  await dispatch(f, { telegram: async () => { throw Error('must never resend'); }, email: async () => { calls++; return { accepted: true }; } });
  assert.equal(calls, 2); assert.equal(f.store.readState().events[0].attempts.telegram.status, 'started_outcome_unconfirmed');
});

test('receipt retries do not roll back a newer observation or dispatch a superseded channel', async t => {
  const f = fixture(t); let calls = 0;
  const blocked = blockReceiptTransactions(t, f, { count: 1, onCollision: () => f.store.transaction((saved, commit) => { const observed = model.observeReport(saved, { ...report(2), issues: [{ code: 'FILE_COVERAGE_INVALID_OR_UNKNOWN', severity: 'critical' }] }); commit(observed.state, saved.revision); }) });
  await dispatch(f, { telegram: async () => { calls++; blocked.arm(); return { accepted: true }; }, email: async () => { throw Error('obsolete channel must not run'); } });
  blocked.restore(); const state = f.store.readState();
  assert.equal(calls, 1); assert.equal(state.observation.eventId, state.events[1].id);
  assert.equal(state.events[0].attempts.telegram.status, 'accepted_not_recipient_receipt');
  assert.equal(state.events[0].attempts.email.status, 'superseded_without_attempt');
});

test('receipt retry rechecks ownership and never overwrites a terminal outcome', async t => {
  const f = fixture(t); let calls = 0;
  const blocked = blockReceiptTransactions(t, f, { count: 1, onCollision: () => f.store.transaction((saved, commit) => { const attempt = saved.events[0].attempts.telegram; saved.events[0].attempts.telegram = { ...attempt, status: 'outcome_unconfirmed', completedAt: new Date().toISOString() }; commit(saved, saved.revision); }) });
  await assert.rejects(dispatch(f, { telegram: async () => { calls++; blocked.arm(); return { accepted: true }; }, email: async () => { throw Error('must not continue'); } }), { code: 'RECOVERY_NOTIFICATION_ATTEMPT_OWNERSHIP_LOST' });
  blocked.restore(); assert.equal(calls, 1); assert.equal(f.store.readState().events[0].attempts.telegram.status, 'outcome_unconfirmed');
});

test('ambiguous result-write failure is not retried even after transport acceptance', async t => {
  const f = fixture(t), rename = fs.renameSync; let armed = false, writes = 0, calls = 0;
  const mock = t.mock.method(fs, 'renameSync', (from, to) => { if (to === f.filename && armed) { writes++; throw Object.assign(Error('synthetic uncertain write'), { code: 'EIO' }); } return rename(from, to); });
  await assert.rejects(dispatch(f, { telegram: async () => { calls++; armed = true; return { accepted: true }; }, email: async () => { throw Error('must not continue'); } }), { code: 'EIO' });
  mock.mock.restore(); assert.equal(writes, 1); assert.equal(calls, 1); assert.equal(f.store.readState().events[0].attempts.telegram.status, 'started_outcome_unconfirmed');
});

test('a busy pre-dispatch lock is not retried and cannot call a transport', async t => {
  const f = fixture(t), mkdir = fs.mkdirSync; let collisions = 0, calls = 0;
  const mock = t.mock.method(fs, 'mkdirSync', (target, ...args) => { if (target === f.lock) { collisions++; throw Object.assign(Error('busy'), { code: 'EEXIST' }); } return mkdir(target, ...args); });
  await assert.rejects(dispatch(f, { telegram: async () => { calls++; }, email: async () => { calls++; } }), { code: busy });
  mock.mock.restore(); assert.equal(collisions, 1); assert.equal(calls, 0); assert.equal(f.store.readState().events.length, 0);
});

test('elapsed receipt retry budget stops without another transaction or inferred acceptance', async t => {
  const f = fixture(t), mkdir = fs.mkdirSync; let now = 1000, armed = false, collisions = 0, calls = 0;
  const clock = t.mock.method(performance, 'now', () => now);
  const lock = t.mock.method(fs, 'mkdirSync', (target, ...args) => {
    if (target === f.lock && armed) { collisions++; now += 2000; throw Object.assign(Error('synthetic busy lock'), { code: 'EEXIST' }); }
    return mkdir(target, ...args);
  });
  await assert.rejects(dispatch(f, { telegram: async () => { calls++; armed = true; return { accepted: true }; }, email: async () => { throw Error('must not continue'); } }), { code: busy });
  lock.mock.restore(); clock.mock.restore();
  assert.equal(collisions, 1); assert.equal(calls, 1);
  assert.equal(f.store.readState().events[0].attempts.telegram.status, 'started_outcome_unconfirmed');
});

test('repeated competing processes retain both receipts with exactly one simulated send per channel', { timeout: 120000 }, async t => {
  const worker = path.join(__dirname, 'helpers/recovery-notification-worker.js');
  for (let iteration = 0; iteration < 10; iteration++) {
    const f = fixture(t);
    const launch = () => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [worker, f.directory, 'race', JSON.stringify(report())], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = ''; child.stderr.on('data', data => { stderr += data; }); child.on('error', reject); child.on('close', status => resolve({ status, stderr }));
    });
    const workers = [launch(), launch()]; fs.writeFileSync(path.join(f.directory, 'start-barrier'), 'synthetic-only');
    const outcomes = await Promise.all(workers);
    assert.ok(outcomes.every(value => [0, 75].includes(value.status)), JSON.stringify(outcomes));
    const resume = spawnSync(process.execPath, [worker, f.directory, 'resume', JSON.stringify(report(2))], { windowsHide: true, encoding: 'utf8', timeout: 10000 });
    assert.equal(resume.status, 0, resume.stderr);
    const rows = fs.readFileSync(path.join(f.directory, 'synthetic-accepted.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.equal(rows.length, 2); assert.equal(new Set(rows.map(row => row.key)).size, 2);
    assert.deepEqual(rows.map(row => row.channel).sort(), ['email', 'telegram']);
    const event = f.store.readState().events[0];
    for (const channel of ['telegram', 'email']) assert.equal(event.attempts[channel].status, 'accepted_not_recipient_receipt');
  }
});
