const test = require('node:test');
const assert = require('node:assert/strict');
const proof = require('../scripts/launch-evidence');
const commit = 'a'.repeat(40);
function checks(names) { return names.map(name => ({ name, passed: true })); }
test('a former blanket cancellationSupported flag cannot pass the local Stripe gate', async () => {
  const results = await Promise.all([1, 2, 3, 4, 5].map(index => require('../scripts/run-local-stripe-simulation').runCycle(index)));
  const value = { ready: true, mode: 'local-mocked-stripe-no-network', consecutivePasses: 5, externalStripeObjectsCreated: 0, realPaymentsAttempted: 0, results };
  assert.equal(proof.localStripePassed(value), true);
  for (const field of Object.keys(results[0]).filter(key => key !== 'cycle')) {
    assert.equal(proof.localStripePassed({ ...value, results: results.map((row, index) => index === 2 ? { ...row, [field]: false } : row) }), false, field);
  }
  assert.equal(proof.localStripePassed({ ...value, results: results.map(row => ({ cycle: row.cycle, cancellationSupported: true })) }), false);
  assert.equal(proof.localStripePassed({ ...value, realPaymentsAttempted: 1 }), false);
});
test('backup prerequisites and synthetic restores cannot pass actual recovery gates', () => {
  const prerequisites = { ready: true, databaseUrlConfigured: true, encryptionConfigured: true, pgDumpVersion: '18', pgRestoreVersion: '18' };
  assert.equal(proof.logicalRestorePassed(prerequisites, commit), false);
  assert.equal(proof.fullRecoveryPassed(prerequisites, commit), false);
  const restore = { ready: true, scope: 'logical-database-only', releaseCommit: commit, executionId: '12345678-1234-4abc-8abc-123456789abc',
    artifactSha256: 'b'.repeat(64), backupMode: 'production-logical-export', ok: true, restored: true,
    checksumVerified: true, archiveReadable: true, archiveTocScreenPassed: true, restoreElapsedMs: 1000,
    constraintsValidated: true, productionDatabaseModified: false, applicationWorkersStarted: false,
    providerDispatches: 0, tableCounts: { Fixture: 2 }, tablesVerified: 1 };
  assert.equal(proof.logicalRestorePassed(restore, commit), true);
  for (const change of [{ backupMode: 'synthetic-backup-fixture' }, { providerDispatches: 1 }, { tablesVerified: 2 },
    { tableCounts: { Fixture: -1 } }, { archiveTocScreenPassed: false }, { releaseCommit: 'b'.repeat(40) }]) {
    assert.equal(proof.logicalRestorePassed({ ...restore, ...change }, commit), false);
  }
  assert.equal(proof.logicalRestorePassed(restore, ''), false);
  assert.equal(proof.fullRecoveryPassed(restore, commit), false);
});
test('the standalone privacy model never claims application-handler or provider proof', () => {
  const value = { scope: 'synthetic-policy-model-only', passed: true, applicationHandlersExercised: false,
    productionDataUsed: false, externalProvidersMutated: false,
    checks: checks(['access_is_tenant_scoped', 'correction_propagates_to_subject_record', 'consent_withdrawal_creates_suppression',
      'deletion_removes_active_subject_data', 'other_tenant_data_is_preserved', 'restore_replay_prevents_deleted_data_from_returning']) };
  assert.equal(proof.privacyModelPassed(value), true);
  assert.equal(proof.privacyApplicationPassed(value, commit), false);
  assert.equal(proof.privacyModelPassed({ ...value, applicationHandlersExercised: true }), false);
});
test('configured monitoring or accepted notifications alone cannot claim recipient-confirmed alert delivery', () => {
  const value = { scope: 'controlled-private-alert', releaseCommit: commit, ready: true, customerMessagesSent: 0,
    customerCallsPlaced: 0, checks: checks(['incident_generated', 'notification_accepted', 'recipient_receipt_confirmed', 'duplicate_notification_prevented', 'no_customer_impact']) };
  assert.equal(proof.alertDeliveryPassed(value, commit), true);
  assert.equal(proof.alertDeliveryPassed({ ...value, checks: value.checks.filter(check => check.name !== 'recipient_receipt_confirmed') }, commit), false);
  assert.equal(proof.alertDeliveryPassed({ ...value, checks: [...value.checks, value.checks[0]] }, commit), false);
  assert.equal(proof.alertDeliveryPassed({ ...value, releaseCommit: 'b'.repeat(40) }, commit), false);
  assert.equal(proof.alertDeliveryPassed({ ready: true, warningCount: 0, checks: [{ healthy: true }] }, commit), false);
});
test('legal and hosted Checkout proof require explicit scope and all checks, not ready:true', () => {
  for (const validator of [proof.legalApprovalPassed, proof.stripeCheckoutPassed, proof.privacyApplicationPassed, proof.fullRecoveryPassed]) {
    assert.equal(validator({ ready: true, releaseCommit: commit }, commit), false);
    assert.equal(validator({}, commit), false);
  }
  assert.equal(proof.stripeProviderPassed({ ready: true, consecutivePasses: 5 }), false);
});

