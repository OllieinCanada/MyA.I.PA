const assert = require("node:assert/strict");
const test = require("node:test");
const { placeForwardingVerificationCall } = require("../server/twilioCallVerification");

test("verification call uses scoped credentials, callback, no recording, and injected fetch", async () => {
  let request;
  const result = await placeForwardingVerificationCall({
    to: "+19055550123",
    from: "+12895550199",
    statusCallbackUrl: "https://api.example.ca/api/webhooks/twilio/forwarding-verification-status",
    attemptId: "attempt-1",
    env: { TWILIO_ACCOUNT_SID: "AC123", TWILIO_API_KEY_SID: "SK123", TWILIO_API_KEY_SECRET: "secret" },
    fetchImpl: async (url, options) => {
      request = { url, options, body: Object.fromEntries(options.body.entries()) };
      return { ok: true, status: 201, text: async () => JSON.stringify({ sid: "CA123", status: "queued" }) };
    },
  });
  assert.equal(result.sid, "CA123");
  assert.match(request.options.headers.Authorization, /^Basic /);
  assert.equal(request.body.To, "+19055550123");
  assert.equal(request.body.From, "+12895550199");
  assert.equal(request.body.Recording, "false");
  assert.match(request.body.StatusCallback, /^https:\/\//);
  assert.match(request.body.Twiml, /Pause/);
});

test("normal tests never place a real call and provider failures remain visible", async () => {
  await assert.rejects(() => placeForwardingVerificationCall({
    to: "+19055550123", from: "+12895550199", statusCallbackUrl: "https://api.example.ca/callback",
    env: { TWILIO_ACCOUNT_SID: "AC123", TWILIO_AUTH_TOKEN: "token" },
    fetchImpl: async () => ({ ok: false, status: 400, text: async () => JSON.stringify({ code: 21211, message: "Invalid To" }) }),
  }), (error) => error.code === "FORWARDING_VERIFICATION_CALL_FAILED" && error.providerCode === 21211);
});
