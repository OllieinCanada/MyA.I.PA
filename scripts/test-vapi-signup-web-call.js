const path = require("path");
const { chromium } = require("playwright");
const { ensureDir, rootPath } = require("./_helpers");

const url = process.argv.find((arg) => arg.startsWith("--url="))?.slice(6) || "http://127.0.0.1:3000/#/signup";
const screenshotPath = rootPath("diagnostics", "browser-drive", "signup-live-browser-call-active.png");

async function advanceToVoiceStep(page) {
  await page.getByRole("button", { name: /^Electrician$/i }).click();
  await page.getByRole("button", { name: /Next: Service area/i }).click();
  await page.getByRole("button", { name: /Next: Business details/i }).click();
  await page.locator("#business-owner-s-name-input").fill("Tim Owner");
  await page.locator("#business-name-input").fill("Tim's Electrical");
  await page.locator("#business-phone-number-input").fill("(905) 321-6789");
  await page.locator("#email-address-input").fill("tim@timselectrical.ca");
  await page.locator("#street-address-input").fill("23 Robb St");
  await page.locator("#city-input").fill("Hamilton");
  await page.locator("#postal-code-input").fill("L8P 4A5");
  await page.getByRole("button", { name: /Next: Pricing/i }).click();
  await page.getByRole("button", { name: /Review details/i }).click();
  await page.getByRole("button", { name: /Continue to voice/i }).click();
}

async function main() {
  ensureDir(path.dirname(screenshotPath));
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
    ],
  });

  try {
    const origin = new URL(url).origin;
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1050 },
      permissions: ["microphone"],
    });
    await context.grantPermissions(["microphone"], { origin });
    const page = await context.newPage();
    const browserErrors = [];
    page.on("console", (message) => {
      if (message.type() === "error") browserErrors.push(message.text());
    });

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    await advanceToVoiceStep(page);
    await page.getByText("Ready to call", { exact: true }).waitFor({ state: "visible", timeout: 20000 });
    await page.getByRole("button", { name: "Start test call" }).click();
    await page.getByText(/Assistant speaking|Listening/, { exact: true }).waitFor({ state: "visible", timeout: 30000 });
    await page.screenshot({ path: screenshotPath, fullPage: true });
    await page.waitForTimeout(2500);
    await page.getByRole("button", { name: "End test call" }).click();
    await page.getByText("Ready to call", { exact: true }).waitFor({ state: "visible", timeout: 20000 });

    const visibleError = await page.locator('[role="status"]').filter({ hasText: /unavailable|could not|allow microphone|busy/i }).count();
    if (visibleError) throw new Error("The signup page displayed a live-call error.");
    if (browserErrors.some((message) => /vapi|daily|microphone|permission/i.test(message))) {
      throw new Error(`Browser call console error: ${browserErrors.find((message) => /vapi|daily|microphone|permission/i.test(message))}`);
    }

    console.log(JSON.stringify({
      ok: true,
      callStarted: true,
      callEnded: true,
      businessNamePersonalized: true,
      screenshot: screenshotPath,
    }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
