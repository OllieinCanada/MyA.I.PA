const test = require("node:test");
const assert = require("node:assert/strict");

const {
  deriveVapiWebhookSecret,
  resolveVapiWebhookSecret,
} = require("../server/vapiWebhookAuth");

test("Vapi webhook derivation is stable, domain-separated, and does not expose the API key", () => {
  const apiKey = "private-vapi-key-for-test";
  const first = deriveVapiWebhookSecret(apiKey);
  const second = deriveVapiWebhookSecret(apiKey);

  assert.equal(first, second);
  assert.equal(first.length, 43);
  assert.equal(first.includes(apiKey), false);
  assert.notEqual(first, deriveVapiWebhookSecret(`${apiKey}-rotated`));
});

test("production derives a scoped webhook credential only when the explicit secret is absent", () => {
  assert.deepEqual(
    resolveVapiWebhookSecret({ configuredSecret: "dedicated-secret", apiKey: "api-key", nodeEnv: "production" }),
    { secret: "dedicated-secret", source: "explicit" }
  );
  const fallback = resolveVapiWebhookSecret({ apiKey: "api-key", nodeEnv: "production" });
  assert.equal(fallback.source, "derived-vapi-api-key");
  assert.equal(fallback.secret, deriveVapiWebhookSecret("api-key"));
});

test("non-production environments do not silently derive a webhook credential", () => {
  assert.deepEqual(resolveVapiWebhookSecret({ apiKey: "api-key", nodeEnv: "test" }), {
    secret: "",
    source: "missing",
  });
});
