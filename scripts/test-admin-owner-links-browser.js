// Real HTTPS over an allowlisted loopback-only CONNECT proxy. In particular,
// Set-Cookie/Cookie are handled by each browser's native network stack, not
// mocked by route.fulfill. No live host or production credential is accessed.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const { chromium, firefox, webkit } = require('./playwright-runtime');
const { registerOwnerLinkRoutes, issueOwnerLink, PAGE_PATH, REDEEM_PATH, API_ORIGIN, FRONTEND_ORIGIN, LINK_TTL_MS } = require('../server/adminOwnerLinks');

function fixtureTls() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'myaipa-owner-link-tls-'));
  const key = path.join(dir, 'key.pem'), cert = path.join(dir, 'cert.pem');
  try {
    const result = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
      '-subj', '/CN=api.myaipa.ca', '-addext', 'subjectAltName=DNS:api.myaipa.ca,DNS:www.myaipa.ca', '-keyout', key, '-out', cert], { stdio: 'pipe' });
    if (result.status !== 0) throw new Error('OpenSSL is required for the isolated HTTPS test');
    return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
  } finally {
    // Only these two newly-generated fixture files are removed, never evidence
    // or a user directory. The disposable TLS private key is not an artifact.
    for (const file of [key, cert]) if (fs.existsSync(file)) fs.unlinkSync(file);
    fs.rmdirSync(dir);
  }
}

async function fixtureProxy(tlsPort) {
  const sockets = new Set();
  const proxy = http.createServer((_req, res) => res.writeHead(403).end());
  proxy.on('connect', (req, client, head) => {
    if (!['api.myaipa.ca:443', 'www.myaipa.ca:443'].includes(req.url)) { client.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
    // Never resolve the requested hostname or connect outside loopback.
    const upstream = net.connect(tlsPort, '127.0.0.1', () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      client.pipe(upstream); upstream.pipe(client);
    });
    for (const socket of [client, upstream]) { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); }
    client.on('error', () => upstream.destroy()); upstream.on('error', () => client.destroy());
  });
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  return { server: `http://127.0.0.1:${proxy.address().port}`,
    close: async () => { for (const socket of sockets) socket.destroy(); await new Promise(resolve => proxy.close(resolve)); } };
}

