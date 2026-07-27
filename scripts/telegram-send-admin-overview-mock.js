const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { nodeCommand, rootPath, run } = require("./_helpers");

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

const supportPreview = hasFlag("support");
const fullPagePreview = hasFlag("full-page");
const mobilePreview = hasFlag("mobile");
const screenshotName = supportPreview
  ? "telegram-admin-support-inbox.png"
  : mobilePreview
    ? "telegram-admin-overview-mobile.png"
    : "telegram-admin-overview-tab.png";
const screenshotPath = rootPath("diagnostics", "browser-drive", screenshotName);
const phoneSharePath = rootPath("phone-share", screenshotName);
const url = process.env.TELEGRAM_ADMIN_MOCK_URL || "http://localhost:3000/#/admin";
const now = new Date();

const owners = [
  {
    businessId: 1,
    businessName: "Smith Heating & Cooling",
    businessPhone: "+12495033301",
    ownerName: "John Smith",
    ownerEmail: "john@smithheating.example",
    ownerPhone: "905-555-1234",
    aiNumbers: ["+12495033301"],
    vapiMappings: [{ id: 1, matchType: "phoneNumber", matchValue: "+12495033301", label: "Main AI number" }],
    needsSetup: false,
    stats: { recentCallWindow: 12, syncedCalls: 12, missedCalls: 1, followUps: 4, lastCallAt: now.toISOString(), lastSyncedAt: now.toISOString() },
  },
  {
    businessId: 2,
    businessName: "Tim's Electrical",
    businessPhone: "905-555-0199",
    ownerName: "Tim Davis",
    ownerEmail: "tim@example.com",
    ownerPhone: "905-555-0199",
    aiNumbers: ["+12895550199"],
    vapiMappings: [{ id: 2, matchType: "assistantId", matchValue: "asst_tim", label: "Electrical agent" }],
    needsSetup: false,
    stats: { recentCallWindow: 4, syncedCalls: 4, missedCalls: 0, followUps: 1, lastCallAt: now.toISOString(), lastSyncedAt: now.toISOString() },
  },
  {
    businessId: 3,
    businessName: "Brown Plumbing",
    businessPhone: "416-555-8811",
    ownerName: "Mike Brown",
    ownerEmail: "mike@example.com",
    ownerPhone: "",
    aiNumbers: ["+14165558811"],
    vapiMappings: [{ id: 3, matchType: "phoneNumber", matchValue: "+14165558811", label: "Plumbing main line" }],
    needsSetup: true,
    stats: { recentCallWindow: 2, syncedCalls: 2, missedCalls: 1, followUps: 1, lastCallAt: now.toISOString(), lastSyncedAt: now.toISOString() },
  },
  {
    businessId: 4,
    businessName: "Clark HVAC",
    businessPhone: "647-555-7822",
    ownerName: "Sarah Clark",
    ownerEmail: "sarah@example.com",
    ownerPhone: "",
    aiNumbers: [],
    vapiMappings: [],
    needsSetup: true,
    stats: { recentCallWindow: 0, syncedCalls: 0, missedCalls: 0, followUps: 0 },
  },
];

const calls = [
  ["call_1", 1, "Smith Heating & Cooling", "905-555-1234", "ANSWERED", 0.2145],
  ["call_2", 2, "Tim's Electrical", "289-555-0199", "ANSWERED", 0.1751],
  ["call_3", 3, "Brown Plumbing", "416-555-8811", "MISSED", 0.1022],
  ["call_4", 1, "Smith Heating & Cooling", "905-555-1234", "ANSWERED", 0.1944],
].map(([id, businessId, name, phone, status, totalInternalCost], index) => ({
  id,
  businessId,
  business: { name },
  startedAt: new Date(Date.now() - index * 42 * 60000).toISOString(),
  status,
  outcome: status === "MISSED" ? "MISSED" : "FOLLOW_UP",
  durationSec: 90 + index * 17,
  caller: { phone },
  totalInternalCost,
}));

