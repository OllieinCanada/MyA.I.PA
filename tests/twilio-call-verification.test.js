const assert = require("node:assert/strict");
const test = require("node:test");
const { placeForwardingVerificationCall } = require("../server/twilioCallVerification");

test("retired Twilio test-call adapter rejects even configured credentials without contacting Twilio", async () => {
  let requests = 0;
  await assert.rejects(() => placeForwardingVerificationCall({
    to: "+19055550123",
    from: "+12895550199",
    statusCallbackUrl: "https://api.example.ca/api/webhooks/twilio/forwarding-verification-status",
    attemptId: "attempt-1",
    env: { TWILIO_ACCOUNT_SID: "AC123", TWILIO_API_KEY_SID: "SK123", TWILIO_API_KEY_SECRET: "secret" },
    fetchImpl: async () => { requests += 1; throw new Error("Must not reach Twilio"); },
  }), error => error.statusCode === 410 && error.code === "FORWARDING_TEST_CALLS_DISABLED");
  assert.equal(requests, 0);
});

test("missing configuration and repeated old requests cannot enable test calls", async () => {
  for (let index = 0; index < 2; index += 1) {
    await assert.rejects(() => placeForwardingVerificationCall(), error => error.code === "FORWARDING_TEST_CALLS_DISABLED");
  }
});
