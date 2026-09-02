const MAX_TELEGRAM_TEXT_LENGTH = 3_900;

const INCIDENT_REASON_CATALOG = Object.freeze({
  SIGNUP_VALIDATION_FAILED: "The signup did not pass the required validation checks.",
  SIGNUP_DUPLICATE: "A matching signup already exists, so automatic setup was stopped to prevent duplicate resources or charges.",
  SIGNUP_VERIFICATION_REQUIRED: "The signup is waiting for the required customer verification.",
  SIGNUP_VERIFICATION_EXPIRED: "The signup verification expired before setup could continue.",
  SIGNUP_REVIEW_REQUIRED: "The signup was held for manual review before any live resources were created.",
  SIGNUP_PROVISIONING_FAILED: "The signup reached provisioning, but setup did not complete.",
  SIGNUP_PROVISIONING_PENDING: "Provisioning has not returned a verified phone number and assistant yet.",
  SIGNUP_COMPLETION_DELIVERY_FAILED: "The assigned number is ready, but the setup-complete message could not be delivered to the customer.",
  SIGNUP_COMPLETION_NO_DELIVERY_CHANNEL: "The assigned number is ready, but no customer SMS or email delivery channel was available.",
  CUSTOMER_DASHBOARD_LOGIN_INVALID_INPUT: "The dashboard sign-in request was missing a valid signup email or registered phone number.",
  CUSTOMER_DASHBOARD_EMAIL_MISMATCH: "The entered phone matched a customer signup, but the entered email did not match that account.",
  CUSTOMER_DASHBOARD_PHONE_MISMATCH: "The entered email matched a customer signup, but the entered phone did not match that account.",
  CUSTOMER_DASHBOARD_IDENTITY_PAIR_MISMATCH: "The entered email and phone belong to different customer signup records.",
  CUSTOMER_DASHBOARD_IDENTITY_NOT_FOUND: "The entered email and phone could not be matched safely to a customer signup.",
  CUSTOMER_DASHBOARD_LOGIN_RATE_LIMITED: "Too many dashboard sign-in-code requests were made from the same source or for the same login combination.",
  CUSTOMER_DASHBOARD_SMS_FAILED: "The customer account matched, but the dashboard sign-in-code text could not be sent.",
  SMTP_NOT_CONFIGURED: "The assigned number is ready, but setup-complete email delivery is not configured.",
  SMTP_AUTH_FAILED: "The assigned number is ready, but the email provider rejected My AI PA's configured credential.",
  SMTP_RECIPIENT_REJECTED: "The assigned number is ready, but the email provider rejected the customer's email destination.",
  SMTP_TIMEOUT: "The assigned number is ready, but the email provider did not respond before the delivery timeout.",
  SMTP_CONNECTION_FAILED: "The assigned number is ready, but My AI PA could not connect to the email provider.",
  MANUAL_APPROVAL_ENABLED: "Automatic provisioning is paused, so this signup requires an approved manual review.",
  MAKE_SIGNUP_INVALID_URL: "The configured signup automation URL is missing or invalid.",
  MAKE_SIGNUP_TIMEOUT: "The signup automation did not answer before the request timed out.",
  MAKE_SIGNUP_UNREACHABLE: "The signup automation could not be reached.",
  MAKE_SIGNUP_REJECTED: "The signup automation explicitly rejected the provisioning request.",
  MAKE_SIGNUP_RESPONSE_EMPTY: "The signup automation returned an empty response, so no setup success could be verified.",
  MAKE_SIGNUP_RESPONSE_INCOMPLETE: "The signup automation responded without all verified phone and assistant identifiers.",
  PHONE_NUMBER_PENDING: "A callable Canadian forwarding number has not been verified yet.",
  CANADIAN_PHONE_REQUIRED: "The assigned number failed the Canadian-number safety check.",
  PHONE_VALIDATION_UNAVAILABLE: "The assigned number could not be validated with the configured phone providers.",
  PHONE_NOT_OWNED: "The assigned number was not confirmed in the My AI PA Twilio account.",
  VOICE_ROUTING_MISSING: "The assigned number was not confirmed with the required voice routing.",
  VAPI_BUSINESS_ROUTE_REQUIRED: "The call result did not include a trusted business or mapped call route, so My AI PA stopped before creating a lead.",
  VAPI_BUSINESS_ROUTE_INVALID: "The call result included an invalid business route, so My AI PA rejected it.",
  VAPI_BUSINESS_ROUTE_NOT_FOUND: "The routed business does not exist, so My AI PA stopped before creating a lead.",
  VAPI_BUSINESS_ROUTE_CONFLICT: "The supplied business and call ownership resolved to different customers, so My AI PA blocked the cross-business handoff.",
  VAPI_BUSINESS_ROUTE_UNAVAILABLE: "The business-routing validation service was unavailable, so My AI PA stopped before creating a lead.",
  VAPI_CALL_ROUTE_NOT_FOUND: "The supplied call could not be matched to a stored or mapped business, so My AI PA stopped before creating a lead.",
  PROVISIONING_NOT_READY: "Provisioning did not produce a verified phone and assistant before the safety timeout.",
  PAYMENT_FAILED: "The payment attempt was marked as failed.",
  SMS_ROUTING_FAILED: "The signup's SMS routing could not be verified.",
  OWNER_TEXT_DELIVERY_FAILED: "The owner lead-summary text ended in a failed delivery state.",
  OWNER_TEXT_RETRY_DUE: "The owner lead-summary text did not complete and is eligible for a guarded retry.",
  CALL_TEXT_RESULT_INCOMPLETE: "One or more expected call follow-up texts did not return a successful result.",
  CALL_TOOL_EXECUTION_FAILED: "A call-side action stopped before it completed.",
  CALL_TOOL_EXECUTION_STUCK: "A call-side action remained in progress beyond the safety window.",
  DATABASE_UNAVAILABLE: "The application could not reach its production database.",
  DATABASE_QUERY_IMPLEMENTATION_FAILED: "A database query could not be processed safely by the application, so the protected operation stopped.",
  PROVIDER_ACCOUNT_FUNDING_REQUIRED: "The affected provider explicitly reported that the My AI PA platform account needs funds or credits.",
  TWILIO_ACCOUNT_ACCESS_REJECTED: "Twilio denied account access. Check Twilio Billing and Account status first because a suspended or unpaid account can look like a credential failure.",
  CUSTOMER_PAYMENT_FAILED: "The customer's Stripe payment failed. This is not a Twilio or Vapi account-funding issue.",
  PROVIDER_AUTHENTICATION_FAILED: "The affected provider rejected My AI PA's configured credential.",
  PROVIDER_INVENTORY_UNAVAILABLE: "The affected provider could not supply a valid resource from the required inventory.",
  LOCAL_CANADIAN_NUMBER_INVENTORY_UNAVAILABLE: "Twilio could not supply a voice and SMS-capable Canadian number in the business's required local area code.",
  PROVISIONED_NUMBER_AREA_CODE_MISMATCH: "The existing provisioned number does not match the business's required local area code, so My AI PA stopped before creating another paid number.",
  PROVIDER_CONNECTION_FAILED: "My AI PA could not establish or keep a network connection to the affected provider.",
  DUPLICATE_OR_STATE_CONFLICT: "My AI PA stopped because durable state indicates a duplicate, concurrent operation, or conflicting provisioning context.",
  PROVIDER_PERMISSION_OR_COMPLIANCE_BLOCK: "The affected provider blocked the operation because of a permission, consent, or compliance rule.",
  PROVIDER_CONFIGURATION_INVALID: "The affected provider rejected a missing, invalid, or unsupported configuration value.",
  MESSAGE_DELIVERY_FAILED: "The provider accepted the message attempt but could not deliver it to the destination.",
  UNKNOWN_OPERATIONAL_FAILURE: "The available safe diagnostics do not establish a specific cause.",
  SERVICE_TIMEOUT: "The monitored service did not answer before the health check timed out.",
  SERVICE_UNREACHABLE: "The monitored service could not be reached.",
  INVALID_HEALTH_RESPONSE: "The monitored health endpoint responded without confirming that the service was healthy.",
  TWILIO_AUTH_FAILED: "Twilio rejected the configured credentials.",
  TWILIO_AUTHENTICATION_FAILED: "Twilio rejected the configured credentials.",
  "20003": "Twilio denied account access. Check Billing and Account status first; this response can also result from invalid credentials.",
  TWILIO_RESOURCE_NOT_FOUND: "Twilio could not find the requested resource.",
  "20404": "Twilio could not find the requested resource.",
  TWILIO_INVALID_PHONE_NUMBER: "Twilio rejected an invalid telephone number.",
  "21211": "Twilio rejected an invalid destination telephone number.",
  TWILIO_NUMBER_UNAVAILABLE: "Twilio could not find an available number matching the requested area.",
  "21452": "Twilio could not find an available number matching the requested area.",
  TWILIO_SMS_OPTED_OUT: "Twilio blocked the message because the recipient previously opted out.",
  "21610": "Twilio blocked the message because the recipient previously opted out.",
  TWILIO_MESSAGE_UNDELIVERED: "Twilio could not deliver the message to the destination handset.",
  "30003": "Twilio could not reach the destination handset.",
  "30005": "Twilio reported an unknown destination handset.",
  "30006": "Twilio reported a landline or unreachable destination.",
  "30007": "Twilio or the carrier filtered the message.",
  "30008": "Twilio could not confirm a more specific delivery failure.",
  PROVIDER_AUTH_FAILED: "The provider rejected the configured credentials.",
  PROVIDER_RATE_LIMITED: "The provider temporarily rejected the request because its request limit was reached.",
  PROVIDER_REJECTED: "The provider rejected the request.",
  PROVIDER_UNAVAILABLE: "The provider was unavailable when My AI PA attempted the operation.",
  PROVIDER_TIMEOUT: "The provider did not answer before the request timed out.",
  HTTP_TIMEOUT: "The remote service did not answer before the HTTP request timed out.",
  FETCH_TIMEOUT: "The remote service did not answer before the request timed out.",
  REQUEST_TIMEOUT: "The remote service did not answer before the request timed out.",
  ETIMEDOUT: "The network request timed out before a response was received.",
  ABORT_ERR: "The request was stopped after exceeding its allowed response time.",
  ABORTERROR: "The request was stopped after exceeding its allowed response time.",
  FATAL_PROCESS_ERROR: "The My AI PA API process stopped unexpectedly and was restarted by the hosting platform.",
  TELEGRAM_OUTBOX_DELIVERY_RETRYING: "Telegram did not accept a saved incident alert, so My AI PA kept it on disk for automatic retry.",
  TELEGRAM_OUTBOX_MESSAGE_REJECTED: "Telegram rejected a saved incident alert because the message format was not accepted.",
  TELEGRAM_OUTBOX_DRAIN_FAILED: "My AI PA could not process its saved Telegram incident queue.",
  TELEGRAM_OUTBOX_CAPACITY_EXCEEDED: "The saved Telegram incident queue reached its safety limit. Existing alerts were preserved instead of being silently deleted.",
});

function normalizeReasonCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 100);
}

function capText(value, maxLength, suffix = "…") {
  const text = String(value || "");
  const limit = Math.max(1, Number(maxLength) || 1);
  if (text.length <= limit) return text;
  if (limit <= suffix.length) return text.slice(0, limit);
  return `${text.slice(0, limit - suffix.length).trimEnd()}${suffix}`;
}

function stripUrlQueries(value) {
  let text = String(value || "");
  text = text.replace(/https?:\/\/[^\s<>"']+/gi, (rawUrl) => {
    const punctuation = rawUrl.match(/[),.;!?]+$/)?.[0] || "";
    const candidate = punctuation ? rawUrl.slice(0, -punctuation.length) : rawUrl;
    try {
      const url = new URL(candidate);
      url.username = "";
      url.password = "";
      url.search = "";
      url.hash = "";
      return `${url.toString()}${punctuation}`;
    } catch (_error) {
      return rawUrl.replace(/\?.*$/, "?[query removed]");
    }
  });
  return text
    .replace(/(^|\s)(\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]+)\?[^\s]+/g, "$1$2?[query removed]")
    .replace(/\?[A-Za-z0-9_.%-]+=[^\s]+/g, "?[query removed]");
}

function redactIncidentText(value, options = {}) {
  // Credentials must be removed before broader patterns (such as a street
  // address) can consume the credential label and leave its value exposed.
  value = String(value == null ? "" : value)
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, "[identifier removed]")
    .replace(/\b[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z][ -]?\d[ABCEGHJ-NPRSTV-Z]\d\b/gi, "[postal code removed]")
    .replace(/"([a-z0-9_.-]*(?:token|secret|password|cookie|authorization|api[_ -]?key|private[_ -]?key|database[_ -]?url|connection[_ -]?string)[a-z0-9_.-]*)"\s*:\s*"[^"\r\n]*"/gi, '"$1":"[removed]"')
    .replace(/'([a-z0-9_.-]*(?:token|secret|password|cookie|authorization|api[_ -]?key|private[_ -]?key|database[_ -]?url|connection[_ -]?string)[a-z0-9_.-]*)'\s*:\s*'[^'\r\n]*'/gi, "'$1':'[removed]'")
    .replace(/\bauthorization\b\s*[:=]\s*(?:bearer|basic)\s+[^\s,;]+/gi, "Authorization: [removed]")
    .replace(/\b([a-z0-9_.-]*(?:token|secret|password|cookie|authorization|api[_ -]?key|private[_ -]?key|database[_ -]?url|connection[_ -]?string)[a-z0-9_.-]*)\b(\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/gi, "$1$2[removed]")
    .replace(/\b((?:https?|ftp|postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|rediss):\/\/)[^@\s/]+@/gi, "$1[credentials removed]@");
  const multiline = Boolean(options.multiline);
  const maxLength = Math.max(1, Number(options.maxLength) || 1_200);
  let text = stripUrlQueries(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email removed]")
    .replace(/(?:\+?1[\s.-]?)?\(?[2-9]\d{2}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, "[phone removed]")
    .replace(/\+\d{8,15}\b/g, "[phone removed]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, "[identifier removed]")
    .replace(/\b[A-Z]{2}[A-F0-9]{32}\b/gi, "[provider id removed]")
    .replace(/\b\d{1,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,5}\s+(?:street|st|road|rd|avenue|ave|drive|dr|lane|ln|boulevard|blvd|court|ct|way|place|pl|highway|hwy)\b(?:\s*,?\s*[A-Za-z.'-]+(?:\s+[A-Za-z.'-]+){0,3})?/gi, "[street address removed]")
    .replace(/\b[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z][ -]?\d[ABCEGHJ-NPRSTV-Z]\d\b/gi, "[postal code removed]")
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[token removed]")
    .replace(/\b\d{6,12}:[A-Za-z0-9_-]{20,}\b/g, "[token removed]")
    .replace(/\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{12,}\b/gi, "[secret removed]")
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/gi, "[secret removed]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]{8,}={0,2}/gi, "Bearer [token removed]")
    .replace(/\b(authorization|auth[_ -]?token|access[_ -]?token|refresh[_ -]?token|api[_ -]?key|api[_ -]?secret|client[_ -]?secret|password|secret|token)\b(\s*[:=]\s*)(?:["']?)[^\s,;"']{4,}(?:["']?)/gi, "$1$2[secret removed]");

  if (multiline) {
    text = text
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((line) => line.replace(/[\t ]+/g, " ").trim())
      .filter(Boolean)
      .join("\n");
  } else {
    text = text.replace(/[\r\n\t ]+/g, " ").trim();
  }
  return capText(text.trim(), maxLength);
}

function humanizeIncidentReason(code, fallback = "") {
  const normalizedCode = normalizeReasonCode(code);
  const knownReason = INCIDENT_REASON_CATALOG[normalizedCode];
  const safeFallback = redactIncidentText(fallback, { maxLength: 360 });
  if (knownReason) {
    if (!safeFallback || safeFallback.toLowerCase() === knownReason.toLowerCase()) return knownReason;
    return `${knownReason} Observed detail: ${safeFallback}`;
  }
  return safeFallback
    ? `Cause not confirmed yet. Reported detail: ${safeFallback}`
    : "Cause not confirmed yet. The available diagnostics do not establish a specific root cause.";
}

function humanizeSnapshotKey(value) {
  return String(value || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (character) => character.toUpperCase())
    .slice(0, 80);
}

function snapshotObjectLines(value, prefix = "", lines = [], seen = new WeakSet(), depth = 0) {
  if (lines.length >= 18 || depth > 2) return lines;
  if (value == null || typeof value !== "object") {
    const label = humanizeSnapshotKey(prefix || "Status");
    lines.push(`${label}: ${value == null || value === "" ? "Not available" : String(value)}`);
    return lines;
  }
  if (seen.has(value)) {
    lines.push(`${humanizeSnapshotKey(prefix || "Snapshot")}: [circular value removed]`);
    return lines;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    const primitives = value.filter((item) => item == null || typeof item !== "object").slice(0, 8);
    lines.push(`${humanizeSnapshotKey(prefix || "Items")}: ${primitives.length ? primitives.join(", ") : `${value.length} item(s)`}`);
    return lines;
  }
  for (const [key, nestedValue] of Object.entries(value)) {
    if (lines.length >= 18) break;
    const path = prefix ? `${prefix}.${key}` : key;
    if (nestedValue && typeof nestedValue === "object" && !Array.isArray(nestedValue)) {
      snapshotObjectLines(nestedValue, path, lines, seen, depth + 1);
    } else if (Array.isArray(nestedValue)) {
      snapshotObjectLines(nestedValue, path, lines, seen, depth + 1);
    } else {
      snapshotObjectLines(nestedValue, path, lines, seen, depth + 1);
    }
  }
  return lines;
}

function formatSnapshot(snapshot) {
  if (snapshot == null || snapshot === "") return "No additional snapshot was available.";
  const raw = typeof snapshot === "object"
    ? snapshotObjectLines(snapshot).map((line) => `• ${line}`).join("\n")
    : String(snapshot);
  return redactIncidentText(raw, { multiline: true, maxLength: 760 }) || "No additional snapshot was available.";
}

function formatDetectedAt(value) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) return date.toISOString();
  return redactIncidentText(value, { maxLength: 80 }) || "Not recorded";
}

