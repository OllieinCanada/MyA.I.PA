const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildProvisioningAccountKey,
  buildProvisioningResourceMarker,
  buildProvisioningResourceName,
  inferPreferredCanadianAreaCode,
  inferOntarioLocalAreaCode,
  normalizeProvisioningRegion,
  normalizeSignupProvisioningPayload,
  verifyProvisioningContextToken,
  verifySignupProvisioningAuthorization,
} = require("../server/signupProvisioning");

const SIGNING_SECRET = "test-only-provisioning-signing-secret";

function canonicalPhoneSignup(overrides = {}) {
  return {
    event: "signup.completed",
    submittedAt: "2026-08-26T13:00:00.000Z",
    source: { app: "my-ai-pa-voice-signup", channel: "phone", callId: "call-one" },
    untouchedField: { remains: true },
    business: {
      name: "Example Electric",
      phone: "+1 (905) 555-0199",
      address: "23 Robb Street, Hamilton, ON L8L 1A1",
      website: "https://example.ca",
      hours: "Monday-Friday",
      services: "Electrical repairs and installations",
    },
    owner: {
      name: "Jamie Example",
      email: "JAMIE@EXAMPLE.CA",
      phone: "905-555-0198",
    },
    aiAssistant: {
      goals: "Answer calls and collect lead details.",
      businessType: "Electrical",
      serviceArea: "Hamilton and Burlington",
      callForwardingNumber: "905-555-0198",
      tone: "Professional",
      assistantVoice: "elliot",
    },
    pricing: {
      freeEstimateAnswer: "yes we do",
      repairVisitFee: "125",
      repairHourlyRate: "95",
    },
    ...overrides,
  };
}

