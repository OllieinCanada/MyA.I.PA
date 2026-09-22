const { normalizeSmsPhone } = require("./smsSuppression");

const SETUP_VERSION = 3;
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
    key: "bell-mobile-no-answer-15-seconds-v1",
    carrier: "BELL",
    lineType: "MOBILE",
    forwardingType: "NO_ANSWER",
    activationMethod: "DIAL_STRING",
    buildActivation: (number) => `*61*${number}*11*15#`,
    deactivationDialString: "",
    humanInstructions: [
      "Tap the button from the Bell business phone.",
      "Press Call or Send. Bell should show a status message confirming the change.",
      "Return here and let My AI PA test the setup automatically.",
    ],
    source: "https://support.bell.ca/mobility/rate_plans_features/how_to_use_message_centre?step=8",
    verifiedAt: "2026-09-22",
    supported: true,
    timing: {
      mode: "FIFTEEN_SECONDS",
      exactThreeRingsSupported: false,
      customerCopy: "Bell will wait 15 seconds before forwarding an unanswered call. That is usually about three rings, but ringtone length varies by phone.",
      adjustmentCopy: "Bell accepts delays in five-second steps. My AI PA uses 15 seconds as the closest practical setting and verifies the result with a real test call.",
    },
    warnings: [
      "This replaces Bell's current no-answer destination, which is often voicemail. Bell may charge for forwarded minutes depending on the plan.",
      "If Bell rejects the command, use Call settings → Call Forwarding → unanswered calls or contact Bell to enable the feature.",
    ],
  },
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
    timing: {
      mode: "CARRIER_CONTROLLED",
      exactThreeRingsSupported: false,
      customerCopy: "Your phone rings first. Rogers does not publish a fixed ring count for this mobile command.",
      adjustmentCopy: "Rogers voicemail must be off for conditional forwarding to work. If the test fails, contact Rogers before relying on the setup.",
    },
    warnings: ["Rogers says conditional forwarding will not work while Rogers voicemail is active."],
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
    timing: {
      mode: "FIXED_FOUR_RINGS",
      exactThreeRingsSupported: false,
      customerCopy: "Rogers Home Phone forwards an unanswered call after four rings.",
      adjustmentCopy: "The *92 setup does not include a separate three-ring setting. Do not expect exactly three rings from this procedure.",
    },
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
    timing: {
      mode: "PRODUCT_SPECIFIC",
      exactThreeRingsSupported: false,
      customerCopy: "The number of rings is controlled separately and varies by Bell business-phone product.",
      adjustmentCopy: "Use the Bell business portal or the timing feature documented for your exact product. My AI PA will not guess a timing command.",
    },
    warnings: ["This is only for Bell business lines with Call Forward Don’t Answer Programmable. Bell Mobility and other Bell products require manual confirmation."],
  },
]);

const MANUAL_RULES = Object.freeze([
  {
    carrier: "TELUS",
    lineType: "MOBILE",
    source: "https://www.telus.com/en/business/small/mobility/add-ons",
    humanInstructions: [
      "Open the Phone or Call settings on the business phone only if they offer a separate unanswered or no-answer option.",
      "Do not turn on a generic Call Forwarding or Always Forward switch. That can send every call away from your phone.",
      "Enter the My AI PA number only under unanswered or no-answer calls. If that choice is missing, contact TELUS, then return here to test it.",
    ],
    timing: {
      mode: "DEVICE_OR_ACCOUNT_SETTING",
      exactThreeRingsSupported: false,
      customerCopy: "TELUS timing depends on the mobile plan and phone settings.",
      adjustmentCopy: "My AI PA will not generate an unverified TELUS service code. Use the phone settings or TELUS support, then run the test call.",
    },
    warnings: ["TELUS Call Forwarding may need to be added to the mobile plan before unanswered-call forwarding can work."],
  },
]);

function resolveForwardingRule({ carrier, lineType, forwardingMode = "NO_ANSWER", destination }) {
  const normalizedCarrier = normalizeCarrier(carrier);
  const normalizedLineType = normalizeLineType(lineType);
  const mode = String(forwardingMode || "NO_ANSWER").trim().toUpperCase();
  const destinationDigits = digits10(destination);
  const rule = RULES.find((item) => item.carrier === normalizedCarrier && item.lineType === normalizedLineType && item.forwardingType === mode);
  if (!rule) {
    const manualRule = MANUAL_RULES.find((item) => item.carrier === normalizedCarrier && item.lineType === normalizedLineType);
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
      humanInstructions: manualRule?.humanInstructions || [
        "Contact your phone provider or open your cloud-phone settings.",
        `Ask for unanswered/no-reply calls to forward to ${destinationDigits}.`,
        "Keep forwarding-all turned off, then return here to test.",
      ],
      source: manualRule?.source || "",
      verifiedAt: manualRule ? "2026-09-22" : "",
      supported: false,
      timing: manualRule?.timing || {
        mode: "PROVIDER_SPECIFIC",
        exactThreeRingsSupported: false,
        customerCopy: "The ring delay depends on this provider and phone product.",
        adjustmentCopy: "Ask the provider for unanswered-call forwarding. My AI PA will verify the result instead of guessing a command.",
      },
      warnings: [
        ...(manualRule?.warnings || []),
        "My AI PA does not have a verified one-tap command for this phone service. We will not guess one.",
      ],
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
