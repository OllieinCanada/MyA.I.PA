const assert = require("node:assert/strict");
const test = require("node:test");
const { verifySignupCaptcha } = require("../server/signupCaptcha");
const env = { NODE_ENV: "production", TURNSTILE_SECRET_KEY: "synthetic-private-secret" };
const valid = { captchaProvider: "turnstile", turnstileToken: "synthetic-proof" };
const success = { success: true, hostname: "www.myaipa.ca" };
function verifier(body = success, status = 200) {
  const calls = [];
  return { calls, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return { ok: status >= 200 && status < 300, json: async () => body };
  } };
}
const check = (security, config = env, mock = verifier()) => verifySignupCaptcha(security, "203.0.113.7", { env: config, fetchImpl: mock.fetchImpl });

const dualEnv = { ...env, CAPTCHA_PROVIDER: "turnstile+recaptcha", RECAPTCHA_SECRET_KEY: "synthetic-google-secret" };
const dualProofs = { captchaProvider: "turnstile+recaptcha", turnstileToken: "cloudflare-proof", recaptchaToken: "google-proof" };
test("Google proofs above Cloudflare's limit are verified unchanged in dual and Google-only modes", async () => {
  for (const length of [2049, 4096, 16384]) {
    const proof = "g".repeat(length);
    for (const config of [dualEnv, { ...dualEnv, CAPTCHA_PROVIDER: "recaptcha" }]) {
      const mock = verifier();
      const result = await check({ ...dualProofs, captchaProvider: config.CAPTCHA_PROVIDER, recaptchaToken: proof }, config, mock);
      assert.equal(result.ok, true);
      assert.equal(mock.calls.at(-1).options.body.get("response"), proof);
    }
  }
});
test("provider-specific size limits reject before consuming either proof and log only safe lengths", async () => {
  for (const [provider, field, length, limit] of [
    ["turnstile", "turnstileToken", 2049, 2048], ["recaptcha", "recaptchaToken", 16385, 16384],
  ]) {
    const mock = verifier();
    assert.deepEqual(await check({ ...dualProofs, [field]: "x".repeat(length) }, dualEnv, mock), {
      ok: false, reason: "captcha_token_too_long", provider, tokenLength: length, maxTokenLength: limit,
    });
    assert.equal(mock.calls.length, 0);
  }
});
test("a longer Google proof still requires successful Google verification", async () => {
  const mock = verifier({ success: false, "error-codes": ["timeout-or-duplicate"] });
  // Let Cloudflare succeed, but make Google reject the long proof.
  const result = await check({ ...dualProofs, recaptchaToken: "g".repeat(4096) }, dualEnv, {
    fetchImpl: async (url, options) => url.includes("google") ? mock.fetchImpl(url, options)
      : { ok: true, json: async () => success },
  });
  assert.equal(result.ok, false);
  assert.equal(result.provider, "recaptcha");
  assert.equal(result.reason, "timeout-or-duplicate");
});
test("dual protection requires two separate provider verifications", async () => {
  const mock = verifier();
  assert.deepEqual(await check(dualProofs, dualEnv, mock), { ok: true, skipped: false });
  assert.deepEqual(mock.calls.map((x) => x.url), ["https://challenges.cloudflare.com/turnstile/v0/siteverify", "https://www.google.com/recaptcha/api/siteverify"]);
  assert.deepEqual(mock.calls.map((x) => x.options.body.get("response")), ["cloudflare-proof", "google-proof"]);
  assert.deepEqual(mock.calls.map((x) => x.options.body.get("secret")), [env.TURNSTILE_SECRET_KEY, dualEnv.RECAPTCHA_SECRET_KEY]);
});
test("dual mode cannot be downgraded or accept one proof twice", async () => {
  for (const security of [{ ...dualProofs, captchaProvider: "turnstile" },
    { ...dualProofs, captchaProvider: "recaptcha" }, { turnstileToken: "proof" }, { recaptchaToken: "proof" },
    { ...dualProofs, recaptchaToken: dualProofs.turnstileToken }]) {
    const mock = verifier();
    assert.equal((await check(security, dualEnv, mock)).ok, false);
    assert.equal(mock.calls.length, 0);
  }
});
test("dual mode rejects incomplete configuration before consuming a proof", async () => {
  for (const config of [{ ...dualEnv, RECAPTCHA_SECRET_KEY: "" }, { ...dualEnv, TURNSTILE_SECRET_KEY: "" },
    { ...dualEnv, RECAPTCHA_SECRET_KEY: "6LeIxAcTAAAAAGG-vFI1TnRWxMZNFuojJ4WifJWe" }]) {
    const mock = verifier();
    assert.equal((await check(dualProofs, config, mock)).ok, false);
    assert.equal(mock.calls.length, 0);
  }
});
test("either provider failure blocks dual signup; there is no OR fallback", async () => {
  for (const failing of ["cloudflare", "google"]) {
    const fetchImpl = async (url) => ({ ok: true, json: async () => ({ success: !url.includes(failing), hostname: "www.myaipa.ca" }) });
    assert.equal((await check(dualProofs, dualEnv, { fetchImpl })).ok, false);
  }
});
test("a score-only Google token cannot masquerade as a successful checkbox", async () => {
  const fetchImpl = async (url) => ({ ok: true, json: async () => ({ ...success,
    ...(url.includes("google") ? { score: 0.1, action: "signup" } : {}),
  }) });
  assert.equal((await check(dualProofs, dualEnv, { fetchImpl })).reason, "captcha_key_type_mismatch");
});

