const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");

process.env.NODE_ENV = "test";
process.env.INTEGRATION_API_KEY = "test-integration-key-42";
process.env.MAKE_SIGNUP_WEBHOOK_API_KEY = "test-make-signup-key-42";
process.env.MAKE_SIGNUP_WEBHOOK_URL = "https://hook.us2.make.com/test-private-webhook-token-42";
process.env.TWILIO_ACCOUNT_SID = "ACtestaccountsid";
process.env.TWILIO_AUTH_TOKEN = "test-twilio-auth-token";
process.env.ADMIN_PASSWORD = "test-admin-password-42";
process.env.ADMIN_SESSION_SECRET = "test-admin-session-secret-42";
process.env.TRIAL_REMINDER_DISABLE = "true";
process.env.VAPI_AUTO_SYNC_ENABLED = "false";
process.env.MISSED_CALL_ALERT_ENABLED = "false";
process.env.DAILY_DIGEST_ENABLED = "false";

const { app, __test } = require("../server/index");
const { prisma } = require("../server/prisma");

let server;
let baseUrl;

before(async () => {
  await new Promise((resolve, reject) => {
    server = app.listen(0, "127.0.0.1", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await prisma.$disconnect();
});

async function request(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && !headers["content-type"]) {
    headers["content-type"] = "application/json";
  }
  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers,
    body: options.body && typeof options.body !== "string" ? JSON.stringify(options.body) : options.body,
  });
}

test("health endpoint remains public and carries baseline security headers", async () => {
  const response = await request("/api/health");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
  const payload = await response.json();
  assert.equal(payload.ok, true);
});

test("internal tool and webhook routes reject missing integration credentials", async () => {
  const requests = [
    ["/api/leads/create", { method: "POST", body: {} }],
    ["/api/calls/log", { method: "POST", body: {} }],
    ["/api/faqs/search?q=hours", { method: "GET" }],
    ["/api/notify/owner-sms", { method: "POST", body: {} }],
    ["/api/integrations/vapi/owner-sms-results", { method: "POST", body: {} }],
    ["/api/integrations/vapi/lead-handoffs/events", { method: "POST", body: {} }],
    ["/api/integrations/twilio/purchase-number", { method: "POST", body: {} }],
    ["/api/integrations/provisioning/complete-existing", { method: "POST", body: {} }],
    ["/api/integrations/vapi/sync-now", { method: "POST", body: {} }],
    ["/api/integrations/vapi/repair-sms-routing", { method: "POST", body: {} }],
    ["/api/integrations/provisioning/audit-latest-call", { method: "POST", body: {} }],
    ["/api/webhooks/voice", { method: "POST", body: { eventType: "unknown" } }],
  ];

  for (const [path, options] of requests) {
    const response = await request(path, options);
    assert.equal(response.status, 401, `${path} should reject unauthenticated requests`);
    const payload = await response.json();
    assert.match(payload.error, /(?:integration|provisioning) key/i);
  }
});

test("legacy direct-Twilio owner alerts are disabled even with valid integration auth", async () => {
  const response = await request("/api/notify/owner-sms", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.INTEGRATION_API_KEY}` },
    body: { to: "+12495550123", message: "Duplicate-prone legacy route" },
  });
  assert.equal(response.status, 410);
  const payload = await response.json();
  assert.match(payload.error, /Direct backend owner SMS is disabled/i);
  assert.equal(payload.replacement, "/api/integrations/vapi/owner-sms-results");
});

test("acknowledgement previews do not mutate and reject invalid signed tokens", async () => {
  const response = await request("/api/leads/acknowledge?token=invalid");
  assert.equal(response.status, 400);
  assert.match(response.headers.get("cache-control") || "", /no-store/);
  assert.match(await response.text(), /acknowledgement link is invalid/i);
});

test("invalid integration credentials are rejected", async () => {
  const response = await request("/api/webhooks/voice", {
    method: "POST",
    headers: { authorization: "Bearer wrong-key" },
    body: { eventType: "unknown" },
  });
  assert.equal(response.status, 401);
});

test("Vapi X-Vapi-Secret authentication is accepted", async () => {
  const response = await request("/api/webhooks/voice", {
    method: "POST",
    headers: { "x-vapi-secret": process.env.INTEGRATION_API_KEY },
    body: { eventType: "test.noop" },
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.eventType, "test.noop");
});

test("standard bearer integration authentication is accepted", async () => {
  const response = await request("/api/webhooks/voice", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.INTEGRATION_API_KEY}` },
    body: { eventType: "test.noop" },
  });
  assert.equal(response.status, 200);
});

test("Twilio provisioning only accepts valid area codes and Make webhook URLs", () => {
  assert.equal(__test.normalizeTwilioProvisioningAreaCode("(249)"), "249");
  assert.equal(
    __test.normalizeTwilioProvisioningVoiceUrl("https://hook.us2.make.com/example"),
    "https://hook.us2.make.com/example"
  );
  assert.throws(() => __test.normalizeTwilioProvisioningAreaCode("24"), /three digits/i);
  assert.throws(() => __test.normalizeTwilioProvisioningVoiceUrl("https://example.com/webhook"), /Make webhook/i);
});

