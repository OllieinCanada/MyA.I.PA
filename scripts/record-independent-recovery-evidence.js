// Reconcile already completed, reviewed sanitized evidence. No provider/data operations.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { logicalRestorePassed } = require('./launch-evidence');
function normalizeRestore(summary, execution, commit, { now = Date.now() } = {}) {
  function requireProof(condition, message) { if (!condition) throw Error(message); }
  requireProof(summary?.status === 'FRESH_PRODUCTION_LOGICAL_BACKUP_RESTORED_AND_VALIDATED_LOCALLY'
    && execution?.status === 'verified_database_restore' && execution.phase === 'completed' && !execution.error,
  'Both source records must describe a completed successful independent restoration');
  requireProof(/^[a-f0-9]{40}$/.test(commit || '') && summary.source?.release === commit
    && execution.source?.release === commit && summary.executionId === execution.executionId
    && ['databaseId', 'serviceId', 'deploy'].every(key => summary.source[key] && summary.source[key] === execution.source[key]),
  'Independent evidence has a mismatched release, execution, database, service or deployment');
  requireProof(['databaseId', 'serviceId', 'deploy'].every(key => typeof summary.source[key] === 'string')
    && typeof summary.executionId === 'string' && typeof summary.encryptedArchiveSha256 === 'string'
    && /^dpg-[a-z0-9-]+$/.test(summary.source.databaseId) && /^srv-[a-z0-9]+$/.test(summary.source.serviceId)
    && /^dep-[a-z0-9]+$/.test(summary.source.deploy), 'Independent source resource identifiers are invalid');
  const restore = execution.restore, seal = summary.seal, production = summary.production;
  const sum = Object.values(restore?.tableCounts || {}).reduce((total, count) => total + count, 0);
  requireProof(summary.encryptedArchiveSha256 === execution.backup?.sha256 && execution.backup.encrypted === true
    && summary.encryptedBytes === execution.backup.bytes && summary.encryptedBytes > 0
    && Date.parse(summary.backupCreatedAt) === Date.parse(execution.backup.sourceCreatedAt)
    && Date.parse(summary.backupCreatedAt) === Date.parse(restore?.snapshotCreatedAt), 'Independent backup digest, size or snapshot does not match');
  requireProof(summary.restored?.tables === restore.tablesVerified && summary.restored.rows === sum
    && summary.restored.constraintsValidated === true && summary.restored.indexesValidated === true
    && restore.integrity?.indexesValid === true && restore.integrity.sequencesAheadOfRecordedIds === true
    && summary.restored.sequencesVerified === restore.integrity.sequencesVerified
    && restore.integrity.tenantRelationships === 'verified_aggregate_checks'
    && summary.restored.aggregateLeadBusinessAndCallerRelationshipsVerified === true
    && summary.restored.providerCallIdentityUniquenessVerified === true, 'Independent count or integrity checks are incomplete');
  requireProof(seal?.localFixedNtfsVolumeVerified === true && seal.privateAclApplied === true && seal.listener === 'loopback only'
    && seal.emptyTargetTicketAndSystemIdentifierVerified === true
    && seal.childEnvironmentExcludesProductionDatabaseAndProviderCredentials === true && seal.applicationWorkersStarted === 0
    && seal.foreignOrUnreviewedExecutableArchiveSchemaObjectsRejected === true, 'Independent restore isolation/object-policy proof is incomplete');
  requireProof(production?.readyBeforeAndAfter === true && production.configurationFingerprintUnchanged === true
    && ['businessDataWritesByThisWorkflow', 'configurationChanges', 'connectionAllowlistChanges', 'productionRestoreOrCutover', 'applicationWorkerActivation', 'callsOrTextsInitiated'].every(key => production[key] === 0)
    && ['productionBusinessWrites', 'productionConfigurationChanges', 'productionRestores', 'providerCallsOrTexts', 'applicationWorkersStarted'].every(key => execution[key] === 0), 'Independent restoration touched production or lacks no-dispatch evidence');
  const pre = execution.preflight, post = execution.postflight;
  requireProof(pre?.ready === true && post?.ready === true && pre.release === commit && post.release === commit
    && pre.deploy === summary.source.deploy && post.deploy === summary.source.deploy
    && /^[a-f0-9]{64}$/.test(pre.configurationFingerprint || '') && pre.configurationFingerprint === post.configurationFingerprint,
  'Independent before/after identity or configuration is unconfirmed');
  const checkedAt = Date.parse(summary.recordedAt), testedAt = Date.parse(restore.testedAt);
  requireProof([checkedAt, testedAt].every(Number.isFinite) && checkedAt <= now + 5000 && now - checkedAt <= 24 * 3600000
    && testedAt <= now + 5000 && now - testedAt <= 24 * 3600000
    && Date.parse(pre.checkedAt) <= testedAt && testedAt <= Date.parse(post.checkedAt) && Date.parse(post.checkedAt) <= checkedAt,
  'Independent evidence is stale, future-dated or has inconsistent check ordering');
  requireProof(execution.privateCustodyCleaned === true && summary.cleanup?.localPostgresStoppedAndTargetRemoved === true
    && summary.cleanup.privateArchiveAndToolchainDirectoryRemoved === true && summary.cleanup.plaintextRetained === false
    && typeof summary.cleanup.encryptedLocalArchiveRetained === 'boolean',
  'Independent temporary-target cleanup is unconfirmed');
  const safeRestore = Object.fromEntries(['ok', 'testedAt', 'checksumVerified', 'archiveReadable', 'restored', 'restoreElapsedMs',
    'tableCounts', 'tablesVerified', 'constraintsValidated',
    'productionDatabaseModified', 'applicationWorkersStarted', 'providerDispatches', 'backupMode'].map(key => [key, restore[key]]));
  requireProof(Object.keys(restore.tableCounts || {}).every(name => /^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(name)), 'Unexpected table identifiers cannot be copied into sanitized evidence');
  const snapshotAt = Date.parse(summary.backupCreatedAt);
  requireProof(Number.isFinite(snapshotAt) && snapshotAt <= testedAt, 'Independent backup snapshot time is unconfirmed');
  const result = { ...safeRestore, testedAt: new Date(testedAt).toISOString(), snapshotCreatedAt: new Date(snapshotAt).toISOString(),
    snapshotAgeSeconds: Math.floor((testedAt - snapshotAt) / 1000),
    scope: 'logical-database-only', checkedAt: new Date(testedAt).toISOString(), evidenceReviewedAt: new Date(checkedAt).toISOString(), ready: true,
    releaseCommit: commit, executionId: summary.executionId, artifactSha256: summary.encryptedArchiveSha256,
    sourceDatabaseId: summary.source.databaseId, sourceServiceId: summary.source.serviceId,
    archiveTocScreenPassed: seal.foreignOrUnreviewedExecutableArchiveSchemaObjectsRejected,
    schemaSqlReviewed: false, archiveObjectPolicyPassed: false,
    archiveReviewLimitation: 'Independent execution recorded a TOC object screen, not a complete schema SQL review or an OS/network sandbox.',
    evidenceOrigin: 'reviewed-independent-sanitized-records', fullApplicationRecoveryProven: false,
    diskStateCovered: false, keyCustodyVerified: false, encryptedLocalArchiveRetained: summary.cleanup.encryptedLocalArchiveRetained,
    exactTransactionSnapshotCutoffKnown: summary.measurements?.exactTransactionSnapshotCutoffKnown === true };
  requireProof(logicalRestorePassed(result, commit), 'Independent restoration does not satisfy the logical-only evidence contract');
  return result;
}
function main(args = process.argv.slice(2)) {
  const value = name => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  if (value('confirm') !== 'RECORD_REVIEWED_LOGICAL_RESTORE') throw Error('Explicit reviewed-evidence recording confirmation required');
  if (!value('summary') || !value('execution') || !value('out-dir')) throw Error('Summary, execution and a new output directory are required');
  const summary = fs.readFileSync(value('summary'), 'utf8'), execution = fs.readFileSync(value('execution'), 'utf8');
  const result = normalizeRestore(JSON.parse(summary), JSON.parse(execution), value('commit'));
  result.sourceEvidenceSha256 = { summary: crypto.createHash('sha256').update(summary).digest('hex'), execution: crypto.createHash('sha256').update(execution).digest('hex') };
  const directory = path.resolve(value('out-dir'));
  fs.mkdirSync(directory, { mode: 0o700 });
  fs.writeFileSync(path.join(directory, 'restore.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ recorded: true, executionId: result.executionId, scope: result.scope,
    fullApplicationRecoveryProven: false, productionRequests: 0, backupDownloads: 0, restores: 0 }));
}
if (require.main === module) { try { main(); } catch (error) { console.error('Evidence reconciliation blocked: ' + error.message); process.exitCode = 1; } }
module.exports = { normalizeRestore, main };
