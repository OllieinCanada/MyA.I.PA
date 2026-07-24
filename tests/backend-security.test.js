const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");

process.env.NODE_ENV = "test";
process.env.INTEGRATION_API_KEY = "test-integration-key-42";
process.env.VAPI_WEBHOOK_SECRET = "test-vapi-webhook-secret-42";
process.env.MAKE_SIGNUP_WEBHOOK_API_KEY = "test-make-signup-key-42";
process.env.MAKE_SIGNUP_WEBHOOK_URL = "https://hook.us2.make.com/test-private-webhook-token-42";
process.env.TWILIO_ACCOUNT_SID = "ACtestaccountsid";
process.env.TWILIO_AUTH_TOKEN = "test-twilio-auth-token";
process.env.SMS_SUPPRESSION_API_KEY = "test-suppression-api-key-42";
process.env.ADMIN_PASSWORD = "test-admin-password-42";
process.env.ADMIN_SESSION_SECRET = "test-admin-session-secret-42";
process.env.TRIAL_REMINDER_DISABLE = "true";
process.env.VAPI_AUTO_SYNC_ENABLED = "false";
// Keep this suite deterministic even when a developer has added a real Vapi
// credential to .env.local. The authentication tests below intentionally
// verify the missing-credential failure path and must never reach Vapi.
process.env.VAPI_API_KEY = "";
process.env.MISSED_CALL_ALERT_ENABLED = "false";
process.env.DAILY_DIGEST_ENABLED = "false";

const { app, __test } = require("../server/index");
const { prisma } = require("../server/prisma");
const { getTwilioSignature } = require("../server/smsSuppression");

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

test("inbound messaging preferences require a valid provider signature", async () => {
  const response = await request("/api/webhooks/sms", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      From: "+19055550123",
      To: "+12495550100",
      Body: "STOP",
      MessageSid: "SM_INVALID",
    }).toString(),
  });
  assert.equal(response.status, 401);
});

test("a signed STOP webhook records one central suppression preference", async () => {
  const originalUpsert = prisma.smsSuppression.upsert;
  const writes = [];
  prisma.smsSuppression.upsert = async (operation) => {
    writes.push(operation);
    return {
      ...operation.create,
      updatedAt: new Date("2026-07-24T05:00:00.000Z"),
    };
  };
  const form = {
    From: "+19055550123",
    To: "+12495550100",
    Body: "STOP",
    MessageSid: "SM_SIGNED_STOP",
  };
  process.env.TWILIO_INBOUND_WEBHOOK_URL = `${baseUrl}/api/webhooks/sms`;
  try {
    const response = await request("/api/webhooks/sms", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": getTwilioSignature(
          process.env.TWILIO_INBOUND_WEBHOOK_URL,
          form,
          process.env.TWILIO_AUTH_TOKEN
        ),
      },
      body: new URLSearchParams(form).toString(),
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") || "", /xml/i);
    assert.equal(writes.length, 1);
    assert.equal(writes[0].where.phoneNumber, "+19055550123");
    assert.equal(writes[0].create.suppressed, true);
  } finally {
    prisma.smsSuppression.upsert = originalUpsert;
  }
});

