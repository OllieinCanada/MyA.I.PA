const test = require('node:test'), assert = require('node:assert/strict');
const { OVERLAYS, REQUIRED_CASES, validatePins, validateSqlTarget, validateCoverage } = require('../scripts/compose-bounded-mapping-integration');
const pins = require('../scripts/bounded-mapping-integration-pins.json');
test('immutable dependency provenance is valid and only public integration source is allowlisted', () => {
  validatePins(pins); assert.equal(OVERLAYS.length, 7); assert.equal(new Set(OVERLAYS).size, 7);
  assert.ok(OVERLAYS.every(p => !/diagnostics|\.env|policy|provider-state|security-evidence/.test(p)));
  for (const changed of [{ ...pins, repository: 'other' }, { ...pins, combinedTree: 'main' }, { ...pins, node: '20' }]) assert.throws(() => validatePins(changed));
});
test('SQL resources must be explicit owned loopback CI, never a provider or local ambient database', () => {
  const env = { CI: 'true', GITHUB_ACTIONS: 'true' };
  assert.equal(validateSqlTarget('postgresql://ci:synthetic@127.0.0.1:5432/ci', env).pathname, '/ci');
  for (const url of ['postgresql://ci:x@database.example/ci', 'postgresql://ci:x@127.0.0.1/production', 'postgresql://owner:x@127.0.0.1/ci']) assert.throws(() => validateSqlTarget(url, env));
  assert.throws(() => validateSqlTarget('postgresql://ci:x@127.0.0.1/ci', {}));
});
test('all real-reader SQL cases are required, no subset or injected-evidence report is green', () => {
  const good = { schemaVersion: 1, ready: true, providerMode: 'synthetic-no-send', sqlMode: 'real-postgresql', cases: REQUIRED_CASES.map(name => ({ name, status: 'passed' })) };
  assert.equal(validateCoverage(good), true);
  for (const bad of [{ ...good, cases: good.cases.slice(1) }, { ...good, sqlMode: 'synthetic' }, { ...good, ready: false },
    { ...good, cases: [...good.cases.slice(1), good.cases[1]] }, { ...good, cases: good.cases.map((c, i) => i ? c : { ...c, status: 'skipped' }) }]) assert.equal(validateCoverage(bad), false);
});
