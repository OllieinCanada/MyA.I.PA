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
  assert.match(text, /MY AI PA — CRITICAL/);
  assert.match(text, /Example Electrical/);
  assert.match(text, /Make replied without a verified phone and assistant/);
  assert.match(text, /Next:/);
  assert.doesNotMatch(text, /Business type:|Service area:|Attempt reference:/);
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
      calls.push({ url, body: options.body });
      return new Response(JSON.stringify({ ok: true, result: { message_id: 123 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  assert.equal(result.sent, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.get('chat_id'), "test-chat");
  assert.match(calls[0].url, /sendPhoto$/);
  assert.ok(calls[0].body.get('photo'));
  assert.match(calls[0].body.get('caption'), /NEW SIGNUP RECEIVED/);
  assert.ok(calls[0].body.get('caption').length <= 1024);
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
      calls.push({ text: options.body.get('caption'), reply_markup: JSON.parse(options.body.get('reply_markup')) });
      return new Response(JSON.stringify({ ok: true, result: { message_id: 42 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  assert.match(calls[0].text, /Cause not confirmed/);
  assert.equal(
    calls[0].reply_markup.inline_keyboard[0][0].url,
    "https://www.myaipa.ca/#/admin?tab=attention&incident=abcdef1234567890abcdef12"
  );
});

test("signup failure alert distinguishes a Twilio account funding problem and gives the exact action", () => {
  const text = buildSignupTelegramAlert({
    businessName: "Example Electrical",
    state: "provisioning_failed",
    eventKey: "signup_1234567890abcdef1234567890abcdef",
    makeAssessment: {
      failedStage: "TWILIO_NUMBER_PURCHASE",
      provider: "TWILIO",
      providerStatus: 402,
      providerCode: "INSUFFICIENT_BALANCE",
      retryable: false,
    },
    record: { makeResponseKind: "rejected" },
  });

  assert.match(text, /provider account needs funds or credits/);
  assert.match(text, /Twilio Billing/);
  assert.match(text, /Add funds or credits in Twilio Billing/);
  assert.doesNotMatch(text, /Provider HTTP status:|Provider code:/);
  assert.doesNotMatch(text, /Cause not confirmed yet/);
});

test("signup failure alert never labels an unconfirmed Make rejection as billing", () => {
  const text = buildSignupTelegramAlert({
    businessName: "Example Electrical",
    state: "provisioning_failed",
    eventKey: "signup_1234567890abcdef1234567890abcdef",
    detail: "Provider returned unfamiliar state for private@example.ca at +19055550123",
    makeAssessment: {
      failedStage: "VAPI_NUMBER_IMPORT",
      provider: "VAPI",
      retryable: false,
      rawBody: "secret provider response",
    },
    record: { makeResponseKind: "rejected" },
  });

  assert.match(text, /Cause not confirmed/i);
  assert.match(text, /Open the exact incident and provider-safe logs/);
  assert.doesNotMatch(text, /VAPI_NUMBER_IMPORT/);
  assert.doesNotMatch(text, /needs funds|Add funds or credits|private@example\.ca|9055550123|secret provider response/i);
});

test("setup-complete delivery failure preserves the number and directs operations to resend only the follow-up", () => {
  const text = buildSignupTelegramAlert({
    businessName: "Example Electrical",
    state: "customer_followup_failed",
    eventKey: "signup_1234567890abcdef1234567890abcdef",
    detail: "Setup completed, but the assigned-number follow-up could not be delivered",
    reasonCode: "SMTP_RECIPIENT_REJECTED",
    record: {
      twilioPhoneNumber: "+13433216155",
      vapiAssistantId: "assistant-safe-id",
      setupFollowupStatus: "failed",
    },
  });

  assert.match(text, /customer follow-up needs attention/i);
  assert.match(text, /email provider rejected the customer’s email address/i);
  assert.match(text, /Keep the existing number/);
  assert.match(text, /resend only the setup message/);
  assert.doesNotMatch(text, /\(343\) 321-6155|3433216155/);
});

test("signup update shows the assigned AI number but keeps customer contact details private", () => {
  const text = buildSignupTelegramAlert({
    businessName: "Example Painting",
    state: "received",
    eventKey: "signup_1234567890abcdef1234567890abcdef",
    payload: {
      business: { name: "Example Painting" },
      owner: { email: "private@example.com", phone: "+19055550123" },
    },
    record: {
      twilioPhoneNumber: "+12892169256",
      vapiAssistantId: "assistant-safe-id",
    },
  });

  assert.match(text, /Assigned AI number: \+1 \(289\) 216-9256/);
  assert.doesNotMatch(text, /private@example\.com|9055550123/);
});

test("manual-review update says plainly when no AI number has been assigned", () => {
  const text = buildSignupTelegramAlert({
    businessName: "John's Painting",
    state: "received",
    eventKey: "signup_1234567890abcdef1234567890abcdef",
    record: { status: "review_required" },
  });

  assert.match(text, /Assigned AI number: Not assigned yet/);
  assert.match(text, /paused for review/);
});

test("signup cards stay within the caption limit and preserve supplied action buttons", async () => {
  const replyMarkup = { inline_keyboard: [[{ text: 'Open exact signup', url: 'https://www.myaipa.ca/#/admin' }]] };
  await sendSignupTelegramAlert({ state: 'provisioning_ready', businessName: 'Business '.repeat(100),
    record: { businessType: 'Electrical '.repeat(100), serviceArea: 'Niagara '.repeat(100) } }, {
    token: 'test', chatId: '1', replyMarkup, fetchImpl: async (_url, options) => {
      assert.ok(options.body.get('caption').length <= 1024);
      assert.doesNotMatch(options.body.get('caption'), /ELI10|ready for customer calls/i);
      assert.deepEqual(JSON.parse(options.body.get('reply_markup')), replyMarkup);
      return new Response(JSON.stringify({ ok: true, result: { message_id: 9 } }));
    },
  });
  await assert.rejects(sendSignupTelegramAlert({ state: 'received' }, {
    token: 'test', chatId: '1', fetchImpl: async () => new Response(JSON.stringify({ ok: true })),
  }), /not confirmed/);
});
test("verification captions distinguish pending, failed and delivered without exposing full contact", () => {
  for (const [status, title] of [["pending","PENDING"],["failed","FAILED"],["delivered","DELIVERED"]]) {
    const text = buildSignupTelegramAlert({state:"verification_sent",record:{businessName:"Test",ownerPhone:"+19055557422",smsVerificationDeliveryStatus:status}});
    assert.match(text,new RegExp(`VERIFICATION TEXT ${title}`));
    assert.match(text,/Recipient: •••• 7422/);
    assert.doesNotMatch(text,/19055557422/);
  }
});
