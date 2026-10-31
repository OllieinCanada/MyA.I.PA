const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
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
function assertSafeArchiveToc(toc) {
  // This screens TOC object types; it is not a SQL parser or an OS sandbox.
  const allowed = ['SCHEMA', 'EXTENSION', 'COMMENT', 'TYPE', 'TABLE DATA', 'TABLE', 'SEQUENCE OWNED BY',
    'SEQUENCE SET', 'SEQUENCE', 'DEFAULT', 'CONSTRAINT', 'FK CONSTRAINT', 'INDEX', 'ACL'];
  for (const line of String(toc).split(/\r?\n/).filter(line => line && !line.startsWith(';'))) {
    const description = line.match(/^\d+;\s+\d+\s+\d+\s+(.+)$/)?.[1];
    if (!description || !allowed.some(type => description.startsWith(type + ' '))) {
      throw Error('Archive executable, foreign or unknown object requires separate review before restoration');
    }
  }
  const extensions = [...toc.matchAll(/^\d+;\s+\d+\s+\d+\s+EXTENSION\s+-\s+([A-Za-z0-9_-]+)/gm)].map(match => match[1]);
  if (extensions.some(name => !['plpgsql', 'pgcrypto', 'citext', 'uuid-ossp'].includes(name))) throw Error('Archive extension requires separate review before restoration');
}
function schemaSqlDigest(schemaSql) {
  const lines = String(schemaSql).split(/\r?\n/);
  const wrappers = lines.map((line, index) => ({ line, index })).filter(item => /^\\(?:un)?restrict\b/.test(item.line));
  if (wrappers.length) {
    const [start, end] = wrappers;
    const key = start?.line.match(/^\\restrict ([A-Za-z0-9]+)$/)?.[1];
    const commentOrBlank = line => !line.trim() || line.startsWith('--');
    if (wrappers.length !== 2 || !key || end.line !== '\\unrestrict ' + key
      || !lines.slice(0, start.index).every(commentOrBlank) || !lines.slice(end.index + 1).every(commentOrBlank)) {
      throw Error('Schema has unexpected psql restriction wrappers; review cannot be bound safely');
    }
    // pg_restore randomizes these two outer psql-only markers on every rendering.
    // Do not use a predictable --restrict-key or discard any actual SQL.
    lines.splice(end.index, 1); lines.splice(start.index, 1);
  }
  return crypto.createHash('sha256').update(lines.join('\n')).digest('hex');
}
function verifySchemaReview(schemaSql, artifactSha256, ticket, now = Date.now()) {
  const sha256 = schemaSqlDigest(schemaSql);
  const at = Date.parse(ticket?.reviewedAt);
  if (!/^[a-f0-9]{64}$/.test(artifactSha256 || '') || ticket?.artifactSha256 !== artifactSha256
    || ticket.schemaSqlSha256 !== sha256 || ticket.decision !== 'approved'
    || ticket.schemaDigestFormat !== 'pg-schema-without-generated-restrict-wrapper-v1'
    || ticket.scope !== 'exact-logical-archive-schema' || typeof ticket.reviewReference !== 'string' || !ticket.reviewReference.trim()
    || typeof ticket.reviewedAt !== 'string'
    || !Number.isFinite(at) || at > now + 5000 || now - at > 3600000) throw Error('Fresh exact-archive schema SQL review required; TOC screening alone does not authorize executing schema SQL');
  return sha256;
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
module.exports = { privateDirectory, removePrivateDirectory, databaseIdentity, validateTargetUrl, verifyDisposableTarget, assertSafeArchiveToc, verifySchemaReview, schemaSqlDigest };
