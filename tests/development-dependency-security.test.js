const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('the shared shell-quote dependency is pinned to the reviewed patched version', () => {
  const root = path.join(__dirname, '..');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  assert.equal(pkg.overrides['shell-quote'], '1.11.0');
  const copies = Object.entries(lock.packages).filter(([name]) => /(?:^|\/)node_modules\/shell-quote$/.test(name));
  assert.ok(copies.length > 0);
  for (const [name, copy] of copies) assert.equal(copy.version, '1.11.0', name);
  assert.equal(require('shell-quote/package.json').version, '1.11.0');
});
test('quoting rejects the advisory shape without running any shell command', () => {
  const { quote } = require('shell-quote');
  assert.throws(() => quote(['echo', 'fixture', { comment: 'fixture' }, 'first\nsecond']), TypeError);
  assert.equal(typeof quote(['echo', 'ordinary fixture value']), 'string');
});
