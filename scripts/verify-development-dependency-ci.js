// CI-only URI lock reproduction and public dependency reports. No fix/install CLI for local use.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { resolveRunCommand } = require('./_helpers');

const ROOT = path.resolve(__dirname, '..');
const SEVERITIES = ['info', 'low', 'moderate', 'high', 'critical'];
const fail = code => { throw Error(code); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const canonical = value => JSON.stringify(value, (_key, entry) => object(entry)
  ? Object.fromEntries(Object.keys(entry).sort().map(key => [key, entry[key]])) : entry);

function ciContext(env, actualHead, platform = process.platform) {
  const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
  if (platform !== 'linux' || env.GITHUB_ACTIONS !== 'true' || env.CI !== 'true'
    || env.RUNNER_ENVIRONMENT !== 'github-hosted'
    || env.GITHUB_REPOSITORY !== 'OllieinCanada/MyA.I.PA'
    || !['pull_request', 'push'].includes(env.GITHUB_EVENT_NAME)
    || !/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID || '')
    || !/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ATTEMPT || '')
    || !sha(env.DEPENDENCY_EXPECTED_HEAD) || !sha(env.GITHUB_SHA)
    || actualHead !== env.DEPENDENCY_EXPECTED_HEAD
    || !path.isAbsolute(env.GITHUB_WORKSPACE || '')
    || path.resolve(env.GITHUB_WORKSPACE) !== ROOT
    || !path.isAbsolute(env.RUNNER_TEMP || '')) fail('DEPENDENCY_CI_CONTEXT_REQUIRED');
  const temporary = path.resolve(env.RUNNER_TEMP);
  if (temporary === path.parse(temporary).root || temporary === ROOT
    || temporary.startsWith(ROOT + path.sep) || ROOT.startsWith(temporary + path.sep)) fail('DEPENDENCY_CI_TEMP_REQUIRED');
  return {
    repository: env.GITHUB_REPOSITORY, requestedHead: env.DEPENDENCY_EXPECTED_HEAD,
    actualHead, workflowGitHubSha: env.GITHUB_SHA, event: env.GITHUB_EVENT_NAME,
    runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT,
    runUrl: `https://github.com/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}/attempts/${env.GITHUB_RUN_ATTEMPT}`,
    nodeVersion: process.version,
  };
}

function compareLocks(before, regenerated) {
  if (!object(before) || !object(regenerated) || !object(before.packages) || !object(regenerated.packages)) fail('DEPENDENCY_LOCK_SCHEMA_INVALID');
  return {
    equal: canonical(before) === canonical(regenerated),
    beforeSemanticSha256: sha256(canonical(before)),
    regeneratedSemanticSha256: sha256(canonical(regenerated)),
    changedPackageEntries: [...new Set([...Object.keys(before.packages), ...Object.keys(regenerated.packages)])]
      .filter(key => canonical(before.packages[key]) !== canonical(regenerated.packages[key])).sort(),
  };
}

function requireUnchangedInstall(binding, lockDecision) {
  if (lockDecision?.passed !== true
    || ['actualHead', 'requestedHead', 'workflowGitHubSha', 'runId', 'runAttempt', 'manifestSha256', 'lockSha256']
      .some(key => binding[key] !== lockDecision[key])) fail('DEPENDENCY_SOURCE_CHANGED_AFTER_REPRODUCTION');
}

