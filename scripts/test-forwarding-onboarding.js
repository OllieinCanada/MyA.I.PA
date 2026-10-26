// Offline, fixture-only browser coverage for the three approved setup pages.
// Reuses the project's production-build preview pattern. No provider is contacted.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { resolveForwardingRule } = require('../server/callForwardingProvider');
const { renderOnboardingReadyPage } = require('../server/onboardingReadyPage');
const copy = require('../src/features/onboarding/onboardingCopy');

const viewports = [
  ['small-phone', 320, 568], ['iphone', 390, 844], ['pixel-9', 412, 915],
  ['tablet', 768, 1024], ['ipad-air', 820, 1180], ['ipad-air-landscape', 1180, 820],
  ['desktop', 1440, 900],
];
const normalize = text => String(text).replace(/\s+/g, ' ').trim();
const aiNumber = '+12895550199';
const sampleDetails = { businessName: 'Offline fixture business', services: 'Electrical repairs', serviceAreas: 'Niagara', businessNotes: 'Please collect the caller’s job details.' };

async function main() {
  const root = path.resolve(process.env.PRICING_QA_BUILD_DIR || 'docs');
  assert.ok(fs.existsSync(path.join(root, 'index.html')), 'Build the site first.');
  const executable = 'C:/Users/Olive/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (fs.existsSync(executable) ? executable : undefined) });
  const output = path.resolve('diagnostics/forwarding-onboarding');
  fs.mkdirSync(output, { recursive: true });
  const report = { schemaVersion: 1, fixtureOnly: true, providerCalls: 0, checks: [] };
  const scenarios = viewports.map(([name, width, height]) => ({ name, width, height, carrier: 'bell', lineType: 'mobile' }));
  scenarios.push(...[['rogers-mobile', 'rogers', 'mobile'], ['landline', 'rogers', 'landline'], ['cloud', 'other', 'voip'], ['unknown', 'not_sure', 'not_sure']].map(([name, carrier, lineType]) => ({ name, width: 390, height: 844, carrier, lineType })));

  try {
    for (const scenario of scenarios) {
      const { name, width, height, carrier, lineType } = scenario;
      console.log('CHECK ' + name + ': three stages and verification-ready page');
      const context = await browser.newContext({ viewport: { width, height }, userAgent: name === 'iphone' ? 'iPhone' : width <= 412 ? 'Android' : undefined, reducedMotion: 'reduce', serviceWorkers: 'block' });
      const page = await context.newPage();
      page.setDefaultTimeout(12000);
      let apiWrites = 0;
      let editorSaves = 0;
      const unexpectedRequests = [];
      const consoleErrors = [];
      page.on('pageerror', error => consoleErrors.push(error.message));
      const rule = resolveForwardingRule({ carrier, lineType, destination: aiNumber });
      const forwarding = { id: 'offline-saved-setup', carrier, lineType, forwardingStatus: 'carrier_needed', assignedMyAiPaNumber: aiNumber, rule };
      await context.route('**/*', async route => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.pathname === '/api/forwarding/setup' && request.method() === 'GET') return route.fulfill({ json: { forwarding } });
        if (url.pathname === '/api/customer/dashboard/business-details' && request.method() === 'GET') return route.fulfill({ json: { ok: true, revision: 0, status: 'ready', details: sampleDetails, editableFields: Object.keys(sampleDetails) } });
        if (url.pathname === '/api/customer/dashboard/business-details' && request.method() === 'PATCH') {
          apiWrites += 1; editorSaves += 1;
          assert.equal(request.headers().authorization, 'Forwarding offline-fixture');
          assert.equal(request.headers()['x-myaipa-editor'], '1');
          const submitted = request.postDataJSON();
          assert.equal(submitted.expectedRevision, 0);
          assert.ok(submitted.requestId);
          assert.deepEqual(Object.keys(submitted.details).sort(), Object.keys(sampleDetails).sort());
          return route.fulfill({ json: { ok: true, status: 'published', revision: 1, details: submitted.details } });
        }
        if (request.method() !== 'GET') { unexpectedRequests.push(request.method() + ' ' + url.pathname); return route.abort(); }
        if (url.hostname !== '127.0.0.1') { unexpectedRequests.push(url.origin); return route.abort(); }
        if (url.pathname === '/verification-preview') return route.fulfill({ contentType: 'text/html', body: renderOnboardingReadyPage({ assignedPhone: aiNumber, forwardingSetupUrl: 'http://127.0.0.1:3219/#/f/offline-fixture', frontendAppUrl: 'http://127.0.0.1:3219' }) });
        let file;
        try { file = path.resolve(root, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\//, '')); } catch (_) { return route.abort(); }
        if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return route.abort();
        return route.fulfill({ path: file });
      });

      await page.goto('http://127.0.0.1:3219/#/f/offline-fixture', { waitUntil: 'domcontentloaded' });
      await page.locator('.onboarding-info p').filter({ hasText: copy.testInfo }).waitFor();
      assert.equal(normalize(await page.locator('h1').innerText()), copy.readyTitle);
      assert.equal(await page.locator('.onboarding-number-label').innerText(), copy.numberLabel);
      assert.equal(await page.locator('.onboarding-number-value').getAttribute('href'), 'tel:' + aiNumber);
      const stageOneTexts = await page.locator('.onboarding-stage-one').innerText();
      assert.ok(stageOneTexts.indexOf('+1 (289) 555-0199') < stageOneTexts.indexOf(copy.numberLabel));
      assert.ok(stageOneTexts.indexOf(copy.numberLabel) < stageOneTexts.indexOf(copy.testTitle));
      assert.ok(stageOneTexts.includes(copy.practice));
      assert.ok(stageOneTexts.includes(copy.testInfo));
      assert.ok(!stageOneTexts.includes('Practice is optional'));
      assert.ok(!stageOneTexts.includes('After your call, look for both texts'));
      assert.equal(await page.locator('a[href="tel:+19057885488"]').count(), 2);
      assert.equal(await page.locator('input[type=checkbox]').count(), 0);
      await assertNoOverflow(page, name + ' step1');
      await page.screenshot({ path: path.join(output, name + '-step-1.png'), fullPage: true, animations: 'disabled' });

      await page.getByRole('button', { name: copy.forwardingAction, exact: true }).click();
      await page.getByRole('heading', { name: copy.forwardingTitle, exact: true }).waitFor();
      assert.equal(await page.locator('.onboarding-instructions').getAttribute('open'), null);
      if (rule.activationMethod === 'DIAL_STRING' && rule.supported) assert.equal(await page.locator('.forwarding-activate').getAttribute('href'), rule.activationTelUri);
      else assert.equal(await page.locator('.forwarding-activate').count(), 0);
      assert.ok((await page.locator('.onboarding-stage-two').innerText()).includes(copy.activationBoundary));
      assert.ok((await page.locator('.onboarding-stage-two').innerText()).includes(copy.timing));
      await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('pageshow')); document.dispatchEvent(new Event('visibilitychange')); });
      assert.equal(apiWrites, 0);
      assert.equal(await page.getByRole('button', { name: /Continue to reminders/ }).isEnabled(), true);
      await assertNoOverflow(page, name + ' step2');
      await page.screenshot({ path: path.join(output, name + '-step-2.png'), fullPage: true, animations: 'disabled' });

      await page.getByRole('button', { name: /Continue to reminders/ }).click();
      await page.getByRole('heading', { name: copy.finalTitle, exact: true }).waitFor();
      const expectedFinal = [copy.finalTitle, copy.finalCall, copy.finalMessages, copy.finalReportTitle, copy.finalReport, copy.finalSupport, copy.supportLabel, copy.finalReassurance].join(' ');
      assert.equal(normalize(await page.locator('.onboarding-stage-three').innerText()), normalize(expectedFinal));
      assert.equal(await page.locator('input[type=checkbox],.onboarding-stage-three button').count(), 0);
      assert.equal(await page.getByText('Open my dashboard', { exact: true }).count(), 0);
      assert.equal(apiWrites, 0);
      await assertNoOverflow(page, name + ' step3');
      await page.screenshot({ path: path.join(output, name + '-step-3.png'), fullPage: true, animations: 'disabled' });

      if (name === 'pixel-9') {
        await page.locator('.onboarding-progress button').nth(0).click();
        await page.getByRole('button', { name: copy.editDetails, exact: true }).click();
        const nameField = page.getByLabel('Business display name', { exact: true });
        await nameField.waitFor();
        await nameField.fill('Updated offline fixture business');
        // Keyboard submission also verifies the prefilled form's native submit
        // path without a long-page scroll/actionability race in headless Chrome.
        await nameField.press('Enter');
        await page.getByRole('heading', { name: copy.testTitle, exact: true }).waitFor();
        assert.equal(editorSaves, 1);
        assert.equal(await page.locator('.onboarding-number-value').getAttribute('href'), 'tel:' + aiNumber);
      }

      // Real SMS verification URL remains server-rendered, not a frontend-only fix.
      if (viewports.some(([viewportName]) => viewportName === name)) {
        await page.goto('http://127.0.0.1:3219/verification-preview', { waitUntil: 'domcontentloaded' });
        await page.locator('#copy-number').waitFor();
        assert.equal(await page.locator('#verification-title').innerText(), copy.readyTitle);
        assert.equal(await page.locator('.onboarding-info p').innerText(), copy.testInfo);
        assert.equal(await page.locator('.onboarding-number-label').innerText(), copy.numberLabel);
        assert.equal(await page.locator('.onboarding-forward-cta').getAttribute('href'), 'http://127.0.0.1:3219/#/f/offline-fixture?step=2');
        await assertNoOverflow(page, name + ' verification ready');
        await page.screenshot({ path: path.join(output, name + '-verification-ready.png'), fullPage: true, animations: 'disabled' });
      }
      assert.deepEqual(unexpectedRequests, [], 'All external/provider writes must remain blocked');
      assert.deepEqual(consoleErrors, [], 'No browser runtime errors');
      report.checks.push({ name, viewport: { width, height }, provider: carrier + ':' + lineType, stages: 3, passed: true, editorSaves });
      await context.close();
      console.log('PASS ' + name + ': exact three pages, dynamic number, no callback/gating/overflow, server-ready parity.');
    }
    report.ready = true;
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  }
}

async function assertNoOverflow(page, label) {
  const overflow = await page.evaluate(() => Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) - innerWidth);
  assert.ok(overflow <= 1, label + ' horizontal overflow: ' + overflow);
  const targets = await page.locator('.onboarding-primary,.onboarding-secondary,.onboarding-progress button').evaluateAll(elements => elements.filter(element => element.getClientRects().length).map(element => ({ height: element.getBoundingClientRect().height, text: element.textContent.trim() })));
  assert.ok(targets.every(target => target.height >= 44), label + ': visible controls need >=44px touch targets');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
