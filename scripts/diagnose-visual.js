const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { ensureDir, rootPath } = require("./_helpers");

const outputDir = rootPath("diagnostics", "visual");
const baseUrlArg = process.argv.find((arg) => arg.startsWith("--url="));
const baseUrl = (baseUrlArg ? baseUrlArg.split("=").slice(1).join("=") : process.env.VISUAL_TEST_URL || "http://localhost:3000").replace(/\/+$/, "");
const routes = [
  { name: "home", path: "/" },
  { name: "signup", path: "/#/signup" },
];
const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "laptop", width: 1365, height: 768 },
  { name: "mobile", width: 390, height: 844 },
];

const requiredText = {
  home: ["Answers the phone", "Start Free Trial", "Hear Agent"],
  signup: ["Business setup", "Choose your trade"],
};

async function checkServerReachable(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function collectPageDiagnostics(page, pageName) {
  return page.evaluate((expectedText) => {
    const body = document.body;
    const html = document.documentElement;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const text = (body.innerText || "").toLowerCase();
    const horizontalOverflow = Math.max(body.scrollWidth, html.scrollWidth) - viewportWidth;
    const fixedOrVisibleElements = Array.from(document.querySelectorAll("body *"))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.visibility !== "hidden" &&
          style.display !== "none"
        );
      });

    const offscreenElements = fixedOrVisibleElements
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.left < -2 || rect.right > viewportWidth + 2;
      })
      .sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right)
      .slice(0, 12)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          className: String(element.className || "").slice(0, 120),
          text: String(element.innerText || element.getAttribute("aria-label") || "").trim().slice(0, 80),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
        };
      });

    const heroNav = document.querySelector(".landing-hero-shell nav");
    const heroNavBottom = heroNav ? heroNav.getBoundingClientRect().bottom : 0;
    const heroSafeTop = Math.round(heroNavBottom + 8);
    const heroPhoneElements = Array.from(document.querySelectorAll(".landing-phone, .landing-summary"))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      });
    const foldCutoffElements = heroPhoneElements
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          className: String(element.className || "").slice(0, 120),
          text: String(element.innerText || "").trim().slice(0, 80),
          top: Math.round(rect.top),
          bottom: Math.round(rect.bottom),
          clippedBy: Math.max(0, Math.round(rect.bottom - viewportHeight)),
        };
      })
      .filter((item) => item.top < viewportHeight && item.clippedBy > 12);
    const topOverlapElements = heroPhoneElements
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          className: String(element.className || "").slice(0, 120),
          text: String(element.innerText || "").trim().slice(0, 80),
          top: Math.round(rect.top),
          safeTop: heroSafeTop,
          overlapsBy: Math.max(0, Math.round(heroSafeTop - rect.top)),
        };
      })
      .filter((item) => item.overlapsBy > 0);

    const missingText = expectedText.filter((item) => !text.includes(String(item).toLowerCase()));

    return {
      title: document.title,
      viewportWidth,
      viewportHeight,
      scrollWidth: Math.max(body.scrollWidth, html.scrollWidth),
      scrollHeight: Math.max(body.scrollHeight, html.scrollHeight),
      horizontalOverflow,
      missingText,
      offscreenElements,
      foldCutoffElements,
      topOverlapElements,
    };
  }, requiredText[pageName] || []);
}

async function main() {
  ensureDir(outputDir);

  const reachable = await checkServerReachable(`${baseUrl}/`);
  if (!reachable) {
    console.error(`Could not reach ${baseUrl}/ within 6 seconds.`);
    console.error("Start a fresh preview first: npm run preview:fresh");
    console.error("Or point this script at a healthy server: npm run diagnose:visual -- --url=http://localhost:3001");
    process.exit(1);
  }

  let browser;
  try {
    browser = await chromium.launch();
  } catch (error) {
    console.error("Playwright is installed, but Chromium is not available yet.");
    console.error("Run: npx playwright install chromium");
    console.error(error.message);
    process.exit(1);
  }

  const report = {
    baseUrl,
    generatedAt: new Date().toISOString(),
    checks: [],
  };

  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();

    for (const route of routes) {
      const url = `${baseUrl}${route.path}`;
      const screenshotName = `${route.name}-${viewport.name}.png`;
      const screenshotPath = path.join(outputDir, screenshotName);

      console.log(`Checking ${url} at ${viewport.width}x${viewport.height}...`);
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 12000 });
        await page.waitForTimeout(1200);
        await page.screenshot({ path: screenshotPath, fullPage: true });
        const diagnostics = await collectPageDiagnostics(page, route.name);
        const warnings = [];

        if (diagnostics.horizontalOverflow > 2) {
          warnings.push(`Horizontal overflow: ${diagnostics.horizontalOverflow}px`);
        }
        if (diagnostics.missingText.length) {
          warnings.push(`Missing expected text: ${diagnostics.missingText.join(", ")}`);
        }
        if (diagnostics.horizontalOverflow > 2 && diagnostics.offscreenElements.length) {
          warnings.push(`${diagnostics.offscreenElements.length} visible elements extend past the viewport`);
        }
        if (route.name === "home" && diagnostics.foldCutoffElements.length) {
          warnings.push(`${diagnostics.foldCutoffElements.length} hero phone mockups extend below the visible fold`);
        }
        if (route.name === "home" && diagnostics.topOverlapElements.length) {
          warnings.push(`${diagnostics.topOverlapElements.length} hero phone mockups overlap the header area`);
        }

        report.checks.push({
          route: route.name,
          viewport: viewport.name,
          url,
          screenshot: path.relative(rootPath(), screenshotPath),
          warnings,
          diagnostics,
        });
      } catch (error) {
        report.checks.push({
          route: route.name,
          viewport: viewport.name,
          url,
          screenshot: path.relative(rootPath(), screenshotPath),
          warnings: [`Failed to check page: ${error.message}`],
          diagnostics: null,
        });
      }
    }

    await context.close();
  }

  await browser.close();

  const reportPath = path.join(outputDir, "report.json");
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  const warnings = report.checks.flatMap((check) => check.warnings.map((warning) => `${check.route}/${check.viewport}: ${warning}`));
  console.log("");
  console.log(`Screenshots and report saved to ${outputDir}`);
  if (warnings.length) {
    console.log("Warnings:");
    for (const warning of warnings) console.log(`- ${warning}`);
    process.exitCode = 1;
  } else {
    console.log("No obvious visual issues detected.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