function auditReport(audit, { scope, exitCode, error = false, signal = false } = {}) {
  if (!['include-dev', 'production'].includes(scope) || error || signal || ![0, 1].includes(exitCode)
    || !object(audit) || audit.error || audit.auditReportVersion !== 2
    || !object(audit.vulnerabilities) || !object(audit.metadata?.vulnerabilities)) fail('DEPENDENCY_AUDIT_INVALID_OR_UNAVAILABLE');
  const counts = audit.metadata.vulnerabilities;
  if ([...SEVERITIES, 'total'].some(key => !Number.isSafeInteger(counts[key]) || counts[key] < 0)
    || SEVERITIES.reduce((total, key) => total + counts[key], 0) !== counts.total
    || Object.keys(audit.vulnerabilities).length !== counts.total
    || exitCode !== (counts.total ? 1 : 0)) fail('DEPENDENCY_AUDIT_COUNTS_INVALID');
  const bySeverity = Object.fromEntries(SEVERITIES.map(key => [key, 0]));
  const advisorySources = new Set(), ghsaIds = new Set();
  const packages = Object.entries(audit.vulnerabilities).map(([name, value]) => {
    if (!object(value) || value.name !== name || !SEVERITIES.includes(value.severity) || typeof value.isDirect !== 'boolean'
      || !Array.isArray(value.via) || !value.via.length || !Array.isArray(value.nodes)
      || value.nodes.some(node => typeof node !== 'string' || !node.startsWith('node_modules/') || node.split('/').includes('..'))
      || typeof value.range !== 'string') fail('DEPENDENCY_AUDIT_PACKAGE_INVALID');
    bySeverity[value.severity]++;
    const via = value.via.map(item => {
      if (typeof item === 'string' && item) return item;
      if (!object(item) || !Number.isSafeInteger(item.source) || item.source < 1
        || typeof item.name !== 'string' || !SEVERITIES.includes(item.severity)
        || typeof item.range !== 'string' || !/^https:\/\/github\.com\/advisories\/(GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4})$/.test(item.url || '')) fail('DEPENDENCY_AUDIT_ADVISORY_INVALID');
      const ghsa = item.url.split('/').at(-1);
      advisorySources.add(item.source); ghsaIds.add(ghsa);
      return { source: item.source, name: item.name, severity: item.severity, range: item.range, ghsa, url: item.url };
    });
    return { name, severity: value.severity, range: value.range, isDirect: value.isDirect === true, nodes: value.nodes, via };
  }).sort((left, right) => left.name.localeCompare(right.name));
  if (SEVERITIES.some(key => bySeverity[key] !== counts[key])) fail('DEPENDENCY_AUDIT_SEVERITIES_INVALID');
  const parents = new Map(packages.map(item => [item.name, []]));
  for (const item of packages) for (const via of item.via) if (typeof via === 'string') {
    if (!parents.has(via)) fail('DEPENDENCY_AUDIT_REFERENCE_MISSING');
    parents.get(via).push(item.name);
  }
  // Walk reverse edges once per seed set: every meta-vulnerability must reach
  // a concrete advisory, even when a valid npm report contains grounded cycles.
  const ancestors = seeds => {
    const reached = new Set(seeds), queue = [...reached];
    for (let index = 0; index < queue.length; index++) for (const name of parents.get(queue[index])) {
      if (!reached.has(name)) { reached.add(name); queue.push(name); }
    }
    return reached;
  };
  const grounded = ancestors(packages.filter(item => item.via.some(via => typeof via !== 'string')).map(item => item.name));
  if (grounded.size !== packages.length) fail('DEPENDENCY_AUDIT_GRAPH_UNGROUNDED');
  const criticalOwners = packages.filter(item => item.via.some(via => typeof via !== 'string' && via.severity === 'critical'));
  const criticalAffected = ancestors(criticalOwners.map(item => item.name));
  const criticalAdvisorySources = [...new Set(criticalOwners.flatMap(item => item.via
    .filter(via => typeof via !== 'string' && via.severity === 'critical').map(via => via.source)))].sort((a, b) => a - b);
  const validationIssues = [];
  if (criticalOwners.some(item => item.severity !== 'critical')) validationIssues.push('CRITICAL_ADVISORY_NOT_REFLECTED_IN_PACKAGE_SUMMARY');
  if (criticalOwners.length && counts.critical === 0) validationIssues.push('CRITICAL_ADVISORY_NOT_REFLECTED_IN_TOTALS');
  return {
    scope, counts: Object.fromEntries([...SEVERITIES, 'total'].map(key => [key, counts[key]])),
    distinctAdvisorySources: [...advisorySources].sort((a, b) => a - b),
    distinctGhsaIds: [...ghsaIds].sort(), packages,
    criticalAdvisorySources, criticalAffectedPackages: [...criticalAffected].sort(), validationIssues,
    passed: scope === 'production' ? counts.total === 0 : counts.critical === 0 && criticalAffected.size === 0,
    policy: scope === 'production' ? 'fail-any-production-finding' : 'retain-all-findings-fail-critical',
  };
}

