const crypto = require("crypto");

let cachedToken = null;

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function normalizePrivateKey(value) {
  return String(value || "").replace(/\\n/g, "\n").trim();
}

function hasGitHubAppCredentials(env = process.env) {
  return /^[1-9][0-9]{0,19}$/.test(String(env.GITHUB_INCIDENT_REPAIR_APP_ID || "").trim())
    && /^[1-9][0-9]{0,19}$/.test(String(env.GITHUB_INCIDENT_REPAIR_INSTALLATION_ID || "").trim())
    && /-----BEGIN (?:RSA )?PRIVATE KEY-----/.test(normalizePrivateKey(env.GITHUB_INCIDENT_REPAIR_APP_PRIVATE_KEY));
}

function createGitHubAppJwt({ appId, privateKey, now = Date.now() } = {}) {
  const normalizedAppId = String(appId || "").trim();
  const normalizedKey = normalizePrivateKey(privateKey);
  if (!/^[1-9][0-9]{0,19}$/.test(normalizedAppId) || !normalizedKey) {
    throw new TypeError("Valid GitHub App credentials are required.");
  }
  const issuedAt = Math.floor(Number(now) / 1000) - 30;
  const expiresAt = issuedAt + 9 * 60;
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({ iat: issuedAt, exp: expiresAt, iss: normalizedAppId }));
  const unsigned = `${header}.${payload}`;
  const signature = crypto.sign("RSA-SHA256", Buffer.from(unsigned), normalizedKey).toString("base64url");
  return `${unsigned}.${signature}`;
}

async function getGitHubAppInstallationToken({
  env = process.env,
  fetchImpl = fetch,
  now = Date.now(),
} = {}) {
  if (!hasGitHubAppCredentials(env)) return "";
  const appId = String(env.GITHUB_INCIDENT_REPAIR_APP_ID).trim();
  const installationId = String(env.GITHUB_INCIDENT_REPAIR_INSTALLATION_ID).trim();
  const repository = String(env.GITHUB_INCIDENT_REPAIR_REPO || "").trim();
  const cacheKey = crypto.createHash("sha256").update(`${appId}:${installationId}:${repository}`).digest("hex");
  if (cachedToken && cachedToken.cacheKey === cacheKey && cachedToken.expiresAt - Number(now) > 5 * 60 * 1000) {
    return cachedToken.token;
  }
  const jwt = createGitHubAppJwt({
    appId,
    privateKey: env.GITHUB_INCIDENT_REPAIR_APP_PRIVATE_KEY,
    now,
  });
  const response = await fetchImpl(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${jwt}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "my-ai-pa-incident-remediator",
    },
    body: JSON.stringify({
      repositories: [repository.split("/").pop()].filter(Boolean),
      permissions: { actions: "write", contents: "read", pull_requests: "read" },
    }),
    signal: fetchImpl === fetch && typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(10_000) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !/^ghs_[A-Za-z0-9_]+$/.test(String(data?.token || ""))) {
    const error = new Error(`GitHub App installation-token request failed (${response.status}).`);
    error.code = "GITHUB_INCIDENT_REPAIR_APP_AUTH_FAILED";
    throw error;
  }
  const expiresAt = new Date(data.expires_at || 0).getTime();
  if (!Number.isFinite(expiresAt) || expiresAt <= Number(now)) {
    throw Object.assign(new Error("GitHub returned an invalid installation-token expiry."), {
      code: "GITHUB_INCIDENT_REPAIR_APP_AUTH_FAILED",
    });
  }
  cachedToken = { cacheKey, token: String(data.token), expiresAt };
  return cachedToken.token;
}

function resetGitHubAppTokenCacheForTests() {
  cachedToken = null;
}

module.exports = {
  createGitHubAppJwt,
  getGitHubAppInstallationToken,
  hasGitHubAppCredentials,
  resetGitHubAppTokenCacheForTests,
};
