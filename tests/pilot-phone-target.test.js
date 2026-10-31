const test = require('node:test');
const assert = require('node:assert/strict');
const { requirePilotPhone } = require('../scripts/pilot-phone-target');

test('pilot operations require an explicit valid target', () => {
  for (const value of [undefined, '', '123', 'not a phone', 'x4165550123', '+00000000000']) {
    assert.throws(() => requirePilotPhone(value), /explicit valid/);
  }
  assert.equal(requirePilotPhone('(416) 555-0123'), '+14165550123');
  assert.equal(requirePilotPhone('+44 20 7946 0123'), '+442079460123');
  assert.equal(requirePilotPhone('+6123456789'), '+6123456789');
});

test('retired lines cannot be reused by an operation, including formatted input', () => {
  for (const value of ['+12494441086', '12494441086', '(249) 444-1086', '+1 249-468-2588', '2494682588']) {
    assert.throws(() => requirePilotPhone(value), /retired and held/);
  }
});

test('explicit read-only diagnostics can still inspect a held retired line', () => {
  assert.equal(requirePilotPhone('+12494682588', { readOnly: true }), '+12494682588');
  assert.throws(() => requirePilotPhone('', { readOnly: true }), /explicit valid/);
});
