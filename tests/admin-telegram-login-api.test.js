const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const { registerTelegramLogin, PATH, POST_PATH, COOKIE, TTL } = require('../server/adminTelegramLogin');
const at = 1900000000000;
const config = { enabled: true, botToken: 'fixture-bot-only', ownerId: '1234567', chatId: '1234567', sessionSecret: 'fixture-session-secret-more-than-32-characters' };
function proof(time = at, owner = '1234567') {
  const p = { id: owner, auth_date: String(Math.floor(time / 1000)), first_name: 'Fixture' };
  const key = crypto.createHash('sha256').update(config.botToken).digest();
  p.hash = crypto.createHmac('sha256', key).update(Object.keys(p).sort().map(k => k + '=' + p[k]).join('\n')).digest('hex'); return p;
}
let base, server, sessions = 0, claims = 0, active = config, clock = at, mode = '';
const used = new Set();
before(async () => {
  const app = express(); app.use(express.json({ limit: '4kb' }));
  registerTelegramLogin({ app, getConfig: () => active, now: () => clock, claimTimeoutMs: 30,
    prisma: { runtimeStore: { create: async ({ data }) => {
      claims++; if (mode === 'db-down') throw Error('private-db-error');
      if (mode === 'late') await new Promise(resolve => setTimeout(resolve, 100));
      if (used.has(data.key)) throw Object.assign(Error('duplicate'), { code: 'P2002' });
      used.add(data.key); assert.deepEqual(Object.keys(data.data).sort(), ['expiresAt', 'usedAt']);
      if (mode === 'lost-ack') throw Error('private-lost-ack');
    } } },
    setSession: res => { sessions++; res.setHeader('Set-Cookie', 'fixture-admin=session; Path=/; Secure; HttpOnly; SameSite=Lax'); },
  });
  server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = 'http://127.0.0.1:' + server.address().port;
});
after(async () => { await new Promise(resolve => server.close(resolve)); });
async function landing(query = '') {
  const r = await fetch(base + PATH + query), html = await r.text();
  const cookie = r.headers.get('set-cookie')?.split(';')[0];
  return { r, html, cookie, challenge: cookie?.slice(COOKIE.length + 1) };
}
async function redeem(page, p = proof(), target = { tab: 'signups' }, extra = {}) {
  return fetch(base + POST_PATH, { method: 'POST', headers: { origin: 'https://api.myaipa.ca', 'content-type': 'application/json',
    'x-myaipa-telegram': '1', cookie: page.cookie, ...(extra.headers || {}) }, body: JSON.stringify({ challenge: page.challenge, proof: p, target }), ...extra });
}
test('GET is inert: no authentication claim or admin cookie, no reflected query/profile, strict CSP and URL scrubbing', async () => {
  const start = claims, page = await landing('?id=PRIVATE_PROFILE_CANARY&hash=PRIVATE_PROOF_CANARY&tab=signups');
  assert.equal(page.r.status, 200); assert.equal(claims, start); assert.match(page.r.headers.get('set-cookie'), /Secure; HttpOnly; SameSite=Strict/);
  assert.doesNotMatch(page.r.headers.get('set-cookie'), /fixture-admin/);
  assert.doesNotMatch(page.html, /PRIVATE_PROFILE_CANARY|PRIVATE_PROOF_CANARY/);
  assert.match(page.html, /history.replaceState/); assert.match(page.html, /params.getAll/);
  assert.match(page.r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(page.r.headers.get('referrer-policy'), 'no-referrer'); assert.match(page.r.headers.get('cache-control'), /no-store/);
});
test('owner can open the exact incident once; replay across new browser challenge still denied', async () => {
  const p = proof(), target = { tab: 'attention', incident: 'b'.repeat(24) }, page = await landing(), start = sessions;
  const results = await Promise.all(Array.from({ length: 8 }, () => redeem(page, p, target)));
  assert.equal(results.filter(r => r.status === 200).length, 1); assert.equal(sessions, start + 1);
  const success = results.find(r => r.status === 200); assert.deepEqual(await success.json(), { ok: true, target });
  assert.ok(results.filter(r => r.status !== 200).every(r => r.status === 401 && !r.headers.get('set-cookie')));
  const replay = await redeem(await landing(), p, target); assert.equal(replay.status, 401); assert.equal(replay.headers.get('set-cookie'), null);
});
test('wrong identity, forged hash, stale identity, missing/foreign cookie and redirect injection never claim', async () => {
  const page = await landing(), start = claims;
  for (const p of [proof(at, '999'), { ...proof(at + 1000), hash: '0'.repeat(64) }, proof(at - TTL)]) assert.equal((await redeem(page, p)).status, 401);
  assert.equal((await redeem(page, proof(at + 1000), { tab: 'overview', returnUrl: 'https://evil.example' })).status, 401);
  const other = await landing(); assert.equal((await redeem({ ...page, cookie: other.cookie }, proof(at + 1000))).status, 401);
  assert.equal(claims, start);
});
test('foreign origin, non-JSON requests and disabled/MFA configurations do not authenticate', async () => {
  const page = await landing(); const beforeSessions = sessions;
  const foreign = await redeem(page, proof(), undefined, { headers: { origin: 'https://evil.example', 'content-type': 'application/json' } });
  assert.equal(foreign.status, 403);
  active = { ...config, enabled: false }; assert.equal((await landing()).r.status, 503);
  assert.equal((await redeem(page)).status, 503); active = { ...config, totpEnabled: true };
  assert.equal((await redeem(page)).status, 503); active = config; assert.equal(sessions, beforeSessions);
});
test('failure, lost acknowledgement and late DB completion cannot issue a session or permit replay', async () => {
  const start = sessions;
  for (const [offset, failure] of [[2000, 'db-down'], [3000, 'lost-ack'], [4000, 'late']]) {
    mode = failure; const p = proof(at - offset), page = await landing();
    const r = await redeem(page, p); assert.equal(r.status, 503); assert.equal(r.headers.get('set-cookie'), null);
    assert.doesNotMatch(await r.text(), /private-db|private-lost/);
    if (mode === 'late') await new Promise(resolve => setTimeout(resolve, 130));
    mode = ''; if (failure !== 'db-down') assert.equal((await redeem(page, p)).status, 401);
  }
  assert.equal(sessions, start);
});
