const path = require("path");
const { chromium } = require("playwright");
const { ensureDir, rootPath } = require("./_helpers");

const url = process.argv.find((arg) => arg.startsWith("--url="))?.slice(6)
  || "http://127.0.0.1:3000/#/try-demo?source=qr";
const screenshotsOnly = process.argv.includes("--screenshots-only");
const outputDir = rootPath("diagnostics", "browser-drive");
const questionsPath = path.join(outputDir, "try-demo-questions.png");
const desktopReadyPath = path.join(outputDir, "try-demo-desktop-ready.png");
const desktopActivePath = path.join(outputDir, "try-demo-desktop-active.png");
const mobileReadyPath = path.join(outputDir, "try-demo-mobile-ready.png");

async function answerQuestions(page) {
  await page.getByRole("button", { name: /Electrician/i }).click();
  await page.getByPlaceholder("e.g., Dan's Electrical").fill("Dapper Dan's Electrical");
  await page.getByPlaceholder("e.g., Hamilton").fill("Hamilton");
  await page.getByRole("button", { name: /Create my live demo/i }).click();
  await page.getByText("Your assistant is ready.", { exact: true }).waitFor({ state: "visible", timeout: 15000 });
  await page.getByText("Ready to call", { exact: true }).waitFor({ state: "visible", timeout: 20000 });
}

async function main() {
  ensureDir(outputDir);
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
    const desktopContext = await browser.newContext({
      viewport: { width: 1440, height: 1050 },
      permissions: ["microphone"],
    });
    await desktopContext.grantPermissions(["microphone"], { origin });
    const desktop = await desktopContext.newPage();
    await desktop.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    await desktop.getByText("Hear My AI PA answer for your business.", { exact: true }).waitFor({ state: "visible" });
    await desktop.screenshot({ path: questionsPath, fullPage: true });
    await answerQuestions(desktop);
    await desktop.getByText("Dapper Dan's Electrical", { exact: true }).first().waitFor({ state: "visible" });
    await desktop.getByText(/Hi, thanks for calling Dapper Dan's Electrical\./).waitFor({ state: "visible" });
    await desktop.screenshot({ path: desktopReadyPath, fullPage: true });

    if (!screenshotsOnly) {
      await desktop.getByRole("button", { name: "Start test call" }).click();
      await desktop.getByText(/Assistant speaking|Listening/, { exact: true }).waitFor({ state: "visible", timeout: 30000 });
      await desktop.screenshot({ path: desktopActivePath, fullPage: true });
      await desktop.getByRole("button", { name: "End test call" }).click();
      await desktop.getByText("Ready to call", { exact: true }).waitFor({ state: "visible", timeout: 20000 });
    }
    await desktopContext.close();

    const mobileContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 1,
    });
    const mobile = await mobileContext.newPage();
    await mobile.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    await answerQuestions(mobile);
    await mobile.screenshot({ path: mobileReadyPath, fullPage: true });
    await mobileContext.close();

    console.log(JSON.stringify({
      ok: true,
      qrRoute: url,
      questionsRequired: 3,
      personalizedBusinessName: true,
      realCallStartedAndEnded: !screenshotsOnly,
      screenshots: {
        questions: questionsPath,
        desktopReady: desktopReadyPath,
        desktopActive: desktopActivePath,
        mobileReady: mobileReadyPath,
      },
    }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