test('provider lifecycle preparation verifies a paid renewal and effective cancellation, not just a saved flag', async () => {
  const { renewAndCancel } = require('../scripts/test-stripe-trial-lifecycle');
  const scenario = { clock: { id: 'clock_fixture' }, customer: { id: 'cus_fixture' }, subscription: { id: 'sub_fixture' } };
  let time = 0, subscription = { status: 'active', customer: 'cus_fixture', current_period_end: 100, latest_invoice: 'in_fixture' };
  const stripe = {
    testHelpers: { testClocks: { advance: async (_id, input) => { time = input.frozen_time;
      if (subscription.cancel_at_period_end) subscription = { ...subscription, status: 'canceled' };
      else subscription = { ...subscription, current_period_end: 500 };
    }, retrieve: async () => ({ status: 'ready' }) } },
    subscriptions: { retrieve: async () => ({ ...subscription }), update: async (_id, params) => (subscription = { ...subscription, ...params }) },
    invoices: { retrieve: async () => ({ status: 'paid' }) },
  };
  assert.equal((await renewAndCancel(stripe, scenario, { ...subscription })).status, 'canceled');
  assert.equal(time, 620);
  subscription = { status: 'active', customer: 'cus_fixture', current_period_end: 100, latest_invoice: 'in_fixture' };
  stripe.invoices.retrieve = async () => ({ status: 'open' });
  await assert.rejects(renewAndCancel(stripe, scenario, subscription), /not paid/);
});

test('test-clock cleanup failures stay visible and prevent a provider gate pass', async () => {
  const { cleanupTestClocks } = require('../scripts/test-stripe-trial-lifecycle');
  const cleanup = await cleanupTestClocks({ testHelpers: { testClocks: { del: async id => {
    if (id === 'uncertain') throw Error('fixture timeout');
    return { deleted: id === 'removed' };
  } } } }, ['removed', 'uncertain', 'not-confirmed']);
  assert.deepEqual(cleanup, [{ confirmed: true }, { confirmed: false }, { confirmed: false }]);
  const value = { ready: true, mode: 'stripe-test-clocks', scope: 'provider-api-test-only', releaseCommit: commit,
    liveMode: false, realPaymentsAttempted: 0, consecutivePasses: 5, declinedCardRejected: true, cleanupConfirmed: true,
    results: [1, 2, 3, 4, 5].map(cycle => ({ cycle, afterTrial: 'paused', afterCard: 'active', renewalPaid: true, cancellation: true, afterCancellation: 'canceled' })) };
  assert.equal(proof.stripeProviderPassed(value, commit), true);
  for (const change of [{ cleanupConfirmed: false }, { releaseCommit: 'b'.repeat(40) }, { liveMode: true }, { realPaymentsAttempted: 1 }]) assert.equal(proof.stripeProviderPassed({ ...value, ...change }, commit), false);
});

