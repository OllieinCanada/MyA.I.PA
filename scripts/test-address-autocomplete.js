const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

function isGoogleApiUrl(value) {
  try {
    const { protocol, hostname } = new URL(value);
    return protocol === "https:" && (hostname === "googleapis.com" || hostname.endsWith(".googleapis.com"));
  } catch (_) { return false; }
}

// Safe by default: mock Google, never submit a signup or create any resources.
async function main() {
  const live = process.argv.includes("--live-google");
  const productionOrigin = process.argv.includes("--test-production-origin");
  const arg = (name, fallback) => process.argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback;
  const url = productionOrigin ? "https://www.myaipa.ca/#/signup?qa=turnstile" : arg("url", "http://127.0.0.1:3010/#/signup?qa=turnstile");
  const output = path.resolve("diagnostics/browser-drive");
  fs.mkdirSync(output, { recursive: true });
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch (_) { browser = await chromium.launch({ headless: true, channel: "chrome" }); }
  const results = [];
  try {
    for (const width of live ? [390] : [390, 820, 1365]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: "block" });
      // Exercise the real key's production referrer restrictions while keeping
      // the not-yet-deployed website build local. This does not change the site.
      if (productionOrigin) await context.route("https://www.myaipa.ca/**", async (route) => {
        const requestUrl = new URL(route.request().url());
        const response = await route.fetch({ url: `http://127.0.0.1:3010${requestUrl.pathname}${requestUrl.search}` });
        await route.fulfill({ response });
      });
      await context.route("**/api/integrations/signup", (route) => route.abort());
      if (!live) await context.addInitScript(() => {
        window.google = { maps: { importLibrary: async () => ({
          AutocompleteSessionToken: class {},
          AutocompleteSuggestion: { fetchAutocompleteSuggestions: async () => ({ suggestions: [{ placePrediction: {
            placeId: "qa-only", text: { toString: () => "277 Mud Street, Hamilton, ON, Canada" },
            toPlace: () => ({ fetchFields: async () => {}, addressComponents: [
              ["street_number", "277"], ["route", "Mud Street"], ["locality", "Hamilton"], ["administrative_area_level_1", "ON"], ["postal_code", "L8J3Z6"], ["country", "CA"],
            ].map(([type, text]) => ({ types: [type], longText: text, shortText: text })) }),
          } }] }) },
        }) } };
      });
      const page = await context.newPage();
      const providerErrors = new Set();
      page.on("console", (message) => {
        const code = message.text().match(/\b(?:[A-Za-z]+MapError|REQUEST_DENIED|PERMISSION_DENIED)\b/)?.[0];
        if (code) providerErrors.add(code);
      });
      page.on("requestfailed", (request) => {
        if (isGoogleApiUrl(request.url())) providerErrors.add(`Google network failure: ${request.failure()?.errorText || "unknown"}`);
      });
      page.on("response", async (response) => {
        if (isGoogleApiUrl(response.url()) && response.status() >= 400) {
          providerErrors.add(`Google ${new URL(response.url()).pathname} HTTP ${response.status()}`);
          const body = await response.text().catch(() => "");
          let error = {};
          try { error = JSON.parse(body); } catch (_) { /* Google may return a plain-text error. */ }
          if (typeof error.error?.status === "string") providerErrors.add(error.error.status);
          for (const detail of error.error?.details || []) if (typeof detail.reason === "string") providerErrors.add(detail.reason);
          for (const [pattern, code] of [[/key[^.\n]*invalid|invalid[^.\n]*key/i, "INVALID_API_KEY"], [/not authorized/i, "NOT_AUTHORIZED"], [/billing/i, "BILLING_CONFIGURATION"], [/referer|referrer/i, "REFERRER_CONFIGURATION"], [/has not been used|not enabled|disabled/i, "API_NOT_ENABLED"], [/expired/i, "KEY_EXPIRED"]]) if (pattern.test(body)) providerErrors.add(code);
        }
      });
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.locator("#street-address-input").waitFor();
      await page.locator("#street-address-input").fill("277 Mud Street");
      try {
        await page.getByRole("option").first().waitFor({ timeout: 20000 });
      } catch (_) {
        console.log(JSON.stringify({ mode: live ? "live-google" : "mock", origin: new URL(url).origin, width, providerReady: false,
          providerErrors: [...providerErrors], fallbackVisible: await page.getByText("Address suggestions are unavailable. Enter your address manually.").count() > 0 }));
        process.exitCode = 1;
        await context.close();
        continue;
      }
      await page.locator(".signup-address-autocomplete").screenshot({ path: path.join(output, `address-suggestions-${width}.png`) });
      const choice = live ? page.getByRole("option").filter({ hasText: "Hamilton" }).first() : page.getByRole("option").first();
      await choice.click();
      await page.waitForFunction(() => document.getElementById("street-address-input").value !== "277 Mud Street" || document.getElementById("city-input").value === "Hamilton");
      const fields = await page.evaluate(() => Object.fromEntries(["street-address-input", "city-input", "province-select", "postal-code-input"].map((id) => [id, document.getElementById(id).value])));
      if (!live) assert.deepEqual(fields, { "street-address-input": "277 Mud Street", "city-input": "Hamilton", "province-select": "ON", "postal-code-input": "L8J 3Z6" });
      for (const value of Object.values(fields)) assert.ok(value.trim(), "The selected test address must fill all four fields");
      if (live) { assert.equal(fields["city-input"], "Hamilton"); assert.equal(fields["province-select"], "ON"); }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false, "Address form must fit the viewport");
      await page.locator("#city-input").fill("Manual correction");
      assert.equal(await page.locator("#city-input").inputValue(), "Manual correction");
      results.push({ width, selectedAddressFilled: true, fieldsFilled: ["streetAddress", "city", "province", "postalCode"], manualCorrectionWorks: true });
      await page.screenshot({ path: path.join(output, `address-filled-${width}.png`), fullPage: true });
      await context.close();
    }
    console.log(JSON.stringify({ mode: live ? "live-google" : "mock", origin: new URL(url).origin, signupSubmitted: false, results }, null, 2));
  } finally { await browser.close(); }
}
module.exports = { isGoogleApiUrl };
if (require.main === module) main().catch(() => { console.error("Address autocomplete check failed; no signup was submitted. Check the local preview and provider configuration."); process.exitCode = 1; });