test("the private consent endpoint hides phone details and requires its dedicated key", async () => {
  const unauthorized = await request("/api/integrations/sms/suppression/check", {
    method: "POST",
    body: { phoneNumber: "+19055550123" },
  });
  assert.equal(unauthorized.status, 401);

  const originalFindUnique = prisma.smsSuppression.findUnique;
  prisma.smsSuppression.findUnique = async () => ({ suppressed: true });
  try {
    const response = await request("/api/integrations/sms/suppression/check", {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.SMS_SUPPRESSION_API_KEY}` },
      body: { phoneNumber: "+19055550123" },
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(payload, { allowed: false, suppressed: true });
    assert.equal(JSON.stringify(payload).includes("50123"), false);
  } finally {
    prisma.smsSuppression.findUnique = originalFindUnique;
  }
});

test("readiness endpoint verifies database connectivity without exposing connection details", async () => {
  const originalQueryRaw = prisma.$queryRaw;
  prisma.$queryRaw = async () => [{ "?column?": 1 }];
  try {
    const response = await request("/api/health/ready");
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.dependencies.database, "reachable");
    assert.equal(JSON.stringify(payload).includes("DATABASE_URL"), false);
  } finally {
    prisma.$queryRaw = originalQueryRaw;
  }
});

test("readiness endpoint fails closed without exposing database errors", async () => {
  const originalQueryRaw = prisma.$queryRaw;
  prisma.$queryRaw = async () => {
    const error = new Error("postgresql://operator:secret@example.invalid/private");
    error.code = "P1001";
    throw error;
  };
  try {
    const response = await request("/api/health/ready");
    assert.equal(response.status, 503);
    const payload = await response.json();
    assert.equal(payload.ok, false);
    assert.equal(payload.dependencies.database, "unavailable");
    assert.equal(JSON.stringify(payload).includes("secret"), false);
    assert.equal(JSON.stringify(payload).includes("example.invalid"), false);
  } finally {
    prisma.$queryRaw = originalQueryRaw;
  }
});

test("customer support routes require a signed dashboard session", async () => {
  for (const path of ["/api/customer/dashboard/support/suggest", "/api/customer/dashboard/support/reports"]) {
    const response = await request(path, { method: "POST", body: { description: "My latest call is missing." } });
    assert.equal(response.status, 401);
    assert.match(response.headers.get("cache-control") || "", /no-store/i);
  }
});

test("support repair actions require an admin session", async () => {
  const routes = [
    ["/api/admin/support-reports/example", "PATCH"],
    ["/api/admin/support-reports/example/github-issue", "POST"],
    ["/api/admin/support-reports/example/codex-task", "POST"],
  ];
  for (const [path, method] of routes) {
    const response = await request(path, { method, body: {} });
    assert.equal(response.status, 401);
  }
});

test("customer scheduling and staff changes require a signed dashboard session", async () => {
  const requests = [
    ["/api/customer/dashboard/scheduling", "PUT"],
    ["/api/customer/dashboard/staff", "POST"],
    ["/api/customer/dashboard/staff/staff-1", "DELETE"],
    ["/api/customer/dashboard/calendar/connect/google", "GET"],
    ["/api/customer/dashboard/calendar/connections/calendar-1", "DELETE"],
    ["/api/customer/dashboard/appointments/appointment-1/respond", "POST"],
  ];
  for (const [path, method] of requests) {
    const response = await request(path, { method, body: ["GET", "DELETE"].includes(method) ? undefined : {} });
    assert.equal(response.status, 401, `${method} ${path} should reject unauthenticated requests`);
    assert.match(response.headers.get("cache-control") || "", /no-store/i);
  }
});

test("internal tool and webhook routes reject missing integration credentials", async () => {
  const requests = [
    ["/api/leads/create", { method: "POST", body: {} }],
    ["/api/calls/log", { method: "POST", body: {} }],
    ["/api/faqs/search?q=hours", { method: "GET" }],
    ["/api/notify/owner-sms", { method: "POST", body: {} }],
    ["/api/appointments/request", { method: "POST", body: {} }],
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
    assert.match(payload.error, /(?:integration|provisioning|vapi webhook)/i);
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
    headers: { "x-vapi-secret": process.env.VAPI_WEBHOOK_SECRET },
    body: { eventType: "test.noop" },
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.eventType, "test.noop");
});

test("Vapi webhook does not accept the broader integration credential", async () => {
  const response = await request("/api/webhooks/voice", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.INTEGRATION_API_KEY}` },
    body: { eventType: "test.noop" },
  });
  assert.equal(response.status, 401);
});

