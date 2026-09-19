const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { rootPath } = require("./_helpers");
const {
  normalizeSignupProvisioningPayload,
  verifySignupProvisioningAuthorization,
} = require("../server/signupProvisioning");
const {
  AGENT_TEST_VERSION,
  buildAgentReadiness,
  buildAgentRouteFingerprint,
  buildAgentTestFingerprint,
  enforceAgentTestReadyStatus,
  getAgentTestDeliveryUpdate,
  runAgentTextTest,
} = require("../server/signupAgentTesting");

const SIGNING_SECRET = "local-release-simulation-only-signing-secret";
const countArgument = process.argv.find((value) => value.startsWith("--count="));
const count = Number(countArgument ? countArgument.slice(8) : 20);
const outputPath = rootPath("diagnostics", "shipping-readiness", "signup-local-simulation.json");
const carriers = ["bell", "rogers", "telus", "other", "not_sure"];
const lineTypes = ["mobile", "landline", "voip", "not_sure"];

function payloadFor(index, submittedAt) {
  const serial = String(index).padStart(2, "0");
  return {
    event: "signup.completed",
    submittedAt,
    source: { app: index % 2 ? "my-ai-pa-web-signup" : "my-ai-pa-voice-signup", channel: index % 2 ? "website" : "phone" },
    business: {
      name: `Synthetic Release Business ${serial}`,
      phone: `+190555510${serial}`,
      address: `${100 + index} Test Street, Hamilton, ON L8L 1A1`,
      services: "Synthetic electrical test requests only",
    },
    owner: {
      name: `Test Owner ${serial}`,
      email: `release-signup-${serial}@example.invalid`,
      phone: `+128955520${serial}`,
    },
    aiAssistant: {
      businessType: index % 2 ? "Electrical" : "Plumbing",
      serviceArea: "Hamilton and Niagara",
      callForwardingNumber: `+12895552${serial}`,
      tone: "Professional",
    },
    callForwarding: {
      existingBusinessNumber: `+190555510${serial}`,
      carrier: carriers[index % carriers.length],
      lineType: lineTypes[index % lineTypes.length],
      forwardingMode: "no_answer",
    },
    security: { synthetic: true, doNotContact: true },
  };
}

function completeBusiness(index, signup) {
  return {
    id: index,
    settings: { ownerPhone: signup.ownerPhone },
    vapiMappings: [
      { matchType: "phoneNumber", matchValue: signup.twilioPhoneNumber },
      { matchType: "phoneNumberId", matchValue: signup.vapiPhoneNumberId },
      { matchType: "assistantId", matchValue: signup.vapiAssistantId },
    ],
  };
}

