const test = require("node:test");
const assert = require("node:assert/strict");
const { selectTrialSignup } = require("../server/trialSignupSelection");
const config = { businessId: 1, subscriptionId: "sub_live", phoneNumber: "+19055550123", assistantId: "agent", phoneNumberId: "phone" };
const live = { businessId: 1, subscriptionId: "sub_live", twilioPhoneNumber: config.phoneNumber, vapiAssistantId: "agent", vapiPhoneNumberId: "phone", ownerEmail: "owner@example.test", status: "setup_ready" };
test("a newer closed record sharing the email cannot hijack the live route", () => {
  const old = { ...live, subscriptionId: "sub_old", twilioPhoneNumber: "+19055550999", status: "archived" };
  assert.equal(selectTrialSignup([old, live], config), live);
});
test("route selection fails closed for missing, mismatched, or ambiguous identities", () => {
  assert.equal(selectTrialSignup([live, { ...live }], config), null);
  for (const field of ["subscriptionId", "vapiAssistantId", "vapiPhoneNumberId", "businessId", "twilioPhoneNumber"]) {
    assert.equal(selectTrialSignup([{ ...live, [field]: "wrong" }], config), null);
  }
  assert.equal(selectTrialSignup([live], { ...config, phoneNumber: "" }), null);
});
