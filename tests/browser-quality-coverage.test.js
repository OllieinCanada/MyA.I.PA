const test = require('node:test');
const assert = require('node:assert/strict');
const { coversCatalog } = require('../scripts/browser-quality-coverage');
test('focused passes cannot satisfy complete route coverage', () => {
  assert.equal(coversCatalog(['trades'], ['home', 'signup', 'trades']), false);
  assert.equal(coversCatalog(['home', 'trades', 'signup'], ['home', 'signup', 'trades']), true);
});
test('duplicates, absent routes, and empty requirements cannot fabricate full coverage', () => {
  for (const requested of [[], ['home', 'home'], ['home', 'unknown']]) assert.equal(coversCatalog(requested, ['home', 'signup']), false);
  assert.equal(coversCatalog([], []), false);
});
