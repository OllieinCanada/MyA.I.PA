const { normalizeSmsPhone } = require("./smsSuppression");

const SETUP_VERSION = 4;
const CARRIERS = new Set(["BELL", "ROGERS", "TELUS", "OTHER", "NOT_SURE"]);
const LINE_TYPES = new Set(["MOBILE", "LANDLINE", "VOIP", "NOT_SURE"]);
const mobileNoReplyCommand = number => `*61*${number}#`;

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
      "Wait for Bell's confirmation. My AI PA will not call you automatically.",
    ],
    source: "https://support.bell.ca/mobility/rate_plans_features/how_to_use_message_centre?step=8",
    verifiedAt: "2026-09-22",
    supported: true,
    timing: {
      mode: "FIFTEEN_SECONDS",
      exactThreeRingsSupported: false,
      customerCopy: "Bell will wait 15 seconds before forwarding an unanswered call. That is usually about three rings, but ringtone length varies by phone.",
      adjustmentCopy: "Bell accepts delays in five-second steps. This command requests 15 seconds; wait for Bell to confirm the change.",
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
    buildActivation: mobileNoReplyCommand,
    deactivationDialString: "##61#",
    humanInstructions: ["Open the command from the business phone, or copy it into the keypad.", "Press Call or Send.", "Wait for Rogers to confirm the change. My AI PA will not call you automatically."],
    source: "https://www.rogers.com/support/mobility/use-call-forwarding",
    verifiedAt: "2026-09-06",
    supported: true,
    timing: {
      mode: "CARRIER_CONTROLLED",
      exactThreeRingsSupported: false,
      customerCopy: "Your phone rings first. Rogers does not publish a fixed ring count for this mobile command.",
      adjustmentCopy: "Rogers voicemail must be off for conditional forwarding to work. If Rogers rejects the command, contact Rogers before relying on the setup.",
    },
    warnings: ["Rogers says conditional forwarding will not work while Rogers voicemail is active."],
  },
  {
    key: "telus-mobile-no-answer-v1",
    carrier: "TELUS",
    lineType: "MOBILE",
    forwardingType: "NO_ANSWER",
    activationMethod: "DIAL_STRING",
    buildActivation: mobileNoReplyCommand,
    deactivationDialString: "#61#",
    humanInstructions: ["Open the phone app on your business cellphone.", "Press Call or Send, then wait for confirmation.", "My AI PA will not call you automatically."],
    source: "https://www.telus.com/en/business/support/article/call-forward-mobile",
    verifiedAt: "2026-10-16",
    supported: true,
    timing: { mode: "DEVICE_OR_ACCOUNT_SETTING", exactThreeRingsSupported: false,
      customerCopy: "Your phone rings first. The delay depends on your phone and account settings.",
      adjustmentCopy: "Wait for carrier confirmation. TELUS says conditional forwarding depends on device compatibility." },
    warnings: ["TELUS may charge for forwarded minutes or long distance. Check your plan; some devices do not support conditional forwarding."],
  },
  {
    key: "rogers-home-no-answer-v1",
    carrier: "ROGERS",
    lineType: "LANDLINE",
    forwardingType: "NO_ANSWER",
    activationMethod: "GUIDED_DIAL",
    activationDialString: "*92",
    deactivationDialString: "*93",
    humanInstructions: ["Dial *92 from the business phone.", "After the tone, enter the My AI PA number shown below.", "Stay on the line for at least five seconds and wait for carrier confirmation."],
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
    humanInstructions: ["Dial *92 from the Bell business phone.", "Enter the My AI PA number shown below and wait for two beeps.", "Confirm the change with Bell before relying on it."],
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

function resolveForwardingRule({ carrier, lineType, forwardingMode = "NO_ANSWER", destination }) {
  const normalizedCarrier = normalizeCarrier(carrier);
  const choice = normalizeLineType(lineType);
  const normalizedLineType = choice === 'NOT_SURE' ? 'MOBILE' : choice;
  const mode = String(forwardingMode || "NO_ANSWER").trim().toUpperCase();
  const destinationDigits = digits10(destination);
  const rule = RULES.find((item) => item.carrier === normalizedCarrier && item.lineType === normalizedLineType && item.forwardingType === mode);
  if (!rule && normalizedLineType === 'MOBILE' && mode === 'NO_ANSWER') {
    const activationDialString = mobileNoReplyCommand(destinationDigits);
    return {
      key: 'standard-mobile-no-answer-v4', carrier: normalizedCarrier, lineType: 'MOBILE', forwardingType: mode,
      activationMethod: 'DIAL_STRING', activationDialString, activationTelUri: encodeDialStringToTelUri(activationDialString),
      deactivationDialString: '', deactivationTelUri: '', destinationDigits, supported: true, carrierSpecific: false,
      humanInstructions: ['Open the Phone app using the button below.', 'Press Call or Send and wait for your phone company to confirm the change.'],
      source: 'https://www.rogers.com/support/mobility/use-call-forwarding', verifiedAt: '2026-10-20',
      timing: { mode: 'CARRIER_CONTROLLED', exactThreeRingsSupported: false,
        customerCopy: 'Your mobile rings first. Calls you do not answer go to your My AI PA number once your carrier confirms forwarding.',
        adjustmentCopy: 'This is a common mobile no-answer code. If your carrier rejects it, use the help below.' },
      warnings: ['Your carrier must accept the code. Forwarded-call charges may apply.'],
    };
  }
  if (!rule) {
    const manualRule = normalizedLineType === 'MOBILE' && mode === 'NO_ANSWER' ? {
      humanInstructions: [
        "On your business cellphone, open Phone or Call settings.",
        "Look for Forward when unanswered or No reply. Leave Always forward turned off.",
        `If that separate option is available, enter ${destinationDigits} and save.`,
        "If the option is missing, choose your provider below for different instructions. Do not enable forwarding for every call.",
        "Wait for your phone or provider to confirm the change. My AI PA will not call you automatically.",
      ],
      warnings: ["This can replace your missed-call voicemail destination. Your phone provider may charge for forwarded calls."],
    } : null;
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
        "Keep forwarding-all turned off and wait for provider confirmation.",
      ],
      source: manualRule?.source || "",
      verifiedAt: "",
      supported: false,
      timing: manualRule?.timing || {
        mode: "PROVIDER_SPECIFIC",
        exactThreeRingsSupported: false,
        customerCopy: "The ring delay depends on this provider and phone product.",
        adjustmentCopy: "Ask the provider for unanswered-call forwarding and confirmation of the change. No carrier command is guessed.",
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
