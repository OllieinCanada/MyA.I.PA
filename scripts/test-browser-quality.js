const fs = require("fs");
const { spawn } = require("child_process");
const net = require("net");
const path = require("path");
const { chromium, firefox, webkit } = require("playwright");
const { rootPath } = require("./_helpers");
const reportPath = rootPath("diagnostics", "shipping-readiness", "browser-quality-gate.json");

const defaultBuildDir = rootPath("build");
const pagesBuildDir = rootPath("docs");
const buildDir = fs.existsSync(path.join(defaultBuildDir, "index.html"))
  ? defaultBuildDir
  : pagesBuildDir;
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
const routeCatalog = [
  { name: "home", hash: "#/", h1: /never miss a call again/i, offer: true },
  { name: "signup", hash: "#/signup", h1: /create your ai phone assistant/i, offer: true },
  { name: "trades", hash: "#/trades", h1: /never send another good customer to voicemail/i, offer: true },
  { name: "electricians", hash: "#/trades/electricians", h1: /stop losing jobs/i, offer: true, trade: true },
  { name: "plumbers", hash: "#/trades/plumbers", h1: /stop losing jobs/i, offer: true, trade: true },
  { name: "hvac", hash: "#/trades/hvac", h1: /stop losing jobs/i, offer: true, trade: true },
  { name: "general-contractors", hash: "#/trades/general-contractors", h1: /stop losing jobs/i, offer: true, trade: true },
  { name: "roofers", hash: "#/trades/roofers", h1: /stop losing jobs/i, offer: true, trade: true },
  { name: "painters", hash: "#/trades/painters", h1: /stop losing jobs/i, offer: true, trade: true },
];
const requestedRoutes = String(process.env.BROWSER_ROUTES || routeCatalog.map((route) => route.name).join(","))
  .split(",")
  .map((name) => name.trim().toLowerCase())
  .filter(Boolean);
const routes = routeCatalog.filter((route) => requestedRoutes.includes(route.name));
const knownInternalRoutes = new Set(["", "signup", "trades", "links", "try-demo", "privacy", "terms", "dashboard", "forwarding-setup"]);
let runReport = {
  schemaVersion: 2,
  checkedAt: new Date().toISOString(),
  ready: false,
  requestedEngines,
  requestedRoutes,
  checks: [],
  failure: "",
};

