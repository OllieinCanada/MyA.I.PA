// Native HTTPS cookie flow; synthetic Telegram signatures, loopback only.
const fs = require('node:fs'), path = require('node:path'), https = require('node:https'), crypto = require('node:crypto');
const assert = require('node:assert/strict'), express = require('express');
const { chromium, firefox, webkit } = require('./playwright-runtime');
const { fixtureTls, fixtureProxy } = require('./test-admin-owner-links-browser');
const { registerTelegramLogin, PATH, POST_PATH } = require('../server/adminTelegramLogin');
const API = 'https://api.myaipa.ca', FRONT = 'https://www.myaipa.ca';
async function main() {
  const out = path.resolve(__dirname, '../diagnostics/admin-telegram-login'); fs.mkdirSync(out, { recursive: true });
  const config = { enabled: true, botToken: 'fixture-bot-only', ownerId: '1234567', chatId: '1234567', sessionSecret: 'fixture-session-secret-more-than-32-characters' };
  const at = Date.now(), used = new Set(), sessions = new Set(); let sessionSeen = [], posts = 0;
  function proof(offset = 0, owner = config.ownerId) {
    const p = { id: owner, first_name: '<img src=x onerror=alert(1)>', auth_date: String(Math.floor((at - offset) / 1000)) };
    const key = crypto.createHash('sha256').update(config.botToken).digest();
    p.hash = crypto.createHmac('sha256', key).update(Object.keys(p).sort().map(k => k + '=' + p[k]).join('\n')).digest('hex'); return p;
  }
  const app = express(); app.use(express.json({ limit: '4kb' }));
  app.use((req, res, next) => {
    if (req.headers.host === 'www.myaipa.ca' && req.path === '/') return res.type('html').send('<!doctype html><h1 id="state">Checking</h1><script>fetch("' + API
      + '/api/admin/session",{credentials:"include"}).then(r=>document.getElementById("state").textContent=r.ok?"Admin unlocked":"Password required")</script>');
    if (req.method === 'POST') posts++; next();
  });
  registerTelegramLogin({ app, now: () => at, getConfig: () => config,
    prisma: { runtimeStore: { create: async ({ data }) => {
      if (used.has(data.key)) throw Object.assign(Error('unique'), { code: 'P2002' }); used.add(data.key); return data;
    } } }, setSession: res => { const value = crypto.randomBytes(32).toString('hex'); sessions.add(value);
      res.setHeader('Set-Cookie', `fixture-admin=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=43200`); },
  });
  app.get('/api/admin/session', (req, res) => {
    const value = String(req.headers.cookie || '').match(/fixture-admin=([a-f0-9]+)/)?.[1];
    sessionSeen.push(sessions.has(value));
    res.set({ 'Access-Control-Allow-Origin': FRONT, 'Access-Control-Allow-Credentials': 'true', 'Cache-Control': 'no-store' });
    res.status(sessions.has(value) ? 200 : 401).json({ ok: sessions.has(value) });
  });
  const server = https.createServer(fixtureTls(), app); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const proxy = await fixtureProxy(server.address().port);
  const report = { isolated: true, liveTelegramUsed: false, checkedAt: new Date().toISOString(), cases: [], passed: false };
  let sequence = 0;
  try {
    for (const [engine, launcher] of Object.entries({ chromium, firefox, webkit })) {
      const browser = await launcher.launch({ headless: true, proxy: { server: proxy.server } });
      try {
        for (const width of [390, 1280]) {
          const context = await browser.newContext({ viewport: { width, height: 900 }, ignoreHTTPSErrors: true });
          const forbidden = [], errors = []; sessionSeen = []; const startPosts = posts;
          await context.route('**/*', async route => {
            const url = new URL(route.request().url());
            if ((url.origin === API && [PATH, POST_PATH, '/api/admin/session'].includes(url.pathname)) || (url.origin === FRONT && url.pathname === '/')) return route.continue();
            forbidden.push(url.origin + url.pathname); return route.abort();
          });
          const p = proof(sequence++ * 1000), target = { tab: 'attention', incident: 'b'.repeat(24) };
          const url = API + PATH + '?' + new URLSearchParams({ ...target, ...p });
          const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
          await page.goto(url); await page.waitForFunction(() => !document.getElementById('open').disabled);
          assert.equal(page.url(), API + PATH); assert.equal(posts, startPosts, 'GET may not authenticate');
          assert.equal(await page.locator('img').count(), 0, 'Signed user names must not become HTML');
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
          await page.screenshot({ path: path.join(out, `${engine}-${width}-telegram-signin.png`), fullPage: true });
          await page.getByRole('button', { name: 'Open my admin' }).click();
          await page.waitForURL(FRONT + '/#/admin?tab=attention&incident=' + target.incident);
          await page.getByText('Admin unlocked', { exact: true }).waitFor(); assert.equal(sessionSeen[0], true);
          const cookie = (await context.cookies()).find(c => c.name === 'fixture-admin'); assert.ok(cookie?.httpOnly && cookie.secure && cookie.sameSite === 'Lax');
          assert.equal(await page.evaluate(() => document.cookie), '');
          await context.clearCookies(); await page.goto(url); await page.getByRole('button', { name: 'Open my admin' }).click();
          await page.getByText(/Sign-in could not be confirmed/).waitFor(); assert.ok(!(await context.cookies()).some(c => c.name === 'fixture-admin'));
          // Force a new document: query proofs are removed from browser history.
          const other = API + PATH + '?' + new URLSearchParams({ tab: 'signups', ...proof(100000 + sequence * 1000, '999') });
          await page.goto(other); await page.getByRole('button', { name: 'Open my admin' }).click();
          await page.getByText(/Sign-in could not be confirmed/).waitFor();
          await page.goto(API + PATH + '?tab=signups'); await page.getByText(/Telegram sign-in was not supplied/).waitFor();
          await page.getByRole('link', { name: 'Use normal password sign-in' }).click(); await page.getByText('Password required', { exact: true }).waitFor();
          assert.deepEqual(errors, []); assert.deepEqual(forbidden, []);
          report.cases.push({ engine, width, passed: true, exactIncidentPreserved: true, replayRejected: true, differentOwnerRejected: true, ordinaryAccessStillLocked: true });
          await context.close();
        }
      } finally { await browser.close(); }
    }
    report.passed = true;
  } catch (e) { report.failure = String(e.message).slice(0, 1800); throw e; }
  finally {
    fs.writeFileSync(path.join(out, 'browser-report.json'), JSON.stringify(report, null, 2) + '\n');
    await proxy.close(); await new Promise(resolve => server.close(resolve));
  }
  console.log(JSON.stringify(report, null, 2));
}
if (require.main === module) main().catch(() => { console.error('Isolated Telegram sign-in browser check failed; inspect synthetic report.'); process.exitCode = 1; });
