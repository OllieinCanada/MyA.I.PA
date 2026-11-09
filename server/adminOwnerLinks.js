const crypto = require('node:crypto');

const API_ORIGIN = 'https://api.myaipa.ca';
const FRONTEND_ORIGIN = 'https://www.myaipa.ca';
const PAGE_PATH = '/admin/owner-sign-in';
const REDEEM_PATH = '/api/admin/owner-sign-in';
const RECEIPT_PREFIX = 'admin-owner-link-used:v1:';
const LINK_TTL_MS = 10 * 60 * 1000;
const TABS = new Set(['overview', 'signups', 'attention', 'customers', 'calls', 'costs', 'setup', 'settings']);
const INVALID_MESSAGE = 'This sign-in link is invalid, expired, or already used. Request a new private link.';

function signingKey(config) {
  // Not the session-token signing format or password-derived session fallback.
  // Only the operator with the backend session secret can issue a link. Knowing
  // the shared admin password alone does not grant link-issuance capability.
  if (!config?.adminPassword || typeof config.sessionSecret !== 'string' || config.sessionSecret.length < 32
    || config.totpEnabled) throw new Error('OWNER_LINK_UNAVAILABLE');
  return crypto.createHmac('sha256', config.sessionSecret)
    .update('myaipa-owner-sign-in:v1\0').update(config.adminPassword).digest();
}

function signature(payload, config) {
  return crypto.createHmac('sha256', signingKey(config)).update(payload).digest('base64url');
}

function issueOwnerLink({ config, tab = 'signups', now = Date.now() }) {
  if (!TABS.has(tab) || !Number.isSafeInteger(now)) throw new Error('OWNER_LINK_INVALID_OPTIONS');
  const payload = Buffer.from(JSON.stringify({ v: 1, iat: now, exp: now + LINK_TTL_MS,
    jti: crypto.randomBytes(32).toString('base64url'), tab })).toString('base64url');
  const token = `${payload}.${signature(payload, config)}`;
  return { url: `${API_ORIGIN}${PAGE_PATH}#${token}`, expiresAt: new Date(now + LINK_TTL_MS).toISOString() };
}

function verifyOwnerLink(token, config, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 1024 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token)) return null;
  try {
    const [payload, supplied] = token.split('.');
    const expected = signature(payload, config);
    if (!crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return null;
    const decoded = Buffer.from(payload, 'base64url');
    if (decoded.toString('base64url') !== payload) return null;
    const data = JSON.parse(decoded.toString('utf8'));
    if (Object.keys(data).sort().join(',') !== 'exp,iat,jti,tab,v' || data.v !== 1
      || !Number.isSafeInteger(data.iat) || !Number.isSafeInteger(data.exp)
      || data.exp - data.iat !== LINK_TTL_MS || data.iat > now || data.exp <= now
      || !/^[A-Za-z0-9_-]{43}$/.test(data.jti) || !TABS.has(data.tab)) return null;
    return data;
  } catch { return null; }
}

function privateHeaders(res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
}

async function withinDeadline(operation, ms) {
  let timer;
  try {
    return await Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('OWNER_LINK_STORAGE_UNCERTAIN')), ms);
      timer.unref?.();
    })]);
  } finally { clearTimeout(timer); }
}

