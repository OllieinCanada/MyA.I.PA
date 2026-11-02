const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const uri = require('fast-uri');

test('the URI security override, lock and installed package agree', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  assert.equal(manifest.overrides['fast-uri'], '3.1.9');
  assert.equal(lock.packages['node_modules/fast-uri'].version, '3.1.9');
  assert.equal(require('fast-uri/package.json').version, '3.1.9');
});

test('encoded schemes cannot become active schemes during normalization or resolution', () => {
  for (const input of ['%6Aavascript:alert(1)', '%u006Aavascript:alert(1)']) {
    assert.ok(uri.parse(input).error, 'a malformed scheme is rejected');
    assert.equal(uri.normalize(input), input, 'invalid input must not become an executable scheme');
    assert.throws(() => uri.resolve('https://business.example.invalid/', input));
    assert.equal(uri.equal(input, 'javascript:alert(1)'), false);
  }
});

test('normalizing a relative reference preserves its resolution semantics', () => {
  const base = 'https://business.example.invalid/a/b/';
  for (const reference of ['../job', '../../job', './a/../job', 'job/../callback']) {
    assert.equal(uri.resolve(base, uri.normalize(reference)), uri.resolve(base, reference));
    assert.equal(uri.resolve(base, reference), new URL(reference, base).href);
  }
});

test('a path-only suffix cannot introduce a scheme', () => {
  const serialized = uri.serialize({ path: 'javascript:alert(1)' }, { reference: 'suffix' });
  assert.notEqual(serialized, 'javascript:alert(1)');
  assert.equal(uri.parse(serialized).scheme, undefined);
});

test('host and authority handling fail closed without changing normal hostnames', () => {
  assert.equal(uri.normalize('https://%45XAMPLE.invalid/jobs'), 'https://example.invalid/jobs');
  assert.ok(uri.parse('http://[example.invalid/').error);
  assert.throws(() => uri.serialize({ scheme: 'http', host: 'trusted.invalid', port: '80@other.invalid' }));
  assert.equal(uri.parse('https://business.example.invalid:443/jobs').host, 'business.example.invalid');
});

for (const parent of ['ajv-formats', 'schema-utils', 'workbox-build']) {
  test(`${parent}'s AJV still resolves and validates local schema references`, () => {
    const parentRequire = createRequire(path.join(root, 'node_modules', parent, 'package.json'));
    const Ajv = parentRequire('ajv');
    const ajv = new Ajv({ allErrors: false, strict: true });
    const validate = ajv.compile({
      $id: 'https://schemas.example.invalid/intake.json',
      type: 'object', additionalProperties: false, required: ['caller'],
      properties: { caller: { $ref: '#/$defs/caller' } },
      $defs: { caller: { type: 'string', minLength: 1, maxLength: 100 } },
    });
    assert.equal(validate({ caller: 'Synthetic caller' }), true);
    assert.equal(validate({ caller: '' }), false);
    assert.equal(validate({ caller: 7 }), false);
    assert.equal(validate({ caller: 'Synthetic caller', extra: true }), false);
  });
}
