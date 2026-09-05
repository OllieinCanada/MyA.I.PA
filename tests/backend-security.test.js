const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");

process.env.NODE_ENV = "test";
process.env.INTEGRATION_API_KEY = "test-integration-key-42";
process.env.VAPI_WEBHOOK_SECRET = "test-vapi-webhook-secret-42";
process.env.MAKE_SIGNUP_WEBHOOK_API_KEY = "test-make-signup-key-42";
process.env.MAKE_SIGNUP_WEBHOOK_URL = "https://hook.us2.make.com/test-private-webhook-token-42";
process.env.TWILIO_ACCOUNT_SID = "ACtestaccountsid";
process.env.TWILIO_AUTH_TOKEN = "test-twilio-auth-token";
process.env.TWILIO_STATUS_CALLBACK_URL = "https://api.myaipa.ca/api/webhooks/twilio/message-status";
process.env.SMS_SUPPRESSION_API_KEY = "test-suppression-api-key-42";
process.env.ADMIN_PASSWORD = "test-admin-password-42";
process.env.ADMIN_SESSION_SECRET = "test-admin-session-secret-42";
process.env.MONITOR_API_KEY = "test-monitor-api-key-42";
process.env.TRIAL_REMINDER_DISABLE = "true";
process.env.VAPI_AUTO_SYNC_ENABLED = "false";
process.env.VAPI_VOICE_SIGNUP_PHONE = "+12495033301";
process.env.VAPI_VOICE_SIGNUP_SMS_FROM = "+12495033301";
process.env.VAPI_VOICE_SIGNUP_PHONE_NUMBER_ID = "test-signup-phone-id";
process.env.VAPI_VOICE_SIGNUP_ASSISTANT_ID = "test-signup-assistant-id";
// Keep this suite deterministic even when a developer has added a real Vapi
// credential to .env.local. The authentication tests below intentionally
// verify the missing-credential failure path and must never reach Vapi.
process.env.VAPI_API_KEY = "";
process.env.MISSED_CALL_ALERT_ENABLED = "false";
process.env.DAILY_DIGEST_ENABLED = "false";

const { app, __test } = require("../server/index");
const { prisma } = require("../server/prisma");
const { getTwilioSignature } = require("../server/smsSuppression");

__test.setPublicNetworkStatsLoaderForTests(async () => ({
  callsAnswered: 12,
  followUpOpportunities: 8,
}));

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

test("agent route verification preserves the protected trial gate instead of attaching directly", async () => {
  const signup = {
    ownerEmail: "owner@example.com",
    businessId: 7,
    twilioPhoneNumber: "+12895550123",
    vapiPhoneNumberId: "phone-123",
    vapiAssistantId: "assistant-123",
  };
  const requests = [];
  const result = await __test.ensureSignupAgentRoute({
    signup,
    business: { id: 7 },
    vapiPhone: { id: "phone-123", number: "+12895550123" },
  }, {
    requestResource: async (resource, options = {}) => {
      requests.push({ resource, method: options.method || "GET" });
      if (resource.startsWith("assistant/")) return { id: "assistant-123" };
      return {
        id: "phone-123",
        number: "+12895550123",
        server: { url: "https://api.myaipa.ca/api/webhooks/voice" },
      };
    },
    readGate: async () => ({
      status: "active",
      businessId: 7,
      phoneNumberId: "phone-123",
      phoneNumber: "+12895550123",
      assistantId: "assistant-123",
    }),
  });
  assert.equal(result.assessment.mode, "trial-gate");
  assert.equal(result.repaired, false);
  assert.equal(requests.some((item) => item.method === "PATCH"), false);
});

test("agent route verification attaches only an empty phone and proves the read-back", async () => {
  let attached = false;
  const result = await __test.ensureSignupAgentRoute({
    signup: {
      ownerEmail: "owner@example.com",
      businessId: 7,
      twilioPhoneNumber: "+12895550123",
      vapiPhoneNumberId: "phone-123",
      vapiAssistantId: "assistant-123",
    },
    business: { id: 7 },
    vapiPhone: { id: "phone-123", number: "+12895550123" },
  }, {
    requestResource: async (resource, options = {}) => {
      if (resource.startsWith("assistant/")) return { id: "assistant-123" };
      if (options.method === "PATCH") {
        assert.deepEqual(options.body, { assistantId: "assistant-123" });
        attached = true;
      }
      return { id: "phone-123", number: "+12895550123", ...(attached ? { assistantId: "assistant-123" } : {}) };
    },
    readGate: async () => null,
  });
  assert.equal(result.assessment.mode, "direct");
  assert.equal(result.repaired, true);
});

test("agent route verification refuses to overwrite another assistant", async () => {
  await assert.rejects(() => __test.ensureSignupAgentRoute({
    signup: {
      ownerEmail: "owner@example.com",
      businessId: 7,
      twilioPhoneNumber: "+12895550123",
      vapiPhoneNumberId: "phone-123",
      vapiAssistantId: "assistant-123",
    },
    business: { id: 7 },
    vapiPhone: { id: "phone-123", number: "+12895550123" },
  }, {
    requestResource: async (resource) => resource.startsWith("assistant/")
      ? { id: "assistant-123" }
      : { id: "phone-123", number: "+12895550123", assistantId: "another-assistant" },
    readGate: async () => null,
  }), (error) => error.code === "AGENT_PHONE_ASSISTANT_CONFLICT" && error.statusCode === 409);
});

test("signup recovery diagnostics reveal provider state without customer data", () => {
  const diagnostics = __test.getSignupProviderRecoveryDiagnostics({
    signup: { twilioPhoneNumber: "+1 (905) 555-0123", ownerEmail: "private@example.com" },
    pendingSignup: ["secret-token-hash", { payload: { owner: { email: "private@example.com" } } }],
    vapiNumbers: [{ number: "+19055550123", assistantId: "assistant-private-id" }],
    twilioNumbers: [{ phone_number: "+19055550123", friendly_name: "Private customer" }],
    providerLookup: "complete",
  });

  assert.deepEqual(diagnostics, {
    retryPayloadAvailable: true,
    providerLookup: "complete",
    assignedPhoneKnownToTwilio: true,
    assignedPhoneKnownToVapi: true,
    vapiAssistantAssigned: true,
  });
  assert.equal(JSON.stringify(diagnostics).includes("private@example.com"), false);
  assert.equal(JSON.stringify(diagnostics).includes("9055550123"), false);
  assert.equal(JSON.stringify(diagnostics).includes("assistant-private-id"), false);
});

