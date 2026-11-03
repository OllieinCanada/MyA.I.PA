const test = require('node:test');
const assert = require('node:assert/strict');
const proof = require('../scripts/launch-evidence');
const commit = 'a'.repeat(40);
const names = ['incident_generated', 'notification_accepted', 'recipient_receipt_confirmed', 'duplicate_notification_prevented', 'no_customer_impact'];
const alert = releaseCommit => ({ scope: 'controlled-private-alert', releaseCommit, ready: true, customerMessagesSent: 0, customerCallsPlaced: 0, checks: names.map(name => ({ name, passed: true })) });

test('release-bound evidence rejects coercible arrays and objects rather than certifying a malformed release', () => {
  assert.equal(proof.alertDeliveryPassed(alert(commit), commit), true);
  for (const invalid of [[commit], Object.assign(new String(commit)), { toString: () => commit }, null, 123]) {
    assert.equal(proof.alertDeliveryPassed(alert(invalid), invalid), false);
    assert.equal(proof.alertDeliveryPassed(alert(invalid), commit), false);
    assert.equal(proof.alertDeliveryPassed(alert(commit), invalid), false);
  }
});

test('malformed check entries fail closed without crashing the readiness report', () => {
  for (const entry of [null, undefined, false, [], 'passed', 1, {}, { name: names[0], passed: 'true' }]) {
    const value = { ...alert(commit), checks: [entry, ...alert(commit).checks] };
    assert.equal(proof.alertDeliveryPassed(value, commit), false);
  }
});

test('contradictory failure and duplicate check records cannot be hidden by ready:true', () => {
  for (const extra of [{ name: 'unexpected_tenant_access', passed: false }, { name: 'recipient_receipt_confirmed', passed: true }, { name: '', passed: true }]) {
    assert.equal(proof.alertDeliveryPassed({ ...alert(commit), checks: [...alert(commit).checks, extra] }, commit), false);
  }
  assert.equal(proof.checksPass(alert(commit), []), false);
  assert.equal(proof.checksPass(alert(commit), [names[0], names[0]]), false);
});

test('Stripe local and provider evidence reject null or array cycle entries without throwing', () => {
  const local = { ready: true, mode: 'local-mocked-stripe-no-network', externalStripeObjectsCreated: 0, realPaymentsAttempted: 0, consecutivePasses: 5, results: Array(5).fill(null) };
  const provider = { ready: true, mode: 'stripe-test-clocks', scope: 'provider-api-test-only', releaseCommit: commit, liveMode: false, realPaymentsAttempted: 0, consecutivePasses: 5, declinedCardRejected: true, cleanupConfirmed: true, results: Array(5).fill(null) };
  for (const invalid of [null, [], 'cycle', false]) {
    assert.equal(proof.localStripePassed({ ...local, results: Array(5).fill(invalid) }), false);
    assert.equal(proof.stripeProviderPassed({ ...provider, results: Array(5).fill(invalid) }, commit), false);
  }
});

test('models, provider acceptance and test plans never substitute for actual application/recipient proof', () => {
  assert.equal(proof.privacyApplicationPassed({ scope: 'synthetic-policy-model-only', passed: true }, commit), false);
  assert.equal(proof.alertDeliveryPassed({ ...alert(commit), checks: alert(commit).checks.filter(x => x.name !== 'recipient_receipt_confirmed') }, commit), false);
  assert.equal(proof.stripeCheckoutPassed({ scope: 'isolated-test-preparation-only', releaseCommit: commit, ready: true }, commit), false);
});

test('logical restoration counts require a nonempty named-table object, not an array or exotic object', () => {
  const value = { ready: true, scope: 'logical-database-only', releaseCommit: commit, executionId: '12345678-1234-4abc-8abc-123456789abc', artifactSha256: 'b'.repeat(64), backupMode: 'production-logical-export', ok: true, restored: true, checksumVerified: true, archiveReadable: true, archiveTocScreenPassed: true, restoreElapsedMs: 1, constraintsValidated: true, productionDatabaseModified: false, applicationWorkersStarted: false, providerDispatches: 0, tableCounts: { Fixture: 3 }, tablesVerified: 1 };
  assert.equal(proof.logicalRestorePassed(value, commit), true);
  const bare = Object.create(null); bare.Fixture = 3; assert.equal(proof.logicalRestorePassed({ ...value, tableCounts: bare }, commit), true);
  for (const tableCounts of [[3], null, {}, new Map([['Fixture', 3]]), Object.assign(new Date(), { Fixture: 3 }), { '': 3 }, { ' ': 3 }, { Fixture: 1.5 }, { Fixture: '3' }, { Fixture: -1 }]) assert.equal(proof.logicalRestorePassed({ ...value, tableCounts }, commit), false);
});
