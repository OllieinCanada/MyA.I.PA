const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getOperationalAttentionInbox,
  knownProviderReason,
  signupAttentionItems,
  summarizeAttention,
} = require("../server/operationalAttention");

test("persisted Twilio failures retain the expanded exact safe reason set", () => {
  for (const code of ["21265", "21266", "21268", "21608", "30034", "63038"]) {
    const result = knownProviderReason(code);
    assert.equal(result.reasonCode, code);
    assert.ok(result.reason.length > 20);
  }
  assert.equal(knownProviderReason("raw-provider-secret"), null);
});

test("failed and stuck signups become redacted attention items", () => {
  const now = new Date("2026-08-20T12:00:00.000Z");
  const items = signupAttentionItems([
    { ownerEmail: "private@example.com", businessName: "Example Electrical", status: "setup_error", makeError: "upstream failed", updatedAt: "2026-08-20T11:58:00.000Z" },
    { ownerEmail: "stuck@example.com", status: "setup_started", updatedAt: "2026-08-20T09:00:00.000Z" },
  ], now, 60);
  assert.equal(items.length, 2);
  assert.deepEqual(items.map((item) => item.kind).sort(), ["signup_failed", "signup_stuck"]);
  assert.equal(JSON.stringify(items).includes("private@example.com"), false);
  assert.equal(JSON.stringify(items).includes("upstream failed"), false);
  assert.ok(items.every((item) => item.targetId.length === 24));
  assert.equal(items[0].businessName, "Example Electrical");
  assert.equal(items[0].incident.reasonCode, "SIGNUP_SETUP_FAILED");
  assert.ok(items.every((item) => item.incident.reason && item.incident.impact && item.incident.lastCheckpoint && item.incident.nextAction));
  assert.deepEqual(items[0].diagnostics, {
    status: "setup_error",
    paymentStatus: "",
    subscriptionStatus: "",
    stripeTrialFailed: false,
    makeStatus: null,
    makeError: true,
    smsRoutingStatus: "",
    signupSource: "",
    reviewRequired: false,
    emailVerified: false,
    smsVerified: false,
    hasAssignedPhone: false,
    hasAssistant: false,
    hasCheckout: false,
    hasSubscription: false,
    phoneProvisioningStatus: "",
    phoneProvisioningCode: "",
    makeResponseKind: "",
    signupAlertFailed: false,
    setupFollowupStatus: "",
    setupFollowupChannels: [],
  });
});

test("a failed setup-complete delivery is actionable without treating the provisioned number as failed", () => {
  const now = new Date("2026-08-31T20:00:00.000Z");
  const items = signupAttentionItems([{
    ownerEmail: "private@example.com",
    businessName: "Example Electrical",
    status: "subscription_trialing",
    twilioPhoneNumber: "+13433216155",
    vapiAssistantId: "assistant-safe-id",
    setupFollowupStatus: "failed",
    setupFollowupErrors: [{ channel: "email", code: "SMTP_RECIPIENT_REJECTED" }],
    setupFollowupAttemptedAt: "2026-08-31T19:58:00.000Z",
    updatedAt: "2026-08-31T19:58:00.000Z",
  }], now, 60);

  assert.equal(items.length, 1);
  assert.equal(items[0].kind, "signup_failed");
  assert.equal(items[0].severity, "warning");
  assert.equal(items[0].incident.reasonCode, "SMTP_RECIPIENT_REJECTED");
  assert.match(items[0].incident.nextAction, /Do not provision another number/);
  assert.equal(items[0].diagnostics.hasAssignedPhone, true);
  assert.equal(JSON.stringify(items).includes("3433216155"), false);
});

test("attention summary groups critical and warning issues", () => {
  const summary = summarizeAttention([
    { kind: "signup_failed", severity: "critical" },
    { kind: "owner_text_failed", severity: "critical" },
    { kind: "signup_stuck", severity: "warning" },
  ]);
  assert.equal(summary.total, 3);
  assert.equal(summary.bySeverity.critical, 2);
  assert.equal(summary.bySeverity.warning, 1);
  assert.equal(summary.byKind.signup_failed, 1);
  assert.equal(summary.healthy, false);
});

