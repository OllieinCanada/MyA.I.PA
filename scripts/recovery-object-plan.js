// Pure attachment planning; no client, key loading, upload or deletion capability.
const { REQUIRED_FILES } = require('./recovery-isolation-contract');
const { ensure, object, timestamp, SHA, COMMIT, LABEL, UUID } = require('./recovery-metadata');
const { validatePolicy } = require('./approved-recovery-policy');
function objectPlan(manifest, target, { now = Date.now(), preparationPolicy } = {}) {
  const policy = validatePolicy(preparationPolicy);
  object(target, ['provider','repository','repositoryId','private','actionsEnabled','executionMode']);
  ensure(target.provider === 'github-private-release' && target.repository === policy.github.repository && target.repositoryId === policy.github.repositoryId
    && target.private === true && target.actionsEnabled === false && target.executionMode === 'manual-local', 'EXACT_FREE_PRIVATE_GITHUB_TARGET_REQUIRED');
  object(manifest, ['schemaVersion','scope','releaseCommit','executionId','bundleSha256','bundleBytes','recoveryPointAt','databaseAndFilesCoherent','keyCustodyVerified','privacyReplayReady','artifacts']);
  ensure(manifest.schemaVersion === 1 && manifest.scope === 'synthetic-coherent-recovery' && typeof manifest.executionId === 'string' && UUID.test(manifest.executionId)
    && typeof manifest.releaseCommit === 'string' && COMMIT.test(manifest.releaseCommit) && manifest.releaseCommit === policy.reviewedApplicationRelease
    && typeof manifest.bundleSha256 === 'string' && SHA.test(manifest.bundleSha256), 'EXACT_SYNTHETIC_RECOVERY_BUNDLE_REQUIRED');
  ensure(timestamp(manifest.recoveryPointAt) && Date.parse(manifest.recoveryPointAt) <= now + 5000 && now - Date.parse(manifest.recoveryPointAt) <= 3600000, 'FRESH_COHERENT_RECOVERY_POINT_REQUIRED');
  ensure(manifest.databaseAndFilesCoherent === true && manifest.keyCustodyVerified === true && manifest.privacyReplayReady === true, 'COMPLETE_RECOVERY_SET_REQUIRED');
  ensure(Array.isArray(manifest.artifacts) && manifest.artifacts.length === 5 && new Set(manifest.artifacts.map(x => x?.role)).size === 5
    && ['database',...REQUIRED_FILES].every(role => manifest.artifacts.some(x => x.role === role)), 'EXACT_FIVE_ARTIFACTS_REQUIRED');
  let totalBytes = 0;
  for (const item of manifest.artifacts) {
    object(item, ['role','sha256','bytes','encryptionCipher','authenticatedEncryptionVerified','keyVersionId','keyReference']);
    ensure(typeof item.sha256 === 'string' && SHA.test(item.sha256) && Number.isSafeInteger(item.bytes) && item.bytes > 0
      && item.encryptionCipher === 'aes-256-gcm' && item.authenticatedEncryptionVerified === true
      && typeof item.keyVersionId === 'string' && LABEL.test(item.keyVersionId) && typeof item.keyReference === 'string' && LABEL.test(item.keyReference), 'ENCRYPTED_ARTIFACT_METADATA_REQUIRED');
    totalBytes += item.bytes;
  }
  ensure(Number.isSafeInteger(manifest.bundleBytes) && manifest.bundleBytes > 0 && totalBytes <= manifest.bundleBytes && manifest.bundleBytes <= policy.retention.maxBundleBytes, 'BOUNDED_COMPOSITE_BUNDLE_REQUIRED');
  return { mode:'plan-only', scope:manifest.scope, repository:target.repository, repositoryId:target.repositoryId,
    releaseTag:'synthetic-'+manifest.executionId, createUniqueReleaseRequired:true, existingReleaseOrAssetReplacementAllowed:false,
    attachments:[{name:'recovery.bundle',sha256:manifest.bundleSha256,bytes:manifest.bundleBytes}], sanitizedReceiptRequired:true,
    fileCount:4, artifactFilesMustBeRevalidatedBeforeTransfer:true, privateRepositoryMustBeReverifiedBeforeTransfer:true,
    releaseInventoryAndStorageBudgetMustBeRevalidated:true, maxSyntheticReleases:policy.retention.maxSyntheticReleases, maxTotalSyntheticAssetBytes:policy.retention.maxTotalSyntheticAssetBytes,
    hostedActionsAllowed:false, productionUploadAllowed:false, automaticDeletionAllowed:false, remoteRequests:0 };
}
module.exports = { objectPlan };
