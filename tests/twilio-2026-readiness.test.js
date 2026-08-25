const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  alertCode,
  assessTwilioReadiness,
  isHttps,
  last4,
  latestTimestamp,
  shortHash,
} = require("../scripts/audit-twilio-2026-readiness");

test("Twilio readiness report contains only redacted number identifiers and aggregates", () => {
  const report = assessTwilioReadiness({
    account: { sid: "AC123456789", status: "active", type: "full" },
    numbers: [{
      sid: "PN123456789",
      phone_number: "+19055551234",
      capabilities: { voice: true, sms: true, mms: false },
      voice_url: "https://api.vapi.ai/twilio/inbound_call",
      sms_url: "https://api.myaipa.ca/api/webhooks/sms",
    }],
    messages: [{
      direction: "outbound-api",
      status: "delivered",
      to: "+19055559876",
      from: "+19055551234",
      body: "Private customer message",
      num_segments: "1",
    }],
    calls: [{ direction: "inbound", status: "completed", duration: "60", from: "+19055559876" }],
    credentialMode: "api_key",
    protectedTools: [{ name: "send_call_summaries_test", apiKeyConfigured: true, statusCallbackHttps: true }],
    complianceProfiles: [{ sid: "BU_PRIVATE", status: "twilio-approved", friendly_name: "Private company name" }],
  });
  const serialized = JSON.stringify(report);
  assert.equal(report.phoneNumbers.numbers[0].last4, "1234");
  assert.equal(report.messaging.observedDeliveryRatePercent, 100);
  assert.equal(report.voice.minutes, 1);
  assert.equal(report.trust.approvedProfilePresent, true);
  assert.doesNotMatch(serialized, /\+19055551234|\+19055559876|Private customer message/);
  assert.doesNotMatch(serialized, /Private company name|BU_PRIVATE/);
});

test("readiness recommendations identify master-token, callback, consent and delivery gaps", () => {
  const report = assessTwilioReadiness({
    account: { sid: "AC1", status: "active" },
    credentialMode: "auth_token",
    numbers: [{
      sid: "PN1",
      phone_number: "+19055551234",
      capabilities: { voice: true, sms: true },
      voice_url: "https://api.vapi.ai/inbound",
      sms_url: "https://api.vapi.ai/sms",
    }],
    messages: [{ direction: "outbound-api", status: "undelivered", error_code: 30007 }],
    protectedTools: [{ name: "send_call_summaries_test", apiKeyConfigured: false, statusCallbackHttps: false }],
  });
  const actions = report.recommendations.map((item) => item.action).join("\n");
  assert.match(actions, /restricted Twilio REST API key/i);
  assert.match(actions, /delivery-status callback/i);
  assert.match(actions, /consent proxy/i);
  assert.match(actions, /failed or undelivered/i);
  assert.deepEqual(report.messaging.errorCodes, { "30007": 1 });
});

test("privacy helpers accept HTTPS only and never expose full identifiers", () => {
  assert.equal(isHttps("https://api.example.test/hook"), true);
  assert.equal(isHttps("http://api.example.test/hook"), false);
  assert.equal(last4("+1 (905) 555-1234"), "1234");
  assert.equal(shortHash("secret-id").length, 12);
  assert.doesNotMatch(shortHash("secret-id"), /secret-id/);
  assert.equal(alertCode({ alert_text: "msg=private+url&ErrorCode=11200&LogLevel=error" }), "11200");
  assert.equal(
    latestTimestamp([{ date_created: "2026-08-01T00:00:00Z" }, { date_created: "2026-08-02T00:00:00Z" }], ["date_created"]),
    "2026-08-02T00:00:00.000Z"
  );
});
