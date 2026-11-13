const test = require('node:test');
const assert = require('node:assert/strict');
const { compareInstalled } = require('../scripts/verify-installed-lock');
const lock = packages => ({ lockfileVersion: 3, packages: { '': {}, ...packages } });
test('checks nested locked versions and fails missing required packages', () => {
  const result = compareInstalled(lock({ 'node_modules/a': { version: '1' }, 'node_modules/a/node_modules/b': { version: '2' },
    'node_modules/c': { version: '3' } }), p => p.endsWith('/c') ? null : { version: '1' });
  assert.equal(result.passed, false); assert.equal(result.verified, 1);
  assert.equal(result.mismatches[0].location, 'node_modules/a/node_modules/b');
  assert.deepEqual(result.missing, ['node_modules/c']);
});
test('reports optional omissions separately without claiming integrity', () => {
  const result = compareInstalled(lock({ 'node_modules/a': { version: '1' }, 'node_modules/os-specific': { version: '2', optional: true } }),
    p => p.endsWith('/a') ? { version: '1' } : null);
  assert.equal(result.passed, true); assert.deepEqual(result.optionalOmissions, ['node_modules/os-specific']);
});
test('rejects unsupported or escaping lock locations', () => {
  for (const location of ['../escape', 'node_modules/../escape'])
    assert.throws(() => compareInstalled(lock({ [location]: { version: '1' } }), () => null), /UNSUPPORTED_LOCK_LOCATION/);
});
