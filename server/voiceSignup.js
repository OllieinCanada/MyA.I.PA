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
      emailVerified: false,
      smsVerified: false,
    },
    business: {
      name: businessName,
      phone: businessPhone,
      address: businessAddress,
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
  isVapiVoiceSignupTool,
  normalizeNanpPhone,
  normalizePostalCode,
};
