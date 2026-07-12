const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { nodeCommand, rootPath, run } = require("./_helpers");

const screenshotName = "telegram-admin-customers-tab.png";
const screenshotPath = rootPath("diagnostics", "browser-drive", screenshotName);
const phoneSharePath = rootPath("phone-share", screenshotName);
const url = process.env.TELEGRAM_ADMIN_MOCK_URL || "http://localhost:3000/#/admin";

const owner = {
  businessId: 1,
  businessName: "Smith Heating & Cooling",
  businessPhone: "+12495033301",
  ownerName: "John Smith",
  ownerEmail: "john@smithheating.example",
  ownerPhone: "905-555-1234",
  aiNumbers: ["+12495033301"],
  vapiMappings: [{ id: 1, matchType: "phoneNumber", matchValue: "+12495033301", label: "Main AI number" }],
  needsSetup: false,
  stats: {
    recentCallWindow: 12,
    syncedCalls: 12,
    missedCalls: 1,
    followUps: 4,
    lastCallAt: new Date().toISOString(),
    lastSyncedAt: new Date().toISOString(),
  },
  recentCalls: [
    {
      id: "call_1",
      startedAt: new Date().toISOString(),
      status: "COMPLETED",
      outcome: "FOLLOW_UP",
      durationSec: 137,
      caller: { phone: "905-555-1234" },
      totalInternalCost: 0.2145,
    },
  ],
};

const calls = owner.recentCalls.map((call) => ({ ...call, businessId: 1, business: { name: owner.businessName } }));

const responses = {
  "/api/admin/session": { ok: true },
  "/api/admin/ops-overview": {
    owners: [owner],
    sync: {
      mappedBusinessCount: 1,
      businessesWithSyncedCalls: 1,
      syncStoreCount: 12,
      lastSyncedAt: new Date().toISOString(),
      warnings: [],
      env: {
        databaseAvailable: true,
        adminPasswordLooksDefault: false,
        stripeConfigured: true,
        vapiApiKeyConfigured: true,
        twilioConfigured: true,
        vapiAutoSyncEnabled: true,
      },
    },
  },
  "/api/admin/customer-setup": {
    summary: { total: 1, ready: 1, blocked: 0, manual: 0, waiting: 0 },
    warnings: [],
    customers: [
      {
        id: "setup_1",
        businessId: 1,
        businessName: owner.businessName,
        businessPhone: owner.businessPhone,
        ownerName: owner.ownerName,
        ownerEmail: owner.ownerEmail,
        ownerPhone: owner.ownerPhone,
        overallStatus: "ready",
        readinessPercent: 100,
        nextAction: "Customer is ready for live call handling.",
        callCount: 12,
        lastCallAt: new Date().toISOString(),
        signedUpAt: new Date(Date.now() - 7 * 86400000).toISOString(),
        steps: [
          { key: "name", label: "Name collected", status: "done", reason: "Owner profile is saved." },
          { key: "phone", label: "Phone collected", status: "done", reason: "Owner alert phone is saved." },
          { key: "number", label: "AI number assigned", status: "done", reason: "+12495033301 is mapped." },
          { key: "calls", label: "Past calls synced", status: "done", reason: "Vapi calls are attached to this customer." },
        ],
      },
    ],
  },
  "/api/admin/trial-health": {
    accounts: [
      {
        businessName: owner.businessName,
        ownerName: owner.ownerName,
        ownerEmail: owner.ownerEmail,
        ownerPhone: owner.ownerPhone,
        readinessPercent: 100,
        callCount: 12,
        signedUpAt: new Date(Date.now() - 7 * 86400000).toISOString(),
        expiry: { label: "7d left", color: "green" },
        readinessChecklist: [],
      },
    ],
  },
  "/api/admin/signups": {
    signups: [
      {
        businessName: owner.businessName,
        businessPhone: owner.businessPhone,
        ownerName: owner.ownerName,
        ownerEmail: owner.ownerEmail,
        ownerPhone: owner.ownerPhone,
        subscriptionStatus: "trialing",
        signedUpAt: new Date(Date.now() - 7 * 86400000).toISOString(),
        expiry: { label: "7d left", color: "green", daysRemaining: 7 },
      },
    ],
  },
  "/api/admin/leads": {
    leads: [
      {
        id: "lead_1",
        businessId: 1,
        createdAt: new Date().toISOString(),
        name: "John Smith",
        intent: "QUOTE",
        urgency: "MEDIUM",
        status: "NEW",
        callbackNumber: "905-555-1234",
        summary: "Furnace repair tomorrow morning.",
      },
    ],
  },
  "/api/admin/calls": { calls },
  "/api/admin/calls/analytics": { analytics: [{ businessId: 1, businessName: owner.businessName, totalCalls: 12 }] },
  "/api/admin/cost-audit": {
    audit: {
      totals: { totalCalls: 12, pricedCalls: 12, totalInternalCost: 3.2461, estimatedProviderCost: 3.2461 },
      summary: [
        {
          businessId: 1,
          businessName: owner.businessName,
          phoneNumber: "+12495033301",
          totalCalls: 12,
          pricedCalls: 12,
          vapiCost: 2.11,
          twilioCost: 1.1361,
          totalInternalCost: 3.2461,
          averageCost: 0.2705,
          currency: "USD",
          lastCallAt: new Date().toISOString(),
        },
      ],
      calls,
      warnings: [],
    },
  },
  "/api/admin/vapi/mappings": { mappings: owner.vapiMappings.map((mapping) => ({ ...mapping, businessId: 1, business: { name: owner.businessName } })), businesses: [{ id: 1, name: owner.businessName }] },
};

function responseFor(requestUrl) {
  const parsed = new URL(requestUrl);
  const key = Object.keys(responses).find((pathKey) => parsed.pathname === pathKey);
  return key ? responses[key] : { ok: true };
}

async function main() {
  fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
  fs.mkdirSync(path.dirname(phoneSharePath), { recursive: true });

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (_error) {
    browser = await chromium.launch({ headless: true, channel: "chrome" });
  }

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.route("**/api/admin/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(responseFor(route.request().url())),
      });
    });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.locator("button").filter({ hasText: "Customers" }).first().click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: screenshotPath, fullPage: false });
  } finally {
    await browser?.close();
  }

  fs.copyFileSync(screenshotPath, phoneSharePath);
  run(nodeCommand(), [
    path.join("scripts", "telegram-send-photo.js"),
    `--photo=${screenshotPath}`,
    "--caption=MyAIPA admin Customers tab screenshot",
  ]);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
