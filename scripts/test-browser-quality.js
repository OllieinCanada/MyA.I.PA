const fs = require("fs");
const { spawn } = require("child_process");
const net = require("net");
const path = require("path");
const { chromium, firefox, webkit } = require("playwright");
const { rootPath } = require("./_helpers");

const buildDir = rootPath("build");
const axePath = require.resolve("axe-core/axe.min.js");
const browserTypes = { chromium, firefox, webkit };
const requestedEngines = String(process.env.BROWSER_ENGINES || "chromium")
  .split(",")
  .map((name) => name.trim().toLowerCase())
  .filter(Boolean);
const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 1024, height: 768 },
  { name: "mobile", width: 390, height: 844 },
];
const routes = [
  { name: "home", hash: "#/", h1: /never miss a call again/i },
  { name: "signup", hash: "#/signup", h1: /create your ai phone assistant/i },
];
function assertBuildExists() {
  if (!fs.existsSync(path.join(buildDir, "index.html"))) {
    throw new Error("Missing build/index.html. Run npm run build before npm run test:browser:quality.");
  }
}

async function withTimeout(promise, timeoutMs, description) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out during ${description}`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function reservePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const port = probe.address().port;
      probe.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function createStaticServer() {
  const port = await reservePort();
  const child = spawn(process.execPath, [rootPath("scripts", "preview-build.js"), `--port=${port}`], {
    cwd: rootPath(),
    env: { ...process.env, HOST: "127.0.0.1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const ready = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out starting the production build preview")), 15_000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code) => {
      if (code === 0) return;
      clearTimeout(timeout);
      reject(new Error(`Production build preview exited with code ${code}`));
    });
    child.stdout.on("data", (chunk) => {
      if (!String(chunk).includes("Build preview ready:")) return;
      clearTimeout(timeout);
      resolve();
    });
  });
  await ready;
  return {
    baseUrl: `http://127.0.0.1:${port}/`,
    server: {
      close(callback) {
        if (!child.killed) child.kill();
        callback();
      },
    },
  };
}

async function runAxe(page) {
  await page.addScriptTag({ path: axePath });
  return page.evaluate(async () => window.axe.run(document, {
    runOnly: {
      type: "tag",
      values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
    },
    resultTypes: ["violations"],
  }));
}

async function clickVisibleByText(page, text) {
  const clicked = await page.evaluate((expected) => {
    const candidates = Array.from(document.querySelectorAll("button, a"));
    const target = candidates.find((element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return element.textContent.replace(/\s+/g, " ").trim() === expected
        && style.visibility !== "hidden"
        && style.display !== "none"
        && rect.width > 0
        && rect.height > 0
        && !element.disabled;
    });
    if (!target) return false;
    target.click();
    return true;
  }, text);
  if (!clicked) throw new Error(`Could not find a visible enabled control named ${JSON.stringify(text)}`);
}

function describeViolation(violation) {
  const targets = violation.nodes.slice(0, 3).flatMap((node) => node.target).join(", ");
  return `${violation.impact || "unknown"}: ${violation.id} (${targets || "unknown target"})`;
}

async function auditPage({ browser, baseUrl, engineName, route, viewport }) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  page.setDefaultNavigationTimeout(15_000);
  const runtimeErrors = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !/service worker/i.test(message.text())) runtimeErrors.push(message.text());
  });

  try {
    await page.goto(`${baseUrl}${route.hash}`, { waitUntil: "domcontentloaded" });
    console.log(`[browser-quality] loaded ${engineName}/${route.name}/${viewport.name}`);
    await page.locator("h1").first().waitFor({ state: "visible" });
    const headingText = await page.evaluate(() => Array.from(document.querySelectorAll("h1"))
      .map((heading) => heading.textContent)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim());
    if (!route.h1.test(headingText)) {
      throw new Error(`${route.name} primary heading was ${JSON.stringify(headingText)}`);
    }
    await page.waitForTimeout(150);

    const layout = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      h1Count: document.querySelectorAll("h1").length,
      title: document.title,
    }));
    if (layout.scrollWidth > layout.clientWidth + 2) {
      throw new Error(`${route.name} overflows horizontally by ${layout.scrollWidth - layout.clientWidth}px`);
    }
    if (layout.h1Count !== 1) throw new Error(`${route.name} has ${layout.h1Count} h1 elements; expected exactly one`);
    if (!layout.title.trim()) throw new Error(`${route.name} has no document title`);
    console.log(`[browser-quality] layout ${engineName}/${route.name}/${viewport.name}`);

    await page.keyboard.press("Tab");
    const focus = await page.evaluate(() => ({
      tag: document.activeElement?.tagName || "",
      tabIndex: document.activeElement?.tabIndex,
    }));
    if (["", "BODY", "HTML"].includes(focus.tag) || focus.tabIndex === -1) {
      throw new Error(`${route.name} does not expose a keyboard-reachable first control`);
    }

    const axe = await runAxe(page);
    console.log(`[browser-quality] accessibility ${engineName}/${route.name}/${viewport.name}`);
    const blocking = axe.violations.filter((violation) => ["critical", "serious"].includes(violation.impact));
    const warnings = axe.violations.filter((violation) => !blocking.includes(violation));
    if (blocking.length) {
      throw new Error(`accessibility violations: ${blocking.map(describeViolation).join("; ")}`);
    }
    if (runtimeErrors.length) throw new Error(`browser runtime errors: ${runtimeErrors.slice(0, 3).join("; ")}`);

    return {
      engine: engineName,
      route: route.name,
      viewport: viewport.name,
      accessibilityWarnings: warnings.map(describeViolation),
    };
  } finally {
    await context.close();
  }
}