test("pending verification exposes a guarded resend action after it becomes stuck", () => {
  const now = new Date("2026-08-20T04:00:00.000Z");
  for (const status of ["pending_email_verification", "pending_verification"]) {
    const items = signupAttentionItems([
      { ownerEmail: "owner@example.com", businessName: "Example Co", status, updatedAt: "2026-08-20T02:30:00.000Z" },
    ], now, 60);
    assert.equal(items.length, 1);
    assert.deepEqual(items[0].actions, ["resend_signup_verification", "reopen_signup"]);
    assert.equal(items[0].incident.reasonCode, "CONTACT_VERIFICATION_PENDING");
    assert.match(items[0].incident.reason, /text or email/i);
  }
});

test("an active trial still alerts when provisioning never becomes ready", () => {
  const now = new Date("2026-08-20T04:00:00.000Z");
  const items = signupAttentionItems([{
    ownerEmail: "owner@example.com",
    status: "subscription_trialing",
    makeStatus: 200,
    subscriptionId: "sub_private",
    updatedAt: "2026-08-20T02:30:00.000Z",
  }], now, 60);

  assert.equal(items.length, 1);
  assert.equal(items[0].kind, "signup_stuck");
  assert.deepEqual(items[0].actions, ["recover_signup", "reopen_signup"]);
});

test("Stripe trial creation failures are explicit without exposing the raw error or claiming platform funding", () => {
  const now = new Date("2026-08-28T12:00:00.000Z");
  const rawError = "Request failed for private@example.com token=sk_should_not_appear";
  const items = signupAttentionItems([{
    ownerEmail: "private@example.com",
    businessName: "Example Electrical",
    status: "setup_ready",
    subscriptionStatus: "private@example.com",
    stripeTrialError: rawError,
    updatedAt: "2026-08-28T11:58:00.000Z",
  }], now, 10);

  assert.equal(items.length, 1);
  assert.equal(items[0].kind, "stripe_trial_creation_failed");
  assert.equal(items[0].title, "Stripe trial creation failed");
  assert.equal(items[0].incident.reasonCode, "STRIPE_TRIAL_CREATION_FAILED");
  assert.equal(items[0].incident.confidence, "high");
  assert.equal(items[0].diagnostics.stripeTrialFailed, true);
  assert.equal(items[0].diagnostics.subscriptionStatus, "other");
  const serialized = JSON.stringify(items);
  assert.equal(serialized.includes(rawError), false);
  assert.equal(serialized.includes("private@example.com"), false);
  assert.doesNotMatch(serialized, /platform (?:funding|balance)|add money|top up/i);
});

test("a recovered active Stripe subscription suppresses a stale trial-creation error", () => {
  const now = new Date("2026-08-28T12:00:00.000Z");
  const items = signupAttentionItems([{
    ownerEmail: "private@example.com",
    status: "subscription_active",
    subscriptionId: "sub_redacted",
    subscriptionStatus: "active",
    stripeTrialError: "old failure",
    updatedAt: "2026-08-28T11:58:00.000Z",
  }], now, 60);

  assert.equal(items.length, 0);
});

test("customer subscription billing statuses produce distinct safe attention items", () => {
  const now = new Date("2026-08-28T12:00:00.000Z");
  const statuses = [
    ["past_due", "subscription_past_due", "SUBSCRIPTION_PAST_DUE"],
    ["unpaid", "subscription_unpaid", "SUBSCRIPTION_UNPAID"],
    ["paused", "subscription_paused", "SUBSCRIPTION_PAUSED"],
  ];

  for (const [subscriptionStatus, kind, reasonCode] of statuses) {
    const items = signupAttentionItems([{
      ownerEmail: `${subscriptionStatus}@example.com`,
      status: `subscription_${subscriptionStatus}`,
      subscriptionStatus,
      updatedAt: "2026-08-28T11:58:00.000Z",
    }], now, 60);

    assert.equal(items.length, 1);
    assert.equal(items[0].kind, kind);
    assert.equal(items[0].severity, "critical");
    assert.equal(items[0].incident.reasonCode, reasonCode);
    assert.equal(items[0].incident.confidence, "high");
    assert.match(items[0].incident.lastCheckpoint, new RegExp(subscriptionStatus.replace("_", " "), "i"));
    assert.equal(items[0].diagnostics.subscriptionStatus, subscriptionStatus);
    const serialized = JSON.stringify(items);
    assert.equal(serialized.includes(`${subscriptionStatus}@example.com`), false);
    assert.doesNotMatch(serialized, /platform (?:funding|balance)|add money|top up/i);
  }
});

