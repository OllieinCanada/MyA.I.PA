const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { auditReport, canonical, ciContext, compareLocks, requireUnchangedInstall } = require('../scripts/verify-development-dependency-ci');

const ROOT = path.resolve(__dirname, '..');
const counts = severity => ({ info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: severity ? 1 : 0, ...(severity ? { [severity]: 1 } : {}) });
function audit(severity) {
  return {
    auditReportVersion: 2,
    vulnerabilities: severity ? { 'synthetic-package': {
      name: 'synthetic-package', severity, isDirect: false, range: '<1.0.1', nodes: ['node_modules/synthetic-package'],
      via: [{ source: 1234, name: 'synthetic-package', severity, range: '<1.0.1', url: 'https://github.com/advisories/GHSA-abcd-efgh-jkmn' }],
    } } : {},
    metadata: { vulnerabilities: counts(severity) },
  };
}
const parse = (value, scope = 'include-dev', overrides = {}) => auditReport(value, {
  scope, exitCode: value.metadata.vulnerabilities.total ? 1 : 0, ...overrides,
});

test('development audit retains every noncritical severity, package and advisory without treating a nonzero audit as an outage', () => {
  for (const severity of ['info', 'low', 'moderate', 'high']) {
    const report = parse(audit(severity));
    assert.equal(report.passed, true);
    assert.equal(report.counts[severity], 1);
    assert.equal(report.packages[0].severity, severity);
    assert.deepEqual(report.distinctAdvisorySources, [1234]);
    assert.deepEqual(report.distinctGhsaIds, ['GHSA-abcd-efgh-jkmn']);
  }
});

test('critical development findings fail while any production finding retains the strict fail policy', () => {
  assert.equal(parse(audit('critical')).passed, false);
  assert.equal(parse(audit(), 'production').passed, true);
  for (const severity of ['info', 'low', 'moderate', 'high', 'critical']) assert.equal(parse(audit(severity), 'production').passed, false);
});

test('a critical concrete advisory cannot be hidden by a noncritical package or metadata summary', () => {
  const value = audit('high');
  value.vulnerabilities['synthetic-package'].via[0].severity = 'critical';
  const report = parse(value);
  assert.equal(report.passed, false);
  assert.equal(report.counts.critical, 0, 'retain the contradictory reported counts instead of normalizing them');
  assert.equal(report.packages[0].via[0].severity, 'critical');
  assert.deepEqual(report.criticalAdvisorySources, [1234]);
  assert.deepEqual(report.criticalAffectedPackages, ['synthetic-package']);
  assert.ok(report.validationIssues.includes('CRITICAL_ADVISORY_NOT_REFLECTED_IN_PACKAGE_SUMMARY'));
});

function parent(name, child, severity = 'high') {
  return { name, severity, isDirect: false, range: '*', nodes: [`node_modules/${name}`], via: [child] };
}

test('critical advisory impact propagates through parent references independently of claimed critical totals', () => {
  const value = audit('high');
  value.vulnerabilities['synthetic-package'].via[0].severity = 'critical';
  value.vulnerabilities['synthetic-parent'] = parent('synthetic-parent', 'synthetic-package');
  value.vulnerabilities['synthetic-grandparent'] = parent('synthetic-grandparent', 'synthetic-parent');
  value.metadata.vulnerabilities.high = value.metadata.vulnerabilities.total = 3;
  const report = parse(value);
  assert.equal(report.passed, false);
  assert.deepEqual(report.criticalAffectedPackages, ['synthetic-grandparent', 'synthetic-package', 'synthetic-parent']);
  assert.deepEqual(report.criticalAdvisorySources, [1234]);
  assert.equal(report.counts.critical, 0);
  assert.equal(report.packages.length, 3);
});

