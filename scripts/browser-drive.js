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

function mockAdminResponse(url) {
  const pathname = new URL(url).pathname;
  const now = new Date().toISOString();
  const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60000).toISOString();
  const customer = {
    businessId: 1,
    businessName: "Oliver's Roofing",
    businessPhone: "+19057885488",
    ownerName: "Oliver Slapinski",
    ownerEmail: "owner@example.com",
    ownerPhone: "+19057885488",
    twilioPhoneNumber: "+12495033301",
    signedUpAt: now,
    subscriptionStatus: "active",
    status: "subscription_active",
    makeStatus: 200,
  };
  const trial = {
    businessId: 2,
    businessName: "Tim's Electrical",
    ownerName: "Tim Owner",
    ownerEmail: "tim@example.com",
    ownerPhone: "+19055550123",
    twilioPhoneNumber: "+12895550111",
    subscriptionStatus: "trialing",
    status: "subscription_trialing",
    expiry: { label: "9d left", color: "green", daysRemaining: 9 },
  };

  const mockCalls = [
    {
      id: "call_001",
      startedAt: minutesAgo(28),
      businessId: 1,
      business: { name: "Oliver's Roofing" },
      status: "COMPLETED",
      outcome: "UNREVIEWED",
      qualityScore: 35,
      durationSec: 5,
      caller: { phone: "+19057885488" },
      followUpNeeded: true,
      aiSummary: "Caller asked about a roof leak and wants a callback today.",
      transcript: "[0:00] Assistant: Thanks for calling Oliver's Roofing. How can I help?\n[0:03] Customer: I have a roof leak and need someone to call me back today.",
      transcriptAvailable: true,
      recordingUrl: "https://example.com/mock-recording.mp3",
      recordingAvailable: true,
      externalProvider: "vapi",
      externalId: "vapi_call_001",
      twilioCallSid: "CA_roofing_001",
      twilioPrice: 0.18,
      vapiCost: 0.22,
      totalInternalCost: 0.4,
      tasks: [{ id: "task_001", status: "OPEN" }],
    },
    {
      id: "call_002",
      startedAt: minutesAgo(210),
      businessId: 1,
      business: { name: "Oliver's Roofing" },
      status: "COMPLETED",
      outcome: "BOOKED",
      qualityScore: 90,
      durationSec: 90,
      caller: { phone: "+19057885488" },
      followUpNeeded: false,
      aiSummary: "Booked a roof inspection and collected the address.",
      transcriptAvailable: false,
      recordingAvailable: false,
      externalProvider: "vapi",
      externalId: "vapi_call_002",
      twilioCallSid: "CA_roofing_002",
      twilioPrice: 0.32,
      vapiCost: 0.44,
      totalInternalCost: 0.76,
      tasks: [],
    },
    {
      id: "call_003",
      startedAt: minutesAgo(255),
      businessId: 2,
      business: { name: "Tim's Electrical" },
      status: "COMPLETED",
      outcome: "QUOTE_NEEDED",
      qualityScore: 75,
      durationSec: 222,
      caller: { phone: "+19055550123" },
      followUpNeeded: true,
      aiSummary: "Hot tub wiring quote request with preferred evening callback.",
      transcriptAvailable: false,
      recordingAvailable: false,
      externalProvider: "vapi",
      externalId: "vapi_call_003",
      twilioCallSid: "CA_electrical_001",
      twilioPrice: 0.55,
      vapiCost: 0.71,
      totalInternalCost: 1.26,
      tasks: [],
    },
    {
      id: "call_004",
      startedAt: minutesAgo(320),
      businessId: 1,
      business: { name: "Oliver's Roofing" },
      status: "MISSED",
      outcome: "FOLLOW_UP",
      qualityScore: 58,
      durationSec: 41,
      caller: { phone: "+19055550199" },
      followUpNeeded: true,
      aiSummary: "Caller hung up after asking for emergency leak repair.",
      transcriptAvailable: false,
      recordingAvailable: false,
      externalProvider: "vapi",
      externalId: "vapi_call_004",
      twilioCallSid: "CA_roofing_003",
      twilioPrice: 0.12,
      vapiCost: 0.2,
      totalInternalCost: 0.32,
      tasks: [],
    },
  ];

  if (pathname.endsWith("/session") || pathname.endsWith("/login")) return { ok: true };
  if (pathname.endsWith("/ops-overview")) {
    return {
      owners: [
        { ...customer, aiNumbers: [customer.twilioPhoneNumber], stats: { syncedCalls: 31, recentCallWindow: 31, lastCallAt: now } },
        { ...trial, aiNumbers: [trial.twilioPhoneNumber], stats: { syncedCalls: 8, recentCallWindow: 8, lastCallAt: now } },
      ],
      sync: {
        mappedBusinessCount: 2,
        syncStoreCount: 39,
        businessesWithSyncedCalls: 2,
        lastSyncedAt: now,
        warnings: [],
        env: {
          databaseAvailable: true,
          stripeConfigured: true,
          vapiApiKeyConfigured: true,
          twilioConfigured: true,
          vapiAutoSyncEnabled: true,
          vapiAutoSyncIntervalMs: 900000,
          vapiDefaultBusinessId: "1",
          vapiBusinessMapEntries: 2,
          exposeCallTranscriptsInAdmin: false,
          exposeRecordingUrlsInAdmin: false,
          adminPasswordLooksDefault: false,
        },
      },
    };
  }
  if (pathname.endsWith("/customer-setup")) {
    return {
      customers: [
        { ...customer, overallStatus: "ready", readinessPercent: 100, callCount: 31, steps: [], aiNumbers: [customer.twilioPhoneNumber] },
        { ...trial, overallStatus: "manual", readinessPercent: 72, callCount: 8, nextAction: "Confirm Stripe trial conversion.", steps: [], aiNumbers: [trial.twilioPhoneNumber] },
      ],
      summary: { total: 2, ready: 1, blocked: 0, manual: 1, waiting: 0 },
      warnings: [],
    };
  }
  if (pathname.endsWith("/trial-health")) return { accounts: [trial] };
  if (pathname.endsWith("/stripe-trials")) {
    const trialEnd = new Date(Date.now() + 9 * 86400000).toISOString();
    return {
      configured: true,
      fetchedAt: now,
      mode: "live",
      account: { id: "acct_mock", country: "CA", chargesEnabled: true, payoutsEnabled: false },
      totals: {
        subscriptionsAllStatuses: 2,
        statusCounts: { trialing: 1, active: 1 },
        activeTrialCount: 1,
        trialRelatedCount: 1,
        endingSoonWithin3DaysCount: 0,
        recentlyEndedTrialCountLast30Days: 0,
      },
      activeTrials: [
        {
          subscriptionId: "sub_mock_trial_001",
          customerId: "cus_mock_001",
          customerEmail: trial.ownerEmail,
          customerName: trial.ownerName,
          businessName: trial.businessName,
          status: "trialing",
          trialStartAt: now,
          trialEndAt: trialEnd,
          currentPeriodEndAt: trialEnd,
          cancelAtPeriodEnd: false,
          createdAt: now,
          priceId: "price_mock_79cad",
          priceAmount: 7900,
          priceCurrency: "CAD",
          priceInterval: "month",
          dashboardUrl: "https://dashboard.stripe.com/subscriptions/sub_mock_trial_001",
          expiry: { label: "Before halfway", color: "green", daysRemaining: 9, percentUsed: 35 },
        },
      ],
      recentlyEndedTrialsLast30Days: [],
      warnings: ["Stripe payouts are not enabled yet."],
    };
  }
  if (pathname.endsWith("/signups")) return { signups: [customer, trial] };
  if (/\/api\/admin\/calls\/[^/]+$/.test(pathname)) {
    const id = pathname.split("/").pop();
    return { call: mockCalls.find((call) => String(call.id) === String(id)) || mockCalls[0] };
  }
  if (pathname.endsWith("/calls")) return { calls: mockCalls };
  if (pathname.endsWith("/leads")) return { leads: [] };
  if (pathname.endsWith("/analytics")) return { analytics: [] };
  if (pathname.endsWith("/vapi/inventory")) {
    return { inventory: {
      phoneNumbers: [
        { id: "pn_roofing", number: customer.twilioPhoneNumber, assistantName: "My AI PA Agent", mappedBusiness: customer.businessName },
        { id: "pn_electrical", number: trial.twilioPhoneNumber, assistantName: "My AI PA Agent", mappedBusiness: trial.businessName },
      ],
      assistants: [
        { id: "asst_main", name: "My AI PA Agent", phoneNumbers: [customer.twilioPhoneNumber, trial.twilioPhoneNumber] },
      ],
      warnings: [],
      totals: { phoneNumbers: 2, assistants: 1, mappedPhoneNumbers: 2, mappedAssistants: 1 },
      fetchedAt: now,
    } };
  }
  if (pathname.endsWith("/vapi/mappings")) return { mappings: [], businesses: [] };
  if (pathname.endsWith("/daily-digest")) return { digest: null };
  if (pathname.endsWith("/faqs")) return { faqs: [] };
  if (pathname.endsWith("/settings")) return { settings: { ownerPhone: "+19057885488" } };
  if (pathname.endsWith("/cost-audit") || pathname.endsWith("/cost-sync")) {
    return { audit: {
      days: 30,
      totals: {
        totalCalls: 39,
        pricedCalls: 39,
        twilioCallCost: 4.35,
        twilioUsageCost: 76.46,
        twilioCost: 76.46,
        vapiCost: 7.8,
        fixedCost: 0,
        callUsageCost: 12.15,
        totalInternalCost: 84.26,
        estimatedProviderCost: 84.26,
      },
      summary: [
        { businessId: 1, businessName: customer.businessName, phoneNumber: customer.twilioPhoneNumber, totalCalls: 31, pricedCalls: 31, vapiCost: 6.2, twilioCost: 3.25, totalInternalCost: 9.45, averageCost: 0.3048, currency: "USD", lastCallAt: now },
        { businessId: 2, businessName: trial.businessName, phoneNumber: trial.twilioPhoneNumber, totalCalls: 8, pricedCalls: 8, vapiCost: 1.6, twilioCost: 1.1, totalInternalCost: 2.7, averageCost: 0.3375, currency: "USD", lastCallAt: now },
      ],
      calls: [],
      twilioAccountUsage: {
        available: true,
        totalCost: 76.46,
        records: [
          { category: "totalprice", description: "Total Price", usage: 76.46, usageUnit: "usd", count: 0, countUnit: "", price: 76.46, priceUnit: "USD", isAccountTotal: true, includedInTotal: true },
        ],
      },
      fixedCosts: { totalCost: 0, records: [] },
      env: { databaseAvailable: true, twilioConfigured: true, vapiConfigured: true },
      warnings: [],
    } };
  }
  return {};
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
  const mockAdmin = process.argv.includes("--mock-admin");
  const clicks = getArgs("click");
  const fills = getArgs("type");
  const fillEnvs = getArgs("type-env");
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
  const context = await browser.newContext({ viewport, serviceWorkers: "block" });
  const page = await context.newPage();

  page.on("console", (message) => {
    if (message.type() === "error") console.log(`browser console error: ${message.text()}`);
  });

  page.on("requestfailed", (request) => {
    if (!request.url().includes("/api/admin/")) return;
    const { pathname } = new URL(request.url());
    console.log(`admin request failed: ${request.method()} ${pathname} ${request.failure()?.errorText || ""}`);
  });

  if (mockAdmin) {
    await page.route("**/api/admin/**", async (route) => {
      const request = route.request();
      const origin = request.headers().origin || "http://127.0.0.1:3101";
      const headers = {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Headers": "Content-Type, X-Admin-Password",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        Vary: "Origin",
      };
      if (request.method() === "OPTIONS") {
        await route.fulfill({ status: 204, headers });
        return;
      }
      const body = mockAdminResponse(request.url());
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers,
        body: JSON.stringify(body),
      });
    });
  }

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

  async function typeEnvInto(fill) {
    const splitAt = fill.indexOf("=");
    if (splitAt < 1) throw new Error(`Bad type-env command: ${fill}. Use --type-env=\"selector=ENV_NAME\"`);
    const target = fill.slice(0, splitAt);
    const envName = fill.slice(splitAt + 1);
    const value = process.env[envName] || "";
    if (!value) throw new Error(`Environment variable ${envName} is empty.`);
    console.log(`Typing environment value into ${target}`);
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
      else if (kind === "type-env") await typeEnvInto(value);
      else if (kind === "wait-for") await waitForTarget(value);
      else throw new Error(`Unknown action type: ${kind}`);
    }
  } else {
    for (const target of waitForTargets) await waitForTarget(target);
    for (const fill of fills) await typeInto(fill);
    for (const fill of fillEnvs) await typeEnvInto(fill);
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