test("recoverable verified voice signup can be rebuilt only from its matching Vapi tool call", () => {
  const signup = {
    vapiCallId: "call_voice_recovery",
    status: "setup_error",
    emailVerified: true,
    emailVerifiedAt: "2026-08-20T12:00:00.000Z",
    signedUpAt: "2026-08-20T11:00:00.000Z",
    ownerEmail: "owner@example.com",
    ownerPhone: "+19055550123",
    businessName: "Verified Voice Plumbing",
  };
  const parameters = {
    ownerName: "Owner Example",
    ownerEmail: "owner@example.com",
    ownerPhone: "905-555-0123",
    businessName: "Verified Voice Plumbing",
    businessPhone: "905-555-0123",
    streetAddress: "23 Robb Street",
    city: "Hamilton",
    province: "ON",
    postalCode: "L8P 1A1",
    businessType: "Plumbing",
    serviceArea: "Hamilton",
    services: "Residential plumbing service",
    callerConfirmed: true,
    confirmationText: "Yes, those details are correct.",
  };
  const call = {
    artifact: {
      messages: [{
        toolCalls: [{ function: { name: "begin_myaipa_signup", arguments: JSON.stringify(parameters) } }],
      }],
    },
  };

  assert.deepEqual(__test.getVoiceSignupToolArguments(call), parameters);
  const recovered = __test.buildRecoveredVoiceSignupPayload(signup, call);
  assert.equal(recovered.verification.emailVerified, true);
  assert.equal(recovered.security.emailVerificationCompleted, true);
  assert.equal(recovered.source.callId, signup.vapiCallId);
  assert.equal(recovered.business.name, signup.businessName);

  for (const status of ["setup_error", "provisioning_failed", "provisioning_pending", "provisioning_unknown", "manual_review_reopened"]) {
    assert.equal(__test.isRecoverableVoiceSignupStatus(status), true);
    assert.ok(__test.buildRecoveredVoiceSignupPayload({ ...signup, status }, call));
  }
  assert.equal(__test.isRecoverableVoiceSignupStatus("setup_ready"), false);
  assert.equal(__test.buildRecoveredVoiceSignupPayload({ ...signup, status: "setup_ready" }, call), null);

  assert.throws(
    () => __test.buildRecoveredVoiceSignupPayload({ ...signup, ownerEmail: "different@example.com" }, call),
    /does not match/i
  );
});

test("assistant phone reconciliation requires one Vapi match also owned in Twilio", () => {
  const match = { id: "phone_1", number: "+19055550123", assistantId: "assistant_1" };
  assert.equal(__test.findUniqueVapiPhoneForAssistant(
    [match],
    "assistant_1",
    [{ phone_number: "+1 (905) 555-0123" }]
  ), match);
  assert.equal(__test.findUniqueVapiPhoneForAssistant(
    [match, { ...match, id: "phone_2" }],
    "assistant_1",
    [{ phone_number: "+19055550123" }]
  ), null);
  assert.equal(__test.findUniqueVapiPhoneForAssistant([match], "assistant_1", []), null);
});

test("only an unmistakable paused synthetic pricing signup can use the test archive path", () => {
  const signup = {
    businessName: "Codex Pricing Test 20260712005206",
    ownerEmail: "codex-test@example.com",
    subscriptionStatus: "paused",
  };
  const diagnostics = {
    providerLookup: "complete",
    assignedPhoneKnownToTwilio: false,
    assignedPhoneKnownToVapi: false,
  };
  assert.equal(__test.isSyntheticPausedTestSignupArchiveEligible({ signup, diagnostics }), true);
  assert.equal(__test.isSyntheticPausedTestSignupArchiveEligible({
    signup: { ...signup, ownerEmail: "real-customer@example.org" },
    diagnostics,
  }), false);
  assert.equal(__test.isSyntheticPausedTestSignupArchiveEligible({
    signup: { ...signup, subscriptionStatus: "trialing" },
    diagnostics,
  }), false);
  assert.equal(__test.isSyntheticPausedTestSignupArchiveEligible({
    signup,
    diagnostics: { ...diagnostics, assignedPhoneKnownToTwilio: true },
  }), false);
});

test("only an expired disposable-email sandbox review can use the sandbox archive path", () => {
  const now = new Date("2026-08-21T12:00:00.000Z");
  const signup = {
    businessName: "My AI PA Sandbox Verification 1785262220141",
    ownerEmail: "myaipa-sandbox@mailinator.com",
    status: "review_required",
    reviewReasons: ["disposable_email"],
    updatedAt: "2026-07-28T12:00:00.000Z",
  };
  assert.equal(__test.isExpiredSyntheticSandboxReviewArchiveEligible({ signup, now }), true);
  assert.equal(__test.isExpiredSyntheticSandboxReviewArchiveEligible({
    signup: { ...signup, businessName: "Real Plumbing Company" },
    now,
  }), false);
  assert.equal(__test.isExpiredSyntheticSandboxReviewArchiveEligible({
    signup: { ...signup, subscriptionId: "sub_real" },
    now,
  }), false);
  assert.equal(__test.isExpiredSyntheticSandboxReviewArchiveEligible({
    signup: { ...signup, updatedAt: "2026-08-20T12:00:00.000Z" },
    now,
  }), false);
});

test("reading trial reminders preserves provisioning state and timestamps", () => {
  const dashboard = {
    "email:owner@example.com": {
      ownerEmail: "owner@example.com",
      subscriptionId: "sub_test",
      status: "setup_error",
      makeError: "private upstream detail",
      updatedAt: "2026-08-01T12:00:00.000Z",
    },
  };
  const merged = __test.mergeSignupDashboardWithTrialReminders(dashboard, {
    sub_test: {
      subscriptionId: "sub_test",
      ownerEmail: "owner@example.com",
      status: "scheduled",
      dueAt: "2026-08-28T12:00:00.000Z",
    },
  });

  assert.equal(merged["email:owner@example.com"].status, "setup_error");
  assert.equal(merged["email:owner@example.com"].updatedAt, "2026-08-01T12:00:00.000Z");
  assert.equal(dashboard["email:owner@example.com"].trialReminderStatus, undefined);
});

test("only old unverified signups absent from both providers can be archived", () => {
  const now = new Date("2026-08-20T12:00:00.000Z");
  const stale = {
    status: "setup_started",
    twilioPhoneNumber: "+19055550123",
    updatedAt: "2026-08-01T12:00:00.000Z",
  };
  const absent = {
    providerLookup: "complete",
    assignedPhoneKnownToTwilio: false,
    assignedPhoneKnownToVapi: false,
  };

  assert.equal(__test.isStaleSignupArchiveEligible({ signup: stale, diagnostics: absent, now }), true);
  assert.equal(__test.isStaleSignupArchiveEligible({
    signup: { ...stale, emailVerified: true },
    diagnostics: absent,
    now,
  }), false);
  assert.equal(__test.isStaleSignupArchiveEligible({
    signup: stale,
    diagnostics: { ...absent, assignedPhoneKnownToTwilio: true },
    now,
  }), false);
  assert.equal(__test.isStaleSignupArchiveEligible({
    signup: { ...stale, subscriptionId: "sub_private" },
    diagnostics: absent,
    now,
  }), false);
});

test("signup recovery requires the monitor key and explicit confirmation", async () => {
  const unauthorized = await request("/api/internal/operations/recover-signup", {
    method: "POST",
    body: { targetId: "1234567890abcdef12345678", confirmation: "RECOVER_SIGNUP" },
  });
  assert.equal(unauthorized.status, 401);

  const unconfirmed = await request("/api/internal/operations/recover-signup", {
    method: "POST",
    headers: { "x-monitor-api-key": process.env.MONITOR_API_KEY },
    body: { targetId: "1234567890abcdef12345678" },
  });
  assert.equal(unconfirmed.status, 400);
  assert.match((await unconfirmed.json()).error, /confirmation/i);
});

