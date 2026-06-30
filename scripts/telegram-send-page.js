const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { nodeCommand, rootPath, run } = require("./_helpers");

function getArg(name, fallback = "") {
  const prefix = `--${name}=`;
  const match = process.argv.filter((arg) => arg.startsWith(prefix)).pop();
  return match ? match.slice(prefix.length) : fallback;
}

function parseViewport(value) {
  const [width, height] = String(value || "1280x720").split("x").map((part) => Number(part));
  return {
    width: Number.isFinite(width) && width > 0 ? width : 1280,
    height: Number.isFinite(height) && height > 0 ? height : 720,
  };
}

async function main() {
  const url = getArg("url", "https://www.myaipa.ca/");
  const viewport = parseViewport(getArg("viewport", "1280x720"));
  const rawScrollY = getArg("scrollY", "");
  const scrollY = rawScrollY ? Number(rawScrollY) : NaN;
  const targetText = getArg("text", "");
  const targetSelector = getArg("selector", "");
  const crop = getArg("crop", targetSelector ? "element" : "viewport");
  const align = getArg("align", "start");
  const offset = Number(getArg("offset", "24"));
  const waitMs = Number(getArg("wait", "2500"));
  const name = getArg("name", "telegram-page-latest.png");
  const caption = getArg("caption", `Screenshot: ${url}`);
  const screenshotPath = rootPath("diagnostics", "browser-drive", name);
  const phoneSharePath = rootPath("phone-share", name);

  fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
  fs.mkdirSync(path.dirname(phoneSharePath), { recursive: true });

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    try {
      browser = await chromium.launch({ headless: true, channel: "chrome" });
    } catch (_chromeError) {
      try {
        browser = await chromium.launch({ headless: true, channel: "msedge" });
      } catch (_edgeError) {
        throw error;
      }
    }
  }

  try {
    const page = await browser.newPage({ viewport });
    page.on("console", (message) => {
      if (message.type() === "error") console.log(`browser console error: ${message.text()}`);
    });
    console.log(`Opening ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(waitMs);
    if (targetSelector || targetText) {
      const target = await page.evaluate(
        ({ targetSelector, targetText, align, offset }) => {
          let element = null;
          if (targetSelector) {
            element = document.querySelector(targetSelector);
          }

          if (!element && targetText) {
            const needle = targetText.toLowerCase();
            const candidates = Array.from(document.querySelectorAll("section, main > div, h1, h2, h3, p, div"))
              .filter((candidate) => {
                const text = (candidate.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
                return text.includes(needle);
              })
              .sort((a, b) => {
                const aRect = a.getBoundingClientRect();
                const bRect = b.getBoundingClientRect();
                const aScore = Math.abs(aRect.height - window.innerHeight) + Math.abs(aRect.width - window.innerWidth);
                const bScore = Math.abs(bRect.height - window.innerHeight) + Math.abs(bRect.width - window.innerWidth);
                return aScore - bScore;
              });
            element = candidates[0] || null;
          }

          if (!element) return null;

          const rect = element.getBoundingClientRect();
          const absoluteTop = rect.top + window.scrollY;
          let top = absoluteTop - offset;
          if (align === "center") {
            top = absoluteTop - Math.max(0, (window.innerHeight - rect.height) / 2);
          } else if (align === "end") {
            top = absoluteTop - Math.max(0, window.innerHeight - rect.height) + offset;
          }
          window.scrollTo(0, Math.max(0, top));
          return {
            tagName: element.tagName,
            text: (element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 160),
            top: Math.max(0, top),
          };
        },
        { targetSelector, targetText, align, offset: Number.isFinite(offset) ? offset : 24 },
      );
      if (!target) {
        throw new Error(`Target not found for ${targetSelector ? `selector "${targetSelector}"` : `text "${targetText}"`}`);
      }
      console.log(`Scrolled to target: ${target.tagName} "${target.text}" at ${Math.round(target.top)}`);
      await page.waitForTimeout(waitMs);
    } else if (Number.isFinite(scrollY) && scrollY > 0) {
      console.log(`Scrolling to ${scrollY}`);
      await page.evaluate((targetY) => window.scrollTo(0, targetY), scrollY);
      await page.waitForTimeout(waitMs);
    }
    if (crop === "element" && targetSelector) {
      await page.locator(targetSelector).first().screenshot({ path: screenshotPath });
    } else {
      await page.screenshot({ path: screenshotPath, fullPage: false });
    }
    fs.copyFileSync(screenshotPath, phoneSharePath);
    console.log(`Screenshot saved: ${screenshotPath}`);
  } finally {
    await browser?.close();
  }

  run(nodeCommand(), [
    path.join("scripts", "telegram-send-photo.js"),
    `--photo=${screenshotPath}`,
    `--caption=${caption}`,
  ]);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