function writeReport() {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(runReport, null, 2)}\n`, "utf8");
}
function assertBuildExists() {
  if (!fs.existsSync(path.join(buildDir, "index.html"))) {
    throw new Error("Missing build/index.html and docs/index.html. Build the app before running browser quality checks.");
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
    env: { ...process.env, HOST: "127.0.0.1", BUILD_PREVIEW_DIR: buildDir },
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

function normalizeHashRoute(href = "") {
  if (!String(href).startsWith("#/")) return "";
  return String(href).slice(2).split(/[?#]/)[0].replace(/^\/+|\/+$/g, "").toLowerCase();
}

function internalRouteIsKnown(route) {
  return knownInternalRoutes.has(route)
    || route.startsWith("trades/")
    || route.startsWith("demo/");
}

async function auditAssetsAndControls(page, route) {
  const audit = await page.evaluate(() => {
    const isVisible = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    return {
      links: Array.from(document.querySelectorAll("a[href]")).map((element) => ({
        href: element.getAttribute("href") || "",
        label: (element.getAttribute("aria-label") || element.textContent || "").replace(/\s+/g, " ").trim(),
      })),
      unnamedVisibleButtons: Array.from(document.querySelectorAll("button"))
        .filter(isVisible)
        .filter((element) => !(element.getAttribute("aria-label") || element.textContent || "").trim()).length,
      images: Array.from(document.images).map((image) => ({
        alt: image.getAttribute("alt"),
        ariaHidden: image.getAttribute("aria-hidden") === "true",
        loading: image.loading || "auto",
      })),
      emptyVisibleSvgs: Array.from(document.querySelectorAll("svg"))
        .filter(isVisible)
        .filter((svg) => !svg.querySelector("path, circle, rect, line, polyline, polygon, ellipse, use")).length,
      text: document.body.innerText.replace(/\s+/g, " ").trim(),
    };
  });

  const brokenInternalLinks = audit.links
    .map((link) => ({ ...link, route: normalizeHashRoute(link.href) }))
    .filter((link) => link.href.startsWith("#/") && !internalRouteIsKnown(link.route));
  if (brokenInternalLinks.length) {
    throw new Error(`${route.name} contains unknown internal routes: ${brokenInternalLinks.map((link) => link.href).join(", ")}`);
  }
  const unnamedLinks = audit.links.filter((link) => !link.label && !link.href.startsWith("mailto:") && !link.href.startsWith("tel:"));
  if (unnamedLinks.length) throw new Error(`${route.name} contains ${unnamedLinks.length} unnamed link(s)`);
  if (audit.unnamedVisibleButtons) throw new Error(`${route.name} contains ${audit.unnamedVisibleButtons} unnamed visible button(s)`);
  if (audit.emptyVisibleSvgs) throw new Error(`${route.name} contains ${audit.emptyVisibleSvgs} empty visible symbol(s)`);
  const imagesWithoutAlternatives = audit.images.filter((image) => image.alt === null && !image.ariaHidden);
  if (imagesWithoutAlternatives.length) throw new Error(`${route.name} contains ${imagesWithoutAlternatives.length} image(s) without alt text`);

  if (route.offer && !/(?:14[- ]day free trial|free for 14 days)/i.test(audit.text)) {
    throw new Error(`${route.name} does not state the 14-day free trial`);
  }
  if (route.trade) {
    const signupLinks = audit.links.filter((link) => link.href === "#/signup");
    const demoLinks = audit.links.filter((link) => link.href === "tel:+12495033301");
    if (!signupLinks.length || !demoLinks.length) throw new Error(`${route.name} is missing its signup or demo CTA`);
    if (!/no credit card required/i.test(audit.text)) throw new Error(`${route.name} does not state that the trial needs no credit card`);
  }

  const images = await page.locator("img").all();
  for (const image of images) {
    await image.scrollIntoViewIfNeeded().catch(() => {});
    await image.evaluate((element) => {
      if (element.complete) return;
      return new Promise((resolve) => {
        const finish = () => resolve();
        element.addEventListener("load", finish, { once: true });
        element.addEventListener("error", finish, { once: true });
        setTimeout(finish, 5000);
      });
    });
  }
  const failedImages = await page.locator("img").evaluateAll((elements) => elements
    .filter((image) => image.complete && image.naturalWidth === 0)
    .map((image) => image.currentSrc || image.src));
  if (failedImages.length) throw new Error(`${route.name} has broken images: ${failedImages.join(", ")}`);
  return { linkCount: audit.links.length, imageCount: audit.images.length };
}

async function auditPage({ browser, baseUrl, engineName, route, viewport }) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
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
    try {
      await page.locator("h1").first().waitFor({ state: "visible" });
    } catch (error) {
      const diagnostics = await page.evaluate(() => {
        const heading = document.querySelector("h1");
        const headingStyle = heading ? window.getComputedStyle(heading) : null;
        return {
          readyState: document.readyState,
          rootChildCount: document.getElementById("root")?.childElementCount || 0,
          rootTextLength: document.getElementById("root")?.textContent?.length || 0,
          h1Count: document.querySelectorAll("h1").length,
          headingDisplay: headingStyle?.display || "",
          headingVisibility: headingStyle?.visibility || "",
          headingOpacity: headingStyle?.opacity || "",
          scripts: Array.from(document.scripts).map((script) => script.src || "inline"),
        };
      }).catch((diagnosticError) => ({ diagnosticError: diagnosticError.message }));
      throw new Error(`${error.message}; diagnostics=${JSON.stringify(diagnostics)}; runtimeErrors=${JSON.stringify(runtimeErrors.slice(0, 5))}`);
    }
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

    const surface = await auditAssetsAndControls(page, route);
    console.log(`[browser-quality] assets ${engineName}/${route.name}/${viewport.name}`);

    await page.keyboard.press("Tab");
    const focus = await page.evaluate(() => ({
      tag: document.activeElement?.tagName || "",
      tabIndex: document.activeElement?.tabIndex,
      outlineStyle: document.activeElement ? window.getComputedStyle(document.activeElement).outlineStyle : "",
      outlineWidth: document.activeElement ? window.getComputedStyle(document.activeElement).outlineWidth : "",
      boxShadow: document.activeElement ? window.getComputedStyle(document.activeElement).boxShadow : "",
    }));
    if (["", "BODY", "HTML"].includes(focus.tag) || focus.tabIndex === -1) {
      throw new Error(`${route.name} does not expose a keyboard-reachable first control`);
    }
    if ((focus.outlineStyle === "none" || focus.outlineWidth === "0px") && (!focus.boxShadow || focus.boxShadow === "none")) {
      throw new Error(`${route.name} does not visibly identify the keyboard-focused control`);
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
      linkCount: surface.linkCount,
      imageCount: surface.imageCount,
      accessibilityWarnings: warnings.map(describeViolation),
    };
  } finally {
    await context.close();
  }
}

async function testSignupJourney(browser, baseUrl) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
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

async function testTradeImageFailureFallback(browser, baseUrl) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route("**/trade-heroes/**", (route) => route.abort());
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  try {
    await page.goto(`${baseUrl}#/trades/painters`, { waitUntil: "domcontentloaded" });
    const fallback = page.locator(".contractor-photo-fallback").first();
    await fallback.waitFor({ state: "visible" });
    if (!/temporarily unavailable/i.test(await fallback.innerText())) {
      throw new Error("trade image failure did not produce the expected readable fallback");
    }
    return { engine: "chromium", route: "trade-image-fallback", viewport: "mobile", accessibilityWarnings: [] };
  } finally {
    await context.close();
  }
}

