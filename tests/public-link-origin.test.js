'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { publicLinkBase, verificationLinkBase, configuredBase } = require('../server/publicLinkOrigin');
const req = { headers: { host: 'attacker.invalid', 'x-forwarded-host': 'attacker.invalid', 'x-forwarded-proto': 'https', origin: 'https://attacker.invalid' }, socket: { localPort: 8799 } };
test('configured production origin ignores all untrusted request headers', () => {
  assert.equal(publicLinkBase(req, { NODE_ENV: 'production', PUBLIC_APP_URL: 'https://api.myaipa.ca/' }), 'https://api.myaipa.ca');
  assert.equal(publicLinkBase(req, { NODE_ENV: 'production', APP_URL: 'https://api.myaipa.ca' }), 'https://api.myaipa.ca');
});
test('production without trusted configuration fails closed, never inherits request host', () => {
  assert.throws(() => publicLinkBase(req, { NODE_ENV: 'production' }), /configured/);
});
test('development links use only the listening port, never a request host or protocol', () => {
  assert.equal(publicLinkBase(req, { NODE_ENV: 'test' }), 'http://127.0.0.1:8799');
  assert.equal(publicLinkBase({}, { PORT: '8787' }), 'http://127.0.0.1:8787');
});
test('explicit verification origin is independently validated and wins over app origin', () => {
  assert.equal(verificationLinkBase(req, { NODE_ENV: 'production', SIGNUP_VERIFICATION_BASE_URL: 'https://api.myaipa.ca', PUBLIC_APP_URL: 'https://www.myaipa.ca' }), 'https://api.myaipa.ca');
});
for (const url of ['javascript:alert(1)', 'http://api.myaipa.ca', 'https://localhost', 'https://127.0.0.1', 'https://[::1]',
  'https://10.0.0.1', 'https://test.internal', 'https://user:pass@example.com', 'https://example.com/?token=bad', 'https://example.com/#bad',
  'https://example.com/"onclick="bad', 'https://example.com/\r\nInjected: bad']) test('rejects unsafe configured base ' + JSON.stringify(url), () => {
  assert.throws(() => configuredBase(url, true));
});
test('safe configured path prefixes are preserved without accepting query or credential state', () => {
  assert.equal(configuredBase('https://example.com/application/', true), 'https://example.com/application');
});
