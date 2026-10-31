const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { pipeline } = require('node:stream/promises');
const { Transform, Readable } = require('node:stream');
const { readRenderCredentials, fetchRenderEnv } = require('./run-with-render-env');
const { privateDirectory } = require('./backup-safety');
const { encryptBackup } = require('./database-backup');
const { recordGate, writeManifest, fingerprintFiles, assertFreshHealth } = require('./provider-hardening-evidence');
const { validatePlan, validateExecution, selectExactExport, restoreEnvironment } = require('./recovery-execution-plan');
const DATABASE = 'dpg-d924vjq8qa3s73crd29g-a';
async function main(args = process.argv.slice(2)) {
  const planPath = args.find(arg => arg.startsWith('--plan='))?.slice(7);
  if (!planPath) throw Error('An exact --plan is required. Default behavior is metadata validation only; no credentials are loaded');
  const plan = validatePlan(JSON.parse(fs.readFileSync(planPath, 'utf8')));
  if (plan.databaseId !== DATABASE || plan.serviceId !== 'srv-d92503a8qa3s73crdpog') throw Error('Recovery plan source does not match this runner');
  if (!args.includes('--execute')) {
    console.log(JSON.stringify({ planValid: true, executionId: plan.executionId, executionAuthorized: false, networkRequests: 0, downloads: 0, restores: 0 }));
    return;
  }
  if (!args.includes('--confirm=DOWNLOAD_ENCRYPTED_LOGICAL_BACKUP')) throw Error('Downloading personal information needs explicit execution confirmation');
  if (args.includes('--restore') && !args.includes('--confirm-restore=RESTORE_TO_DISPOSABLE_DATABASE')) throw Error('Disposable restore confirmation is separately required');
  const schemaReview = args.find(arg => arg.startsWith('--schema-review='))?.slice(16);
  if (args.includes('--restore') && !schemaReview) throw Error('A separate exact-archive --schema-review ticket is required; use the non-restore node command to download first if separately authorized');
  const directory = path.dirname(path.resolve(planPath));
  const manifestPath = path.join(directory, 'execution.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  validateExecution(plan, manifest);
  assertFreshHealth(manifest);
  // Check the live identity again immediately before reading backup credentials.
  const health = await fetch('https://api.myaipa.ca/api/health/ready', { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(20000) });
  const live = health.ok ? await health.json() : null;
  if (live?.ok !== true || live?.releaseCommit !== plan.releaseCommit) throw Error('Live release changed or readiness is unconfirmed; do not substitute another release');
  const credentials = readRenderCredentials();
  const env = await fetchRenderEnv({ credentials, serviceId: 'srv-d92503a8qa3s73crdpog', keys: ['BACKUP_ENCRYPTION_KEY'] });
  if (env.BACKUP_ENCRYPTION_KEY.length < 24) throw Error('Strong backup encryption key required');
  const artifactPath = path.join(directory, 'encrypted-backup-artifact.json');
  const receiptPath = path.join(directory, 'download-receipt.json');
  let artifact = fs.existsSync(artifactPath) ? JSON.parse(fs.readFileSync(artifactPath, 'utf8')) : null;
  if (artifact) {
    const receipt = fs.existsSync(receiptPath) ? JSON.parse(fs.readFileSync(receiptPath, 'utf8')) : null;
    if (receipt?.status !== 'download_completed' || receipt.executionId !== plan.executionId || receipt.planSha256 !== plan.sha256
      || artifact.executionId !== plan.executionId || artifact.planSha256 !== plan.sha256 || artifact.exportId !== plan.exportId
      || artifact.sourceDatabaseId !== plan.databaseId || artifact.releaseCommit !== plan.releaseCommit
      || Date.parse(artifact.snapshotCreatedAt) !== Date.parse(plan.exportCreatedAt)
      || !fs.existsSync(artifact.backupPath) || fs.statSync(artifact.backupPath).size !== artifact.encryptedBytes
      || crypto.createHash('sha256').update(fs.readFileSync(artifact.backupPath)).digest('hex') !== artifact.sha256) throw Error('Saved backup is not bound to this exact execution or failed checksum validation');
  }
  if (!artifact) {
    if (fs.existsSync(receiptPath)) throw Error('A download receipt already exists; uncertain operations are not repeated');
    const exportsResponse = await fetch(credentials.host + '/postgres/' + DATABASE + '/export', {
      method: 'GET', headers: { Authorization: 'Bearer ' + credentials.key }, redirect: 'error', signal: AbortSignal.timeout(20000) });
    if (!exportsResponse.ok) throw Error('Logical export inventory is unavailable');
    const exports = await exportsResponse.json();
    const { item, url } = selectExactExport(exports, plan);
    const privateWork = privateDirectory('myaipa-backup-drill-');
    const raw = path.join(privateWork, 'render-export.dir.tar.gz');
    try {
      const disk = fs.statfsSync(privateWork);
      if (Number(disk.bavail) * Number(disk.bsize) < 2 * 1024 * 1024 * 1024) throw Error('Private recovery volume needs at least 2 GiB free before download; do not raise the size limit or silently change volumes');
      const receipt = { executionId: plan.executionId, planSha256: plan.sha256, exportId: plan.exportId,
        status: 'download_started_outcome_unconfirmed', startedAt: new Date().toISOString() };
      fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      const response = await fetch(url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(180000) });
      if (!response.ok || !response.body) throw Error('Backup download failed');
      let bytes = 0;
      const limit = new Transform({ transform(chunk, encoding, callback) { bytes += chunk.length; callback(bytes > 512 * 1024 * 1024 ? Error('Backup exceeds local drill size limit') : null, chunk); } });
      await pipeline(Readable.fromWeb(response.body), limit, fs.createWriteStream(raw, { flags: 'wx', mode: 0o600 }));
      const encrypted = encryptBackup(raw, env.BACKUP_ENCRYPTION_KEY);
      const metadata = { schemaVersion: 1, createdAt: new Date().toISOString(), snapshotCreatedAt: item.createdAt,
        executionId: plan.executionId, planSha256: plan.sha256, exportId: plan.exportId, releaseCommit: plan.releaseCommit,
        sourceDatabaseId: DATABASE, archiveFormat: 'render-directory-tar', encrypted: true, encryption: encrypted.encryption,
        bytes: fs.statSync(encrypted.encryptedPath).size,
        sha256: crypto.createHash('sha256').update(fs.readFileSync(encrypted.encryptedPath)).digest('hex'), containsPersonalInformation: true };
      writeManifest(encrypted.encryptedPath + '.manifest.json', metadata);
      artifact = { backupPath: encrypted.encryptedPath, snapshotCreatedAt: item.createdAt, encryptedBytes: metadata.bytes,
        executionId: plan.executionId, planSha256: plan.sha256, exportId: plan.exportId, releaseCommit: plan.releaseCommit,
        sha256: metadata.sha256, sourceDatabaseId: DATABASE, downloadedAt: new Date().toISOString(), signedUrlsPersisted: false };
      writeManifest(artifactPath, artifact);
      writeManifest(receiptPath, { ...receipt, status: 'download_completed', completedAt: artifact.downloadedAt, sha256: artifact.sha256 });
    } finally { if (fs.existsSync(raw)) fs.rmSync(raw); }
  }
  console.log(JSON.stringify({ encryptedBackupSaved: true, snapshotCreatedAt: artifact.snapshotCreatedAt, bytes: artifact.encryptedBytes, signedUrlsPrinted: false }));
  if (!args.includes('--restore')) return;
  validateExecution(plan, manifest);
  const restoreReceiptPath = path.join(directory, 'restore-attempt.json');
  fs.writeFileSync(restoreReceiptPath, JSON.stringify({ executionId: plan.executionId, artifactSha256: artifact.sha256,
    status: 'restore_started_outcome_unconfirmed', startedAt: new Date().toISOString() }) + '\n', { flag: 'wx', mode: 0o600 });
  const restoreStartedAt = Date.now();
  const childEvidence = path.join(directory, 'restore-child.json');
  if (fs.existsSync(childEvidence)) throw Error('This execution already has child evidence; do not overwrite or reuse it');
  const result = spawnSync(process.execPath, [path.resolve(__dirname, 'run-local-signup-postgres-drill.js'), '--restore-backup=' + artifact.backupPath,
    '--restore-report=' + childEvidence], {
    cwd: path.resolve(__dirname, '..'), env: { ...restoreEnvironment(process.env, env.BACKUP_ENCRYPTION_KEY), RESTORE_SCHEMA_REVIEW_TICKET: path.resolve(schemaReview) },
    stdio: 'inherit', windowsHide: true, timeout: 600000 });
  const restore = !result.error && result.status === 0 ? JSON.parse(fs.readFileSync(childEvidence, 'utf8')) : null;
  const evidence = path.join(directory, 'restore.json');
  const passed = Boolean(restore?.ok && restore.restored && restore.archiveObjectPolicyPassed && restore.backupMode === 'production-logical-export'
    && restore.schemaSqlReviewed === true && restore.artifactSha256 === artifact.sha256
    && restore.executionId === plan.executionId && restore.releaseCommit === plan.releaseCommit
    && Date.parse(restore.testedAt) >= restoreStartedAt && Date.parse(restore.snapshotCreatedAt) === Date.parse(plan.exportCreatedAt));
  writeManifest(evidence, { ...restore, executionId: plan.executionId, releaseCommit: plan.releaseCommit, exportId: plan.exportId,
    scope: 'logical-database-only',
    artifactSha256: artifact.sha256, checkedAt: new Date().toISOString(), ready: passed, fullApplicationRecoveryProven: false,
    diskStateCovered: false, keyCustodyVerified: false });
  writeManifest(restoreReceiptPath, { executionId: plan.executionId, artifactSha256: artifact.sha256,
    status: passed ? 'restore_completed' : 'restore_failed_or_unconfirmed', completedAt: new Date().toISOString() });
  recordGate(manifest, 'restore', { status: passed ? 'PASS' : 'BLOCKED', evidence,
    prerequisites: ['health'], restrictions: ['Logical restore only; PITR failover and service cutover were not performed.'],
    codeIdentity: fingerprintFiles(['scripts/backup-safety.js', 'scripts/restore-backup-drill.js', 'scripts/run-local-signup-postgres-drill.js', 'scripts/prepare-postgres-client-tools.js']) });
  writeManifest(manifestPath, manifest);
  if (!passed) process.exitCode = 1;
}
if (require.main === module) main().catch(error => { console.error('Backup/restore stopped safely: ' + error.message); process.exitCode = 1; });
module.exports = { main };
