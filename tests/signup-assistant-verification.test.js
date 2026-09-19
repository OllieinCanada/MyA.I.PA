const test = require("node:test");
const assert = require("node:assert/strict");

const {
  assessSignupAssistantContent,
  buildExpectedSignupAssistantConfig,
  buildNormalizedPayloadFromSignupRecord,
} = require("../server/signupAssistantVerification");

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

test("includes the saved contractor service list in the expected live script", () => {
  const expectedConfig = buildExpectedSignupAssistantConfig(signup, { resourceName: "signup-agent" });
  const prompt = expectedConfig.model.messages[0].content;
  assert.match(prompt, /Services: Panel upgrades EV charger installs/);
});
