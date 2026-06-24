import {
  CANADIAN_PROVINCES,
  SIGNUP_ATTEMPT_LIMIT,
  SIGNUP_ATTEMPT_STORAGE_KEY,
  SIGNUP_ATTEMPT_WINDOW_MS,
} from "./signupConfig";

export function getBrowserSignupAttempts() {
  if (typeof window === "undefined" || !window.localStorage) return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SIGNUP_ATTEMPT_STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function rememberBrowserSignupAttempt() {
  if (typeof window === "undefined" || !window.localStorage) return;
  const now = Date.now();
  const attempts = getBrowserSignupAttempts().filter((timestamp) => now - Number(timestamp) < SIGNUP_ATTEMPT_WINDOW_MS);
  attempts.push(now);
  window.localStorage.setItem(SIGNUP_ATTEMPT_STORAGE_KEY, JSON.stringify(attempts));
}

export function hasTooManyBrowserSignupAttempts() {
  const now = Date.now();
  return getBrowserSignupAttempts().filter((timestamp) => now - Number(timestamp) < SIGNUP_ATTEMPT_WINDOW_MS).length >= SIGNUP_ATTEMPT_LIMIT;
}

export function isValidEmailAddress(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

export function hasPlaceholderText(value) {
  return /\b(e\.?g\.?|example|test|asdf|yourbusiness|main st|jamie smith|smith electrical|555-?1234)\b/i.test(String(value || ""));
}

export function getPhoneDigits(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

export function formatBusinessAddress(details) {
  return [details.streetAddress, details.city, details.province, details.postalCode]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(", ");
}

export function buildPricingScript(pricing) {
  const visitFee = String(pricing.repairVisitFee ?? "").trim() || "100";
  const hourlyRate = String(pricing.repairHourlyRate ?? "").trim() || "100";
  const installationFreeEstimate = pricing.installationFreeEstimate !== false;

  return [
    installationFreeEstimate
      ? "Installations: Ask, \"Would you like us to come down and give you a free estimate?\""
      : "Installations: Tell the caller the team will confirm estimate pricing before scheduling.",
    `Repairs or maintenance: ${visitFee} dollars to come out and ${hourlyRate} dollars per hour after that.`,
    "Ask, \"Would you like to continue?\"",
  ]
    .filter(Boolean)
    .join("\n");
}

export function validateBusinessDetails(details) {
  const ownerName = details.ownerName.trim();
  const businessName = details.businessName.trim();
  const phone = details.phone.trim();
  const email = details.email.trim();
  const streetAddress = details.streetAddress.trim();
  const city = details.city.trim();
  const province = details.province.trim();
  const postalCode = details.postalCode.trim();
  const phoneDigits = getPhoneDigits(phone);
  const postalCodePattern = /^[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d$/;

  const errors = {
    ownerName:
      ownerName.split(/\s+/).filter(Boolean).length < 2 || ownerName.length < 5 || hasPlaceholderText(ownerName)
        ? "Enter the owner's first and last name."
        : "",
    businessName:
      businessName.length < 4 || hasPlaceholderText(businessName)
        ? "Enter the real business name."
        : "",
    phone:
      phoneDigits.length !== 10 || /^(\d)\1{9}$/.test(phoneDigits) || hasPlaceholderText(phone)
        ? "Enter a real 10-digit business phone number."
        : "",
    email:
      !isValidEmailAddress(email) || hasPlaceholderText(email)
        ? "Enter a real business email address."
        : "",
    streetAddress:
      streetAddress.length < 6 || !/\d/.test(streetAddress) || !/[A-Za-z]/.test(streetAddress) || hasPlaceholderText(streetAddress)
        ? "Enter the street address."
        : "",
    city:
      city.length < 2 || !/^[A-Za-z][A-Za-z\s.'-]+$/.test(city) || hasPlaceholderText(city)
        ? "Enter the city."
        : "",
    province:
      !CANADIAN_PROVINCES.some((item) => item.value === province)
        ? "Select a province."
        : "",
    postalCode:
      !postalCodePattern.test(postalCode) || hasPlaceholderText(postalCode)
        ? "Enter a valid postal code."
        : "",
  };

  return {
    errors,
    isValid: Object.values(errors).every((message) => !message),
  };
}

export async function parseApiResponse(response, fallbackLabel) {
  const rawText = await response.text();
  let data = {};
  try {
    data = rawText ? JSON.parse(rawText) : {};
  } catch {
    data = rawText ? { message: rawText } : {};
  }

  if (!response.ok) {
    throw new Error(data?.error || `${fallbackLabel} (${response.status})`);
  }

  return { ok: true, ...data };
}

export function getSignupSuccess(data) {
  if (data?.success === false || data?.ok === false) return false;
  return data?.success === true || data?.ok === true;
}

export function parseMaybeJson(value) {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed || !/^[\[{]/.test(trimmed)) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

export function extractPhoneFromText(value) {
  const match = String(value || "").match(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/);
  return match ? match[0] : "";
}

export function getTwilioPhoneNumber(data) {
  const phoneKeys = new Set([
    "twiliophonenumber",
    "twilio_phone_number",
    "phonenumber",
    "assignedphonenumber",
    "assigned_number",
    "number",
  ]);
  const seen = new Set();

  const visit = (value, key = "") => {
    const parsed = parseMaybeJson(value);
    if (parsed && typeof parsed === "object") {
      if (seen.has(parsed)) return "";
      seen.add(parsed);

      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          const found = visit(item, key);
          if (found) return found;
        }
        return "";
      }

      for (const [entryKey, entryValue] of Object.entries(parsed)) {
        const normalizedKey = entryKey.toLowerCase().replace(/[^a-z0-9_]/g, "");
        if (phoneKeys.has(normalizedKey)) {
          const directPhone = extractPhoneFromText(entryValue);
          if (directPhone) return directPhone;
        }
        const found = visit(entryValue, entryKey);
        if (found) return found;
      }
      return "";
    }

    const normalizedKey = String(key || "").toLowerCase().replace(/[^a-z0-9_]/g, "");
    return phoneKeys.has(normalizedKey) ? extractPhoneFromText(parsed) : "";
  };

  return visit(data) || extractPhoneFromText(JSON.stringify(data || {}));
}

export function formatPhoneNumber(value) {
  const raw = String(value || "").trim();
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return raw;
}

export function buildSignupPayload({
  details,
  pricing,
  selectedAreas,
  selectedTrade,
  selectedAgent,
  selectedDialogueText,
  selectedSpecializationLabels,
  specializationNotes,
  botTrap,
  captchaProvider,
  captchaToken,
  signupStartedAt,
}) {
  const serviceArea = selectedAreas.join(", ");
  const businessAddress = formatBusinessAddress(details);
  const pricingScript = buildPricingScript(pricing);

  return {
    country: "ca",
    businessName: details.businessName.trim(),
    ownerName: details.ownerName.trim(),
    ownerEmail: details.email.trim(),
    email: details.email.trim(),
    businessPhone: details.phone.trim(),
    phone: details.phone.trim(),
    businessAddress,
    streetAddress: details.streetAddress.trim(),
    city: details.city.trim(),
    province: details.province.trim(),
    postalCode: details.postalCode.trim().toUpperCase(),
    businessType: selectedTrade.businessType,
    serviceArea,
    pricingScript,
    selectedPlace: null,
    businessProfile: {
      businessName: details.businessName.trim(),
      phone: details.phone.trim(),
      address: businessAddress,
      streetAddress: details.streetAddress.trim(),
      city: details.city.trim(),
      province: details.province.trim(),
      postalCode: details.postalCode.trim().toUpperCase(),
      website: "",
      hours: "Monday-Friday 9:00 AM-5:00 PM",
      services: selectedTrade.services,
    },
    setupDetails: {
      ownerName: details.ownerName.trim(),
      ownerEmail: details.email.trim(),
      ownerPhone: details.phone.trim(),
      businessAddress,
      streetAddress: details.streetAddress.trim(),
      city: details.city.trim(),
      province: details.province.trim(),
      postalCode: details.postalCode.trim().toUpperCase(),
      businessType: selectedTrade.businessType,
      serviceArea,
      callForwardingNumber: details.phone.trim(),
      bookingPreference: "Text owner first",
      notificationPreference: "SMS",
      aiTone: "Professional",
      assistantVoice: selectedAgent.value,
      assistantVoiceLabel: selectedAgent.label,
      voiceSampleUrl: selectedAgent.sampleSrc,
      openingDialogue: selectedDialogueText,
      specializations: selectedSpecializationLabels,
      specializationNotes: specializationNotes.trim(),
      pricing,
      pricingScript,
      aiGoals: `Answer calls, capture lead details, text the owner, and help callers in ${serviceArea}. The business handles ${selectedSpecializationLabels.join(", ").toLowerCase()} work. Use this pricing script when callers ask about estimates, repairs, maintenance, or installations: ${pricingScript}${specializationNotes.trim() ? ` Notes: ${specializationNotes.trim()}` : ""}`,
      faq: selectedTrade.faq,
      greetingScript: selectedDialogueText,
      emergencyAfterHoursAvailable: true,
      emergencyRules: "Escalate urgent safety or service requests to the owner.",
    },
    security: {
      companyWebsite: botTrap,
      clientElapsedMs: Date.now() - signupStartedAt,
      captchaProvider,
      captchaToken,
      recaptchaToken: captchaProvider === "recaptcha" ? captchaToken : "",
      turnstileToken: captchaProvider === "turnstile" ? captchaToken : "",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
      pageUrl: typeof window !== "undefined" ? window.location.href : "",
    },
  };
}
