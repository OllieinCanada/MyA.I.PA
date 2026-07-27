const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildVoiceSignupPayload,
  isVapiVoiceSignupTool,
  normalizeNanpPhone,
  normalizePostalCode,
} = require("../server/voiceSignup");

const validSignup = {
  callerConfirmed: true,
  confirmationText: "Yes, that is correct. Please start my signup.",
  ownerName: "Ron Cournoyer",
  ownerEmail: "ron@example.ca",
  ownerPhone: "905-555-0199",
  businessName: "Example Electric",
  businessPhone: "(905) 555-0199",
  streetAddress: "23 Robb Street",
  city: "Hamilton",
  province: "ON",
  postalCode: "L8L 1A1",
  businessType: "Electrical",
  serviceArea: "Hamilton and Burlington",
  services: "Residential electrical repairs, panel upgrades, and hot tub wiring",
  specializations: ["Residential", "Service calls"],
};

test("builds the canonical Make signup payload from a confirmed phone signup", () => {
  const payload = buildVoiceSignupPayload(validSignup, {
    callId: "call-voice-signup-1",
    submittedAt: "2026-07-27T12:00:00.000Z",
  });

  assert.equal(payload.event, "signup.completed");
  assert.equal(payload.source.app, "my-ai-pa-voice-signup");
  assert.equal(payload.source.channel, "phone");
  assert.equal(payload.source.callId, "call-voice-signup-1");
  assert.equal(payload.business.name, "Example Electric");
  assert.equal(payload.business.phone, "+19055550199");
  assert.equal(payload.business.address, "23 Robb Street, Hamilton, ON L8L 1A1");
  assert.equal(payload.owner.email, "ron@example.ca");
  assert.equal(payload.owner.phone, "+19055550199");
  assert.equal(payload.verification.emailVerified, false);
  assert.equal(payload.security.emailVerificationRequired, true);
  assert.equal(payload.aiAssistant.callForwardingNumber, "+19055550199");
});

test("refuses to begin a phone signup without explicit caller confirmation", () => {
  assert.throws(
    () => buildVoiceSignupPayload({ ...validSignup, callerConfirmed: false }),
    (error) => error.code === "VOICE_SIGNUP_CONFIRMATION_REQUIRED"
  );
  assert.throws(
    () => buildVoiceSignupPayload({ ...validSignup, confirmationText: "" }),
    (error) => error.code === "VOICE_SIGNUP_CONFIRMATION_REQUIRED"
  );
});

test("requires complete contact and business setup details before entering Make", () => {
  for (const field of [
    "ownerName",
    "ownerEmail",
    "ownerPhone",
    "businessName",
    "streetAddress",
    "city",
    "province",
    "postalCode",
    "businessType",
    "serviceArea",
    "services",
  ]) {
    assert.throws(
      () => buildVoiceSignupPayload({ ...validSignup, [field]: "" }),
      (error) => error.field === field
    );
  }
});

test("normalizes NANP phone numbers and Canadian postal codes", () => {
  assert.equal(normalizeNanpPhone("1-905-555-0199", "phone"), "+19055550199");
  assert.equal(normalizePostalCode("l8l1a1"), "L8L 1A1");
  assert.throws(() => normalizeNanpPhone("555", "phone"), /ten-digit/i);
  assert.throws(() => normalizePostalCode("12345"), /Canadian postal code/i);
});

test("recognizes only the dedicated My AI PA signup tool names", () => {
  assert.equal(isVapiVoiceSignupTool("begin_myaipa_signup"), true);
  assert.equal(isVapiVoiceSignupTool("START_MYAIPA_SIGNUP"), true);
  assert.equal(isVapiVoiceSignupTool("send_signup_sms"), false);
});
