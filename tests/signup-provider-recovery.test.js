const assert = require("node:assert/strict");
const test = require("node:test");

process.env.DATABASE_URL ||= "postgresql://test:test@127.0.0.1:5432/test";
process.env.JWT_SECRET ||= "test-only-jwt-secret-that-is-long-enough";

const { __test } = require("../server/index");

const phone = "+12895550123";
const assistantId = "assistant-exact";
const phoneNumberId = "phone-exact";

function completed(result) {
  return { status: "completed", result };
}

function validReadback(overrides = {}) {
  return {
    signup: {
      twilioPhoneNumber: phone,
      vapiAssistantId: assistantId,
      vapiPhoneNumberId: phoneNumberId,
    },
    twilioStep: completed({ twilioPhoneNumber: phone }),
    assistantStep: completed({ assistantId }),
    importStep: completed({ id: phoneNumberId, number: phone, assistantId }),
    twilioNumbers: [{ phone_number: phone, voice_url: "https://hook.make.com/voice", capabilities: { voice: true, sms: true } }],
    vapiNumbers: [{ id: phoneNumberId, number: phone, assistantId }],
    vapiAssistants: [{ id: assistantId }],
    ...overrides,
  };
}

test("reconstructs a completed Make receipt only when durable state and both providers agree", () => {
  assert.deepEqual(__test.buildProvisioningReadbackAssessment(validReadback()), {
    complete: true,
    kind: "completed_from_durable_provider_readback",
    code: "",
    providerCode: "",
    twilioPhoneNumber: phone,
    vapiPhoneNumberId: phoneNumberId,
    vapiAssistantId: assistantId,
  });
});

test("refuses recovery when the live Vapi phone is attached to another assistant", () => {
  assert.throws(
    () => __test.buildProvisioningReadbackAssessment(validReadback({
      vapiNumbers: [{ id: phoneNumberId, number: phone, assistantId: "assistant-other" }],
    })),
    (error) => error.code === "SIGNUP_RECOVERY_VAPI_BINDING_MISMATCH"
  );
});

test("refuses recovery when more than one live provider record matches", () => {
  const twilioRecord = { phone_number: phone, voice_url: "https://hook.make.com/voice", capabilities: { voice: true, sms: true } };
  assert.throws(
    () => __test.buildProvisioningReadbackAssessment(validReadback({ twilioNumbers: [twilioRecord, { ...twilioRecord }] })),
    (error) => error.code === "SIGNUP_RECOVERY_PROVIDER_PAIR_AMBIGUOUS"
  );
});

test("requires pending recovery identity to match the saved signup", () => {
  const payload = {
    owner: { email: "owner@example.ca", phone: "+19055550199" },
    business: { name: "Example Electric" },
  };
  const identity = __test.assertPendingSignupRecoveryIdentity({
    ownerEmail: "OWNER@example.ca",
    ownerPhone: "(905) 555-0199",
    businessName: " Example   Electric ",
  }, payload);
  assert.equal(identity.ownerEmail, "owner@example.ca");
  assert.equal(identity.ownerPhone, "+19055550199");

  assert.throws(
    () => __test.assertPendingSignupRecoveryIdentity({
      ownerEmail: "other@example.ca",
      ownerPhone: "+19055550199",
      businessName: "Example Electric",
    }, payload),
    (error) => error.code === "SIGNUP_RECOVERY_EMAIL_MISMATCH"
  );
});
