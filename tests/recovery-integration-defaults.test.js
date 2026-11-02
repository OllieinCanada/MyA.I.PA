'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const os = require('node:os');
const policy = require('../scripts/approved-recovery-policy');
const preparationPolicy = require('./fixtures/recovery-policy.synthetic.json');
const { dispatchPrepared } = require('../scripts/recovery-notification-state');

test('missing private policy is never auto-loaded or replaced by a default approval', () => {
  assert.equal(policy.policy, null);
  assert.throws(() => policy.validatePolicy(), /EXPLICIT_SYNTHETIC_POLICY/);
  assert.equal(policy.readiness().productionExecutionAllowed, false);
  assert.equal(policy.readiness().policyRequired, true);
  const source = fs.readFileSync(path.join(__dirname, '../scripts/approved-recovery-policy.js'), 'utf8');
  const loaded = [], isolated = { exports: {} };
  vm.runInNewContext(source, { module: isolated, require(name) {
    loaded.push(name); assert.equal(name, 'node:crypto', 'module load may not discover a policy or private file');
    return require(name);
  } });
  assert.deepEqual(loaded, ['node:crypto']);
  assert.equal(isolated.exports.policy, null);
});

test('explicit fictional policy is test input, never real approval or permission to activate', () => {
  assert.equal(policy.validatePolicy(preparationPolicy).approval.realApproval, false);
  assert.equal(policy.readiness(preparationPolicy).productionExecutionAllowed, false);
  for (const mutate of [value => { value.approval.realApproval = true; }, value => { value.approval.fixtureOnly = false; },
    value => { value.scope = 'production'; }, value => { value.productionSource.serviceId = 'live-resource'; }]) {
    const value = structuredClone(preparationPolicy); mutate(value);
    assert.throws(() => policy.validatePolicy(value));
  }
  assert.equal(preparationPolicy.capture.enabled, false);
  assert.equal(preparationPolicy.monitor.enabled, false);
  assert.equal(preparationPolicy.notifications.recipientReceiptProven, false);
});

test('every live activation switch is rejected rather than accepted as an incidental preparation edit', () => {
  for (const [group, key] of [['capture', 'enabled'], ['capture', 'automaticCadenceApproved'], ['monitor', 'enabled'],
    ['approval', 'productionRehearsalApproved'], ['rehearsal', 'productionChangesAllowed'],
    ['staging', 'workersEnabled'], ['staging', 'externalProviderTrafficAllowed'], ['staging', 'productionBackupAllowed'],
    ['staging', 'strictFileReadsEnabledByDefault']]) {
    const changed = structuredClone(preparationPolicy); changed[group][key] = true;
    assert.throws(() => policy.validatePolicy(changed), /PREPARATION_MUST_REMAIN_DISABLED/);
  }
});

test('default dispatcher remains a plan only and cannot touch a store or invoke injected transports', async () => {
  let storeTouches = 0, sends = 0;
  const store = new Proxy({}, { get() { storeTouches++; throw Error('Default path must not use a store'); } });
  const transports = { telegram: async () => { sends++; }, email: async () => { sends++; } };
  const report = { checkedAt: new Date().toISOString(), severity: 'critical', issues: [{ code: 'SYNTHETIC_UNPROVEN', severity: 'critical' }] };
  const result = await dispatchPrepared(report, { store, transports });
  assert.equal(result.activated, false);
  assert.equal(result.networkRequests, 0);
  assert.equal(sends, 0);
  assert.equal(storeTouches, 0);
});

test('even explicit activation cannot reach a store or transport without an explicit synthetic policy', async () => {
  let touches = 0;
  const store = new Proxy({}, { get() { touches++; throw Error('Policy must fail first'); } });
  const transports = { telegram: async () => { touches++; }, email: async () => { touches++; } };
  const report = { checkedAt: new Date().toISOString(), severity: 'critical', issues: [{ code: 'SYNTHETIC_UNPROVEN', severity: 'critical' }] };
  await assert.rejects(dispatchPrepared(report, { approvedActivation: true, store, transports }), /EXPLICIT_SYNTHETIC_POLICY/);
  assert.equal(touches, 0);
});

