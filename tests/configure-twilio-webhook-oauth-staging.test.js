const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  applyConfiguration,
  buildConfigurationPlan,
  buildResourceNames,
  createTwilioApiClient,
  listRecords,
} = require("../scripts/configure-twilio-webhook-oauth-staging");

const config = {
  callbackUrl: "https://staging.example.test/api/webhooks/twilio/staging/call-status",
  connectivityUrl: "https://staging.example.test/api/webhooks/twilio/staging/connectivity",
  tokenUrl: "https://staging.example.test/api/integrations/twilio/webhook-oauth/token",
  clientId: "client-id",
  clientSecret: "private-client-secret",
  audience: "https://staging.example.test/api/webhooks/twilio/staging/call-status",
  scope: "twilio:webhooks",
};

test("configuration plan is exact-match, bounded, retry-safe, and secret-free", () => {
  const plan = buildConfigurationPlan(config);
  assert.equal(plan.environment, "staging only");
  assert.equal(plan.matchType, "EXACT_MATCH");
  assert.equal(plan.connection.totalTimeoutMs, 15000);
  assert.equal(plan.connection.retryPolicy.retryCount, 2);
  assert.deepEqual(plan.connection.retryPolicy.retryOn, ["HTTP_5XX", "CONNECTION_TIMEOUT", "READ_TIMEOUT"]);
  assert.doesNotMatch(JSON.stringify(plan), /private-client-secret/);
});

test("resource names are stable for one credential generation and change after rotation", () => {
  const first = buildResourceNames(config);
  const same = buildResourceNames({ ...config });
  const rotated = buildResourceNames({ ...config, clientSecret: "rotated-private-client-secret" });
  assert.deepEqual(first, same);
  assert.notEqual(first.authProfile, rotated.authProfile);
  assert.doesNotMatch(first.authProfile, /private-client-secret/);
});

test("collection helper accepts Twilio resource envelopes", () => {
  assert.deepEqual(listRecords({ rules: [{ id: "rule-1" }] }, ["rules"]), [{ id: "rule-1" }]);
  assert.deepEqual(listRecords([{ id: "direct" }]), [{ id: "direct" }]);
});

test("configuration API client requires an API key and never falls back to an Auth Token", () => {
  assert.throws(() => createTwilioApiClient({ apiKeySid: "AC-account-sid", apiKeySecret: "secret" }), /Twilio API key SID/);
  assert.throws(() => createTwilioApiClient({ apiKeySid: "SK123", apiKeySecret: "secret" }), /Twilio API key SID/);
});

test("apply tests the immutable setting before installing an exact-match rule", async () => {
  const calls = [];
  let tested = false;
  let waited = false;
  const env = {
    TWILIO_WEBHOOK_STAGING_ENABLED: "true",
    TWILIO_WEBHOOK_OAUTH_ENABLED: "true",
    TWILIO_WEBHOOK_STAGING_BASE_URL: "https://staging.example.test",
    TWILIO_WEBHOOK_STAGING_DOWNSTREAM_URL: "https://staging-make.example.test/hook",
    TWILIO_WEBHOOK_OAUTH_CLIENT_ID: "client-id",
    TWILIO_WEBHOOK_OAUTH_CLIENT_SECRET: "private-client-secret-at-least-24-characters",
    TWILIO_WEBHOOK_OAUTH_SIGNING_SECRET: "private-signing-secret-at-least-32-characters-long",
    TWILIO_WEBHOOK_OAUTH_AUDIENCE: "https://staging.example.test/api/webhooks/twilio/staging/call-status",
  };
  const headers = { get: (name) => name.toLowerCase() === "operation-id" ? "operation-1" : null };
  const api = async (path, options = {}) => {
    calls.push({ path, method: options.method || "GET", body: options.body });
    if (path === "/Rules" && !options.body) return { payload: { rules: [] }, headers, status: 200 };
    if (path === "/AuthProfiles" && !options.body) return { payload: { authProfiles: [] }, headers, status: 200 };
    if (path === "/AuthProfiles" && options.body) return { payload: { id: "auth-profile-1" }, headers, status: 201 };
    if (path.startsWith("/Settings?") && !options.body) return { payload: { settings: [] }, headers, status: 200 };
    if (path === "/Settings" && options.body) return { payload: { id: "setting-1" }, headers, status: 201 };
    if (path === "/Rules" && options.body) return { payload: { id: "rule-1" }, headers, status: 202 };
    throw new Error(`Unexpected API call: ${path}`);
  };
  const result = await applyConfiguration(env, {
    api,
    testSetting: async (_api, settingId, url) => {
      assert.equal(settingId, "setting-1");
      assert.match(url, /staging\/connectivity$/);
      tested = true;
    },
    waitForOperation: async () => { waited = true; },
  });
  const ruleWrite = calls.find((call) => call.path === "/Rules" && call.method === "POST");
  assert.equal(tested, true);
  assert.equal(waited, true);
  assert.equal(result.configured, true);
  assert.equal(ruleWrite.body.matchType, "EXACT_MATCH");
  assert.equal(ruleWrite.body.value, "https://staging.example.test/api/webhooks/twilio/staging/call-status");
  assert.deepEqual(ruleWrite.body.settings, [{ settingId: "setting-1", percentage: 100 }]);
});