test("Vapi webhook accepts its dedicated bearer credential", async () => {
  const response = await request("/api/webhooks/voice", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.VAPI_WEBHOOK_SECRET}` },
    body: { eventType: "test.noop" },
  });
  assert.equal(response.status, 200);
});

test("integration credentials are not accepted from a request body", async () => {
  const response = await request("/api/leads/create", {
    method: "POST",
    body: { integrationKey: process.env.INTEGRATION_API_KEY },
  });
  assert.equal(response.status, 401);
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

test("customer support diagnostics redact contact details before AI analysis", () => {
  const redacted = __test.redactSupportTextForAi("Call me at 905-788-5488 or Oliver@example.com about account 123456789.");
  assert.doesNotMatch(redacted, /905|5488|Oliver@example|123456789/i);
  assert.match(redacted, /\[phone removed\]/i);
  assert.match(redacted, /\[email removed\]/i);
});

test("customer support diagnostics keep sensitive call data opt-in", () => {
  const dashboard = {
    businessId: 7,
    setup: { readinessPercent: 85 },
    assistant: { aiNumber: "+12495550123" },
    stats: { totalCalls: 1, lastCallAt: "2026-07-22T14:00:00.000Z" },
    calls: [{
      id: 44,
      startedAt: "2026-07-22T14:00:00.000Z",
      durationSec: 85,
      status: "COMPLETED",
      outcome: "FOLLOW_UP",
      transcriptAvailable: true,
      transcript: "My private transcript",
      recordingAvailable: false,
      caller: { name: "Brian", phone: "+19055551234" },
      notifications: [{ recipient: "owner", status: "failed", problem: "Message delivery failed" }],
    }],
  };
  const safe = __test.buildCustomerSupportDiagnostics(dashboard, 44, false);
  assert.equal(safe.call.id, 44);
  assert.equal(safe.callDetails, undefined);
  assert.doesNotMatch(JSON.stringify(safe), /private transcript|Brian|19055551234/i);
  const optedIn = __test.buildCustomerSupportDiagnostics(dashboard, 44, true);
  assert.equal(optedIn.callDetails.transcript, "My private transcript");
  assert.equal(optedIn.callDetails.caller.name, "Brian");
});

test("customer support rules identify failed text delivery without inventing a repair", () => {
  const analysis = __test.getRuleBasedSupportAnalysis({
    description: "The owner text did not arrive.",
    diagnostics: {
      aiNumberAssigned: true,
      call: { notifications: [{ recipient: "owner", status: "failed", problem: "Message delivery failed" }] },
    },
  });
  assert.equal(analysis.severity, "HIGH");
  assert.match(analysis.likelyCause, /provider/i);
  assert.equal(analysis.suggestions.length, 3);
  assert.doesNotMatch(JSON.stringify(analysis), /fixed|changed your settings/i);
});

test("customer support extracts Responses API structured text and formats ticket numbers", () => {
  const text = __test.extractOpenAiResponseText({
    output: [{ content: [{ type: "output_text", text: "{\"summary\":\"Checked\"}" }] }],
  });
  assert.equal(text, "{\"summary\":\"Checked\"}");
  assert.equal(__test.getSupportTicketNumber("cm1234abcd5678efgh"), "MYAIPA-5678EFGH");
});

test("Codex and GitHub repair briefs exclude opted-in transcript and caller details", () => {
  const report = {
    id: "cm1234abcd5678efgh",
    businessId: 7,
    callId: 44,
    severity: "HIGH",
    description: "The owner text did not arrive. Call 905-788-5488 or email owner@example.com.",
    aiSummary: "Owner notification failure",
    likelyCause: "Provider delivery failure",
    suggestions: ["Check the owner number", "Inspect delivery status"],
    business: { name: "Sample Electrical" },
    diagnostics: {
      capturedAt: "2026-07-22T14:00:00.000Z",
      businessId: 7,
      call: { id: 44, status: "COMPLETED", notifications: [{ recipient: "owner", status: "failed" }] },
      callDetails: { transcript: "PRIVATE TRANSCRIPT", caller: { phone: "+19055551234" } },
    },
  };
  const brief = __test.buildSupportRepairBrief(report);
  const issue = __test.buildGithubSupportIssue(report);
  assert.match(brief, /Codex repair task: MYAIPA-5678EFGH/);
  assert.match(issue.title, /MYAIPA-5678EFGH/);
  assert.doesNotMatch(`${brief}\n${issue.body}`, /PRIVATE TRANSCRIPT|19055551234|905-788-5488|owner@example\.com/);
  assert.match(`${brief}\n${issue.body}`, /\[phone removed\]|\[email removed\]/);
  assert.match(brief, /Do not commit, push, merge, or deploy/i);
});

test("GitHub support issue creation uses the configured repository without exposing its token", async () => {
  let captured;
  const result = await __test.createGithubSupportIssue({
    id: "cm1234abcd5678efgh",
    businessId: 7,
    description: "A recent call did not sync.",
    severity: "MEDIUM",
    suggestions: [],
    diagnostics: {},
    business: { name: "Sample Electrical" },
  }, {
    token: "github-test-secret",
    repo: "example/support-repo",
    fetchImpl: async (url, options) => {
      captured = { url: String(url), options };
      return new Response(JSON.stringify({ number: 17, html_url: "https://github.com/example/support-repo/issues/17" }), { status: 201, headers: { "content-type": "application/json" } });
    },
  });
  assert.equal(result.number, 17);
  assert.equal(captured.url, "https://api.github.com/repos/example/support-repo/issues");
  assert.equal(captured.options.headers.Authorization, "Bearer github-test-secret");
  assert.doesNotMatch(captured.options.body, /github-test-secret/);
});

test("customer-visible support records exclude internal repair and handoff fields", () => {
  const sanitized = __test.sanitizeCustomerSupportReport({
    id: "cm1234abcd5678efgh",
    callId: 44,
    description: "Text missing",
    status: "INVESTIGATING",
    severity: "MEDIUM",
    customerMessage: "We are checking delivery.",
    internalNote: "Provider token failed",
    codexTaskPrompt: "secret repair context",
    githubIssueUrl: "https://github.com/example/repo/issues/1",
    createdAt: new Date("2026-07-22T14:00:00.000Z"),
    updatedAt: new Date("2026-07-22T15:00:00.000Z"),
  });
  assert.equal(sanitized.ticketNumber, "MYAIPA-5678EFGH");
  assert.equal(sanitized.customerMessage, "We are checking delivery.");
  assert.equal(sanitized.internalNote, undefined);
  assert.equal(sanitized.codexTaskPrompt, undefined);
  assert.equal(sanitized.githubIssueUrl, undefined);
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
      messages: [
        { role: "assistant", message: "Hello", secondsFromStart: 0.2 },
        { role: "user", message: "I need service", secondsFromStart: 1.4 },
      ],
      performanceMetrics: { turnLatencyAverage: 0.65, unsupportedInternalValue: 42 },
    },
    compliance: { recordingConsent: { type: "verbal", grantedAt: "2026-07-14T12:00:02.000Z" } },
  });

  assert.equal(report.id, "test-vapi-call");
  assert.equal(__test.getVapiDurationSeconds(report), 125);
  assert.equal(__test.mapVapiStatus(report.endedReason), "COMPLETED");
  assert.equal(__test.getVapiCost(report), 0.1234);
  assert.equal(__test.getVapiRecordingUrl(report), "https://example.com/test-recording.wav");
  assert.deepEqual(__test.getVapiRecordingConsent(report), {
    type: "verbal",
    grantedAt: "2026-07-14T12:00:02.000Z",
  });
  assert.equal(__test.getVapiCustomerSafeMessages(report).length, 2);
  assert.deepEqual(__test.getVapiArtifactMetrics(report), { turnLatencyAverage: 0.65 });
});

test("customer setup blocks readiness until isolated SMS routing is verified", () => {
  const base = {
    signup: {},
    business: { vapiMappings: [] },
    calls: [],
    envStatus: { vapiApiKeyConfigured: true, twilioConfigured: true },
  };
  assert.equal(__test.deriveCustomerSetupStep("sms_routing", base).status, "waiting");
  assert.equal(__test.deriveCustomerSetupStep("sms_routing", {
    ...base,
    signup: { smsRoutingStatus: "failed", smsRoutingError: "Protected routing mismatch." },
  }).status, "failed");
  assert.equal(__test.deriveCustomerSetupStep("sms_routing", {
    ...base,
    signup: { smsRoutingStatus: "healthy" },
  }).status, "done");
});

test("phone billing anniversaries preserve the acquisition time and handle short months", () => {
  assert.equal(
    __test.getNextMonthlyAnniversary("2026-01-31T18:45:00.000Z", "2026-02-01T00:00:00.000Z").toISOString(),
    "2026-02-28T18:45:00.000Z"
  );
  assert.equal(
    __test.getNextMonthlyAnniversary("2026-07-15T23:00:00.000Z", "2026-07-15T23:00:01.000Z").toISOString(),
    "2026-08-15T23:00:00.000Z"
  );
});

test("composite notification health flags owner failure and cross-business routing", () => {
  const healthyResult = {
    name: "send_call_summaries_2588_test_v1",
    owner: { sent: true, fromLast4: "2588", toLast4: "5488" },
    customer: { sent: true, fromLast4: "2588", toLast4: "1234" },
  };
  assert.equal(__test.summarizeCompositeNotificationHealth({
    toolResults: [healthyResult],
    aiNumber: "+12494682588",
    ownerNumber: "+19057885488",
    customerNumber: "+19055551234",
  }).code, "BOTH_SMS_ACCEPTED");

  assert.equal(__test.summarizeCompositeNotificationHealth({
    toolResults: [{ ...healthyResult, owner: { ...healthyResult.owner, toLast4: "7422" } }],
    aiNumber: "+12494682588",
    ownerNumber: "+19057885488",
    customerNumber: "+19055551234",
  }).code, "SMS_ROUTING_MISMATCH");

  assert.equal(__test.summarizeCompositeNotificationHealth({
    toolResults: [{ ...healthyResult, owner: { ...healthyResult.owner, sent: false, errorCode: "21610" } }],
    aiNumber: "+12494682588",
    ownerNumber: "+19057885488",
    customerNumber: "+19055551234",
  }).code, "OWNER_SMS_FAILED");
});

test("webhook replay claims reject duplicates and recover after an abandoned lease", () => {
  const store = {};
  const event = { provider: "stripe", eventId: "evt_test_replay_42", eventType: "checkout.session.completed" };
  const first = __test.claimWebhookReplayStore(store, { ...event, now: 1000, claimToken: "first-claim" });
  assert.equal(first.claimed, true);
  assert.equal(first.duplicate, false);
  assert.equal(Object.keys(store).length, 1);
  assert.equal(JSON.stringify(store).includes(event.eventId), false, "raw provider event ids should not be persisted");

  const duplicate = __test.claimWebhookReplayStore(store, { ...event, now: 1001, claimToken: "duplicate-claim" });
  assert.equal(duplicate.claimed, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.status, "processing");

  store[first.key].leaseExpiresAt = 1001;
  const recovered = __test.claimWebhookReplayStore(store, { ...event, now: 1002, claimToken: "recovered-claim" });
  assert.equal(recovered.claimed, true);
  assert.equal(recovered.duplicate, false);
  assert.equal(store[first.key].claimToken, "recovered-claim");

  store[first.key].status = "completed";
  const completedDuplicate = __test.claimWebhookReplayStore(store, { ...event, now: 1003 });
  assert.equal(completedDuplicate.claimed, false);
  assert.equal(completedDuplicate.duplicate, true);
  assert.equal(completedDuplicate.status, "completed");
});

test("webhook replay keys are provider scoped and expired records are pruned", () => {
  const stripeKey = __test.getWebhookReplayKey("stripe", "same-event-id");
  const vapiKey = __test.getWebhookReplayKey("vapi", "same-event-id");
  assert.notEqual(stripeKey, vapiKey);
  assert.equal(stripeKey.length, 32);

  const store = {
    expired: { status: "completed", expiresAt: 100 },
    current: { status: "completed", expiresAt: 1000, claimedAt: 50 },
  };
  __test.pruneWebhookReplayStore(store, 101);
  assert.deepEqual(Object.keys(store), ["current"]);
});

test("authenticated Vapi end-of-call reports require a call id before database work", async () => {
  const response = await request("/api/webhooks/voice", {
    method: "POST",
    headers: { "x-vapi-secret": process.env.VAPI_WEBHOOK_SECRET },
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

test("customer dashboard live refresh requires an untampered signed session", async () => {
  const email = "owner@example.com";
  const phone = "+1 (905) 555-0123";
  const lookupHash = __test.getCustomerDashboardLookupHash(email, phone);
  const token = __test.createCustomerDashboardSessionToken({ email, phone });

  assert.equal(lookupHash.length, 32);
  assert.equal(
    __test.getCustomerDashboardSessionLookupHash({
      headers: { cookie: `myaipa_customer_dashboard_session=${token}` },
    }),
    lookupHash
  );

  const tamperedToken = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;
  assert.equal(
    __test.getCustomerDashboardSessionLookupHash({
      headers: { cookie: `myaipa_customer_dashboard_session=${tamperedToken}` },
    }),
    ""
  );

  const unauthenticated = await request("/api/customer/dashboard");
  assert.equal(unauthenticated.status, 401);
  assert.match((await unauthenticated.json()).error, /session has expired/i);
});

test("customer dashboard logout clears its HttpOnly session cookie", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const response = await request("/api/customer/dashboard/logout", { method: "POST" });
    assert.equal(response.status, 204);
    const cookie = response.headers.get("set-cookie") || "";
    assert.match(cookie, /myaipa_customer_dashboard_session=/i);
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /Secure/i);
    assert.match(cookie, /SameSite=Lax/i);
    assert.match(cookie, /Max-Age=0/i);
  } finally {
    process.env.NODE_ENV = previousNodeEnv;
  }
});

test("customer dashboard one-time codes expire, limit guesses, and cannot be reused", () => {
  const firstLookup = "a".repeat(32);
  const firstCode = __test.createCustomerDashboardLoginCode(firstLookup, 1000);
  assert.match(firstCode, /^\d{6}$/);
  assert.deepEqual(__test.verifyCustomerDashboardLoginCode(firstLookup, firstCode, 1001), { ok: true });
  assert.equal(__test.verifyCustomerDashboardLoginCode(firstLookup, firstCode, 1002).ok, false);

  const expiredLookup = "b".repeat(32);
  const expiredCode = __test.createCustomerDashboardLoginCode(expiredLookup, 1000);
  assert.equal(__test.verifyCustomerDashboardLoginCode(expiredLookup, expiredCode, 1000 + 10 * 60 * 1000 + 1).reason, "expired");

  const limitedLookup = "c".repeat(32);
  const limitedCode = __test.createCustomerDashboardLoginCode(limitedLookup, 1000);
  const wrongCode = limitedCode === "999999" ? "888888" : "999999";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.equal(__test.verifyCustomerDashboardLoginCode(limitedLookup, wrongCode, 1001 + attempt).ok, false);
  }
  assert.equal(__test.verifyCustomerDashboardLoginCode(limitedLookup, limitedCode, 1010).reason, "attempts");
});

test("customer call payload hides secrets and only exposes consent-backed recordings", () => {
  const baseCall = {
    id: 42,
    startedAt: new Date(),
    durationSec: 75,
    status: "COMPLETED",
    outcome: "FOLLOW_UP",
    transcript: "Caller: I need a quote.",
    transcriptExpiresAt: new Date(Date.now() + 60_000),
    recordingUrl: "https://example.com/recording.mp3",
    recordingExpiresAt: new Date(Date.now() + 60_000),
    structuredData: {
      service: "Electrical repair",
      apiKey: "must-not-leak",
      nested: { address: "23 Robb Street", authorization: "must-not-leak" },
    },
    artifactMetrics: { turnLatencyAverage: 0.7 },
    caller: { name: "Brian", phone: "+19055550123" },
    leadHandoffs: [],
  };

  const withoutConsent = __test.sanitizeCustomerCall(baseCall);
  assert.equal(withoutConsent.recordingAvailable, false);
  assert.equal(withoutConsent.recordingPath, "");
  assert.equal(withoutConsent.details.service, "Electrical repair");
  assert.equal(withoutConsent.details.apiKey, undefined);
  assert.equal(withoutConsent.details.nested.authorization, undefined);

  const withConsent = __test.sanitizeCustomerCall({
    ...baseCall,
    recordingConsentType: "verbal",
    recordingConsentGrantedAt: new Date(),
  });
  assert.equal(withConsent.recordingAvailable, true);
  assert.equal(withConsent.recordingPath, "/api/customer/dashboard/calls/42/recording");
  assert.equal(Object.hasOwn(withConsent, "recordingUrl"), false);
  assert.equal(Object.hasOwn(withConsent, "providerLogUrl"), false);
  assert.equal(Object.hasOwn(withConsent, "totalInternalCost"), false);
});

test("legacy direct customer dashboard login is disabled in favour of SMS verification", async () => {
  const response = await request("/api/customer/dashboard", {
    method: "POST",
    body: { email: "owner@example.com", phone: "9055550123" },
  });
  assert.equal(response.status, 426);
  assert.match((await response.json()).error, /one-time code/i);
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
