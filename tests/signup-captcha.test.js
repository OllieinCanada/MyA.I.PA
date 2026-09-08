const assert = require("node:assert/strict");
const test = require("node:test");
const { __test } = require("../server/index");

test("explicit Turnstile signup fails closed when the server secret is unavailable", async () => {
  const previous = process.env.TURNSTILE_SECRET_KEY;
  delete process.env.TURNSTILE_SECRET_KEY;
  try {
    const result = await __test.verifySignupCaptcha({
      captchaProvider: "turnstile",
      captchaToken: "browser-token",
    }, "127.0.0.1");
    assert.deepEqual(result, { ok: false, skipped: false, reason: "captcha_not_configured" });
  } finally {
    if (previous === undefined) delete process.env.TURNSTILE_SECRET_KEY;
    else process.env.TURNSTILE_SECRET_KEY = previous;
  }
});

test("legacy manual-review signup remains available before a CAPTCHA provider is selected", async () => {
  const previous = process.env.TURNSTILE_SECRET_KEY;
  delete process.env.TURNSTILE_SECRET_KEY;
  try {
    const result = await __test.verifySignupCaptcha({}, "127.0.0.1");
    assert.deepEqual(result, { ok: true, skipped: true });
  } finally {
    if (previous === undefined) delete process.env.TURNSTILE_SECRET_KEY;
    else process.env.TURNSTILE_SECRET_KEY = previous;
  }
});
