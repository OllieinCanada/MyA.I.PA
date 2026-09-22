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
  agentContentStatus: "verified",
  agentContentFingerprint: "content-fingerprint-123",
  agentContentVerifiedAt: "2026-09-05T11:58:00.000Z",
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

test("agent routing requires the live phone to retain its direct assistant binding", () => {
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

  const dynamicWithoutAssistant = assessAgentRouteBinding({
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
  assert.equal(dynamicWithoutAssistant.status, "verified");
  assert.equal(dynamicWithoutAssistant.action, "none");
  assert.equal(dynamicWithoutAssistant.mode, "trial-gate");
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

test("guarded finalization preserves the exact attempt through testing, trial, and delivery", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "server", "index.js"), "utf8");
  const routeStart = source.indexOf('"/api/internal/operations/finalize-signup-after-agent-test"');
  const routeEnd = source.indexOf("app.post(", routeStart + 1);
  assert.ok(routeStart > 0 && routeEnd > routeStart);
  const route = source.slice(routeStart, routeEnd);
  assert.match(route, /FINALIZE_SIGNUP_AFTER_AGENT_TEST/);
  assert.match(route, /expectedSignupAttemptId/);
  assert.match(route, /finalizeSignupAfterAgentTestByOperationalTarget/);

  const testStart = source.indexOf("async function testSignupAgentBeforeDelivery");
  const continuationStart = source.indexOf("async function continueSignupAgentTextTestAfterDelivery", testStart);
  const testSource = source.slice(testStart, continuationStart);
  assert.match(testSource, /assessSignupAssistantContentWithReceipt/);
  assert.match(testSource, /readProvisioningStep/);
  assert.match(testSource, /prisma\.signupAttempt\.findUnique/);
  assert.match(testSource, /buildSignupAssistantConfig\(exactSignupPayload/);
  assert.match(testSource, /AGENT_SIGNUP_SOURCE_MISSING/);
  assert.match(testSource, /upsertSignupDashboardRecord\(\{ \.\.\.storedSignup, \.\.\.fields \}\)/);
  assert.match(testSource, /signupAttemptId && String\(record\.signupAttemptId/);
  assert.doesNotMatch(testSource, /upsertSignupDashboardRecord\(\{\s*ownerEmail: finalSignup\.ownerEmail/);

  const finalizerStart = source.indexOf("async function finalizeSignupAfterAgentTestByOperationalTarget");
  const finalizerEnd = source.indexOf("async function", finalizerStart + 20);
  const finalizer = source.slice(finalizerStart, finalizerEnd);
  assert.match(finalizer, /prisma\.signupAttempt\.findUnique/);
  assert.match(finalizer, /normalizedPayload: attempt\.payload/);

  const continuationEnd = source.indexOf("async function getTrialCallUsage", continuationStart);
  const continuationSource = source.slice(continuationStart, continuationEnd);
  assert.match(continuationSource, /expectedAttemptId && String\(record\.signupAttemptId/);
  assert.doesNotMatch(continuationSource, /upsertSignupDashboardRecord\(\{\s*ownerEmail: latestSignup\.ownerEmail/);

  const callbackStart = source.indexOf('"/api/webhooks/twilio/message-status"');
  const callbackEnd = source.indexOf("app.post(", callbackStart + 1);
  const callback = source.slice(callbackStart, callbackEnd);
  assert.match(callback, /upsertSignupDashboardRecord\(\{ \.\.\.matchingSignup, \.\.\.update \}\)/);
  assert.match(callback, /matchingSignup\.signupAttemptId/);
});

test("test messages visibly separate the owner and customer formats", () => {
  const messages = buildAgentTestMessages(signup);
  assert.match(messages.owner, /OWNER COPY/);
  assert.match(messages.owner, /^\[My AI PA setup test[\s\S]*SERVICE REQUEST/m);
  assert.match(messages.owner, /- Caller: Pat/);
  assert.match(messages.owner, /- Job:/);
  assert.match(messages.owner, /- Location:/);
  assert.match(messages.owner, /- Preferred start date:/);
  assert.match(messages.owner, /- Preferred callback:/);
  assert.match(messages.owner, /- Urgency:/);
  assert.match(messages.owner, /- Next action:/);
  assert.match(messages.customer, /CUSTOMER COPY/);
  assert.match(messages.customer, /EXAMPLE ELECTRIC/);
  assert.match(messages.customer, /Scheduling:/);
  assert.match(messages.customer, /Thanks for calling Example Electric\. Have a great day!/);
  assert.doesNotMatch(messages.customer, /NEW LEAD/);
  assert.doesNotMatch(messages.customer, /booked|appointment confirmed/i);
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
  assert.equal(delivered.agentTestStatus, "awaiting_customer_delivery");

  const completed = getAgentTestDeliveryUpdate({
    signup: {
      agentTestOwnerDeliveredAt: "2026-09-05T12:00:02.000Z",
      agentTestCustomerMessageSid: "SM_CUSTOMER",
    },
    messageSid: "SM_CUSTOMER",
    status: "delivered",
    now: "2026-09-05T12:00:04.000Z",
  });
  assert.equal(completed.agentTestStatus, "passed");
  assert.equal(completed.agentTestCheckedAt, "2026-09-05T12:00:04.000Z");

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
      contentFingerprint: signup.agentContentFingerprint,
    }),
    agentTestOwnerAcceptedAt: "2026-09-05T12:00:00.000Z",
    agentTestCustomerAcceptedAt: "2026-09-05T12:00:01.000Z",
    agentTestOwnerDeliveredAt: "2026-09-05T12:00:02.000Z",
    agentTestCustomerDeliveredAt: "2026-09-05T12:00:03.000Z",
    agentTestOwnerProviderStatus: "delivered",
    agentTestCustomerProviderStatus: "delivered",
    agentContentStatus: signup.agentContentStatus,
    agentContentFingerprint: signup.agentContentFingerprint,
    agentContentVerifiedAt: signup.agentContentVerifiedAt,
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
      contentFingerprint: signup.agentContentFingerprint,
    }),
    agentTestOwnerAcceptedAt: "2026-09-05T12:00:00.000Z",
    agentTestCustomerAcceptedAt: "2026-09-05T12:00:01.000Z",
  });
  assert.equal(currentWithoutRouteProof.status, "agent_testing");

  const currentWithoutContentProof = enforceAgentTestReadyStatus({
    ...ready,
    status: "setup_ready",
    agentTestVersion: AGENT_TEST_VERSION,
    vapiPhoneNumberId: signup.vapiPhoneNumberId,
    agentContentStatus: "",
    agentContentFingerprint: "",
    agentContentVerifiedAt: "",
    agentTestFingerprint: buildAgentTestFingerprint({
      assistantId: signup.vapiAssistantId,
      aiNumber: signup.twilioPhoneNumber,
      ownerPhone: signup.ownerPhone,
      contentFingerprint: "",
    }),
  });
  assert.equal(currentWithoutContentProof.status, "agent_testing");
});

test("text test waits for confirmed owner delivery before sending the customer copy", async () => {
  const sent = [];
  const stored = { ...signup };
  const sendSms = async (input) => { sent.push(input); return { status: "queued", sid: `SM_TEST_${sent.length}` }; };
  const persist = (fields) => Object.assign(stored, fields);
  const ownerPending = await runAgentTextTest({ signup: stored, sendSms, persist });
  assert.equal(ownerPending.passed, false);
  assert.equal(ownerPending.stage, "owner_delivery");
  assert.equal(sent.length, 1);
  assert.match(sent[0].message, /OWNER COPY/);
  Object.assign(stored, getAgentTestDeliveryUpdate({
    signup: stored,
    messageSid: stored.agentTestOwnerMessageSid,
    status: "delivered",
  }));
  const customerPending = await runAgentTextTest({ signup: stored, sendSms, persist });
  assert.equal(customerPending.passed, false);
  assert.equal(customerPending.stage, "customer_delivery");
  assert.equal(sent.length, 2);
  assert.ok(sent.every((item) => item.to === signup.ownerPhone && item.from === signup.twilioPhoneNumber));
  assert.equal(stored.agentTestOwnerMessageSid, "SM_TEST_1");
  assert.equal(stored.agentTestCustomerMessageSid, "SM_TEST_2");
  Object.assign(stored, getAgentTestDeliveryUpdate({
    signup: stored,
    messageSid: stored.agentTestCustomerMessageSid,
    status: "delivered",
  }));
  const completed = await runAgentTextTest({ signup: stored, sendSms, persist });
  assert.equal(completed.passed, true);
  const replay = await runAgentTextTest({ signup: stored, sendSms, persist });
  assert.equal(replay.skipped, true);
  assert.equal(sent.length, 2);
});

test("a partial test does not send the customer copy until owner delivery is confirmed", async () => {
  const fingerprint = buildAgentTestFingerprint({
    assistantId: signup.vapiAssistantId,
    aiNumber: signup.twilioPhoneNumber,
    ownerPhone: signup.ownerPhone,
    contentFingerprint: signup.agentContentFingerprint,
  });
  const stored = { ...signup, agentTestFingerprint: fingerprint, agentTestOwnerAcceptedAt: "2026-09-05T12:00:00.000Z" };
  const sent = [];
  await runAgentTextTest({
    signup: stored,
    sendSms: async (input) => { sent.push(input); return { status: "queued" }; },
    persist: (fields) => Object.assign(stored, fields),
  });
  assert.equal(sent.length, 0);

  stored.agentTestOwnerDeliveredAt = "2026-09-05T12:00:01.000Z";
  stored.agentTestOwnerProviderStatus = "delivered";
  await runAgentTextTest({
    signup: stored,
    sendSms: async (input) => { sent.push(input); return { status: "queued", sid: "SM_CUSTOMER" }; },
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
    contentFingerprint: signup.agentContentFingerprint,
  });
  const after = buildAgentReadiness({
    signup: {
      ...signup,
      agentTestFingerprint: fingerprint,
      agentTestOwnerAcceptedAt: "2026-09-05T12:00:00.000Z",
      agentTestCustomerAcceptedAt: "2026-09-05T12:00:01.000Z",
      agentTestOwnerDeliveredAt: "2026-09-05T12:00:02.000Z",
      agentTestCustomerDeliveredAt: "2026-09-05T12:00:03.000Z",
      agentTestOwnerProviderStatus: "delivered",
      agentTestCustomerProviderStatus: "delivered",
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
    contentFingerprint: signup.agentContentFingerprint,
  });
  const readiness = buildAgentReadiness({
    signup: {
      ...signup,
      agentTestStatus: "passed",
      agentTestFingerprint: fingerprint,
      agentTestOwnerAcceptedAt: "2026-09-05T12:00:00.000Z",
      agentTestCustomerAcceptedAt: "2026-09-05T12:00:01.000Z",
      agentTestOwnerDeliveredAt: "2026-09-05T12:00:02.000Z",
      agentTestCustomerDeliveredAt: "2026-09-05T12:00:03.000Z",
      agentTestOwnerProviderStatus: "delivered",
      agentTestCustomerProviderStatus: "delivered",
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
