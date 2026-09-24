const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildSignupVerificationText,
  deliverSignupVerificationText,
} = require("../server/signupSmsVerification");

test("website signup verification text contains the secure link and expiry", () => {
  const text = buildSignupVerificationText({
    businessName: "Test Electric",
    verificationUrl: "https://api.myaipa.ca/api/integrations/verify-signup-contact?token=signed",
  });
  assert.match(text, /Test Electric/);
  assert.match(text, /verify-signup-contact\?token=signed/);
  assert.match(text, /expires in 24 hours/i);
});

test("website signup verification requires a real provider acceptance", async () => {
  await assert.rejects(
    deliverSignupVerificationText({
      ownerPhone: "905-555-0123",
      businessName: "Test Electric",
      verificationUrl: "https://api.myaipa.ca/api/integrations/verify-signup-contact?token=signed",
      sendSms: async () => ({ mocked: true }),
    }),
    (error) => error.code === "SIGNUP_SMS_VERIFICATION_NOT_SENT" && error.statusCode === 503
  );
});

test("website signup verification normalizes the destination without making a paid call", async () => {
  let request;
  const delivered = await deliverSignupVerificationText({
    ownerPhone: "(905) 555-0123",
    businessName: "Test Electric",
    verificationUrl: "https://api.myaipa.ca/api/integrations/verify-signup-contact?token=signed",
    sendSms: async (value) => {
      request = value;
      return { mocked: false, provider: "test", sid: "SM_TEST", status: "queued" };
    },
  });
  assert.equal(request.to, "+19055550123");
  assert.equal(delivered.to, "+19055550123");
  assert.match(request.message, /tap to verify your phone/i);
});

test("website signup verification rejects non-HTTPS links and malformed phones", async () => {
  await assert.rejects(
    deliverSignupVerificationText({ ownerPhone: "not-a-phone", verificationUrl: "https://api.myaipa.ca/verify" }),
    /valid E\.164 phone number/i
  );
  await assert.rejects(
    deliverSignupVerificationText({ ownerPhone: "+19055550123", verificationUrl: "http://api.myaipa.ca/verify" }),
    (error) => error.code === "SIGNUP_VERIFICATION_URL_INVALID"
  );
});