async function simulateOne(index) {
  const first = normalizeSignupProvisioningPayload(payloadFor(index, "2026-09-07T12:00:00.000Z"), { signingSecret: SIGNING_SECRET });
  const retry = normalizeSignupProvisioningPayload(payloadFor(index, "2026-09-07T12:05:00.000Z"), { signingSecret: SIGNING_SECRET });
  assert.equal(first.provisioning.idempotencyKey, retry.provisioning.idempotencyKey);
  assert.equal(first.provisioning.contextHash, retry.provisioning.contextHash);
  assert.deepEqual(first.provisioning.resources, retry.provisioning.resources);
  assert.equal(verifySignupProvisioningAuthorization(first, SIGNING_SECRET), true);
  assert.equal(first.callForwarding.forwardingMode, "no_answer");

  const serial = String(index).padStart(2, "0");
  const signup = {
    status: "setup_ready",
    businessId: index,
    businessName: first.business.name,
    ownerName: first.owner.name,
    ownerPhone: first.owner.phone,
    twilioPhoneNumber: `+124955530${serial}`,
    vapiPhoneNumberId: `pn_synthetic_${serial}`,
    vapiAssistantId: `asst_synthetic_${serial}`,
    smsRoutingStatus: "healthy",
    agentContentStatus: "verified",
    agentContentFingerprint: `synthetic-content-${serial}`,
    agentContentVerifiedAt: "2026-09-07T12:05:30.000Z",
    agentRouteBindingStatus: "verified",
    agentRouteBindingMode: index % 2 ? "direct" : "trial-gate",
    agentRouteBindingVerifiedAt: "2026-09-07T12:06:00.000Z",
  };
  signup.agentRouteBindingFingerprint = buildAgentRouteFingerprint({
    mode: signup.agentRouteBindingMode,
    businessId: signup.businessId,
    phoneNumberId: signup.vapiPhoneNumberId,
    aiNumber: signup.twilioPhoneNumber,
    assistantId: signup.vapiAssistantId,
  });

  const sent = [];
  let simulatedTimeout = index % 5 === 0;
  const persist = (fields) => Object.assign(signup, fields);
  const sendSms = async (message) => {
    sent.push(message);
    if (simulatedTimeout && sent.length === 2) {
      simulatedTimeout = false;
      const error = new Error("synthetic provider timeout");
      error.code = "ETIMEDOUT";
      throw error;
    }
    return { status: "queued", sid: `SM_SYNTHETIC_${serial}_${sent.length}` };
  };

  await runAgentTextTest({ signup, sendSms, persist });
  Object.assign(signup, getAgentTestDeliveryUpdate({
    signup,
    messageSid: signup.agentTestOwnerMessageSid,
    status: "delivered",
    now: "2026-09-07T12:07:00.000Z",
  }));

  let retried = false;
  try {
    await runAgentTextTest({ signup, sendSms, persist });
  } catch (error) {
    assert.equal(error.code, "ETIMEDOUT");
    retried = true;
    await runAgentTextTest({ signup, sendSms, persist });
  }
  Object.assign(signup, getAgentTestDeliveryUpdate({
    signup,
    messageSid: signup.agentTestCustomerMessageSid,
    status: "delivered",
    now: "2026-09-07T12:08:00.000Z",
  }));
  await runAgentTextTest({ signup, sendSms, persist });

  signup.agentTestVersion = AGENT_TEST_VERSION;
  const business = completeBusiness(index, signup);
  const readiness = buildAgentReadiness({ signup, business });
  assert.equal(readiness.passed, true);
  assert.equal(enforceAgentTestReadyStatus(signup).status, "setup_ready");

  const missingMapping = buildAgentReadiness({
    signup,
    business: { ...business, vapiMappings: business.vapiMappings.filter((mapping) => mapping.matchType !== "assistantId") },
  });
  assert.equal(missingMapping.passed, false);
  assert.equal(missingMapping.checks.find((check) => check.key === "assistant-mapping").done, false);

  const failedCallback = getAgentTestDeliveryUpdate({
    signup,
    messageSid: signup.agentTestCustomerMessageSid,
    status: "undelivered",
    errorCode: "30003",
  });
  const failedSignup = {
    ...signup,
    ...failedCallback,
    agentTestFingerprint: buildAgentTestFingerprint({
      assistantId: signup.vapiAssistantId,
      aiNumber: signup.twilioPhoneNumber,
      ownerPhone: signup.ownerPhone,
      contentFingerprint: signup.agentContentFingerprint,
    }),
  };
  assert.equal(enforceAgentTestReadyStatus(failedSignup).status, "agent_testing");

  return {
    index,
    channel: first.source.channel,
    idempotentRetry: true,
    timeoutRecovered: retried,
    mappingGateRejectedIncomplete: true,
    deliveryFailureRevokedReadiness: true,
    finalReady: true,
  };
}

async function main() {
  if (!Number.isInteger(count) || count < 20 || count > 100) throw new Error("--count must be an integer from 20 to 100.");
  const results = [];
  for (let index = 1; index <= count; index += 1) results.push(await simulateOne(index));
  const report = {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    mode: "local-mocked-no-external-resources",
    requested: count,
    attempted: results.length,
    consecutivePasses: results.filter((result) => result.finalReady).length,
    duplicateRetriesChecked: results.length,
    providerTimeoutsRecovered: results.filter((result) => result.timeoutRecovered).length,
    incompleteMappingsRejected: results.filter((result) => result.mappingGateRejectedIncomplete).length,
    failedDeliveryCallbacksRejected: results.filter((result) => result.deliveryFailureRevokedReadiness).length,
    paidCallsOrMessages: 0,
    externalResourcesCreated: 0,
    ready: results.length === count && results.every((result) => result.finalReady),
    results,
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
  console.log(`Local signup simulation report written to ${outputPath}`);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exitCode = 1;
});
