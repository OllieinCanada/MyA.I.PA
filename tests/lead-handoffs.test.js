const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildAcknowledgementUrl,
  buildOwnerLeadMessage,
  makeAcknowledgementToken,
  normalizeExternalSmsResult,
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

test("external Vapi tool results keep Vapi as sender without requiring acknowledgement", () => {
  assert.deepEqual(
    normalizeExternalSmsResult({
      owner: { sent: true, sid: "SM123", to: "+19055550123", attemptCount: 2 },
    }),
    {
      status: "SENT",
      owner: {
        sent: true,
        phone: "+19055550123",
        from: "",
        messageId: "SM123",
        attemptCount: 2,
        errorCode: "",
        errorMessage: "",
      },
      backup: {
        sent: false,
        phone: "",
        from: "",
        messageId: "",
        attemptCount: 1,
        errorCode: "",
        errorMessage: "",
      },
    }
  );
});

test("external Vapi tool results record backup escalation only after owner failure", () => {
  const result = normalizeExternalSmsResult({
    owner: { sent: false, errorCode: "provider_error", attemptCount: 3 },
    backup: { sent: true, sid: "SMBACKUP", to: "+19055550999" },
  });
  assert.equal(result.status, "ESCALATED");
  assert.equal(result.owner.attemptCount, 3);
  assert.equal(result.backup.sent, true);
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
