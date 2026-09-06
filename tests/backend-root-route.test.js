const test = require("node:test");
const assert = require("node:assert/strict");
const { buildBackendRootPage } = require("../server/backendRootPage");

test("backend root explains the service instead of returning Cannot GET", () => {
  const body = buildBackendRootPage({
    stripeConfigured: true,
    webhookConfigured: true,
    priceConfigured: true,
    trialDays: 14,
    planDisplay: "CA$79/month",
    sandbox: true,
    testerConfigured: true,
  });
  assert.match(body, /Billing system status/i);
  assert.match(body, /Creates and monitors subscriptions/i);
  assert.match(body, /Receives secure Stripe webhooks/i);
  assert.match(body, /Pauses after 14 days without a card/i);
  assert.match(body, /Creates customer-specific Checkout/i);
  assert.match(body, /Stripe test mode/i);
  assert.match(body, /CA\$79\/month/i);
  assert.match(body, /Open private trial tester/i);
  assert.match(body, /https:\/\/www\.myaipa\.ca\//i);
  assert.doesNotMatch(body, /Cannot GET/i);
  assert.doesNotMatch(body, /sk_(test|live)_/i);
});
