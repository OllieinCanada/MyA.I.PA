const crypto = require("crypto");

const DERIVATION_CONTEXT = "myaipa:vapi-webhook-auth:v1";

function deriveVapiWebhookSecret(apiKey) {
  const normalized = String(apiKey || "").trim();
  if (!normalized) return "";
  return crypto.createHmac("sha256", normalized).update(DERIVATION_CONTEXT).digest("base64url");
}

function resolveVapiWebhookSecret({ configuredSecret, apiKey, nodeEnv } = {}) {
  const explicit = String(configuredSecret || "").trim();
  if (explicit) return { secret: explicit, source: "explicit" };
  if (String(nodeEnv || "").trim().toLowerCase() !== "production") {
    return { secret: "", source: "missing" };
  }
  const derived = deriveVapiWebhookSecret(apiKey);
  return { secret: derived, source: derived ? "derived-vapi-api-key" : "missing" };
}

module.exports = {
  DERIVATION_CONTEXT,
  deriveVapiWebhookSecret,
  resolveVapiWebhookSecret,
};
