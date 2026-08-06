const emergencyPatterns = [
  /\bfire\b/i,
  /\bsmoke\b/i,
  /\bsparks?\b/i,
  /\bburning (?:wire|wiring|outlet|panel|smell)\b/i,
  /\bgas (?:leak|smell|odou?r)\b/i,
  /\bcarbon[ -]?monoxide\b/i,
  /\bco alarm\b/i,
  /\bbreak[ -]?in (?:now|in progress)\b/i,
  /\bviolence\b/i,
  /\bmedical (?:danger|emergency)\b/i,
  /\bflood(?:ing)?\b.*\b(?:electric|electrical|outlet|panel|wire)\b/i,
  /\b(?:electric|electrical|outlet|panel|wire)\b.*\bflood(?:ing)?\b/i,
];

const sensitiveApplicationPatterns = [
  /\b(?:sin|social insurance number)\b/i,
  /\bdriver'?s? licen[cs]e(?: number)?\b/i,
  /\bbank(?:ing)? (?:account|information|details)\b/i,
  /\bcredit[ -]?card(?: number| details| information)?\b/i,
  /\bcredit report\b/i,
  /\bpassport(?: number)?\b/i,
];

export function classifyTenantConcern(value = "") {
  const text = String(value).trim();
  if (emergencyPatterns.some((pattern) => pattern.test(text))) {
    return {
      level: "emergency_redirect",
      label: "Immediate danger",
      instruction:
        "Leave the dangerous area and call 911 now from a safe location. Do not wait for a landlord callback. This demonstration cannot provide emergency dispatch.",
    };
  }

  if (/\b(no heat|no water|sewage|cannot lock|locked out|major leak|ceiling leak)\b/i.test(text)) {
    return {
      level: "priority_review",
      label: "Priority review",
      instruction: "Prepare the details for Dave and clearly identify the impact without promising a response time.",
    };
  }

  return {
    level: "standard_review",
    label: "Standard review",
    instruction: "Prepare a private callback request for Dave.",
  };
}

export function containsSensitiveApplicationData(value = "") {
  return sensitiveApplicationPatterns.some((pattern) => pattern.test(String(value)));
}

export function getMissingComplaintFields(form = {}) {
  const required = [
    ["name", "Tenant name"],
    ["address", "Property address and unit"],
    ["callback", "Callback number"],
    ["category", "Concern category"],
    ["description", "Description"],
    ["callbackTime", "Preferred callback time"],
  ];

  return required
    .filter(([key]) => !String(form[key] || "").trim())
    .map(([, label]) => label);
}

export function buildComplaintRequest(form = {}) {
  const missing = getMissingComplaintFields(form);
  const safety = classifyTenantConcern(form.description);

  if (missing.length) {
    return { ok: false, missing, safety };
  }

  if (containsSensitiveApplicationData(form.description)) {
    return {
      ok: false,
      missing: [],
      safety,
      privacyWarning:
        "Remove sensitive identification or financial information. The receptionist must not retain it in a complaint transcript or text message.",
    };
  }

  return {
    ok: true,
    safety,
    request: {
      recipient: "Dave",
      type: "Tenant complaint / callback request",
      tenant: String(form.name).trim(),
      address: String(form.address).trim(),
      callback: String(form.callback).trim(),
      category: String(form.category).trim(),
      occurred: String(form.occurred || "Not provided").trim(),
      ongoing: Boolean(form.ongoing),
      concern: String(form.description).trim(),
      requestedResolution: String(form.resolution || "Callback requested").trim(),
      callbackTime: String(form.callbackTime).trim(),
      textConsent: Boolean(form.textConsent),
      deliveryStatus: "Demo preview only — not sent",
    },
  };
}

export function getScenarioProgress(scenario, visibleLines) {
  if (!scenario?.transcript?.length || visibleLines <= 0) return 0;
  return Math.min(100, Math.round((visibleLines / scenario.transcript.length) * 100));
}
