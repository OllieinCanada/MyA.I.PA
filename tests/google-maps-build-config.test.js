const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveGoogleMapsBrowserKey } = require('../scripts/google-maps-build-config');
const key = 'AIza' + 'A'.repeat(35);

test('production build uses the configured public browser key without a GitHub lookup', () => {
  assert.equal(resolveGoogleMapsBrowserKey({ env: { REACT_APP_GOOGLE_MAPS_API_KEY: key }, readRepositoryVariable: () => { throw new Error('must not call'); } }), key);
});
test('local builds resolve the public repository variable when the shell has no key', () => {
  assert.equal(resolveGoogleMapsBrowserKey({ env: {}, readRepositoryVariable: () => key + '\n' }), key);
});
test('CI requires its explicit key and missing or malformed keys stop the build safely', () => {
  assert.throws(() => resolveGoogleMapsBrowserKey({ env: { CI: 'true' }, readRepositoryVariable: () => key }), /Build stopped/);
  for (const value of ['', 'placeholder', 'secret-not-a-browser-key']) {
    assert.throws(() => resolveGoogleMapsBrowserKey({ env: {}, readRepositoryVariable: () => value }), /Build stopped/);
  }
  assert.throws(() => resolveGoogleMapsBrowserKey({ env: {}, readRepositoryVariable: () => { throw new Error('private diagnostic'); } }), /Build stopped/);
});
