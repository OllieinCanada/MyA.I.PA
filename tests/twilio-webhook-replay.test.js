const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildTwilioReplayIdentity,
  getTwilioRetryToken,
} = require("../server/twilioWebhookReplay");

test("Twilio retry token takes priority over event-derived identity", () => {
  const identity = buildTwilioReplayIdentity({
    headers: { "I-Twilio-Idempotency-Token": "retry-token-12345" },
    body: { MessageSid: "SM123", MessageStatus: "delivered" },
    eventType: "message_status",
  });
  assert.equal(identity, "retry:retry-token-12345");
});

test("message status identity distinguishes status transitions", () => {
  const delivered = buildTwilioReplayIdentity({
    body: { MessageSid: "SM123", MessageStatus: "delivered" },
    eventType: "message_status",
  });
  const failed = buildTwilioReplayIdentity({
    body: { MessageSid: "SM123", MessageStatus: "failed", ErrorCode: "30007" },
    eventType: "message_status",
  });
  assert.equal(delivered, "message:SM123:delivered:none");
  assert.equal(failed, "message:SM123:failed:30007");
});

test("inbound SMS and forwarding callbacks require provider SIDs", () => {
  assert.equal(buildTwilioReplayIdentity({ body: { MessageSid: "SM456" }, eventType: "inbound_sms" }), "sms:SM456");
  assert.equal(buildTwilioReplayIdentity({ body: { CallSid: "CA456", CallStatus: "completed" }, eventType: "forwarding_verification_status" }), "forwarding:CA456:completed:unknown");
  assert.equal(buildTwilioReplayIdentity({ body: {}, eventType: "inbound_sms" }), "");
});

test("malformed retry tokens are ignored", () => {
  assert.equal(getTwilioRetryToken({ "i-twilio-idempotency-token": "bad token" }), "");
});