test('independent recovery reconciliation matches source evidence and drops unrelated payload fields', () => {
  const { normalizeRestore } = require('../scripts/record-independent-recovery-evidence');
  const now = Date.parse('2026-10-30T22:00:00Z');
  const at = delta => new Date(now + delta).toISOString();
  const id = '12345678-1234-4abc-8abc-123456789abc';
  const source = { release: commit, databaseId: 'dpg-fixture-a', serviceId: 'srv-fixture', deploy: 'dep-fixture' };
  const restore = { ok: true, testedAt: at(-2000), checksumVerified: true, archiveReadable: true, restored: true,
    restoreElapsedMs: 1000, snapshotCreatedAt: at(-10000), tableCounts: { Fixture: 2 }, tablesVerified: 1,
    constraintsValidated: true, productionDatabaseModified: false, applicationWorkersStarted: false, providerDispatches: 0,
    backupMode: 'production-logical-export', integrity: { indexesValid: true, sequencesAheadOfRecordedIds: true,
      sequencesVerified: 1, tenantRelationships: 'verified_aggregate_checks' }, unrelatedPayload: 'DO_NOT_COPY' };
  const summary = { status: 'FRESH_PRODUCTION_LOGICAL_BACKUP_RESTORED_AND_VALIDATED_LOCALLY', source, executionId: id,
    recordedAt: at(0), backupCreatedAt: at(-10000), encryptedArchiveSha256: 'b'.repeat(64), encryptedBytes: 100,
    restored: { tables: 1, rows: 2, constraintsValidated: true, indexesValidated: true, sequencesVerified: 1,
      aggregateLeadBusinessAndCallerRelationshipsVerified: true, providerCallIdentityUniquenessVerified: true },
    seal: { localFixedNtfsVolumeVerified: true, privateAclApplied: true, listener: 'loopback only',
      emptyTargetTicketAndSystemIdentifierVerified: true, childEnvironmentExcludesProductionDatabaseAndProviderCredentials: true,
      applicationWorkersStarted: 0, foreignOrUnreviewedExecutableArchiveSchemaObjectsRejected: true },
    production: { readyBeforeAndAfter: true, configurationFingerprintUnchanged: true, businessDataWritesByThisWorkflow: 0,
      configurationChanges: 0, connectionAllowlistChanges: 0, productionRestoreOrCutover: 0, applicationWorkerActivation: 0, callsOrTextsInitiated: 0 },
    cleanup: { localPostgresStoppedAndTargetRemoved: true, privateArchiveAndToolchainDirectoryRemoved: true, plaintextRetained: false, encryptedLocalArchiveRetained: false } };
  const health = { ready: true, release: commit, deploy: source.deploy, configurationFingerprint: 'c'.repeat(64) };
  const execution = { status: 'verified_database_restore', phase: 'completed', source, executionId: id, restore,
    backup: { sha256: 'b'.repeat(64), encrypted: true, bytes: 100, sourceCreatedAt: at(-10000) },
    preflight: { ...health, checkedAt: at(-3000) }, postflight: { ...health, checkedAt: at(-1000) },
    productionBusinessWrites: 0, productionConfigurationChanges: 0, productionRestores: 0,
    providerCallsOrTexts: 0, applicationWorkersStarted: 0, privateCustodyCleaned: true };
  const result = normalizeRestore(summary, execution, commit, { now });
  assert.equal(proof.logicalRestorePassed(result, commit), true);
  assert.equal(result.schemaSqlReviewed, false);
  assert.equal(result.archiveObjectPolicyPassed, false);
  assert.equal(result.fullApplicationRecoveryProven, false);
  assert.equal(result.checkedAt, restore.testedAt);
  assert.equal(result.evidenceReviewedAt, summary.recordedAt);
  assert.equal(JSON.stringify(result).includes('DO_NOT_COPY'), false);
  const nestedAge = normalizeRestore(summary, { ...execution, restore: { ...restore, snapshotAgeSeconds: { unrelatedPayload: 'DO_NOT_COPY' } } }, commit, { now });
  assert.equal(typeof nestedAge.snapshotAgeSeconds, 'number');
  assert.equal(JSON.stringify(nestedAge).includes('DO_NOT_COPY'), false);
  assert.throws(() => normalizeRestore({ ...summary, cleanup: { ...summary.cleanup,
    encryptedLocalArchiveRetained: { unrelatedPayload: 'DO_NOT_COPY' } } }, execution, commit, { now }));
  const oldAt = delta => new Date(now - 8 * 86400000 + delta).toISOString();
  const oldSummary = { ...summary, backupCreatedAt: oldAt(-10000) };
  const oldExecution = { ...execution, backup: { ...execution.backup, sourceCreatedAt: oldAt(-10000) },
    restore: { ...restore, testedAt: oldAt(-2000), snapshotCreatedAt: oldAt(-10000) },
    preflight: { ...health, checkedAt: oldAt(-3000) }, postflight: { ...health, checkedAt: oldAt(-1000) } };
  assert.throws(() => normalizeRestore(oldSummary, oldExecution, commit, { now }), /stale|ordering/);
  for (const change of [{ executionId: 'other' }, { encryptedArchiveSha256: 'd'.repeat(64) },
    { recordedAt: at(60000) }, { restored: { ...summary.restored, rows: 3 } },
    { seal: { ...summary.seal, listener: 'remote' } }, { production: { ...summary.production, callsOrTextsInitiated: 1 } }]) {
    assert.throws(() => normalizeRestore({ ...summary, ...change }, execution, commit, { now }));
  }
});