test("existing payment_failed handling remains customer-specific and case-insensitive", () => {
  const now = new Date("2026-08-28T12:00:00.000Z");
  const items = signupAttentionItems([{
    ownerEmail: "private@example.com",
    status: "payment_failed",
    paymentStatus: "PAYMENT_FAILED",
    lastPaymentFailedAt: "2026-08-28T11:59:00.000Z",
    updatedAt: "2026-08-28T11:58:00.000Z",
  }], now, 60);

  assert.equal(items.length, 1);
  assert.equal(items[0].kind, "payment_failed");
  assert.equal(items[0].title, "Customer payment failed");
  assert.equal(items[0].incident.reasonCode, "PAYMENT_FAILED");
  assert.match(items[0].incident.reason, /customer's payment/i);
  assert.equal(items[0].detectedAt, "2026-08-28T11:59:00.000Z");
  assert.doesNotMatch(JSON.stringify(items), /platform (?:funding|balance)|add money|top up/i);
});

test("pending phone provisioning becomes a critical signup incident", () => {
  const now = new Date("2026-08-25T22:00:00.000Z");
  const items = signupAttentionItems([{
    ownerEmail: "owner@example.com",
    status: "provisioning_pending",
    phoneProvisioningStatus: "pending",
    phoneProvisioningCode: "PHONE_NUMBER_PENDING",
    makeStatus: 200,
    updatedAt: "2026-08-25T21:30:00.000Z",
  }], now, 10);

  assert.equal(items.length, 1);
  assert.equal(items[0].kind, "signup_failed");
  assert.equal(items[0].severity, "critical");
  assert.equal(items[0].diagnostics.phoneProvisioningCode, "phone_number_pending");
  assert.equal(JSON.stringify(items).includes("owner@example.com"), false);
});

test("a coded provisioning failure appears immediately so its Telegram deep link resolves", () => {
  const now = new Date("2026-08-25T22:00:00.000Z");
  const items = signupAttentionItems([{
    ownerEmail: "owner@example.com",
    businessName: "Example Electrical",
    status: "provisioning_pending",
    phoneProvisioningStatus: "pending",
    phoneProvisioningCode: "PHONE_NUMBER_PENDING",
    updatedAt: "2026-08-25T21:59:30.000Z",
  }], now, 10);

  assert.equal(items.length, 1);
  assert.equal(items[0].kind, "signup_failed");
  assert.equal(items[0].incident.reasonCode, "PHONE_NUMBER_PENDING");
});

test("a local area-code mismatch explains why automatic replacement stopped", () => {
  const now = new Date("2026-08-31T22:00:00.000Z");
  const items = signupAttentionItems([{
    ownerEmail: "owner@example.com",
    businessName: "Niagara Electrical",
    status: "provisioning_failed",
    phoneProvisioningStatus: "failed",
    phoneProvisioningCode: "PROVISIONED_NUMBER_AREA_CODE_MISMATCH",
    updatedAt: "2026-08-31T21:59:30.000Z",
  }], now, 10);

  assert.equal(items.length, 1);
  assert.equal(items[0].incident.reasonCode, "PROVISIONED_NUMBER_AREA_CODE_MISMATCH");
  assert.match(items[0].incident.reason, /outside the business's required local area code/i);
  assert.match(items[0].incident.reason, /duplicate charges/i);
});

test("a reopened signup stays in the queue until it is deliberately resolved", () => {
  const now = new Date("2026-08-20T04:00:00.000Z");
  const items = signupAttentionItems([{
    ownerEmail: "owner@example.com",
    status: "manual_review_reopened",
    reviewRequired: true,
    reopenedAt: "2026-08-20T03:55:00.000Z",
    updatedAt: "2026-08-20T03:55:00.000Z",
  }], now, 60);

  assert.equal(items.length, 1);
  assert.equal(items[0].kind, "signup_review_required");
  assert.equal(items[0].severity, "warning");
  assert.deepEqual(items[0].actions, ["recover_signup"]);
  assert.equal(JSON.stringify(items).includes("owner@example.com"), false);
});

test("operational incidents include a safe reason and snapshot metadata across issue types", async () => {
  const now = new Date("2026-08-25T22:00:00.000Z");
  const prisma = {
    leadHandoff: {
      findMany: async () => [
        {
          id: "handoff_1",
          status: "FAILED",
          businessId: 1,
          callId: 11,
          updatedAt: "2026-08-25T21:50:00.000Z",
          retryCount: 2,
          lastErrorCode: "raw-provider-secret-code",
        },
        {
          id: "handoff_2",
          status: "FAILED",
          businessId: 1,
          callId: 12,
          updatedAt: "2026-08-25T21:49:00.000Z",
          retryCount: 1,
          lastErrorCode: "30007",
        },
      ],
    },
    call: {
      findMany: async () => [{
        id: 11,
        businessId: 1,
        startedAt: "2026-08-25T21:45:00.000Z",
        lead: { id: 99 },
        leadHandoffs: [],
      }],
    },
    business: {
      findMany: async () => [
        { id: 1, name: "Acme\nElectrical", settings: { ownerPhone: "+19055550100" }, vapiMappings: [{ id: 1 }] },
        { id: 2, name: "Missing Route Co", settings: { ownerPhone: "" }, vapiMappings: [] },
      ],
    },
    vapiToolExecution: {
      findMany: async () => [
        {
          id: "tool_failed",
          businessId: 1,
          status: "FAILED",
          createdAt: "2026-08-25T21:40:00.000Z",
          errorCode: "raw-provider-auth-response",
          result: {},
        },
        {
          id: "tool_incomplete",
          businessId: 1,
          status: "COMPLETED",
          createdAt: "2026-08-25T21:42:00.000Z",
          errorCode: null,
          result: { owner: { sent: true }, customer: { sent: false } },
        },
      ],
    },
    supportReport: {
      findMany: async () => [{ id: "support_1", businessId: 1, createdAt: "2026-08-25T21:35:00.000Z", status: "NEW" }],
    },
  };

  const runtimeIncident = {
    id: "abcdef1234567890abcdef12",
    kind: "runtime_incident",
    severity: "critical",
    title: "Signup route failed",
    summary: "The request did not finish.",
    incident: {
      reason: "The API returned HTTP 500.",
      impact: "Signup stopped.",
      lastCheckpoint: "Request reached the API.",
      nextAction: "Inspect the exact incident.",
      confidence: "medium",
    },
    snapshot: { Route: "/api/signup", Method: "POST" },
    detectedAt: "2026-08-25T21:55:00.000Z",
    ageMinutes: 5,
    targetType: "runtime_incident",
    targetId: "abcdef1234567890abcdef12",
    actions: ["acknowledge_runtime_incident"],
  };
  const controlledCanary = {
    ...runtimeIncident,
    id: "111111111111111111111111",
    targetId: "111111111111111111111111",
    incident: {
      ...runtimeIncident.incident,
      reasonCode: "CONTROLLED_READINESS_REMEDIATION_TEST",
    },
  };
  const similarlyNamedRealIncident = {
    ...runtimeIncident,
    id: "222222222222222222222222",
    targetId: "222222222222222222222222",
    incident: {
      ...runtimeIncident.incident,
      reasonCode: "CONTROLLED_READINESS_REMEDIATION_TEST_FAILED",
    },
  };
  const inbox = await getOperationalAttentionInbox({
    prisma,
    signups: [],
    runtimeIncidents: [runtimeIncident, controlledCanary, similarlyNamedRealIncident],
    now,
  });
  assert.ok(inbox.items.length >= 8);
  assert.deepEqual(inbox.items.find((item) => item.id === runtimeIncident.id), runtimeIncident);
  assert.equal(inbox.items.some((item) => item.id === controlledCanary.id), false);
  assert.equal(inbox.items.some((item) => item.id === similarlyNamedRealIncident.id), true);
  assert.ok(inbox.items.every((item) => item.incident.reason && item.incident.impact && item.incident.lastCheckpoint && item.incident.nextAction));
  assert.ok(inbox.items.every((item) => ["high", "medium", "low"].includes(item.incident.confidence)));
  assert.equal(inbox.items.find((item) => item.businessId === 1).businessName, "Acme Electrical");
  assert.equal(inbox.items.find((item) => item.businessId === 2).businessName, "Missing Route Co");
  assert.match(inbox.items.find((item) => item.targetId === "handoff_2").incident.reason, /carrier filtered/i);
  assert.equal(inbox.items.find((item) => item.targetId === "handoff_2").incident.reasonCode, "30007");

  const serialized = JSON.stringify(inbox);
  assert.equal(serialized.includes("+19055550100"), false);
  assert.equal(serialized.includes("raw-provider-secret-code"), false);
  assert.equal(serialized.includes("raw-provider-auth-response"), false);
});
