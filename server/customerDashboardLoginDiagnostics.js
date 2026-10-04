const crypto = require("crypto");

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function maskEmail(value) {
  const normalized = normalizeEmail(value);
  const separator = normalized.lastIndexOf("@");
  if (separator <= 0) return normalized ? `${normalized.slice(0, 1)}•••` : "not entered";
  return `${normalized.slice(0, 1)}•••${normalized.slice(separator)}`;
}

function maskPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length >= 4 ? `••• ••• ${digits.slice(-4)}` : "not entered";
}

function hashFingerprint(value, length = 12) {
  return crypto.createHash("sha256").update(String(value || "unknown")).digest("hex").slice(0, length);
}

function summarizeUserAgent(value) {
  const userAgent = String(value || "");
  const browser = /Edg\//i.test(userAgent)
    ? "Edge"
    : /OPR\//i.test(userAgent)
      ? "Opera"
      : /CriOS|Chrome\//i.test(userAgent)
        ? "Chrome"
        : /FxiOS|Firefox\//i.test(userAgent)
          ? "Firefox"
          : /Safari\//i.test(userAgent)
            ? "Safari"
            : "Other browser";
  const device = /iPad|Tablet/i.test(userAgent)
    ? "Tablet"
    : /Mobi|Android|iPhone/i.test(userAgent)
      ? "Phone"
      : "Computer";
  return { browser, device };
}

function getLoginAttemptSource(req = {}) {
  // Express resolves req.ip through the configured trusted-proxy boundary.
  // Reading X-Forwarded-For directly would let an untrusted caller forge the fingerprint.
  const rawIp = String(req.ip || req.socket?.remoteAddress || "unknown").trim() || "unknown";
  const userAgent = String(req.headers?.["user-agent"] || "");
  return {
    sourceFingerprint: hashFingerprint(`${rawIp}|${userAgent}`),
    ...summarizeUserAgent(userAgent),
  };
}

function classifyLoginIdentity({
  email,
  phone,
  records = [],
  isValidEmail,
  normalizePhone,
  emailsForRecord,
  phonesMatch,
  sortRecords,
} = {}) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedPhone = typeof normalizePhone === "function" ? normalizePhone(phone) : String(phone || "").trim();
  const validEmail = typeof isValidEmail === "function" ? isValidEmail(normalizedEmail) : normalizedEmail.includes("@");
  const validPhone = /^\+\d{8,15}$/.test(normalizedPhone);
  const safeRecords = typeof sortRecords === "function" ? sortRecords(records) : [...records];
  const emailMatches = safeRecords.filter((record) => (
    typeof emailsForRecord === "function" && emailsForRecord(record).includes(normalizedEmail)
  ));
  const phoneMatches = safeRecords.filter((record) => (
    [record?.ownerPhone, record?.businessPhone]
      .filter(Boolean)
      .some((candidate) => typeof phonesMatch === "function" && phonesMatch(candidate, normalizedPhone))
  ));
  const exactMatch = emailMatches.find((record) => phoneMatches.includes(record)) || null;

  const base = {
    enteredEmail: maskEmail(email),
    enteredPhone: maskPhone(phone),
    expectedEmail: "not available",
    expectedPhone: "not available",
    businessName: "",
    candidateCount: 0,
    exactMatch,
  };
  if (!normalizedEmail || !validEmail || !validPhone) {
    return { ...base, reason: "invalid_input", reasonCode: "CUSTOMER_DASHBOARD_LOGIN_INVALID_INPUT" };
  }
  if (exactMatch) {
    return {
      ...base,
      reason: "matched",
      reasonCode: "CUSTOMER_DASHBOARD_LOGIN_MATCHED",
      businessName: String(exactMatch.businessName || "").trim(),
      candidateCount: 1,
    };
  }
  if (emailMatches.length && phoneMatches.length) {
    return {
      ...base,
      reason: "identity_pair_mismatch",
      reasonCode: "CUSTOMER_DASHBOARD_IDENTITY_PAIR_MISMATCH",
      candidateCount: emailMatches.length + phoneMatches.length,
    };
  }
  if (emailMatches.length) {
    const record = emailMatches[0];
    return {
      ...base,
      reason: "phone_mismatch",
      reasonCode: "CUSTOMER_DASHBOARD_PHONE_MISMATCH",
      expectedPhone: emailMatches.length === 1 ? maskPhone(record.ownerPhone || record.businessPhone) : "not available",
      businessName: emailMatches.length === 1 ? String(record.businessName || "").trim() : "",
      candidateCount: emailMatches.length,
    };
  }
  if (phoneMatches.length) {
    const record = phoneMatches[0];
    const expectedEmail = typeof emailsForRecord === "function" ? emailsForRecord(record)[0] : "";
    return {
      ...base,
      reason: "email_mismatch",
      reasonCode: "CUSTOMER_DASHBOARD_EMAIL_MISMATCH",
      expectedEmail: phoneMatches.length === 1 ? maskEmail(expectedEmail) : "not available",
      businessName: phoneMatches.length === 1 ? String(record.businessName || "").trim() : "",
      candidateCount: phoneMatches.length,
    };
  }
  return { ...base, reason: "identity_not_found", reasonCode: "CUSTOMER_DASHBOARD_IDENTITY_NOT_FOUND" };
}

