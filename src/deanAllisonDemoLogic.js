const emergencyPatterns = [
  /\bimmediate danger\b/i,
  /\bthreaten(?:ed|ing)?\b/i,
  /\bviolence\b/i,
  /\bweapon\b/i,
  /\bmedical emergency\b/i,
  /\bfire\b/i,
  /\bsuicid(?:e|al)\b/i,
];

const sensitivePatterns = [
  /\b(?:sin|social insurance number)\b/i,
  /\bpassport(?: number)?\b/i,
  /\b(?:uci|unique client identifier)\b/i,
  /\bimmigration (?:file|application|client) number\b/i,
  /\btax (?:identifier|number|account)\b/i,
  /\bbank(?:ing)? (?:account|information|details)\b/i,
  /\bcredit[ -]?card\b/i,
  /\bpassword\b/i,
];

export function classifyConstituentConcern(value = "") {
  const text = String(value).trim();
  if (emergencyPatterns.some((pattern) => pattern.test(text))) {
    return {
      level: "emergency_redirect",
      label: "Immediate danger",
      instruction: "Move to a safe location and call 911 now. Do not wait for a constituency-office callback. This demonstration cannot provide emergency dispatch.",
    };
  }
  return {
    level: "standard_review",
    label: "Office review requested",
    instruction: "Prepare a minimal, neutral constituent summary without promising a response or outcome.",
  };
}

export function containsSensitiveConstituentData(value = "") {
  return sensitivePatterns.some((pattern) => pattern.test(String(value)));
}

export function getMissingConstituentFields(form = {}) {
  const required = [
    ["name", "Caller name"],
    ["city", "City or community"],
    ["callback", "Callback number"],
    ["category", "Concern category"],
    ["description", "Concern description"],
    ["requestedAction", "Requested next step"],
  ];
  return required.filter(([key]) => !String(form[key] || "").trim()).map(([, label]) => label);
}

export function buildConstituentComplaint(form = {}) {
  const safety = classifyConstituentConcern(form.description);
  if (safety.level === "emergency_redirect") return { ok: false, safety, missing: [] };

  const combined = [form.description, form.requestedAction, form.department].join(" ");
  if (containsSensitiveConstituentData(combined)) {
    return {
      ok: false,
      safety,
      missing: [],
      privacyWarning: "Remove government identifiers, financial details, passwords, or identity-document numbers. This demonstration must not retain or transmit them.",
    };
  }

  const missing = getMissingConstituentFields(form);
  if (missing.length) return { ok: false, safety, missing };

  return {
    ok: true,
    safety,
    request: {
      type: "Constituent complaint / callback request",
      caller: String(form.name).trim(),
      community: String(form.city).trim(),
      callback: String(form.callback).trim(),
      category: String(form.category).trim(),
      department: String(form.department || "Not provided").trim(),
      concern: String(form.description).trim(),
      requestedAction: String(form.requestedAction).trim(),
      callbackTime: String(form.callbackTime || "Not provided").trim(),
      textConsent: Boolean(form.textConsent),
      officialOfficeAuthorized: false,
      deliveryStatus: "Private demo preview only — not sent to Dean Allison or his office",
    },
  };
}

export function getDeanDemoProgress(scenario, visibleLines) {
  if (!scenario?.transcript?.length || visibleLines <= 0) return 0;
  return Math.min(100, Math.round((visibleLines / scenario.transcript.length) * 100));
}
