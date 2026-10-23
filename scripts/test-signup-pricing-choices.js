// Offline browser regression: never contacts providers, verifies a customer,
// buys a number, or submits the final signup form.
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

async function main() {
  const root = path.resolve(process.env.PRICING_QA_BUILD_DIR || "build-codex-preview");
  assert.ok(fs.existsSync(path.join(root, "index.html")), "Run npm run build:preview first.");
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;
  const browser = await chromium.launch({ headless: true, executablePath });
  const output = path.resolve("diagnostics/pricing-choices");
  fs.mkdirSync(output, { recursive: true });
  try {
    for (const viewport of [{ width: 320, height: 740 }, { width: 393, height: 852 },
      { width: 412, height: 915 }, { width: 768, height: 1024 }, { width: 820, height: 1180 },
      { width: 1180, height: 820 }, { width: 1440, height: 1000 }, { width: 1920, height: 1080 }]) {
      const page = await browser.newPage({ viewport, reducedMotion: 'reduce' });
      page.setDefaultTimeout(15000);
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("**/*", (route) => {
        const url = new URL(route.request().url());
        if (url.hostname !== "127.0.0.1" || route.request().method() !== "GET") return route.abort();
        const name = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname).replace(/^\//, "");
        const file = path.resolve(root, name);
        if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return route.abort();
        return route.fulfill({ path: file });
      });
      await page.goto("http://127.0.0.1:3001/#/signup", { waitUntil: "domcontentloaded" });
      const checkHint = async (message) => {
        const hint = page.locator('.signup-mobile-disabled-reason, .signup-desktop-disabled-reason').filter({ visible: true });
        await hint.waitFor();
        assert.equal(await hint.textContent(), message);
        const layout = await hint.evaluate(note => {
          const rect = note.getBoundingClientRect();
          const parent = (note.closest('.signup-mobile-action-bar') || note.closest('form')).getBoundingClientRect();
          return { align: getComputedStyle(note).textAlign,
            offset: Math.abs((rect.left + rect.right - parent.left - parent.right) / 2),
            overflow: document.documentElement.scrollWidth > innerWidth };
        });
        assert.equal(layout.align, 'center'); assert.ok(layout.offset < 2, `Hint is off-center at ${viewport.width}px`);
        assert.equal(layout.overflow, false);
      };
      await checkHint('Choose one trade to continue.');
      // DOM clicks avoid Windows native-input stalls, without bypassing disabled controls.
      const clickControl = async (locator) => {
        await locator.waitFor({ state: 'visible' });
        assert.equal(await locator.isEnabled(), true);
        await locator.evaluate(element => element.click());
      };
      const click = async (name) => clickControl(page.getByRole("button", { name, exact: true }).filter({ visible: true }).first());
      await click("Electrician");
      await clickControl(page.locator(".signup-trade-top-continue"));
      await checkHint('Choose at least one property type to continue.');
      await click("Residential");
      await click("Continue to service areas");
      await checkHint('Choose at least one service area to continue.');
      await click("Hamilton");
      if (viewport.width < 768) await click("Next");
      else await click("Continue to business details");
      await checkHint('Complete the required business details to continue.');
      if (viewport.width >= 640) {
        const controls = page.locator('#signup-business-details .signup-inline-actions button');
        const back = await controls.nth(0).boundingBox(), next = await controls.nth(1).boundingBox();
        const note = await page.locator('.signup-desktop-disabled-reason').filter({ visible: true }).boundingBox();
        assert.ok(Math.abs(back.y - next.y) < 2, 'Business details buttons must share one dedicated row');
        assert.ok(note.y >= Math.max(back.y + back.height, next.y + next.height), 'Guidance must be below both buttons');
      }
      if (viewport.width < 640) await page.locator('.signup-mobile-action-bar').screenshot({ path: path.join(output, `business-details-${viewport.width}.png`) });
      else await page.screenshot({ path: path.join(output, `business-details-${viewport.width}.png`), fullPage: true });
      for (const [id, value] of Object.entries({
        "your-name-input": "Morgan Taylor", "business-name-input": "Taylor Electrical",
        "business-phone-number-input": "9055550199", "email-address-input": "morgan@taylor-electrical.ca",
        "street-address-input": "91 Mountain Road", "city-input": "Hamilton", "postal-code-input": "L8P 1A1",
      })) await page.locator(`#${id}`).fill(value);
      await click("Continue to service call pricing");
      const choices = page.locator('#signup-pricing input[type="checkbox"]');
      assert.equal(await choices.count(), 5);
      for (let i = 0; i < 5; i++) assert.equal(await choices.nth(i).isChecked(), false);
      await click("Review and confirm");
      assert.equal(await page.locator('.signup-review-step').count(), 1);
      assert.equal(await page.getByText('Check your setup', { exact: true }).count(), 0);
      assert.equal(await page.locator('[data-testid="turnstile-container"]').count(), 1);
      await checkHint('Complete the verification above to start your trial.');
      await page.getByText("No pricing announcements selected. Your assistant will still collect service requests.", { exact: true }).filter({ visible: true }).waitFor();
      const reviewRow = page.getByText("Service calls & installations", { exact: true }).locator("..").locator("..");
      await clickControl(reviewRow.getByRole("button", { name: "Change", exact: true }));
      await clickControl(page.getByRole("checkbox", { name: "Share minimum service visit fee", exact: true }));
      assert.equal(await page.locator('#signup-pricing button[type="submit"]').isDisabled(), true);
      await checkHint('Choose service calls and complete any required prices.');
      await page.locator("#minimum-service-visit-fee-input").fill("125");
      assert.equal(await page.locator("#hourly-labour-rate-input").count(), 0);
      await clickControl(choices.nth(0));
      await clickControl(choices.nth(0));
      assert.equal(await page.locator("#minimum-service-visit-fee-input").inputValue(), "125");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: path.join(output, `step5-${viewport.width}.png`), fullPage: true, animations: "disabled" });
      await clickControl(page.locator('#signup-pricing button[type="submit"]'));
      await page.getByText("Minimum service visit: 125 dollars.", { exact: true }).filter({ visible: true }).waitFor();
      const rowText = await page.getByText("Service calls & installations", { exact: true }).locator("..").locator("..").innerText();
      assert.doesNotMatch(rowText, /Parts are extra|per hour|free quote|technician will assess/i);
      await page.screenshot({ path: path.join(output, `review-${viewport.width}.png`), fullPage: true, animations: "disabled" });
      assert.deepEqual(errors, []);
      console.log(`PASS ${viewport.width}px: independent choices, optional rates, retained edits, truthful review, no overflow.`);
      await page.close();
    }
    console.log("Production writes: 0. Screenshots: diagnostics/pricing-choices/");
  } catch (error) { console.error(error); throw error; }
  finally { await browser.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