test("duplicate signup supersession requires the monitor key and explicit confirmation", async () => {
  const unauthorized = await request("/api/internal/operations/supersede-signup", {
    method: "POST",
    body: {
      targetId: "1234567890abcdef12345678",
      canonicalTargetId: "abcdef1234567890abcdef12",
      confirmation: "SUPERSEDE_DUPLICATE_SIGNUP",
    },
  });
  assert.equal(unauthorized.status, 401);

  const unconfirmed = await request("/api/internal/operations/supersede-signup", {
    method: "POST",
    headers: { "x-monitor-api-key": process.env.MONITOR_API_KEY },
    body: {
      targetId: "1234567890abcdef12345678",
      canonicalTargetId: "abcdef1234567890abcdef12",
    },
  });
  assert.equal(unconfirmed.status, 400);
  assert.match((await unconfirmed.json()).error, /confirmation/i);
});

test("duplicate signup supersession is resource-free, auditable, and redacted", () => {
  const duplicateSignup = {
    status: "setup_error",
    ownerEmail: "wrong-address@example.com",
    ownerPhone: "+1 (905) 555-0123",
    businessName: "Example Electrical",
    signupAttemptId: "attempt_duplicate",
    makeError: "private upstream failure",
  };
  const canonicalSignup = {
    status: "setup_error",
    ownerEmail: "correct-address@example.com",
    ownerPhone: "+19055550123",
    businessName: "  Example   Electrical ",
  };
  assert.deepEqual(
    __test.validateSignupSupersession({ duplicateSignup, canonicalSignup }),
    { sharedPhone: true, sameBusiness: true }
  );

  const pendingStore = {
    duplicateTokenHash: {
      ownerEmail: duplicateSignup.ownerEmail,
      businessName: duplicateSignup.businessName,
      payload: {
        submittedAt: "2026-08-25T21:03:13.616Z",
        owner: { email: duplicateSignup.ownerEmail },
        business: { name: duplicateSignup.businessName },
      },
    },
    canonicalTokenHash: {
      ownerEmail: canonicalSignup.ownerEmail,
      businessName: canonicalSignup.businessName,
      payload: {
        owner: { email: canonicalSignup.ownerEmail },
        business: { name: canonicalSignup.businessName },
      },
    },
  };
  duplicateSignup.signupAttemptId = require("../server/makeSignupWebhook")
    .buildMakeSignupEventKey(pendingStore.duplicateTokenHash.payload);
  const disabled = __test.disablePendingSignupAttemptsForRecord(duplicateSignup, pendingStore);
  assert.equal(disabled.disabled, 1);
  assert.equal(disabled.store.duplicateTokenHash, undefined);
  assert.ok(disabled.store.canonicalTokenHash);

  const canonicalTargetId = "abcdef1234567890abcdef12";
  const record = __test.buildSupersededSignupRecord({
    signup: duplicateSignup,
    canonicalTargetId,
    pendingAttemptsDisabled: disabled.disabled,
    now: new Date("2026-08-28T12:00:00.000Z"),
  });
  assert.equal(record.status, "superseded_duplicate");
  assert.equal(record.supersededByTargetId, canonicalTargetId);
  assert.equal(record.supersessionAudit.resourcesProvisioned, false);
  assert.equal(record.supersessionAudit.pendingAttemptsDisabled, 1);

  const safeResult = __test.buildSafeSignupSupersessionResult({
    targetId: "1234567890abcdef12345678",
    canonicalTargetId,
    pendingAttemptsDisabled: 1,
  });
  const serialized = JSON.stringify(safeResult);
  assert.equal(safeResult.resourcesProvisioned, false);
  assert.equal(serialized.includes("wrong-address@example.com"), false);
  assert.equal(serialized.includes("9055550123"), false);
  assert.equal(serialized.includes("private upstream failure"), false);
});

test("duplicate signup supersession fails closed for mismatches, resources, and in-flight attempts", () => {
  const base = {
    status: "setup_error",
    ownerPhone: "+19055550123",
    businessName: "Example Electrical",
  };
  assert.throws(
    () => __test.validateSignupSupersession({
      duplicateSignup: base,
      canonicalSignup: { ...base, ownerPhone: "+12895550123" },
    }),
    (error) => error.code === "SIGNUP_DUPLICATE_IDENTITY_MISMATCH" && error.statusCode === 409
  );
  assert.throws(
    () => __test.validateSignupSupersession({
      duplicateSignup: { ...base, twilioPhoneNumber: "+19055550199" },
      canonicalSignup: base,
    }),
    (error) => error.code === "SIGNUP_RESOURCES_REQUIRE_REVIEW" && error.statusCode === 409
  );
  assert.throws(
    () => __test.disablePendingSignupAttemptsForRecord(
      { ...base, ownerEmail: "owner@example.com" },
      {
        pending: {
          ownerEmail: "owner@example.com",
          businessName: base.businessName,
          claimedAt: Date.now(),
          payload: { owner: { email: "owner@example.com" }, business: { name: base.businessName } },
        },
      }
    ),
    (error) => error.code === "SIGNUP_ATTEMPT_BUSY" && error.statusCode === 409
  );
});

test("production Telegram test requires the monitor key and explicit confirmation", async () => {
  const unauthorized = await request("/api/internal/operations/telegram-test", {
    method: "POST",
    body: { confirmation: "SEND_TELEGRAM_TEST" },
  });
  assert.equal(unauthorized.status, 401);

  const unconfirmed = await request("/api/internal/operations/telegram-test", {
    method: "POST",
    headers: { "x-monitor-api-key": process.env.MONITOR_API_KEY },
    body: {},
  });
  assert.equal(unconfirmed.status, 400);
  assert.match((await unconfirmed.json()).error, /confirmation/i);
});

test("incident repair results require authentication, exact job outcomes, and an active generation", async () => {
  const base = {
    confirmation: "REPORT_INCIDENT_REPAIR_RESULT",
    incident_id: "abcdef1234567890abcdef12",
    generation: 1,
    status: "repair_ready",
    draft_result: "success",
    verify_result: "success",
    publish_result: "success",
    base_sha: "a".repeat(40),
    pr_url: "https://github.com/OllieinCanada/MyA.I.PA/pull/123",
    run_url: "https://github.com/OllieinCanada/MyA.I.PA/actions/runs/456",
  };
  const unauthorized = await request("/api/internal/operations/incident-repair-result", {
    method: "POST",
    body: base,
  });
  assert.equal(unauthorized.status, 401);

  const mismatchedSuccess = await request("/api/internal/operations/incident-repair-result", {
    method: "POST",
    headers: { "x-monitor-api-key": process.env.MONITOR_API_KEY },
    body: { ...base, verify_result: "failure" },
  });
  assert.equal(mismatchedSuccess.status, 400);

  const inventedPullOnFailure = await request("/api/internal/operations/incident-repair-result", {
    method: "POST",
    headers: { "x-monitor-api-key": process.env.MONITOR_API_KEY },
    body: { ...base, status: "needs_user", verify_result: "failure" },
  });
  assert.equal(inventedPullOnFailure.status, 400);

  const missingIncident = await request("/api/internal/operations/incident-repair-result", {
    method: "POST",
    headers: { "x-monitor-api-key": process.env.MONITOR_API_KEY },
    body: base,
  });
  assert.equal(missingIncident.status, 409);
});

