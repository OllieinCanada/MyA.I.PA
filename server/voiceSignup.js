const crypto = require("crypto");
const { buildSignupConfirmationSummary } = require("./signupVoiceQuality");

const CANADIAN_PROVINCES = new Set([
  "AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT",
]);

function voiceSignupError(message, field, code = "VOICE_SIGNUP_INVALID") {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = code;
  if (field) error.field = field;
  return error;
}

function clean(value, maxLength = 240) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function required(value, field, maxLength) {
  const result = clean(value, maxLength);
  if (!result) throw voiceSignupError(`${field} is required.`, field);
  return result;
}

function normalizeNanpPhone(value, field) {
  const digits = String(value || "").replace(/\D/g, "");
  const normalizedDigits = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (normalizedDigits.length !== 10 || /^(\d)\1{9}$/.test(normalizedDigits)) {
    throw voiceSignupError(`${field} must be a valid ten-digit Canadian or US phone number.`, field);
  }
  return `+1${normalizedDigits}`;
}

function normalizeEmail(value) {
  const email = clean(value, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw voiceSignupError("ownerEmail must be a valid email address.", "ownerEmail");
  }
  return email;
}

function normalizePostalCode(value) {
  const compact = clean(value, 12).toUpperCase().replace(/\s+/g, "");
  if (!/^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(compact)) {
    throw voiceSignupError("postalCode must be a valid Canadian postal code.", "postalCode");
  }
  return `${compact.slice(0, 3)} ${compact.slice(3)}`;
}

function normalizeSpecializations(value) {
  const source = Array.isArray(value) ? value : String(value || "").split(",");
  return [...new Set(source.map((item) => clean(item, 120)).filter(Boolean))].slice(0, 12);
}

function normalizeConfirmation(parameters) {
  const callerConfirmed = parameters?.callerConfirmed === true;
  const confirmationText = clean(parameters?.confirmationText, 180);
  if (!callerConfirmed || !confirmationText) {
    throw voiceSignupError(
      "Read the signup details back to the caller and obtain an explicit yes before submitting.",
      "callerConfirmed",
      "VOICE_SIGNUP_CONFIRMATION_REQUIRED"
    );
  }
  return confirmationText;
}

function getVoiceSignupReviewIdentity(payload = {}) {
  return {
    owner: {
      name: payload.owner?.name || "",
      email: payload.owner?.email || "",
      phone: payload.owner?.phone || "",
    },
    business: {
      name: payload.business?.name || "",
      phone: payload.business?.phone || "",
      streetAddress: payload.business?.streetAddress || "",
      city: payload.business?.city || "",
      province: payload.business?.province || "",
      postalCode: payload.business?.postalCode || "",
      services: payload.business?.services || "",
    },
    assistant: {
      businessType: payload.aiAssistant?.businessType || "",
      serviceArea: payload.aiAssistant?.serviceArea || "",
    },
  };
}

