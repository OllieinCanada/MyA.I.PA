const fs = require("fs");
const http = require("http");
const path = require("path");
const { chromium } = require("playwright");
const { nodeCommand, npmCommand, rootPath, run } = require("./_helpers");

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function getArg(name, fallback = "") {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

const now = new Date();
const minutesAgo = (minutes) => new Date(now.getTime() - minutes * 60 * 1000).toISOString();
const daysFromNow = (days) => new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();

const sampleCall = {
  id: 101,
  startedAt: minutesAgo(18),
  durationSec: 226,
  status: "COMPLETED",
  outcome: "FOLLOW_UP",
  endedReason: "customer-ended-call",
  aiSummary: "Brian needs an electrician to wire a newly installed hot tub at his Hamilton home. He would like the work started as soon as possible and prefers an afternoon callback after 5 p.m.",
  followUpNeeded: true,
  transcriptAvailable: true,
  transcriptExpiresAt: daysFromNow(30),
  transcript: [
    "AI Assistant: Thanks for calling Smith Electrical. I’m the company’s AI telephone assistant. How can I help today?",
    "Caller: I need someone to wire up my hot tub.",
    "AI Assistant: Sure, we can help you with that. Can I get your name, the address and city, when you need the work done, and the best number and time to reach you?",
    "Caller: My name is Brian Smith. I’m at 23 Robb Street in Hamilton. I’d like to start right away. Call me back on this number in the afternoon or after 5 p.m.",
    "AI Assistant: Thank you, Brian. I’ve sent your request to the team and you’ll receive a confirmation text shortly.",
  ].join("\n\n"),
  recordingAvailable: true,
  recordingPath: "/api/customer/dashboard/calls/101/recording",
  recordingExpiresAt: daysFromNow(30),
  recordingConsent: { type: "verbal", grantedAt: minutesAgo(22) },
  lead: {
    name: "Brian Smith",
    callbackNumber: "+19055550123",
    summary: "Hot tub electrical installation",
    intent: "New installation",
    urgency: "Normal",
    status: "NEW",
  },
  details: {
    service: "Wire a newly installed hot tub",
    address: "23 Robb Street",
    city: "Hamilton",
    preferredStart: "As soon as possible",
    callbackTime: "Afternoons or after 5 p.m.",
  },
  successEvaluation: "Successful — the assistant captured every required job detail and confirmed the next step.",
  quality: {
    score: 94,
    metrics: { turnLatencyAverage: 0.72, modelLatencyAverage: 0.41, numUserInterrupted: 0 },
  },
  notifications: [
    { recipient: "owner", status: "delivered", requestedAt: minutesAgo(15), sentAt: minutesAgo(15), deliveredAt: minutesAgo(15), problem: "" },
    { recipient: "customer", status: "delivered", requestedAt: minutesAgo(15), sentAt: minutesAgo(15), deliveredAt: minutesAgo(14), problem: "" },
  ],
  timeline: [
    { type: "call_started", label: "Call received", at: minutesAgo(22) },
    { type: "call_ended", label: "Call completed", at: minutesAgo(18) },
    { type: "summary_ready", label: "Call summary ready", at: minutesAgo(18) },
    { type: "owner_text_delivered", label: "Owner text delivered", at: minutesAgo(15) },
    { type: "customer_text_delivered", label: "Customer text delivered", at: minutesAgo(14) },
  ],
  caller: { name: "Brian Smith", phone: "+19055550123" },
};

const dashboard = {
  businessId: 1,
  signup: {
    businessName: "SAMPLE — Smith Electrical",
    ownerName: "Alex Smith",
    ownerEmail: "owner@sample-business.example",
    ownerPhone: "+19055550999",
    businessPhone: "+19055550888",
    businessAddress: "Hamilton, Ontario",
    status: "setup_complete",
    signedUpAt: minutesAgo(7 * 24 * 60),
    trialEndAt: daysFromNow(9),
    subscriptionStatus: "trialing",
    twilioPhoneNumber: "+12495550199",
  },
  assistant: {
    aiNumber: "+12495550199",
    answerAfterRings: 3,
    afterHoursMode: "AI_ALWAYS_ON",
    bookingLink: "",
    mappedNumbers: [{ type: "phoneNumber", value: "+12495550199", label: "Main AI number" }],
  },
  stats: {
    totalCalls: 12,
    completedCalls: 11,
    missedCalls: 1,
    followUps: 4,
    bookedCalls: 2,
    averageDurationSec: 173,
    totalMinutes: 34.6,
    lastCallAt: sampleCall.startedAt,
  },
  setup: {
    readinessPercent: 100,
    checklist: [
      { key: "billing", label: "Trial and billing ready", done: true },
      { key: "owner-phone", label: "Owner phone added", done: true },
      { key: "ai-number", label: "AI number mapped", done: true },
      { key: "faq", label: "Starter FAQs added", done: true },
    ],
  },
  appointments: [
    {
      id: "sample-appointment",
      customerName: "Jamie Lee",
      customerPhone: "+19055550177",
      service: "Panel inspection and quote",
      address: "Hamilton, Ontario",
      requestedStart: daysFromNow(2),
      confirmedStart: null,
      durationMinutes: 60,
      timezone: "America/Toronto",
      status: "PENDING",
      ownerNote: "",
      createdAt: minutesAgo(42),
    },
    {
      id: "sample-confirmed-appointment",
      customerName: "Morgan Chen",
      customerPhone: "+19055550188",
      service: "EV charger installation",
      address: "Grimsby, Ontario",
      requestedStart: daysFromNow(2),
      confirmedStart: daysFromNow(2),
      durationMinutes: 90,
      timezone: "America/Toronto",
      status: "CONFIRMED",
      staffMember: { id: "staff-sam", name: "Sam", color: "#0f9f6e" },
      calendarPath: "/api/appointments/sample-confirmed-appointment/calendar?token=sample",
      createdAt: minutesAgo(120),
    },
  ],
  scheduling: {
    bufferMinutes: 30,
    reminderHours: [24, 2],
    calendarBookingMode: "MANUAL_APPROVAL",
    bookingHours: Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((day, index) => [day, { enabled: index < 5, start: "08:00", end: "17:00" }])),
  },
  calendarProviders: { googleConfigured: true, microsoftConfigured: true },
  calendarConnections: [
    { id: "sample-calendar-google", provider: "GOOGLE", status: "CONNECTED", accountEmail: "owner@sample-business.example", staffMemberId: "", staffMemberName: "Owner / shared business calendar", connectedAt: minutesAgo(60), lastSyncedAt: minutesAgo(30) },
  ],
  staffMembers: [
    { id: "staff-sam", name: "Sam", email: "sam@sample-business.example", phone: "+19055550111", color: "#0f9f6e" },
    { id: "staff-jordan", name: "Jordan", email: "", phone: "+19055550122", color: "#7c3aed" },
  ],
  recentCalls: [sampleCall],
  calls: [
    sampleCall,
    {
      ...sampleCall,
      id: 102,
      startedAt: minutesAgo(95),
      durationSec: 114,
      outcome: "BOOKED",
      aiSummary: "Customer requested an electrical panel inspection and a quote.",
      followUpNeeded: false,
      transcriptAvailable: false,
      transcript: "",
      recordingAvailable: false,
      recordingPath: "",
      lead: { ...sampleCall.lead, name: "Jamie Lee", callbackNumber: "+19055550177", intent: "Inspection and quote" },
      caller: { name: "Jamie Lee", phone: "+19055550177" },
    },
  ],
  faqs: [
    { id: 1, question: "What areas do you serve?", answer: "Hamilton and surrounding communities." },
    { id: 2, question: "Do you provide estimates?", answer: "Yes. The owner follows up with the caller to discuss the job and provide a quote." },
  ],
};

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function startBuildServer() {
  const buildDir = rootPath("build");
  const indexPath = path.join(buildDir, "index.html");
  if (!fs.existsSync(indexPath)) throw new Error("Missing build/index.html after the production build.");

  const server = http.createServer((req, res) => {
    let filePath;
    try {
      const requested = decodeURIComponent(String(req.url || "/").split("?")[0]);
      const relative = requested === "/" ? "index.html" : requested.replace(/^\/+/, "");
      const candidate = path.resolve(buildDir, relative);
      if (!candidate.startsWith(buildDir)) {
        res.writeHead(403).end("Forbidden");
        return;
      }
      filePath = fs.existsSync(candidate) && fs.statSync(candidate).isFile() ? candidate : indexPath;
    } catch (_error) {
      res.writeHead(400).end("Bad request");
      return;
    }
    fs.readFile(filePath, (error, body) => {
      if (error) {
        res.writeHead(404).end("Not found");
        return;
      }
      res.writeHead(200, { "Content-Type": contentTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream" });
      res.end(body);
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({ server, url: `http://127.0.0.1:${address.port}/#/dashboard` });
    });
  });
}

async function launchBrowser() {
  try {
    return await chromium.launch({ headless: true });
  } catch (error) {
    try {
      return await chromium.launch({ headless: true, channel: "chrome" });
    } catch (_chromeError) {
      try {
        return await chromium.launch({ headless: true, channel: "msedge" });
      } catch (_edgeError) {
        throw error;
      }
    }
  }
}

async function main() {
  if (!hasFlag("skip-build")) run(npmCommand(), ["run", "build"]);

  const screenshotName = getArg("name", "telegram-customer-dashboard-sample.png");
  const screenshotPath = rootPath("diagnostics", "browser-drive", screenshotName);
  const phoneSharePath = rootPath("phone-share", screenshotName);
  fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
  fs.mkdirSync(path.dirname(phoneSharePath), { recursive: true });

  const { server, url } = await startBuildServer();
  let browser;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, deviceScaleFactor: 1 });
    await page.route("**/api/customer/dashboard", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, dashboard, refreshedAt: now.toISOString() }),
      });
    });
    await page.route("**/api/customer/dashboard/support/suggest", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          callLinked: true,
          analysis: {
            source: "ai",
            severity: "HIGH",
            summary: "A linked owner text delivery attempt shows a failure.",
            likelyCause: "The message provider could not deliver the owner notification for this call.",
            suggestions: [
              "Confirm the owner cellphone number shown for this business is correct.",
              "Refresh once to check for a newer delivery update.",
              "If it still shows failed, send the report so support can inspect the provider error.",
            ],
          },
        }),
      });
    });
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    await page.locator(".customer-main").waitFor({ state: "visible", timeout: 15000 });
    await page.locator(".customer-call-summary").first().click();
    if (hasFlag("support")) {
      await page.locator(".customer-call-report-row button").first().click();
      await page.locator(".customer-support-description textarea").fill("The owner text did not arrive after this call.");
      await page.getByRole("button", { name: "Get suggestions" }).click();
      await page.locator(".customer-support-analysis").waitFor({ state: "visible", timeout: 15000 });
    }
    await page.evaluate(() => {
      const badge = document.createElement("div");
      badge.id = "telegram-sample-data-badge";
      badge.textContent = "SAMPLE DATA PREVIEW";
      document.body.appendChild(badge);
    });
    await page.addStyleTag({
      content: "#telegram-sample-data-badge{position:fixed;z-index:99999;right:18px;bottom:18px;border:2px solid #fff;border-radius:999px;background:#b42318;color:#fff;padding:10px 16px;font:900 12px/1 system-ui;letter-spacing:.12em;box-shadow:0 8px 24px rgba(0,0,0,.25)}",
    });
    await page.waitForTimeout(500);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    fs.copyFileSync(screenshotPath, phoneSharePath);
    console.log(`Customer dashboard screenshot saved: ${screenshotPath}`);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }

  if (!hasFlag("no-send")) {
    run(nodeCommand(), [
      path.join("scripts", "telegram-send-photo.js"),
      `--photo=${screenshotPath}`,
      "--caption=MyAIPA customer dashboard — sample data preview generated automatically from the current local build",
    ]);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