test("normalizes a canonical phone signup and adds the complete legacy Make aliases", () => {
  const payload = normalizeSignupProvisioningPayload(canonicalPhoneSignup(), {
    signingSecret: SIGNING_SECRET,
  });

  assert.deepEqual(payload.untouchedField, { remains: true });
  assert.equal(payload.businessProfile.businessName, "Example Electric");
  assert.equal(payload.businessProfile.phone, "+19055550199");
  assert.equal(payload.businessProfile.address, "23 Robb Street, Hamilton, ON L8L 1A1");
  assert.equal(payload.setupDetails.ownerName, "Jamie Example");
  assert.equal(payload.setupDetails.ownerEmail, "jamie@example.ca");
  assert.equal(payload.setupDetails.ownerPhone, "+19055550198");
  assert.equal(payload.setupDetails.businessType, "Electrical");
  assert.equal(payload.setupDetails.serviceArea, "Hamilton and Burlington");
  assert.equal(payload.setupDetails.pricing.repairVisitFee, "125");
  assert.equal(payload.setupDetails.freeEstimateAnswer, "yes we do");
  assert.equal(payload.provisioning.preferredAreaCode, "289");
  assert.equal(payload.provisioning.preferredRegion, "ON");
  assert.match(payload.provisioning.idempotencyKey, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(payload.provisioning.idempotencyKey, /jamie|example|905/i);
  assert.equal(verifySignupProvisioningAuthorization(payload, SIGNING_SECRET), true);
});

test("normalizes an existing website payload into canonical and legacy representations", () => {
  const payload = normalizeSignupProvisioningPayload({
    country: "ca",
    retained: "website-field",
    businessName: "Legacy Plumbing",
    ownerName: "Taylor Owner",
    ownerEmail: "taylor@example.ca",
    businessPhone: "416-555-0177",
    businessType: "Plumbing",
    serviceArea: "Toronto",
    businessProfile: {
      businessName: "Legacy Plumbing",
      phone: "416-555-0177",
      address: "10 King Street, Toronto, ON",
      province: "ON",
      services: "Repairs and installations",
      customProfileField: "preserved",
    },
    setupDetails: {
      ownerName: "Taylor Owner",
      ownerEmail: "taylor@example.ca",
      ownerPhone: "647-555-0188",
      businessType: "Plumbing",
      serviceArea: "Toronto",
      customSetupField: "preserved",
      pricing: { repairVisitFee: "100" },
    },
  }, { signingSecret: SIGNING_SECRET });

  assert.equal(payload.retained, "website-field");
  assert.equal(payload.business.name, "Legacy Plumbing");
  assert.equal(payload.business.phone, "+14165550177");
  assert.equal(payload.owner.name, "Taylor Owner");
  assert.equal(payload.owner.email, "taylor@example.ca");
  assert.equal(payload.owner.phone, "+16475550188");
  assert.equal(payload.aiAssistant.businessType, "Plumbing");
  assert.equal(payload.aiAssistant.serviceArea, "Toronto");
  assert.equal(payload.businessProfile.customProfileField, "preserved");
  assert.equal(payload.setupDetails.customSetupField, "preserved");
  assert.equal(payload.pricing.repairVisitFee, "100");
  assert.equal(verifySignupProvisioningAuthorization(payload, SIGNING_SECRET), true);
});

test("keeps account provisioning identity and resource names stable across call retries", () => {
  const first = normalizeSignupProvisioningPayload(canonicalPhoneSignup(), {
    signingSecret: SIGNING_SECRET,
  });
  const retry = normalizeSignupProvisioningPayload(canonicalPhoneSignup({
    submittedAt: "2026-08-26T14:30:00.000Z",
    source: { app: "my-ai-pa-voice-signup", channel: "phone", callId: "call-two" },
  }), { signingSecret: SIGNING_SECRET });

  assert.equal(first.provisioning.idempotencyKey, retry.provisioning.idempotencyKey);
  assert.equal(first.provisioning.contextHash, retry.provisioning.contextHash);
  assert.equal(first.provisioning.authorizationToken, retry.provisioning.authorizationToken);
  assert.deepEqual(first.provisioning.resources, retry.provisioning.resources);
  assert.equal(
    buildProvisioningResourceMarker(first.provisioning.idempotencyKey),
    first.provisioning.resourceMarker
  );
  assert.equal(
    buildProvisioningResourceName("vapi-assistant", first.provisioning.idempotencyKey),
    first.provisioning.resources.vapiAssistant
  );
});

test("keeps deterministic Vapi resource names within the provider's 40-character limit", () => {
  const accountKey = "a".repeat(64);
  const assistantName = buildProvisioningResourceName("vapi-assistant", accountKey);
  const phoneName = buildProvisioningResourceName("vapi-phone", accountKey);
  const twilioName = buildProvisioningResourceName("twilio-number", accountKey);

  assert.ok(assistantName.length <= 40);
  assert.ok(phoneName.length <= 40);
  assert.equal(twilioName, `myaipa-twilio-number-${"a".repeat(20)}`);
  assert.equal(assistantName, buildProvisioningResourceName("vapi-assistant", accountKey));
});

test("rejects provisioning payload tampering and the wrong signing secret", () => {
  const payload = normalizeSignupProvisioningPayload(canonicalPhoneSignup(), {
    signingSecret: SIGNING_SECRET,
  });
  const tampered = structuredClone(payload);
  tampered.setupDetails.serviceArea = "A different service area";

  assert.equal(verifySignupProvisioningAuthorization(tampered, SIGNING_SECRET), false);
  assert.equal(verifySignupProvisioningAuthorization(payload, "wrong-secret"), false);
  assert.equal(verifySignupProvisioningAuthorization(payload, SIGNING_SECRET), true);
});

test("downstream stages verify the signed context without receiving customer details", () => {
  const payload = normalizeSignupProvisioningPayload(canonicalPhoneSignup(), {
    signingSecret: SIGNING_SECRET,
  });
  assert.equal(verifyProvisioningContextToken(
    payload.provisioning.contextHash,
    payload.provisioning.idempotencyKey,
    payload.provisioning.authorizationToken,
    SIGNING_SECRET
  ), true);
  assert.equal(verifyProvisioningContextToken(
    payload.provisioning.contextHash.replace(/^./, "0"),
    payload.provisioning.idempotencyKey,
    payload.provisioning.authorizationToken,
    SIGNING_SECRET
  ), false);
  assert.equal(verifyProvisioningContextToken(
    payload.provisioning.contextHash,
    "0".repeat(64),
    payload.provisioning.authorizationToken,
    SIGNING_SECRET
  ), false);
});

test("infers only Canadian area codes and applies a configurable Canadian region fallback", () => {
  assert.equal(inferPreferredCanadianAreaCode("787-555-0198", "905-555-0199"), "905");
  assert.equal(inferPreferredCanadianAreaCode("787-555-0198", "212-555-0199"), "");
  assert.equal(normalizeProvisioningRegion("BC", "ON"), "BC");
  assert.equal(normalizeProvisioningRegion("", "QC"), "QC");
  assert.equal(normalizeProvisioningRegion("ZZ", "invalid"), "ON");

  const payload = normalizeSignupProvisioningPayload(canonicalPhoneSignup({
    owner: { name: "Jamie Example", email: "jamie@example.ca", phone: "787-555-0198" },
    business: {
      ...canonicalPhoneSignup().business,
      phone: "212-555-0199",
      address: "10 King Street, Toronto, ON M5H 1A1",
      city: "Toronto",
      postalCode: "M5H 1A1",
    },
    aiAssistant: {
      ...canonicalPhoneSignup().aiAssistant,
      serviceArea: "Toronto",
    },
  }), { signingSecret: SIGNING_SECRET, defaultRegion: "QC" });
  assert.equal(payload.provisioning.preferredAreaCode, "");
  assert.equal(payload.provisioning.preferredRegion, "QC");
});

test("prefers a local 289 number for Niagara and Hamilton businesses over the owner's phone area code", () => {
  assert.equal(inferOntarioLocalAreaCode({ city: "Grimsby", postalCode: "L3M 1P1" }), "289");
  assert.equal(inferOntarioLocalAreaCode({ serviceArea: "Hamilton, Burlington and Niagara" }), "289");
  assert.equal(inferOntarioLocalAreaCode({ city: "Ottawa", postalCode: "K1A 0A9" }), "");

  const payload = normalizeSignupProvisioningPayload(canonicalPhoneSignup({
    business: {
      ...canonicalPhoneSignup().business,
      phone: "+1 (343) 555-0199",
      address: "15 Main Street, Grimsby, ON L3M 1P1",
      city: "Grimsby",
      province: "ON",
      postalCode: "L3M 1P1",
    },
    owner: {
      name: "Jamie Example",
      email: "jamie@example.ca",
      phone: "+1 (343) 555-0198",
    },
    aiAssistant: {
      ...canonicalPhoneSignup().aiAssistant,
      serviceArea: "Niagara and Hamilton",
    },
  }), { signingSecret: SIGNING_SECRET });

  assert.equal(payload.provisioning.preferredAreaCode, "289");
  assert.equal(payload.provisioning.preferredRegion, "ON");
  assert.equal(verifySignupProvisioningAuthorization(payload, SIGNING_SECRET), true);
});

test("derives the account key from normalized owner identity only", () => {
  const first = buildProvisioningAccountKey("OWNER@EXAMPLE.CA", "(905) 555-0198");
  const second = buildProvisioningAccountKey("owner@example.ca", "+1 905 555 0198");
  assert.equal(first, second);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.throws(
    () => buildProvisioningAccountKey("owner@example.ca", "555"),
    (error) => error.code === "PROVISIONING_ACCOUNT_IDENTITY_REQUIRED"
  );
});