const setupCustomers = owners.map((owner) => ({
  id: `setup_${owner.businessId}`,
  businessId: owner.businessId,
  businessName: owner.businessName,
  businessPhone: owner.businessPhone,
  ownerName: owner.ownerName,
  ownerEmail: owner.ownerEmail,
  ownerPhone: owner.ownerPhone,
  overallStatus: owner.businessId === 4 ? "blocked" : owner.needsSetup ? "manual" : "ready",
  readinessPercent: owner.businessId === 4 ? 35 : owner.needsSetup ? 65 : 100,
  nextAction: owner.businessId === 4 ? "Connect an AI number before launch." : owner.needsSetup ? "Add owner phone for text summaries." : "Customer is ready.",
  blockerLabel: owner.businessId === 4 ? "No AI number connected" : "",
  callCount: owner.stats.syncedCalls || 0,
  lastCallAt: owner.stats.lastCallAt,
  signedUpAt: new Date(Date.now() - owner.businessId * 86400000).toISOString(),
  steps: [
    { key: "owner", label: "Owner saved", status: "done", reason: "Owner profile exists." },
    { key: "number", label: "AI number assigned", status: owner.aiNumbers.length ? "done" : "blocked", reason: owner.aiNumbers.length ? "Vapi number is connected." : "Connect a Vapi number." },
    { key: "texts", label: "Owner text ready", status: owner.ownerPhone ? "done" : "manual", reason: owner.ownerPhone ? "Owner phone saved." : "Add owner phone." },
  ],
}));

const vapiPhoneNumbers = [
  { id: "pn_smith", name: "Smith main", number: "+12495033301", provider: "twilio", status: "active", assistantId: "asst_smith", assistantName: "Smith HVAC Agent", mappedBusiness: { id: 1, name: "Smith Heating & Cooling" }, updatedAt: now.toISOString() },
  { id: "pn_tim", name: "Tim main", number: "+12895550199", provider: "twilio", status: "active", assistantId: "asst_tim", assistantName: "Electrical Agent", mappedBusiness: { id: 2, name: "Tim's Electrical" }, updatedAt: now.toISOString() },
  { id: "pn_brown", name: "Brown main", number: "+14165558811", provider: "twilio", status: "active", assistantId: "asst_brown", assistantName: "Plumbing Agent", mappedBusiness: { id: 3, name: "Brown Plumbing" }, updatedAt: now.toISOString() },
  { id: "pn_unmapped", name: "Unmapped spare", number: "+16475557822", provider: "twilio", status: "active", assistantId: "asst_clark", assistantName: "HVAC Agent", mappedBusiness: null, updatedAt: now.toISOString() },
];

const vapiAssistants = [
  { id: "asst_smith", name: "Smith HVAC Agent", model: "gpt-4o-mini", voice: "Alloy", phoneNumbers: ["+12495033301"], mappedBusiness: { id: 1, name: "Smith Heating & Cooling" }, updatedAt: now.toISOString() },
  { id: "asst_tim", name: "Electrical Agent", model: "gpt-4o-mini", voice: "Verse", phoneNumbers: ["+12895550199"], mappedBusiness: { id: 2, name: "Tim's Electrical" }, updatedAt: now.toISOString() },
  { id: "asst_brown", name: "Plumbing Agent", model: "gpt-4o-mini", voice: "Alloy", phoneNumbers: ["+14165558811"], mappedBusiness: { id: 3, name: "Brown Plumbing" }, updatedAt: now.toISOString() },
  { id: "asst_clark", name: "HVAC Agent", model: "gpt-4o-mini", voice: "Verse", phoneNumbers: ["+16475557822"], mappedBusiness: null, updatedAt: now.toISOString() },
  { id: "asst_spare", name: "Spare Agent", model: "gpt-4o-mini", voice: "Alloy", phoneNumbers: [], mappedBusiness: null, updatedAt: now.toISOString() },
];

