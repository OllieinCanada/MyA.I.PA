// Offline browser regression: never contacts providers, verifies a customer,
// buys a number, or submits the final signup form.
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

async function main() {
  const root = path.resolve(process.env.PRICING_QA_BUILD_DIR || "build-codex-preview");
  assert.ok(fs.existsSync(path.join(root, "index.html")), "Run npm run build:preview first.");
  const bundledBrowser = "C:/Users/Olive/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe";
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (fs.existsSync(bundledBrowser) ? bundledBrowser : undefined);
  const browser = await chromium.launch({ headless: true, executablePath });
  const output = path.resolve("diagnostics/pricing-choices");
  fs.mkdirSync(output, { recursive: true });
  try {
    for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 1000 }]) {
      const page = await browser.newPage({ viewport });
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
      const click = async (name) => page.getByRole("button", { name, exact: true }).filter({ visible: true }).first().click();
      await click("Electrician");
      await page.locator(".signup-trade-top-continue").click();
      await click("Residential");
      await click("Continue to service areas");
      await click("Hamilton");
      if (viewport.width < 768) await click("Next");
      else await click("Continue to business details");
      for (const [id, value] of Object.entries({
        "your-name-input": "Morgan Taylor", "business-name-input": "Taylor Electrical",
        "business-phone-number-input": "9055550199", "email-address-input": "morgan@taylor-electrical.ca",
        "street-address-input": "91 Mountain Road", "city-input": "Hamilton", "postal-code-input": "L8P 1A1",
      })) await page.locator(`#${id}`).fill(value);
      await click("Continue to service call pricing");
      const choices = page.locator('#signup-pricing input[type="checkbox"]');
      assert.equal(await choices.count(), 5);
      for (let i = 0; i < 5; i++) assert.equal(await choices.nth(i).isChecked(), false);
      await click("Continue to check your setup");
      await page.getByText("No pricing announcements selected. Your assistant will still collect service requests.", { exact: true }).filter({ visible: true }).waitFor();
      const reviewRow = page.getByText("Service calls & installations", { exact: true }).locator("..").locator("..");
      await reviewRow.getByRole("button", { name: "Change", exact: true }).click();
      await page.getByRole("checkbox", { name: "Share minimum service visit fee", exact: true }).check();
      assert.equal(await page.locator('#signup-pricing button[type="submit"]').isDisabled(), true);
      await page.locator("#minimum-service-visit-fee-input").fill("125");
      assert.equal(await page.locator("#hourly-labour-rate-input").count(), 0);
      await choices.nth(0).uncheck();
      await choices.nth(0).check();
      assert.equal(await page.locator("#minimum-service-visit-fee-input").inputValue(), "125");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: path.join(output, `step5-${viewport.width}.png`), fullPage: true, animations: "disabled" });
      await page.locator('#signup-pricing button[type="submit"]').click();
      await page.getByText("Minimum service visit: 125 dollars.", { exact: true }).filter({ visible: true }).waitFor();
      const rowText = await page.getByText("Service calls & installations", { exact: true }).locator("..").locator("..").innerText();
      assert.doesNotMatch(rowText, /Parts are extra|per hour|free quote|technician will assess/i);
      await page.screenshot({ path: path.join(output, `review-${viewport.width}.png`), fullPage: true, animations: "disabled" });
      assert.deepEqual(errors, []);
      console.log(`PASS ${viewport.width}px: independent choices, optional rates, retained edits, truthful review, no overflow.`);
      await page.close();
    }
    console.log("Production writes: 0. Screenshots: diagnostics/pricing-choices/");
  } finally { await browser.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