function main(mode) {
  if (!['lock', 'audit'].includes(mode)) fail('DEPENDENCY_CI_MODE_REQUIRED');
  // Reject a local invocation before starting any subprocess or creating files.
  ciContext(process.env, process.env.DEPENDENCY_EXPECTED_HEAD);
  if (fs.realpathSync(ROOT) !== ROOT || fs.realpathSync(process.env.RUNNER_TEMP) !== path.resolve(process.env.RUNNER_TEMP)) fail('DEPENDENCY_CI_REAL_PATH_REQUIRED');
  const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8', timeout: 10000 });
  if (git.status !== 0 || git.error) fail('DEPENDENCY_CI_HEAD_UNAVAILABLE');
  const context = ciContext(process.env, git.stdout.trim());
  const reportRoot = path.join(ROOT, 'diagnostics', 'development-dependency-ci');
  fs.mkdirSync(reportRoot, { recursive: true });
  const save = (name, value) => fs.writeFileSync(path.join(reportRoot, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  const scratch = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP, 'myaipa-uri-ci-'));
  const userconfig = path.join(scratch, 'user.npmrc'), globalconfig = path.join(scratch, 'global.npmrc');
  fs.writeFileSync(userconfig, '', { flag: 'wx' }); fs.writeFileSync(globalconfig, '', { flag: 'wx' });
  const env = Object.fromEntries(['PATH', 'SystemRoot', 'ComSpec', 'HOME', 'LANG'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
  Object.assign(env, { CI: 'true', npm_config_registry: 'https://registry.npmjs.org/', npm_config_userconfig: userconfig,
    npm_config_globalconfig: globalconfig, npm_config_cache: path.join(scratch, 'cache'), npm_config_ignore_scripts: 'true' });
  const npm = args => {
    const invocation = resolveRunCommand('npm', args);
    return spawnSync(invocation.command, invocation.args, { cwd: mode === 'lock' ? scratch : ROOT,
      env, encoding: 'utf8', timeout: 180000, maxBuffer: 10 * 1024 * 1024 });
  };
  const manifestBytes = fs.readFileSync(path.join(ROOT, 'package.json'));
  const lockBytes = fs.readFileSync(path.join(ROOT, 'package-lock.json'));
  const version = npm(['--version']);
  const versionValid = version.status === 0 && !version.error && /^\d+\.\d+\.\d+$/.test(version.stdout.trim());
  const binding = { ...context, manifestSha256: sha256(manifestBytes), lockSha256: sha256(lockBytes),
    npmVersion: versionValid ? version.stdout.trim() : 'unavailable', checkedAt: new Date().toISOString() };
  save(`npm-runtime-${mode}.json`, { ...binding, passed: versionValid });
  if (!versionValid) { process.exitCode = 1; return; }
  if (mode === 'lock') {
    const manifest = JSON.parse(manifestBytes), before = JSON.parse(lockBytes);
    save('package.before.json', manifest); save('lock.before.json', before);
    fs.writeFileSync(path.join(scratch, 'package.json'), manifestBytes, { flag: 'wx' });
    fs.writeFileSync(path.join(scratch, 'package-lock.json'), lockBytes, { flag: 'wx' });
    const result = npm(['install', '--package-lock-only', '--include=dev', '--ignore-scripts', '--legacy-peer-deps', '--no-audit', '--no-fund']);
    let decision = { ...binding, passed: false, exitCode: result.status, commandError: result.error?.code || null };
    try {
      const regenerated = JSON.parse(fs.readFileSync(path.join(scratch, 'package-lock.json'), 'utf8'));
      const regeneratedManifest = JSON.parse(fs.readFileSync(path.join(scratch, 'package.json'), 'utf8'));
      save('lock.regenerated.json', regenerated); save('package.regenerated.json', regeneratedManifest);
      decision = { ...decision, ...compareLocks(before, regenerated),
        manifestEqual: canonical(manifest) === canonical(regeneratedManifest) };
      decision.passed = result.status === 0 && !result.error && !result.signal && decision.equal && decision.manifestEqual;
    } catch { decision.failure = 'REGENERATION_OUTPUT_INVALID'; }
    decision.workspaceUnchanged = sha256(fs.readFileSync(path.join(ROOT, 'package.json'))) === binding.manifestSha256
      && sha256(fs.readFileSync(path.join(ROOT, 'package-lock.json'))) === binding.lockSha256;
    decision.passed = decision.passed && decision.workspaceUnchanged;
    save('lock-decision.json', decision);
    console.log(JSON.stringify(decision));
    if (!decision.passed) process.exitCode = 1;
    return;
  }
  // npm ci must use the committed inputs, not adopt regeneration or lifecycle drift.
  requireUnchangedInstall(binding, JSON.parse(fs.readFileSync(path.join(reportRoot, 'lock-decision.json'), 'utf8')));
  const reports = [];
  for (const [scope, args] of [['include-dev', ['--include=dev']], ['production', ['--omit=dev']]]) {
    const result = npm(['audit', ...args, '--audit-level=info', '--json']);
    let report;
    try { report = { ...binding, ...auditReport(JSON.parse(result.stdout), { scope, exitCode: result.status, error: result.error, signal: result.signal }) }; }
    catch { report = { ...binding, scope, passed: false, failure: 'AUDIT_SCHEMA_OR_INFRASTRUCTURE_FAILURE', exitCode: result.status,
      commandError: result.error?.code || null, responseSha256: sha256(result.stdout || '') }; }
    save(`audit-${scope}.json`, report); reports.push(report);
    console.log(JSON.stringify(report));
  }
  const decision = { ...binding, passed: reports.every(report => report.passed),
    scopes: reports.map(({ scope, passed, counts, failure }) => ({ scope, passed, counts, failure })),
    baselineIsHistoricalOnly: { packageEntries: 73, distinctGhsaIds: 62 },
    nonCriticalFindingsRequireReviewBeforeLanding: true };
  save('audit-decision.json', decision);
  if (!decision.passed) process.exitCode = 1;
}

if (require.main === module) {
  try { main(process.argv[2]); }
  catch { console.error('Development dependency CI validation failed closed; inspect sanitized decision artifacts when present.'); process.exitCode = 1; }
}
module.exports = { auditReport, canonical, ciContext, compareLocks, requireUnchangedInstall };
