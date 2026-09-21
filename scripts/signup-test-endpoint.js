function isMakeWebhook(value) {
  return /^https:\/\/hook\.[^/]+\.make\.com\//i.test(String(value || "").trim());
}

function resolveSignupTestEndpoint({
  directMake = false,
  configuredSignupEndpoint = "",
  configuredApiBase = "",
  defaultApiBase = "https://api.myaipa.ca",
  signupApiPath = "/api/integrations/signup-complete",
} = {}) {
  const makeEndpoint = String(configuredSignupEndpoint || "").trim()
    || (isMakeWebhook(configuredApiBase) ? String(configuredApiBase).trim() : "");
  if (directMake) {
    if (!isMakeWebhook(makeEndpoint)) {
      throw new Error("--direct-make requires a configured Make.com signup webhook.");
    }
    return makeEndpoint.replace(/\/+$/, "");
  }

  // Normal and review-only signup tests must exercise the public security,
  // status, and approval gates. A saved Make webhook must never silently
  // bypass those controls.
  const apiBase = isMakeWebhook(configuredApiBase)
    ? defaultApiBase
    : String(configuredApiBase || defaultApiBase).trim();
  return `${apiBase.replace(/\/+$/, "")}${signupApiPath}`;
}

function buildSignupTestHeaders({ directMake = false, makeApiKey = "" } = {}) {
  const apiKey = String(makeApiKey || "").trim();
  return {
    "Content-Type": "application/json",
    ...(directMake && apiKey ? { "x-make-apikey": apiKey } : {}),
  };
}

module.exports = { buildSignupTestHeaders, isMakeWebhook, resolveSignupTestEndpoint };