test("incident remediation canary requires the monitor key and explicit confirmation", async () => {
  const unauthorized = await request("/api/internal/operations/incident-remediation-canary", {
    method: "POST",
    body: { confirmation: "RUN_INCIDENT_REMEDIATION_CANARY" },
  });
  assert.equal(unauthorized.status, 401);

  const unconfirmed = await request("/api/internal/operations/incident-remediation-canary", {
    method: "POST",
    headers: { "x-monitor-api-key": process.env.MONITOR_API_KEY },
    body: {},
  });
  assert.equal(unconfirmed.status, 400);

  const unauthorizedStatus = await request("/api/internal/operations/incident-remediation-canary/status", {
    method: "POST",
    body: {
      confirmation: "CHECK_INCIDENT_REMEDIATION_CANARY",
      incidentId: "abcdef1234567890abcdef12",
    },
  });
  assert.equal(unauthorizedStatus.status, 401);

  const unconfirmedStatus = await request("/api/internal/operations/incident-remediation-canary/status", {
    method: "POST",
    headers: { "x-monitor-api-key": process.env.MONITOR_API_KEY },
    body: { incidentId: "abcdef1234567890abcdef12" },
  });
  assert.equal(unconfirmedStatus.status, 400);
});

test("incident remediation canary status exposes only receipt-backed lifecycle proof", () => {
  const incidentId = "abcdef1234567890abcdef12";
  const initialOutboxId = "111111111111111111111111";
  const completionOutboxId = "222222222222222222222222";
  const receipts = new Map([
    [initialOutboxId, { id: initialOutboxId, deliveredAt: 1000, providerMessageId: 91 }],
    [completionOutboxId, { id: completionOutboxId, deliveredAt: 1001, providerMessageId: 92 }],
  ]);
  const status = __test.getIncidentRemediationCanaryStatus(incidentId, [{
    id: incidentId,
    incident: { reasonCode: "CONTROLLED_READINESS_REMEDIATION_TEST" },
    snapshot: { "Controlled canary": "Yes", Business: "must not be returned" },
    remediation: {
      action: "readiness_probe",
      status: "recovered",
      initialReportDelivery: "sent",
      completionReportDelivery: "sent",
      initialReportOutboxId: initialOutboxId,
      completionReportOutboxId: completionOutboxId,
      actionTaken: "private detail",
    },
  }], (outboxId) => receipts.get(outboxId) || null);
  assert.deepEqual(status, {
    ok: true,
    controlledCanary: true,
    lifecycleComplete: true,
    initialReportDelivered: true,
    completionReportDelivered: true,
    deliveryReceiptsConfirmed: true,
    deliveryReceiptCount: 2,
    deliverySequenceConfirmed: true,
    remediationTerminal: true,
    remediationStatus: "recovered",
    readOnlyReadinessVerified: true,
    customerDataIncluded: false,
    providerResourcesChanged: false,
    originalCustomerOperationReplayed: false,
  });
  const serializedStatus = JSON.stringify(status);
  assert.equal(serializedStatus.includes("must not be returned"), false);
  assert.equal(serializedStatus.includes(incidentId), false);
  assert.doesNotMatch(serializedStatus, /incidentId|outbox|messageId|deliveredAt|snapshot|business/i);

  const pending = __test.getIncidentRemediationCanaryStatus(incidentId, [{
    id: incidentId,
    incident: { reasonCode: "CONTROLLED_READINESS_REMEDIATION_TEST" },
    snapshot: { "Controlled canary": "Yes" },
    remediation: {
      action: "readiness_probe",
      status: "verifying",
      initialReportDelivery: "sent",
      completionReportDelivery: "queued",
      initialReportOutboxId: initialOutboxId,
      completionReportOutboxId: completionOutboxId,
    },
  }], (outboxId) => receipts.get(outboxId) || null);
  assert.equal(pending.lifecycleComplete, false);
  assert.equal(pending.deliveryReceiptsConfirmed, false);
  assert.equal(pending.deliveryReceiptCount, 2);
  assert.equal(pending.readOnlyReadinessVerified, false);

  const forgedState = __test.getIncidentRemediationCanaryStatus(incidentId, [{
    id: incidentId,
    incident: { reasonCode: "CONTROLLED_READINESS_REMEDIATION_TEST" },
    snapshot: { "Controlled canary": "Yes" },
    remediation: {
      action: "readiness_probe",
      status: "recovered",
      initialReportDelivery: "sent",
      completionReportDelivery: "sent",
      initialReportOutboxId: initialOutboxId,
      completionReportOutboxId: completionOutboxId,
    },
  }], () => null);
  assert.equal(forgedState.lifecycleComplete, false);
  assert.equal(forgedState.deliveryReceiptsConfirmed, false);
  assert.equal(forgedState.deliveryReceiptCount, 0);

  const reversedReceipts = new Map([
    [initialOutboxId, { deliveredAt: 1002, providerMessageId: 91 }],
    [completionOutboxId, { deliveredAt: 1001, providerMessageId: 92 }],
  ]);
  const reversed = __test.getIncidentRemediationCanaryStatus(incidentId, [{
    id: incidentId,
    incident: { reasonCode: "CONTROLLED_READINESS_REMEDIATION_TEST" },
    snapshot: { "Controlled canary": "Yes" },
    remediation: {
      action: "readiness_probe",
      status: "recovered",
      initialReportDelivery: "sent",
      completionReportDelivery: "sent",
      initialReportOutboxId: initialOutboxId,
      completionReportOutboxId: completionOutboxId,
    },
  }], (outboxId) => reversedReceipts.get(outboxId) || null);
  assert.equal(reversed.deliverySequenceConfirmed, false);
  assert.equal(reversed.lifecycleComplete, false);

  const duplicateOutboxMessage = __test.getIncidentRemediationCanaryStatus(incidentId, [{
    id: incidentId,
    incident: { reasonCode: "CONTROLLED_READINESS_REMEDIATION_TEST" },
    snapshot: { "Controlled canary": "Yes" },
    remediation: {
      action: "readiness_probe",
      status: "recovered",
      initialReportDelivery: "sent",
      completionReportDelivery: "sent",
      initialReportOutboxId: initialOutboxId,
      completionReportOutboxId: initialOutboxId,
    },
  }], (outboxId) => receipts.get(outboxId) || null);
  assert.equal(duplicateOutboxMessage.deliveryReceiptCount, 0);
  assert.equal(duplicateOutboxMessage.lifecycleComplete, false);

  const unrelated = __test.getIncidentRemediationCanaryStatus(incidentId, [{
    id: incidentId,
    incident: { reasonCode: "PROVIDER_ACCOUNT_FUNDING_REQUIRED" },
    snapshot: { "Controlled canary": "Yes" },
    remediation: { action: "readiness_probe", status: "recovered" },
  }]);
  assert.equal(unrelated, null);
});

