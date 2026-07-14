const assert = require("node:assert/strict");
const { test } = require("node:test");
const { normalizeE164, sendSmsViaTwilio } = require("../server/twilioSms");

test("phone numbers are normalized to E.164", () => {
  assert.equal(normalizeE164("(249) 503-3301", "to"), "+12495033301");
  assert.throws(() => normalizeE164("123", "to"), /valid E\.164/);
});

test("development mode returns an explicit mock when Twilio is not configured", async () => {
  const result = await sendSmsViaTwilio({
    to: "+12495033301",
    message: "Test message",
    env: { NODE_ENV: "test" },
  });
  assert.equal(result.mocked, true);
  assert.equal(result.status, "mocked");
});

test("production fails closed when Twilio is not configured", async () => {
  await assert.rejects(
    sendSmsViaTwilio({
      to: "+12495033301",
      message: "Test message",
      env: { NODE_ENV: "production" },
    }),
    (error) => error.statusCode === 503 && /not configured/i.test(error.message)
  );
});

test("configured Twilio requests use Basic auth and form-encoded message fields", async () => {
  let captured;
  const fetchImpl = async (url, options) => {
    captured = { url, options };
    return {
      ok: true,
      status: 201,
      json: async () => ({
        sid: "SM_test_123",
        status: "queued",
        to: "+12495033301",
        from: "+19055550199",
      }),
    };
  };

  const result = await sendSmsViaTwilio({
    to: "+12495033301",
    message: "New service request",
    env: {
      NODE_ENV: "production",
      TWILIO_ACCOUNT_SID: "AC_test_123",
      TWILIO_AUTH_TOKEN: "test-token",
      TWILIO_FROM_NUMBER: "+19055550199",
      TWILIO_API_BASE_URL: "https://api.twilio.test",
    },
    fetchImpl,
  });

  assert.equal(result.mocked, false);
  assert.equal(result.sid, "SM_test_123");
  assert.equal(captured.url, "https://api.twilio.test/2010-04-01/Accounts/AC_test_123/Messages.json");
  assert.match(captured.options.headers.authorization, /^Basic /);
  const body = new URLSearchParams(captured.options.body);
  assert.equal(body.get("To"), "+12495033301");
  assert.equal(body.get("From"), "+19055550199");
  assert.equal(body.get("Body"), "New service request");
});

test("provider failures return a safe gateway error", async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 400,
    json: async () => ({ code: 21211, message: "provider detail that should not become the public error" }),
  });

  await assert.rejects(
    sendSmsViaTwilio({
      to: "+12495033301",
      message: "Test message",
      env: {
        NODE_ENV: "production",
        TWILIO_ACCOUNT_SID: "AC_test_123",
        TWILIO_AUTH_TOKEN: "test-token",
        TWILIO_FROM_NUMBER: "+19055550199",
      },
      fetchImpl,
    }),
    (error) => error.statusCode === 502 && error.providerCode === 21211 && !error.message.includes("provider detail")
  );
});
