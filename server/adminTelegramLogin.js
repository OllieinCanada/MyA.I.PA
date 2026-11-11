const crypto = require('node:crypto');
const { API_ORIGIN, FRONTEND_ORIGIN } = require('./adminOwnerLinks');
const PATH = '/admin/telegram-sign-in', POST_PATH = '/api/admin/telegram-sign-in';
const COOKIE = '__Host-myaipa_telegram_challenge';
const PREFIX = 'admin-telegram-proof-used:v1:';
const TTL = 5 * 60 * 1000;
const TABS = new Set(['overview', 'signups', 'attention']);
const AUTH_FIELDS = new Set(['id', 'first_name', 'last_name', 'username', 'photo_url', 'auth_date', 'hash']);
const id = value => typeof value === 'string' && /^[1-9][0-9]{0,15}$/.test(value) ? value : '';
function equal(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function configured(config) {
  return config?.enabled === true && Boolean(config.botToken) && Boolean(id(config.ownerId))
    && config.ownerId === config.chatId && typeof config.sessionSecret === 'string'
    && config.sessionSecret.length >= 32 && !config.totpEnabled;
}

function configFromEnv(env = process.env) {
  return { enabled: env.TELEGRAM_OWNER_LOGIN_ENABLED === 'true', botToken: env.TELEGRAM_BOT_TOKEN,
    ownerId: String(env.TELEGRAM_ADMIN_USER_ID || ''), chatId: String(env.TELEGRAM_CHAT_ID || ''),
    sessionSecret: env.ADMIN_SESSION_SECRET, totpEnabled: Boolean(String(env.ADMIN_TOTP_SECRET || '').trim()) };
}

function destination(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !['tab', 'incident'].includes(k))) return null;
  const tab = input.tab === undefined ? 'overview' : input.tab;
  if (!TABS.has(tab)) return null;
  if ('incident' in input && (tab !== 'attention' || typeof input.incident !== 'string' || !/^[a-f0-9]{24}$/.test(input.incident))) return null;
  return { tab, ...(input.incident ? { incident: input.incident } : {}) };
}

