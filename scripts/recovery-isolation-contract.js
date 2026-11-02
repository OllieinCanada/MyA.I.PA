// Metadata validation only. No provider, database, file-copy or secret-loading capability.
const crypto = require('node:crypto');
const path = require('node:path');
const REQUIRED_FILES = Object.freeze(['pending-stripe-signups.json', 'trial-reminders.json', 'signup-dashboard.json', 'vapi-call-sync.json']);
const DATA_KEYS = Object.freeze(['BACKUP_ENCRYPTION_KEY', 'CALENDAR_TOKEN_ENCRYPTION_KEY']);
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const requireProof = (condition, code) => { if (!condition) throw Object.assign(new Error(code), { code }); };
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const label = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
function keys(value, allowed) {
  requireProof(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => allowed.includes(key)), 'UNREVIEWED_METADATA_FIELD');
}
function validateRecoverySet(value, { now = Date.now() } = {}) {
  keys(value, ['schemaVersion','scope','generation','releaseCommit','capturedAt','fence','database','files','keys','privacyReplay']);
  requireProof(value.schemaVersion === 1 && value.scope === 'synthetic-contract-only' && label(value.generation) && typeof value.releaseCommit === 'string' && /^[a-f0-9]{40}$/.test(value.releaseCommit || ''), 'RECOVERY_IDENTITY_REQUIRED');
  const at = Date.parse(value.capturedAt);
  requireProof(typeof value.capturedAt === 'string' && Number.isFinite(at) && at <= now + 5000 && now - at <= 3600000, 'STALE_RECOVERY_SET');
  keys(value.fence, ['id','allWritersHeld','inFlightWorkDrained','noDispatch','scope']);
  requireProof(label(value.fence.id) && value.fence.allWritersHeld === true && value.fence.inFlightWorkDrained === true && value.fence.noDispatch === true && value.fence.scope === 'synthetic-fixture', 'COHERENT_WRITE_FENCE_REQUIRED');
  keys(value.database, ['sha256','generation','fenceId','boundaryId','encrypted']);
  requireProof(sha(value.database.sha256) && value.database.generation === value.generation && value.database.fenceId === value.fence.id && label(value.database.boundaryId) && value.database.encrypted === true, 'DATABASE_BOUNDARY_MISMATCH');
  requireProof(Array.isArray(value.files) && value.files.length === REQUIRED_FILES.length, 'REQUIRED_FILE_SET_MISSING');
  requireProof(new Set(value.files.map(item => item.name)).size === REQUIRED_FILES.length, 'DUPLICATE_FILE');
  for (const item of value.files) {
    keys(item, ['name','sha256','bytes','generation','fenceId','boundaryId','jsonValidated','encrypted']);
    requireProof(REQUIRED_FILES.includes(item.name) && sha(item.sha256) && Number.isSafeInteger(item.bytes) && item.bytes > 0 && item.jsonValidated === true && item.encrypted === true, 'FILE_INTEGRITY_REQUIRED');
    requireProof(item.generation === value.generation && item.fenceId === value.fence.id && item.boundaryId === value.database.boundaryId, 'MIXED_DATABASE_FILE_GENERATION');
  }
  requireProof(Array.isArray(value.keys) && value.keys.length === 3, 'KEY_CUSTODY_REQUIRED');
  const names = value.keys.map(item => item.name);
  requireProof(new Set(names).size === 3 && DATA_KEYS.every(name => names.includes(name)) && names.includes('FIELD_SERVICE_TOKEN_ENCRYPTION_KEY'), 'KEY_SET_INCOMPLETE');
  for (const item of value.keys) {
    keys(item, ['name','versionId','custodyReference','retrievedOutsideService','ciphertextProbePassed','fallbackTo']);
    requireProof(label(item.versionId) && label(item.custodyReference) && item.retrievedOutsideService === true && item.ciphertextProbePassed === true, 'KEY_RETRIEVAL_PROOF_REQUIRED');
    requireProof(!item.fallbackTo || (item.name === 'FIELD_SERVICE_TOKEN_ENCRYPTION_KEY' && item.fallbackTo === 'CALENDAR_TOKEN_ENCRYPTION_KEY'), 'KEY_FALLBACK_UNREVIEWED');
  }
  keys(value.privacyReplay, ['boundaryId','journalThrough','applied','scope']);
  requireProof(value.privacyReplay.boundaryId === value.database.boundaryId && label(value.privacyReplay.journalThrough) && value.privacyReplay.applied === true && value.privacyReplay.scope === 'synthetic-fixture-only', 'PRIVACY_REPLAY_REQUIRED');
  return { contractPassed: true, scope: value.scope, productionRecoveryProven: false, fileCount: REQUIRED_FILES.length, keyCount: value.keys.length };
}
function syntheticEnvironment(parent, dataDir) {
  // Never spread the caller's environment or load a local env file.
  const inherited = Object.fromEntries(['PATH','SystemRoot','LOCALAPPDATA','USERDOMAIN','USERNAME','TEMP','TMP','NODE_PATH'].filter(key => parent[key] !== undefined).map(key => [key,parent[key]]));
  return { ...inherited, NODE_ENV:'test', APP_ENV:'staging', DISABLE_LOCAL_ENV_FILES:'1', DATA_DIR:dataDir, DATABASE_URL:'', SECURITY_STATE_FORCE_DATABASE:'false',
    INTAKE_LEDGER_MODE:'staging', STAGING_INTAKE_BUSINESS_ID:'701', STAGING_INTAKE_ASSISTANT_ID:'fixture-isolation-assistant', STAGING_INTAKE_WORKER_ENABLED:'false',
    JWT_SECRET:'fixture-only-jwt-secret-32-characters', ADMIN_SESSION_SECRET:'fixture-only-admin-secret-32-characters', VAPI_WEBHOOK_SECRET:'fixture-only-webhook-secret', VAPI_REQUIRE_BUSINESS_MAPPING:'true',
    SIGNUP_SETUP_WORKER_PAUSED:'true', TRIAL_REMINDER_DISABLE:'true', VAPI_AUTO_SYNC_ENABLED:'false', TRIAL_USAGE_LIMIT_ENABLED:'false', MISSED_CALL_ALERT_ENABLED:'false', DAILY_DIGEST_ENABLED:'false' };
}
function validateSyntheticTarget({ root, dataDir, recoveryRoot, databaseKind, env }) {
  const absolute = input => path.resolve(input).toLowerCase();
  const within = (child, parent) => child === parent || child.startsWith(parent + path.sep);
  requireProof(databaseKind === 'synthetic-transactional-double' && env.DATABASE_URL === '' && env.APP_ENV === 'staging' && env.DISABLE_LOCAL_ENV_FILES === '1', 'SYNTHETIC_TARGET_REQUIRED');
  requireProof(within(absolute(dataDir), absolute(root)) && absolute(dataDir) !== absolute(root) && !within(absolute(dataDir),absolute(recoveryRoot)) && !within(absolute(recoveryRoot),absolute(dataDir)), 'RECOVERY_STAGING_PATH_OVERLAP');
  requireProof(env.STAGING_INTAKE_WORKER_ENABLED === 'false' && env.SIGNUP_SETUP_WORKER_PAUSED === 'true', 'WORKERS_MUST_STAY_DISABLED');
  const forbidden = Object.keys(env).filter(key => /^(?:RENDER_|TWILIO_|STRIPE_|TELEGRAM_|SMTP_|MAKE_|OPENAI_|GOOGLE_|MICROSOFT_|FIELD_SERVICE_|CALENDAR_|BACKUP_)/.test(key) || ['VAPI_API_KEY','NODE_OPTIONS','OPERATIONS_ENV_FILE'].includes(key));
  requireProof(forbidden.length === 0, 'PRODUCTION_OR_PROVIDER_CONFIGURATION_PRESENT');
  return { scope:'local-application-with-synthetic-database-double', productionDataAllowed:false, providerDispatchAllowed:false, osSandboxProven:false };
}
function assessRecoveryTelemetry(facts, policy, now = Date.now()) {
  keys(facts,['backupCompletedAt','restoreTestedAt','filesCovered','custodyTested','coherenceProven','diskUsedBytes','diskCapacityBytes','alertReceiptConfirmed']);
  keys(policy,['ownerApproved','maxBackupAgeHours','maxRestoreAgeHours','maxDiskUsedFraction']);
  requireProof(policy.ownerApproved === true && Number.isFinite(policy.maxBackupAgeHours) && policy.maxBackupAgeHours > 0 && Number.isFinite(policy.maxRestoreAgeHours) && policy.maxRestoreAgeHours > 0 && Number.isFinite(policy.maxDiskUsedFraction) && policy.maxDiskUsedFraction > 0 && policy.maxDiskUsedFraction < 1, 'OWNER_MONITOR_POLICY_REQUIRED');
  const failures = [];
  const fresh = (at,hours) => typeof at === 'string' && Number.isFinite(Date.parse(at)) && Date.parse(at) <= now && now - Date.parse(at) <= hours * 3600000;
  if (!fresh(facts.backupCompletedAt,policy.maxBackupAgeHours)) failures.push('BACKUP_MISSING_OR_STALE');
  if (!fresh(facts.restoreTestedAt,policy.maxRestoreAgeHours)) failures.push('RESTORE_PROOF_MISSING_OR_STALE');
  for (const [key,code] of [['filesCovered','FILE_COVERAGE_UNKNOWN'],['custodyTested','KEY_CUSTODY_UNPROVEN'],['coherenceProven','COHERENCE_UNPROVEN'],['alertReceiptConfirmed','ALERT_RECEIPT_UNPROVEN']]) if (facts[key] !== true) failures.push(code);
  if (!(Number.isSafeInteger(facts.diskUsedBytes) && facts.diskUsedBytes >= 0 && Number.isSafeInteger(facts.diskCapacityBytes) && facts.diskCapacityBytes > 0 && facts.diskUsedBytes <= facts.diskCapacityBytes && facts.diskUsedBytes/facts.diskCapacityBytes < policy.maxDiskUsedFraction)) failures.push('DISK_HEADROOM_UNKNOWN_OR_LOW');
  return { ready:failures.length === 0, failures, scope:'supplied-metadata-policy-check-only', liveMonitorInstalled:false };
}
module.exports = { REQUIRED_FILES, DATA_KEYS, digest, validateRecoverySet, syntheticEnvironment, validateSyntheticTarget, assessRecoveryTelemetry };
