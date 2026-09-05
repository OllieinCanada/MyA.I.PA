const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  AGENT_TEST_VERSION,
  assessAgentRouteBinding,
  buildAgentReadiness,
  buildAgentRouteFingerprint,
  buildAgentTestFingerprint,
  buildAgentTestMessages,
  enforceAgentTestReadyStatus,
  getAgentTestDeliveryUpdate,
  runAgentTextTest,
} = require("../server/signupAgentTesting");

const signup = {
  businessName: "Example Electric",
  ownerName: "Pat",
  ownerPhone: "+19055550199",
  twilioPhoneNumber: "+12895550123",
  vapiAssistantId: "assistant-123",
  vapiPhoneNumberId: "phone-123",
  smsRoutingStatus: "healthy",
  businessId: 7,
};
signup.agentRouteBindingStatus = "verified";
signup.agentRouteBindingMode = "direct";
signup.agentRouteBindingVerifiedAt = "2026-09-05T11:59:00.000Z";
signup.agentRouteBindingFingerprint = buildAgentRouteFingerprint({
  mode: signup.agentRouteBindingMode,
  businessId: signup.businessId,
  phoneNumberId: signup.vapiPhoneNumberId,
  aiNumber: signup.twilioPhoneNumber,
  assistantId: signup.vapiAssistantId,
});

test("agent routing accepts direct and protected trial-gate bindings", () => {
  const common = {
    expectedBusinessId: signup.businessId,
    expectedPhoneNumberId: signup.vapiPhoneNumberId,
    expectedPhoneNumber: signup.twilioPhoneNumber,
    expectedAssistantId: signup.vapiAssistantId,
    livePhoneNumberId: signup.vapiPhoneNumberId,
    livePhoneNumber: signup.twilioPhoneNumber,
    trialGateWebhookUrl: "https://api.myaipa.ca/api/webhooks/voice",
  };
  const direct = assessAgentRouteBinding({ ...common, liveAssistantId: signup.vapiAssistantId });
  assert.equal(direct.status, "verified");
  assert.equal(direct.mode, "direct");

  const dynamic = assessAgentRouteBinding({
    ...common,
    liveServerUrl: "https://api.myaipa.ca/api/webhooks/voice",
    trialGate: {
      status: "active",
      businessId: signup.businessId,
      phoneNumberId: signup.vapiPhoneNumberId,
      phoneNumber: signup.twilioPhoneNumber,
      assistantId: signup.vapiAssistantId,
    },
  });
  assert.equal(dynamic.status, "verified");
  assert.equal(dynamic.mode, "trial-gate");
});

test("agent routing repairs only an empty unclaimed phone and stops on conflicts", () => {
  const common = {
    expectedBusinessId: signup.businessId,
    expectedPhoneNumberId: signup.vapiPhoneNumberId,
    expectedPhoneNumber: signup.twilioPhoneNumber,
    expectedAssistantId: signup.vapiAssistantId,
    livePhoneNumberId: signup.vapiPhoneNumberId,
    livePhoneNumber: signup.twilioPhoneNumber,
    trialGateWebhookUrl: "https://api.myaipa.ca/api/webhooks/voice",
  };
  assert.equal(assessAgentRouteBinding(common).action, "attach");
  assert.equal(assessAgentRouteBinding({ ...common, liveAssistantId: "another-assistant" }).code, "AGENT_PHONE_ASSISTANT_CONFLICT");
  assert.equal(assessAgentRouteBinding({ ...common, liveServerUrl: "https://other.example/webhook" }).code, "AGENT_PHONE_DYNAMIC_ROUTE_CONFLICT");
});

test("both new-agent provisioning paths run the delivery test automatically", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "server", "index.js"), "utf8");
  const legacyStart = source.indexOf('"/api/integrations/provisioning/complete-existing"');
  const modernStart = source.indexOf('"/api/integrations/vapi/import-twilio-number"');
  const modernEnd = source.indexOf("app.post(", modernStart + 1);
  assert.ok(legacyStart > 0 && modernStart > legacyStart && modernEnd > modernStart);
  assert.match(source.slice(legacyStart, modernStart), /testSignupAgentBeforeDelivery\(/);
  assert.match(source.slice(modernStart, modernEnd), /testSignupAgentBeforeDelivery\(/);
  assert.match(source.slice(modernStart, modernEnd), /deliveryReady:/);
});

