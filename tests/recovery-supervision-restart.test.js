'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { runWorker } = require('../scripts/public-demo-audio-plan');
const contract = require('../scripts/recovery-supervision-contract');
const { openNotificationStore } = require('../scripts/recovery-notification-store');
const ENTRY = path.join(__dirname, 'helpers/recovery-supervision-parent.js');
const evidence = [];

function fixture(t) {
  const parent = fs.realpathSync(os.tmpdir());
  const directory = fs.mkdtempSync(path.join(parent, 'recovery-supervision-fixture-'));
  const executionId = crypto.randomUUID(), observedAt = Date.now() - 10000;
  fs.writeFileSync(path.join(directory, 'synthetic-supervision.json'), JSON.stringify({ schemaVersion: 1,
    scope: 'synthetic-only-no-provider-data', executionId, realTransportsAllowed: false }), { flag: 'wx', mode: 0o600 });
  t.after(() => {
    const resolved = fs.realpathSync(directory);
    assert.equal(path.dirname(resolved), parent);
    assert.ok(path.basename(resolved).startsWith('recovery-supervision-fixture-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  return { directory, executionId, observedAt };
}

function runParent(value, phase) {
  assert.ok(os.freemem() >= 192 * 1024 * 1024, 'Own synthetic resource floor reached; do not start another parent');
  const request = { ...value, phase }, started = performance.now();
  const result = runWorker(['--max-old-space-size=64', ENTRY, JSON.stringify(request)], {
    cwd: value.directory, env: contract.workerEnvironment(value.directory), stdio: ['ignore', 'pipe', 'pipe'], timeoutMs: 8000,
  });
  assert.equal(result.error, undefined, result.error?.code);
  assert.equal(result.status, phase === 'initial-crash' ? 78 : 0, String(result.stderr));
  assert.ok(Buffer.isBuffer(result.stdout) && result.stdout.length < 16384);
  assert.equal(String(result.stderr), '');
  const proof = JSON.parse(result.stdout.toString('utf8'));
  assert.equal(proof.scope, 'fresh-parent-synthetic-only');
  assert.equal(proof.parentPid, result.pid);
  assert.equal(proof.phase, phase);
  assert.equal(proof.realProviderRequests, 0);
  assert.equal(proof.credentialSerialization, false);
  assert.equal(proof.hardParentOrOSDeadlineProven, false);
  assert.ok(proof.proofs.every(child => child.childNoLongerRunning === true && child.exitObserved));
  try { process.kill(result.pid, 0); assert.fail('The owned parent is still running'); }
  catch (error) { assert.equal(error.code, 'ESRCH'); }
  const receipt = { ...proof, exitCode: result.status, elapsedMs: performance.now() - started, parentExitObserved: true };
  evidence.push(receipt);
  return receipt;
}

for (const phase of ['initial-exit', 'initial-crash']) {
  test(`a genuinely fresh parent cannot resend accepted-before-hang after ${phase}`, t => {
    const value = fixture(t), first = runParent(value, phase);
    assert.equal(first.calls, 2);
    assert.equal(first.acceptanceBefore, 0);
    assert.equal(first.acceptanceAfter, 2);
    assert.equal(first.proofs[0].mode, 'accepted-then-hang');
    assert.equal(first.proofs[0].readyObserved, true);
    assert.equal(first.proofs[0].errorCode, 'ETIMEDOUT');
    assert.equal(first.attempts.telegram.status, 'outcome_unconfirmed');
    assert.equal(first.attempts.email.status, 'accepted_not_recipient_receipt');
    const second = runParent({ ...value, observedAt: value.observedAt + 1000 }, 'reopen');
    assert.notEqual(second.parentPid, first.parentPid);
    assert.notEqual(second.invocationId, first.invocationId);
    assert.equal(second.storeId, first.storeId);
    assert.equal(second.eventId, first.eventId);
    assert.equal(second.calls, 0);
    assert.equal(second.acceptanceBefore, 2);
    assert.equal(second.acceptanceAfter, 2);
    assert.equal(second.attempts.telegram.status, 'outcome_unconfirmed');
  });
}

test('fresh-parent negative control exposes a ledger-bypassing resend instead of hiding it as provider idempotency', t => {
  const value = fixture(t);
  runParent(value, 'initial-exit');
  const bad = runParent({ ...value, observedAt: value.observedAt + 1000 }, 'negative-replay');
  assert.equal(bad.calls, 1);
  assert.equal(bad.acceptanceBefore, 2);
  assert.equal(bad.acceptanceAfter, 3, 'this deliberately bad path must fail any no-resend equality check');
  const rows = contract.acceptanceFiles(value.directory).map(name => JSON.parse(fs.readFileSync(path.join(value.directory, name))));
  assert.equal(rows.filter(row => row.channel === 'telegram').length, 2);
  assert.equal(new Set(rows.filter(row => row.channel === 'telegram').map(row => row.idempotencyKey)).size, 1);
});

test('fresh-parent restart refuses ambiguous legacy state before any transport can run', t => {
  const value = fixture(t);
  const store = openNotificationStore({ directory: value.directory, monitorId: 'synthetic-fresh-parent-monitor' });
  store.initialize();
  fs.writeFileSync(path.join(value.directory, 'notification-state.json'), JSON.stringify({ lastFingerprint: 'legacy-global-only' }));
  const result = runWorker(['--max-old-space-size=64', ENTRY, JSON.stringify({ ...value, phase: 'reopen' })], {
    cwd: value.directory, env: contract.workerEnvironment(value.directory), stdio: ['ignore', 'pipe', 'pipe'], timeoutMs: 8000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 79);
  assert.equal(String(result.stdout), '');
  assert.equal(String(result.stderr).trim(), 'SYNTHETIC_FRESH_PARENT_FAILED');
  assert.equal(contract.acceptanceFiles(value.directory).length, 0);
});

test.after(() => {
  if (process.env.RECOVERY_RESTART_EVIDENCE) fs.writeFileSync(process.env.RECOVERY_RESTART_EVIDENCE,
    JSON.stringify({ scope: 'fixed-synthetic-fresh-parent-restart-only', parentRestartExercised: true, receipts: evidence,
      crashOccursOnlyAfterOwnedChildrenExit: true, realProviderRequests: 0, credentialSerialization: false,
      physicalReceiptProven: false, hardParentOrOSDeadlineProven: false }, null, 2) + '\n', { flag: 'wx' });
});