test("normal signup requires Cloudflare verification with the server's secret", async () => {
  const mock = verifier();
  assert.deepEqual(await check(valid, env, mock), { ok: true, skipped: false });
  assert.equal(mock.calls.length, 1);
  assert.equal(mock.calls[0].url, "https://challenges.cloudflare.com/turnstile/v0/siteverify");
  assert.equal(mock.calls[0].options.body.get("secret"), env.TURNSTILE_SECRET_KEY);
  assert.equal(mock.calls[0].options.body.get("response"), valid.turnstileToken);
  assert.equal(mock.calls[0].options.body.get("remoteip"), "203.0.113.7");
  assert.ok(mock.calls[0].options.signal);
});
test("forged provider claims cannot select an unconfigured Google verifier", async () => {
  for (const captchaProvider of ["recaptcha", "none", "unknown", "disabled"]) {
    const mock = verifier();
    assert.equal((await check({ captchaProvider, captchaToken: "fake", pageUrl: "http://localhost:3000" }, env, mock)).ok, false);
    assert.equal(mock.calls.length, 0);
  }
});
test("extra Google token and fake localhost URL cannot change the selected verifier", async () => {
  const mock = verifier();
  assert.equal((await check({ ...valid, recaptchaToken: "google-test-token", pageUrl: "http://localhost:3000" }, env, mock)).ok, true);
  assert.match(mock.calls[0].url, /cloudflare/);
  const noClaim = verifier();
  assert.equal((await check({ captchaToken: "proof", recaptchaToken: "fake" }, env, noClaim)).ok, true);
  assert.match(noClaim.calls[0].url, /cloudflare/);
  assert.equal((await check({ recaptchaToken: "fake" })).reason, "missing_captcha");
});
test("missing secrets always fail closed, including legacy no-provider submissions", async () => {
  for (const config of [{}, { NODE_ENV: "production" }, { CAPTCHA_PROVIDER: "recaptcha" }, { RECAPTCHA_SECRET_KEY: "present-but-not-selected" }]) {
    for (const security of [{}, valid, { captchaProvider: "recaptcha", pageUrl: "http://127.0.0.1" }]) {
      const mock = verifier();
      assert.deepEqual(await check(security, config, mock), { ok: false, skipped: false, reason: "captcha_not_configured" });
      assert.equal(mock.calls.length, 0);
    }
  }
});
test("unknown server provider fails closed", async () => {
  assert.equal((await check(valid, { ...env, CAPTCHA_PROVIDER: "none" })).ok, false);
});
test("bad, missing, oversized and conflicting tokens fail before network access", async () => {
  for (const security of [{}, { captchaToken: {} }, { captchaToken: ["proof"] }, { captchaToken: " " },
    { captchaToken: "x".repeat(2049) }, { turnstileToken: "one", captchaToken: "two" }]) {
    const mock = verifier();
    assert.equal((await check(security, env, mock)).ok, false);
    assert.equal(mock.calls.length, 0);
  }
});
test("expired, replayed and forged proofs are denied", async () => {
  for (const body of [{ success: false, "error-codes": ["timeout-or-duplicate"] },
    { success: false, "error-codes": ["invalid-input-response"] }, {}, { success: "true" }]) {
    assert.equal((await check(valid, env, verifier(body))).ok, false);
  }
});
test("HTTP errors, unavailable providers and malformed JSON fail closed", async () => {
  assert.equal((await check(valid, env, verifier(success, 503))).ok, false);
  assert.equal((await check(valid, env, { fetchImpl: async () => { throw Error("network unavailable"); } })).ok, false);
  assert.equal((await check(valid, env, { fetchImpl: async () => ({ ok: true, json: async () => { throw Error("bad JSON"); } }) })).ok, false);
});
test("production trusts provider-reported hostname, never browser pageUrl", async () => {
  for (const hostname of ["evil.example", "localhost", "www.myaipa.ca.evil.example", undefined]) {
    assert.equal((await check({ ...valid, pageUrl: "https://www.myaipa.ca" }, env, verifier({ success: true, hostname }))).reason, "captcha_hostname_mismatch");
  }
  assert.equal((await check({ ...valid, pageUrl: "http://localhost" })).ok, true);
});
test("hostname allowlist supports explicitly approved staging", async () => {
  const config = { ...env, CAPTCHA_ALLOWED_HOSTNAMES: "staging.myaipa.ca" };
  assert.equal((await check(valid, config, verifier({ success: true, hostname: "staging.myaipa.ca" }))).ok, true);
  assert.equal((await check(valid, config)).ok, false);
});
test("public test secrets are forbidden on production and Render", async () => {
  for (const secret of ["1x0000000000000000000000000000000AA", "2x0000000000000000000000000000000AA", "3x0000000000000000000000000000000AA"]) {
    for (const runtime of [{ NODE_ENV: "production" }, { NODE_ENV: "development", RENDER: "true" }]) {
      const mock = verifier();
      assert.equal((await check(valid, { ...runtime, TURNSTILE_SECRET_KEY: secret }, mock)).reason, "captcha_test_secret_forbidden");
      assert.equal(mock.calls.length, 0);
    }
  }
});
test("only server configuration selects Google; pageUrl cannot select a test key", async () => {
  const config = { NODE_ENV: "production", CAPTCHA_PROVIDER: "recaptcha", RECAPTCHA_SECRET_KEY: "configured-google-secret" };
  const mock = verifier();
  assert.equal((await check({ captchaProvider: "recaptcha", recaptchaToken: "proof", pageUrl: "http://localhost" }, config, mock)).ok, true);
  assert.equal(mock.calls[0].url, "https://www.google.com/recaptcha/api/siteverify");
  assert.equal(mock.calls[0].options.body.get("secret"), "configured-google-secret");
  assert.equal((await check({ recaptchaToken: "proof" }, { ...config, RECAPTCHA_SECRET_KEY: "6LeIxAcTAAAAAGG-vFI1TnRWxMZNFuojJ4WifJWe" })).ok, false);
});