const responses = {
  "/api/admin/session": { ok: true },
  "/api/admin/ops-overview": {
    owners,
    sync: {
      mappedBusinessCount: 3,
      businessesWithSyncedCalls: 3,
      syncStoreCount: 18,
      lastSyncedAt: now.toISOString(),
      warnings: [],
      env: { databaseAvailable: true, adminPasswordLooksDefault: false, stripeConfigured: true, vapiApiKeyConfigured: true, twilioConfigured: true, vapiAutoSyncEnabled: true },
    },
  },
  "/api/admin/customer-setup": { summary: { total: 4, ready: 2, blocked: 1, manual: 1, waiting: 0 }, warnings: [], customers: setupCustomers },
  "/api/admin/trial-health": { accounts: setupCustomers.map((customer) => ({ ...customer, expiry: { label: "7d left", color: "green" }, readinessChecklist: [] })) },
  "/api/admin/signups": { signups: setupCustomers.map((customer) => ({ ...customer, subscriptionStatus: "trialing", expiry: { label: "7d left", color: "green", daysRemaining: 7 } })) },
  "/api/admin/leads": { leads: [{ id: "lead_1", businessId: 1, createdAt: now.toISOString(), name: "John Smith", intent: "QUOTE", status: "NEW", callbackNumber: "905-555-1234" }] },
  "/api/admin/calls": { calls },
  "/api/admin/calls/analytics": { analytics: owners.map((owner) => ({ businessId: owner.businessId, businessName: owner.businessName, totalCalls: owner.stats.syncedCalls || 0 })) },
  "/api/admin/cost-audit": {
    audit: {
      totals: { totalCalls: 18, pricedCalls: 18, vapiCost: 164.22, twilioCost: 74.19, totalInternalCost: 238.41, estimatedProviderCost: 238.41 },
      summary: owners.map((owner) => ({ businessId: owner.businessId, businessName: owner.businessName, phoneNumber: owner.aiNumbers[0] || "", totalCalls: owner.stats.syncedCalls || 0, pricedCalls: owner.stats.syncedCalls || 0, vapiCost: 41.05, twilioCost: 18.54, totalInternalCost: 59.6, averageCost: 0.24, currency: "USD", lastCallAt: owner.stats.lastCallAt })),
      calls,
      warnings: [],
    },
  },
  "/api/admin/vapi/mappings": { mappings: owners.flatMap((owner) => owner.vapiMappings.map((mapping) => ({ ...mapping, businessId: owner.businessId, business: { name: owner.businessName } }))), businesses: owners.map((owner) => ({ id: owner.businessId, name: owner.businessName })) },
  "/api/admin/vapi/inventory": {
    inventory: {
      phoneNumbers: vapiPhoneNumbers,
      assistants: vapiAssistants,
      warnings: [],
      totals: { phoneNumbers: vapiPhoneNumbers.length, assistants: vapiAssistants.length, mappedPhoneNumbers: 3, mappedAssistants: 3 },
      fetchedAt: now.toISOString(),
    },
  },
  "/api/admin/daily-digest": { digest: { followUps: calls.slice(0, 2) } },
  "/api/admin/settings": { settings: { businessId: 1, answerAfterRings: 3, afterHoursMode: "AI_ALWAYS_ON", ownerPhone: "905-555-1234", bookingLink: "" } },
  "/api/admin/lead-handoffs": { summary: { total: 12, ownerNotified: 11, delivered: 8, acknowledged: 7, awaitingAcknowledgement: 3, retryDue: 1, escalationDue: 0, escalated: 1, failed: 0 }, handoffs: [] },
  "/api/admin/support-reports": {
    integrations: { githubConfigured: true, githubRepo: "OllieinCanada/MyA.I.PA", telegramConfigured: true, codexMode: "prepare" },
    reports: [{
      id: "support_sample_1",
      ticketNumber: "MYAIPA-SAMPLE01",
      businessId: 1,
      callId: 101,
      business: { id: 1, name: "Smith Heating & Cooling", phone: "+12495033301" },
      call: { id: 101, startedAt: now.toISOString(), status: "COMPLETED", outcome: "FOLLOW_UP" },
      description: "The owner text did not arrive after the most recent call.",
      aiSummary: "A linked owner text delivery attempt shows a failure.",
      likelyCause: "The message provider could not deliver the owner notification for this call.",
      suggestions: ["Confirm the owner cellphone number is correct.", "Refresh once for a newer delivery update.", "Inspect the provider error if it remains failed."],
      diagnostics: { page: "customer-dashboard", businessId: 1, aiNumberAssigned: true, call: { id: 101, status: "COMPLETED", notifications: [{ recipient: "owner", status: "failed", problem: "Message delivery failed" }] } },
      includeSensitiveCallData: false,
      contactAllowed: true,
      status: "NEW",
      severity: "HIGH",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      telegramAlertedAt: now.toISOString(),
      githubIssueUrl: null,
      codexTaskPrompt: null,
    }],
  },
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
    const page = await browser.newPage({ viewport: mobilePreview ? { width: 430, height: 932 } : { width: 1365, height: 768 } });
    await page.route("**/api/admin/**", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(responseFor(route.request().url())) });
    });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(1500);
    if (supportPreview) {
      await page.getByRole("button", { name: /Support Inbox/i }).first().click();
      await page.locator(".admin-support-card").waitFor({ state: "visible", timeout: 10000 });
    }
    await page.screenshot({ path: screenshotPath, fullPage: supportPreview || fullPagePreview });
  } finally {
    await browser?.close();
  }

  fs.copyFileSync(screenshotPath, phoneSharePath);
  if (!hasFlag("no-send")) {
    run(nodeCommand(), [
      path.join("scripts", "telegram-send-photo.js"),
      `--photo=${screenshotPath}`,
      `--caption=MyAIPA admin ${supportPreview ? "Support Inbox" : "Overview"} mock screenshot`,
    ]);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
