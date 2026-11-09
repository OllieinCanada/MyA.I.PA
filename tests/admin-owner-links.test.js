const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { issueOwnerLink, verifyOwnerLink, LINK_TTL_MS, API_ORIGIN, PAGE_PATH } = require('../server/adminOwnerLinks');
const { main } = require('../scripts/create-admin-owner-link');

const config = { adminPassword: 'fixture-admin-password', sessionSecret: 'fixture-session-secret-that-is-over-32-characters', totpEnabled: false };
const at = 1900000000000;
const tokenOf = link => new URL(link.url).hash.slice(1);

test('issuer produces random, signed, fixed-host links with a 10-minute lifetime and no query secret', () => {
  const one = issueOwnerLink({ config, now: at }), two = issueOwnerLink({ config, now: at });
  const url = new URL(one.url);
  assert.equal(url.origin, API_ORIGIN); assert.equal(url.pathname, PAGE_PATH); assert.equal(url.search, '');
  assert.notEqual(one.url, two.url); assert.equal(Date.parse(one.expiresAt), at + LINK_TTL_MS);
  const data = verifyOwnerLink(tokenOf(one), config, at);
  assert.equal(data.tab, 'signups'); assert.equal(data.jti.length, 43);
  assert.doesNotMatch(one.url, /fixture-admin|fixture-session/);
});

test('expiration boundaries, future issuance and credential rotation fail closed', () => {
  const token = tokenOf(issueOwnerLink({ config, now: at }));
  assert.ok(verifyOwnerLink(token, config, at + LINK_TTL_MS - 1));
  for (const time of [at - 1, at + LINK_TTL_MS, at + LINK_TTL_MS + 1]) assert.equal(verifyOwnerLink(token, config, time), null);
  for (const changed of [{ ...config, adminPassword: 'rotated' }, { ...config, sessionSecret: 'another-fixture-secret-at-least-32-characters' },
    { ...config, totpEnabled: true }, {}, { ...config, sessionSecret: 'short' }]) {
    assert.equal(verifyOwnerLink(token, changed, at), null);
    if (!changed.adminPassword || !changed.sessionSecret || changed.sessionSecret.length < 32 || changed.totpEnabled) {
      assert.throws(() => issueOwnerLink({ config: changed, now: at }));
    }
  }
});

test('invalid, truncated, oversized, mutated and session-shaped credentials are rejected', () => {
  const token = tokenOf(issueOwnerLink({ config, now: at }));
  for (const bad of [null, {}, 3, '', token + '.x', token.slice(1), 'x'.repeat(1025), token.replace('.', '='),
    token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A'), Buffer.from('{"exp":9999999999999}').toString('base64url') + '.' + 'a'.repeat(64)]) {
    assert.equal(verifyOwnerLink(bad, config, at), null);
  }
});

test('even correctly signed malformed payloads cannot extend TTL, change scope or redirect outside admin', () => {
  const token = tokenOf(issueOwnerLink({ config, now: at }));
  const data = JSON.parse(Buffer.from(token.split('.')[0], 'base64url'));
  const key = crypto.createHmac('sha256', config.sessionSecret).update('myaipa-owner-sign-in:v1\0').update(config.adminPassword).digest();
  const sign = value => { const p = Buffer.from(JSON.stringify(value)).toString('base64url'); return p + '.' + crypto.createHmac('sha256', key).update(p).digest('base64url'); };
  for (const change of [{ exp: at + LINK_TTL_MS + 1 }, { iat: at + .5 }, { v: 2 }, { tab: '//evil.example' },
    { tab: 'https://evil.example' }, { jti: '' }, { jti: 123 }, { returnUrl: 'https://evil.example' }]) {
    assert.equal(verifyOwnerLink(sign({ ...data, ...change }), config, at), null);
  }
  assert.throws(() => issueOwnerLink({ config, tab: 'https://evil.example', now: at }));
});

test('CLI defaults to no issuance and requires explicit confirmation without exposing errors or env values', () => {
  const env = { ADMIN_PASSWORD: config.adminPassword, ADMIN_SESSION_SECRET: config.sessionSecret };
  const output = [];
  main([], env, text => output.push(text)); assert.match(output[0], /No link issued/); assert.doesNotMatch(output[0], /fixture-/);
  for (const args of [['--issue'], ['--issue', '--confirm=wrong'], ['--issue', '--confirm=ISSUE_ONE_USE_ADMIN_LINK', '--bad'],
    ['--issue', '--confirm=ISSUE_ONE_USE_ADMIN_LINK', '--tab=calls', '--tab=costs']]) assert.throws(() => main(args, env));
  main(['--issue', '--confirm=ISSUE_ONE_USE_ADMIN_LINK', '--tab=calls'], env, text => output.push(text));
  const issued = JSON.parse(output[1]); assert.equal(issued.oneUse, true);
  assert.equal(verifyOwnerLink(tokenOf(issued), config).tab, 'calls');
  assert.throws(() => main(['--issue', '--confirm=ISSUE_ONE_USE_ADMIN_LINK'], { ...env, ADMIN_TOTP_SECRET: 'configured' }));
});
