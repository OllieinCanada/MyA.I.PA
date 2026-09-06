const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createSandboxScenarioToken,
  createSandboxSessionToken,
  deriveSandboxPasswordVerifier,
  hasValidSandboxSession,
  readSandboxScenarioToken,
  renderSandboxLogin,
  renderSandboxTestPage,
} = require("../server/stripeSandboxTester");

const signingKey = "a-long-private-sandbox-signing-key";

test("private sandbox sessions are signed, expire, and reject tampering", () => {
  const now = Date.UTC(2026, 8, 6);
  const token = createSandboxSessionToken(signingKey, now);
  assert.equal(hasValidSandboxSession(signingKey, token, now + 1000), true);
  assert.equal(hasValidSandboxSession(signingKey, `${token}x`, now + 1000), false);
  assert.equal(hasValidSandboxSession(signingKey, token, now + 3 * 60 * 60 * 1000), false);
});

test("scenario tokens keep the three Stripe resources together", () => {
  const now = Date.UTC(2026, 8, 6);
  const scenario = {
    clockId: "clock_test_1",
    customerId: "cus_test_1",
    subscriptionId: "sub_test_1",
    frozenTime: 1788652800,
  };
  const token = createSandboxScenarioToken(signingKey, scenario, now);
  assert.deepEqual(readSandboxScenarioToken(signingKey, token, now + 1000), scenario);
  assert.equal(readSandboxScenarioToken("wrong-secret", token, now + 1000), null);
});

test("sandbox passwords use a deliberately expensive verifier", () => {
  const verifier = deriveSandboxPasswordVerifier("correct horse battery staple");
  assert.equal(verifier.length, 64);
  assert.equal(verifier, deriveSandboxPasswordVerifier("correct horse battery staple"));
  assert.notEqual(verifier, deriveSandboxPasswordVerifier("correct horse battery staples"));
});

test("tester pages expose the ordered flow without live card instructions", () => {
  const login = renderSandboxLogin({ configured: true });
  assert.match(login, /Private Stripe Trial Tester/i);
  assert.match(login, /type="password"/i);

  const fresh = renderSandboxTestPage();
  assert.match(fresh, /Create simulated 14-day trial/i);

  const trialing = renderSandboxTestPage({
    scenario: { subscriptionId: "sub_test_1" },
    subscription: { status: "trialing" },
  });
  assert.match(trialing, /Advance safely to day 14/i);
  assert.doesNotMatch(trialing, /Add card securely<\/button>/i);

  const paused = renderSandboxTestPage({
    scenario: { subscriptionId: "sub_test_1" },
    subscription: { status: "paused" },
  });
  assert.match(paused, /Add card securely/i);
  assert.match(paused, /4242 4242 4242 4242/);

  const active = renderSandboxTestPage({
    scenario: { subscriptionId: "sub_test_1" },
    subscription: { status: "active" },
  });
  assert.match(active, /PASS:/);
  assert.match(active, /subscription is active/i);
  assert.doesNotMatch(active, /sk_(test|live)_/i);
});