test('a high parent of a correctly reported critical child fails without inventing a blanket severity-equality rule', () => {
  const value = audit('critical');
  value.vulnerabilities['synthetic-parent'] = parent('synthetic-parent', 'synthetic-package');
  value.metadata.vulnerabilities.high = 1;
  value.metadata.vulnerabilities.total = 2;
  const report = parse(value);
  assert.equal(report.passed, false);
  assert.equal(report.packages.find(item => item.name === 'synthetic-parent').severity, 'high');
});

test('dangling parent advisory references fail closed instead of producing an advisory-free passing report', () => {
  const value = audit('high');
  value.vulnerabilities['synthetic-package'].via = ['missing-child'];
  assert.throws(() => parse(value), /REFERENCE_MISSING/);
});

test('self-only and multi-package advisory cycles without a concrete source fail closed', () => {
  const self = audit('high');
  self.vulnerabilities['synthetic-package'].via = ['synthetic-package'];
  assert.throws(() => parse(self), /UNGROUNDED/);
  const cycle = audit('high');
  cycle.vulnerabilities['synthetic-package'].via = ['synthetic-parent'];
  cycle.vulnerabilities['synthetic-parent'] = parent('synthetic-parent', 'synthetic-package');
  cycle.metadata.vulnerabilities.high = cycle.metadata.vulnerabilities.total = 2;
  assert.throws(() => parse(cycle), /UNGROUNDED/);
});

test('a cycle grounded in a concrete advisory preserves valid noncritical npm aggregation differences', () => {
  const value = audit('moderate');
  value.vulnerabilities['synthetic-package'].via.push('synthetic-parent');
  value.vulnerabilities['synthetic-parent'] = parent('synthetic-parent', 'synthetic-package');
  value.metadata.vulnerabilities.high = 1;
  value.metadata.vulnerabilities.total = 2;
  const report = parse(value);
  assert.equal(report.passed, true);
  assert.equal(report.counts.moderate, 1);
  assert.equal(report.counts.high, 1);
  assert.equal(report.distinctAdvisorySources.length, 1);
});

test('invalid JSON shape, registry errors, signals and inconsistent exit/counts fail closed', () => {
  for (const value of [null, [], {}, { ...audit(), error: { code: 'registry unavailable' } }, { ...audit(), auditReportVersion: 1 }]) {
    assert.throws(() => auditReport(value, { scope: 'include-dev', exitCode: 0 }));
  }
  assert.throws(() => parse(audit(), 'include-dev', { error: { code: 'ETIMEDOUT' } }));
  assert.throws(() => parse(audit(), 'include-dev', { signal: 'SIGTERM' }));
  assert.throws(() => parse(audit(), 'include-dev', { exitCode: 1 }));
  assert.throws(() => parse(audit('high'), 'include-dev', { exitCode: 0 }));
  const mismatch = audit('high'); mismatch.metadata.vulnerabilities.high = 0;
  assert.throws(() => parse(mismatch));
  const wrongSeverity = audit('high'); wrongSeverity.vulnerabilities['synthetic-package'].severity = 'low';
  assert.throws(() => parse(wrongSeverity));
});

test('source IDs and GHSA IDs are deduplicated independently from flagged packages and parent aggregation', () => {
  const value = audit('high');
  const first = value.vulnerabilities['synthetic-package'];
  first.via.push({ ...first.via[0], source: 1235 });
  value.vulnerabilities['synthetic-parent'] = { name: 'synthetic-parent', severity: 'high', isDirect: false, range: '*', nodes: ['node_modules/synthetic-parent'], via: ['synthetic-package'] };
  value.metadata.vulnerabilities.high = value.metadata.vulnerabilities.total = 2;
  const report = parse(value);
  assert.equal(report.packages.length, 2);
  assert.deepEqual(report.distinctAdvisorySources, [1234, 1235]);
  assert.equal(report.distinctGhsaIds.length, 1);
  assert.deepEqual(report.packages.find(item => item.name === 'synthetic-parent').via, ['synthetic-package']);
});