async function main() {
  const out = path.resolve(__dirname, '../diagnostics/admin-owner-links'); fs.mkdirSync(out, { recursive: true });
  const config = { adminPassword: 'synthetic-browser-owner', sessionSecret: 'synthetic-browser-secret-over-32-characters' };
  const used = new Set(), sessions = new Set(); let clock = Date.now(), writes = 0, activeSessionReads = [];
  const app = express(); app.use(express.json({ limit: '2kb' }));
  app.use((req, res, next) => {
    if (req.headers.host === 'www.myaipa.ca' && req.path === '/') return res.type('html').send('<!doctype html><h1 id="state">Checking session</h1><script>fetch("' + API_ORIGIN
      + '/api/admin/session",{credentials:"include"}).then(r=>document.getElementById("state").textContent=r.ok?"Admin unlocked":"Password required")</script>');
    return next();
  });
  registerOwnerLinkRoutes({ app, now: () => clock, getConfig: () => config,
    prisma: { runtimeStore: { create: async ({ data }) => {
      if (used.has(data.key)) throw Object.assign(new Error('unique'), { code: 'P2002' });
      used.add(data.key); writes++; return data;
    } } },
    setSession: res => { const id = crypto.randomBytes(32).toString('hex'); sessions.add(id);
      res.setHeader('Set-Cookie', `fixture-owner-session=${id}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=43200`); },
  });
  app.get('/api/admin/session', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', FRONTEND_ORIGIN); res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Cache-Control', 'no-store');
    const value = String(req.headers.cookie || '').match(/fixture-owner-session=([a-f0-9]+)/)?.[1];
    activeSessionReads.push({ hasBrowserCookie: Boolean(value) });
    res.status(sessions.has(value) ? 200 : 401).json({ ok: sessions.has(value) });
  });
  const server = https.createServer(fixtureTls(), app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const proxy = await fixtureProxy(server.address().port);
  const report = { checkedAt: new Date().toISOString(), isolated: true, actualProductionSessionTest: 'separate backend integration test',
    forbiddenNetworkRequests: 0, cases: [], passed: false };
  try {
    for (const [engine, launcher] of Object.entries({ chromium, firefox, webkit })) {
      const browser = await launcher.launch({ headless: true, proxy: { server: proxy.server } });
      try {
        for (const width of [390, 1280]) {
          // The generated self-signed certificate is accepted only in this new,
          // empty test context behind the loopback-only proxy, never live use.
          const context = await browser.newContext({ viewport: { width, height: 900 }, ignoreHTTPSErrors: true });
          const errors = [], forbidden = [], sessionReads = []; let posts = 0;
          activeSessionReads = sessionReads;
          await context.route('**/*', async route => {
            const req = route.request(), url = new URL(req.url());
            if (url.origin === API_ORIGIN && [PAGE_PATH, REDEEM_PATH, '/api/admin/session'].includes(url.pathname)) {
              if (req.method() === 'POST') posts++;
              // No header forwarding: native networking adds HttpOnly cookies
              // after interception. Assert what the HTTPS server receives.
              await route.continue();
            } else if (url.origin === FRONTEND_ORIGIN && url.pathname === '/') {
              await route.continue();
            } else { forbidden.push(url.origin + url.pathname); await route.abort(); }
          });
          const page = await context.newPage(); page.on('pageerror', err => errors.push(err.message));
          report.activeCase = { engine, width, sessionReads };
          const link = issueOwnerLink({ config, now: clock, tab: 'signups' });
          await page.goto(link.url); await page.getByRole('button', { name: 'Open my admin' }).waitFor();
          await page.waitForFunction(() => !document.getElementById('open').disabled);
          assert.equal(page.url(), API_ORIGIN + PAGE_PATH, 'Fragment must be erased immediately');
          assert.equal(posts, 0, 'Opening/prefetching a link must not redeem it');
          assert.equal((await context.cookies()).length, 0);
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
          await page.screenshot({ path: path.join(out, `${engine}-${width}-owner-link.png`), fullPage: true });
          await page.getByRole('button', { name: 'Open my admin' }).click();
          await page.waitForURL(FRONTEND_ORIGIN + '/#/admin?tab=signups');
          await page.getByText(/^(Admin unlocked|Password required)$/).waitFor();
          assert.equal(await page.locator('#state').textContent(), 'Admin unlocked', 'Cross-subdomain fetch must receive the browser session cookie');
          assert.equal(posts, 1); assert.equal(sessionReads[0]?.hasBrowserCookie, true);
          const cookie = (await context.cookies()).find(item => item.name === 'fixture-owner-session');
          assert.ok(cookie?.httpOnly && cookie.secure && cookie.sameSite === 'Lax');
          assert.equal(await page.evaluate(() => document.cookie), '', 'No JS-readable session credential');
          await context.clearCookies();
          await page.goto(link.url); await page.getByRole('button', { name: 'Open my admin' }).click();
          await page.getByText(/Sign-in could not be confirmed/).waitFor(); assert.equal(posts, 2);
          assert.equal((await context.cookies()).length, 0, 'Replay must not set a cookie');
          const expired = issueOwnerLink({ config, now: clock - LINK_TTL_MS });
          await page.goto(expired.url); await page.getByRole('button', { name: 'Open my admin' }).click();
          await page.getByText(/Sign-in could not be confirmed/).waitFor(); assert.equal(posts, 3);
          await page.goto(API_ORIGIN + PAGE_PATH + '#bad'); await page.getByText(/link is missing or invalid/).waitFor();
          assert.ok(await page.getByRole('button', { name: 'Open my admin' }).isDisabled()); assert.equal(posts, 3);
          await page.getByRole('link', { name: 'Use normal password sign-in' }).click();
          await page.getByText('Password required', { exact: true }).waitFor();
          assert.deepEqual(errors, []); assert.deepEqual(forbidden, []);
          report.cases.push({ engine, width, passed: true, outcomes: ['fragment_erased', 'get_does_not_redeem', 'no_overflow',
            'tap_sets_secure_cookie', 'cross_subdomain_session', 'replay_denied', 'expired_denied', 'bad_link_denied', 'password_fallback'] });
          await context.close();
          delete report.activeCase;
        }
      } finally { await browser.close(); }
    }
    report.passed = true; report.claimWrites = writes;
  } catch (error) {
    // Fixture-only failures may include synthetic URLs, never live credentials.
    report.failure = String(error.message).slice(0, 1600);
    throw error;
  } finally {
    fs.writeFileSync(path.join(out, 'browser-report.json'), JSON.stringify(report, null, 2) + '\n');
    await proxy.close();
    await new Promise(resolve => server.close(resolve));
  }
  console.log(JSON.stringify(report, null, 2));
}
if (require.main === module) main().catch(() => { console.error('Isolated owner-link browser check failed; inspect its test report. No live credentials were used.'); process.exitCode = 1; });
module.exports = { fixtureTls, fixtureProxy };
