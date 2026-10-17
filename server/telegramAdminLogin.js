const crypto = require('node:crypto');
const express = require('express');

const AUTH_FIELDS = new Set(['id', 'first_name', 'last_name', 'username', 'photo_url', 'auth_date', 'hash']);
const COOKIE = '__Host-myaipa_tg_login';
const CALLBACK = '/api/admin/telegram-login';
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const mac = (key, value) => crypto.createHmac('sha256', key).update(value).digest('hex');
function equal(a, b) {
  return typeof a === 'string' && typeof b === 'string' && a.length === b.length
    && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
function config(env = process.env) {
  const userId = String(env.TELEGRAM_ADMIN_USER_ID || (/^[1-9][0-9]*$/.test(env.TELEGRAM_CHAT_ID || '') ? env.TELEGRAM_CHAT_ID : ''));
  return { enabled: env.TELEGRAM_ADMIN_LOGIN_ENABLED === 'true', userId,
    token: String(env.TELEGRAM_BOT_TOKEN || ''), origin: 'https://api.myaipa.ca',
    frontend: 'https://www.myaipa.ca' };
}
function destination(value) {
  const url = new URL(value);
  if (url.origin !== 'https://www.myaipa.ca' || url.pathname !== '/' || url.search || url.username || url.password) throw Error('Invalid admin destination');
  const match = url.hash.match(/^#\/admin(?:\?(.*))?$/);
  if (!match) throw Error('Invalid admin destination');
  const params = new URLSearchParams(match[1] || '');
  for (const [key, val] of params) {
    if (params.getAll(key).length !== 1 || !['tab', 'incident'].includes(key)
      || !/^[a-zA-Z0-9_.:-]{1,100}$/.test(val)
      || (key === 'incident' && !/^[a-f0-9]{24}$/i.test(val))) throw Error('Invalid admin destination');
  }
  return url.toString();
}
function loginKeyboard(markup, env = process.env) {
  const c = config(env);
  if (!c.enabled || !c.token || !/^[1-9][0-9]{0,19}$/.test(c.userId) || !Array.isArray(markup?.inline_keyboard)) return markup;
  return { ...markup, inline_keyboard: markup.inline_keyboard.map(row => row.map(button => {
    if (!button.url) return button;
    try {
      const target = destination(button.url);
      const url = new URL(CALLBACK, c.origin);
      url.searchParams.set('target', target);
      return { text: button.text, login_url: { url: url.toString(), request_write_access: false } };
    } catch { return button; }
  })) };
}
function verifyAuthorization(params, c, now = Date.now()) {
  if (!c.enabled || !c.token || !/^[1-9][0-9]{0,19}$/.test(c.userId)) throw Error('Telegram admin sign-in is not enabled');
  for (const [key, value] of params) {
    if ((!AUTH_FIELDS.has(key) && key !== 'target') || params.getAll(key).length !== 1 || value.length > 2048) throw Error('Invalid Telegram authorization');
  }
  if (params.get('id') !== c.userId || !/^\d{1,12}$/.test(params.get('auth_date') || '') || !/^[a-f0-9]{64}$/.test(params.get('hash') || '')) throw Error('Invalid Telegram authorization');
  const age = now / 1000 - Number(params.get('auth_date'));
  if (age < -15 || age > 120) throw Error('Telegram authorization expired');
  const data = [...params].filter(([key]) => AUTH_FIELDS.has(key) && key !== 'hash').sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, value]) => `${key}=${value}`).join('\n');
  const secret = crypto.createHash('sha256').update(c.token).digest();
  if (!equal(mac(secret, data), params.get('hash'))) throw Error('Invalid Telegram signature');
  return { target: destination(params.get('target') || 'https://www.myaipa.ca/#/admin'), proof: params.get('hash'), userId: c.userId };
}
function challenge(secret, proof, nonce) { return `${nonce}.${mac(secret, `${proof}:${nonce}`)}`; }
function escapeHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function registerTelegramAdminLogin(app, { prisma, rateLimiter, sessionSecret, setSession, audit, env = process.env, now = Date.now }) {
  const headers = res => {
    res.set('Cache-Control', 'no-store, max-age=0');
    res.set('Referrer-Policy', 'no-referrer');
    res.set('X-Robots-Tag', 'noindex, nofollow');
    res.set('X-Content-Type-Options', 'nosniff');
  };
  const denied = async res => {
    await audit('denied');
    return res.status(401).send('Telegram sign-in was not accepted. Open a fresh alert button in your own Telegram account, or use the normal admin login.');
  };
  app.get(CALLBACK, rateLimiter, async (req, res, next) => {
    headers(res);
    try {
      const params = new URL(req.originalUrl, config(env).origin).searchParams;
      const auth = verifyAuthorization(params, config(env), now());
      const nonce = crypto.randomBytes(24).toString('hex');
      const scriptNonce = crypto.randomBytes(24).toString('hex');
      const payload = Buffer.from(params.toString()).toString('base64url');
      res.set('Set-Cookie', `${COOKIE}=${challenge(sessionSecret(), auth.proof, nonce)}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=120`);
      res.set('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${scriptNonce}'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`);
      res.type('html').send(`<!doctype html><html><head><meta name="referrer" content="no-referrer"><title>Opening admin</title></head><body><p>Opening your admin dashboard…</p><form method="post" action="${CALLBACK}"><input type="hidden" name="payload" value="${escapeHtml(payload)}"><input type="hidden" name="nonce" value="${nonce}"><button>Open admin</button></form><script nonce="${scriptNonce}">history.replaceState(null,'','${CALLBACK}');document.forms[0].submit();</script></body></html>`);
    } catch (error) { try { await denied(res); } catch (e) { next(e); } }
  });
  app.post(CALLBACK, rateLimiter, express.urlencoded({ extended: false, limit: '8kb' }), async (req, res, next) => {
    headers(res);
    try {
      const c = config(env);
      if (req.headers.origin !== c.origin || !/^[A-Za-z0-9_-]{1,7000}$/.test(req.body?.payload || '') || !/^[a-f0-9]{48}$/.test(req.body?.nonce || '')) throw Error('Invalid browser confirmation');
      const params = new URLSearchParams(Buffer.from(req.body.payload, 'base64url').toString());
      const auth = verifyAuthorization(params, c, now());
      const cookies = String(req.headers.cookie || '').split(';').map(x => x.trim());
      const cookie = cookies.find(x => x.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) || '';
      if (!equal(cookie, challenge(sessionSecret(), auth.proof, req.body.nonce))) throw Error('Invalid browser confirmation');
      // A unique database insert, not process memory, makes replay/concurrent redemption fail closed.
      await prisma.runtimeStore.create({ data: { key: `telegram-admin-login:${digest(auth.proof)}`, data: { usedAt: new Date(now()).toISOString() } } });
      await audit('success');
      setSession(res);
      res.append('Set-Cookie', `${COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0`);
      res.redirect(303, auth.target);
    } catch (error) {
      if (res.headersSent) return next(error);
      try { await denied(res); } catch (e) { next(e); }
    }
  });
}
module.exports = { config, destination, loginKeyboard, verifyAuthorization, challenge, escapeHtml, registerTelegramAdminLogin, CALLBACK, COOKIE };
