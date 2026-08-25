const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { rootPath } = require("./_helpers");

function getArg(name, fallback) {
  const prefix = `--${name}=`;
  const value = process.argv.find((argument) => argument.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

const targets = [
  {
    key: "myaipa",
    label: "MY AI PA — CURRENT HOMEPAGE",
    url: getArg("left-url", "https://www.myaipa.ca/"),
  },
  {
    key: "dialbox",
    label: "DIALBOX — CURRENT HOMEPAGE",
    url: getArg("right-url", "https://dialbox.ca/"),
  },
];

const views = [
  { key: "desktop", width: 1440, height: 960 },
  { key: "mobile", width: 390, height: 844 },
];

const outputDir = rootPath("diagnostics", "competitor-visuals");

async function openBrowser() {
  const launchOptions = { headless: true, args: ["--disable-gpu", "--disable-dev-shm-usage"] };
  try {
    return await chromium.launch(launchOptions);
  } catch (error) {
    for (const channel of ["chrome", "msedge"]) {
      try {
        return await chromium.launch({ ...launchOptions, channel });
      } catch (_channelError) {
        // Try the next installed browser.
      }
    }
    throw error;
  }
}

async function capture(browser, target, view) {
  const context = await browser.newContext({
    viewport: { width: view.width, height: view.height },
    deviceScaleFactor: 1,
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  await page.goto(target.url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(6000);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.addStyleTag({
    content: "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}",
  });
  const filePath = path.join(outputDir, `${target.key}-${view.key}.png`);
  await page.screenshot({ path: filePath, animations: "disabled" });
  await context.close();
  return filePath;
}

async function compose(browser, view, captures) {
  const labelHeight = 64;
  const gutter = 24;
  const outer = 24;
  const outputWidth = outer * 2 + view.width * 2 + gutter;
  const outputHeight = outer * 2 + labelHeight + view.height;
  const page = await browser.newPage({ viewport: { width: outputWidth, height: outputHeight } });
  const cards = captures.map(({ target, filePath }) => {
    const data = fs.readFileSync(filePath).toString("base64");
    return `<section><header>${target.label}<small>${target.url}</small></header><img src="data:image/png;base64,${data}" alt="${target.label}"></section>`;
  }).join("");
  await page.setContent(`<!doctype html><html><head><style>
    *{box-sizing:border-box}html,body{margin:0;background:#061a35;font-family:Arial,sans-serif}
    main{display:grid;grid-template-columns:repeat(2,${view.width}px);gap:${gutter}px;padding:${outer}px}
    section{overflow:hidden;border:1px solid #2a4966;border-radius:18px;background:#fff;box-shadow:0 18px 42px rgba(0,0,0,.3)}
    header{height:${labelHeight}px;display:flex;flex-direction:column;justify-content:center;padding:0 18px;background:#0a2948;color:#fff;font-size:17px;font-weight:900;letter-spacing:.03em}
    header small{display:block;margin-top:4px;color:#9edcff;font-size:11px;font-weight:700;letter-spacing:0}
    img{width:${view.width}px;height:${view.height}px;display:block;object-fit:cover;object-position:top}
  </style></head><body><main>${cards}</main></body></html>`);
  const outputPath = path.join(outputDir, `myaipa-vs-dialbox-${view.key}.png`);
  await page.screenshot({ path: outputPath, animations: "disabled" });
  await page.close();
  return outputPath;
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const browser = await openBrowser();
  try {
    for (const view of views) {
      const captures = [];
      for (const target of targets) {
        console.log(`Capturing ${target.url} at ${view.width}x${view.height}`);
        const filePath = await capture(browser, target, view);
        captures.push({ target, filePath });
      }
      const comparison = await compose(browser, view, captures);
      console.log(`Comparison saved: ${comparison}`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