function destinationFromUrl(raw) {
  try {
    const url = new URL(raw);
    if (!['https://www.myaipa.ca', 'https://myaipa.ca'].includes(url.origin) || url.pathname !== '/'
      || url.search || url.username || url.password || !/^#\/admin(?:\?|$)/.test(url.hash)) return null;
    const params = new URLSearchParams(url.hash.split('?')[1] || '');
    if ([...params.keys()].some(k => params.getAll(k).length !== 1)) return null;
    return destination(Object.fromEntries(params));
  } catch { return null; }
}

function ownerLoginKeyboard(markup, { chatId, botToken, env = process.env } = {}) {
  const config = configFromEnv(env);
  // Conversion only happens on the final send boundary, for the pinned owner's
  // existing PRIVATE chat. A group/forwarded notification does not grant access.
  if (!configured(config) || !equal(botToken, config.botToken) || String(chatId) !== config.ownerId || !Array.isArray(markup?.inline_keyboard)) return markup;
  return { ...markup, inline_keyboard: markup.inline_keyboard.map(row => row.map(button => {
    if (!button?.url || button.callback_data || button.login_url || button.web_app) return button;
    const target = destinationFromUrl(button.url);
    if (!target) return button;
    return { text: button.text, login_url: { url: `${API_ORIGIN}${PATH}?${new URLSearchParams(target)}`,
      forward_text: 'Owner sign-in required', request_write_access: false } };
  })) };
}

function verifyIdentity(proof, config, now = Date.now()) {
  if (!configured(config) || !proof || typeof proof !== 'object' || Array.isArray(proof)) return false;
  const fields = Object.keys(proof);
  if (fields.some(k => !AUTH_FIELDS.has(k) || typeof proof[k] !== 'string' || proof[k].length > 1024 || /[\r\n\0]/.test(proof[k]))
    || proof.id !== config.ownerId || !/^[a-f0-9]{64}$/.test(proof.hash || '') || !/^\d{10}$/.test(proof.auth_date || '')) return false;
  const age = now - Number(proof.auth_date) * 1000;
  if (age < -30000 || age >= TTL) return false;
  // Telegram LoginUrl uses the documented Login Widget signature protocol,
  // NOT Mini App's WebAppData key derivation and NOT the callback HMAC.
  const check = fields.filter(k => k !== 'hash').sort().map(k => `${k}=${proof[k]}`).join('\n');
  const key = crypto.createHash('sha256').update(config.botToken).digest();
  return equal(proof.hash, crypto.createHmac('sha256', key).update(check).digest('hex'));
}

function challenge(config, now) {
  const payload = Buffer.from(JSON.stringify({ at: now, nonce: crypto.randomBytes(32).toString('base64url') })).toString('base64url');
  return payload + '.' + crypto.createHmac('sha256', config.sessionSecret).update('telegram-browser:v1\0' + payload).digest('hex');
}

function validChallenge(value, cookie, config, now) {
  if (!equal(value, cookie) || value.length > 512 || !/^[A-Za-z0-9_-]+\.[a-f0-9]{64}$/.test(value)) return false;
  try {
    const [payload, sig] = value.split('.');
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return Number.isSafeInteger(data.at) && now >= data.at && now - data.at < TTL
      && /^[A-Za-z0-9_-]{43}$/.test(data.nonce)
      && equal(sig, crypto.createHmac('sha256', config.sessionSecret).update('telegram-browser:v1\0' + payload).digest('hex'));
  } catch { return false; }
}

function headers(res) {
  res.set({ 'Cache-Control': 'no-store, max-age=0', Pragma: 'no-cache', Expires: '0',
    'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow, noarchive' });
}

function page(nonce, browserChallenge) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>My AI PA Telegram sign-in</title><style nonce="${nonce}">*{box-sizing:border-box}body{margin:0;padding:24px;min-height:100vh;display:grid;place-items:center;background:#07142d;color:#fff;font:18px/1.6 system-ui}main{max-width:540px;padding:30px;border:1px solid #456;border-radius:20px;background:#10223e}h1{font-size:30px;line-height:1.2}button{width:100%;padding:16px;border:0;border-radius:12px;background:#7de6cb;font:700 18px system-ui}button:disabled{opacity:.5}a{color:#9dd8ff}#status{overflow-wrap:anywhere}</style></head><body><main><h1>Open your My AI PA admin</h1><p>Confirm with your Telegram identity. No admin password is needed for the verified owner.</p><button id="open" disabled>Open my admin</button><p id="status" role="status" aria-live="polite">Checking Telegram sign-in...</p><a href="${FRONTEND_ORIGIN}/#/admin" rel="noreferrer">Use normal password sign-in</a></main><script nonce="${nonce}">
(() => {
  const params = new URLSearchParams(location.search);
  history.replaceState(null, '', location.pathname);
  const button = document.getElementById('open'), status = document.getElementById('status');
  const proof = {}, target = {}; let valid = true;
  for (const [key, value] of params) {
    if (params.getAll(key).length !== 1) valid = false;
    if (${JSON.stringify([...AUTH_FIELDS])}.includes(key)) proof[key] = value;
    else if (['tab', 'incident'].includes(key)) target[key] = value;
    else valid = false;
  }
  if (!valid || !proof.hash || !proof.id || !proof.auth_date) { status.textContent = 'Telegram sign-in was not supplied. Reopen the button in Telegram and allow sign-in, or use the password option.'; return; }
  button.disabled = false; status.textContent = 'Ready. Tap to verify and open your requested page.';
  button.addEventListener('click', async () => {
    button.disabled = true; status.textContent = 'Verifying Telegram...';
    try {
      const response = await fetch('${POST_PATH}', { method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
        headers: { 'Content-Type': 'application/json', 'X-MyAIPA-Telegram': '1' }, body: JSON.stringify({ proof, target, challenge: '${browserChallenge}' }) });
      const result = await response.json();
      if (!response.ok || result.ok !== true || !['overview', 'attention', 'signups'].includes(result.target?.tab)
        || (result.target.incident && !/^[a-f0-9]{24}$/.test(result.target.incident))) throw Error('denied');
      const query = new URLSearchParams({ tab: result.target.tab });
      if (result.target.incident) query.set('incident', result.target.incident);
      location.replace('${FRONTEND_ORIGIN}/#/admin?' + query);
    } catch { status.textContent = 'Sign-in could not be confirmed. Reopen the Telegram button for fresh verification, or use normal password sign-in.'; }
  }, { once: true });
})();</script></body></html>`;
}

function registerTelegramLogin({ app, prisma, getConfig, setSession, audit = async () => {}, rateLimiters = [], now = Date.now, claimTimeoutMs = 5000 }) {
  if (!Number.isInteger(claimTimeoutMs) || claimTimeoutMs < 1 || claimTimeoutMs > 5000) throw Error('Invalid Telegram claim deadline');
  app.get(PATH, (req, res) => {
    headers(res);
    const config = getConfig();
    if (!configured(config)) return res.status(503).send('Owner Telegram sign-in is not enabled. Normal password sign-in remains available.');
    const value = challenge(config, now()), nonce = crypto.randomBytes(24).toString('base64');
    res.setHeader('Set-Cookie', `${COOKIE}=${value}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=300`);
    res.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`);
    return res.type('html').send(page(nonce, value));
  });
  app.post(POST_PATH, (req, res, next) => { headers(res); next(); }, ...rateLimiters, async (req, res) => {
    if (req.headers.origin !== API_ORIGIN || req.headers['x-myaipa-telegram'] !== '1'
      || (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin')
      || !req.is('application/json') || Object.keys(req.query || {}).length) return res.status(403).json({ error: 'Reopen your original Telegram button.' });
    const body = req.body;
    const deny = () => res.status(401).json({ error: 'Telegram owner verification failed or expired. Reopen the original Telegram button.' });
    try {
      const config = getConfig();
      if (!configured(config)) return res.status(503).json({ error: 'Owner Telegram sign-in is not enabled.' });
      const cookies = String(req.headers.cookie || '').split(/;\s*/).filter(s => s.startsWith(COOKIE + '='));
      if (!body || Object.keys(body).sort().join(',') !== 'challenge,proof,target' || cookies.length !== 1
        || !validChallenge(body.challenge, cookies[0].slice(COOKIE.length + 1), config, now()) || !verifyIdentity(body.proof, config, now())) return deny();
      const target = destination(body.target);
      if (!target) return deny();
      const key = PREFIX + crypto.createHash('sha256').update(body.proof.id + ':' + body.proof.auth_date + ':' + body.proof.hash).digest('hex');
      let timer;
      try {
        await Promise.race([prisma.runtimeStore.create({ data: { key, data: { usedAt: now(), expiresAt: Number(body.proof.auth_date) * 1000 + TTL } } }),
          new Promise((_, reject) => { timer = setTimeout(() => reject(Error('uncertain')), claimTimeoutMs); timer.unref?.(); })]);
      } finally { clearTimeout(timer); }
      if (!verifyIdentity(body.proof, getConfig(), now()) || !validChallenge(body.challenge, cookies[0].slice(COOKIE.length + 1), getConfig(), now())) return deny();
      setSession(res);
      try { await Promise.race([audit(req), new Promise(resolve => { const timer = setTimeout(resolve, 500); timer.unref?.(); })]); } catch { /* no credentials in logs */ }
      return res.json({ ok: true, target });
    } catch (error) {
      if (error?.code === 'P2002') return deny();
      res.removeHeader('Set-Cookie');
      return res.status(503).json({ error: 'Telegram sign-in could not be confirmed. Reopen the button; no automatic retry.' });
    }
  });
}

module.exports = { PATH, POST_PATH, COOKIE, PREFIX, TTL, configured, configFromEnv, destination, destinationFromUrl,
  ownerLoginKeyboard, verifyIdentity, registerTelegramLogin };
