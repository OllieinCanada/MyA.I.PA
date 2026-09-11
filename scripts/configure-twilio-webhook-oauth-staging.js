#!/usr/bin/env node
const { loadProjectEnv } = require("./_helpers");
const { getTwilioWebhookOAuthConfig } = require("../server/twilioWebhookOAuth");

const API_BASE = "https://webhooks.twilio.com/v1/Webhooks";
const APPLY_CONFIRMATION = "CONFIGURE_STAGING_TWILIO_WEBHOOK_OAUTH";

function hasFlag(name, argv = process.argv.slice(2)) {
  return argv.includes(`--${name}`);
}

function flagValue(name, argv = process.argv.slice(2)) {
  const prefix = `--${name}=`;
  return argv.find((item) => item.startsWith(prefix))?.slice(prefix.length) || "";
}

function buildResourceNames(config) {
  const version = String(config.configVersion || "").trim();
  if (!/^[a-zA-Z0-9._-]{1,32}$/.test(version)) {
    throw new Error("TWILIO_WEBHOOK_OAUTH_CONFIG_VERSION must be a short non-secret release label such as v1.");
  }
  return {
    authProfile: `My AI PA staging OAuth ${version}`,
    setting: `My AI PA staging call status ${version}`,
    rule: "My AI PA staging call-status exact match",
  };
}

function buildConfigurationPlan(config) {
  const names = buildResourceNames(config);
  return {
    environment: "staging only",
    endpoint: config.callbackUrl,
    connectivityTestEndpoint: config.connectivityUrl,
    tokenEndpoint: config.tokenUrl,
    matchType: "EXACT_MATCH",
    authentication: "OAuth 2.0 client credentials",
    requestIntegrity: "Twilio account signature (HMAC-SHA1)",
    connection: {
      connectTimeoutMs: 3000,
      readTimeoutMs: 5000,
      totalTimeoutMs: 15000,
      retryPolicy: {
        retryCount: 2,
        retryOn: ["HTTP_5XX", "CONNECTION_TIMEOUT", "READ_TIMEOUT"],
      },
    },
    names,
  };
}

function listRecords(payload, keys = []) {
  if (Array.isArray(payload)) return payload;
  for (const key of [...keys, "items", "data", "results"]) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  return [];
}

