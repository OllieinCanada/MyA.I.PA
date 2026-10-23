const test = require("node:test");
const assert = require("node:assert/strict");
const { checkSignupAdmission, signupSecurityResponse } = require("../server/signupAdmission");

const input = { security: {}, ip: "203.0.113.1", contactComplete: true };
function dependencies(overrides = {}) {
  const calls = [];
  return { calls, hooks: {
    consumeIp: async () => { calls.push("ip"); return { allowed: true }; },
    verifyCaptcha: async () => { calls.push("captcha"); return { ok: true }; },
    consumeIdentity: async () => { calls.push("identity"); return { allowed: true }; },
    ...overrides,
  } };
}
test("failed CAPTCHA counts against IP protection, never the customer's identity allowance", async () => {
  const { calls, hooks } = dependencies({ verifyCaptcha: async () => { calls.push("captcha"); return { ok: false, reason: "timeout-or-duplicate" }; } });
  const result = await checkSignupAdmission(input, hooks);
  assert.deepEqual(calls, ["ip", "captcha"]);
  assert.deepEqual(result.reasons, ["timeout-or-duplicate"]);
});
test("IP-limited requests do not consume single-use proofs", async () => {
  const { calls, hooks } = dependencies({ consumeIp: async () => { calls.push("ip"); return { allowed: false, retryAfterMs: 12000 }; } });
  const result = await checkSignupAdmission(input, hooks);
  assert.deepEqual(calls, ["ip"]);
  assert.deepEqual(result, { reasons: ["ip_rate_limit"], retryAfterMs: 12000 });
});
test("complete verified submissions still consume identity protection", async () => {
  const { calls, hooks } = dependencies();
  assert.deepEqual((await checkSignupAdmission(input, hooks)).reasons, []);
  assert.deepEqual(calls, ["ip", "captcha", "identity"]);
  hooks.consumeIdentity = async () => ({ allowed: false, retryAfterMs: 60000 });
  assert.deepEqual((await checkSignupAdmission(input, hooks)).reasons, ["identity_rate_limit"]);
});
test("honeypots and missing contact details cannot consume identity quota or proofs", async () => {
  for (const changed of [{ security: { companyWebsite: "spam" } }, { contactComplete: false }]) {
    const { calls, hooks } = dependencies();
    assert.equal((await checkSignupAdmission({ ...input, ...changed }, hooks)).reasons.length, 1);
    assert.deepEqual(calls, ["ip"]);
  }
});
test("public responses distinguish verification, availability and throttling without leaking provider details", () => {
  for (const [reason, status, code] of [
    ["timeout-or-duplicate", 400, "SIGNUP_CAPTCHA_FAILED"],
    ["captcha_token_too_long", 400, "SIGNUP_CAPTCHA_FAILED"],
    ["captcha_unreachable", 503, "SIGNUP_VERIFICATION_UNAVAILABLE"],
    ["captcha_not_configured", 503, "SIGNUP_VERIFICATION_UNAVAILABLE"],
    ["identity_rate_limit", 429, "SIGNUP_RATE_LIMITED"],
    ["ip_rate_limit", 429, "SIGNUP_RATE_LIMITED"],
    ["missing_contact_detail", 400, "SIGNUP_CONTACT_REQUIRED"],
  ]) {
    const result = signupSecurityResponse([reason]);
    assert.equal(result.status, status);
    assert.equal(result.body.code, code);
    assert.equal(result.body.resetCaptcha, true);
    assert.equal(JSON.stringify(result.body).includes(reason), false);
  }
});
