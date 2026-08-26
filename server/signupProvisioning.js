const crypto = require("crypto");

const {
  inspectCanadianNumber,
  normalizeNorthAmericanE164,
} = require("./canadianPhoneNumber");

const AUTHORIZATION_VERSION = "v1";
const DEFAULT_CANADIAN_REGION = "ON";
const CANADIAN_REGIONS = new Set([
  "AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT",
]);

function cleanString(value, maxLength = 4_000) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "boolean") return value;
    if (Array.isArray(value) && value.length) return value;
  }
  return "";
}

function cleanEmail(value) {
  return cleanString(value, 254).toLowerCase();
}

function cleanPhone(value) {
  const normalized = normalizeNorthAmericanE164(value);
  return normalized || cleanString(value, 80);
}

function normalizeList(value) {
  const items = Array.isArray(value) ? value : String(value || "").split(",");
  return [...new Set(items.map((item) => cleanString(item, 160)).filter(Boolean))].slice(0, 24);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, stableValue(value[key])])
  );
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function requireSigningSecret(value) {
  const secret = String(value || "");
  if (!secret) {
    const error = new Error("A provisioning signing secret is required.");
    error.code = "PROVISIONING_SIGNING_SECRET_REQUIRED";
    throw error;
  }
  return secret;
}

function buildProvisioningAccountKey(ownerEmail, ownerPhone) {
  const email = cleanEmail(ownerEmail);
  const phone = normalizeNorthAmericanE164(ownerPhone);
  if (!email || !phone) {
    const error = new Error("A normalized owner email and owner phone are required for provisioning identity.");
    error.code = "PROVISIONING_ACCOUNT_IDENTITY_REQUIRED";
    throw error;
  }
  return sha256(`myaipa-provisioning-account-v1\u0000${email}\u0000${phone}`);
}

function inferPreferredCanadianAreaCode(...phoneValues) {
  for (const value of phoneValues.flat()) {
    const inspected = inspectCanadianNumber(value);
    if (inspected.valid) return inspected.areaCode;
  }
  return "";
}

function normalizeProvisioningRegion(value, defaultRegion = DEFAULT_CANADIAN_REGION) {
  const requested = cleanString(value, 2).toUpperCase();
  if (CANADIAN_REGIONS.has(requested)) return requested;
  const fallback = cleanString(defaultRegion, 2).toUpperCase();
  return CANADIAN_REGIONS.has(fallback) ? fallback : DEFAULT_CANADIAN_REGION;
}

function requireAccountKey(value) {
  const key = cleanString(value, 80).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(key)) {
    const error = new Error("A valid hashed provisioning account key is required.");
    error.code = "PROVISIONING_ACCOUNT_KEY_INVALID";
    throw error;
  }
  return key;
}

function buildProvisioningResourceMarker(accountKey) {
  const key = requireAccountKey(accountKey);
  return `myaipa-prov-${key.slice(0, 24)}`;
}

function buildProvisioningResourceName(resourceType, accountKey) {
  const type = cleanString(resourceType, 40)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "resource";
  return `myaipa-${type}-${requireAccountKey(accountKey).slice(0, 20)}`;
}

