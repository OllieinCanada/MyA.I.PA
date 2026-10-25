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
const DATABASE = 'dpg-d924vjq8qa3s73crd29g-a';
async function main() {
  const directory = path.resolve(__dirname, '../diagnostics/provider-hardening');
  const manifestPath = path.join(directory, 'execution.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assertFreshHealth(manifest);
  const credentials = readRenderCredentials();
  const env = await fetchRenderEnv({ credentials, serviceId: 'srv-d92503a8qa3s73crdpog', keys: ['BACKUP_ENCRYPTION_KEY'] });
  if (env.BACKUP_ENCRYPTION_KEY.length < 24) throw Error('Strong backup encryption key required');
  const artifactPath = path.join(directory, 'encrypted-backup-artifact.json');
  let artifact = fs.existsSync(artifactPath) ? JSON.parse(fs.readFileSync(artifactPath, 'utf8')) : null;
  if (!artifact) {
    const exportsResponse = await fetch(credentials.host + '/postgres/' + DATABASE + '/export', {
      method: 'GET', headers: { Authorization: 'Bearer ' + credentials.key }, redirect: 'error', signal: AbortSignal.timeout(20000) });
    if (!exportsResponse.ok) throw Error('Logical export inventory is unavailable');
    const exports = await exportsResponse.json();
    const receipt = JSON.parse(fs.readFileSync(path.join(directory, 'backup-export-request.json'), 'utf8'));
    const item = exports.filter(x => x.id?.startsWith(DATABASE + '/') && x.url
      && Date.parse(x.createdAt) >= Date.parse(receipt.startedAt) - 60000).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
    if (!item) throw Error('Requested logical export is not available; do not repeat its creation');
    const url = new URL(item.url);
    if (url.protocol !== 'https:' || url.username || url.password || !['backups.render.com'].includes(url.hostname)) throw Error('Unrecognized backup-download origin; URL suppressed');
    const privateWork = privateDirectory('myaipa-backup-drill-');
    const raw = path.join(privateWork, 'render-export.dir.tar.gz');
    try {
      const response = await fetch(url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(180000) });
      if (!response.ok || !response.body) throw Error('Backup download failed');
      let bytes = 0;
      const limit = new Transform({ transform(chunk, encoding, callback) { bytes += chunk.length; callback(bytes > 512 * 1024 * 1024 ? Error('Backup exceeds local drill size limit') : null, chunk); } });
      await pipeline(Readable.fromWeb(response.body), limit, fs.createWriteStream(raw, { flags: 'wx', mode: 0o600 }));
      const encrypted = encryptBackup(raw, env.BACKUP_ENCRYPTION_KEY);
      const metadata = { schemaVersion: 1, createdAt: new Date().toISOString(), snapshotCreatedAt: item.createdAt,
        sourceDatabaseId: DATABASE, archiveFormat: 'render-directory-tar', encrypted: true, encryption: encrypted.encryption,
        bytes: fs.statSync(encrypted.encryptedPath).size,
        sha256: crypto.createHash('sha256').update(fs.readFileSync(encrypted.encryptedPath)).digest('hex'), containsPersonalInformation: true };
      writeManifest(encrypted.encryptedPath + '.manifest.json', metadata);
      artifact = { backupPath: encrypted.encryptedPath, snapshotCreatedAt: item.createdAt, encryptedBytes: metadata.bytes,
        sha256: metadata.sha256, sourceDatabaseId: DATABASE, downloadedAt: new Date().toISOString(), signedUrlsPersisted: false };
      writeManifest(artifactPath, artifact);
    } finally { if (fs.existsSync(raw)) fs.rmSync(raw); }
  }
  console.log(JSON.stringify({ encryptedBackupSaved: true, snapshotCreatedAt: artifact.snapshotCreatedAt, bytes: artifact.encryptedBytes, signedUrlsPrinted: false }));
  if (!process.argv.includes('--restore')) return;
  const result = spawnSync(process.execPath, [path.resolve(__dirname, 'run-local-signup-postgres-drill.js'), '--restore-backup=' + artifact.backupPath], {
    cwd: path.resolve(__dirname, '..'), env: { ...process.env, BACKUP_ENCRYPTION_KEY: env.BACKUP_ENCRYPTION_KEY, DISABLE_LOCAL_ENV_FILES: '1' },
    stdio: 'inherit', windowsHide: true, timeout: 600000 });
  const evidence = path.join(directory, 'restore.json');
  recordGate(manifest, 'restore', { status: !result.error && result.status === 0 ? 'PASS' : 'BLOCKED', evidence,
    prerequisites: ['health'], restrictions: ['Logical restore only; PITR failover and service cutover were not performed.'],
    codeIdentity: fingerprintFiles(['scripts/backup-safety.js', 'scripts/restore-backup-drill.js', 'scripts/run-local-signup-postgres-drill.js', 'scripts/prepare-postgres-client-tools.js']) });
  writeManifest(manifestPath, manifest);
  if (result.error || result.status !== 0) process.exitCode = 1;
}
if (require.main === module) main().catch(error => { console.error('Backup/restore stopped safely: ' + error.message); process.exitCode = 1; });
