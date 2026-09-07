const { normalizeSmsPhone } = require("./smsSuppression");

const SETUP_VERSION = 1;
const CARRIERS = new Set(["BELL", "ROGERS", "TELUS", "OTHER", "NOT_SURE"]);
const LINE_TYPES = new Set(["MOBILE", "LANDLINE", "VOIP", "NOT_SURE"]);

function canonicalChoice(value, allowed, fallback) {
  const key = String(value || "").trim().toUpperCase().replace(/[\s/-]+/g, "_");
  return allowed.has(key) ? key : fallback;
}

function normalizeCarrier(value) {
  return canonicalChoice(value, CARRIERS, "NOT_SURE");
}

function normalizeLineType(value) {
  const normalized = String(value || "").trim().toUpperCase().replace(/[\s/-]+/g, "_");
  if (["CELL", "CELL_PHONE", "WIRELESS"].includes(normalized)) return "MOBILE";
  if (["BUSINESS", "HOME", "BUSINESS_PHONE", "HOME_PHONE"].includes(normalized)) return "LANDLINE";
  if (["CLOUD", "CLOUD_PHONE", "VOIP_CLOUD_PHONE"].includes(normalized)) return "VOIP";
  return canonicalChoice(normalized, LINE_TYPES, "NOT_SURE");
}

function digits10(value) {
  const e164 = normalizeSmsPhone(value, "assignedMyAiPaNumber");
  const digits = e164.replace(/\D/g, "");
  if (digits.length !== 11 || !digits.startsWith("1")) {
    const error = new Error("The forwarding destination must be a Canadian or US ten-digit number.");
    error.statusCode = 400;
    error.code = "FORWARDING_DESTINATION_INVALID";
    throw error;
  }
  return digits.slice(1);
}

function encodeDialStringToTelUri(command) {
  return `tel:${String(command || "").replace(/#/g, "%23")}`;
}

const RULES = Object.freeze([
  {
    key: "rogers-mobile-no-answer-v1",
    carrier: "ROGERS",
    lineType: "MOBILE",
    forwardingType: "NO_ANSWER",
    activationMethod: "DIAL_STRING",
    buildActivation: (number) => `*61*${number}#`,
    deactivationDialString: "##61#",
    humanInstructions: ["Tap the button from the business phone.", "Press Call or Send.", "Return here and test the setup."],
    source: "https://www.rogers.com/support/mobility/use-call-forwarding",
    verifiedAt: "2026-09-06",
    supported: true,
    warnings: ["Rogers voicemail can answer before no-reply forwarding. If testing fails, ask Rogers to adjust voicemail/no-reply timing."],
  },
  {
    key: "rogers-home-no-answer-v1",
    carrier: "ROGERS",
    lineType: "LANDLINE",
    forwardingType: "NO_ANSWER",
    activationMethod: "GUIDED_DIAL",
    activationDialString: "*92",
    deactivationDialString: "*93",
    humanInstructions: ["Dial *92 from the business phone.", "After the tone, enter the My AI PA number shown below.", "Stay on the line for at least five seconds, then return here to test."],
    source: "https://www.rogers.com/support/home-phone/forward-calls-when-no-answer",
    verifiedAt: "2026-09-06",
    supported: true,
    warnings: ["This applies to Rogers Home Phone and normally forwards after four rings. Voicemail or account features can change the result."],
  },
  {
    key: "bell-business-no-answer-v1",
    carrier: "BELL",
    lineType: "LANDLINE",
    forwardingType: "NO_ANSWER",
    activationMethod: "GUIDED_DIAL",
    activationDialString: "*92",
    deactivationDialString: "*93",
    humanInstructions: ["Dial *92 from the Bell business phone.", "Enter the My AI PA number shown below and wait for two beeps.", "Return here and test before relying on it."],
    source: "https://business.bell.ca/support/small-business/phone/calling-features/how-to-use-call-forwarding",
    verifiedAt: "2026-09-06",
    supported: true,
    warnings: ["This is only for Bell business lines with Call Forward Don’t Answer Programmable. Bell Mobility and other Bell products require manual confirmation."],
  },
]);

function resolveForwardingRule({ carrier, lineType, forwardingMode = "NO_ANSWER", destination }) {
  const normalizedCarrier = normalizeCarrier(carrier);
  const normalizedLineType = normalizeLineType(lineType);
  const mode = String(forwardingMode || "NO_ANSWER").trim().toUpperCase();
  const destinationDigits = digits10(destination);
  const rule = RULES.find((item) => item.carrier === normalizedCarrier && item.lineType === normalizedLineType && item.forwardingType === mode);
  if (!rule) {
    return {
      key: `manual-${normalizedCarrier.toLowerCase()}-${normalizedLineType.toLowerCase()}-v${SETUP_VERSION}`,
      carrier: normalizedCarrier,
      lineType: normalizedLineType,
      forwardingType: mode,
      activationMethod: "MANUAL",
      activationDialString: "",
      activationTelUri: "",
      deactivationDialString: "",
      deactivationTelUri: "",
      destinationDigits,
      humanInstructions: [
        "Contact your phone provider or open your cloud-phone settings.",
        `Ask for unanswered/no-reply calls to forward to ${destinationDigits}.`,
        "Keep forwarding-all turned off, then return here to test.",
      ],
      source: "",
      verifiedAt: "",
      supported: false,
      warnings: ["My AI PA does not have a verified one-tap command for this phone service. We will not guess one."],
    };
  }
  const activationDialString = rule.buildActivation ? rule.buildActivation(destinationDigits) : rule.activationDialString;
  return {
    ...rule,
    destinationDigits,
    activationDialString,
    activationTelUri: encodeDialStringToTelUri(activationDialString),
    deactivationTelUri: encodeDialStringToTelUri(rule.deactivationDialString),
    warnings: [
      ...(rule.warnings || []),
      "If this line already forwards missed calls somewhere else, this carrier command may replace that destination. Press Call only when you want My AI PA to become the missed-call destination.",
    ],
  };
}

module.exports = {
  CARRIERS,
  LINE_TYPES,
  RULES,
  SETUP_VERSION,
  digits10,
  encodeDialStringToTelUri,
  normalizeCarrier,
  normalizeLineType,
  resolveForwardingRule,
};
