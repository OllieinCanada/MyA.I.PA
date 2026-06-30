const path = require("path");
const { chromium } = require("playwright");
const { ensureDir, rootPath } = require("./_helpers");

const outputDir = rootPath("diagnostics", "browser-drive");

function getArg(name, fallback = "") {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function getArgs(name) {
  const prefix = `--${name}=`;
  return process.argv.filter((arg) => arg.startsWith(prefix)).map((arg) => arg.slice(prefix.length));
}

function parseViewport(value) {
  const [width, height] = String(value || "1365x768").split("x").map((part) => Number(part));
  return {
    width: Number.isFinite(width) && width > 0 ? width : 1365,
    height: Number.isFinite(height) && height > 0 ? height : 768,
  };
}

function locatorFor(page, target) {
  if (target.startsWith("text=")) return page.getByText(target.slice(5), { exact: false }).first();
  if (target.startsWith("role=")) {
    const [, role, name] = target.match(/^role=([^:]+):(.+)$/) || [];
    if (!role || !name) throw new Error(`Bad role locator: ${target}. Use role=button:Start Free Trial`);
    return page.getByRole(role, { name: new RegExp(name, "i") }).first();
  }
  return page.locator(target).first();
}

async function main() {
  const url = getArg("url", "http://localhost:3000");
  const viewport = parseViewport(getArg("viewport", "1365x768"));
  const showBrowser = process.argv.includes("--show");
  const fullPage = !process.argv.includes("--viewport-only");
  const screenshotName = getArg("screenshot", "browser-drive.png");
  const quality = Number(getArg("quality", "62"));
  const waitMs = Number(getArg("wait", "600"));
  const clicks = getArgs("click");
  const fills = getArgs("type");
  const waitForTargets = getArgs("wait-for");
  const actions = getArgs("action");

  ensureDir(outputDir);

  let browser;
  try {
    browser = await chromium.launch({ headless: !showBrowser });
  } catch (error) {
    try {
      browser = await chromium.launch({ headless: !showBrowser, channel: "chrome" });
    } catch (_chromeError) {
      try {
        browser = await chromium.launch({ headless: !showBrowser, channel: "msedge" });
      } catch (_edgeError) {
        throw error;
      }
    }
  }
  const page = await browser.newPage({ viewport });

  page.on("console", (message) => {
    if (message.type() === "error") console.log(`browser console error: ${message.text()}`);
  });

  console.log(`Opening ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
  await page.waitForTimeout(waitMs);

  async function typeInto(fill) {
    const splitAt = fill.indexOf("=");
    if (splitAt < 1) throw new Error(`Bad type command: ${fill}. Use --type=\"selector=value\"`);
    const target = fill.slice(0, splitAt);
    const value = fill.slice(splitAt + 1);
    console.log(`Typing into ${target}`);
    await locatorFor(page, target).fill(value);
    await page.waitForTimeout(150);
  }

  async function clickTarget(target) {
    console.log(`Clicking ${target}`);
    await locatorFor(page, target).click();
    await page.waitForTimeout(waitMs);
  }

  async function waitForTarget(target) {
    console.log(`Waiting for ${target}`);
    await locatorFor(page, target).waitFor({ state: "visible", timeout: 10000 });
  }

  if (actions.length) {
    for (const action of actions) {
      const splitAt = action.indexOf(":");
      if (splitAt < 1) throw new Error(`Bad action: ${action}. Use click:target, type:target=value, or wait-for:target`);
      const kind = action.slice(0, splitAt);
      const value = action.slice(splitAt + 1);
      if (kind === "click") await clickTarget(value);
      else if (kind === "type") await typeInto(value);
      else if (kind === "wait-for") await waitForTarget(value);
      else throw new Error(`Unknown action type: ${kind}`);
    }
  } else {
    for (const target of waitForTargets) await waitForTarget(target);
    for (const fill of fills) await typeInto(fill);
    for (const target of clicks) await clickTarget(target);
  }

  const screenshotPath = path.join(outputDir, screenshotName);
  const extension = path.extname(screenshotName).toLowerCase();
  const screenshotOptions = { path: screenshotPath, fullPage };
  if (extension === ".jpg" || extension === ".jpeg") {
    screenshotOptions.type = "jpeg";
    screenshotOptions.quality = Number.isFinite(quality) ? Math.max(1, Math.min(100, quality)) : 62;
  }
  await page.screenshot(screenshotOptions);
  console.log(`Screenshot saved: ${screenshotPath}`);

  if (showBrowser) {
    console.log("Browser left open for 30 seconds because --show was used.");
    await page.waitForTimeout(30000);
  }

  await browser.close();
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