test("production provisioning canary requires the monitor key and explicit confirmation", async () => {
  const unauthorized = await request("/api/internal/operations/provisioning-canary", {
    method: "POST",
    body: { confirmation: "RUN_PROVISIONING_CANARY" },
  });
  assert.equal(unauthorized.status, 401);

  const unconfirmed = await request("/api/internal/operations/provisioning-canary", {
    method: "POST",
    headers: { "x-monitor-api-key": process.env.MONITOR_API_KEY },
    body: {},
  });
  assert.equal(unconfirmed.status, 400);
  assert.match((await unconfirmed.json()).error, /confirmation/i);
});

test("public call network stats expose aggregate counts without customer details", async () => {
  const response = await request("/api/public/signup-network-stats");
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(Object.keys(payload).sort(), ["callsAnswered", "followUpOpportunities", "ok", "updatedAt"]);
  assert.equal(payload.ok, true);
  assert.equal(payload.callsAnswered, 12);
  assert.equal(payload.followUpOpportunities, 8);
  assert.equal(Number.isNaN(Date.parse(payload.updatedAt)), false);
  assert.equal(JSON.stringify(payload).includes("ownerEmail"), false);
  assert.equal(JSON.stringify(payload).includes("ownerPhone"), false);
  assert.equal(JSON.stringify(payload).includes("businessName"), false);
});

test("signup verification rejects forged channel claims and has an independent public rate limit", async () => {
  const forgedPath = "/api/integrations/verify-signup-email?token=missing&channel=sms&channelProof=forged";
  for (let index = 0; index < 20; index += 1) {
    const response = await request(forgedPath);
    assert.equal(response.status, 400);
    assert.match(await response.text(), /invalid or expired/i);
  }

  const blocked = await request(forgedPath);
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get("retry-after")) >= 1);

  const unrelatedPublicRoute = await request("/api/public/signup-network-stats");
  assert.equal(unrelatedPublicRoute.status, 200);
});

test("call network stats return live business outcomes with a stable timestamp", async () => {
  const stats = await __test.getPublicSignupNetworkStats(
    new Date("2026-08-20T12:00:00.000Z"),
    async () => ({ callsAnswered: 37, followUpOpportunities: 24 })
  );
  assert.deepEqual(stats, {
    callsAnswered: 37,
    followUpOpportunities: 24,
    updatedAt: "2026-08-20T12:00:00.000Z",
  });
});

test("the public Vapi preview configuration never falls back to the private key", async () => {
  const response = await request("/api/public/vapi-preview-config");
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.enabled, false);
  assert.equal(payload.assistantId, "");
  assert.equal(payload.maxDurationSeconds, 60);
  assert.equal(payload.maxConcurrentCalls, 2);
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

test("Twilio delivery callbacks verify against the exact configured status URL", async () => {
  const form = {
    MessageSid: "SM_DELIVERED_TEST",
    MessageStatus: "delivered",
  };
  const response = await request("/api/webhooks/twilio/message-status", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": getTwilioSignature(
        process.env.TWILIO_STATUS_CALLBACK_URL,
        form,
        process.env.TWILIO_AUTH_TOKEN
      ),
    },
    body: new URLSearchParams(form).toString(),
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") || "", /xml/i);
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
    ["/api/admin/attention/actions", "POST"],
    ["/api/admin/support-reports/example", "PATCH"],
    ["/api/admin/support-reports/example/github-issue", "POST"],
    ["/api/admin/support-reports/example/codex-task", "POST"],
    ["/api/admin/outreach/generate", "POST"],
    ["/api/admin/outreach/send-test", "POST"],
    ["/api/admin/outreach/import", "POST"],
    ["/api/admin/signups/run-agent-delivery-test", "POST"],
  ];
  for (const [path, method] of routes) {
    const response = await request(path, { method, body: {} });
    assert.equal(response.status, 401);
  }
});