function selectSignupValues(input) {
  const body = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const canonicalBusiness = body.business && typeof body.business === "object" ? body.business : {};
  const canonicalOwner = body.owner && typeof body.owner === "object" ? body.owner : {};
  const canonicalAssistant = body.aiAssistant && typeof body.aiAssistant === "object" ? body.aiAssistant : {};
  const profile = body.businessProfile && typeof body.businessProfile === "object" ? body.businessProfile : {};
  const setup = body.setupDetails && typeof body.setupDetails === "object" ? body.setupDetails : {};
  const topPricing = body.pricing && typeof body.pricing === "object" ? body.pricing : {};
  const setupPricing = setup.pricing && typeof setup.pricing === "object" ? setup.pricing : {};

  const businessName = cleanString(firstNonEmpty(canonicalBusiness.name, profile.businessName, body.businessName), 180);
  const businessPhone = cleanPhone(firstNonEmpty(canonicalBusiness.phone, profile.phone, body.businessPhone, body.phone));
  const ownerEmail = cleanEmail(firstNonEmpty(canonicalOwner.email, setup.ownerEmail, body.ownerEmail, body.email));
  const ownerPhone = cleanPhone(firstNonEmpty(canonicalOwner.phone, setup.ownerPhone, body.ownerPhone, body.phone, businessPhone));
  const ownerName = cleanString(firstNonEmpty(canonicalOwner.name, setup.ownerName, body.ownerName), 160);
  const businessAddress = cleanString(firstNonEmpty(canonicalBusiness.address, profile.address, setup.businessAddress, body.businessAddress), 500);
  const streetAddress = cleanString(firstNonEmpty(canonicalBusiness.streetAddress, profile.streetAddress, setup.streetAddress, body.streetAddress), 240);
  const city = cleanString(firstNonEmpty(canonicalBusiness.city, profile.city, setup.city, body.city), 120);
  const province = cleanString(firstNonEmpty(canonicalBusiness.province, profile.province, setup.province, body.province), 2).toUpperCase();
  const postalCode = cleanString(firstNonEmpty(canonicalBusiness.postalCode, profile.postalCode, setup.postalCode, body.postalCode), 16).toUpperCase();
  const businessType = cleanString(firstNonEmpty(canonicalAssistant.businessType, setup.businessType, body.businessType), 160);
  const serviceArea = cleanString(firstNonEmpty(canonicalAssistant.serviceArea, setup.serviceArea, body.serviceArea), 500);
  const specializations = normalizeList(firstNonEmpty(
    canonicalAssistant.specializations,
    body.specializations,
    setup.specializations,
    body.specializationList,
    setup.specializationList
  ));
  const specializationList = specializations.join(", ");
  const pricing = {
    ...setupPricing,
    ...topPricing,
    installationFreeEstimate: firstNonEmpty(
      topPricing.installationFreeEstimate,
      setupPricing.installationFreeEstimate,
      body.installationFreeEstimate,
      setup.installationFreeEstimate
    ),
    freeEstimateAnswer: cleanString(firstNonEmpty(
      topPricing.freeEstimateAnswer,
      setupPricing.freeEstimateAnswer,
      body.freeEstimateAnswer,
      setup.freeEstimateAnswer
    ), 240),
    repairVisitFee: cleanString(firstNonEmpty(
      topPricing.repairVisitFee,
      setupPricing.repairVisitFee,
      body.repairVisitFee,
      setup.repairVisitFee
    ), 80),
    repairHourlyRate: cleanString(firstNonEmpty(
      topPricing.repairHourlyRate,
      setupPricing.repairHourlyRate,
      body.repairHourlyRate,
      setup.repairHourlyRate
    ), 80),
    pricingScript: cleanString(firstNonEmpty(
      topPricing.pricingScript,
      setupPricing.pricingScript,
      body.pricingScript,
      setup.pricingScript
    ), 4_000),
  };

  return {
    body,
    canonicalBusiness,
    canonicalOwner,
    canonicalAssistant,
    profile,
    setup,
    businessName,
    businessPhone,
    ownerEmail,
    ownerPhone,
    ownerName,
    businessAddress,
    streetAddress,
    city,
    province,
    postalCode,
    businessType,
    serviceArea,
    specializations,
    specializationList,
    pricing,
  };
}

function provisioningAuthorizationProjection(payload) {
  const provisioning = payload?.provisioning || {};
  return {
    authorizationVersion: provisioning.authorizationVersion,
    idempotencyKey: provisioning.idempotencyKey,
    preferredAreaCode: provisioning.preferredAreaCode,
    preferredRegion: provisioning.preferredRegion,
    resourceMarker: provisioning.resourceMarker,
    resources: provisioning.resources,
    business: payload?.business,
    owner: payload?.owner,
    aiAssistant: payload?.aiAssistant,
    businessProfile: payload?.businessProfile,
    setupDetails: payload?.setupDetails,
    pricing: payload?.pricing,
  };
}

function buildProvisioningContextHash(payload) {
  return sha256(stableStringify(provisioningAuthorizationProjection(payload)));
}

function buildProvisioningAuthorizationToken(contextHash, accountKey, signingSecret) {
  const hash = cleanString(contextHash, 64).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hash)) {
    const error = new Error("A valid provisioning context hash is required.");
    error.code = "PROVISIONING_CONTEXT_HASH_INVALID";
    throw error;
  }
  const key = requireAccountKey(accountKey);
  return crypto
    .createHmac("sha256", requireSigningSecret(signingSecret))
    .update(`${AUTHORIZATION_VERSION}.${hash}.${key}`)
    .digest("hex");
}

