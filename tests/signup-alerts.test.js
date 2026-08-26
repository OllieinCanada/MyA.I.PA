const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildSignupTelegramAlert,
  sendSignupTelegramAlert,
} = require("../server/signupAlerts");

test("signup alert is actionable without customer contact details", () => {
  const text = buildSignupTelegramAlert({
    businessName: "Example Electrical",
    state: "provisioning_failed",
    source: "voice",
    eventKey: "signup_1234567890abcdef1234567890abcdef",
    detail: "Make response was incomplete",
    reasonCode: "MAKE_SIGNUP_RESPONSE_INCOMPLETE",
    incidentId: "abcdef1234567890abcdef12",
    payload: {
      business: { name: "Example Electrical", services: "Panel upgrades and hot-tub wiring" },
      owner: { email: "private@example.com", phone: "+19055550123" },
      aiAssistant: { businessType: "Electrical contractor", serviceArea: "Hamilton" },
    },
    record: { makeStatus: 200, makeResponseKind: "acknowledged_incomplete" },
    adminUrl: "https://www.myaipa.ca/#/admin?tab=attention&incident=abcdef1234567890abcdef12",
  });
  assert.match(text, /CRITICAL INCIDENT/);
  assert.match(text, /Example Electrical/);
  assert.match(text, /14-day trial and AI phone-assistant setup/);
  assert.match(text, /Business type: Electrical contractor/);
  assert.match(text, /Service area: Hamilton/);
  assert.match(text, /Attempt reference: 7890abcdef/);
  assert.match(text, /returned HTTP 200/);
  assert.match(text, /DO THIS NEXT/);
  assert.doesNotMatch(text, /private@example\.com|9055550123/);
});

test("signup alert sends one Telegram message through the injected client", async () => {
  const calls = [];
  const result = await sendSignupTelegramAlert({
    businessName: "Example Electrical",
    state: "received",
    source: "website",
    eventKey: "signup_1234567890abcdef1234567890abcdef",
  }, {
    token: "test-token",
    chatId: "test-chat",
    fetchImpl: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  assert.equal(result.sent, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.chat_id, "test-chat");
  assert.match(calls[0].body.text, /WHAT THIS SIGNUP IS FOR/);
});

test("failed signup Telegram delivery includes an exact incident button and honest unknown cause", async () => {
  const calls = [];
  await sendSignupTelegramAlert({
    businessName: "Example Electrical",
    state: "provisioning_failed",
    source: "voice",
    eventKey: "signup_1234567890abcdef1234567890abcdef",
    detail: "Provider returned unfamiliar state",
    reasonCode: "NEW_UNKNOWN_PROVIDER_STATE",
    incidentId: "abcdef1234567890abcdef12",
    adminUrl: "https://www.myaipa.ca/#/admin?tab=attention&incident=abcdef1234567890abcdef12",
  }, {
    token: "test-token",
    chatId: "test-chat",
    fetchImpl: async (_url, options) => {
      calls.push(JSON.parse(options.body));
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  assert.match(calls[0].text, /Cause not confirmed yet/);
  assert.equal(
    calls[0].reply_markup.inline_keyboard[0][0].url,
    "https://www.myaipa.ca/#/admin?tab=attention&incident=abcdef1234567890abcdef12"
  );
});