test("Make signup authentication is accepted by provisioning routes", async () => {
  const response = await request("/api/integrations/vapi/import-twilio-number", {
    method: "POST",
    headers: { "x-make-apikey": process.env.MAKE_SIGNUP_WEBHOOK_API_KEY },
    body: {},
  });
  assert.notEqual(response.status, 401);
  assert.match((await response.json()).error, /VAPI_API_KEY is not configured/i);
});

test("Make webhook token authentication is accepted by provisioning routes", async () => {
  const response = await request("/api/integrations/vapi/import-twilio-number", {
    method: "POST",
    headers: { "x-make-webhook-token": "test-private-webhook-token-42" },
    body: {},
  });
  assert.notEqual(response.status, 401);
  assert.match((await response.json()).error, /VAPI_API_KEY is not configured/i);
});

test("Twilio provisioning reuses a number already assigned to the Make voice webhook", async () => {
  const calls = [];
  const result = await __test.purchaseTwilioPhoneNumber(
    { areaCode: "249", voiceUrl: "https://hook.us2.make.com/existing-voice-hook" },
    {
      fetchImpl: async (url, options = {}) => {
        calls.push({ url: String(url), method: options.method || "GET" });
        return new Response(JSON.stringify({
          incoming_phone_numbers: [{
            sid: "PNexisting",
            phone_number: "+12495550123",
            voice_url: "https://hook.us2.make.com/existing-voice-hook",
            voice_method: "POST",
            capabilities: { voice: true, sms: true },
          }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      },
    }
  );

  assert.equal(result.phone_number, "+12495550123");
  assert.equal(result.reused, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "GET");
});

test("Vapi end-of-call reports normalize duration, status, cost, and artifacts", () => {
  const report = __test.mergeVapiEndOfCallReport({
    type: "end-of-call-report",
    endedReason: "customer-ended-call",
    cost: 0.1234,
    call: {
      id: "test-vapi-call",
      customer: { number: "+12495550123" },
      startedAt: "2026-07-14T12:00:00.000Z",
      endedAt: "2026-07-14T12:02:05.000Z",
    },
    artifact: {
      transcript: "AI: Hello\nUser: I need service.",
      recording: { url: "https://example.com/test-recording.wav" },
    },
  });

  assert.equal(report.id, "test-vapi-call");
  assert.equal(__test.getVapiDurationSeconds(report), 125);
  assert.equal(__test.mapVapiStatus(report.endedReason), "COMPLETED");
  assert.equal(__test.getVapiCost(report), 0.1234);
  assert.equal(__test.getVapiRecordingUrl(report), "https://example.com/test-recording.wav");
});

test("authenticated Vapi end-of-call reports require a call id before database work", async () => {
  const response = await request("/api/webhooks/voice", {
    method: "POST",
    headers: { "x-vapi-secret": process.env.INTEGRATION_API_KEY },
    body: { message: { type: "end-of-call-report", endedReason: "hangup" } },
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /call id is required/i);
});

test("CORS only reflects configured origins", async () => {
  const allowed = await request("/api/health", { headers: { origin: "https://www.myaipa.ca" } });
  assert.equal(allowed.headers.get("access-control-allow-origin"), "https://www.myaipa.ca");

  const denied = await request("/api/health", { headers: { origin: "https://attacker.example" } });
  assert.equal(denied.headers.get("access-control-allow-origin"), null);
});

test("customer and admin responses are explicitly non-cacheable", async () => {
  const customer = await request("/api/customer/dashboard", { method: "POST", body: {} });
  assert.match(customer.headers.get("cache-control") || "", /no-store/);

  const admin = await request("/api/admin/session");
  assert.match(admin.headers.get("cache-control") || "", /no-store/);
});

test("oversized JSON bodies are rejected before route handling", async () => {
  const response = await request("/api/business/enrich", {
    method: "POST",
    body: { website: "https://example.com", padding: "x".repeat(1024 * 1024 + 1) },
  });
  assert.equal(response.status, 413);
});

test("public business enrichment is rate limited before it can be abused as a fetch proxy", async () => {
  for (let index = 0; index < 10; index += 1) {
    const response = await request("/api/business/enrich", { method: "POST", body: {} });
    assert.equal(response.status, 200);
  }

  const blocked = await request("/api/business/enrich", { method: "POST", body: {} });
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get("retry-after")) >= 1);
});

test("admin sessions use an HttpOnly, Secure, SameSite=Lax cookie in production", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const response = await request("/api/admin/login", {
      method: "POST",
      body: { password: process.env.ADMIN_PASSWORD },
    });
    assert.equal(response.status, 200);
    const cookie = response.headers.get("set-cookie") || "";
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /Secure/i);
    assert.match(cookie, /SameSite=Lax/i);
  } finally {
    process.env.NODE_ENV = previousNodeEnv;
  }
});

test("admin login attempts are rate limited", async () => {
  for (let index = 0; index < 9; index += 1) {
    const response = await request("/api/admin/login", { method: "POST", body: { password: `wrong-${index}` } });
    assert.equal(response.status, 401);
  }

  const blocked = await request("/api/admin/login", { method: "POST", body: { password: "still-wrong" } });
  assert.equal(blocked.status, 429);
});
