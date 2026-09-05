const { buildCustomerBody, buildOwnerBody } = require("./compositeCallNotifications");

const AGENT_TEST_VERSION = "2026-09-05-v2";

function clean(value, max = 240) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function normalizePhone(value) {
  const raw = String(value || "").trim();
  const digits = raw.replace(/\D/g, "");
  const normalized = raw.startsWith("+") ? `+${digits}` : digits.length === 10 ? `+1${digits}` : `+${digits}`;
  return /^\+[1-9]\d{7,14}$/.test(normalized) ? normalized : "";
}

function buildAgentTestFingerprint({ assistantId, aiNumber, ownerPhone } = {}) {
  return [clean(assistantId, 160), normalizePhone(aiNumber), normalizePhone(ownerPhone)].join("|");
}

function buildAgentRouteFingerprint({ mode, businessId, phoneNumberId, aiNumber, assistantId } = {}) {
  return [
    clean(mode, 40).toLowerCase(),
    clean(businessId, 80).toLowerCase(),
    clean(phoneNumberId, 160).toLowerCase(),
    normalizePhone(aiNumber),
    clean(assistantId, 160).toLowerCase(),
  ].join("|");
}

function assessAgentRouteBinding({
  expectedBusinessId,
  expectedPhoneNumberId,
  expectedPhoneNumber,
  expectedAssistantId,
  livePhoneNumberId,
  livePhoneNumber,
  liveAssistantId,
  liveServerUrl,
  trialGateWebhookUrl,
  trialGate,
} = {}) {
  const expected = {
    businessId: clean(expectedBusinessId, 80).toLowerCase(),
    phoneNumberId: clean(expectedPhoneNumberId, 160).toLowerCase(),
    phoneNumber: normalizePhone(expectedPhoneNumber),
    assistantId: clean(expectedAssistantId, 160).toLowerCase(),
  };
  const live = {
    phoneNumberId: clean(livePhoneNumberId, 160).toLowerCase(),
    phoneNumber: normalizePhone(livePhoneNumber),
    assistantId: clean(liveAssistantId, 160).toLowerCase(),
    serverUrl: clean(liveServerUrl, 500),
  };
  const gate = {
    status: clean(trialGate?.status, 40).toLowerCase(),
    businessId: clean(trialGate?.businessId, 80).toLowerCase(),
    phoneNumberId: clean(trialGate?.phoneNumberId, 160).toLowerCase(),
    phoneNumber: normalizePhone(trialGate?.phoneNumber),
    assistantId: clean(trialGate?.assistantId, 160).toLowerCase(),
  };
  const expectedGateUrl = clean(trialGateWebhookUrl, 500);
  const stop = (status, code) => ({ status, action: "stop", code, expected, live, gate });
  if (!expected.businessId || !expected.phoneNumberId || !expected.phoneNumber || !expected.assistantId) {
    return stop("invalid", "AGENT_ROUTE_EXPECTATION_INCOMPLETE");
  }
  if (!live.phoneNumberId || !live.phoneNumber) return stop("missing", "AGENT_PHONE_RECORD_MISSING");
  if (live.phoneNumberId !== expected.phoneNumberId || live.phoneNumber !== expected.phoneNumber) {
    return stop("conflict", "AGENT_PHONE_IDENTITY_CONFLICT");
  }
  if (live.assistantId && live.assistantId !== expected.assistantId) {
    return stop("conflict", "AGENT_PHONE_ASSISTANT_CONFLICT");
  }
  if (live.assistantId === expected.assistantId) {
    const mode = "direct";
    return {
      status: "verified",
      action: "none",
      code: "",
      mode,
      expected,
      live,
      gate,
      fingerprint: buildAgentRouteFingerprint({
        mode,
        businessId: expected.businessId,
        phoneNumberId: expected.phoneNumberId,
        aiNumber: expected.phoneNumber,
        assistantId: expected.assistantId,
      }),
    };
  }
  const dynamicGateMatches = Boolean(
    expectedGateUrl
    && live.serverUrl === expectedGateUrl
    && gate.status === "active"
    && gate.businessId === expected.businessId
    && gate.phoneNumberId === expected.phoneNumberId
    && gate.phoneNumber === expected.phoneNumber
    && gate.assistantId === expected.assistantId
  );
  if (dynamicGateMatches) {
    const mode = "trial-gate";
    return {
      status: "verified",
      action: "none",
      code: "",
      mode,
      expected,
      live,
      gate,
      fingerprint: buildAgentRouteFingerprint({
        mode,
        businessId: expected.businessId,
        phoneNumberId: expected.phoneNumberId,
        aiNumber: expected.phoneNumber,
        assistantId: expected.assistantId,
      }),
    };
  }
  if (live.serverUrl) return stop("conflict", "AGENT_PHONE_DYNAMIC_ROUTE_CONFLICT");
  return { status: "missing", action: "attach", code: "AGENT_PHONE_ASSISTANT_MISSING", expected, live, gate };
}

