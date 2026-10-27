const fs = require('node:fs');
const path = require('node:path');
const { assertFreshHealth, fingerprintFiles, recordGate, writeManifest } = require('./provider-hardening-evidence');
const CHAIN_SOURCES = ['server/index.js', 'server/provisioningState.js', 'server/twilioStatusInbox.js', 'server/signupSmsDispatch.js',
  'server/intakeLedger.js', 'server/stagingIntake.js', 'server/stagingIntakeWorker.js', 'server/leadHandoffs.js'];
const RESTORE_SOURCES = ['scripts/backup-safety.js', 'scripts/restore-backup-drill.js', 'scripts/run-local-signup-postgres-drill.js', 'scripts/prepare-postgres-client-tools.js'];
function assertIntakeEvidence(report, changedAt) {
  const required = ['passed', 'concurrency', 'processRestart', 'latestConfirmedValuesOnly', 'crossTenantRejected', 'authenticationRequired',
    'staleAndLateUpdatesRejected', 'transactionRollbackVerified', 'legacyRetryOwnerSeparated', 'stagingQueueOwned', 'productionWorkerDenied'];
  if (required.some(key => report[key] !== true) || report.productionTouched !== false || report.realProviderRequests !== 0
    || report.canonicalRecordsForCompletedCall !== 1 || report.leadsForCompletedCall !== 1 || report.notificationHandoffs !== 1 || report.fakeProviderAcceptances !== 1
    || !Number.isFinite(changedAt) || !Number.isFinite(Date.parse(report.checkedAt)) || Date.parse(report.checkedAt) < changedAt) throw Error('Missing, stale or non-isolated intake evidence');
}
function main() {
  const root = path.resolve(__dirname, '..'), directory = path.join(root, 'diagnostics/provider-hardening');
  const read = name => JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
  const manifest = read('execution.json');
  assertFreshHealth(manifest);
  if (manifest.gates.restore?.status !== 'PASS' || manifest.gates.chain?.status !== 'PASS') throw Error('Restore and chain must pass before intake acceptance');
  if (manifest.gates.restore.codeIdentity !== fingerprintFiles(RESTORE_SOURCES) || manifest.gates.chain.codeIdentity !== fingerprintFiles(CHAIN_SOURCES)) throw Error('Code changed after prerequisite verification');
  const intake = read('intake.json');
  assertIntakeEvidence(intake, Math.max(Date.parse(manifest.gates.restore.checkedAt), ...CHAIN_SOURCES.map(file => fs.statSync(path.join(root, file)).mtimeMs)));
  recordGate(manifest, 'intake', { status: 'PASS', evidence: path.join(directory, 'intake.json'), prerequisites: ['health', 'restore', 'chain'],
    codeIdentity: fingerprintFiles(CHAIN_SOURCES), restrictions: ['Local staging drill only; default off and denied on the production service.',
      'Caller confirmation is a tool assertion until real voice behavior is tested.', 'Outbox delivery is explicitly driven by the isolated harness, not an activated production worker.'] });
  recordGate(manifest, 'liveCanary', { status: 'BLOCKED', evidence: path.join(directory, 'provider-resources.json'),
    prerequisites: ['health', 'funding', 'restore', 'chain', 'intake'], restrictions: [
      'Vapi credit balance, payment/recharge/renewal dashboards and dedicated staging resources/code parity remain unverified.',
      'No customer phone or assistant may be repurposed. No real SMS or call was sent.'] });
  recordGate(manifest, 'release', { status: 'BLOCKED', evidence: 'Local drill success is not approval to activate the live intake pilot.', prerequisites: ['health', 'funding', 'restore', 'chain', 'intake', 'liveCanary', 'observation'],
    restrictions: ['Full 24-hour observation has not been proven. External monitoring was explicitly deferred.',
      'This evidence alone does not authorize a push, merge, deployment or pilot activation; obtain explicit authorization for the actual release.'] });
  writeManifest(path.join(directory, 'execution.json'), manifest);
  const handoff = { checkedAt: new Date().toISOString(), executionId: manifest.executionId, baseReleaseCommit: manifest.releaseCommit,
    localSourceFingerprint: fingerprintFiles([...CHAIN_SOURCES, ...RESTORE_SOURCES]), gates: manifest.gates,
    completed: ['Repeated live security/receipt-worker checks and fully paginated filtered failure-log reads.',
      'GET-only funding and resource inventories; unknown payment settings not guessed.',
      'One Render logical backup export, encrypted locally, restored twice to disposable local PostgreSQL; 36 tables and constraints verified.',
      'Real PostgreSQL process-restart, duplicate and failure tests for signup provisioning, followed by authenticated staging intake HTTP tests.',
      'Versioned latest-confirmed intake, transactional final lead/outbox, duplicate rejection and separate retry ownership; disabled for production.'],
    notCompleted: ['Dashboard payment/renewal/recharge verification.', 'Dedicated live staging code/resource parity and real voice/SMS/call-forwarding canary.',
      '24-hour continuous observation, external monitoring and production rollout.'],
    effects: { scope: 'Isolated drills and read-only audit session; excludes later operator release actions.', productionBusinessWrites: 0, renderLogicalExportRequests: 1, realSmsSent: 0, realCallsPlaced: 0,
      purchasedNumbers: 0, assistantsCreatedAtProviders: 0, billingChanges: 0, pushes: 0, merges: 0, deployments: 0 },
    rollback: ['Keep INTAKE_LEDGER_MODE=off and APP_ENV=production; no Prisma schema migration was introduced.',
      'No production restore, customer-resource changes or payment changes require rollback.',
      'Preserve encrypted backup, export-request receipt and audit evidence. Do not repeat an uncertain backup-export request.',
      'A later approved release must rerun freshness and exact-source gates; these are point-in-time results, not permanent health certification.'],
    next: ['Obtain billing screenshots without secrets/full card details; confirm Vapi credits and all four renewal/recharge states.',
      'Approve or identify an existing dedicated staging phone/assistant and deploy exact local code there before the bounded real canary.',
      'Connect a staging outbox scheduler/reconciliation owner and verify real confirmation semantics before enabling this pilot outside the harness.',
      'Run the previously agreed bounded user-initiated canary only after prerequisites pass; do not automatically place outbound test calls.',
      'Complete a separately scheduled 24-hour observation, then request explicit release authorization.'] };
  writeManifest(path.join(directory, 'handoff.json'), handoff);
  console.log(JSON.stringify({ executionId: handoff.executionId, gates: Object.fromEntries(Object.entries(manifest.gates).map(([key, value]) => [key, value.status])), effects: handoff.effects }, null, 2));
}
if (require.main === module) { try { main(); } catch (error) { console.error('Handoff gate stopped: ' + error.message); process.exitCode = 1; } }
module.exports = { assertIntakeEvidence };
