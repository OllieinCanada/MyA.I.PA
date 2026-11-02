'use strict';
const assert = require('node:assert/strict');
const ENGINE_TIMEOUT_MS = 180000;
const WORKER_CLEANUP_MS = 15000;
const engines = ['chromium', 'firefox', 'webkit'];
const modes = ['normal', 'fallback', 'exhausted', 'stalled'];
const sizes = ['phone', 'tablet', 'desktop'];
function selection(value, allowed) {
  const result = (value === undefined ? allowed.join(',') : value).split(',');
  assert.ok(result.length && result.every(item => allowed.includes(item)), 'Unknown or empty audio selection');
  assert.equal(new Set(result).size, result.length, 'Duplicate audio selection');
  return result;
}
function casesFor(engine, selectedModes, selectedSizes) {
  assert.ok(engines.includes(engine));
  return selectedModes.flatMap(mode => (mode === 'normal' ? selectedSizes : ['phone']).map(viewport => ({ engine, mode, viewport })));
}
const caseKey = value => [value.engine, value.viewport, value.mode].join('|');
function verifyCoverage(report, expected, player, status) {
  assert.equal(status, 0, 'Audio worker did not exit successfully');
  assert.equal(report.player, player);
  assert.equal(report.passed, true, 'Audio worker reported failure or incomplete coverage');
  assert.equal(report.productionWrites, 0);
  assert.equal(report.physicalDeviceProof, false);
  assert.equal(report.failure, null);
  assert.equal(report.results.length, expected.length, 'Audio case count is incomplete');
  assert.ok(report.results.every(result => result.passed === true));
  assert.deepEqual(report.results.map(caseKey).sort(), expected.map(caseKey).sort(), 'Audio worker coverage does not match the requested matrix');
}
module.exports = { ENGINE_TIMEOUT_MS, WORKER_CLEANUP_MS, engines, modes, sizes, selection, casesFor, caseKey, verifyCoverage };