function buildAgentTestMessages({ businessName, ownerName } = {}) {
  const business = clean(businessName, 140) || "Your business";
  const caller = clean(ownerName, 120) || "Test Caller";
  const input = {
    businessName: business,
    requestType: "service",
    name: caller,
    rawPhoneNumber: "+19055550123",
    jobDetails: "Sample service request — no real work is requested",
    streetAddress: "123 Sample Street",
    city: "Hamilton, ON",
    preferredStartDate: "Next week (preference only)",
    bestCallbackTime: "Weekday afternoon",
    urgency: "Routine",
  };
  return {
    owner: `[My AI PA setup test 1 of 2 — OWNER COPY]\n${buildOwnerBody(input)}\nTEST ONLY — no customer is waiting and no callback is needed.`,
    customer: `[My AI PA setup test 2 of 2 — CUSTOMER COPY]\n${buildCustomerBody(input)}\nTEST ONLY — this confirms what callers will receive.`,
  };
}

function buildAgentReadiness({ signup = {}, business = null } = {}) {
  const aiNumber = normalizePhone(signup.twilioPhoneNumber);
  const assistantId = clean(signup.vapiAssistantId, 160);
  const phoneNumberId = clean(signup.vapiPhoneNumberId, 160).toLowerCase();
  const ownerPhone = normalizePhone(signup.ownerPhone || signup.businessPhone || business?.settings?.ownerPhone);
  const mappings = Array.isArray(business?.vapiMappings) ? business.vapiMappings : [];
  const hasMapping = (matchType, matchValue) => mappings.some((mapping) => {
    const type = String(mapping?.matchType || "").toLowerCase();
    const value = String(mapping?.matchValue || "").trim().toLowerCase();
    if (matchType === "phonenumber") return type === matchType && normalizePhone(value) === normalizePhone(matchValue);
    return type === matchType && value === String(matchValue || "").trim().toLowerCase();
  });
  const numberMappingReady = Boolean(business?.id && aiNumber && hasMapping("phonenumber", aiNumber));
  const phoneIdMappingReady = Boolean(business?.id && phoneNumberId && hasMapping("phonenumberid", phoneNumberId));
  const assistantMappingReady = Boolean(business?.id && assistantId && hasMapping("assistantid", assistantId));
  const routeMode = clean(signup.agentRouteBindingMode, 40).toLowerCase();
  const routeFingerprint = buildAgentRouteFingerprint({
    mode: routeMode,
    businessId: business?.id || signup.businessId,
    phoneNumberId,
    aiNumber,
    assistantId,
  });
  const currentRouteBindingReady = Boolean(
    ["direct", "trial-gate"].includes(routeMode)
    && signup.agentRouteBindingStatus === "verified"
    && signup.agentRouteBindingVerifiedAt
    && signup.agentRouteBindingFingerprint === routeFingerprint
  );
  const legacyPassedBeforeRouteProof = Boolean(
    signup.agentTestStatus === "passed"
    && signup.agentTestVersion
    && signup.agentTestVersion !== AGENT_TEST_VERSION
  );
  const routeBindingReady = currentRouteBindingReady || legacyPassedBeforeRouteProof;
  const fingerprint = buildAgentTestFingerprint({ assistantId, aiNumber, ownerPhone });
  const testMatches = Boolean(fingerprint && signup.agentTestFingerprint === fingerprint);
  const ownerProviderStatus = clean(signup.agentTestOwnerProviderStatus, 40).toLowerCase();
  const customerProviderStatus = clean(signup.agentTestCustomerProviderStatus, 40).toLowerCase();
  const failedStatuses = new Set(["canceled", "failed", "undelivered"]);
  const checks = [
    { key: "assistant", label: "Assistant built", done: Boolean(assistantId) },
    { key: "number", label: "AI number connected", done: Boolean(aiNumber) },
    { key: "agent-route", label: "Phone routes to the correct assistant", done: routeBindingReady },
    { key: "business", label: "Business record created", done: Boolean(business?.id) },
    { key: "number-mapping", label: "AI number linked to this business", done: numberMappingReady },
    { key: "phone-id-mapping", label: "Vapi phone record linked to this business", done: phoneIdMappingReady },
    { key: "assistant-mapping", label: "Assistant linked to this business", done: assistantMappingReady },
    { key: "routing", label: "Owner and customer text routes checked", done: signup.smsRoutingStatus === "healthy" },
    { key: "owner-text", label: "Owner sample text accepted", done: testMatches && Boolean(signup.agentTestOwnerAcceptedAt) && !failedStatuses.has(ownerProviderStatus) },
    { key: "customer-text", label: "Customer sample text accepted", done: testMatches && Boolean(signup.agentTestCustomerAcceptedAt) && !failedStatuses.has(customerProviderStatus) },
  ];
  const passed = checks.every((check) => check.done);
  return {
    version: AGENT_TEST_VERSION,
    status: passed ? "passed" : signup.agentTestStatus === "failed" ? "failed" : "testing_required",
    passed,
    checks,
    checkedAt: signup.agentTestCheckedAt || "",
    errorCode: passed ? "" : clean(signup.agentTestErrorCode, 120),
  };
}