function ownerLinkPage(nonce) {
  // The token is never rendered by the server. No analytics, fonts, images or
  // external scripts run here. Erase the fragment before any user action.
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>Private My AI PA sign-in</title><style nonce="${nonce}">*{box-sizing:border-box}body{margin:0;background:#07142d;color:#f4f8ff;font:18px/1.6 system-ui,sans-serif;min-height:100vh;display:grid;place-items:center;padding:24px}main{max-width:540px;width:100%;padding:32px;border:1px solid #3b557c;border-radius:22px;background:#10223e}h1{font-size:32px;line-height:1.2}p{color:#d5e3f8}button{width:100%;padding:16px;border:0;border-radius:12px;background:#7de6cb;color:#05251c;font:700 18px system-ui;cursor:pointer}button:focus-visible,a:focus-visible{outline:3px solid #fff;outline-offset:5px}button:disabled{opacity:.6;cursor:default}a{color:#9dd8ff}#status{min-height:2em;overflow-wrap:anywhere}small{display:block;margin-top:22px;color:#b7c9e2}</style></head><body><main><h1>Your private admin sign-in</h1><p>This link signs you into the My AI PA control center without entering your password.</p><button id="open" type="button" disabled>Open my admin</button><p id="status" role="status" aria-live="polite">Checking the private link...</p><a href="${FRONTEND_ORIGIN}/#/admin" rel="noreferrer">Use normal password sign-in</a><small>Private link: expires after 10 minutes and works once. Do not forward it. Anyone holding an unused link can sign in.</small><noscript><p>JavaScript is required for private-link sign-in. Normal password sign-in is still available.</p></noscript></main><script nonce="${nonce}">
'use strict';
(() => {
  let token = location.hash.slice(1);
  history.replaceState(null, '', location.pathname);
  const button = document.getElementById('open');
  const status = document.getElementById('status');
  if (!/^[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]{43}$/.test(token) || token.length > 1024) {
    token = ''; status.textContent = 'This link is missing or invalid. Request a new private link.'; return;
  }
  button.disabled = false;
  status.textContent = 'Ready. Tap the button to sign in.';
  button.addEventListener('click', async () => {
    if (!token) return;
    const current = token; token = ''; button.disabled = true;
    status.textContent = 'Signing in...';
    try {
      const response = await fetch('${REDEEM_PATH}', { method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', 'X-MyAIPA-Owner-Link': '1' }, body: JSON.stringify({ token: current }), redirect: 'error' });
      const result = await response.json();
      // Never follow an arbitrary return URL, even from a malformed response.
      if (!response.ok || result.ok !== true || typeof result.tab !== 'string'
        || !${JSON.stringify([...TABS])}.includes(result.tab)) throw new Error('sign_in_failed');
      location.replace('${FRONTEND_ORIGIN}/#/admin?tab=' + encodeURIComponent(result.tab));
    } catch {
      status.textContent = 'Sign-in could not be confirmed. Request a new private link or use normal password sign-in.';
    }
  }, { once: true });
})();</script></body></html>`;
}

function registerOwnerLinkRoutes({ app, prisma, getConfig, setSession, rateLimiters = [], audit = async () => {},
  now = Date.now, apiOrigin = API_ORIGIN, claimTimeoutMs = 5000 }) {
  // apiOrigin injection is only for an isolated loopback test server. Production
  // uses the fixed HTTPS host, never a request Host/Forwarded or returnUrl field.
  if (apiOrigin !== API_ORIGIN && !/^http:\/\/127\.0\.0\.1:\d+$/.test(apiOrigin)) throw new Error('OWNER_LINK_INVALID_ORIGIN');
  if (!Number.isInteger(claimTimeoutMs) || claimTimeoutMs < 1 || claimTimeoutMs > 5000) throw new Error('OWNER_LINK_INVALID_TIMEOUT');
  app.get(PAGE_PATH, (req, res) => {
    privateHeaders(res);
    if (Object.keys(req.query || {}).length) return res.status(400).send('Use the original private link without extra query parameters.');
    const nonce = crypto.randomBytes(24).toString('base64');
    res.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`);
    return res.type('html').send(ownerLinkPage(nonce));
  });
  app.post(REDEEM_PATH, (req, res, next) => { privateHeaders(res); next(); }, ...rateLimiters, async (req, res) => {
    // Origin + non-simple header + JSON prevent cross-site login CSRF. There is
    // no GET redemption, automatic redemption, or public link-issuance route.
    if (req.headers.origin !== apiOrigin || req.headers['x-myaipa-owner-link'] !== '1'
      || (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin')
      || !req.is('application/json') || Object.keys(req.query || {}).length) {
      return res.status(403).json({ error: 'Open your original private sign-in link.' });
    }
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).join(',') !== 'token') {
      return res.status(401).json({ error: INVALID_MESSAGE });
    }
    try {
      const config = getConfig();
      const data = verifyOwnerLink(body.token, config, now());
      if (!data) return res.status(401).json({ error: INVALID_MESSAGE });
      // The unique PK is the claim: concurrent requests and separate instances
      // cannot redeem twice. Never put the bearer credential or its payload in
      // the database, logs or audit. On uncertainty, fail closed without retry.
      const key = RECEIPT_PREFIX + crypto.createHash('sha256').update(data.jti).digest('hex');
      await withinDeadline(() => prisma.runtimeStore.create({ data: { key, data: { usedAt: now(), expiresAt: data.exp } } }), claimTimeoutMs);
      if (now() >= data.exp || !verifyOwnerLink(body.token, getConfig(), now())) {
        return res.status(401).json({ error: INVALID_MESSAGE });
      }
      setSession(res);
      // Audit cannot turn a completed session issuance into an error/retry.
      try { await withinDeadline(() => audit(req), 1000); } catch { /* no credentials in logs */ }
      return res.json({ ok: true, tab: data.tab });
    } catch (error) {
      if (error?.code === 'P2002') return res.status(401).json({ error: INVALID_MESSAGE });
      return res.status(503).json({ error: 'Private sign-in is unavailable. Request a new link or use normal password sign-in.' });
    }
  });
}

module.exports = { API_ORIGIN, FRONTEND_ORIGIN, PAGE_PATH, REDEEM_PATH, RECEIPT_PREFIX, LINK_TTL_MS,
  TABS, issueOwnerLink, verifyOwnerLink, ownerLinkPage, registerOwnerLinkRoutes };
