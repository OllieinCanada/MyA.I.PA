const test = require("node:test");
const assert = require("node:assert/strict");
const {
  replayCredentials,
  replayEvent,
  replayPublicConfiguration,
} = require("../scripts/replay-twilio-webhook-oauth-staging");

function environment() {
  return {
    TWILIO_WEBHOOK_STAGING_ENABLED: "true",
    TWILIO_WEBHOOK_OAUTH_ENABLED: "true",
    TWILIO_WEBHOOK_STAGING_BASE_URL: "https://staging.example.test/",
    TWILIO_WEBHOOK_OAUTH_CLIENT_ID: "twilio-staging-client",
    TWILIO_WEBHOOK_OAUTH_CLIENT_SECRET: "test-client-secret-at-least-24-characters",
    TWILIO_WEBHOOK_OAUTH_SCOPE: "twilio:webhooks",
    TWILIO_AUTH_TOKEN: "test-twilio-signature-key",
  };
}

test("replay configuration keeps public routing separate from OAuth credentials", () => {
  const env = environment();
  assert.deepEqual(replayPublicConfiguration(env), {
    callbackUrl: "https://staging.example.test/api/webhooks/twilio/staging/call-status",
    tokenUrl: "https://staging.example.test/api/integrations/twilio/webhook-oauth/token",
    scope: "twilio:webhooks",
    audience: "https://staging.example.test/api/webhooks/twilio/staging/call-status",
  });
  assert.deepEqual(replayCredentials(env), {
    clientId: env.TWILIO_WEBHOOK_OAUTH_CLIENT_ID,
    clientSecret: env.TWILIO_WEBHOOK_OAUTH_CLIENT_SECRET,
  });
});

test("controlled replay sends one identical callback twice and requires duplicate suppression", async () => {
  const env = environment();
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    if (String(url).endsWith("/token")) {
      return { ok: true, json: async () => ({ access_token: "test-access-token" }) };
    }
    const deliveryNumber = requests.filter((entry) => String(entry.url).endsWith("/call-status")).length;
    return {
      ok: true,
      json: async () => deliveryNumber === 1
        ? { duplicate: false, downstreamCreated: true, eventReference: "redacted-call" }
        : { duplicate: true, downstreamCreated: false, eventReference: "redacted-call" },
    };
  };

  const result = await replayEvent(env, { fetchImpl });
  assert.equal(result.passed, true);
  assert.equal(requests.length, 3);
  assert.equal(requests[1].url, requests[2].url);
  assert.equal(requests[1].options.body, requests[2].options.body);
  assert.equal(requests[1].options.headers["X-Twilio-Signature"], requests[2].options.headers["X-Twilio-Signature"]);
});