test('unknown advisories, nonpackage node paths and missing package identity cannot be silently dropped', () => {
  const invalid = [value => { value.vulnerabilities['synthetic-package'].via[0].url = 'https://untrusted.invalid/advisory'; },
    value => { value.vulnerabilities['synthetic-package'].nodes = ['../private']; },
    value => { value.vulnerabilities['synthetic-package'].name = 'different'; },
    value => { value.vulnerabilities['synthetic-package'].via = []; }];
  for (const mutate of invalid) { const value = audit('high'); mutate(value); assert.throws(() => parse(value)); }
});

test('lock equality covers full JSON semantics while ignoring only object key order', () => {
  const before = { lockfileVersion: 3, packages: { a: { version: '1', integrity: 'first' } }, name: 'fixture' };
  const reordered = { name: 'fixture', packages: { a: { integrity: 'first', version: '1' } }, lockfileVersion: 3 };
  assert.equal(compareLocks(before, reordered).equal, true);
  const different = structuredClone(before); different.packages.a.integrity = 'different';
  assert.deepEqual(compareLocks(before, different).changedPackageEntries, ['a']);
  assert.equal(compareLocks(before, different).equal, false);
  assert.equal(compareLocks(before, { ...reordered, lockfileVersion: 2 }).equal, false);
  assert.notEqual(canonical({ ordered: [1, 2] }), canonical({ ordered: [2, 1] }));
});

test('installation cannot silently adopt regenerated input drift or an earlier head/run receipt', () => {
  const binding = { actualHead: 'a', requestedHead: 'a', workflowGitHubSha: 'b', runId: '123',
    runAttempt: '2', manifestSha256: 'manifest', lockSha256: 'lock' };
  assert.doesNotThrow(() => requireUnchangedInstall(binding, { ...binding, passed: true }));
  for (const key of Object.keys(binding)) assert.throws(() => requireUnchangedInstall(binding, { ...binding, passed: true, [key]: 'changed' }));
  assert.throws(() => requireUnchangedInstall(binding, { ...binding, passed: false }));
});

function context() {
  return { GITHUB_ACTIONS: 'true', CI: 'true', RUNNER_ENVIRONMENT: 'github-hosted',
    GITHUB_REPOSITORY: 'OllieinCanada/MyA.I.PA', GITHUB_EVENT_NAME: 'pull_request',
    GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '2', DEPENDENCY_EXPECTED_HEAD: 'a'.repeat(40),
    GITHUB_SHA: 'b'.repeat(40), GITHUB_WORKSPACE: ROOT, RUNNER_TEMP: path.resolve(ROOT, '..', 'synthetic-runner-temp') };
}

test('CI context captures requested, actual and workflow merge identity separately', () => {
  const report = ciContext(context(), 'a'.repeat(40), 'linux');
  assert.equal(report.actualHead, 'a'.repeat(40));
  assert.equal(report.requestedHead, 'a'.repeat(40));
  assert.equal(report.workflowGitHubSha, 'b'.repeat(40));
  assert.equal(report.runAttempt, '2');
});

test('local, wrong-head, wrong-workspace and unsafe-temp invocation is rejected before any npm path is entered', () => {
  for (const change of [{ GITHUB_ACTIONS: 'false' }, { CI: 'false' }, { RUNNER_ENVIRONMENT: 'self-hosted' },
    { GITHUB_RUN_ID: '' }, { GITHUB_RUN_ATTEMPT: '0' }, { DEPENDENCY_EXPECTED_HEAD: 'unknown' },
    { GITHUB_REPOSITORY: 'different/repository' }, { GITHUB_WORKSPACE: path.dirname(ROOT) },
    { RUNNER_TEMP: ROOT }, { RUNNER_TEMP: path.join(ROOT, 'nested-temp') }, { RUNNER_TEMP: path.parse(ROOT).root }]) {
    assert.throws(() => ciContext({ ...context(), ...change }, 'a'.repeat(40), 'linux'));
  }
  assert.throws(() => ciContext(context(), 'c'.repeat(40), 'linux'));
  assert.throws(() => ciContext(context(), 'a'.repeat(40), 'win32'));
});