function encodeReviewToken(payload) {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function signReviewToken(encoded, secret) {
  return crypto.createHmac("sha256", secret).update(encoded).digest("base64url");
}

function createVoiceSignupReview(parameters = {}, context = {}) {
  const secret = clean(context.secret, 500);
  if (!secret) throw voiceSignupError("Voice signup review signing is unavailable.", "reviewToken", "VOICE_SIGNUP_REVIEW_UNAVAILABLE");
  const payload = buildVoiceSignupPayload({
    ...parameters,
    callerConfirmed: true,
    confirmationText: "review prepared",
  }, context);
  const identity = getVoiceSignupReviewIdentity(payload);
  const issuedAt = Number(context.now || Date.now());
  const tokenPayload = {
    v: 1,
    callId: clean(context.callId, 180),
    digest: crypto.createHash("sha256").update(JSON.stringify(identity)).digest("base64url"),
    expiresAt: issuedAt + 10 * 60 * 1000,
  };
  const encoded = encodeReviewToken(tokenPayload);
  const reviewToken = `${encoded}.${signReviewToken(encoded, secret)}`;
  return {
    reviewToken,
    readback: buildSignupConfirmationSummary({
      ownerName: payload.owner.name,
      ownerEmail: payload.owner.email,
      ownerPhone: payload.owner.phone,
      businessName: payload.business.name,
      businessPhone: payload.business.phone,
      streetAddress: payload.business.streetAddress,
      city: payload.business.city,
      province: payload.business.province,
      postalCode: payload.business.postalCode,
      businessType: payload.aiAssistant.businessType,
      serviceArea: payload.aiAssistant.serviceArea,
      services: payload.business.services,
    }),
  };
}

function verifyVoiceSignupReview(parameters = {}, payload = {}, context = {}) {
  const secret = clean(context.secret, 500);
  const token = clean(parameters.reviewToken, 2000);
  const [encoded, signature, ...extra] = token.split(".");
  if (!secret || !encoded || !signature || extra.length) {
    throw voiceSignupError("Prepare and read the verified summary before submitting.", "reviewToken", "VOICE_SIGNUP_REVIEW_REQUIRED");
  }
  const expected = signReviewToken(encoded, secret);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (signatureBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
    throw voiceSignupError("The signup review token is invalid. Prepare the summary again.", "reviewToken", "VOICE_SIGNUP_REVIEW_INVALID");
  }
  let tokenPayload = {};
  try { tokenPayload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")); } catch {}
  const now = Number(context.now || Date.now());
  const callId = clean(context.callId, 180);
  const digest = crypto.createHash("sha256").update(JSON.stringify(getVoiceSignupReviewIdentity(payload))).digest("base64url");
  if (tokenPayload.v !== 1 || tokenPayload.callId !== callId || tokenPayload.digest !== digest || Number(tokenPayload.expiresAt || 0) < now) {
    throw voiceSignupError("The reviewed details changed or expired. Prepare and read the summary again.", "reviewToken", "VOICE_SIGNUP_REVIEW_MISMATCH");
  }
  return true;
}

function isVapiVoiceSignupTool(name) {
  return ["begin_myaipa_signup", "start_myaipa_signup"].includes(clean(name, 180).toLowerCase());
}

function buildVoiceSignupPayload(parameters = {}, context = {}) {
  const confirmationText = normalizeConfirmation(parameters);
  const ownerName = required(parameters.ownerName, "ownerName", 120);
  const ownerEmail = normalizeEmail(parameters.ownerEmail);
  const ownerPhone = normalizeNanpPhone(parameters.ownerPhone, "ownerPhone");
  const businessName = required(parameters.businessName, "businessName", 180);
  const businessPhone = normalizeNanpPhone(parameters.businessPhone || ownerPhone, "businessPhone");
  const streetAddress = required(parameters.streetAddress, "streetAddress", 240);
  const city = required(parameters.city, "city", 120);
  const province = required(parameters.province, "province", 2).toUpperCase();
  if (!CANADIAN_PROVINCES.has(province)) {
    throw voiceSignupError("province must be a valid two-letter Canadian province or territory.", "province");
  }
  const postalCode = normalizePostalCode(parameters.postalCode);
  const businessType = required(parameters.businessType, "businessType", 120);
  const serviceArea = required(parameters.serviceArea, "serviceArea", 300);
  const services = required(parameters.services, "services", 1200);
  const specializations = normalizeSpecializations(parameters.specializations);
  const businessAddress = `${streetAddress}, ${city}, ${province} ${postalCode}`;
  const submittedAt = context.submittedAt || new Date().toISOString();
  const callId = clean(context.callId, 180);
  const website = clean(parameters.website, 500);

  return {
    event: "signup.completed",
    submittedAt,
    source: {
      app: "my-ai-pa-voice-signup",
      channel: "phone",
      countryCode: "ca",
      country: "Canada",
      ...(callId ? { callId } : {}),
    },
    security: {
      voiceSignup: true,
      callerConfirmed: true,
      confirmationText,
      emailVerificationRequired: true,
      reviewRequired: false,
    },
    verification: {
      identityVerified: false,
      emailVerified: false,
      smsVerified: false,
    },
    business: {
      name: businessName,
      phone: businessPhone,
      address: businessAddress,
      streetAddress,
      city,
      province,
      postalCode,
      website,
      hours: clean(parameters.hours, 500),
      services,
    },
    owner: {
      name: ownerName,
      email: ownerEmail,
      phone: ownerPhone,
    },
    specializations,
    specializationList: specializations.join(", "),
    aiAssistant: {
      goals: `Answer calls for ${businessName}, capture lead details, text the owner, and help callers in ${serviceArea}.`,
      businessType,
      serviceArea,
      specializations,
      specializationList: specializations.join(", "),
      callForwardingNumber: ownerPhone,
      bookingPreference: "Text owner first",
      notificationPreference: "SMS",
      tone: "Professional",
      assistantVoice: "elliot",
      emergencyAfterHoursAvailable: false,
      emergencyRules: "Do not promise emergency dispatch. Escalate urgent safety concerns to emergency services or the owner.",
      greetingScript: `Hi, thanks for calling ${businessName}. How can I help you today?`,
    },
  };
}

module.exports = {
  buildVoiceSignupPayload,
  createVoiceSignupReview,
  isVapiVoiceSignupTool,
  normalizeNanpPhone,
  normalizePostalCode,
  verifyVoiceSignupReview,
};
