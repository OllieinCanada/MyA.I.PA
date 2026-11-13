// Creates a disposable, pinned combined tree. Never checks out/merges a branch,
// imports the app entrypoint, loads .env, calls providers or deploys anything.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const OVERLAYS = [
  'server/boundedBusinessMappingAdapters.js', 'tests/helpers/boundedMappingIntegrationFixture.js',
  'tests/bounded-business-mapping-integration.test.js', 'tests/bounded-mapping-composition.test.js',
  'scripts/compose-bounded-mapping-integration.js', 'scripts/bounded-mapping-integration-pins.json',
  '.github/workflows/bounded-mapping-integration.yml',
];
const REQUIRED_CASES = ['commit_identity_readiness', 'source_changed_before', 'context_changed_before', 'receipt_changed_before',
  'source_update_during', 'source_insert_during', 'context_update_during', 'receipt_update_during',
  'context_lock_wait', 'source_lock_wait', 'lifecycle_before_external', 'file_mutation_during',
  'atomicity_restart', 'uncertain_commit', 'conflict_refusal', 'override_refusal'];
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const archiveArgs = (tree, output) => ['-c', 'core.autocrlf=false', 'archive', '--format=tar', ...(output ? ['--output', output] : []), tree];
function validatePins(p) {
  if (p?.schemaVersion !== 1 || p.repository !== 'OllieinCanada/MyA.I.PA' || p.dependencies?.association?.pr !== 235
    || p.dependencies?.writer?.pr !== 239 || p.node !== '24.22.3'
    || ![p.base, p.combinedTree, p.dependencies.association.head, p.dependencies.writer.head].every(s => /^[a-f0-9]{40}$/.test(s))) throw Error('Invalid immutable dependency provenance');
}
function validateSqlTarget(value, env) {
  if (env.GITHUB_ACTIONS !== 'true' || env.CI !== 'true') throw Error('Owned disposable CI service required');
  const url = new URL(value);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.pathname !== '/ci' || url.username !== 'ci'
    || !['postgres:', 'postgresql:'].includes(url.protocol)) throw Error('Refusing non-CI/non-loopback database');
  return url;
}
function validateCoverage(report) {
  return report?.schemaVersion === 1 && report.ready === true && report.providerMode === 'synthetic-no-send'
    && report.sqlMode === 'real-postgresql' && Array.isArray(report.cases) && report.cases.length === REQUIRED_CASES.length
    && new Set(report.cases.map(c => c.name)).size === REQUIRED_CASES.length
    && REQUIRED_CASES.every(name => report.cases.some(c => c.name === name && c.status === 'passed'));
}
function compose({ root = path.resolve(__dirname, '..'), composeOnly = false } = {}) {
  const run = (cmd, args, options = {}) => {
    const r = spawnSync(cmd, args, { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 180000, maxBuffer: 16 * 1024 * 1024, ...options });
    if (r.error || r.status !== 0) throw Error(`${path.basename(cmd)} failed (${r.status ?? r.error?.code}): ${String(r.stderr || '').slice(-1200)}`);
    return r.stdout;
  };
  const git = args => run('git', args).trim();
  const pins = JSON.parse(fs.readFileSync(path.join(root, 'scripts/bounded-mapping-integration-pins.json'))); validatePins(pins);
  if (process.versions.node !== pins.node) throw Error('Exact approved Node runtime required');
  const head = git(['rev-parse', 'HEAD']);
  if (process.env.INTEGRATION_EXPECTED_HEAD && head !== process.env.INTEGRATION_EXPECTED_HEAD) throw Error('Integration head mismatch');
  const published = git(['diff', '--name-only', pins.base, head]).split(/\r?\n/).filter(Boolean);
  if (published.some(p => !OVERLAYS.includes(p))) throw Error('Out-of-scope integration publication');
  const tree = git(['merge-tree', '--write-tree', pins.dependencies.association.head, pins.dependencies.writer.head]);
  if (tree !== pins.combinedTree) throw Error('Dependency composition conflict/tree mismatch');
  for (const p of ['package-lock.json', 'prisma/schema.prisma']) {
    if (hash(run('git', ['show', `${tree}:${p}`])) !== hash(run('git', ['show', `${head}:${p}`]))) throw Error('Dependency/schema mismatch in combined tree');
  }
  const workspace = fs.mkdtempSync(path.join(process.env.MAPPING_INTEGRATION_TEMP_ROOT || os.tmpdir(), 'myaipa-mapping-combined-'));
  const out = path.join(root, 'diagnostics/bounded-mapping-integration', path.basename(workspace)); fs.mkdirSync(out, { recursive: true });
  const provenance = { schemaVersion: 1, head, pins, tree, composeOnly, workspace, overlayHashes: {}, dependencyHashes: {}, ready: false };
  try {
    const archive = path.join(workspace, 'dependency-tree.tar');
    run('git', archiveArgs(tree, archive));
    run(process.platform === 'win32' ? 'tar.exe' : 'tar', ['-xf', archive, '-C', workspace]);
    for (const p of OVERLAYS) {
      // Committed blobs only: no dirty files/private evidence can enter the run.
      const body = run('git', ['show', `${head}:${p}`]);
      const dest = path.join(workspace, p); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, body);
      provenance.overlayHashes[p] = hash(body);
    }
    for (const [p, commit] of [['server/signupAssociationRepair.js', pins.dependencies.association.head], ['server/boundedBusinessMappingWriter.js', pins.dependencies.writer.head]]) {
      const bytes = fs.readFileSync(path.join(workspace, p));
      if (hash(bytes) !== hash(run('git', ['show', `${commit}:${p}`]))) throw Error('Dependency module bytes differ from pinned commit');
      provenance.dependencyHashes[p] = hash(bytes);
    }
    if (!composeOnly) {
      validateSqlTarget(process.env.DATABASE_URL, process.env);
      const dependencies = path.resolve(process.env.MAPPING_APPROVED_NODE_MODULES || path.join(root, 'node_modules'));
      if (!fs.existsSync(path.join(dependencies, '@prisma/client/package.json'))) throw Error('Existing locked dependencies required');
      fs.symlinkSync(dependencies, path.join(workspace, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
      const reportFile = path.join(out, 'integration-result.json');
      const env = Object.fromEntries(['PATH', 'HOME', 'SystemRoot', 'TEMP', 'TMP'].filter(k => process.env[k]).map(k => [k, process.env[k]]));
      Object.assign(env, { CI: 'true', GITHUB_ACTIONS: 'true', DISABLE_LOCAL_ENV_FILES: '1', DATABASE_URL: process.env.DATABASE_URL,
        RUN_BOUNDED_MAPPING_INTEGRATION: '1', MAPPING_INTEGRATION_REPORT: reportFile });
      const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', 'tests/bounded-business-mapping-integration.test.js'], {
        cwd: workspace, env, encoding: 'utf8', windowsHide: true, timeout: 180000, maxBuffer: 16 * 1024 * 1024,
      });
      fs.writeFileSync(path.join(out, 'integration.tap'), r.stdout || ''); fs.writeFileSync(path.join(out, 'integration.stderr.log'), r.stderr || '');
      if (r.error || r.status !== 0) throw Error('Combined-tree SQL tests failed; preserved TAP/stderr are authoritative');
      if (!fs.existsSync(reportFile) || !validateCoverage(JSON.parse(fs.readFileSync(reportFile)))) throw Error('Missing/incomplete real-reader SQL case coverage');
      provenance.ready = true;
    }
    return provenance;
  } catch (error) { provenance.error = error.message; throw error; }
  finally { fs.writeFileSync(path.join(out, 'provenance.json'), JSON.stringify(provenance, null, 2) + '\n'); console.log(`Integration evidence: ${out}`); }
}
if (require.main === module) {
  try { const result = compose({ composeOnly: process.argv.includes('--compose-only') }); console.log(JSON.stringify(result, null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { OVERLAYS, REQUIRED_CASES, archiveArgs, validatePins, validateSqlTarget, validateCoverage, compose };