function createTwilioApiClient({ apiKeySid, apiKeySecret, fetchImpl = global.fetch } = {}) {
  if (!/^SK[a-zA-Z0-9]{30,}$/.test(String(apiKeySid || "").trim()) || !String(apiKeySecret || "").trim()) {
    throw new Error("A Twilio API key SID and secret are required. Do not use the account Auth Token for configuration writes.");
  }
  const authorization = `Basic ${Buffer.from(`${apiKeySid}:${apiKeySecret}`).toString("base64")}`;
  return async function request(path, { method = "GET", body } = {}) {
    const response = await fetchImpl(`${API_BASE}${path}`, {
      method,
      headers: {
        Authorization: authorization,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(20000),
    });
    const text = await response.text();
    let payload = {};
    try { payload = text ? JSON.parse(text) : {}; } catch { payload = {}; }
    if (!response.ok) {
      const error = new Error(`Twilio Webhook Configuration API returned HTTP ${response.status}: ${String(payload?.detail || payload?.message || "request failed").slice(0, 240)}`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return { payload, headers: response.headers, status: response.status };
  };
}

async function waitForOperation(api, operationResponse, { waitImpl = setTimeout } = {}) {
  const operationId = operationResponse.headers.get("operation-id") || operationResponse.payload?.operation?.id || operationResponse.payload?.id;
  if (!operationId) throw new Error("Twilio accepted the Rule change without returning an Operation ID.");
  const deadline = Date.now() + 120000;
  let retryAfter = Math.max(2, Math.min(15, Number(operationResponse.headers.get("retry-after")) || 5));
  while (Date.now() < deadline) {
    await new Promise((resolve) => waitImpl(resolve, retryAfter * 1000));
    const { payload, headers } = await api(`/Operations/${encodeURIComponent(operationId)}`);
    const status = String(payload?.status || "").toUpperCase();
    if (status === "COMPLETED") return payload;
    if (["FAILED", "CANCELLED"].includes(status)) {
      throw new Error(`Twilio Rule operation ended as ${status}: ${String(payload?.error?.detail || "no safe detail returned").slice(0, 240)}`);
    }
    retryAfter = Math.max(2, Math.min(15, Number(headers.get("retry-after")) || retryAfter));
  }
  throw new Error("Timed out waiting for the Twilio webhook Rule to propagate.");
}

async function testSettingAfterPropagation(api, settingId, connectivityUrl, { waitImpl = setTimeout } = {}) {
  const deadline = Date.now() + 90000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const { payload } = await api("/Tests", {
        method: "POST",
        body: { url: connectivityUrl, settingId, method: "POST" },
      });
      if (String(payload?.result?.outcome || "").toUpperCase() !== "DELIVERED") {
        throw new Error(`Twilio's connectivity test did not deliver successfully: ${String(payload?.result?.error || "unknown outcome").slice(0, 240)}`);
      }
      return payload;
    } catch (error) {
      lastError = error;
      if (error.status !== 422) throw error;
      await new Promise((resolve) => waitImpl(resolve, 10000));
    }
  }
  throw lastError || new Error("Timed out waiting for the Twilio Setting to become testable.");
}

async function safelyDelete(api, resourcePath) {
  try {
    await api(resourcePath, { method: "DELETE" });
  } catch (error) {
    console.error(`Cleanup warning for ${resourcePath.split("/")[1] || "resource"}: HTTP ${error.status || "unknown"}.`);
  }
}

async function applyConfiguration(env, dependencies = {}) {
  const config = getTwilioWebhookOAuthConfig(env);
  if (!config.stagingEnabled || !config.oauthEnabled) throw new Error("Enable both dedicated staging webhook flags before applying this configuration.");
  const names = buildResourceNames(config);
  const api = dependencies.api || createTwilioApiClient({
    apiKeySid: env.TWILIO_API_KEY_SID,
    apiKeySecret: env.TWILIO_API_KEY_SECRET,
    fetchImpl: dependencies.fetchImpl,
  });
  const rulesResponse = await api("/Rules");
  const rules = listRecords(rulesResponse.payload, ["rules"]);
  const existingRule = rules.find((rule) => rule.matchType === "EXACT_MATCH" && rule.value === config.callbackUrl);

  let createdAuthProfile = false;
  let createdSetting = false;
  let authProfile;
  let setting;
  try {
    const authProfilesResponse = await api("/AuthProfiles");
    authProfile = listRecords(authProfilesResponse.payload, ["authProfiles", "auth_profiles"])
      .find((record) => record.friendlyName === names.authProfile && record.type === "OAUTH2");
    if (!authProfile) {
      const created = await api("/AuthProfiles", {
        method: "POST",
        body: {
          type: "OAUTH2",
          friendlyName: names.authProfile,
          tokenUrl: config.tokenUrl,
          clientId: config.clientId,
          clientSecret: config.clientSecret,
          scope: config.scope,
          audience: config.audience,
          clientCredentialsAuthMethod: "CLIENT_SECRET_POST",
        },
      });
      authProfile = created.payload;
      createdAuthProfile = true;
    }
    if (!authProfile?.id) throw new Error("Twilio did not return an AuthProfile ID.");

    const settingsResponse = await api(`/Settings?authProfileId=${encodeURIComponent(authProfile.id)}`);
    setting = listRecords(settingsResponse.payload, ["settings"])
      .find((record) => record.friendlyName === names.setting);
    if (!setting) {
      const created = await api("/Settings", {
        method: "POST",
        body: {
          friendlyName: names.setting,
          description: "Staging call-status delivery with OAuth, signed-body validation, bounded timeouts, and safe retries.",
          auth: { source: "REFERENCE", authProfileId: authProfile.id },
          signature: { type: "ACCOUNT_AUTH_TOKEN", algorithm: "HMAC_SHA1" },
          connection: buildConfigurationPlan(config).connection,
        },
      });
      setting = created.payload;
      createdSetting = true;
    }
    if (!setting?.id) throw new Error("Twilio did not return a Setting ID.");

    await (dependencies.testSetting || testSettingAfterPropagation)(api, setting.id, config.connectivityUrl, dependencies);

    if (existingRule) {
      const exactSetting = Array.isArray(existingRule.settings)
        && existingRule.settings.length === 1
        && existingRule.settings[0]?.settingId === setting.id
        && Number(existingRule.settings[0]?.percentage) === 100;
      if (!exactSetting) {
        throw new Error("An exact-match Rule already owns this staging URL. Refusing to replace it automatically; inspect it before changing traffic.");
      }
      return { configured: true, reusedRule: true, tested: true };
    }

    const ruleResponse = await api("/Rules", {
      method: "POST",
      body: {
        friendlyName: names.rule,
        description: "OAuth and bounded retries for the dedicated My AI PA staging call-status callback only.",
        matchType: "EXACT_MATCH",
        value: config.callbackUrl,
        settings: [{ settingId: setting.id, percentage: 100 }],
      },
    });
    await (dependencies.waitForOperation || waitForOperation)(api, ruleResponse, dependencies);
    return { configured: true, reusedRule: false, tested: true };
  } catch (error) {
    if (createdSetting && setting?.id) await safelyDelete(api, `/Settings/${encodeURIComponent(setting.id)}`);
    if (createdAuthProfile && authProfile?.id) await safelyDelete(api, `/AuthProfiles/${encodeURIComponent(authProfile.id)}`);
    throw error;
  }
}

async function main() {
  const env = loadProjectEnv();
  if (!hasFlag("apply")) {
    const config = getTwilioWebhookOAuthConfig(env);
    const plan = buildConfigurationPlan(config);
    console.log(JSON.stringify({ mode: "dry-run", ready: config.stagingEnabled && config.oauthEnabled, plan }, null, 2));
    return;
  }
  if (hasFlag("apply")) {
    if (flagValue("confirm") !== APPLY_CONFIRMATION) throw new Error(`Applying requires --confirm=${APPLY_CONFIRMATION}.`);
    const result = await applyConfiguration(env);
    const config = getTwilioWebhookOAuthConfig(env);
    console.log(JSON.stringify({ mode: "apply", ...result, endpoint: config.callbackUrl }, null, 2));
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Twilio staging webhook setup failed: ${String(error?.message || error).slice(0, 500)}`);
    process.exitCode = 1;
  });
}

module.exports = {
  API_BASE,
  APPLY_CONFIRMATION,
  applyConfiguration,
  buildConfigurationPlan,
  buildResourceNames,
  createTwilioApiClient,
  listRecords,
  testSettingAfterPropagation,
  waitForOperation,
};