test("customer scheduling and staff changes require a signed dashboard session", async () => {
  const requests = [
    ["/api/customer/dashboard/agent-test", "POST"],
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

test("voice signup bypasses customer mapping only for the dedicated signup route", () => {
  assert.equal(
    __test.getVapiVoiceSignupExecutionBusinessId({ phoneNumberId: "test-signup-phone-id" }),
    1
  );
  assert.equal(
    __test.getVapiVoiceSignupExecutionBusinessId({ assistantId: "test-signup-assistant-id" }),
    1
  );
  assert.equal(
    __test.getVapiVoiceSignupExecutionBusinessId({ phoneNumber: { number: "+1 (249) 503-3301" } }),
    1
  );
  assert.throws(
    () => __test.getVapiVoiceSignupExecutionBusinessId({
      phoneNumberId: "different-phone-id",
      assistantId: "different-assistant-id",
      phoneNumber: { number: "+1 (249) 315-4508" },
    }),
    /dedicated My AI PA signup line/i
  );
});

test("voice signup texts from the same public number the caller dialed", () => {
  const smsEnv = __test.getVapiVoiceSignupSmsEnvironment({
    TWILIO_FROM_NUMBER: "+12493154508",
    TWILIO_ACCOUNT_SID: "ACtest",
  });
  assert.equal(smsEnv.TWILIO_FROM_NUMBER, "+12495033301");
  assert.equal(smsEnv.TWILIO_ACCOUNT_SID, "ACtest");
});

test("browser crash reports are accepted without echoing sensitive diagnostics", async () => {
  const response = await request("/api/client-errors", {
    method: "POST",
    body: {
      type: "uncaught_error",
      route: "/signup?email=private@example.com",
      message: "Failed for private@example.com +1 905-555-0123 token=private-secret",
      stack: "must never be forwarded",
    },
  });
  assert.equal(response.status, 202);
  const body = await response.json();
  assert.deepEqual(body, { ok: true, accepted: true });
  assert.doesNotMatch(JSON.stringify(body), /private@example\.com|905-555-0123|private-secret|must never/);
});

test("browser error intake collapses untrusted routes and types to safe alert groups", () => {
  assert.equal(__test.normalizeClientErrorType("attacker-controlled-type"), "browser_error");
  assert.equal(__test.normalizeClientErrorType("resource_error"), "resource_error");
  assert.equal(__test.normalizeClientErrorRoute("/signup/private-id?token=secret"), "/signup");
  assert.equal(__test.normalizeClientErrorRoute("/attacker/can/vary/this"), "/");
});

test("voice signup preserves the production manual-approval hold", () => {
  assert.deepEqual(
    __test.getVoiceSignupReviewReasons({ SIGNUP_REQUIRE_MANUAL_APPROVAL: "true" }),
    ["manual_approval_enabled"]
  );
  assert.deepEqual(
    __test.getVoiceSignupReviewReasons({ SIGNUP_REQUIRE_MANUAL_APPROVAL: "false" }),
    []
  );
});

test("signup recovery selects the exact attempt and never matches email to a different business", () => {
  const exactPayload = {
    submittedAt: "2026-08-25T21:03:13.616Z",
    owner: { email: "owner@example.com" },
    business: { name: "Current Electrical" },
  };
  const exactAttemptId = require("../server/makeSignupWebhook").buildMakeSignupEventKey(exactPayload);
  const exactEntry = {
    ownerEmail: "owner@example.com",
    businessName: "Current Electrical",
    payload: exactPayload,
    createdAt: 200,
  };
  const wrongBusinessEntry = {
    ownerEmail: "owner@example.com",
    businessName: "Old Electrical",
    payload: {
      owner: { email: "owner@example.com" },
      business: { name: "Old Electrical" },
    },
    createdAt: 300,
  };

  const exact = __test.findPendingSignupForDashboardRecord(
    { ownerEmail: "owner@example.com", businessName: "Current Electrical", signupAttemptId: exactAttemptId },
    { wrong: wrongBusinessEntry, exact: exactEntry }
  );
  assert.equal(exact?.[0], "exact");

  const mismatch = __test.findPendingSignupForDashboardRecord(
    { ownerEmail: "owner@example.com", businessName: "Different Electrical" },
    { wrong: wrongBusinessEntry }
  );
  assert.equal(mismatch, null);
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

test("Twilio reporting prefers a dedicated API key and safely falls back to the Auth Token", () => {
  const apiKey = __test.resolveTwilioRestAuth({
    TWILIO_ACCOUNT_SID: "AC_account",
    TWILIO_AUTH_TOKEN: "legacy-token",
    TWILIO_API_KEY_SID: "SK_reporting",
    TWILIO_API_KEY_SECRET: "reporting-secret",
  });
  assert.equal(apiKey.configured, true);
  assert.equal(apiKey.mode, "api-key");
  assert.equal(apiKey.username, "SK_reporting");
  assert.equal(apiKey.password, "reporting-secret");

  const fallback = __test.resolveTwilioRestAuth({
    TWILIO_ACCOUNT_SID: "AC_account",
    TWILIO_AUTH_TOKEN: "legacy-token",
  });
  assert.equal(fallback.configured, true);
  assert.equal(fallback.mode, "auth-token");
  assert.equal(fallback.username, "AC_account");

  const incomplete = __test.resolveTwilioRestAuth({
    TWILIO_ACCOUNT_SID: "AC_account",
    TWILIO_API_KEY_SID: "SK_reporting",
  });
  assert.equal(incomplete.configured, false);
  assert.match(incomplete.warning, /incomplete/i);
});

test("Twilio reporting normalizes message prices and avoids double-counting usage parents", () => {
  const message = __test.normalizeTwilioMessage({
    sid: "SM_test",
    from: "+1 (249) 555-0101",
    to: "+1 (905) 555-0102",
    direction: "outbound-api",
    status: "delivered",
    date_sent: "Tue, 28 Jul 2026 12:00:00 +0000",
    num_segments: "2",
    price: "-0.015",
    price_unit: "USD",
  });
  assert.equal(message.from, "+12495550101");
  assert.equal(message.to, "+19055550102");
  assert.equal(message.price, 0.015);
  assert.equal(message.segments, 2);

  assert.equal(__test.getTwilioUsageCostByPrefix({
    records: [
      { category: "phonenumbers", price: 20 },
      { category: "phonenumbers-local", price: 18 },
      { category: "phonenumbers-mobile", price: 2 },
    ],
  }, "phonenumbers"), 20);
  assert.equal(__test.getTwilioUsageCostByPrefix({
    records: [
      { category: "phonenumbers-local", price: 18 },
      { category: "phonenumbers-local-ca", price: 18 },
      { category: "phonenumbers-mobile", price: 2 },
    ],
  }, "phonenumbers"), 20);
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

test("customer support report submission is rate limited independently of suggestions", async () => {
  const lookupHash = "a".repeat(32);
  const now = Date.now();
  for (let index = 0; index < 6; index += 1) {
    assert.equal((await __test.getSupportReportRateLimitDecision(lookupHash, now)).blocked, false);
  }
  const blocked = await __test.getSupportReportRateLimitDecision(lookupHash, now);
  assert.equal(blocked.blocked, true);
  assert.ok(blocked.retryAfterMs > 0);
});

test("customer-submitted support analysis cannot escalate its own severity", () => {
  const fallback = {
    summary: "Needs review",
    likelyCause: "Unknown",
    severity: "LOW",
    suggestions: ["Refresh", "Try again"],
  };
  const analysis = __test.normalizeSubmittedSupportAnalysis({
    summary: "Everything is down",
    likelyCause: "Provider outage",
    severity: "HIGH",
    suggestions: ["Escalate", "Page everyone"],
  }, fallback);
  assert.equal(analysis.severity, "LOW");
});

test("legacy owner SMS results reject missing tenant routing even with integration authentication", async () => {
  const response = await request("/api/integrations/vapi/owner-sms-results", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.INTEGRATION_API_KEY}` },
    body: {
      eventId: "owner-sms-missing-route",
      name: "Synthetic caller",
      callbackNumber: "+19055550123",
      summary: "Synthetic routing test",
    },
  });
  assert.equal(response.status, 422);
  assert.match((await response.json()).error, /trusted businessId or mapped Vapi call context is required/i);
});

test("legacy owner SMS results reject a cross-tenant business and stored-call conflict", async () => {
  const originalFindFirst = prisma.call.findFirst;
  prisma.call.findFirst = async ({ where }) => {
    const matchesSyntheticCall = where?.OR?.some((candidate) => candidate.externalId === "call-owned-by-business-one");
    return matchesSyntheticCall ? { businessId: 1 } : null;
  };
  try {
    const response = await request("/api/integrations/vapi/owner-sms-results", {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.INTEGRATION_API_KEY}` },
      body: {
        eventId: "owner-sms-cross-tenant-route",
        businessId: 2,
        callId: "call-owned-by-business-one",
        name: "Synthetic caller",
        callbackNumber: "+19055550123",
        summary: "Synthetic routing test",
      },
    });
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /resolve to different businesses/i);
  } finally {
    prisma.call.findFirst = originalFindFirst;
  }
});

test("Make signup authentication alone cannot trigger a paid provisioning route", async () => {
  const response = await request("/api/integrations/vapi/import-twilio-number", {
    method: "POST",
    headers: { "x-make-apikey": process.env.MAKE_SIGNUP_WEBHOOK_API_KEY },
    body: {},
  });
  assert.equal(response.status, 401);
  assert.match((await response.json()).error, /signed provisioning request/i);
});

test("a leaked Make webhook token cannot trigger a paid provisioning route", async () => {
  const response = await request("/api/integrations/vapi/import-twilio-number", {
    method: "POST",
    headers: { "x-make-webhook-token": "test-private-webhook-token-42" },
    body: {},
  });
  assert.equal(response.status, 401);
  assert.match((await response.json()).error, /signed provisioning request/i);
});

test("Twilio provisioning reuses only the exact deterministic signup resource", async () => {
  const calls = [];
  const friendlyName = `myaipa-twilio-number-${"a".repeat(20)}`;
  const result = await __test.purchaseTwilioPhoneNumber(
    { areaCode: "249", voiceUrl: "https://hook.us2.make.com/existing-voice-hook", friendlyName },
    {
      fetchImpl: async (url, options = {}) => {
        calls.push({ url: String(url), method: options.method || "GET" });
        return new Response(JSON.stringify({
          incoming_phone_numbers: [{
            sid: "PNexisting",
            phone_number: "+12495550123",
            friendly_name: friendlyName,
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

test("Twilio provisioning never cross-assigns another signup sharing the same voice webhook", async () => {
  const calls = [];
  const friendlyName = `myaipa-twilio-number-${"b".repeat(20)}`;
  const result = await __test.purchaseTwilioPhoneNumber(
    { areaCode: "905", region: "ON", voiceUrl: "https://hook.us2.make.com/shared-voice-hook", friendlyName },
    {
      fetchImpl: async (url, options = {}) => {
        const method = options.method || "GET";
        calls.push({ url: String(url), method, body: String(options.body || "") });
        if (method === "POST") {
          return new Response(JSON.stringify({
            sid: "PNnew",
            phone_number: "+19055550124",
            friendly_name: friendlyName,
            voice_url: "https://hook.us2.make.com/shared-voice-hook",
            voice_method: "POST",
            capabilities: { voice: true, sms: true },
          }), { status: 201, headers: { "content-type": "application/json" } });
        }
        if (String(url).includes("AvailablePhoneNumbers")) {
          return new Response(JSON.stringify({
            available_phone_numbers: [{ phone_number: "+19055550124" }],
          }), { status: 200, headers: { "content-type": "application/json" } });
        }
        return new Response(JSON.stringify({
          incoming_phone_numbers: [{
            sid: "PNother",
            phone_number: "+12495550123",
            friendly_name: `myaipa-twilio-number-${"c".repeat(20)}`,
            voice_url: "https://hook.us2.make.com/shared-voice-hook",
            voice_method: "POST",
            capabilities: { voice: true, sms: true },
          }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      },
    }
  );

  assert.equal(result.twilioPhoneNumber, "+19055550124");
  assert.equal(result.reused, undefined);
  assert.equal(calls.filter((call) => call.method === "POST").length, 1);
  assert.match(calls.find((call) => call.method === "POST").body, new RegExp(`FriendlyName=${friendlyName}`));
});

test("Twilio provisioning does not silently fall back outside a requested local area code", async () => {
  const searches = [];
  const friendlyName = `myaipa-twilio-number-${"e".repeat(20)}`;
  await assert.rejects(
    () => __test.purchaseTwilioPhoneNumber(
      { areaCode: "289", region: "ON", voiceUrl: "https://hook.us2.make.com/local-voice-hook", friendlyName },
      {
        fetchImpl: async (url) => {
          const text = String(url);
          if (text.includes("AvailablePhoneNumbers")) searches.push(text);
          return new Response(JSON.stringify(text.includes("IncomingPhoneNumbers")
            ? { incoming_phone_numbers: [] }
            : { available_phone_numbers: [] }), { status: 200, headers: { "content-type": "application/json" } });
        },
      }
    ),
    (error) => error.code === "LOCAL_CANADIAN_NUMBER_INVENTORY_UNAVAILABLE"
  );

  assert.equal(searches.length, 1);
  assert.match(searches[0], /AreaCode=289/);
  assert.doesNotMatch(searches[0], /InRegion=ON/);
});

test("Twilio provisioning flags an existing deterministic number in the wrong area code", async () => {
  const friendlyName = `myaipa-twilio-number-${"f".repeat(20)}`;
  await assert.rejects(
    () => __test.purchaseTwilioPhoneNumber(
      { areaCode: "289", voiceUrl: "https://hook.us2.make.com/existing-voice-hook", friendlyName },
      {
        fetchImpl: async () => new Response(JSON.stringify({
          incoming_phone_numbers: [{
            sid: "PNwrongarea",
            phone_number: "+13435550123",
            friendly_name: friendlyName,
            voice_url: "https://hook.us2.make.com/existing-voice-hook",
            voice_method: "POST",
            capabilities: { voice: true, sms: true },
          }],
        }), { status: 200, headers: { "content-type": "application/json" } }),
      }
    ),
    (error) => error.code === "PROVISIONED_NUMBER_AREA_CODE_MISMATCH"
  );
});

test("Twilio provisioning preserves safe provider billing evidence without retaining raw provider text", async () => {
  const friendlyName = `myaipa-twilio-number-${"d".repeat(20)}`;
  await assert.rejects(
    () => __test.purchaseTwilioPhoneNumber(
      { voiceUrl: "https://hook.us2.make.com/voice-hook", friendlyName },
      {
        fetchImpl: async () => new Response(JSON.stringify({
          code: "PAYMENT_REQUIRED",
          message: "private customer data must not escape",
        }), { status: 402, headers: { "content-type": "application/json" } }),
      }
    ),
    (error) => {
      assert.equal(error.provider, "twilio");
      assert.equal(error.providerCode, "PAYMENT_REQUIRED");
      assert.equal(error.providerStatus, 402);
      assert.equal(error.upstreamStatus, 402);
      assert.doesNotMatch(error.message, /private customer/i);
      return true;
    }
  );
});

test("SMTP failures retain only a stable category, provider status, and safe message", () => {
  const auth = __test.createSmtpDeliveryError({
    code: "EAUTH",
    responseCode: 535,
    message: "Authentication failed for private@example.com using secret-value",
  }, "signup verification delivery");
  assert.equal(auth.provider, "smtp");
  assert.equal(auth.providerCode, "SMTP_AUTH_FAILED");
  assert.equal(auth.providerStatus, 535);
  assert.doesNotMatch(auth.message, /private@example|secret-value/i);

  const timeout = __test.createSmtpDeliveryError({ code: "ETIMEDOUT" }, "trial reminder delivery");
  assert.equal(timeout.providerCode, "SMTP_TIMEOUT");
});

test("OpenAI response errors preserve safe provider evidence for the Telegram classifier", () => {
  const error = __test.createOpenAiResponseError({
    operation: "assistant response",
    response: { status: 429 },
    data: { error: { code: "insufficient_quota", message: "private@example.com exceeded quota" } },
    userMessage: "AI responses are temporarily unavailable right now.",
  });
  assert.equal(error.statusCode, 502);
  assert.equal(error.provider, "openai");
  assert.equal(error.providerStatus, 429);
  assert.equal(error.upstreamStatus, 429);
  assert.equal(error.providerCode, "INSUFFICIENT_QUOTA");
  assert.doesNotMatch(error.message, /private@example/i);
});

test("isolated signup SMS-routing failures notify immediately without changing the safe failure return", async () => {
  let alert = null;
  const providerError = Object.assign(new Error("Vapi routing failed for private@example.com"), {
    provider: "vapi",
    providerCode: "INSUFFICIENT_BALANCE",
    providerStatus: 402,
  });
  const result = await __test.safelyProvisionIsolatedSmsForSignup({
    ownerEmail: "private@example.com",
    assistantId: "private-assistant-id",
    aiNumber: "+19055550123",
    ownerNumber: "+19055550124",
  }, {
    provision: async () => { throw providerError; },
    notify: (error, context) => { alert = { error, context }; },
  });

  assert.equal(result.failed, true);
  assert.equal(result.reason, "isolated_sms_provisioning_failed");
  assert.equal(alert.error, providerError);
  assert.equal(alert.context.area, "signup SMS routing");
  assert.equal(alert.context.snapshot["AI number supplied"], "Yes");
  assert.equal(alert.context.snapshot["Owner number supplied"], "Yes");
  assert.doesNotMatch(JSON.stringify(alert.context), /private@example|private-assistant-id|9055550123|9055550124/i);
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

test("Vapi lifecycle status updates are handled explicitly before termination", async () => {
  const response = await request("/api/webhooks/voice", {
    method: "POST",
    headers: { "x-vapi-secret": process.env.VAPI_WEBHOOK_SECRET },
    body: { message: { type: "status-update", status: "in-progress", call: { id: "call-lifecycle-test" } } },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, eventType: "status-update", terminal: false });
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

test("customer dashboard treats Canadian local and E.164 phone formats as the same identity", () => {
  const email = "owner@example.com";
  const localPhone = "905-964-7422";
  const internationalPhone = "+1 (905) 964-7422";

  assert.equal(__test.normalizeCustomerDashboardPhone(localPhone), "+19059647422");
  assert.equal(__test.normalizeCustomerDashboardPhone(internationalPhone), "+19059647422");
  assert.equal(__test.customerDashboardPhonesMatch(localPhone, internationalPhone), true);
  assert.equal(
    __test.getCustomerDashboardLookupHash(email, localPhone),
    __test.getCustomerDashboardLookupHash(email.toUpperCase(), internationalPhone)
  );
  assert.equal(__test.customerDashboardPhonesMatch(localPhone, "+1 905-964-7423"), false);
});

test("customer dashboard login-email repairs are exact, idempotent, and prefer the ready account", () => {
  const currentEmail = "firstclassrental99@gmail.com";
  const correctedEmail = "firstclassrentals99@gmail.com";
  const inputStore = {
    "sub:sub_ready": {
      subscriptionId: "sub_ready",
      ownerEmail: currentEmail,
      ownerPhone: "+1 (905) 964-7422",
      status: "setup_ready",
      twilioPhoneNumber: "+12895550123",
    },
  };

  const repaired = __test.planCustomerDashboardLoginEmailRepair(inputStore, {
    subscriptionId: "sub_ready",
    currentEmail,
    newEmail: correctedEmail,
    phone: "905-964-7422",
    now: "2026-09-01T12:00:00.000Z",
  });
  assert.equal(repaired.unchanged, false);
  assert.equal(inputStore["sub:sub_ready"].dashboardLoginEmail, undefined);
  assert.equal(repaired.record.dashboardLoginEmail, correctedEmail);
  assert.deepEqual(__test.getCustomerDashboardEmails(repaired.record), [correctedEmail, currentEmail]);

  const repeated = __test.planCustomerDashboardLoginEmailRepair(repaired.store, {
    subscriptionId: "sub_ready",
    currentEmail,
    newEmail: correctedEmail,
    phone: "+1 905 964 7422",
  });
  assert.equal(repeated.unchanged, true);

  assert.throws(() => __test.planCustomerDashboardLoginEmailRepair(inputStore, {
    subscriptionId: "sub_ready",
    currentEmail,
    newEmail: `${"a".repeat(255)}@example.com`,
    phone: "905-964-7422",
  }), /current email, corrected email, and signup phone are required/i);

  const duplicateRepair = __test.planCustomerDashboardLoginEmailRepair({
    ...inputStore,
    "sub:sub_other": {
      subscriptionId: "sub_other",
      ownerEmail: correctedEmail,
      ownerPhone: "+19059647422",
      status: "review_required",
      updatedAt: "2026-09-02T12:00:00.000Z",
    },
  }, {
    subscriptionId: "sub_ready",
    currentEmail,
    newEmail: correctedEmail,
    phone: "9059647422",
  });
  assert.equal(duplicateRepair.unchanged, false);
  assert.equal(
    __test.sortCustomerDashboardLoginRecords(Object.values(duplicateRepair.store))[0].subscriptionId,
    "sub_ready"
  );
});

test("customer dashboard login repair requires admin authentication", async () => {
  const response = await request("/api/admin/signups/repair-dashboard-login", {
    method: "POST",
    body: {
      confirmation: "REPAIR_CUSTOMER_DASHBOARD_LOGIN",
      subscriptionId: "sub_ready",
      currentEmail: "old@example.com",
      newEmail: "new@example.com",
      phone: "9055550123",
    },
  });
  assert.equal(response.status, 401);
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

test("customer dashboard one-time codes expire, limit guesses, and cannot be reused", async () => {
  const firstLookup = "a".repeat(32);
  const firstCode = await __test.createCustomerDashboardLoginCode(firstLookup, 1000);
  assert.match(firstCode, /^\d{6}$/);
  assert.deepEqual(await __test.verifyCustomerDashboardLoginCode(firstLookup, firstCode, 1001), { ok: true });
  assert.equal((await __test.verifyCustomerDashboardLoginCode(firstLookup, firstCode, 1002)).ok, false);

  const expiredLookup = "b".repeat(32);
  const expiredCode = await __test.createCustomerDashboardLoginCode(expiredLookup, 1000);
  assert.equal((await __test.verifyCustomerDashboardLoginCode(expiredLookup, expiredCode, 1000 + 10 * 60 * 1000 + 1)).reason, "expired");

  const limitedLookup = "c".repeat(32);
  const limitedCode = await __test.createCustomerDashboardLoginCode(limitedLookup, 1000);
  const wrongCode = limitedCode === "999999" ? "888888" : "999999";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.equal((await __test.verifyCustomerDashboardLoginCode(limitedLookup, wrongCode, 1001 + attempt)).ok, false);
  }
  assert.equal((await __test.verifyCustomerDashboardLoginCode(limitedLookup, limitedCode, 1010)).reason, "expired");
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

test("admin routes do not accept the master password from an arbitrary request body", async () => {
  const response = await request("/api/admin/settings", {
    method: "PUT",
    body: { password: process.env.ADMIN_PASSWORD, businessId: 1 },
  });
  assert.equal(response.status, 401);
});

test("rate limits rely on Express's trusted-proxy client address", () => {
  assert.equal(__test.getClientIp({
    ip: "203.0.113.42",
    headers: { "x-forwarded-for": "198.51.100.9" },
    socket: { remoteAddress: "10.0.0.2" },
  }), "203.0.113.42");
});

test("admin login attempts are rate limited", async () => {
  const originalAuditCreate = prisma.runtimeStore.create;
  prisma.runtimeStore.create = async ({ data }) => data;
  const headers = { "x-forwarded-for": "198.51.100.77" };
  try {
    for (let index = 0; index < 10; index += 1) {
      const response = await request("/api/admin/login", {
        method: "POST",
        headers,
        body: { password: `wrong-${index}` },
      });
      assert.equal(response.status, 401);
    }

    const blocked = await request("/api/admin/login", {
      method: "POST",
      headers,
      body: { password: "still-wrong" },
    });
    assert.equal(blocked.status, 429);
  } finally {
    prisma.runtimeStore.create = originalAuditCreate;
  }
});