function constantTimeTextEqual(left, right) {
  const leftText = String(left || "");
  const rightText = String(right || "");
  const leftDigest = crypto.createHash("sha256").update(leftText).digest();
  const rightDigest = crypto.createHash("sha256").update(rightText).digest();
  return crypto.timingSafeEqual(leftDigest, rightDigest) && leftText.length === rightText.length;
}

function verifySignupProvisioningAuthorization(payload, signingSecret) {
  try {
    const provisioning = payload?.provisioning;
    if (!provisioning || provisioning.authorizationVersion !== AUTHORIZATION_VERSION) return false;
    const values = selectSignupValues(payload);
    const expectedAccountKey = buildProvisioningAccountKey(values.ownerEmail, values.ownerPhone);
    if (!constantTimeTextEqual(provisioning.idempotencyKey, expectedAccountKey)) return false;
    if (!constantTimeTextEqual(provisioning.resourceMarker, buildProvisioningResourceMarker(expectedAccountKey))) return false;
    const expectedContextHash = buildProvisioningContextHash(payload);
    if (!constantTimeTextEqual(provisioning.contextHash, expectedContextHash)) return false;
    const expectedToken = buildProvisioningAuthorizationToken(expectedContextHash, expectedAccountKey, signingSecret);
    return constantTimeTextEqual(provisioning.authorizationToken, expectedToken);
  } catch {
    return false;
  }
}

function verifyProvisioningContextToken(contextHash, accountKey, authorizationToken, signingSecret) {
  try {
    const expected = buildProvisioningAuthorizationToken(contextHash, accountKey, signingSecret);
    return constantTimeTextEqual(authorizationToken, expected);
  } catch {
    return false;
  }
}

