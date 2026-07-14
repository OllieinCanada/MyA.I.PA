const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildAcknowledgementUrl,
  buildOwnerLeadMessage,
  makeAcknowledgementToken,
  parseAcknowledgementToken,
} = require("../server/leadHandoffs");

const env = {
  LEAD_ACK_SECRET: "unit-test-secret-with-enough-entropy",
  LEAD_ACK_BASE_URL: "https://api.myaipa.ca/",
};

test("acknowledgement tokens are signed and tamper evident", () => {
  const token = makeAcknowledgementToken("public-key", env);
  assert.equal(parseAcknowledgementToken(token, env), "public-key");
  assert.equal(parseAcknowledgementToken(`${token}x`, env), null);
  assert.equal(parseAcknowledgementToken("public-key.invalid", env), null);
});

test("acknowledgement URL points to the public API and carries no lead details", () => {
  const url = buildAcknowledgementUrl("public-key", env);
  assert.match(url, /^https:\/\/api\.myaipa\.ca\/api\/leads\/acknowledge\?token=/);
  assert.doesNotMatch(url, /Brian|905|quote/i);
});

test("owner message includes the lead and an explicit acknowledgement action", () => {
  const message = buildOwnerLeadMessage({
    lead: { intent: "QUOTE", name: "Brian", callbackNumber: "905-555-1234", summary: "Hot tub installation" },
    acknowledgementUrl: "https://api.myaipa.ca/api/leads/acknowledge?token=signed",
  });
  assert.match(message, /New quote lead: Brian, 905-555-1234/);
  assert.match(message, /Acknowledge lead:/);
  assert.ok(message.length <= 1600);
});