async function testSignupJourney(browser, baseUrl) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  page.setDefaultNavigationTimeout(15_000);
  try {
    await page.goto(`${baseUrl}#/`, { waitUntil: "domcontentloaded" });
    await page.getByText("Start Your Free Trial", { exact: true }).last().waitFor({ state: "visible" });
    await clickVisibleByText(page, "Start Your Free Trial");
    await page.waitForURL(/#\/signup$/);
    await page.getByRole("heading", { level: 1, name: /create your ai phone assistant/i }).waitFor({ state: "visible" });

    await clickVisibleByText(page, "Electrician");
    await clickVisibleByText(page, "Continue to property types");
    await clickVisibleByText(page, "Residential");
    await clickVisibleByText(page, "Continue to service areas");
    await page.getByText("Where do you work?", { exact: true }).first().waitFor({ state: "visible" });

    return { engine: "chromium", route: "signup-journey", viewport: "mobile", accessibilityWarnings: [] };
  } finally {
    await context.close();
  }
}

async function main() {
  assertBuildExists();
  if (process.platform === "win32" && process.env.CI !== "true" && process.env.RUN_LOCAL_PLAYWRIGHT !== "1") {
    console.log("Browser quality checks are deferred to Linux CI on Windows. Set RUN_LOCAL_PLAYWRIGHT=1 to force the local Playwright launcher.");
    return;
  }
  const invalidEngines = requestedEngines.filter((name) => !browserTypes[name]);
  if (invalidEngines.length) throw new Error(`Unsupported browser engines: ${invalidEngines.join(", ")}`);

  const { server, baseUrl } = await createStaticServer();
  const results = [];
  try {
    for (const engineName of requestedEngines) {
      const channel = engineName === "chromium" ? String(process.env.PLAYWRIGHT_CHANNEL || "").trim() : "";
      const browser = await browserTypes[engineName].launch({ headless: true, ...(channel ? { channel } : {}) });
      try {
        for (const route of routes) {
          for (const viewport of viewports) {
            console.log(`[browser-quality] ${engineName}/${route.name}/${viewport.name}`);
            results.push(await withTimeout(
              auditPage({ browser, baseUrl, engineName, route, viewport }),
              60_000,
              `${engineName}/${route.name}/${viewport.name}`,
            ));
          }
        }
        if (engineName === "chromium") {
          console.log("[browser-quality] chromium/signup-journey/mobile");
          results.push(await withTimeout(testSignupJourney(browser, baseUrl), 60_000, "chromium/signup-journey/mobile"));
        }
      } finally {
        await withTimeout(browser.close(), 15_000, `${engineName} browser shutdown`).catch((error) => {
          console.warn(`[browser-quality] ${error.message}`);
        });
      }
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  const warnings = results.flatMap((result) => result.accessibilityWarnings.map((warning) => ({ ...result, warning })));
  console.log(`Browser quality checks passed: ${results.length} page/journey checks across ${requestedEngines.join(", ")}.`);
  if (warnings.length) {
    console.warn(`Non-blocking accessibility findings: ${warnings.length}`);
    for (const item of warnings.slice(0, 12)) console.warn(`- ${item.engine}/${item.route}/${item.viewport}: ${item.warning}`);
  }
}

main().catch((error) => {
  console.error(`Browser quality checks failed: ${error.message || error}`);
  process.exitCode = 1;
});
