// Offline browser coverage: fixture-only API reads; all external requests/writes blocked.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { resolveForwardingRule } = require('../server/callForwardingProvider');

async function main() {
  const root = path.resolve(process.env.PRICING_QA_BUILD_DIR || 'docs');
  assert.ok(fs.existsSync(path.join(root, 'index.html')), 'Build the site first.');
  const executable = 'C:/Users/Olive/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (fs.existsSync(executable) ? executable : undefined) });
  const output = path.resolve('diagnostics/forwarding-onboarding');
  fs.mkdirSync(output, { recursive: true });
  try {
    for (const [name, carrier, lineType] of [['mobile', 'bell', 'mobile'], ['iphone', 'rogers', 'mobile'], ['landline', 'rogers', 'landline'], ['cloud', 'other', 'voip'], ['unknown', 'not_sure', 'not_sure']]) {
      let writes = 0;
      const rule = resolveForwardingRule({ carrier, lineType, destination: '+12895550199' });
      const page = await browser.newPage({ viewport: { width: 390, height: 844 }, userAgent: name === 'iphone' ? 'iPhone' : 'Android', reducedMotion: 'reduce' });
      page.setDefaultTimeout(15000);
      await page.route('**/*', (route) => {
        const url = new URL(route.request().url());
        if (url.pathname === '/api/forwarding/setup' && route.request().method() === 'GET') return route.fulfill({ json: { forwarding: { id: 'preview-only', carrier, lineType, forwardingStatus: 'carrier_needed', assignedMyAiPaNumber: '+12895550199', rule } } });
        if (route.request().method() !== 'GET') { writes += 1; return route.abort(); }
        if (url.hostname !== '127.0.0.1') return route.abort();
        const file = path.resolve(root, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\//, ''));
        if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return route.abort();
        return route.fulfill({ path: file });
      });
      await page.goto('http://127.0.0.1:3219/#/f/preview-only', { waitUntil: 'domcontentloaded' });
      await page.locator('.forwarding-command').waitFor();
      assert.equal(await page.locator('select').count(), 0);
      assert.equal(await page.getByText('Cellphone or landline?', { exact: true }).count(), 0);
      assert.equal(await page.getByText('Test My Setup', { exact: true }).count(), 0);
      assert.equal(await page.locator('.forwarding-brand svg rect').count(), 7);
      if (rule.activationDialString) assert.equal(await page.locator('.forwarding-command strong').innerText(), rule.activationDialString);
      else assert.equal(await page.getByRole('button', { name: 'Copy forwarding number', exact: true }).count(), 1);
      if (rule.activationMethod === 'DIAL_STRING' && name !== 'iphone') assert.equal(await page.locator('.forwarding-activate').getAttribute('href'), rule.activationTelUri);
      else assert.equal(await page.locator('.forwarding-activate').count(), 0);
      await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('pageshow')); document.dispatchEvent(new Event('visibilitychange')); });
      await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true, animations: 'disabled' });
      assert.equal(writes, 0, 'Opening or returning to setup must never place a call or mutate providers');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      console.log(`PASS ${name}: immediate instructions, correct saved rule, no callback or writes.`);
      await page.close();
    }
  } finally { await browser.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
