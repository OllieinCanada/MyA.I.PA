const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  getSignupProvisioningIdentity,
  reconcileSignupSupersessionResources,
} = require("../server/signupSupersessionReconciliation");

const signup = {
  ownerEmail: "duplicate@example.com",
  ownerPhone: "+1 (905) 555-0123",
  businessName: "Example Electrical",
};

function safeLoaders(overrides = {}) {
  return {
    loadDurableStep: async () => ({ data: {} }),
    loadTwilioNumbers: async () => [],
    loadVapiAssistants: async () => [],
    loadVapiPhoneNumbers: async () => [],
    loadStripeResources: async () => ({ hasResources: false, customerCount: 0 }),
    ...overrides,
  };
}

test("supersession reconciliation proves durable, Twilio, Vapi, and Stripe absence", async () => {
  let durableReads = 0;
  const result = await reconcileSignupSupersessionResources({
    signup,
    ...safeLoaders({
      loadDurableStep: async () => {
        durableReads += 1;
        return { data: {} };
      },
    }),
  });

  assert.deepEqual(result, {
    complete: true,
    resourcesProvisioned: false,
    durableProvisioning: "absent",
    twilioResources: "absent",
    vapiResources: "absent",
    stripeResources: "absent",
  });
  assert.equal(durableReads, 6, "each durable stage must be read before and after provider inventory");
  assert.equal(JSON.stringify(result).includes("duplicate@example.com"), false);
  assert.equal(JSON.stringify(result).includes("9055550123"), false);
});
test("durable processing, failed, or completed provisioning blocks supersession", async () => {
  for (const data of [
    { status: "processing", claimToken: "private-claim" },
    { status: "failed", attempts: 1 },
    { status: "completed", result: { number: "+19055550199" } },
  ]) {
    let providerRead = false;
    await assert.rejects(
      reconcileSignupSupersessionResources({
        signup,
        ...safeLoaders({
          loadDurableStep: async ({ kind }) => ({ data: kind === "twilio-number" ? data : {} }),
          loadTwilioNumbers: async () => {
            providerRead = true;
            return [];
          },
        }),
      }),
      (error) => error.code === "SIGNUP_DURABLE_PROVISIONING_REQUIRES_REVIEW" && error.statusCode === 409
    );
    assert.equal(providerRead, false);
  }
});

test("a hidden deterministic Twilio or Vapi resource blocks empty local signup fields", async () => {
  const identity = getSignupProvisioningIdentity(signup);
  for (const override of [
    { loadTwilioNumbers: async () => [{ friendly_name: identity.resourceNames.twilioNumber }] },
    { loadVapiAssistants: async () => [{ name: identity.resourceNames.vapiAssistant }] },
    { loadVapiPhoneNumbers: async () => [{ name: identity.resourceNames.vapiPhone }] },
  ]) {
    await assert.rejects(
      reconcileSignupSupersessionResources({ signup, ...safeLoaders(override) }),
      (error) => error.code === "SIGNUP_PROVIDER_RESOURCES_REQUIRE_REVIEW" && error.statusCode === 409
    );
  }
});

test("a Stripe customer or retained checkout resource blocks supersession", async () => {
  for (const stripeResult of [
    { hasResources: true, customerCount: 1 },
    { hasResources: true, checkoutSessionCount: 1 },
  ]) {
    await assert.rejects(
      reconcileSignupSupersessionResources({
        signup,
        ...safeLoaders({ loadStripeResources: async () => stripeResult }),
      }),
      (error) => error.code === "SIGNUP_PROVIDER_RESOURCES_REQUIRE_REVIEW"
    );
  }
});

test("provider outage or incomplete inventory fails closed without leaking raw errors", async () => {
  await assert.rejects(
    reconcileSignupSupersessionResources({
      signup,
      ...safeLoaders({
        loadVapiPhoneNumbers: async () => {
          throw new Error("private upstream body with credentials");
        },
      }),
    }),
    (error) => {
      assert.equal(error.code, "SIGNUP_SUPERSESSION_RECONCILIATION_UNAVAILABLE");
      assert.equal(error.statusCode, 503);
      assert.equal(error.provider, "vapi");
      assert.doesNotMatch(error.message, /private|credentials/i);
      return true;
    }
  );

  await assert.rejects(
    reconcileSignupSupersessionResources({
      signup,
      ...safeLoaders({ loadTwilioNumbers: async () => ({ data: [] }) }),
    }),
    (error) => error.code === "SIGNUP_SUPERSESSION_RECONCILIATION_INCOMPLETE" && error.statusCode === 503
  );
});

test("a durable claim that appears during provider reads blocks the final mutation", async () => {
  const reads = new Map();
  await assert.rejects(
    reconcileSignupSupersessionResources({
      signup,
      ...safeLoaders({
        loadDurableStep: async ({ kind }) => {
          const count = (reads.get(kind) || 0) + 1;
          reads.set(kind, count);
          return {
            data: kind === "vapi-import" && count === 2
              ? { status: "processing", attempts: 1, claimToken: "private" }
              : {},
          };
        },
      }),
    }),
    (error) => error.code === "SIGNUP_DURABLE_PROVISIONING_REQUIRES_REVIEW"
  );
});
