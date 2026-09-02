const CONTRACTOR_TERMS = /\b(electric(?:al|ian)?|plumb(?:er|ing)?|hvac|heating|cooling|roof(?:er|ing)?|contract(?:or|ing)?|landscap(?:e|ing)|painting|carpentry|renovation|construction)\b/i;

function clean(value, maxLength = 500) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function formatCanadianPostalCodeForSpeech(value) {
  const compact = clean(value, 12).toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(compact)) return clean(value, 12);
  const speakCharacter = (character) => /\d/.test(character)
    ? `number ${["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"][Number(character)]}`
    : `letter ${character}`;
  return `${compact.slice(0, 3).split("").map(speakCharacter).join(", ")} — ${compact.slice(3).split("").map(speakCharacter).join(", ")}`;
}

function formatPhoneForSpeech(value) {
  const digits = String(value || "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  const names = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
  return digits.length === 10 ? digits.split("").map((digit) => names[Number(digit)]).join(", ") : clean(value, 40);
}

function formatEmailForSpeech(value) {
  const email = clean(value, 254).toLowerCase();
  const [localPart, domain = ""] = email.split("@");
  if (!localPart || !domain) return email;
  const digitNames = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
  const speakCharacter = (character) => {
    if (/\d/.test(character)) return digitNames[Number(character)];
    if (character === ".") return "dot";
    if (character === "_") return "underscore";
    if (character === "-") return "dash";
    if (character === "+") return "plus";
    return character;
  };
  const spokenLocal = [...localPart].map(speakCharacter).join(", ");
  const spokenDomain = domain.split(".").filter(Boolean).join(" dot ");
  return `${spokenLocal}, at ${spokenDomain}`;
}

function buildSignupConfirmationSummary(input = {}) {
  const lines = [
    ["Owner", clean(input.ownerName, 120)],
    ["Email", formatEmailForSpeech(input.ownerEmail)],
    ["Owner mobile", formatPhoneForSpeech(input.ownerPhone)],
    ["Business", clean(input.businessName, 180)],
    ["Business phone", formatPhoneForSpeech(input.businessPhone || input.ownerPhone)],
    ["Address", [clean(input.streetAddress, 240), clean(input.city, 120), clean(input.province, 2).toUpperCase(), formatCanadianPostalCodeForSpeech(input.postalCode)].filter(Boolean).join(", ")],
    ["Business type", clean(input.businessType, 120)],
    ["Service area", clean(input.serviceArea, 300)],
    ["Main services", clean(input.services, 500)],
  ].filter(([, value]) => value);
  return lines.map(([label, value]) => `${label}: ${value}.`).join(" ");
}

function classifySignupAssistantPlaybook(input = {}) {
  const source = [input.businessType, input.services, ...(Array.isArray(input.specializations) ? input.specializations : [])]
    .map((value) => clean(value, 500)).join(" ");
  return CONTRACTOR_TERMS.test(source) ? "contractor" : "general";
}

function isExplicitDemoSmsRequest(value) {
  const text = clean(value, 240).toLowerCase();
  if (!text || /\b(?:do not|don't|dont|no)\b.{0,24}\b(?:text|sms|message)\b/.test(text)) return false;
  return /\b(?:text|sms|message)\b/.test(text)
    && /\b(?:me|send|phone|number|link|details|info|information)\b/.test(text);
}

function buildDemoFollowupMessage({ name, messageText } = {}) {
  const greeting = clean(name, 80) ? `Hi ${clean(name, 80)}, ` : "";
  const requested = clean(messageText, 500);
  return `${greeting}${requested || "thanks for trying the My AI PA phone demo. Learn more or start a free trial at https://www.myaipa.ca/"}`.slice(0, 700);
}

module.exports = {
  buildDemoFollowupMessage,
  buildSignupConfirmationSummary,
  classifySignupAssistantPlaybook,
  formatCanadianPostalCodeForSpeech,
  formatEmailForSpeech,
  formatPhoneForSpeech,
  isExplicitDemoSmsRequest,
};
