const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const { loginKeyboard, verifyAuthorization, registerTelegramAdminLogin, CALLBACK, COOKIE } = require('../server/telegramAdminLogin');
const env = { TELEGRAM_ADMIN_LOGIN_ENABLED: 'true', TELEGRAM_ADMIN_USER_ID: '123456', TELEGRAM_BOT_TOKEN: 'test-bot-secret' };
const now = 1792097000000;
const conf = { enabled: true, token: env.TELEGRAM_BOT_TOKEN, userId: env.TELEGRAM_ADMIN_USER_ID };
function signed(changes = {}) {
  const p = new URLSearchParams({ id: conf.userId, first_name: 'Ollie', auth_date: String(now / 1000), ...changes });
  const data = [...p].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  p.set('hash', crypto.createHmac('sha256', crypto.createHash('sha256').update(conf.token).digest()).update(data).digest('hex'));
  p.set('target', 'https://www.myaipa.ca/#/admin?tab=attention&incident=463f4282b3457e8b4a37136f');
  return p;
}
test('only exact admin URLs become native Telegram login buttons; callbacks and external URLs stay unchanged', () => {
  const markup = { inline_keyboard: [[{ text: 'Issue', url: 'https://www.myaipa.ca/#/admin?tab=attention&incident=463f4282b3457e8b4a37136f' }, { text: 'Other', url: 'https://evil.example/#/admin' }, { text: 'Action', callback_data: 'keep' }]] };
  const out = loginKeyboard(markup, env);
  assert.ok(out.inline_keyboard[0][0].login_url.url.startsWith('https://api.myaipa.ca/api/admin/telegram-login?'));
  assert.equal(out.inline_keyboard[0][0].url, undefined);
  assert.deepEqual(out.inline_keyboard[0].slice(1), markup.inline_keyboard[0].slice(1));
  assert.deepEqual(loginKeyboard(markup, {}), markup);
  assert.equal(loginKeyboard({ inline_keyboard: [[{text:'No',url:'https://www.myaipa.ca/#/admin?redirect=https://evil.example'}]] }, env).inline_keyboard[0][0].login_url, undefined);
});
test('signature, owner ID, freshness, duplicate fields and redirect restrictions fail closed', () => {
  assert.equal(verifyAuthorization(signed(), conf, now).userId, '123456');
  for (const p of [signed({ id: '555' }), signed({ auth_date: String(now / 1000 - 121) }), signed({ auth_date: String(now / 1000 + 16) })]) assert.throws(() => verifyAuthorization(p, conf, now));
  const forged = signed(); forged.set('first_name', 'Changed'); assert.throws(() => verifyAuthorization(forged, conf, now));
  const duplicate = signed(); duplicate.append('id', '123456'); assert.throws(() => verifyAuthorization(duplicate, conf, now));
  const redirect = signed(); redirect.set('target', 'https://evil.example/'); assert.throws(() => verifyAuthorization(redirect, conf, now));
  assert.throws(() => verifyAuthorization(signed(), { ...conf, enabled: false }, now));
});
test('browser-bound POST issues a session once; previews, wrong origins, replay and DB outage cannot log in', async () => {
  const app = express(), used = new Set(), sessions = [], audits = [];
  let databaseDown = false;
  registerTelegramAdminLogin(app, { env, now: () => now, rateLimiter: (_q,_s,n) => n(),
    sessionSecret: () => 'separate-session-secret', setSession: res => { sessions.push(true); res.set('Set-Cookie', 'admin=test; HttpOnly'); },
    audit: async outcome => audits.push(outcome), prisma: { runtimeStore: { create: async ({data}) => { if (databaseDown || used.has(data.key)) throw Error('Cannot claim'); used.add(data.key); } } } });
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const get = await fetch(`${base}${CALLBACK}?${signed()}`);
    const cookie = get.headers.get('set-cookie').split(';')[0], html = await get.text();
    assert.equal(sessions.length, 0); // GET/link scanners never create admin sessions.
    assert.match(cookie, new RegExp(`^${COOKIE}=`));
    assert.match(get.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    const body = new URLSearchParams({ payload: html.match(/name="payload" value="([^"]+)"/)[1], nonce: html.match(/name="nonce" value="([^"]+)"/)[1] });
    const post = (headers = {}) => fetch(base + CALLBACK, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'https://api.myaipa.ca', Cookie: cookie, ...headers }, body });
    assert.equal((await post({ Origin: 'https://evil.example' })).status, 401);
    assert.equal((await post({ Cookie: '' })).status, 401);
    const accepted = await post(); assert.equal(accepted.status, 303); assert.match(accepted.headers.get('location'), /incident=463f4282/); assert.equal(sessions.length, 1);
    assert.equal((await post()).status, 401); assert.equal(sessions.length, 1);
    databaseDown = true;
    assert.equal((await post()).status, 401); assert.equal(sessions.length, 1);
    assert.equal(audits.filter(x => x === 'success').length, 1);
    assert.equal((await fetch(base + CALLBACK)).status, 401);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