function buildIncidentTelegramAlert(input = {}) {
  const severity = redactIncidentText(input.severity, { maxLength: 20 }).toUpperCase() || "WARNING";
  const title = redactIncidentText(input.title || input.whatFailed || "My AI PA incident", { maxLength: 140 });
  const whatFailed = redactIncidentText(input.whatFailed || input.title, { maxLength: 340 }) || "The affected operation was not identified.";
  const reason = capText(humanizeIncidentReason(input.reasonCode, input.reason), 420);
  const impact = redactIncidentText(input.impact, { multiline: true, maxLength: 300 }) || "The customer or operational impact has not been confirmed yet.";
  const snapshot = capText(formatSnapshot(input.snapshot), 520);
  const lastCheckpoint = redactIncidentText(input.lastCheckpoint, { multiline: true, maxLength: 300 }) || "No verified successful checkpoint is available.";
  const nextAction = redactIncidentText(input.nextAction, { multiline: true, maxLength: 300 }) || "Open the incident in the admin dashboard and inspect it before retrying or changing live resources.";
  const remediation = input.remediation && typeof input.remediation === "object" ? input.remediation : {};
  const confidence = ["high", "medium", "low"].includes(String(remediation.confidence || "").toLowerCase())
    ? String(remediation.confidence).toUpperCase()
    : "MEDIUM";
  const hypothesis = redactIncidentText(remediation.hypothesis, { multiline: true, maxLength: 300 })
    || "My AI PA has not proven a specific repair hypothesis yet, so it will preserve the incident and stop before making an unsafe change.";
  const proposedSolution = redactIncidentText(remediation.proposedSolution, { multiline: true, maxLength: 360 })
    || "My AI PA will preserve the evidence and require a verified recovery plan before changing production state.";
  const safetyBoundary = redactIncidentText(remediation.safetyBoundary, { multiline: true, maxLength: 260 })
    || "No payment, message, provider resource, credential, or destructive production action will be repeated without proving it is safe.";
  const incidentId = redactIncidentText(input.incidentId, { maxLength: 100 }) || "Not assigned";
  const incidentReference = /^[a-f0-9]{24}$/i.test(incidentId)
    ? `INC-${incidentId.slice(0, 8).toUpperCase()}`
    : incidentId;
  const defaultDestination = String(input.adminUrl || "").includes("incident=")
    ? `Needs Attention → ${incidentReference}`
    : "My AI PA admin → Needs Attention and logs";
  const signInDestination = redactIncidentText(input.signInDestination || defaultDestination, { maxLength: 180 });

  const text = [
    `MY AI PA — ${severity} INCIDENT`,
    title,
    `Incident: ${incidentId}`,
    `Detected: ${formatDetectedAt(input.detectedAt)}`,
    "",
    "WHAT FAILED",
    whatFailed,
    "",
    "REASON",
    reason,
    "",
    "IMPACT",
    impact,
    "",
    "SNAPSHOT",
    snapshot,
    "",
    "LAST GOOD CHECKPOINT",
    lastCheckpoint,
    "",
    "WORKING HYPOTHESIS",
    `Confidence: ${confidence}`,
    hypothesis,
    "",
    "MY AI PA RESPONSE",
    proposedSolution,
    "",
    "SAFETY LIMIT",
    safetyBoundary,
    "",
    "DO THIS NEXT",
    nextAction,
    "",
    "YOU ARE SIGNING IN TO",
    signInDestination,
  ].join("\n");

  return capText(text, MAX_TELEGRAM_TEXT_LENGTH, "\n…");
}

