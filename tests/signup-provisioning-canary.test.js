const assert = require("node:assert/strict");
const test = require("node:test");

const {
  CANARY_BUSINESS_NAME,
  CANARY_MARKER,
  assessRepeatedMakeCanaryResults,
  buildSignupProvisioningCanaryPayload,
  fingerprintProviderIdentifier,
  isTrustedSignupProvisioningCanary,
  requireControlledCanadianE164,
} = require("../server/signupProvisioningCanary");
const { verifySignupProvisioningAuthorization } = require("../server/signupProvisioning");

const SIGNING_SECRET = "test-only-canary-signing-secret";
const FINGERPRINT_SECRET = "test-only-canary-fingerprint-secret";

function successfulMakeResult(overrides = {}) {
  return {
    success: true,
    twilioPhoneNumber: "+12495550123",
    vapiPhoneNumberId: "phone-provider-id-123",
    vapiAssistantId: "assistant-provider-id-123",
    ...overrides,
  };
}

test("builds a deterministic and unmistakably synthetic Canadian provisioning payload", () => {
  const input = {
    controlledPhone: "+19055550198",
    signingSecret: SIGNING_SECRET,
    defaultRegion: "ON",
    canaryKey: "production-preflight",
  };
  const first = buildSignupProvisioningCanaryPayload(input);
  const retry = buildSignupProvisioningCanaryPayload(input);

  assert.deepEqual(first, retry);
  assert.equal(first.business.name, CANARY_BUSINESS_NAME);
  assert.match(first.business.name, /Synthetic Test Only/i);
  assert.equal(first.source.app, "my-ai-pa-provisioning-canary");
  assert.equal(first.source.synthetic, true);
  assert.match(first.source.marker, new RegExp(`^${CANARY_MARKER}:`));
  assert.equal(first.security.productionCustomer, false);
  assert.equal(first.security.doNotContact, true);
  assert.equal(first.owner.phone, "+19055550198");
  assert.match(first.owner.email, /^myaipa-canary-[a-f0-9]{16}@example\.invalid$/);
  assert.equal(first.provisioning.preferredAreaCode, "905");
  assert.equal(first.provisioning.preferredRegion, "ON");
  assert.equal(verifySignupProvisioningAuthorization(first, SIGNING_SECRET), true);
  assert.equal(isTrustedSignupProvisioningCanary(first), true);
});

test("the internal canary marker rejects customer-controlled lookalikes", () => {
  const payload = buildSignupProvisioningCanaryPayload({
    controlledPhone: "+12495033301",
    signingSecret: SIGNING_SECRET,
  });

  assert.equal(isTrustedSignupProvisioningCanary({
    ...payload,
    source: { ...payload.source, app: "my-ai-pa-signup" },
  }), false);
  assert.equal(isTrustedSignupProvisioningCanary({
    ...payload,
    security: { ...payload.security, doNotContact: false },
  }), false);
  assert.equal(isTrustedSignupProvisioningCanary({
    ...payload,
    owner: { ...payload.owner, email: "customer@example.com" },
  }), false);
  assert.equal(isTrustedSignupProvisioningCanary({ ...payload, canary: undefined }), false);
});

test("requires a controlled Canadian phone in canonical E.164 form", () => {
  assert.equal(requireControlledCanadianE164("+14165550123"), "+14165550123");
  assert.throws(
    () => requireControlledCanadianE164("416-555-0123"),
    (error) => error.code === "CANARY_CANADIAN_E164_REQUIRED"
  );
  assert.throws(
    () => requireControlledCanadianE164("+17875550123"),
    (error) => error.code === "CANARY_CANADIAN_E164_REQUIRED"
  );
});

test("assesses a repeated successful Make run using fingerprints and equality flags only", () => {
  const firstRaw = successfulMakeResult();
  const retryRaw = JSON.stringify(successfulMakeResult());
  const report = assessRepeatedMakeCanaryResults(firstRaw, retryRaw, {
    fingerprintSecret: FINGERPRINT_SECRET,
  });
  const serialized = JSON.stringify(report);

  assert.equal(report.first.complete, true);
  assert.equal(report.retry.complete, true);
  assert.deepEqual(report.sameResources, {
    twilioNumber: true,
    vapiPhone: true,
    vapiAssistant: true,
  });
  assert.equal(report.allResourcesStable, true);
  assert.equal(report.safeToActivate, true);
  assert.match(report.first.fingerprints.twilioNumber, /^fp_[a-f0-9]{20}$/);
  assert.doesNotMatch(serialized, /\+12495550123/);
  assert.doesNotMatch(serialized, /phone-provider-id-123/);
  assert.doesNotMatch(serialized, /assistant-provider-id-123/);
});

test("fails the canary when a retry creates a different provider resource", () => {
  const report = assessRepeatedMakeCanaryResults(
    successfulMakeResult(),
    successfulMakeResult({ vapiAssistantId: "assistant-provider-id-DIFFERENT" }),
    { fingerprintSecret: FINGERPRINT_SECRET }
  );

  assert.equal(report.sameResources.twilioNumber, true);
  assert.equal(report.sameResources.vapiPhone, true);
  assert.equal(report.sameResources.vapiAssistant, false);
  assert.equal(report.allResourcesStable, false);
  assert.equal(report.safeToActivate, false);
});

test("fails closed when either Make result is incomplete", () => {
  const report = assessRepeatedMakeCanaryResults(
    successfulMakeResult(),
    { success: true },
    { fingerprintSecret: FINGERPRINT_SECRET }
  );

  assert.equal(report.first.complete, true);
  assert.equal(report.retry.complete, false);
  assert.equal(report.allResourcesStable, false);
  assert.equal(report.safeToActivate, false);
});

test("uses a secret-keyed deterministic fingerprint and requires that secret", () => {
  const first = fingerprintProviderIdentifier("provider-id", FINGERPRINT_SECRET);
  const retry = fingerprintProviderIdentifier("provider-id", FINGERPRINT_SECRET);
  const otherSecret = fingerprintProviderIdentifier("provider-id", "different-secret");

  assert.equal(first, retry);
  assert.notEqual(first, otherSecret);
  assert.doesNotMatch(first, /provider/i);
  assert.throws(
    () => assessRepeatedMakeCanaryResults(successfulMakeResult(), successfulMakeResult()),
    (error) => error.code === "CANARY_FINGERPRINT_SECRET_REQUIRED"
  );
});
