// Render only the local built site. Never call providers or submit a signup.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

async function main() {
  const root = path.resolve(process.env.PRICING_QA_BUILD_DIR || 'docs');
  assert.ok(fs.existsSync(path.join(root, 'index.html')), 'Build Pages first.');
  const executable = 'C:/Users/Olive/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (fs.existsSync(executable) ? executable : undefined) });
  const output = path.resolve('diagnostics/homepage-hero');
  fs.mkdirSync(output, { recursive: true });
  try {
    for (const viewport of [{ width: 390, height: 760 }, { width: 390, height: 844 }, { width: 1365, height: 768 }]) {
      const page = await browser.newPage({ viewport, reducedMotion: 'reduce' });
      page.setDefaultTimeout(15000);
      await page.route('**/*', (route) => {
        const url = new URL(route.request().url());
        if (url.hostname !== '127.0.0.1' || route.request().method() !== 'GET') return route.abort();
        const file = path.resolve(root, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\//, ''));
        if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return route.abort();
        return route.fulfill({ path: file });
      });
      await page.goto('http://127.0.0.1:3219/', { waitUntil: 'domcontentloaded' });
      await page.locator('.simple-contractor-burst').waitFor();
      await page.screenshot({ path: path.join(output, `${viewport.width}-${viewport.height}.png`), animations: 'disabled' });
      const layout = await page.evaluate(() => {
        const rect = (selector) => {
          const bounds = document.querySelector(selector).getBoundingClientRect();
          return { top: bounds.top, bottom: bounds.bottom, left: bounds.left, right: bounds.right };
        };
        return { header: rect('.simple-header'), burst: rect('.simple-contractor-burst'), trial: rect('.simple-hero-actions .simple-primary'), sample: rect('.simple-hero-actions .simple-secondary'), overflow: document.documentElement.scrollWidth > innerWidth };
      });
      console.log(JSON.stringify({ viewport, layout }));
      assert.equal(layout.overflow, false);
      if (viewport.width === 390) {
        assert.ok(Math.abs(layout.burst.top - layout.header.bottom) < 5, 'Graphic must meet the header');
        assert.ok(layout.sample.bottom <= viewport.height, 'Sample button must fit in viewport');
        assert.ok(Math.abs(layout.trial.top - layout.sample.top) < 1, 'Buttons must share a row');
        assert.ok(layout.trial.right <= layout.sample.left, 'Buttons must not overlap');
      } else {
        assert.ok(layout.burst.top > layout.header.bottom + 30, 'Keep desktop hero spacing');
        await page.locator('#why-it-matters').screenshot({ path: path.join(output, 'voicemail-desktop.png'), animations: 'disabled' });
      }
      console.log(`PASS ${viewport.width}x${viewport.height}: hero spacing and actions, no overflow.`);
      await page.close();
    }
  } finally { await browser.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
