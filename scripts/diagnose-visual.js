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
  { name: "dashboard", path: "/#/dashboard" },
  { name: "admin", path: "/#/admin", waitMs: 7200 },
];
const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "firefox-window", width: 1536, height: 650 },
  { name: "laptop", width: 1365, height: 768 },
  { name: "mobile", width: 390, height: 844 },
];

const requiredText = {
  home: ["Answers the phone", "Start Free Trial", "Hear Agent", "Owner Phone (Cellphone)", "Instantly sends"],
  signup: ["Business setup", "Choose your trade"],
  dashboard: ["Owner dashboard", "Signup email", "Welcome back"],
  admin: ["Admin Dashboard", "Admin Password", "Unlock Admin"],
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
    const heroPhoneElements = Array.from(document.querySelectorAll(".landing-phone, .landing-summary, .landing-call-dashboard"))
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
      .filter((item) => item.overlapsBy > 12);

    function rectFor(selector) {
      const element = document.querySelector(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return {
        selector,
        top: Math.round(rect.top),
        right: Math.round(rect.right),
        bottom: Math.round(rect.bottom),
        left: Math.round(rect.left),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    }

    function overlapAmount(a, b) {
      if (!a || !b) return 0;
      const xOverlap = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
      const yOverlap = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      return Math.round(xOverlap * yOverlap);
    }

    const dashboardRect = rectFor(".landing-call-dashboard");
    const conversationRect = rectFor(".landing-conversation-panel");
    const leadNoteRect = rectFor(".landing-lead-note");
    const leadCardRect = rectFor(".landing-lead-card");
    const ownerCardRect = rectFor(".landing-call-owner-card");
    const callControlsRect = rectFor(".landing-call-controls");
    const hangupButtonRect = rectFor(".landing-hangup-button");
    const dashboardIssues = [];

    if (dashboardRect && viewportWidth >= 1024) {
      if (dashboardRect.right > viewportWidth + 2) {
        dashboardIssues.push(`Dashboard extends ${Math.round(dashboardRect.right - viewportWidth)}px past viewport right edge`);
      }
      if (dashboardRect.bottom > viewportHeight + 2) {
        dashboardIssues.push(`Dashboard extends ${Math.round(dashboardRect.bottom - viewportHeight)}px below visible viewport`);
      }
    }
    if (viewportWidth >= 1024 && dashboardRect && leadCardRect && leadCardRect.bottom > dashboardRect.bottom + 6) {
      dashboardIssues.push(`Lead card is clipped by dashboard bottom (${Math.round(leadCardRect.bottom - dashboardRect.bottom)}px)`);
    }
    if (viewportWidth >= 1024 && conversationRect && leadCardRect && overlapAmount(conversationRect, leadCardRect) > 0) {
      dashboardIssues.push("Lead card overlaps conversation panel");
    }
    if (viewportWidth >= 1024 && conversationRect && leadNoteRect && overlapAmount(conversationRect, leadNoteRect) > 0) {
      dashboardIssues.push("Lead note overlaps conversation panel");
    }
    if (viewportWidth >= 1024 && leadNoteRect && leadCardRect && overlapAmount(leadNoteRect, leadCardRect) > 0) {
      dashboardIssues.push("Lead note overlaps lead card");
    }
    if (viewportWidth >= 1024 && dashboardRect && hangupButtonRect && hangupButtonRect.bottom > dashboardRect.bottom + 2) {
      dashboardIssues.push(`Hang-up button is clipped by dashboard bottom (${Math.round(hangupButtonRect.bottom - dashboardRect.bottom)}px)`);
    }
    if (viewportWidth >= 1024 && ownerCardRect && hangupButtonRect && overlapAmount(ownerCardRect, hangupButtonRect) > 0) {
      dashboardIssues.push("Hang-up button overlaps owner text card");
    }

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
      dashboard: {
        dashboardRect,
        conversationRect,
        leadNoteRect,
        leadCardRect,
        ownerCardRect,
        callControlsRect,
        hangupButtonRect,
        issues: dashboardIssues,
      },
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
        await page.waitForTimeout(route.waitMs || 1200);
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
          warnings.push(`${diagnostics.foldCutoffElements.length} hero visual elements extend below the visible fold`);
        }
        if (route.name === "home" && diagnostics.topOverlapElements.length) {
          warnings.push(`${diagnostics.topOverlapElements.length} hero visual elements overlap the header area`);
        }
        if (route.name === "home" && diagnostics.dashboard.issues.length) {
          warnings.push(...diagnostics.dashboard.issues);
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