test("test messages visibly separate the owner and customer formats", () => {
  const messages = buildAgentTestMessages(signup);
  assert.match(messages.owner, /OWNER COPY/);
  assert.match(messages.owner, /^\[My AI PA setup test[\s\S]*NEW LEAD/m);
  assert.match(messages.owner, /- Caller: Pat/);
  assert.match(messages.owner, /- Work requested:/);
  assert.match(messages.owner, /- Preferred start:/);
  assert.match(messages.owner, /- Best callback:/);
  assert.match(messages.owner, /- Urgency:/);
  assert.match(messages.customer, /CUSTOMER COPY/);
  assert.match(messages.customer, /Thanks for calling Example Electric/);
  assert.doesNotMatch(messages.customer, /NEW LEAD/);
});

test("final Twilio callbacks update the matching test leg and revoke readiness on failure", () => {
  const delivered = getAgentTestDeliveryUpdate({
    signup: { agentTestOwnerMessageSid: "SM_OWNER" },
    messageSid: "SM_OWNER",
    status: "delivered",
    now: "2026-09-05T12:00:02.000Z",
  });
  assert.equal(delivered.agentTestOwnerProviderStatus, "delivered");
  assert.equal(delivered.agentTestOwnerDeliveredAt, "2026-09-05T12:00:02.000Z");

  const failed = getAgentTestDeliveryUpdate({
    signup: { agentTestCustomerMessageSid: "SM_CUSTOMER" },
    messageSid: "SM_CUSTOMER",
    status: "undelivered",
    errorCode: "30003",
    now: "2026-09-05T12:00:03.000Z",
  });
  assert.equal(failed.agentTestCustomerProviderStatus, "undelivered");
  assert.equal(failed.agentTestStatus, "failed");
  assert.equal(failed.agentTestErrorCode, "30003");
  assert.equal(getAgentTestDeliveryUpdate({ signup: {}, messageSid: "SM_OTHER", status: "failed" }), null);
});

test("setup-ready is globally held until the mandatory agent test passes", () => {
  const held = enforceAgentTestReadyStatus({ status: "setup_ready", agentTestStatus: "running" });
  assert.equal(held.status, "agent_testing");
  assert.equal(held.setupReadyBlockedReason, "MANDATORY_AGENT_TEST_NOT_PASSED");

  const ready = enforceAgentTestReadyStatus({
    status: "setup_ready",
    agentTestStatus: "passed",
    vapiAssistantId: signup.vapiAssistantId,
    twilioPhoneNumber: signup.twilioPhoneNumber,
    ownerPhone: signup.ownerPhone,
    agentTestFingerprint: buildAgentTestFingerprint({
      assistantId: signup.vapiAssistantId,
      aiNumber: signup.twilioPhoneNumber,
      ownerPhone: signup.ownerPhone,
    }),
    agentTestOwnerAcceptedAt: "2026-09-05T12:00:00.000Z",
    agentTestCustomerAcceptedAt: "2026-09-05T12:00:01.000Z",
    businessId: signup.businessId,
    agentRouteBindingStatus: signup.agentRouteBindingStatus,
    agentRouteBindingMode: signup.agentRouteBindingMode,
    agentRouteBindingVerifiedAt: signup.agentRouteBindingVerifiedAt,
    agentRouteBindingFingerprint: signup.agentRouteBindingFingerprint,
  });
  assert.equal(ready.status, "setup_ready");

  const currentWithoutRouteProof = enforceAgentTestReadyStatus({
    status: "setup_ready",
    agentTestStatus: "passed",
    agentTestVersion: AGENT_TEST_VERSION,
    businessId: signup.businessId,
    vapiPhoneNumberId: signup.vapiPhoneNumberId,
    vapiAssistantId: signup.vapiAssistantId,
    twilioPhoneNumber: signup.twilioPhoneNumber,
    ownerPhone: signup.ownerPhone,
    agentTestFingerprint: buildAgentTestFingerprint({
      assistantId: signup.vapiAssistantId,
      aiNumber: signup.twilioPhoneNumber,
      ownerPhone: signup.ownerPhone,
    }),
    agentTestOwnerAcceptedAt: "2026-09-05T12:00:00.000Z",
    agentTestCustomerAcceptedAt: "2026-09-05T12:00:01.000Z",
  });
  assert.equal(currentWithoutRouteProof.status, "agent_testing");
});

test("text test sends both samples from the assigned AI number and is replay safe", async () => {
  const sent = [];
  const stored = { ...signup };
  const sendSms = async (input) => { sent.push(input); return { status: "queued", sid: `SM_TEST_${sent.length}` }; };
  const persist = (fields) => Object.assign(stored, fields);
  const result = await runAgentTextTest({ signup: stored, sendSms, persist });
  assert.equal(result.passed, true);
  assert.equal(sent.length, 2);
  assert.ok(sent.every((item) => item.to === signup.ownerPhone && item.from === signup.twilioPhoneNumber));
  assert.equal(stored.agentTestOwnerMessageSid, "SM_TEST_1");
  assert.equal(stored.agentTestCustomerMessageSid, "SM_TEST_2");
  const replay = await runAgentTextTest({ signup: stored, sendSms, persist });
  assert.equal(replay.skipped, true);
  assert.equal(sent.length, 2);
});

test("a partial test resumes only the missing sample", async () => {
  const fingerprint = buildAgentTestFingerprint({
    assistantId: signup.vapiAssistantId,
    aiNumber: signup.twilioPhoneNumber,
    ownerPhone: signup.ownerPhone,
  });
  const stored = { ...signup, agentTestFingerprint: fingerprint, agentTestOwnerAcceptedAt: "2026-09-05T12:00:00.000Z" };
  const sent = [];
  await runAgentTextTest({
    signup: stored,
    sendSms: async (input) => { sent.push(input); return { status: "queued" }; },
    persist: (fields) => Object.assign(stored, fields),
  });
  assert.equal(sent.length, 1);
  assert.match(sent[0].message, /CUSTOMER COPY/);
});

test("readiness fails closed until mapping, routing, and both texts pass", () => {
  const business = {
    id: 7,
    vapiMappings: [
      { matchType: "phoneNumber", matchValue: signup.twilioPhoneNumber },
      { matchType: "phoneNumberId", matchValue: signup.vapiPhoneNumberId },
      { matchType: "assistantId", matchValue: signup.vapiAssistantId },
    ],
  };
  const before = buildAgentReadiness({ signup, business });
  assert.equal(before.passed, false);
  assert.equal(before.status, "testing_required");

  const fingerprint = buildAgentTestFingerprint({
    assistantId: signup.vapiAssistantId,
    aiNumber: signup.twilioPhoneNumber,
    ownerPhone: signup.ownerPhone,
  });
  const after = buildAgentReadiness({
    signup: {
      ...signup,
      agentTestFingerprint: fingerprint,
      agentTestOwnerAcceptedAt: "2026-09-05T12:00:00.000Z",
      agentTestCustomerAcceptedAt: "2026-09-05T12:00:01.000Z",
    },
    business,
  });
  assert.equal(after.passed, true);
  assert.equal(after.status, "passed");
});

test("one mapping can never stand in for the complete number, phone-id, and assistant mapping set", () => {
  const fingerprint = buildAgentTestFingerprint({
    assistantId: signup.vapiAssistantId,
    aiNumber: signup.twilioPhoneNumber,
    ownerPhone: signup.ownerPhone,
  });
  const readiness = buildAgentReadiness({
    signup: {
      ...signup,
      agentTestStatus: "passed",
      agentTestFingerprint: fingerprint,
      agentTestOwnerAcceptedAt: "2026-09-05T12:00:00.000Z",
      agentTestCustomerAcceptedAt: "2026-09-05T12:00:01.000Z",
    },
    business: {
      id: 7,
      vapiMappings: [{ matchType: "phoneNumber", matchValue: signup.twilioPhoneNumber }],
    },
  });
  assert.equal(readiness.passed, false);
  assert.equal(readiness.checks.find((check) => check.key === "number-mapping").done, true);
  assert.equal(readiness.checks.find((check) => check.key === "phone-id-mapping").done, false);
  assert.equal(readiness.checks.find((check) => check.key === "assistant-mapping").done, false);
});
