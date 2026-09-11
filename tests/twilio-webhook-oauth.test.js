const assert = require("node:assert/strict");
const { test } = require("node:test");
const jwt = require("jsonwebtoken");
const {
  deliverTwilioStagingEvent,
  getTwilioWebhookOAuthConfig,
  getTwilioWebhookStagingUrls,
  issueTwilioWebhookAccessToken,
  normalizeCallStatusEvent,
  processTwilioStagingCallStatus,
  verifyTwilioWebhookBearer,
} = require("../server/twilioWebhookOAuth");

const TEST_ENV = Object.freeze({
  TWILIO_WEBHOOK_STAGING_ENABLED: "true",
  TWILIO_WEBHOOK_OAUTH_ENABLED: "true",
  TWILIO_WEBHOOK_STAGING_BASE_URL: "https://staging-api.example.test",
  TWILIO_WEBHOOK_STAGING_DOWNSTREAM_URL: "https://staging-make.example.test/hooks/twilio",
  TWILIO_WEBHOOK_STAGING_DOWNSTREAM_API_KEY: "staging-downstream-key",
  TWILIO_WEBHOOK_OAUTH_CLIENT_ID: "twilio-staging-client",
  TWILIO_WEBHOOK_OAUTH_CLIENT_SECRET: "client-secret-at-least-24-characters",
  TWILIO_WEBHOOK_OAUTH_SIGNING_SECRET: "signing-secret-at-least-32-characters-long",
  TWILIO_WEBHOOK_OAUTH_AUDIENCE: "https://staging-api.example.test/api/webhooks/twilio/staging/call-status",
  TWILIO_WEBHOOK_OAUTH_ISSUER: "myaipa-staging",
  TWILIO_WEBHOOK_OAUTH_SCOPE: "twilio:webhooks",
  TWILIO_WEBHOOK_OAUTH_TOKEN_TTL_SECONDS: "300",
  TWILIO_WEBHOOK_OAUTH_CONFIG_VERSION: "test-v1",
});

const CALL_STATUS_BODY = Object.freeze({
  CallSid: "CA0123456789abcdef0123456789abcdef",
  CallStatus: "completed",
  SequenceNumber: "4",
  Timestamp: "2026-09-11T14:30:00Z",
  CallbackSource: "call-progress-events",
});

