const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const plan = require('../scripts/public-demo-audio-plan');
test('each engine has its own unchanged 180-second bound plus limited cleanup', () => {
  assert.equal(plan.ENGINE_TIMEOUT_MS, 180000);
  assert.equal(plan.WORKER_CLEANUP_MS, 15000);
});
test('the complete player matrix has eighteen unique real playback cases', () => {
  const cases = plan.engines.flatMap(engine => plan.casesFor(engine, plan.modes, plan.sizes));
  assert.equal(cases.length, 18); assert.equal(new Set(cases.map(plan.caseKey)).size, 18);
  assert.equal(cases.filter(item => item.mode === 'normal').length, 9);
  assert.ok(cases.filter(item => item.mode !== 'normal').every(item => item.viewport === 'phone'));
});
test('unknown, empty entries and duplicate selections fail closed', () => {
  for (const input of ['', 'safari', 'chromium,', 'chromium,chromium']) assert.throws(() => plan.selection(input, plan.engines));
  assert.deepEqual(plan.selection(undefined, plan.engines), plan.engines);
});
const cases = plan.casesFor('webkit', plan.modes, plan.sizes);
const report = () => ({ player: 'hero', passed: true, productionWrites: 0, physicalDeviceProof: false, failure: null, results: cases.map(item => ({ ...item, passed: true })) });
test('coverage requires success and every requested case exactly once', () => {
  plan.verifyCoverage(report(), cases, 'hero', 0);
  for (const status of [1,124,null]) assert.throws(() => plan.verifyCoverage(report(), cases, 'hero', status));
  for (const change of [value => { value.results.pop(); }, value => { value.results[0] = value.results[1]; }, value => { value.results[0].passed = false; }, value => { value.passed = false; }, value => { value.failure = { message: 'timeout' }; }, value => { value.player = 'scenario'; }, value => { value.productionWrites = 1; }]) {
    const value = report(); change(value); assert.throws(() => plan.verifyCoverage(value, cases, 'hero', 0));
  }
});
test('player startup and launch deadlines are not relaxed and worker reports checkpoint before cleanup', () => {
  const root = path.resolve(__dirname, '..');
  const hook = fs.readFileSync(path.join(root, 'src/usePublicDemoAudio.js'), 'utf8');
  const harness = fs.readFileSync(path.join(root, 'scripts/test-public-demo-audio.js'), 'utf8');
  assert.match(hook, /PLAYBACK_START_TIMEOUT_MS = 15000/);
  assert.match(harness, /headless: true, timeout: 15000/);
  assert.match(harness, /page.setDefaultTimeout\(20000\)/);
  assert.match(harness, /audio.currentTime > 0\.2/);
  assert.match(harness, /save\(failure === null && results.length === expectedCases.length\);\s+fixture.server.closeAllConnections/);
  assert.match(harness, /fs.renameSync\(temporary, filename\)/);
});
