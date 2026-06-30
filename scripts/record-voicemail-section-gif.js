const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { nodeCommand, rootPath, run } = require("./_helpers");

function getArg(name, fallback = "") {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function parseViewport(value) {
  const [width, height] = String(value || "1365x768").split("x").map((part) => Number(part));
  return {
    width: Number.isFinite(width) && width > 0 ? width : 1365,
    height: Number.isFinite(height) && height > 0 ? height : 768,
  };
}

async function main() {
  const url = getArg("url", "http://localhost:3000/");
  const selector = getArg("selector", "#voicemail-vs-ai");
  const viewport = parseViewport(getArg("viewport", "1365x768"));
  const frameCount = Number(getArg("frames", "18"));
  const frameDelayMs = Number(getArg("delay", "220"));
  const name = getArg("name", "landing-voicemail-section-animation.gif");
  const caption = getArg("caption", "Local MyAIPA voicemail section animation");
  const frameDir = rootPath("diagnostics", "browser-drive", "gif-frames");
  const gifPath = rootPath("diagnostics", "browser-drive", name);

  fs.rmSync(frameDir, { recursive: true, force: true });
  fs.mkdirSync(frameDir, { recursive: true });
  fs.mkdirSync(path.dirname(gifPath), { recursive: true });

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport });
    page.on("console", (message) => {
      if (message.type() === "error") console.log(`browser console error: ${message.text()}`);
    });
    console.log(`Opening ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(1200);
    await page.locator(selector).first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
    await page.evaluate(() => {
      const animatedSelectors = [
        ".voicemail-ring-core",
        ".voicemail-ring-pulse-one",
        ".voicemail-ring-pulse-two",
        ".voicemail-ring-badge",
        ".voicemail-opportunity-line",
        ".voicemail-no-answer",
        ".voicemail-competitor-arrow span",
        ".voicemail-competitor-card",
      ];
      const animatedElements = document.querySelectorAll(animatedSelectors.join(","));
      animatedElements.forEach((element) => {
        element.style.animation = "none";
      });
      document.body.offsetHeight;
      animatedElements.forEach((element) => {
        element.style.animation = "";
      });
    });
    await page.waitForTimeout(80);

    const section = page.locator(selector).first();
    for (let index = 0; index < frameCount; index += 1) {
      const framePath = path.join(frameDir, `frame-${String(index).padStart(3, "0")}.png`);
      await section.screenshot({ path: framePath });
      await page.waitForTimeout(frameDelayMs);
    }
  } finally {
    await browser.close();
  }

  run("python", [path.join("scripts", "make-gif.py"), frameDir, gifPath, String(frameDelayMs)]);
  console.log(`GIF saved: ${gifPath}`);

  run(nodeCommand(), [
    path.join("scripts", "telegram-send-animation.js"),
    `--animation=${gifPath}`,
    `--caption=${caption}`,
  ]);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
