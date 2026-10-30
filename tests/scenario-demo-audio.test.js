const test = require('node:test');
const assert = require('node:assert/strict');
const {check} = require('../scripts/prepare-scenario-demo-audio');
test('every available scenario has a checked compact MP3 and its unchanged original WAV fallback', () => {
  assert.deepEqual(check(), {ok:true, recordings:5, originalsPreserved:true});
});