function enforceAgentTestReadyStatus(record = {}) {
  if (String(record.status || "").trim().toLowerCase() !== "setup_ready") return record;
  const expectedFingerprint = buildAgentTestFingerprint({
    assistantId: record.vapiAssistantId,
    aiNumber: record.twilioPhoneNumber,
    ownerPhone: record.ownerPhone || record.businessPhone,
  });
  const terminalFailure = [record.agentTestOwnerProviderStatus, record.agentTestCustomerProviderStatus]
    .some((status) => ["canceled", "failed", "undelivered"].includes(String(status || "").trim().toLowerCase()));
  const expectedRouteFingerprint = buildAgentRouteFingerprint({
    mode: record.agentRouteBindingMode,
    businessId: record.businessId,
    phoneNumberId: record.vapiPhoneNumberId,
    aiNumber: record.twilioPhoneNumber,
    assistantId: record.vapiAssistantId,
  });
  const currentVersionRequiresRouteProof = record.agentTestVersion === AGENT_TEST_VERSION;
  const routeProofReady = Boolean(
    record.agentRouteBindingStatus === "verified"
    && record.agentRouteBindingVerifiedAt
    && record.agentRouteBindingFingerprint === expectedRouteFingerprint
  );
  if (
    record.agentTestStatus === "passed"
    && expectedFingerprint
    && record.agentTestFingerprint === expectedFingerprint
    && record.agentTestOwnerAcceptedAt
    && record.agentTestCustomerAcceptedAt
    && (!currentVersionRequiresRouteProof || routeProofReady)
    && !terminalFailure
  ) {
    return record;
  }
  return {
    ...record,
    status: "agent_testing",
    setupReadyBlockedReason: "MANDATORY_AGENT_TEST_NOT_PASSED",
  };
}

function getAgentTestDeliveryUpdate({ signup = {}, messageSid, status, errorCode, now = new Date().toISOString() } = {}) {
  const sid = clean(messageSid, 80);
  const normalizedStatus = clean(status, 40).toLowerCase().replace(/[^a-z_-]+/g, "");
  if (!sid || !normalizedStatus) return null;
  const channel = sid === clean(signup.agentTestOwnerMessageSid, 80)
    ? "Owner"
    : sid === clean(signup.agentTestCustomerMessageSid, 80)
      ? "Customer"
      : "";
  if (!channel) return null;

  const update = {
    [`agentTest${channel}ProviderStatus`]: normalizedStatus,
    [`agentTest${channel}StatusUpdatedAt`]: now,
  };
  if (["delivered", "read"].includes(normalizedStatus)) {
    update[`agentTest${channel}DeliveredAt`] = now;
  }
  if (["canceled", "failed", "undelivered"].includes(normalizedStatus)) {
    update.agentTestStatus = "failed";
    update.agentTestCheckedAt = now;
    update.agentTestErrorCode = clean(errorCode, 40).toUpperCase().replace(/[^A-Z0-9_.:-]+/g, "_") || "TWILIO_MESSAGE_UNDELIVERED";
  }
  return update;
}