function buildIncidentRemediationUpdate(input = {}) {
  const status = ["resolved", "recovered", "cleared", "repair_dispatched", "repair_ready", "needs_user", "failed"].includes(String(input.status || ""))
    ? String(input.status)
    : "failed";
  const statusLabels = {
    resolved: "VERIFIED FIXED",
    recovered: "SERVICE HEALTHY AGAIN",
    cleared: "NO LONGER DETECTED",
    repair_dispatched: "REPAIR JOB STARTED",
    repair_ready: "CODE REPAIR DRAFT READY",
    needs_user: "NEEDS YOU",
    failed: "AUTOMATIC REPAIR STOPPED",
  };
  const incidentId = redactIncidentText(input.incidentId, { maxLength: 100 }) || "Not assigned";
  const actionTaken = redactIncidentText(input.actionTaken, { multiline: true, maxLength: 620 })
    || "No repair action was recorded.";
  const verification = redactIncidentText(input.verification, { multiline: true, maxLength: 620 })
    || "No verification evidence was recorded.";
  const nextAction = redactIncidentText(input.nextAction, { multiline: true, maxLength: 620 })
    || (["resolved", "recovered", "cleared"].includes(status)
      ? "No immediate action is required. The original operation was not replayed."
      : "Open the exact incident and review the repair result.");
  const text = [
    `MY AI PA — ${statusLabels[status]}`,
    `Incident: ${incidentId}`,
    `Updated: ${formatDetectedAt(input.completedAt || input.updatedAt || new Date().toISOString())}`,
    "",
    "WHAT MY AI PA DID",
    actionTaken,
    "",
    "VERIFICATION",
    verification,
    "",
    ["resolved", "recovered", "cleared"].includes(status) ? "WHAT HAPPENS NEXT" : "WHAT YOU NEED TO DO NEXT",
    nextAction,
  ].join("\n");
  return capText(text, MAX_TELEGRAM_TEXT_LENGTH, "\n…");
}