async function testSlowTradeImageLayout(browser, baseUrl) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route("**/trade-heroes/**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await route.continue();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  try {
    await page.goto(`${baseUrl}#/trades/roofers`, { waitUntil: "domcontentloaded" });
    await page.locator("h1").waitFor({ state: "visible" });
    const layout = await page.evaluate(() => {
      const hero = document.querySelector(".contractor-hero");
      return {
        heroHeight: hero?.getBoundingClientRect().height || 0,
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      };
    });
    if (layout.heroHeight < 700) throw new Error(`slow image collapsed the hero to ${layout.heroHeight}px`);
    if (layout.scrollWidth > layout.clientWidth + 2) throw new Error("slow image caused horizontal overflow");
    await page.locator(".contractor-hero-image").waitFor({ state: "visible" });
    return { engine: "chromium", route: "trade-slow-image-layout", viewport: "mobile", accessibilityWarnings: [] };
  } finally {
    await context.close();
  }
}

async function testLargeTextReflow(browser, baseUrl) {
  const context = await browser.newContext({ viewport: { width: 320, height: 800 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  try {
    await page.goto(`${baseUrl}#/trades/painters`, { waitUntil: "domcontentloaded" });
    await page.locator("h1").waitFor({ state: "visible" });
    const layout = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      signupVisible: Array.from(document.querySelectorAll('a[href="#/signup"]')).some((element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      }),
    }));
    if (layout.scrollWidth > layout.clientWidth + 2) {
      throw new Error(`320px reflow overflows horizontally by ${layout.scrollWidth - layout.clientWidth}px`);
    }
    if (!layout.signupVisible) throw new Error("primary signup action is not visible in narrow/large-text reflow mode");
    return { engine: "chromium", route: "large-text-reflow", viewport: "320px", accessibilityWarnings: [] };
  } finally {
    await context.close();
  }
}

async function main() {
  assertBuildExists();
  if (process.platform === "win32" && process.env.CI !== "true" && process.env.RUN_LOCAL_PLAYWRIGHT !== "1") {
    runReport = {
      ...runReport,
      checkedAt: new Date().toISOString(),
      ready: false,
      deferred: true,
      failure: "Browser quality checks require Linux CI or an explicitly forced local Playwright run on Windows.",
    };
    writeReport();
    console.error("Browser quality checks are not green: run them in Linux CI or set RUN_LOCAL_PLAYWRIGHT=1 to force the local Playwright launcher.");
    process.exitCode = 1;
    return;
  }
  const invalidEngines = requestedEngines.filter((name) => !browserTypes[name]);
  if (invalidEngines.length) throw new Error(`Unsupported browser engines: ${invalidEngines.join(", ")}`);
  const invalidRoutes = requestedRoutes.filter((name) => !routeCatalog.some((route) => route.name === name));
  if (invalidRoutes.length) throw new Error(`Unsupported browser routes: ${invalidRoutes.join(", ")}`);

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
              120_000,
              `${engineName}/${route.name}/${viewport.name}`,
            ));
          }
        }
        if (engineName === "chromium") {
          console.log("[browser-quality] chromium/signup-journey/mobile");
          results.push(await withTimeout(testSignupJourney(browser, baseUrl), 120_000, "chromium/signup-journey/mobile"));
          console.log("[browser-quality] chromium/trade-image-fallback/mobile");
          results.push(await withTimeout(testTradeImageFailureFallback(browser, baseUrl), 60_000, "chromium/trade-image-fallback/mobile"));
          console.log("[browser-quality] chromium/trade-slow-image-layout/mobile");
          results.push(await withTimeout(testSlowTradeImageLayout(browser, baseUrl), 60_000, "chromium/trade-slow-image-layout/mobile"));
          console.log("[browser-quality] chromium/large-text-reflow/320px");
          results.push(await withTimeout(testLargeTextReflow(browser, baseUrl), 60_000, "chromium/large-text-reflow/320px"));
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
  runReport = {
    ...runReport,
    checkedAt: new Date().toISOString(),
    ready: true,
    completedChecks: results.length,
    checks: results,
    warningCount: warnings.length,
  };
  writeReport();
}

main().catch((error) => {
  runReport = { ...runReport, checkedAt: new Date().toISOString(), ready: false, failure: String(error?.message || error) };
  writeReport();
  console.error(`Browser quality checks failed: ${error.message || error}`);
  process.exitCode = 1;
});
