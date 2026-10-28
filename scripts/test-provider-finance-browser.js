// Offline app regression. Fixtures only; no provider billing APIs or real credentials.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
async function main() {
  const root = path.resolve(process.env.BUILD_PREVIEW_DIR || 'docs');
  assert.ok(fs.existsSync(path.join(root, 'index.html')), 'Build first.');
  const output = path.resolve('diagnostics/finance-meter'); fs.mkdirSync(output, { recursive: true });
  const at = new Date().toISOString();
  const metric = (value, currency = 'USD') => ({ value, currency, source: 'dashboard_verified', observedAt: at });
  const fixture = { refreshing: false, providers: [
    { id: 'twilio', name: 'Twilio', warnings: [], metrics: { balance: metric(40), spendToday: { ...metric(0), source: 'twilio_usage_api' }, spendMonth: { ...metric(25), source: 'twilio_usage_api' } } },
    { id: 'vapi', name: 'Vapi', warnings: ['Saved call costs are estimates, not a complete Vapi invoice. Do not add them to Twilio totals.'], metrics: { balance: metric(12), reloadThreshold: metric(5), reloadAmount: metric(10), spendMonth: { ...metric(2.3), estimated: true, source: 'saved_call_costs', savedCalls: 5, pricedCalls: 3 } } },
    { id: 'make', name: 'Make', warnings: ['30-day credits are not the billing-cycle remaining balance.'], metrics: { planPrice: { ...metric(12, 'CAD'), estimated: true, period: 'month', source: 'make_subscription_api' } } },
    { id: 'render', name: 'Render', warnings: ['Render billing is dashboard-verified, not live.'], metrics: { monthlyEstimate: { ...metric(19), estimated: true, stale: true } } },
  ], manualFields: { vapi: ['balance', 'reloadThreshold', 'reloadAmount'], twilio: ['reserve'], make: ['monthlyEstimate'], render: ['monthlyEstimate', 'nextBillAt'] } };
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
  let externalBlocked = 0, writes = 0;
  try {
    for (const width of [320, 412, 820, 1180, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      let unavailable = false; const errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => {
        const request = route.request(), url = new URL(request.url());
        if (url.pathname.startsWith('/api/admin/')) {
          if (request.method() !== 'GET') { writes++; return route.abort(); }
          if (url.pathname === '/api/admin/finances') return route.fulfill({ status: unavailable ? 503 : 200,
            contentType: 'application/json', body: JSON.stringify(unavailable ? { error: 'Unavailable' } : { ok: true, finances: fixture }) });
          return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
        }
        if (url.origin !== 'http://127.0.0.1:4179') { externalBlocked++; return route.abort(); }
        const file = path.resolve(root, url.pathname === '/' ? 'index.html' : '.' + decodeURIComponent(url.pathname));
        if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return route.fulfill({ status: 404, body: '' });
        const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
        return route.fulfill({ status: 200, contentType: mime[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
      });
      await page.goto('http://127.0.0.1:4179/#/admin?tab=costs');
      const panel = page.getByRole('region', { name: 'Provider finance meter' });
      await panel.getByRole('heading', { name: 'Vapi', exact: true }).waitFor();
      assert.ok((await panel.textContent()).includes('USD 0.00'));
      assert.ok((await panel.textContent()).includes('CAD 12.00'));
      assert.ok((await panel.textContent()).includes('No combined total'));
      await panel.getByRole('button', { name: 'Record a dashboard-verified fact' }).click();
      await panel.getByLabel('Provider', { exact: true }).selectOption('render');
      await panel.getByLabel('Fact', { exact: true }).selectOption('nextBillAt');
      await panel.getByLabel('Billing date').fill('2026-11-01');
      assert.equal(await panel.getByLabel('Currency', { exact: true }).count(), 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Overflow at ${width}`);
      await panel.screenshot({ path: path.join(output, `${width}-finance.png`) });
      unavailable = true;
      await panel.getByRole('button', { name: 'Refresh finances', exact: true }).click();
      await panel.getByRole('alert').waitFor();
      assert.ok((await panel.textContent()).includes('USD 40.00'));
      assert.ok((await panel.textContent()).includes('last-known values'));
      assert.deepEqual(errors, []); await page.close();
      console.log(`PASS finance ${width}px: currencies, editor, stale/error retention, no horizontal overflow.`);
    }
    assert.equal(writes, 0);
    fs.writeFileSync(path.join(output, 'browser-report.json'), JSON.stringify({ passed: true, widths: [320, 412, 820, 1180, 1440], writes, externalBlocked, productionRequests: 0 }, null, 2));
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
