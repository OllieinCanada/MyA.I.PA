const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { Client } = require('pg');
const { privateDirectory, removePrivateDirectory, validateTargetUrl, verifyDisposableTarget } = require('./backup-safety');
const TAR = process.platform === 'win32' ? 'tar.exe' : 'tar';
function run(command, args, options = {}) {
  return spawnSync(command, args, { encoding: 'utf8', windowsHide: true, timeout: 600000, maxBuffer: 128 * 1024 * 1024, ...options });
}
function assertSuccess(result, label) {
  if (result.error || result.status !== 0) {
    const diagnostic = String(result.stderr || '').split(/\r?\n/).find(line => /unsupported version|does not appear to be a valid archive|could not open input file|input file.*format|is a directory/.test(line));
    const safe = diagnostic ? diagnostic.replace(/"([^"]*)"|'([^']*)'/g, (_, a, b) => '[file:' + path.basename(a || b) + ']').slice(0, 250) : String(result.error?.code || result.status);
    throw Error(label + ' failed (' + safe + '); credentials and archive contents suppressed');
  }
  return result.stdout;
}
function decryptBackup(bytes, manifest, secret) {
  if (manifest.encrypted !== true || manifest.encryption?.cipher !== 'aes-256-gcm' || secret.length < 24) throw Error('Authenticated encrypted backup and a strong key are required');
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== manifest.sha256) throw Error('Backup checksum verification failed');
  const meta = manifest.encryption;
  const key = crypto.scryptSync(secret, Buffer.from(meta.salt, 'base64'), 32);
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(meta.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(meta.authTag, 'base64'));
    return Buffer.concat([decipher.update(bytes), decipher.final()]);
  } finally { key.fill(0); }
}
function copyCounts(sql) {
  const counts = {};
  let table = '';
  for (const line of sql.split(/\r?\n/)) {
    if (table) { if (line === '\\.') table = ''; else counts[table]++; continue; }
    const match = line.match(/^COPY (?:"public"|public)\."?([A-Za-z0-9_]+)"? \(.* FROM stdin;$/);
    if (match) { table = match[1]; counts[table] = 0; }
  }
  if (table) throw Error('Archive COPY data is incomplete');
  return counts;
}
function unpackDirectoryArchive(archive, directory) {
  const names = assertSuccess(run(TAR, ['-tzf', archive]), 'Archive listing').split(/\r?\n/).filter(Boolean);
  if (!names.length || names.some(name => /(^[/\\]|^[A-Za-z]:|(^|[/\\])\.\.([/\\]|$))/.test(name))) throw Error('Archive contains an unsafe path');
  const verbose = assertSuccess(run(TAR, ['-tvzf', archive]), 'Archive entry inspection').split(/\r?\n/).filter(Boolean);
  if (verbose.some(line => !/^[-d]/.test(line) || / -> | link to /.test(line))) throw Error('Archive contains an unsupported link or special file');
  const destination = path.join(directory, 'archive'); fs.mkdirSync(destination);
  assertSuccess(run(TAR, ['-xzf', archive, '-C', destination, '--no-same-owner', '--no-same-permissions']), 'Directory extraction');
  const toc = names.filter(name => /(^|\/)toc\.dat$/.test(name));
  if (toc.length !== 1) throw Error('One PostgreSQL directory archive is required');
  const found = [];
  function visit(folder) {
    for (const item of fs.readdirSync(folder, { withFileTypes: true })) {
      if (item.isSymbolicLink()) throw Error('Extracted archive contains a link');
      const file = path.join(folder, item.name);
      if (item.isDirectory()) visit(file);
      else if (item.name === 'toc.dat') found.push(file);
    }
  }
  visit(destination);
  if (found.length !== 1) throw Error('Extracted archive has no unique PostgreSQL TOC');
  return path.dirname(found[0]);
}
async function restoreDrill({ env = process.env, applyRestore = false, backupPath, manifestPath = backupPath + '.manifest.json' }) {
  const startedAt = Date.now();
  if (!backupPath || !fs.existsSync(backupPath) || !fs.existsSync(manifestPath)) throw Error('Encrypted backup and manifest are required');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  let ticket, client, directory, decrypted;
  try {
    if (applyRestore) {
      if (env.RESTORE_DRILL_CONFIRM !== 'RESTORE_TO_DISPOSABLE_DATABASE' || !env.RESTORE_TARGET_TICKET) throw Error('Disposable restore confirmation and identity ticket required');
      ticket = JSON.parse(fs.readFileSync(env.RESTORE_TARGET_TICKET, 'utf8'));
      validateTargetUrl(env.RESTORE_DATABASE_URL, ticket, env.DATABASE_URL);
      client = new Client({ connectionString: env.RESTORE_DATABASE_URL, connectionTimeoutMillis: 5000, query_timeout: 10000, ssl: false });
      await client.connect();
      await verifyDisposableTarget({ client, restoreUrl: env.RESTORE_DATABASE_URL, ticket, sourceUrl: env.DATABASE_URL });
    }
    directory = privateDirectory();
    decrypted = decryptBackup(fs.readFileSync(backupPath), manifest, String(env.BACKUP_ENCRYPTION_KEY || ''));
    const archive = path.join(directory, 'restore.archive'); fs.writeFileSync(archive, decrypted, { mode: 0o600, flag: 'wx' });
    decrypted.fill(0); decrypted = null;
    const input = manifest.archiveFormat === 'render-directory-tar' ? unpackDirectoryArchive(archive, directory) : archive;
    assertSuccess(run('pg_restore', ['--list', input]), 'Archive readability check');
    const expected = copyCounts(assertSuccess(run('pg_restore', ['--data-only', '--no-owner', '--no-privileges', '--file=-', input]), 'Archive data validation'));
    if (!Object.keys(expected).length) throw Error('Archive contains no verifiable COPY table data');
    const actual = {};
    if (applyRestore) {
      const url = new URL(env.RESTORE_DATABASE_URL);
      const pgEnv = { ...env, PGHOST: url.hostname, PGPORT: url.port || '5432', PGDATABASE: ticket.database,
        PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password), PGSSLMODE: 'disable' };
      assertSuccess(run('pg_restore', ['--exit-on-error', '--single-transaction', '--no-owner', '--no-privileges', '--dbname', ticket.database, input], { env: pgEnv }), 'Disposable restore');
      for (const [table, count] of Object.entries(expected)) {
        if (!/^[A-Za-z0-9_]+$/.test(table)) throw Error('Unexpected archive table identity');
        actual[table] = Number((await client.query('SELECT COUNT(*)::text AS count FROM public."' + table + '"')).rows[0].count);
        if (actual[table] !== count) throw Error('Restored table count does not match the archive');
      }
      const invalid = await client.query('SELECT COUNT(*)::int AS count FROM pg_constraint WHERE NOT convalidated');
      if (invalid.rows[0].count !== 0) throw Error('Restored constraints are not validated');
    }
    const snapshot = manifest.snapshotCreatedAt || manifest.createdAt;
    return { ok: true, testedAt: new Date().toISOString(), checksumVerified: true, archiveReadable: true,
      restored: applyRestore, restoreElapsedMs: Date.now() - startedAt, snapshotCreatedAt: snapshot,
      snapshotAgeSeconds: Math.floor((Date.now() - Date.parse(snapshot)) / 1000),
      tableCounts: actual, tablesVerified: Object.keys(actual).length, constraintsValidated: applyRestore,
      productionDatabaseModified: false, applicationWorkersStarted: false, providerDispatches: 0,
      scope: 'Logical export restoration; not a PITR failover or complete service-recovery time measurement.' };
  } finally {
    if (decrypted) decrypted.fill(0);
    if (client) await client.end().catch(() => {});
    if (directory) removePrivateDirectory(directory);
  }
}
async function main() {
  if (process.env.DISABLE_LOCAL_ENV_FILES !== '1') require('dotenv').config({ path: process.env.OPERATIONS_ENV_FILE || '.env.local' });
  const backupPath = process.env.RESTORE_BACKUP_PATH || process.argv.slice(2).find(arg => !arg.startsWith('--'));
  const result = await restoreDrill({ backupPath, manifestPath: process.env.RESTORE_MANIFEST_PATH || backupPath + '.manifest.json', applyRestore: process.argv.includes('--restore') });
  console.log(JSON.stringify(result, null, 2));
}
if (require.main === module) main().catch(error => { console.error('Restore drill failed safely: ' + error.message); process.exitCode = 1; });
module.exports = { restoreDrill, decryptBackup, copyCounts, unpackDirectoryArchive };