function buildFailureContext({ req, diagnosis, kind, providerError } = {}) {
  const source = getLoginAttemptSource(req);
  const failureKind = String(kind || diagnosis?.reason || "identity_not_found");
  const definitions = {
    invalid_input: {
      reasonCode: "CUSTOMER_DASHBOARD_LOGIN_INVALID_INPUT",
      reason: "The sign-in form was missing a valid email address or phone number.",
      nextAction: "Ask the customer to enter the email and phone number used during signup, then try once more.",
    },
    email_mismatch: {
      reasonCode: "CUSTOMER_DASHBOARD_EMAIL_MISMATCH",
      reason: "The submitted phone matched a signup, but the submitted email did not match that account.",
      nextAction: "Open the matching customer record or records, confirm the signup email, then ask the customer to retry with that email and the same phone.",
    },
    phone_mismatch: {
      reasonCode: "CUSTOMER_DASHBOARD_PHONE_MISMATCH",
      reason: "The submitted email matched a signup, but the submitted phone did not match that account.",
      nextAction: "Open the matching customer record or records, confirm the registered phone, then ask the customer to retry with that phone.",
    },
    identity_pair_mismatch: {
      reasonCode: "CUSTOMER_DASHBOARD_IDENTITY_PAIR_MISMATCH",
      reason: "The submitted email and phone each exist, but they belong to different signup records.",
      nextAction: "Open the matching customer records and confirm which email and phone belong together before asking the customer to retry.",
    },
    identity_not_found: {
      reasonCode: "CUSTOMER_DASHBOARD_IDENTITY_NOT_FOUND",
      reason: "Neither submitted detail could be matched safely to one customer signup.",
      nextAction: "Confirm the customer's signup email and registered phone in My AI PA before asking them to retry.",
    },
    rate_limited: {
      reasonCode: "CUSTOMER_DASHBOARD_LOGIN_RATE_LIMITED",
      reason: "Too many sign-in-code requests were made from this source or for this login combination.",
      nextAction: "Wait for the retry time shown to the customer. If the attempts were not expected, review the source fingerprint before unlocking anything.",
    },
    sms_failed: {
      reasonCode: "CUSTOMER_DASHBOARD_SMS_FAILED",
      reason: "The login details matched, but Twilio did not accept the sign-in-code message.",
      nextAction: "Check Twilio billing and account status first, then review the provider code in this incident before retrying once.",
    },
  };
  const definition = definitions[failureKind] || definitions.identity_not_found;
  const status = failureKind === "rate_limited" ? 429 : failureKind === "sms_failed" ? 502 : 404;
  return {
    area: "customer dashboard sign-in",
    severity: failureKind === "sms_failed" ? "critical" : "warning",
    reasonCode: definition.reasonCode,
    reason: definition.reason,
    whatFailed: failureKind === "sms_failed"
      ? "A customer requested a dashboard code, but the text could not be sent"
      : "A customer dashboard sign-in attempt did not match the saved account details",
    impact: "The customer did not receive a new sign-in code and could not open the dashboard from this attempt.",
    snapshot: {
      "Result": failureKind.replace(/_/g, " "),
      "Entered email": diagnosis?.enteredEmail || "not entered",
      "Entered phone": diagnosis?.enteredPhone || "not entered",
      ...(diagnosis?.expectedEmail && diagnosis.expectedEmail !== "not available" ? { "Saved email": diagnosis.expectedEmail } : {}),
      ...(diagnosis?.expectedPhone && diagnosis.expectedPhone !== "not available" ? { "Saved phone": diagnosis.expectedPhone } : {}),
      ...(Number(diagnosis?.candidateCount || 0) > 1 ? { "Possible matching records": diagnosis.candidateCount } : {}),
      "Source fingerprint": source.sourceFingerprint,
      "Device": source.device,
      "Browser": source.browser,
    },
    businessName: diagnosis?.businessName || "",
    method: "POST",
    route: "/api/customer/dashboard/request-code",
    status,
    upstreamStatus: providerError?.providerStatus,
    lastCheckpoint: failureKind === "sms_failed"
      ? "My AI PA matched the customer account and created a one-time code before Twilio rejected the send request."
      : "My AI PA received the request and stopped before creating or sending a one-time code.",
    nextAction: definition.nextAction,
    dedupeFingerprint: `${definition.reasonCode}:${source.sourceFingerprint}:${hashFingerprint(diagnosis?.businessName || "unknown-account", 8)}`,
  };
}

module.exports = {
  buildFailureContext,
  classifyLoginIdentity,
  getLoginAttemptSource,
  hashFingerprint,
  maskEmail,
  maskPhone,
  summarizeUserAgent,
};
