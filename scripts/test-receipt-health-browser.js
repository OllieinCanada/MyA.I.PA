// Offline full-app UI test. All API responses are fixtures; no network requests escape.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

async function main() {
  const root = path.resolve(process.env.BUILD_PREVIEW_DIR || 'docs');
  assert.ok(fs.existsSync(path.join(root, 'index.html')), 'Build the application first.');
  const output = path.resolve('diagnostics/twilio-receipt-health');
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
  let writes = 0, externalBlocked = 0;
  try {
    for (const width of [320, 412, 820, 1180, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      let status = 'critical';
      await page.route('**/*', route => {
        const request = route.request(), url = new URL(request.url());
        if (url.pathname.startsWith('/api/admin/')) {
          if (request.method() !== 'GET') { writes++; return route.abort(); }
          let data = { ok: true };
          if (url.pathname === '/api/admin/attention') data = { ok: true,
            generatedAt: '2026-10-25T00:00:00Z', summary: { total: 0, bySeverity: {} }, items: [], auditEvents: [],
            twilioReceipts: { status, counts: { pending: 3, processing: 1, completed: 10, failed: 1, expiredLeases: 0 },
              oldestPendingAgeSeconds: 700, workerAgeSeconds: 601, lastSuccessfulRunAt: '2026-10-24T23:49:59Z',
              checkedAt: '2026-10-25T00:00:00Z', lastErrorCode: 'P2028' } };
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
        }
        if (url.origin !== 'http://127.0.0.1:4179') { externalBlocked++; return route.abort(); }
        const relative = decodeURIComponent(url.pathname) === '/' ? 'index.html' : '.' + decodeURIComponent(url.pathname);
        const file = path.resolve(root, relative);
        if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return route.fulfill({ status: 404, body: '' });
        const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
        return route.fulfill({ status: 200, contentType: types[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
      });
      await page.goto('http://127.0.0.1:4179/#/admin?tab=attention');
      const panel = page.getByRole('region', { name: 'SMS delivery receipt worker' });
      await panel.getByText('Recovery needed', { exact: true }).waitFor();
      assert.ok((await panel.textContent()).includes('700 seconds'));
      assert.ok((await panel.textContent()).includes('P2028'));
      assert.equal(await panel.getByRole('button').count(), 0);
      assert.equal(await page.getByText('Pilot-clean', { exact: true }).count(), 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Overflow at ${width}px`);
      await panel.screenshot({ path: path.join(output, `${width}-critical.png`) });
      status = 'unavailable';
      await page.getByRole('button', { name: 'Refresh checks', exact: true }).click();
      await panel.getByText('Status unavailable', { exact: true }).waitFor();
      assert.ok((await panel.textContent()).includes('Do not resend'));
      assert.equal(await page.getByText('Pilot-clean', { exact: true }).count(), 0);
      assert.deepEqual(errors, []);
      await page.close();
      console.log(`PASS ${width}px: real admin loader retains health, read-only panel, unavailable state, no overflow.`);
    }
    assert.equal(writes, 0);
    const report = { passed: true, viewportWidths: [320, 412, 820, 1180, 1440], productionRequests: 0, writes, externalBlocked };
    fs.writeFileSync(path.join(output, 'browser-report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report));
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
