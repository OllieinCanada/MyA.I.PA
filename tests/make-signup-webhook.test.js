const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildMakeSignupEventKey,
  buildMakeSignupHeaders,
  parseMakeSignupTimeoutMs,
  validateMakeWebhookUrl,
} = require("../server/makeSignupWebhook");

test("validates regional Make webhook URLs and strips fragments", () => {
  assert.equal(
    validateMakeWebhookUrl("https://hook.us2.make.com/private-path#fragment"),
    "https://hook.us2.make.com/private-path"
  );
  assert.throws(() => validateMakeWebhookUrl("http://hook.us2.make.com/private-path"), /HTTPS/);
  assert.throws(() => validateMakeWebhookUrl("https://example.com/private-path"), /approved Make webhook host/);
});

test("supports an explicit custom webhook host allowlist", () => {
  assert.equal(
    validateMakeWebhookUrl("https://automation.example.ca/signup", "automation.example.ca"),
    "https://automation.example.ca/signup"
  );
});

test("generates a stable non-PII event key", () => {
  const payload = {
    event: "signup.completed",
    submittedAt: "2026-08-24T10:00:00.000Z",
    owner: { email: "owner@example.ca" },
    business: { name: "Example Electrical" },
  };
  const laterPayload = { ...payload, submittedAt: "2026-08-24T10:05:00.000Z" };
  const key = buildMakeSignupEventKey(payload);

  assert.equal(key, buildMakeSignupEventKey(laterPayload));
  assert.match(key, /^signup_[a-f0-9]{32}$/);
  assert.doesNotMatch(key, /owner|example/i);
});

test("prefers Stripe checkout session IDs for event identity", () => {
  const first = buildMakeSignupEventKey({ stripe: { checkoutSessionId: "cs_123" }, value: 1 });
  const second = buildMakeSignupEventKey({ stripe: { checkoutSessionId: "cs_123" }, value: 2 });
  assert.equal(first, second);
});

test("builds authenticated headers without exposing payload data", () => {
  assert.deepEqual(buildMakeSignupHeaders({ apiKey: "make-key", eventKey: "signup_123" }), {
    Accept: "application/json",
    "Content-Type": "application/json",
    "x-myaipa-event-key": "signup_123",
    "x-make-apikey": "make-key",
  });
});

test("bounds webhook timeouts to Make's webhook response window", () => {
  assert.equal(parseMakeSignupTimeoutMs("60000"), 60_000);
  assert.equal(parseMakeSignupTimeoutMs("999999"), 185_000);
  assert.equal(parseMakeSignupTimeoutMs("invalid"), 185_000);
});
