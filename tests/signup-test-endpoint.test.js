const assert = require("node:assert/strict");
const test = require("node:test");
const { buildSignupTestHeaders, resolveSignupTestEndpoint } = require("../scripts/signup-test-endpoint");

test("signup payload tests use the guarded API even when a Make webhook is saved", () => {
  assert.equal(resolveSignupTestEndpoint({
    configuredSignupEndpoint: "https://hook.us2.make.com/private-hook-id",
    configuredApiBase: "https://api.myaipa.ca",
  }), "https://api.myaipa.ca/api/integrations/signup-complete");
});

test("direct Make testing requires an explicit flag", () => {
  assert.equal(resolveSignupTestEndpoint({
    directMake: true,
    configuredSignupEndpoint: "https://hook.us2.make.com/private-hook-id",
  }), "https://hook.us2.make.com/private-hook-id");
  assert.throws(() => resolveSignupTestEndpoint({ directMake: true }), /requires a configured Make.com/i);
});

test("a legacy Make webhook stored as the API base also falls back to the guarded API", () => {
  assert.equal(resolveSignupTestEndpoint({
    configuredApiBase: "https://hook.us2.make.com/private-hook-id",
  }), "https://api.myaipa.ca/api/integrations/signup-complete");
});

test("the Make API key is sent only during an explicit direct Make test", () => {
  assert.deepEqual(buildSignupTestHeaders({ makeApiKey: "private-make-key" }), {
    "Content-Type": "application/json",
  });
  assert.deepEqual(buildSignupTestHeaders({ directMake: true, makeApiKey: "private-make-key" }), {
    "Content-Type": "application/json",
    "x-make-apikey": "private-make-key",
  });
});
