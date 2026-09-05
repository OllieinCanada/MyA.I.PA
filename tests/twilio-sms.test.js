const assert = require("node:assert/strict");
const { test } = require("node:test");
const { getTwilioFailureSignal, normalizeE164, sendSmsViaTwilio } = require("../server/twilioSms");

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
    suppressionChecker: async () => false,
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

test("a trusted per-agent sender overrides the global sender", async () => {
  let capturedBody = "";
  await sendSmsViaTwilio({
    to: "+12495033301",
    from: "+12895550123",
    message: "Agent test",
    env: {
      NODE_ENV: "production",
      TWILIO_ACCOUNT_SID: "AC_test_123",
      TWILIO_AUTH_TOKEN: "test-token",
      TWILIO_FROM_NUMBER: "+19055550199",
    },
    fetchImpl: async (_url, options) => {
      capturedBody = options.body;
      return { ok: true, status: 201, json: async () => ({ sid: "SM_agent_test", status: "queued" }) };
    },
    suppressionChecker: async () => false,
  });
  assert.equal(new URLSearchParams(capturedBody).get("From"), "+12895550123");
});

test("Twilio REST requests prefer API keys and include an HTTPS delivery callback", async () => {
  let captured;
  const fetchImpl = async (url, options) => {
    captured = { url, options };
    return {
      ok: true,
      status: 201,
      json: async () => ({ sid: "SM_api_key", status: "queued" }),
    };
  };

  await sendSmsViaTwilio({
    to: "+12495033301",
    message: "Delivery-aware message",
    env: {
      NODE_ENV: "production",
      TWILIO_ACCOUNT_SID: "AC_test_123",
      TWILIO_AUTH_TOKEN: "master-token-should-not-be-used",
      TWILIO_API_KEY_SID: "SK_test_123",
      TWILIO_API_KEY_SECRET: "api-key-secret",
      TWILIO_FROM_NUMBER: "+19055550199",
      TWILIO_STATUS_CALLBACK_URL: "https://api.example.test/api/twilio/message-status",
    },
    fetchImpl,
    suppressionChecker: async () => false,
  });

  const expectedAuth = `Basic ${Buffer.from("SK_test_123:api-key-secret").toString("base64")}`;
  assert.equal(captured.options.headers.authorization, expectedAuth);
  const body = new URLSearchParams(captured.options.body);
  assert.equal(body.get("StatusCallback"), "https://api.example.test/api/twilio/message-status");
});

test("non-HTTPS delivery callback URLs are not sent to Twilio", async () => {
  let capturedBody = "";
  await sendSmsViaTwilio({
    to: "+12495033301",
    message: "Safe callback test",
    env: {
      NODE_ENV: "production",
      TWILIO_ACCOUNT_SID: "AC_test_123",
      TWILIO_AUTH_TOKEN: "test-token",
      TWILIO_FROM_NUMBER: "+19055550199",
      TWILIO_STATUS_CALLBACK_URL: "http://localhost:3000/message-status",
    },
    fetchImpl: async (_url, options) => {
      capturedBody = options.body;
      return { ok: true, status: 201, json: async () => ({ sid: "SM_no_callback", status: "queued" }) };
    },
    suppressionChecker: async () => false,
  });
  assert.equal(new URLSearchParams(capturedBody).has("StatusCallback"), false);
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
      suppressionChecker: async () => false,
    }),
    (error) => error.statusCode === 502 && error.providerCode === 21211 && !error.message.includes("provider detail")
  );
});

test("Twilio failure signals preserve billing and ambiguous account-access evidence without exposing provider text", async () => {
  assert.equal(getTwilioFailureSignal({ code: 20003, message: "Authentication Error - invalid username" }), "TWILIO_ACCOUNT_ACCESS_AMBIGUOUS");
  assert.equal(getTwilioFailureSignal({ code: 10001, message: "Account suspended because the balance is below zero" }), "TWILIO_BILLING_RESTRICTED");

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
      fetchImpl: async () => ({
        ok: false,
        status: 401,
        json: async () => ({ code: 20003, message: "Authentication Error - invalid username" }),
      }),
      suppressionChecker: async () => false,
    }),
    (error) => error.statusCode === 502
      && error.providerCode === 20003
      && error.providerSignal === "TWILIO_ACCOUNT_ACCESS_AMBIGUOUS"
      && !error.message.includes("invalid username")
  );
});

test("suppressed recipients are blocked before a provider request is made", async () => {
  let providerCalled = false;
  await assert.rejects(
    sendSmsViaTwilio({
      to: "+12495033301",
      message: "Service update",
      env: {
        NODE_ENV: "production",
        TWILIO_ACCOUNT_SID: "AC_test_123",
        TWILIO_AUTH_TOKEN: "test-token",
        TWILIO_FROM_NUMBER: "+19055550199",
      },
      fetchImpl: async () => {
        providerCalled = true;
        throw new Error("should not run");
      },
      suppressionChecker: async () => true,
    }),
    (error) => error.statusCode === 409 && error.code === "SMS_RECIPIENT_SUPPRESSED"
  );
  assert.equal(providerCalled, false);
});

test("SMS sends fail closed when consent status cannot be checked", async () => {
  let providerCalled = false;
  await assert.rejects(
    sendSmsViaTwilio({
      to: "+12495033301",
      message: "Service update",
      env: {
        NODE_ENV: "production",
        TWILIO_ACCOUNT_SID: "AC_test_123",
        TWILIO_AUTH_TOKEN: "test-token",
        TWILIO_FROM_NUMBER: "+19055550199",
      },
      fetchImpl: async () => {
        providerCalled = true;
        throw new Error("should not run");
      },
      suppressionChecker: async () => {
        throw new Error("database unavailable");
      },
    }),
    (error) => error.statusCode === 503 && error.code === "SMS_SUPPRESSION_CHECK_UNAVAILABLE"
  );
  assert.equal(providerCalled, false);
});
