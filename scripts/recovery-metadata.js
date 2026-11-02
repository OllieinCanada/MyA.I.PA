'use strict';
// Pure metadata checks. This module never reads a key, vault, file, provider or environment.
const crypto = require('node:crypto');
const SHA = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const LABEL = /^[a-zA-Z0-9_-]{1,100}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
function ensure(condition, code) { if (!condition) throw Error(code); }
function object(value, allowed, required = allowed) {
  ensure(value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).every(key => allowed.includes(key))
    && required.every(key => Object.hasOwn(value, key)), 'SANITIZED_METADATA_FIELDS_REQUIRED');
}
function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)) return false;
  const at = Date.parse(value);
  return Number.isFinite(at) && new Date(at).toISOString() === value;
}
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const KEY_NAMES = Object.freeze(['RECOVERY_ARCHIVE_PRIVATE_KEY','BACKUP_ENCRYPTION_KEY','CALENDAR_TOKEN_ENCRYPTION_KEY','FIELD_SERVICE_TOKEN_ENCRYPTION_KEY']);
function custodyPreflight(value, { releaseCommit, now = Date.now() } = {}) {
  object(value, ['scope','releaseCommit','vault','offline','keys','probe']);
  ensure(value.scope === 'custody-metadata-only' && typeof releaseCommit === 'string' && typeof value.releaseCommit === 'string' && COMMIT.test(releaseCommit) && value.releaseCommit === releaseCommit, 'EXACT_RELEASE_CUSTODY_METADATA_REQUIRED');
  object(value.vault, ['provider','ownerAccessConfirmed','mfaRecoveryRecorded']);
  ensure(value.vault.provider === 'bitwarden-free' && [value.vault.ownerAccessConfirmed,value.vault.mfaRecoveryRecorded].every(x => typeof x === 'boolean'), 'FREE_VAULT_METADATA_REQUIRED');
  object(value.offline, ['format','copyOnSeparateDevice','passwordAvailableOutsideVault','reimportTestPassed']);
  ensure(value.offline.format === 'password-protected-json' && [value.offline.copyOnSeparateDevice,value.offline.passwordAvailableOutsideVault,value.offline.reimportTestPassed].every(x => typeof x === 'boolean'), 'PORTABLE_OFFLINE_EXPORT_METADATA_REQUIRED');
  ensure(Array.isArray(value.keys) && value.keys.length <= KEY_NAMES.length, 'KEY_REFERENCE_INVENTORY_REQUIRED');
  ensure(new Set(value.keys.map(x => x?.name)).size === value.keys.length, 'DUPLICATE_KEY_REFERENCE');
  for (const key of value.keys) {
    object(key, ['name','versionId','custodyReference','effectiveSource','publicKeyFingerprint']);
    ensure(KEY_NAMES.includes(key.name) && (key.versionId === null || (typeof key.versionId === 'string' && LABEL.test(key.versionId)))
      && (key.custodyReference === null || (typeof key.custodyReference === 'string' && LABEL.test(key.custodyReference))), 'KEY_REFERENCE_METADATA_REQUIRED');
    ensure(key.effectiveSource === key.name || (key.name === 'FIELD_SERVICE_TOKEN_ENCRYPTION_KEY' && key.effectiveSource === 'CALENDAR_TOKEN_ENCRYPTION_KEY'), 'UNREVIEWED_KEY_FALLBACK');
    ensure(key.name === 'RECOVERY_ARCHIVE_PRIVATE_KEY' ? (key.publicKeyFingerprint === null || (typeof key.publicKeyFingerprint === 'string' && SHA.test(key.publicKeyFingerprint))) : key.publicKeyFingerprint === null, 'ONLY_ARCHIVE_PUBLIC_KEY_FINGERPRINT_ALLOWED');
    if (key.effectiveSource !== key.name) {
      const source = value.keys.find(k => k.name === key.effectiveSource);
      ensure(source && source.versionId === key.versionId && source.custodyReference === key.custodyReference, 'KEY_FALLBACK_VERSION_MISMATCH');
    }
  }
  const missing = [];
  for (const [condition, code] of [[value.vault.ownerAccessConfirmed,'VAULT_OWNER_ACCESS_UNTESTED'],[value.vault.mfaRecoveryRecorded,'VAULT_MFA_RECOVERY_UNRECORDED'],[value.offline.copyOnSeparateDevice,'INDEPENDENT_OFFLINE_COPY_MISSING'],[value.offline.passwordAvailableOutsideVault,'OFFLINE_PASSWORD_DEPENDS_ON_VAULT'],[value.offline.reimportTestPassed,'OFFLINE_EXPORT_REIMPORT_UNTESTED']]) if (!condition) missing.push(code);
  for (const name of KEY_NAMES) {
    const key = value.keys.find(k => k.name === name);
    if (!key?.versionId || !key.custodyReference || (name === 'RECOVERY_ARCHIVE_PRIVATE_KEY' && !key.publicKeyFingerprint)) missing.push('KEY_REFERENCE_INCOMPLETE:' + name);
  }
  if (value.probe === null) missing.push('FRESH_SYNTHETIC_CUSTODY_PROBE_MISSING');
  else {
    const p = value.probe;
    object(p, ['scope','executionId','releaseCommit','testedAt','archiveKeyVersionId','publicKeyFingerprint','vaultRetrievalPassed','offlineRetrievalPassed']);
    const archive = value.keys.find(k => k.name === 'RECOVERY_ARCHIVE_PRIVATE_KEY');
    ensure(p.scope === 'synthetic-only' && typeof p.executionId === 'string' && UUID.test(p.executionId) && p.releaseCommit === releaseCommit && timestamp(p.testedAt)
      && p.archiveKeyVersionId === archive?.versionId && p.publicKeyFingerprint === archive?.publicKeyFingerprint
      && [p.vaultRetrievalPassed,p.offlineRetrievalPassed].every(x => typeof x === 'boolean'), 'EXACT_SYNTHETIC_CUSTODY_PROBE_REQUIRED');
    if (Date.parse(p.testedAt) > now + 5000 || now - Date.parse(p.testedAt) > 24*3600000 || !p.vaultRetrievalPassed || !p.offlineRetrievalPassed) missing.push('FRESH_SYNTHETIC_CUSTODY_PROBE_MISSING');
  }
  return { scope:'supplied-custody-metadata-only', metadataReady:missing.length===0, missing, metadataSha256:digest(value),
    productionKeyCustodyProven:false, productionExecutionAllowed:false, vaultRequests:0, keysLoaded:0 };
}
module.exports = { SHA, COMMIT, LABEL, UUID, KEY_NAMES, ensure, object, timestamp, digest, custodyPreflight };
