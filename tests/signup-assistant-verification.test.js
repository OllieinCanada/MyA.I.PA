const test = require("node:test");
const assert = require("node:assert/strict");

const {
  assessSignupAssistantContent,
  assessSignupAssistantContentWithReceipt,
  buildExpectedSignupAssistantConfig,
  buildNormalizedPayloadFromSignupRecord,
  getFirstMessage,
} = require("../server/signupAssistantVerification");
const { RECORDING_NOTICE } = require("../server/vapiIsolatedSmsProvisioning");
const { normalizeSignupProvisioningPayload } = require("../server/signupProvisioning");
const { buildSignupAssistantConfig } = require("../server/signupAssistantTemplate");

const signup = {
  businessName: "Example Electric",
  businessType: "Electrical",
  specializations: ["Residential"],
  serviceArea: "Niagara Falls and Hamilton",
  serviceSummary: "Panel upgrades\nEV charger installs",
  ownerPhone: "+19055550199",
  twilioPhoneNumber: "+12895550123",
  offersServiceCalls: true,
  repairVisitFee: "89",
  repairHourlyRate: "129",
};

test("reconstructs the assistant source of truth from the stored signup record", () => {
  const payload = buildNormalizedPayloadFromSignupRecord(signup);
  assert.equal(payload.businessProfile.businessName, "Example Electric");
  assert.equal(payload.setupDetails.businessType, "Electrical");
  assert.equal(payload.setupDetails.serviceArea, "Niagara Falls and Hamilton");
  assert.match(payload.businessProfile.services, /EV charger installs/);
  assert.deepEqual(payload.specializations, ["Residential"]);
});

test("detects a live assistant whose business identity differs from the signup", () => {
  const expectedConfig = buildExpectedSignupAssistantConfig(signup, { resourceName: "signup-agent" });
  const liveAssistant = structuredClone(expectedConfig);
  liveAssistant.model.messages[0].content = liveAssistant.model.messages[0].content.replace(
    "Business type: Electrical",
    "Business type: Personal chatbots"
  );
  const result = assessSignupAssistantContent({ expectedConfig, liveAssistant });
  assert.equal(result.passed, false);
  assert.notEqual(result.expectedFingerprint, result.liveFingerprint);
});

test("accepts only an exact semantic readback of the generated assistant", () => {
  const expectedConfig = buildExpectedSignupAssistantConfig(signup, { resourceName: "signup-agent" });
  const liveAssistant = {
    ...structuredClone(expectedConfig),
    id: "provider-id",
    createdAt: "2026-09-19T00:00:00.000Z",
  };
  const result = assessSignupAssistantContent({ expectedConfig, liveAssistant });
  assert.equal(result.passed, true);
  assert.equal(result.expectedFingerprint, result.liveFingerprint);
});

test("accepts the exact server-owned recording notice without ignoring other greeting changes", () => {
  const expectedConfig = buildExpectedSignupAssistantConfig(signup, { resourceName: "signup-agent" });
  const hardenedAssistant = structuredClone(expectedConfig);
  hardenedAssistant.firstMessage = `${RECORDING_NOTICE} ${expectedConfig.firstMessage}`;

  const accepted = assessSignupAssistantContent({ expectedConfig, liveAssistant: hardenedAssistant });
  assert.equal(accepted.passed, true);
  assert.equal(getFirstMessage(hardenedAssistant), expectedConfig.firstMessage);

  hardenedAssistant.firstMessage += " This unexpected sentence must still fail verification.";
  const rejected = assessSignupAssistantContent({ expectedConfig, liveAssistant: hardenedAssistant });
  assert.equal(rejected.passed, false);
});

test("normalizes the sealed web-form payload before rebuilding its assistant", () => {
  const rawWebPayload = {
    businessProfile: {
      businessName: "Example Electric",
      phone: "9055550199",
      address: "1 Main Street, Hamilton, ON",
      services: "Panel upgrades",
    },
    setupDetails: {
      ownerName: "Pat Example",
      ownerEmail: "pat@example.com",
      ownerPhone: "9055550199",
      businessType: "Electrical",
      serviceArea: "Hamilton",
    },
  };
  const normalized = normalizeSignupProvisioningPayload(rawWebPayload, {
    signingSecret: "test-signing-secret-that-is-long-enough",
    defaultRegion: "ON",
  });
  const config = buildSignupAssistantConfig(normalized, {
    assignedPhone: "+12895550123",
    resourceName: "signup-agent",
  });

  assert.equal(normalized.owner.phone, "+19055550199");
  assert.match(config.model.messages[0].content, /Business type: Electrical/);
});

test("accepts a live assistant verified by the exact durable provisioning receipt", () => {
  const expectedConfig = buildExpectedSignupAssistantConfig(signup, { resourceName: "signup-agent" });
  const liveAssistant = structuredClone(expectedConfig);
  liveAssistant.id = "assistant-123";
  liveAssistant.firstMessage = "A greeting captured from the complete signed signup payload.";
  const baseline = assessSignupAssistantContent({ expectedConfig, liveAssistant });
  assert.equal(baseline.passed, false);

  const result = assessSignupAssistantContentWithReceipt({
    expectedConfig,
    liveAssistant,
    assistantId: "assistant-123",
    durableReceipt: {
      data: {
        status: "completed",
        result: {
          assistantId: "assistant-123",
          contentFingerprint: baseline.liveFingerprint,
        },
      },
    },
  });
  assert.equal(result.passed, true);
  assert.equal(result.verificationSource, "durable_provisioning_receipt");
});

test("rejects a durable receipt for another assistant or another live fingerprint", () => {
  const expectedConfig = buildExpectedSignupAssistantConfig(signup, { resourceName: "signup-agent" });
  const liveAssistant = { ...structuredClone(expectedConfig), id: "assistant-123", firstMessage: "Changed" };
  const baseline = assessSignupAssistantContent({ expectedConfig, liveAssistant });
  for (const result of [
    assessSignupAssistantContentWithReceipt({
      expectedConfig,
      liveAssistant,
      assistantId: "assistant-123",
      durableReceipt: { data: { status: "completed", result: { assistantId: "assistant-other", contentFingerprint: baseline.liveFingerprint } } },
    }),
    assessSignupAssistantContentWithReceipt({
      expectedConfig,
      liveAssistant,
      assistantId: "assistant-123",
      durableReceipt: { data: { status: "completed", result: { assistantId: "assistant-123", contentFingerprint: "wrong" } } },
    }),
  ]) {
    assert.equal(result.passed, false);
    assert.equal(result.verificationSource, "mismatch");
  }
});

test("includes the saved contractor service list in the expected live script", () => {
  const expectedConfig = buildExpectedSignupAssistantConfig(signup, { resourceName: "signup-agent" });
  const prompt = expectedConfig.model.messages[0].content;
  assert.match(prompt, /Services: Panel upgrades EV charger installs/);
});
