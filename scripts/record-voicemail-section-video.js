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
  const durationMs = Number(getArg("duration", "7000"));
  const name = getArg("name", "voicemail-section-animation.webm");
  const caption = getArg("caption", "Local MyAIPA voicemail section animation");
  const videoDir = rootPath("diagnostics", "browser-drive", "video");
  const finalPath = rootPath("diagnostics", "browser-drive", name);

  fs.mkdirSync(videoDir, { recursive: true });
  fs.mkdirSync(path.dirname(finalPath), { recursive: true });

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport,
      recordVideo: {
        dir: videoDir,
        size: viewport,
      },
    });
    const page = await context.newPage();
    page.on("console", (message) => {
      if (message.type() === "error") console.log(`browser console error: ${message.text()}`);
    });

    console.log(`Opening ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(1200);
    await page.locator(selector).first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);
    await page.waitForTimeout(Number.isFinite(durationMs) ? durationMs : 7000);

    const video = page.video();
    await context.close();
    const recordedPath = await video.path();
    fs.copyFileSync(recordedPath, finalPath);
  } finally {
    await browser.close();
  }

  console.log(`Video saved: ${finalPath}`);
  run(nodeCommand(), [
    path.join("scripts", "telegram-send-video.js"),
    `--video=${finalPath}`,
    `--caption=${caption}`,
  ]);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