function basicAuthorization(clientId = TEST_ENV.TWILIO_WEBHOOK_OAUTH_CLIENT_ID, clientSecret = TEST_ENV.TWILIO_WEBHOOK_OAUTH_CLIENT_SECRET) {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

function createReplayStore() {
  const states = new Map();
  return {
    states,
    claimEvent: async ({ provider, eventId, eventType }) => {
      const key = `${provider}:${eventType}:${eventId}`;
      if (states.get(key) === "completed" || states.get(key) === "claimed") {
        return { claimed: false, duplicate: true, key };
      }
      states.set(key, "claimed");
      return { claimed: true, duplicate: false, key };
    },
    completeEvent: async (claim) => {
      if (states.get(claim.key) !== "claimed") return false;
      states.set(claim.key, "completed");
      return true;
    },
    releaseEvent: async (claim) => states.delete(claim.key),
  };
}

test("staging webhook OAuth configuration fails closed when enabled credentials are incomplete", () => {
  assert.throws(
    () => getTwilioWebhookOAuthConfig({ TWILIO_WEBHOOK_STAGING_ENABLED: "true" }),
    (error) => error.code === "TWILIO_WEBHOOK_OAUTH_NOT_CONFIGURED" && error.statusCode === 503
  );
  const disabled = getTwilioWebhookOAuthConfig({});
  assert.equal(disabled.stagingEnabled, false);
  assert.equal(disabled.oauthEnabled, false);
});

test("staging webhook URLs are available without loading credential fields", () => {
  assert.deepEqual(getTwilioWebhookStagingUrls({
    TWILIO_WEBHOOK_STAGING_BASE_URL: "https://staging.example.test/",
  }), {
    baseUrl: "https://staging.example.test",
    callbackUrl: "https://staging.example.test/api/webhooks/twilio/staging/call-status",
    connectivityUrl: "https://staging.example.test/api/webhooks/twilio/staging/connectivity",
    tokenUrl: "https://staging.example.test/api/integrations/twilio/webhook-oauth/token",
  });
});

test("OAuth token endpoint issues a short-lived audience-bound bearer token", () => {
  const response = issueTwilioWebhookAccessToken({
    authorization: basicAuthorization(),
    body: { grant_type: "client_credentials", scope: "twilio:webhooks", audience: TEST_ENV.TWILIO_WEBHOOK_OAUTH_AUDIENCE },
    env: TEST_ENV,
  });
  assert.equal(response.token_type, "Bearer");
  assert.equal(response.expires_in, 300);
  assert.equal(verifyTwilioWebhookBearer(`Bearer ${response.access_token}`, TEST_ENV), true);
  const decoded = jwt.decode(response.access_token);
  assert.equal(decoded.aud, TEST_ENV.TWILIO_WEBHOOK_OAUTH_AUDIENCE);
  assert.equal(decoded.iss, "myaipa-staging");
  assert.equal(decoded.scope, "twilio:webhooks");
  assert.ok(decoded.exp - decoded.iat <= 300);
});

test("OAuth token issuance rejects bad client credentials, scope, and audience", () => {
  assert.throws(
    () => issueTwilioWebhookAccessToken({
      authorization: basicAuthorization(undefined, "incorrect-secret-value-123456"),
      body: { grant_type: "client_credentials" },
      env: TEST_ENV,
    }),
    (error) => error.code === "TWILIO_WEBHOOK_OAUTH_CLIENT_INVALID" && error.statusCode === 401
  );
  assert.throws(
    () => issueTwilioWebhookAccessToken({
      authorization: basicAuthorization(),
      body: { grant_type: "client_credentials", scope: "admin" },
      env: TEST_ENV,
    }),
    (error) => error.code === "TWILIO_WEBHOOK_OAUTH_REQUEST_INVALID"
  );
  assert.throws(
    () => issueTwilioWebhookAccessToken({
      authorization: basicAuthorization(),
      body: { grant_type: "client_credentials", audience: "https://attacker.example.test" },
      env: TEST_ENV,
    }),
    (error) => error.code === "TWILIO_WEBHOOK_OAUTH_REQUEST_INVALID"
  );
});

test("call status normalization is strict and produces a stable redacted event key", () => {
  const first = normalizeCallStatusEvent(CALL_STATUS_BODY);
  const replay = normalizeCallStatusEvent({ ...CALL_STATUS_BODY });
  const nextStatus = normalizeCallStatusEvent({ ...CALL_STATUS_BODY, CallStatus: "busy", SequenceNumber: "5" });
  assert.equal(first.idempotencyKey, replay.idempotencyKey);
  assert.notEqual(first.idempotencyKey, nextStatus.idempotencyKey);
  assert.equal(first.idempotencyKey.length, 64);
  assert.equal(first.eventReference.length, 12);
  assert.doesNotMatch(first.eventReference, /CA012345/);
  assert.throws(() => normalizeCallStatusEvent({ ...CALL_STATUS_BODY, CallSid: "+19055551234" }), /valid Twilio CallSid/);
  assert.throws(() => normalizeCallStatusEvent({ ...CALL_STATUS_BODY, CallStatus: "unknown" }), /recognized Twilio call status/);
});

test("two identical call-status deliveries create exactly one downstream record", async () => {
  const replay = createReplayStore();
  const deliveredKeys = [];
  const deliverEvent = async ({ event }) => deliveredKeys.push(event.idempotencyKey);
  const dependencies = {
    body: CALL_STATUS_BODY,
    claimEvent: replay.claimEvent,
    completeEvent: replay.completeEvent,
    releaseEvent: replay.releaseEvent,
    deliverEvent,
  };
  const first = await processTwilioStagingCallStatus(dependencies);
  const second = await processTwilioStagingCallStatus(dependencies);
  assert.equal(first.downstreamCreated, true);
  assert.equal(first.duplicate, false);
  assert.equal(second.downstreamCreated, false);
  assert.equal(second.duplicate, true);
  assert.equal(deliveredKeys.length, 1);
});

test("a rejected downstream delivery releases the claim so Twilio can retry", async () => {
  const replay = createReplayStore();
  let attempts = 0;
  const dependencies = {
    body: CALL_STATUS_BODY,
    claimEvent: replay.claimEvent,
    completeEvent: replay.completeEvent,
    releaseEvent: replay.releaseEvent,
    deliverEvent: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("temporary downstream failure");
    },
  };
  await assert.rejects(() => processTwilioStagingCallStatus(dependencies), /temporary downstream failure/);
  const retry = await processTwilioStagingCallStatus(dependencies);
  assert.equal(retry.downstreamCreated, true);
  assert.equal(attempts, 2);
});

test("downstream delivery includes one stable idempotency key without exposing OAuth credentials", async () => {
  const event = normalizeCallStatusEvent(CALL_STATUS_BODY);
  let request;
  const result = await deliverTwilioStagingEvent({
    event,
    env: TEST_ENV,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 202 };
    },
  });
  assert.equal(result.status, 202);
  assert.equal(request.url, TEST_ENV.TWILIO_WEBHOOK_STAGING_DOWNSTREAM_URL);
  assert.equal(request.options.headers["Idempotency-Key"], event.idempotencyKey);
  assert.equal(request.options.headers["X-MyAIPA-Event-Key"], event.idempotencyKey);
  assert.equal(request.options.headers.Authorization, `Bearer ${TEST_ENV.TWILIO_WEBHOOK_STAGING_DOWNSTREAM_API_KEY}`);
  assert.doesNotMatch(request.options.body, /client-secret|signing-secret|downstream-key/);
});
