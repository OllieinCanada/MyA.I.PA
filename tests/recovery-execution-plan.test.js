const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createPlan, validatePlan, validateExecution, selectExactExport, restoreEnvironment } = require('../scripts/recovery-execution-plan');
const { assertSafeArchiveToc, verifySchemaReview, schemaSqlDigest } = require('../scripts/backup-safety');
const now = Date.parse('2026-10-30T22:00:00Z');
const metadata = () => ({ releaseCommit: 'a'.repeat(40), databaseId: 'dpg-fixture-a', serviceId: 'srv-fixture',
  exportId: 'dpg-fixture-a/export-2026-10-30', exportCreatedAt: new Date(now - 60000).toISOString(), maximumSnapshotAgeHours: 1 });
function plan() { return createPlan(metadata(), { now }); }
function manifest(value) { return { executionId: value.executionId, releaseCommit: value.releaseCommit, createdAt: value.createdAt,
  gates: { health: { status: 'PASS', codeIdentity: value.releaseCommit, checkedAt: new Date(now).toISOString() } } }; }
test('preparation pins exactly one export and promises no execution, disk coverage or full recovery', () => {
  const value = plan();
  assert.equal(validatePlan(value, { now }), value);
  for (const field of ['executionAuthorized', 'productionRestoreAllowed', 'providerDispatchesAllowed', 'fullApplicationRecoveryProven', 'diskStateCovered', 'keyCustodyVerified']) assert.equal(value[field], false);
  assert.equal(value.downloadLimitBytes, 512 * 1024 * 1024);
});
test('preparation refuses stale/future exports, unapproved age policy, unsafe IDs, URLs and secrets', () => {
  for (const change of [
    { exportCreatedAt: new Date(now - 7200000).toISOString() }, { exportCreatedAt: new Date(now + 60000).toISOString() },
    { maximumSnapshotAgeHours: undefined }, { maximumSnapshotAgeHours: 0 }, { maximumSnapshotAgeHours: 169 },
    { exportId: 'dpg-other/export' }, { exportId: 'dpg-fixture-a/../other' }, { releaseCommit: 'main' },
    { url: 'https://backups.render.com/private?token=fixture' }, { BACKUP_ENCRYPTION_KEY: 'never persist me' },
  ]) assert.throws(() => createPlan({ ...metadata(), ...change }, { now }));
});
test('modified, expired and cross-release/execution evidence cannot be reused', () => {
  const value = plan();
  validateExecution(value, manifest(value), { now });
  assert.throws(() => validatePlan({ ...value, exportId: 'dpg-fixture-a/other' }, { now }), /checksum/);
  assert.throws(() => validatePlan(value, { now: now + 3600001 }), /fresh/);
  for (const change of [{ executionId: 'b'.repeat(36) }, { releaseCommit: 'b'.repeat(40) }, { createdAt: new Date(0).toISOString() },
    { gates: { health: { status: 'PASS', checkedAt: new Date(now).toISOString(), codeIdentity: 'b'.repeat(40) } } },
    { gates: { health: { status: 'PASS', checkedAt: new Date(now - 600001).toISOString(), codeIdentity: value.releaseCommit } } }]) {
    assert.throws(() => validateExecution(value, { ...manifest(value), ...change }, { now }));
  }
});
test('export selection handles provider wrappers but never picks a newer or ambiguous backup', () => {
  const value = plan();
  const row = { id: value.exportId, createdAt: value.exportCreatedAt, url: 'https://backups.render.com/fixture?signature=private' };
  assert.equal(selectExactExport([{ export: row }], value).item.id, value.exportId);
  assert.equal(selectExactExport([{ postgresExport: row }], value).item.id, value.exportId);
  for (const rows of [[], [row, row], [{ ...row, id: 'dpg-fixture-a/newer' }], [{ ...row, createdAt: new Date(now).toISOString() }], [{ ...row, status: 'pending' }]]) assert.throws(() => selectExactExport(rows, value));
  for (const url of ['http://backups.render.com/a', 'https://backups.render.com.evil.invalid/a', 'https://user:secret@backups.render.com/a', 'https://backups.render.com:444/a']) assert.throws(() => selectExactExport([{ ...row, url }], value));
});
test('restore child receives no inherited provider, source-database or application configuration', () => {
  const env = restoreEnvironment({ PATH: 'fixture', SystemRoot: 'Windows', DATABASE_URL: 'production', STRIPE_SECRET_KEY: 'private',
    TWILIO_AUTH_TOKEN: 'private', VAPI_API_KEY: 'private', NODE_OPTIONS: '--require=unsafe', APP_ENV: 'production' }, 'fixture-secret');
  assert.deepEqual(env, { PATH: 'fixture', SystemRoot: 'Windows', BACKUP_ENCRYPTION_KEY: 'fixture-secret', DISABLE_LOCAL_ENV_FILES: '1' });
});
test('archive executable/foreign objects and unreviewed extensions are refused before pg_restore', () => {
  assert.doesNotThrow(() => assertSafeArchiveToc('1; 0 0 EXTENSION - plpgsql fixture\n2; 0 0 TABLE public Business fixture'));
  for (const type of ['FUNCTION', 'PROCEDURE', 'FOREIGN TABLE', 'FOREIGN DATA WRAPPER', 'SERVER', 'USER MAPPING', 'EVENT TRIGGER', 'PROCEDURAL LANGUAGE', 'TRIGGER', 'RULE', 'MATERIALIZED VIEW', 'MATERIALIZED VIEW DATA', 'VIEW', 'UNKNOWN TYPE']) assert.throws(() => assertSafeArchiveToc(`1; 0 0 ${type} public unsafe fixture`));
  assert.throws(() => assertSafeArchiveToc('1; 0 0 EXTENSION - dblink fixture'));
});
test('a TOC pass cannot authorize schema SQL without a fresh exact-artifact/exact-SQL review', () => {
  const crypto = require('node:crypto');
  const sql = 'CREATE TABLE public.fixture (id integer);';
  const ticket = { scope: 'exact-logical-archive-schema', decision: 'approved', reviewReference: 'synthetic-test-review',
    schemaDigestFormat: 'pg-schema-without-generated-restrict-wrapper-v1',
    reviewedAt: new Date(now).toISOString(), artifactSha256: 'a'.repeat(64), schemaSqlSha256: crypto.createHash('sha256').update(sql).digest('hex') };
  assert.equal(verifySchemaReview(sql, 'a'.repeat(64), ticket, now), ticket.schemaSqlSha256);
  for (const change of [{ decision: 'pending' }, { artifactSha256: 'b'.repeat(64) }, { schemaSqlSha256: 'b'.repeat(64) },
    { reviewedAt: new Date(now - 3600001).toISOString() }, { reviewReference: '' },
    { reviewReference: { unreviewed: true } }, { reviewedAt: [new Date(now).toISOString()] }]) assert.throws(() => verifySchemaReview(sql, 'a'.repeat(64), { ...ticket, ...change }, now));
  assert.throws(() => verifySchemaReview(sql, 'a'.repeat(64), null, now));
});
test('schema review digest ignores only validated random outer psql wrappers, never actual SQL', () => {
  const sql = 'CREATE TABLE public.fixture (id integer);';
  const render = token => '-- Dump header\n\\restrict ' + token + '\n' + sql + '\n-- Dump complete\n\\unrestrict ' + token + '\n';
  assert.equal(schemaSqlDigest(render('RandomA123')), schemaSqlDigest(render('RandomB456')));
  assert.notEqual(schemaSqlDigest(render('RandomA123')), schemaSqlDigest(render('RandomA123').replace('integer', 'text')));
  assert.throws(() => schemaSqlDigest(render('RandomA123').replace('\\unrestrict RandomA123', '\\unrestrict OtherKey')));
  assert.throws(() => schemaSqlDigest(sql + '\n' + render('RandomA123')));
  assert.throws(() => schemaSqlDigest(render('RandomA123') + '\nSELECT 1;'));
});
test('metadata CLI uses exclusive evidence directories and default runner cannot download', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'myaipa-recovery-policy-test-'));
  try {
    const current = { ...metadata(), exportCreatedAt: new Date().toISOString() };
    const input = path.join(directory, 'metadata.json'); fs.writeFileSync(input, JSON.stringify(current));
    const output = path.join(directory, 'evidence');
    const cli = path.resolve(__dirname, '../scripts/prepare-recovery-execution.js');
    const execute = () => spawnSync(process.execPath, [cli, '--metadata=' + input, '--out-dir=' + output], { encoding: 'utf8', timeout: 10000 });
    const first = execute(); assert.equal(first.status, 0, first.stderr);
    assert.equal(JSON.parse(first.stdout).downloads, 0);
    assert.notEqual(execute().status, 0);
    assert.deepEqual(fs.readdirSync(output).sort(), ['execution.json', 'plan.json']);
    const runner = require('../scripts/run-render-backup-restore-drill');
    const originalFetch = global.fetch; let calls = 0;
    global.fetch = async () => { calls++; throw Error('Network forbidden in preparation'); };
    try {
      await assert.rejects(runner.main([]), /Default behavior/);
      await runner.main(['--plan=' + path.join(output, 'plan.json')]).catch(error => {
        // Fixture identity deliberately does not match the production-specific runner.
        assert.match(error.message, /source does not match/);
      });
      const exact = createPlan({ ...current, databaseId: 'dpg-d924vjq8qa3s73crd29g-a', serviceId: 'srv-d92503a8qa3s73crdpog',
        exportId: 'dpg-d924vjq8qa3s73crd29g-a/fixture-only' });
      const exactPath = path.join(directory, 'exact-plan.json'); fs.writeFileSync(exactPath, JSON.stringify(exact));
      await runner.main(['--plan=' + exactPath]);
      await assert.rejects(runner.main(['--plan=' + exactPath, '--execute']), /explicit execution confirmation/);
      await assert.rejects(runner.main(['--plan=' + exactPath, '--execute', '--confirm=DOWNLOAD_ENCRYPTED_LOGICAL_BACKUP', '--restore']), /separately required/);
      assert.equal(calls, 0);
    } finally { global.fetch = originalFetch; }
  } finally {
    assert.equal(path.dirname(directory), fs.realpathSync(os.tmpdir()));
    fs.rmSync(directory, { recursive: true });
  }
});