test('offline monitor requires explicit fictional policy and cannot infer authority from a local file', () => {
  const parent = fs.realpathSync(os.tmpdir()), directory = fs.mkdtempSync(path.join(parent, 'recovery-public-policy-fixture-'));
  try {
    const facts = path.join(directory, 'facts.json'), out = path.join(directory, 'out');
    fs.writeFileSync(facts, '{}', { flag: 'wx' });
    const cli = require('../scripts/evaluate-recovery-monitor');
    assert.throws(() => cli.main(['--facts=' + facts, '--out-dir=' + out]), /Explicit synthetic/);
    assert.equal(fs.existsSync(out), false);
    const badPolicy = path.join(directory, 'not-approved.json'), bad = structuredClone(preparationPolicy);
    bad.approval.realApproval = true;
    fs.writeFileSync(badPolicy, JSON.stringify(bad), { flag: 'wx' });
    assert.throws(() => cli.main(['--facts=' + facts, '--out-dir=' + out, '--policy=' + badPolicy]), /NO_LIVE_APPROVAL/);
    assert.equal(fs.existsSync(out), false);
    const result = cli.main(['--facts=' + facts, '--out-dir=' + out, '--policy=' + require.resolve('./fixtures/recovery-policy.synthetic.json')]);
    assert.equal(result.scope, 'synthetic-plan-only');
    assert.equal(result.messagesSent, 0);
    assert.equal(result.productionRequests, 0);
    assert.equal(result.schedule.installed, false);
    assert.equal(result.dispatchAllowed, false);
  } finally {
    assert.equal(path.dirname(fs.realpathSync(directory)), parent);
    assert.ok(path.basename(directory).startsWith('recovery-public-policy-fixture-'));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('actual application readers preserve legacy behavior unless the strict recovery flag is exactly true', () => {
  const source = fs.readFileSync(path.join(__dirname, '../server/index.js'), 'utf8');
  const readers = [
    ['readPendingStripeSignupStore', 'pendingStripeSignupPath', 'ensurePendingStripeSignupStore'],
    ['readTrialReminderStore', 'trialReminderPath', 'ensureTrialReminderStore'],
    ['readSignupDashboardStore', 'signupDashboardPath', 'ensureSignupDashboardStore'],
    ['readVapiCallSyncStore', 'vapiCallSyncPath', 'ensureVapiCallSyncStore'],
  ];
  for (const [name, pathname, ensure] of readers) {
    const body = source.match(new RegExp('function ' + name + '\\(\\) \\{[\\s\\S]*?\\n\\}'))?.[0];
    assert.ok(body, name);
    for (const flag of [undefined, '', 'false', '1', 'TRUE']) {
      let initialized = 0, strict = 0;
      const context = { module: { exports: {} }, process: { env: flag === undefined ? {} : { RECOVERY_STRICT_FILE_READS: flag } },
        fs: { readFileSync() { throw Object.assign(Error('synthetic missing file'), { code: 'ENOENT' }); } },
        [pathname]: 'synthetic-unopened-path', [ensure]: () => { initialized++; },
        readRecoveryFileStore() { strict++; throw Error('strict mode was not requested'); } };
      vm.runInNewContext(body + '\nmodule.exports=' + name, context);
      assert.equal(Object.keys(context.module.exports()).length, 0);
      assert.equal(initialized, 1);
      assert.equal(strict, 0);
    }
    let initialized = 0;
    const failure = Object.assign(Error('Recovery store unavailable'), { code: 'RECOVERY_STORE_MISSING', status: 503 });
    const strictContext = { module: { exports: {} }, process: { env: { RECOVERY_STRICT_FILE_READS: 'true' } },
      [pathname]: 'synthetic-unopened-path', [ensure]: () => { initialized++; }, readRecoveryFileStore() { throw failure; } };
    vm.runInNewContext(body + '\nmodule.exports=' + name, strictContext);
    assert.throws(() => strictContext.module.exports(), error => error === failure && error.status === 503);
    assert.equal(initialized, 0);
  }
});
