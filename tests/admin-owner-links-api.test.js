const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { registerOwnerLinkRoutes, issueOwnerLink, PAGE_PATH, REDEEM_PATH, RECEIPT_PREFIX, LINK_TTL_MS } = require('../server/adminOwnerLinks');
const config = { adminPassword: 'fixture-admin-password', sessionSecret: 'fixture-session-secret-longer-than-32-characters' };
const at = 1900000000000;
let server, base, clock = at, currentConfig = config, mode = '', sessions = 0, audits = 0, claims = 0;
const rows = new Map();
const token = (tab = 'signups') => new URL(issueOwnerLink({ config, now: at, tab }).url).hash.slice(1);
const headers = { origin: 'https://api.myaipa.ca', 'content-type': 'application/json', 'x-myaipa-owner-link': '1', 'sec-fetch-site': 'same-origin' };
const redeem = (value, extra = {}) => fetch(base + REDEEM_PATH, { method: 'POST', headers, body: JSON.stringify({ token: value }), ...extra });

before(async () => {
  const app = express(); app.use(express.json({ limit: '2kb' }));
  registerOwnerLinkRoutes({ app, getConfig: () => currentConfig, now: () => clock, claimTimeoutMs: 50,
    prisma: { runtimeStore: { create: async ({ data }) => {
      claims++;
      if (mode === 'db-down') throw new Error('fixture-private-DB-connection-string');
      if (mode === 'late-write') await new Promise(resolve => setTimeout(resolve, 150));
      if (rows.has(data.key)) throw Object.assign(new Error('unique'), { code: 'P2002' });
      rows.set(data.key, data.data);
      if (mode === 'slow') clock += LINK_TTL_MS;
      if (mode === 'lost-ack') throw new Error('fixture-private-uncertain-commit');
      return data;
    } } },
    setSession: res => { sessions++; res.setHeader('Set-Cookie', 'fixture-admin=session; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200'); },
    audit: async () => { audits++; if (mode === 'audit-down') throw new Error('audit unavailable'); },
  });
  server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise(resolve => server.close(resolve)); });

test('landing page GET is non-consuming, private, script-isolated and contains no credential', async () => {
  const start = claims;
  const response = await fetch(base + PAGE_PATH); const html = await response.text();
  assert.equal(response.status, 200); assert.match(response.headers.get('cache-control'), /no-store/);
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.match(response.headers.get('content-security-policy'), /default-src 'none'/);
  assert.doesNotMatch(response.headers.get('content-security-policy'), /unsafe-inline|unsafe-eval/);
  assert.equal(response.headers.get('set-cookie'), null); assert.equal(claims, start);
  assert.match(html, /history.replaceState/); assert.match(html, /once: true/);
  assert.doesNotMatch(html, /<img|<iframe|<script src|fixture-admin|localStorage|sessionStorage/);
  assert.equal((await fetch(base + PAGE_PATH + '?token=not-a-secret')).status, 400);
  assert.equal((await fetch(base + REDEEM_PATH)).status, 404);
  assert.equal((await fetch(base + REDEEM_PATH + '/issue', { method: 'POST' })).status, 404);
});

test('missing/foreign origin, simple requests, metadata mismatch and query extras cannot redeem', async () => {
  const value = token(), start = claims;
  for (const changed of [{ origin: '' }, { origin: 'https://evil.example' }, { origin: 'https://www.myaipa.ca' },
    { origin: 'null' }, { 'x-myaipa-owner-link': '' }, { 'content-type': 'text/plain' }, { 'sec-fetch-site': 'cross-site' }]) {
    const response = await redeem(value, { headers: { ...headers, ...changed } });
    assert.equal(response.status, 403); assert.equal(response.headers.get('set-cookie'), null);
  }
  assert.equal((await fetch(base + REDEEM_PATH + '?next=https://evil.example', { method: 'POST', headers, body: JSON.stringify({ token: value }) })).status, 403);
  assert.equal(claims, start);
});

test('invalid bodies and credentials perform no claim or session issuance', async () => {
  const start = claims;
  for (const body of [{ token: 'invalid' }, { token: token(), returnUrl: 'https://evil.example' }, { token: {} }, [], {}, { token: 'x'.repeat(1100) }]) {
    const response = await redeem('', { body: JSON.stringify(body) });
    assert.equal(response.status, 401); assert.equal(response.headers.get('set-cookie'), null);
  }
  assert.equal(claims, start);
});

test('only one concurrent redemption wins; replay remains denied without another cookie', async () => {
  const value = token('costs'), beforeSessions = sessions;
  const results = await Promise.all(Array.from({ length: 12 }, () => redeem(value)));
  assert.equal(results.filter(r => r.status === 200).length, 1); assert.equal(sessions - beforeSessions, 1);
  for (const response of results) {
    assert.match(response.headers.get('cache-control'), /no-store/);
    if (response.status === 200) {
      assert.match(response.headers.get('set-cookie'), /Secure; HttpOnly; SameSite=Lax/);
      assert.deepEqual(await response.json(), { ok: true, tab: 'costs' });
    } else { assert.equal(response.status, 401); assert.equal(response.headers.get('set-cookie'), null); }
  }
  const replay = await redeem(value); assert.equal(replay.status, 401); assert.equal(replay.headers.get('set-cookie'), null);
  for (const [key, data] of rows) {
    assert.match(key, new RegExp('^' + RECEIPT_PREFIX + '[a-f0-9]{64}$'));
    assert.deepEqual(Object.keys(data).sort(), ['expiresAt', 'usedAt']); assert.ok(!JSON.stringify(data).includes(value));
  }
});

test('database failure and uncertain commits never issue a session or retry the claim', async () => {
  const start = sessions;
  for (const scenario of ['db-down', 'lost-ack']) {
    mode = scenario; const value = token(), beforeClaims = claims;
    const response = await redeem(value); assert.equal(response.status, 503);
    assert.equal(response.headers.get('set-cookie'), null); assert.equal(claims - beforeClaims, 1);
    assert.doesNotMatch(await response.text(), /fixture-private|connection-string/);
    mode = '';
    if (scenario === 'lost-ack') assert.equal((await redeem(value)).status, 401);
  }
  assert.equal(sessions, start);
});

test('expiry during the database write and MFA enablement prevent session issuance', async () => {
  const start = sessions; mode = 'slow';
  const expired = await redeem(token()); assert.equal(expired.status, 401); assert.equal(expired.headers.get('set-cookie'), null);
  mode = ''; clock = at; currentConfig = { ...config, totpEnabled: true };
  const mfa = await redeem(token()); assert.equal(mfa.status, 401); assert.equal(mfa.headers.get('set-cookie'), null);
  currentConfig = config; assert.equal(sessions, start);
});

test('a stalled write times out without a cookie; a late commit never issues one or permits replay', async () => {
  mode = 'late-write'; const value = token(), start = sessions, beforeClaims = claims;
  const failed = await redeem(value); assert.equal(failed.status, 503); assert.equal(failed.headers.get('set-cookie'), null);
  assert.equal(claims - beforeClaims, 1);
  await new Promise(resolve => setTimeout(resolve, 170)); mode = '';
  assert.equal(sessions, start); assert.equal((await redeem(value)).status, 401);
});

test('audit failure cannot turn successful sign-in into a misleading retry', async () => {
  mode = 'audit-down'; const start = sessions, startAudits = audits;
  const response = await redeem(token()); assert.equal(response.status, 200); assert.equal(sessions, start + 1); assert.equal(audits, startAudits + 1);
  mode = '';
});