function validAdminUrl(value) {
  const raw = String(value || "").trim();
  if (!raw || raw.length > 2_048) return "";
  try {
    const url = new URL(raw);
    const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
    if (url.protocol !== "https:" && !localHttp) return "";
    if (url.username || url.password) return "";
    return url.toString();
  } catch (_error) {
    return "";
  }
}

async function sendIncidentTelegramAlert(input, { token, chatId, fetchImpl = fetch } = {}) {
  const safeToken = String(token || "").trim();
  const safeChatId = String(chatId || "").trim();
  if (!safeToken || !safeChatId) {
    return { sent: false, skipped: true, reason: "telegram_not_configured" };
  }

  const adminUrl = validAdminUrl(input?.adminUrl);
  const buttonText = redactIncidentText(input?.buttonText, { maxLength: 40 }) || "Open exact issue";
  const body = {
    chat_id: safeChatId,
    disable_web_page_preview: true,
    text: buildIncidentTelegramAlert(input),
    ...(adminUrl ? {
      reply_markup: {
        inline_keyboard: [[{ text: buttonText, url: adminUrl }]],
      },
    } : {}),
  };
  const response = await fetchImpl(`https://api.telegram.org/bot${safeToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(7_000) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok !== true) {
    const error = new Error(data?.description || `Telegram incident alert failed (${response.status}).`);
    error.statusCode = 502;
    throw error;
  }
  return {
    sent: true,
    skipped: false,
    messageId: data?.result?.message_id || null,
  };
}

async function sendIncidentRemediationUpdate(input, { token, chatId, fetchImpl = fetch } = {}) {
  return sendIncidentTelegramAlert({
    ...input,
    title: input.title || "Incident remediation update",
    whatFailed: input.actionTaken || "Incident remediation update",
    reasonCode: input.reasonCode || "INCIDENT_REMEDIATION_UPDATE",
    reason: input.verification || input.actionTaken,
    impact: input.status === "resolved"
      ? "The required postcondition was verified."
      : "The incident remains contained and has not been reported as fixed.",
    snapshot: input.snapshot || { Status: input.status || "failed" },
    lastCheckpoint: input.verification,
    nextAction: input.nextAction,
  }, {
    token,
    chatId,
    fetchImpl: async (url, options) => fetchImpl(url, {
      ...options,
      body: JSON.stringify({
        ...JSON.parse(options.body),
        text: buildIncidentRemediationUpdate(input),
      }),
    }),
  });
}

module.exports = {
  INCIDENT_REASON_CATALOG,
  MAX_TELEGRAM_TEXT_LENGTH,
  buildIncidentTelegramAlert,
  buildIncidentRemediationUpdate,
  humanizeIncidentReason,
  redactIncidentText,
  sendIncidentTelegramAlert,
  sendIncidentRemediationUpdate,
  validAdminUrl,
};
