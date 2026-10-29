// Offline app regression. Fixtures only; no provider billing APIs or real credentials.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { decorate, overview } = require('../server/providerFinanceView');
async function main() {
  const root = path.resolve(process.env.BUILD_PREVIEW_DIR || 'docs');
  assert.ok(fs.existsSync(path.join(root, 'index.html')), 'Build first.');
  const output = path.resolve('diagnostics/finance-meter'); fs.mkdirSync(output, { recursive: true });
  const at = new Date().toISOString();
  const metric = (value, currency = 'USD') => ({ value, currency, source: 'dashboard_verified', observedAt: at });
  const fixture = { refreshing: false, providers: [
    { id: 'twilio', name: 'Twilio', warnings: [], metrics: { balance: metric(40), spendToday: { ...metric(0), source: 'twilio_usage_api' }, spendMonth: { ...metric(25), source: 'twilio_usage_api' } } },
    { id: 'vapi', name: 'Vapi', warnings: ['Saved call costs are estimates, not a complete Vapi invoice. Do not add them to Twilio totals.'], metrics: { balance: metric(12), reloadThreshold: metric(5), reloadAmount: metric(10), spendMonth: { ...metric(2.3), estimated: true, source: 'saved_call_costs', savedCalls: 5, pricedCalls: 3 } } },
    { id: 'make', name: 'Make', warnings: ['30-day credits are not the billing-cycle remaining balance.'], metrics: { planPrice: { ...metric(12, 'CAD'), estimated: true, period: 'month', source: 'make_subscription_api' }, rollingCredits: { ...metric(363), source: 'make_usage_api', unit: 'credits' }, nextBillAt: { ...metric(new Date(Date.now() + 86400000).toISOString()), kind: 'date', source: 'make_subscription_api' } } },
    { id: 'render', name: 'Render', warnings: ['Render billing is dashboard-verified, not live.'], metrics: { monthlyEstimate: { ...metric(19), observedAt: '2026-01-01T12:00:00Z', estimated: true } } },
  ], manualFields: { vapi: ['balance', 'reloadThreshold', 'reloadAmount'], twilio: ['reserve'], make: ['monthlyEstimate'], render: ['monthlyEstimate', 'nextBillAt'] } };
  const month = at.slice(0, 7) + '-01';
  for (const provider of fixture.providers) for (const field of ['spendToday', 'spendMonth']) if (provider.metrics[field]) Object.assign(provider.metrics[field], { periodStart: field === 'spendMonth' ? month : at.slice(0, 10), periodEnd: at.slice(0, 10) });
  fixture.providers = decorate({ providers: Object.fromEntries(fixture.providers.map(p => [p.id, p.metrics])) }, [], Date.now(), { TWILIO_ACCOUNT_SID: 'AC' + '1'.repeat(32), VAPI_API_KEY: 'synthetic-only', FINANCE_MAKE_ORGANIZATION_ID: '123', FINANCE_MAKE_ZONE: 'us2' });
  fixture.overview = overview(fixture.providers);
  const phoneBilling = { records: [{ sid: 'synthetic-number', phoneNumber: '+1 (555) 010-1234', customer: 'Preview business', nextEstimatedRenewalAt: new Date(Date.now() + 2 * 86400000).toISOString() }] };
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
  let externalBlocked = 0, writes = 0, fixtureSaves = 0;
  try {
    for (const width of [320, 412, 820, 1180, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      let unavailable = false; const errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => {
        const request = route.request(), url = new URL(request.url());
        if (url.pathname.startsWith('/api/admin/')) {
          if (request.method() !== 'GET') {
            if (url.pathname === '/api/admin/finances/verified' && request.method() === 'POST') {
              fixtureSaves++;
              const body = request.postDataJSON();
              assert.equal(body.provider, 'render'); assert.equal(body.field, 'monthlyEstimate'); assert.equal(body.billingMonth, at.slice(0, 7));
              assert.equal(body.value, 17.75); assert.equal(body.currency, 'CAD');
              return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, entry: { ...body, source: 'dashboard_verified' } }) });
            }
            writes++; return route.abort();
          }
          if (url.pathname === '/api/admin/finances') return route.fulfill({ status: unavailable ? 503 : 200,
            contentType: 'application/json', body: JSON.stringify(unavailable ? { error: 'Unavailable' } : { ok: true, finances: fixture }) });
          if (url.pathname === '/api/admin/finances/history') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, history: [{ type: 'verification', field: 'monthlyEstimate', recordedAt: at, value: { ...metric(19), billingMonth: at.slice(0, 7) }, previous: metric(17.75) }] }) });
          if (url.pathname === '/api/admin/cost-audit') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, audit: { twilioPhoneBilling: phoneBilling } }) });
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
      assert.ok((await panel.textContent()).includes('Recheck Render') || (await panel.textContent()).includes('Check Render monthly cost'));
      await panel.getByText('Estimated renewal · amount unknown', { exact: true }).waitFor();
      await panel.screenshot({ path: path.join(output, `${width}-finance-overview.png`) });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: path.join(output, `${width}-page-top.png`) });
      await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
      const accessibility = await page.evaluate(async () => window.axe.run('.finance-panel', { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } }));
      assert.deepEqual(accessibility.violations.map(row => ({ id: row.id, description: row.description })), [], `Costs accessibility at ${width}`);
      await panel.getByRole('button', { name: 'View Render history' }).click();
      const history = panel.getByRole('region', { name: 'Finance history' });
      await history.getByText(/Previous: USD 17.75/).waitFor();
      await panel.getByRole('button', { name: 'Close history' }).click();
      await panel.getByRole('button', { name: 'Record a dashboard-verified fact' }).click();
      await panel.getByLabel('Provider', { exact: true }).selectOption('render');
      await panel.getByLabel('Fact', { exact: true }).selectOption('nextBillAt');
      await panel.getByLabel('Billing date').fill('2026-11-01');
      assert.equal(await panel.getByLabel('Currency', { exact: true }).count(), 0);
      await panel.getByLabel('Fact', { exact: true }).selectOption('monthlyEstimate');
      await panel.getByLabel('Amount', { exact: true }).fill('17.75');
      await panel.getByLabel('Currency', { exact: true }).selectOption('CAD');
      await panel.getByLabel('Estimate covers month', { exact: true }).fill(at.slice(0, 7));
      await panel.getByRole('button', { name: 'Checked just now' }).click();
      assert.ok((await panel.locator('.finance-save-preview').textContent()).includes('CAD 17.75'));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Overflow at ${width}`);
      await panel.screenshot({ path: path.join(output, `${width}-finance.png`) });
      await panel.getByRole('button', { name: 'Save verified fact', exact: true }).click();
      await panel.getByText(/Saved Monthly cost estimate: CAD 17.75/).waitFor();
      unavailable = true;
      await panel.getByRole('button', { name: 'Refresh finances', exact: true }).click();
      await panel.getByRole('alert').waitFor();
      assert.ok((await panel.textContent()).includes('USD 40.00'));
      assert.ok((await panel.textContent()).includes('last-known values'));
      assert.deepEqual(errors, []); await page.close();
      console.log(`PASS finance ${width}px: overview, renewal timeline, history, confirmed fixture save, stale/error retention, no horizontal overflow.`);
    }
    assert.equal(writes, 0);
    assert.equal(fixtureSaves, 5);
    fs.writeFileSync(path.join(output, 'browser-report.json'), JSON.stringify({ passed: true, widths: [320, 412, 820, 1180, 1440], writes, fixtureSaves, externalBlocked, productionRequests: 0 }, null, 2));
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
