const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const test = require("node:test");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const publicDir = path.join(root, "public");

function startStaticServer() {
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname);
    const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const filePath = path.resolve(publicDir, relative);
    if (!filePath.startsWith(publicDir) || !fs.existsSync(filePath)) {
      res.writeHead(404).end("Not found");
      return;
    }
    const extension = path.extname(filePath);
    const contentType = extension === ".css" ? "text/css; charset=utf-8" : "text/html; charset=utf-8";
    res.writeHead(200, { "content-type": contentType });
    fs.createReadStream(filePath).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function launchBrowser() {
  const options = { headless: true, args: ["--disable-gpu", "--disable-dev-shm-usage"] };
  try {
    return await chromium.launch(options);
  } catch (originalError) {
    for (const channel of ["chrome", "msedge"]) {
      try {
        return await chromium.launch({ ...options, channel });
      } catch (_channelError) {
        // Try the next browser channel available on the host.
      }
    }
    throw originalError;
  }
}

function registerBrowserCleanup(t, server, getBrowser) {
  t.after(async () => {
    await getBrowser()?.close().catch(() => {});
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  });
}

test("the status page renders real health results and refreshes them", { timeout: 30000 }, async (t) => {
  const server = await startStaticServer();
  let browser;
  registerBrowserCleanup(t, server, () => browser);
  browser = await launchBrowser();

  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  let healthCalls = 0;
  let readinessCalls = 0;
  await page.route("http://127.0.0.1:8787/api/health", async (route) => {
    healthCalls += 1;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, service: "my-ai-pa-api" }) });
  });
  await page.route("http://127.0.0.1:8787/api/health/ready", async (route) => {
    readinessCalls += 1;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, dependencies: { database: "reachable" } }) });
  });

  const address = server.address();
  await page.goto(`http://127.0.0.1:${address.port}/status.html`);
  await page.getByText("All checked systems are operational.").waitFor();
  assert.equal(await page.locator("#api-status").textContent(), "Operational");
  assert.equal(await page.locator("#database-status").textContent(), "Operational");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0);

  await page.getByRole("button", { name: "Check again" }).click();
  await page.getByText("All checked systems are operational.").waitFor();
  assert.equal(healthCalls, 2);
  assert.equal(readinessCalls, 2);
});

test("the storage notice fits a phone viewport and names every current category", { timeout: 30000 }, async (t) => {
  const server = await startStaticServer();
  let browser;
  registerBrowserCleanup(t, server, () => browser);
  browser = await launchBrowser();

  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const address = server.address();
  await page.goto(`http://127.0.0.1:${address.port}/cookies.html`);
  const body = await page.locator("body").innerText();
  for (const category of ["Secure session cookies", "Session storage", "Local storage", "Service-worker cache"]) {
    assert.match(body, new RegExp(category, "i"));
  }
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0);
});
