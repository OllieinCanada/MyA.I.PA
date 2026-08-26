const crypto = require("crypto");

const { requireCanadianNumber } = require("./canadianPhoneNumber");
const { classifyMakeSignupResponse } = require("./makeSignupWebhook");
const { normalizeSignupProvisioningPayload } = require("./signupProvisioning");

const CANARY_MARKER = "MYAIPA_CONTROLLED_PROVISIONING_CANARY_V1";
const CANARY_BUSINESS_NAME = "My AI PA Controlled Provisioning Canary — Synthetic Test Only";

function requireSecret(value, code) {
  const secret = String(value || "");
  if (!secret) {
    const error = new Error("A canary security secret is required.");
    error.code = code;
    throw error;
  }
  return secret;
}

function requireControlledCanadianE164(value) {
  const supplied = String(value || "").trim();
  if (!/^\+1[2-9]\d{9}$/.test(supplied)) {
    const error = new Error("The controlled canary phone must be supplied in Canadian E.164 format.");
    error.code = "CANARY_CANADIAN_E164_REQUIRED";
    throw error;
  }
  try {
    return requireCanadianNumber(supplied, "Controlled canary phone");
  } catch {
    const error = new Error("The controlled canary phone must be a valid Canadian number.");
    error.code = "CANARY_CANADIAN_E164_REQUIRED";
    throw error;
  }
}

function deterministicCanarySuffix(controlledPhone, canaryKey) {
  return crypto
    .createHash("sha256")
    .update(`${CANARY_MARKER}\u0000${controlledPhone}\u0000${String(canaryKey || "primary")}`)
    .digest("hex")
    .slice(0, 16);
}

function buildSignupProvisioningCanaryPayload({
  controlledPhone,
  signingSecret,
  defaultRegion = "ON",
  canaryKey = "primary",
} = {}) {
  const phone = requireControlledCanadianE164(controlledPhone);
  const suffix = deterministicCanarySuffix(phone, canaryKey);
  const sourceMarker = `${CANARY_MARKER}:${suffix}`;
  const payload = {
    event: "signup.completed",
    source: {
      app: "my-ai-pa-provisioning-canary",
      channel: "controlled-canary",
      countryCode: "ca",
      country: "Canada",
      marker: sourceMarker,
      synthetic: true,
    },
    security: {
      syntheticCanary: true,
      productionCustomer: false,
      doNotContact: true,
      reviewRequired: true,
    },
    verification: {
      emailVerified: false,
      smsVerified: false,
    },
    business: {
      name: CANARY_BUSINESS_NAME,
      phone,
      address: "Synthetic provisioning canary — not a customer location",
      website: "https://www.myaipa.ca/",
      hours: "Synthetic test only",
      services: "Controlled phone-provisioning verification",
    },
    owner: {
      name: "Synthetic Canary Owner",
      email: `myaipa-canary-${suffix}@example.invalid`,
      phone,
    },
    aiAssistant: {
      goals: "Verify the controlled provisioning path. This is synthetic test data, not a customer.",
      businessType: "Synthetic provisioning canary",
      serviceArea: `Controlled Canadian canary (${defaultRegion})`,
      callForwardingNumber: phone,
      bookingPreference: "Do not book",
      notificationPreference: "None — controlled canary",
      tone: "Professional",
      assistantVoice: "elliot",
      greetingScript: "This is a controlled My AI PA provisioning canary.",
    },
    province: defaultRegion,
    pricing: {
      installationFreeEstimate: false,
      freeEstimateAnswer: "Synthetic test only",
      repairVisitFee: "",
      repairHourlyRate: "",
      pricingScript: "Do not quote. This is a controlled synthetic canary.",
    },
  };

  const normalized = normalizeSignupProvisioningPayload(payload, {
    signingSecret,
    defaultRegion,
  });
  return {
    ...normalized,
    canary: {
      marker: sourceMarker,
      synthetic: true,
      productionCustomer: false,
    },
  };
}

