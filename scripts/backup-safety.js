const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
function privateDirectory(prefix = 'myaipa-restore-drill-') {
  const base = process.platform === 'win32' ? path.join(process.env.LOCALAPPDATA, 'MyAIPA', 'RecoveryDrills') : os.tmpdir();
  fs.mkdirSync(base, { recursive: true, mode: 0o700 });
  const directory = fs.mkdtempSync(path.join(base, prefix));
  if (process.platform === 'win32') {
    const account = `${process.env.USERDOMAIN}\\${process.env.USERNAME}`;
    const acl = spawnSync('icacls.exe', [directory, '/inheritance:r', '/grant:r', `${account}:(OI)(CI)F`, '*S-1-5-18:(OI)(CI)F'], { encoding: 'utf8', windowsHide: true });
    if (acl.error || acl.status !== 0) throw Error('Private Windows recovery permissions could not be established');
  } else fs.chmodSync(directory, 0o700);
  return directory;
}
function removePrivateDirectory(directory) {
  const target = fs.realpathSync(directory);
  const base = process.platform === 'win32' ? path.join(process.env.LOCALAPPDATA, 'MyAIPA', 'RecoveryDrills') : os.tmpdir();
  if (path.dirname(target) !== fs.realpathSync(base) || !/^myaipa-(restore-drill|backup-drill)-/.test(path.basename(target)) || fs.lstatSync(directory).isSymbolicLink()) throw Error('Unsafe recovery cleanup target');
  fs.rmSync(target, { recursive: true, force: true });
}
function databaseIdentity(value) {
  const url = new URL(value);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw Error('PostgreSQL URL required');
  return { host: url.hostname.toLowerCase().replace(/^localhost$/, '127.0.0.1'), port: url.port || '5432', database: decodeURIComponent(url.pathname.slice(1)) };
}
function validateTargetUrl(value, ticket, sourceUrl = '') {
  const target = databaseIdentity(value);
  if (!['127.0.0.1', '[::1]'].includes(target.host) || !/^myaipa_restore_drill_[a-f0-9]{12}$/.test(target.database)
    || ticket?.database !== target.database || String(ticket.port) !== target.port || ticket.host !== target.host
    || !/^[0-9]+$/.test(ticket.systemIdentifier || '') || !ticket.dataDirectory
    || !Number.isFinite(Date.parse(ticket.createdAt)) || Date.now() - Date.parse(ticket.createdAt) > 3600000
    || Date.parse(ticket.createdAt) > Date.now() + 5000) throw Error('Fresh execution-owned disposable restore target required');
  if (sourceUrl && JSON.stringify(databaseIdentity(sourceUrl)) === JSON.stringify(target)) throw Error('Restore target matches source identity');
  return target;
}
async function verifyDisposableTarget({ client, restoreUrl, ticket, sourceUrl = '' }) {
  const target = validateTargetUrl(restoreUrl, ticket, sourceUrl);
  const lock = await client.query('SELECT pg_try_advisory_lock(741825963) AS acquired');
  if (lock.rows[0]?.acquired !== true) throw Error('Another restore owns the target');
  const identity = await client.query("SELECT current_database() AS database, current_setting('data_directory') AS directory, system_identifier::text AS identifier FROM pg_control_system()");
  const row = identity.rows[0];
  if (row?.database !== target.database || row.identifier !== ticket.systemIdentifier
    || path.resolve(row.directory).toLowerCase() !== path.resolve(ticket.dataDirectory).toLowerCase()) throw Error('Restore server identity does not match the execution ticket');
  const tables = await client.query("SELECT COUNT(*)::int AS count FROM pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema')");
  if (tables.rows[0]?.count !== 0) throw Error('Restore target is not empty');
  return target;
}
module.exports = { privateDirectory, removePrivateDirectory, databaseIdentity, validateTargetUrl, verifyDisposableTarget };