async function runAgentTextTest({ signup = {}, sendSms, persist = () => {}, force = false } = {}) {
  if (typeof sendSms !== "function") throw new TypeError("A text sender is required.");
  const aiNumber = normalizePhone(signup.twilioPhoneNumber);
  const ownerPhone = normalizePhone(signup.ownerPhone || signup.businessPhone);
  const assistantId = clean(signup.vapiAssistantId, 160);
  if (!aiNumber || !ownerPhone || !assistantId) {
    const error = new Error("The assistant, AI number, and owner phone must exist before the text test can run.");
    error.code = "AGENT_TEST_SETUP_INCOMPLETE";
    throw error;
  }
  if (signup.smsRoutingStatus !== "healthy") {
    const error = new Error("Protected owner and customer text routing must pass before the text test can run.");
    error.code = "AGENT_TEST_ROUTING_NOT_READY";
    throw error;
  }

  const fingerprint = buildAgentTestFingerprint({ assistantId, aiNumber, ownerPhone });
  const sameConfiguration = signup.agentTestFingerprint === fingerprint;
  if (!force && sameConfiguration && signup.agentTestOwnerAcceptedAt && signup.agentTestCustomerAcceptedAt) {
    return { passed: true, skipped: true, reason: "already_passed", fingerprint };
  }

  const messages = buildAgentTestMessages({ businessName: signup.businessName, ownerName: signup.ownerName });
  const progress = sameConfiguration ? { ...signup } : {};
  const common = {
    agentTestVersion: AGENT_TEST_VERSION,
    agentTestStatus: "running",
    agentTestFingerprint: fingerprint,
    agentTestStartedAt: new Date().toISOString(),
    agentTestErrorCode: "",
  };
  persist(common);

  try {
    if (force || !progress.agentTestOwnerAcceptedAt) {
      const ownerResult = await sendSms({ to: ownerPhone, from: aiNumber, message: messages.owner });
      progress.agentTestOwnerAcceptedAt = new Date().toISOString();
      progress.agentTestOwnerProviderStatus = clean(ownerResult?.status || "accepted", 40);
      progress.agentTestOwnerMessageSid = clean(ownerResult?.sid, 80);
      persist({ ...common, ...progress });
    }
    if (force || !progress.agentTestCustomerAcceptedAt) {
      const customerResult = await sendSms({ to: ownerPhone, from: aiNumber, message: messages.customer });
      progress.agentTestCustomerAcceptedAt = new Date().toISOString();
      progress.agentTestCustomerProviderStatus = clean(customerResult?.status || "accepted", 40);
      progress.agentTestCustomerMessageSid = clean(customerResult?.sid, 80);
      persist({ ...common, ...progress });
    }
    const completed = {
      ...common,
      ...progress,
      agentTestStatus: "passed",
      agentTestCheckedAt: new Date().toISOString(),
    };
    persist(completed);
    return { passed: true, skipped: false, fingerprint, ownerAccepted: true, customerAccepted: true };
  } catch (error) {
    persist({
      ...common,
      ...progress,
      agentTestStatus: "failed",
      agentTestCheckedAt: new Date().toISOString(),
      agentTestErrorCode: clean(error?.providerSignal || error?.providerCode || error?.code || "AGENT_TEXT_TEST_FAILED", 120),
    });
    throw error;
  }
}

module.exports = {
  AGENT_TEST_VERSION,
  assessAgentRouteBinding,
  buildAgentReadiness,
  enforceAgentTestReadyStatus,
  buildAgentRouteFingerprint,
  getAgentTestDeliveryUpdate,
  buildAgentTestFingerprint,
  buildAgentTestMessages,
  normalizePhone,
  runAgentTextTest,
};
