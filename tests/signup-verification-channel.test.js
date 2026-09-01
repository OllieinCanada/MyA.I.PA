const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildVerificationState,
  createVerificationChannelProof,
  isContactVerified,
  normalizeVerificationChannel,
  verifyVerificationChannelProof,
} = require("../server/signupVerificationChannel");

test("records the channel that was actually verified", () => {
  const sms = buildVerificationState("sms", {}, "2026-08-31T00:00:00.000Z");
  assert.equal(sms.smsVerified, true);
  assert.equal(sms.emailVerified, false);
  assert.equal(sms.identityVerified, true);
  assert.equal(sms.verificationChannel, "sms");
  assert.equal(isContactVerified(sms), true);
});

test("channel proof prevents an SMS link from being relabelled as email", () => {
  const proof = createVerificationChannelProof("token-1", "sms", "test-secret");
  assert.equal(verifyVerificationChannelProof("token-1", "sms", proof, "test-secret"), true);
  assert.equal(verifyVerificationChannelProof("token-1", "email", proof, "test-secret"), false);
  assert.equal(verifyVerificationChannelProof("token-2", "sms", proof, "test-secret"), false);
});

test("defaults old channel-less links to email for compatibility", () => {
  assert.equal(normalizeVerificationChannel(""), "email");
  assert.equal(buildVerificationState("email").emailVerified, true);
});