function isTrustedSignupProvisioningCanary(payload) {
  const source = payload?.source || {};
  const security = payload?.security || {};
  const canary = payload?.canary || {};
  const ownerEmail = String(payload?.owner?.email || payload?.setupDetails?.ownerEmail || "").trim().toLowerCase();
  const sourceMarker = String(source.marker || "").trim();
  return source.app === "my-ai-pa-provisioning-canary"
    && source.channel === "controlled-canary"
    && source.synthetic === true
    && security.syntheticCanary === true
    && security.productionCustomer === false
    && security.doNotContact === true
    && payload?.business?.name === CANARY_BUSINESS_NAME
    && ownerEmail.endsWith("@example.invalid")
    && sourceMarker.startsWith(`${CANARY_MARKER}:`)
    && canary.marker === sourceMarker
    && canary.synthetic === true
    && canary.productionCustomer === false;
}

function fingerprintProviderIdentifier(value, fingerprintSecret) {
  const identifier = String(value || "").trim();
  if (!identifier) return "";
  const secret = requireSecret(fingerprintSecret, "CANARY_FINGERPRINT_SECRET_REQUIRED");
  return `fp_${crypto
    .createHmac("sha256", secret)
    .update(`myaipa-canary-provider-fingerprint-v1\u0000${identifier}`)
    .digest("hex")
    .slice(0, 20)}`;
}

function parseMakeResult(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || ""));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function classifyCanaryResult(value) {
  const data = parseMakeResult(value);
  return classifyMakeSignupResponse(JSON.stringify(data), data);
}

function constantTimeFingerprintEqual(left, right) {
  const leftText = String(left || "");
  const rightText = String(right || "");
  if (!leftText || !rightText) return false;
  const leftDigest = crypto.createHash("sha256").update(leftText).digest();
  const rightDigest = crypto.createHash("sha256").update(rightText).digest();
  return crypto.timingSafeEqual(leftDigest, rightDigest) && leftText.length === rightText.length;
}

function redactCanaryResult(value, fingerprintSecret) {
  const classified = classifyCanaryResult(value);
  return {
    complete: classified.complete === true,
    fingerprints: {
      twilioNumber: fingerprintProviderIdentifier(classified.twilioPhoneNumber, fingerprintSecret),
      vapiPhone: fingerprintProviderIdentifier(classified.vapiPhoneNumberId, fingerprintSecret),
      vapiAssistant: fingerprintProviderIdentifier(classified.vapiAssistantId, fingerprintSecret),
    },
  };
}

function assessRepeatedMakeCanaryResults(firstResult, retryResult, { fingerprintSecret } = {}) {
  requireSecret(fingerprintSecret, "CANARY_FINGERPRINT_SECRET_REQUIRED");
  const first = redactCanaryResult(firstResult, fingerprintSecret);
  const retry = redactCanaryResult(retryResult, fingerprintSecret);
  const sameResources = {
    twilioNumber: constantTimeFingerprintEqual(first.fingerprints.twilioNumber, retry.fingerprints.twilioNumber),
    vapiPhone: constantTimeFingerprintEqual(first.fingerprints.vapiPhone, retry.fingerprints.vapiPhone),
    vapiAssistant: constantTimeFingerprintEqual(first.fingerprints.vapiAssistant, retry.fingerprints.vapiAssistant),
  };
  const allResourcesStable = first.complete
    && retry.complete
    && Object.values(sameResources).every(Boolean);

  return {
    first,
    retry,
    sameResources,
    allResourcesStable,
    safeToActivate: allResourcesStable,
  };
}

module.exports = {
  CANARY_BUSINESS_NAME,
  CANARY_MARKER,
  assessRepeatedMakeCanaryResults,
  buildSignupProvisioningCanaryPayload,
  fingerprintProviderIdentifier,
  isTrustedSignupProvisioningCanary,
  requireControlledCanadianE164,
};
