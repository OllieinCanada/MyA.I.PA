const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const {
  createGitHubAppJwt,
  getGitHubAppInstallationToken,
  hasGitHubAppCredentials,
  resetGitHubAppTokenCacheForTests,
} = require("../server/githubAppToken");

const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const privatePem = privateKey.export({ type: "pkcs8", format: "pem" });

test("GitHub App JWT is short-lived and signed", () => {
  const now = Date.parse("2026-09-24T12:00:00.000Z");
  const jwt = createGitHubAppJwt({ appId: "12345", privateKey: privatePem, now });
  const [header, payload, signature] = jwt.split(".");
  assert.equal(crypto.verify("RSA-SHA256", Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, "base64url")), true);
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  assert.equal(claims.iss, "12345");
  assert.ok(claims.exp - claims.iat <= 600);
});

test("installation token is repository-scoped and cached", async () => {
  resetGitHubAppTokenCacheForTests();
  const env = {
    GITHUB_INCIDENT_REPAIR_APP_ID: "12345",
    GITHUB_INCIDENT_REPAIR_INSTALLATION_ID: "67890",
    GITHUB_INCIDENT_REPAIR_APP_PRIVATE_KEY: privatePem,
    GITHUB_INCIDENT_REPAIR_REPO: "owner/repo",
  };
  assert.equal(hasGitHubAppCredentials(env), true);
  let calls = 0;
  const fetchImpl = async (_url, options) => {
    calls += 1;
    assert.deepEqual(JSON.parse(options.body).repositories, ["repo"]);
    return { ok: true, status: 201, json: async () => ({ token: "ghs_testtoken123", expires_at: "2026-09-24T13:00:00.000Z" }) };
  };
  const now = Date.parse("2026-09-24T12:00:00.000Z");
  assert.equal(await getGitHubAppInstallationToken({ env, fetchImpl, now }), "ghs_testtoken123");
  assert.equal(await getGitHubAppInstallationToken({ env, fetchImpl, now: now + 60_000 }), "ghs_testtoken123");
  assert.equal(calls, 1);
});
