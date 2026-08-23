const CANADIAN_AREA_CODES = new Set([
  "204", "226", "236", "249", "250", "257", "263", "289", "306", "343", "354", "365", "367", "368",
  "382", "403", "416", "418", "428", "431", "437", "438", "450", "468", "474", "506", "514", "519",
  "548", "579", "581", "584", "587", "604", "613", "639", "647", "672", "683", "705", "709", "742",
  "753", "778", "780", "782", "807", "819", "825", "867", "873", "879", "902", "905", "942",
]);

function normalizeNorthAmericanE164(value) {
  const digits = String(value || "").replace(/\D/g, "");
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(national)) return "";
  return `+1${national}`;
}

function inspectCanadianNumber(value) {
  const e164 = normalizeNorthAmericanE164(value);
  const areaCode = e164 ? e164.slice(2, 5) : "";
  return {
    valid: Boolean(e164 && CANADIAN_AREA_CODES.has(areaCode)),
    e164,
    areaCode,
    country: e164 && CANADIAN_AREA_CODES.has(areaCode) ? "CA" : "",
  };
}

function requireCanadianNumber(value, field = "phoneNumber") {
  const result = inspectCanadianNumber(value);
  if (result.valid) return result.e164;
  const error = new Error(`${field} must be a valid Canadian phone number.`);
  error.statusCode = 422;
  error.code = "CANADIAN_PHONE_REQUIRED";
  throw error;
}

function validateProvisionedCanadianNumber(record, { expectedVoiceUrl = "" } = {}) {
  const e164 = requireCanadianNumber(record?.phone_number || record?.phoneNumber || record?.number, "Provisioned number");
  const capabilities = record?.capabilities || {};
  const voiceEnabled = capabilities.voice !== false;
  const smsEnabled = capabilities.sms !== false;
  const voiceUrl = String(record?.voice_url || record?.voiceUrl || "").trim();
  const routingMatches = !expectedVoiceUrl || voiceUrl === expectedVoiceUrl;
  if (!voiceEnabled || !smsEnabled || !routingMatches) {
    const error = new Error("The provisioned Canadian number is not ready for the required voice and SMS routing.");
    error.statusCode = 502;
    error.code = "PROVISIONED_NUMBER_NOT_READY";
    throw error;
  }
  return e164;
}

module.exports = {
  CANADIAN_AREA_CODES,
  inspectCanadianNumber,
  normalizeNorthAmericanE164,
  requireCanadianNumber,
  validateProvisionedCanadianNumber,
};
