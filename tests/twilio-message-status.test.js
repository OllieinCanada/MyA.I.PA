const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildTwilioMessageStatusIncident,
  messageReference,
} = require("../server/twilioMessageStatus");
const { buildRuntimeIncident } = require("../server/runtimeAlerts");

test("successful and in-progress Twilio message statuses do not create incidents", () => {
  for (const status of ["accepted", "queued", "sending", "sent", "delivered", "read"]) {
    assert.equal(buildTwilioMessageStatusIncident({ MessageStatus: status, MessageSid: "SM_TEST" }), null);
  }
});

test("failed delivery status becomes a deduplicated safe Telegram incident", () => {
  const prepared = buildTwilioMessageStatusIncident({
    MessageStatus: "undelivered",
    MessageSid: "SM_PRIVATE_PROVIDER_IDENTIFIER",
    ErrorCode: "30003",
    ErrorMessage: "raw provider text must not be retained",
    To: "+19055550123",
    Body: "private message contents",
  });
  assert.ok(prepared);
  assert.equal(prepared.error.providerCode, "30003");
  assert.equal(prepared.context.snapshot["Delivery status"], "undelivered");
  assert.equal(prepared.context.snapshot["Message reference"], messageReference("SM_PRIVATE_PROVIDER_IDENTIFIER"));

  const incident = buildRuntimeIncident(prepared.error, prepared.context);
  const serialized = JSON.stringify(incident);
  assert.equal(incident.reasonCode, "30003");
  assert.equal(incident.snapshot["Failure category"], "delivery");
  assert.match(incident.nextAction, /Twilio/i);
  assert.doesNotMatch(serialized, /SM_PRIVATE|9055550123|private message|raw provider/i);
});

test("unknown Twilio delivery codes retain the confirmed delivery category without inventing a cause", () => {
  const prepared = buildTwilioMessageStatusIncident({
    MessageStatus: "failed",
    MessageSid: "SM_UNKNOWN",
    ErrorCode: "39999",
  });
  const incident = buildRuntimeIncident(prepared.error, prepared.context);
  assert.equal(incident.reasonCode, "39999");
  assert.equal(incident.snapshot["Failure category"], "delivery");
  assert.match(incident.reason, /could not deliver/i);
  assert.match(incident.nextAction, /allowlisted delivery code/i);
});
