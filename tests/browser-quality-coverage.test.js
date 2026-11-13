const test = require('node:test');
const assert = require('node:assert/strict');
const { coversCatalog } = require('../scripts/browser-quality-coverage');
const { ENGINES, ROUTES, requiredMatrix, assessCoverage, browserQualityPassed } = require('../scripts/browser-quality-coverage');
const full = () => ({ ready: true, requestedEngines: ENGINES, requestedRoutes: ROUTES,
  checks: requiredMatrix(), completedChecks: requiredMatrix().length, warningCount: 0, failure: '', networkIsolation: { unexpectedWrites: [] } });
test('focused passes cannot satisfy complete route coverage', () => {
  assert.equal(coversCatalog(['trades'], ['home', 'signup', 'trades']), false);
  assert.equal(coversCatalog(['home', 'trades', 'signup'], ['home', 'signup', 'trades']), true);
});
test('readiness requires every engine, page viewport and signup journey exactly once', () => {
  const value = full(); assert.equal(value.completedChecks, 93); assert.equal(browserQualityPassed(value), true);
  for (let index = 0; index < value.checks.length; index++) {
    const checks = value.checks.filter((_, i) => i !== index);
    assert.equal(browserQualityPassed({ ...value, checks, completedChecks: checks.length }), false, `missing matrix row ${index}`);
  }
  const chromium = value.checks.filter(row => row.engine === 'chromium');
  assert.equal(chromium.length, 33);
  assert.equal(browserQualityPassed({ ...value, requestedEngines: ['chromium'], checks: chromium, completedChecks: 33 }), false);
  assert.equal(assessCoverage({ ...value, requestedEngines: ['chromium'] }).complete, false);
  assert.equal(browserQualityPassed({ ...value, checks: [...value.checks, value.checks[0]], completedChecks: 94 }), false);
  assert.equal(browserQualityPassed({ ...value, networkIsolation: { unexpectedWrites: [{}] } }), false);
});
test('shipping reporter rejects a forged-ready Chromium-only artifact and accepts only complete evidence', () => {
  const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
  const { spawnSync } = require('node:child_process');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-reporter-'));
  try {
    fs.mkdirSync(path.join(root, 'scripts')); fs.mkdirSync(path.join(root, 'diagnostics', 'shipping-readiness'), { recursive: true });
    for (const name of ['report-shipping-readiness.js', 'launch-evidence.js', 'browser-quality-coverage.js'])
      fs.copyFileSync(path.join(__dirname, '..', 'scripts', name), path.join(root, 'scripts', name));
    fs.writeFileSync(path.join(root, 'scripts', '_helpers.js'), `const path=require('node:path');exports.rootPath=(...parts)=>path.join(__dirname,'..',...parts);`);
    const value = { ...full(), checkedAt: new Date().toISOString() };
    for (const partial of [true, false]) {
      const checks = partial ? value.checks.filter(row => row.engine === 'chromium') : value.checks;
      const report = { ...value, checks, completedChecks: checks.length, requestedEngines: partial ? ['chromium'] : ENGINES };
      fs.writeFileSync(path.join(root, 'diagnostics', 'shipping-readiness', 'browser-quality-gate.json'), JSON.stringify(report));
      const child = spawnSync(process.execPath, [path.join(root, 'scripts', 'report-shipping-readiness.js')],
        { env: { ...process.env, READINESS_RELEASE_COMMIT: 'a'.repeat(40) }, encoding: 'utf8', timeout: 15000 });
      assert.equal(child.status, 0, child.stderr);
      const result = JSON.parse(fs.readFileSync(path.join(root, 'diagnostics', 'shipping-readiness', 'shipping-readiness.json')));
      assert.equal(result.gates.find(row => row.id === 'browser').status, partial ? 'failed' : 'passed');
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test('duplicates, absent routes, and empty requirements cannot fabricate full coverage', () => {
  for (const requested of [[], ['home', 'home'], ['home', 'unknown']]) assert.equal(coversCatalog(requested, ['home', 'signup']), false);
  assert.equal(coversCatalog([], []), false);
});