function normalizeSignupProvisioningPayload(input, options = {}) {
  const signingSecret = requireSigningSecret(options.signingSecret);
  const values = selectSignupValues(input);
  const accountKey = buildProvisioningAccountKey(values.ownerEmail, values.ownerPhone);
  const preferredAreaCode = inferPreferredCanadianAreaCode(values.ownerPhone, values.businessPhone);
  const preferredRegion = normalizeProvisioningRegion(values.province, options.defaultRegion);
  const resourceMarker = buildProvisioningResourceMarker(accountKey);
  const canonicalBusiness = {
    ...values.canonicalBusiness,
    name: values.businessName,
    phone: values.businessPhone,
    address: values.businessAddress,
    website: cleanString(firstNonEmpty(values.canonicalBusiness.website, values.profile.website, values.body.website), 500),
    hours: cleanString(firstNonEmpty(values.canonicalBusiness.hours, values.profile.hours, values.body.hours), 500),
    services: firstNonEmpty(values.canonicalBusiness.services, values.profile.services, values.body.services),
  };
  const canonicalOwner = {
    ...values.canonicalOwner,
    name: values.ownerName,
    email: values.ownerEmail,
    phone: values.ownerPhone,
  };
  const canonicalAssistant = {
    ...values.canonicalAssistant,
    goals: cleanString(firstNonEmpty(values.canonicalAssistant.goals, values.setup.aiGoals, values.body.aiGoals), 4_000),
    businessType: values.businessType,
    serviceArea: values.serviceArea,
    specializations: values.specializations,
    specializationList: values.specializationList,
    callForwardingNumber: cleanPhone(firstNonEmpty(
      values.canonicalAssistant.callForwardingNumber,
      values.setup.callForwardingNumber,
      values.ownerPhone
    )),
    bookingPreference: cleanString(firstNonEmpty(values.canonicalAssistant.bookingPreference, values.setup.bookingPreference), 240),
    notificationPreference: cleanString(firstNonEmpty(values.canonicalAssistant.notificationPreference, values.setup.notificationPreference), 120),
    tone: cleanString(firstNonEmpty(values.canonicalAssistant.tone, values.setup.aiTone), 120),
    assistantVoice: cleanString(firstNonEmpty(values.canonicalAssistant.assistantVoice, values.setup.assistantVoice), 120),
    greetingScript: cleanString(firstNonEmpty(values.canonicalAssistant.greetingScript, values.setup.greetingScript, values.setup.openingDialogue), 2_000),
  };
  const businessProfile = {
    ...values.profile,
    businessName: values.businessName,
    phone: values.businessPhone,
    address: values.businessAddress,
    streetAddress: values.streetAddress,
    city: values.city,
    province: values.province,
    postalCode: values.postalCode,
    website: canonicalBusiness.website,
    hours: canonicalBusiness.hours,
    services: canonicalBusiness.services,
  };
  const setupDetails = {
    ...values.setup,
    ownerName: values.ownerName,
    ownerEmail: values.ownerEmail,
    ownerPhone: values.ownerPhone,
    businessAddress: values.businessAddress,
    streetAddress: values.streetAddress,
    city: values.city,
    province: values.province,
    postalCode: values.postalCode,
    businessType: values.businessType,
    serviceArea: values.serviceArea,
    callForwardingNumber: canonicalAssistant.callForwardingNumber,
    bookingPreference: canonicalAssistant.bookingPreference,
    notificationPreference: canonicalAssistant.notificationPreference,
    aiTone: canonicalAssistant.tone,
    assistantVoice: canonicalAssistant.assistantVoice,
    specializations: values.specializations,
    specializationList: values.specializationList,
    specialityList: values.specializationList,
    specialtyList: values.specializationList,
    pricing: values.pricing,
    installationFreeEstimate: values.pricing.installationFreeEstimate,
    freeEstimateAnswer: values.pricing.freeEstimateAnswer,
    repairVisitFee: values.pricing.repairVisitFee,
    repairHourlyRate: values.pricing.repairHourlyRate,
    pricingScript: values.pricing.pricingScript,
    aiGoals: canonicalAssistant.goals,
    greetingScript: canonicalAssistant.greetingScript,
  };

  const normalized = {
    ...values.body,
    businessName: values.businessName,
    ownerName: values.ownerName,
    ownerEmail: values.ownerEmail,
    email: values.ownerEmail,
    businessPhone: values.businessPhone,
    phone: values.businessPhone,
    businessAddress: values.businessAddress,
    streetAddress: values.streetAddress,
    city: values.city,
    province: values.province,
    postalCode: values.postalCode,
    businessType: values.businessType,
    serviceArea: values.serviceArea,
    specializations: values.specializations,
    specializationList: values.specializationList,
    specialityList: values.specializationList,
    specialtyList: values.specializationList,
    pricing: values.pricing,
    installationFreeEstimate: values.pricing.installationFreeEstimate,
    freeEstimateAnswer: values.pricing.freeEstimateAnswer,
    repairVisitFee: values.pricing.repairVisitFee,
    repairHourlyRate: values.pricing.repairHourlyRate,
    pricingScript: values.pricing.pricingScript,
    business: canonicalBusiness,
    owner: canonicalOwner,
    aiAssistant: canonicalAssistant,
    businessProfile,
    setupDetails,
    provisioning: {
      ...(values.body.provisioning && typeof values.body.provisioning === "object" ? values.body.provisioning : {}),
      authorizationVersion: AUTHORIZATION_VERSION,
      idempotencyKey: accountKey,
      preferredAreaCode,
      preferredRegion,
      resourceMarker,
      resources: {
        twilioNumber: buildProvisioningResourceName("twilio-number", accountKey),
        vapiAssistant: buildProvisioningResourceName("vapi-assistant", accountKey),
        vapiPhone: buildProvisioningResourceName("vapi-phone", accountKey),
      },
    },
  };
  normalized.provisioning.contextHash = buildProvisioningContextHash(normalized);
  normalized.provisioning.authorizationToken = buildProvisioningAuthorizationToken(
    normalized.provisioning.contextHash,
    normalized.provisioning.idempotencyKey,
    signingSecret
  );
  return normalized;
}

module.exports = {
  AUTHORIZATION_VERSION,
  DEFAULT_CANADIAN_REGION,
  buildProvisioningAccountKey,
  buildProvisioningAuthorizationToken,
  buildProvisioningContextHash,
  buildProvisioningResourceMarker,
  buildProvisioningResourceName,
  inferPreferredCanadianAreaCode,
  normalizeProvisioningRegion,
  normalizeSignupProvisioningPayload,
  verifyProvisioningContextToken,
  verifySignupProvisioningAuthorization,
};
