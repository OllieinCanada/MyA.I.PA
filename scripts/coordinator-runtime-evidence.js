"use strict";

// No dotenv, provider clients, incident actions, or state persistence. Exactly
// one GET to the fixed operational-health endpoint is permitted.
const { INCIDENT_REASON_CATALOG } = require("../server/incidentAlerts");

const ENDPOINT = "https://api.myaipa.ca/api/internal/operations/health";
const MAX_BYTES = 2 * 1024 * 1024;
const CATEGORY_PATTERN = /^[a-z][a-z0-9_]{0,79}$/;
const REASON_PATTERN = /^(?:[A-Z][A-Z0-9_]{0,79}|[0-9]{5})$/;
const KINDS = new Set([
  "payment_failed", "subscription_past_due", "subscription_unpaid",
  "subscription_paused", "stripe_trial_creation_failed", "signup_failed",
  "signup_stuck", "signup_review_required", "signup_duplicate",
  "owner_text_failed", "call_missing_handoff", "business_mapping_incomplete",
  "call_text_incomplete", "call_tool_failed", "call_tool_stuck",
  "high_priority_support", "runtime_incident", "twilio_receipt_worker",
]);
const SEVERITIES = new Set(["critical", "warning", "info"]);
// This application catalog is a static allowlist, not response-controlled data.
// Extras come from operationalAttention's non-runtime issue builders.
const REASONS = new Set([
  ...Object.keys(INCIDENT_REASON_CATALOG),
  // Static source-defined reasons and legacy finite error enums; never response-controlled.
  ...["ABORTERROR", "ABORT_ERR", "CONTROLLED_READINESS_REMEDIATION_TEST", "CONTROLLED_TELEGRAM_TEST", "CUSTOMER_PAYMENT_FAILED", "DATABASE_QUERY_IMPLEMENTATION_FAILED", "DATABASE_TRANSACTION_TIMEOUT", "DATABASE_UNAVAILABLE", "DUPLICATE_OR_STATE_CONFLICT", "DUPLICATE_SIGNUP_IDENTITY", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "HIGH_PRIORITY_SUPPORT_OPEN", "HTTP_400", "HTTP_401", "HTTP_403", "HTTP_404", "HTTP_408", "HTTP_409", "HTTP_422", "HTTP_429", "HTTP_500", "HTTP_502", "HTTP_503", "HTTP_504", "LEAD_HANDOFF_MISSING", "MAKE_SIGNUP_REJECTED", "MAKE_SIGNUP_RESPONSE_EMPTY", "MAKE_SIGNUP_RESPONSE_INCOMPLETE", "MANUAL_REVIEW_REQUIRED", "MESSAGE_DELIVERY_FAILED", "P1001", "P1002", "P1017", "P2002", "P2003", "P2010", "P2025", "P2028", "PAYMENT_FAILED", "PROVIDER_ACCOUNT_FUNDING_REQUIRED", "PROVIDER_AUTHENTICATION_FAILED", "PROVIDER_CONFIGURATION_INVALID", "PROVIDER_CONNECTION_FAILED", "PROVIDER_INVENTORY_UNAVAILABLE", "PROVIDER_PERMISSION_OR_COMPLIANCE_BLOCK", "PROVIDER_RATE_LIMITED", "PROVIDER_TIMEOUT", "PROVIDER_UNAVAILABLE", "PROVISIONING_NOT_READY", "SIGNUP_SETUP_FAILED", "SIGNUP_SUPPORT_REQUESTED", "SMS_ROUTING_FAILED", "STRIPE_TRIAL_CREATION_FAILED", "SUBSCRIPTION_PAST_DUE", "SUBSCRIPTION_PAUSED", "SUBSCRIPTION_UNPAID", "TELEGRAM_OUTBOX_CAPACITY_EXCEEDED", "TELEGRAM_OUTBOX_DRAIN_FAILED", "TRIAL_ENDED_AWAITING_PAYMENT", "TWILIO_ACCOUNT_ACCESS_REJECTED", "TWILIO_RECEIPT_WORKER_UNHEALTHY", "UNKNOWN_OPERATIONAL_FAILURE", "VAPI_CALL_SYNC_DELAYED", "VAPI_CALL_SYNC_FAILED"],
  "SUBSCRIPTION_PAST_DUE", "SUBSCRIPTION_UNPAID", "SUBSCRIPTION_PAUSED",
  "TRIAL_ENDED_AWAITING_PAYMENT", "STRIPE_TRIAL_CREATION_FAILED",
  "PHONE_VALIDATION_FAILED", "PROVISIONED_NUMBER_NOT_READY", "SIGNUP_SETUP_FAILED",
  "CONTACT_VERIFICATION_DELIVERY_FAILED", "CONTACT_VERIFICATION_PENDING",
  "SIGNUP_CHECKPOINT_STALE", "MANUAL_REVIEW_REQUIRED", "DUPLICATE_SIGNUP_IDENTITY",
  "OWNER_ACKNOWLEDGEMENT_OVERDUE", "LEAD_HANDOFF_MISSING",
  "OWNER_NOTIFICATION_PHONE_MISSING", "PHONE_ASSISTANT_MAPPING_MISSING",
  "OWNER_TEXT_RESULT_INCOMPLETE", "HIGH_PRIORITY_SUPPORT_OPEN", "RUNTIME_FAILURE",
  "VAPI_CALL_SYNC_DELAYED", "21265", "21266", "21268", "21608", "30034", "63038",
]);

class DiagnosisError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function projectCounts(payload) {
  if (!record(payload) || payload.service !== "my-ai-pa-operations"
      || typeof payload.ok !== "boolean" || !Array.isArray(payload.issues)
      || payload.issues.length > 2000) {
    throw new DiagnosisError("unrecognized_operational_schema");
  }
  const counts = { active: 0, critical: 0, warning: 0, info: 0 };
  const categories = new Map();
  let unknownReasonCount = 0;
  let missingReasonCount = 0;
  let unknownSchemaCount = 0;
  let unknownSeverityCount = 0;
  for (const issue of payload.issues) {
    const knownKind = record(issue) && typeof issue.kind === "string"
      && CATEGORY_PATTERN.test(issue.kind) && KINDS.has(issue.kind);
    const knownSeverity = record(issue) && SEVERITIES.has(issue.severity);
    const kind = knownKind ? issue.kind : "UNKNOWN_KIND";
    const severity = knownSeverity ? issue.severity : "UNKNOWN_SEVERITY";
    if (!knownKind || !knownSeverity) unknownSchemaCount += 1;
    let reasonCode = "NOT_PROVIDED";
    const details = record(issue) ? issue.incident : null;
    if (details == null || (record(details) && details.reasonCode == null)) {
      missingReasonCount += 1;
    } else if (!record(details) || typeof details.reasonCode !== "string") {
      unknownSchemaCount += 1;
      reasonCode = "UNKNOWN_REASON_CODE";
    } else {
      const suppliedReason = details.reasonCode;
      const recognized = REASON_PATTERN.test(suppliedReason) && REASONS.has(suppliedReason);
      // Even uppercase unknown values could contain a customer or credential.
      reasonCode = recognized ? suppliedReason : "UNKNOWN_REASON_CODE";
      if (!recognized) unknownReasonCount += 1;
    }
    counts.active += 1;
    if (knownSeverity) counts[severity] += 1;
    else unknownSeverityCount += 1;
    const key = `${kind}:${severity}:${reasonCode}`;
    const existing = categories.get(key);
    if (existing) existing.count += 1;
    else categories.set(key, { kind, severity, reasonCode, count: 1 });
  }
  const errors = [
    ...(unknownSchemaCount ? ["unrecognized_operational_issue_schema"] : []),
    ...(unknownReasonCount ? ["unrecognized_reason_code"] : []),
    ...(missingReasonCount ? ["reason_code_not_provided"] : []),
  ];
  return {
    schemaVersion: 1,
    readOnly: true,
    authenticatedRead: true,
    complete: errors.length === 0,
    operationalOk: payload.ok,
    counts,
    categories: [...categories.values()].sort((a, b) =>
      `${a.severity}:${a.kind}:${a.reasonCode}`.localeCompare(`${b.severity}:${b.kind}:${b.reasonCode}`)),
    ...(errors.length ? { error: errors[0], errors } : {}),
    ...(unknownReasonCount ? { unknownReasonCount } : {}),
    ...(missingReasonCount ? { missingReasonCount } : {}),
    ...(unknownSchemaCount ? { unknownSchemaCount } : {}),
    ...(unknownSeverityCount ? { unknownSeverityCount } : {}),
  };
}

function projectPayload(payload) {
  const result = projectCounts(payload);
  const providers = new Set(['Render PostgreSQL', 'Vapi', 'Twilio', 'Make.com', 'OpenAI', 'Deepgram', 'email provider', 'Telegram', 'Stripe']);
  const codes = new Set(['P2028', 'P2010', 'P1001', 'ETIMEDOUT', 'ABORT_ERR', 'ABORTERROR', 'TIMEOUTERROR', 'ECONNRESET', 'FETCH_TIMEOUT', 'REQUEST_TIMEOUT', 'MAKE_SIGNUP_TIMEOUT']);
  const statuses = new Set(['queued','running','recovered','resolved','needs_user','failed','not_required','awaiting_review','blocked']);
  const workflows = new Set(["Vapi call sync background job","API process crash", "Telegram incident delivery", "Twilio delivery inbox", "admin agent delivery recovery", "agent delivery test", "billing and trial workflow", "customer agent testing station", "incident remediation canary", "legacy new agent delivery test", "new agent delivery test", "production alert verification", "signup SMS routing", "text-message delivery", "voice signup verification delivery", "web signup verification delivery", "website browser"]);
  result.criticalDetails = payload.issues.filter(i => i && i.kind === 'runtime_incident' && i.severity === 'critical').map(i => {
    const s = record(i.snapshot) ? i.snapshot : {};
    const d = record(i.diagnostics) ? i.diagnostics : {};
    const before = value => { const n = Date.parse(value); return Number.isFinite(n) ? n < Date.parse('2026-10-25T04:55:12Z') : null; };
    return {
      reasonCode: ['DATABASE_QUERY_IMPLEMENTATION_FAILED','PROVIDER_TIMEOUT'].includes(i.incident?.reasonCode) ? i.incident.reasonCode : 'OTHER_CRITICAL',
      provider: providers.has(s.Provider) ? s.Provider : 'UNKNOWN_PROVIDER',
      providerCode: codes.has(s['Provider code']) ? s['Provider code'] : 'UNKNOWN_CODE',
      workflow: workflows.has(s.Workflow) ? s.Workflow : 'UNKNOWN_WORKFLOW',
      matchesCurrentCommit: typeof s.Release === 'string' && s.Release.toLowerCase() === '8fb992689d9b66efd5958676b7c3e2bc0b923631',
      firstDetectedBeforeCurrentCommit: before(d.firstDetectedAt || i.detectedAt),
      lastDetectedBeforeCurrentCommit: before(d.lastDetectedAt || i.detectedAt),
      occurrences: Number.isSafeInteger(d.occurrences) && d.occurrences >= 0 ? Math.min(d.occurrences, 10000) : null,
      remediation: statuses.has(i.remediation?.status) ? i.remediation.status : 'UNKNOWN_STATUS',
    };
  });
  result.warningDetails = payload.issues.filter(i => i && i.kind === 'runtime_incident' && i.severity === 'warning').map(i => {
    const s = record(i.snapshot) ? i.snapshot : {};
    const d = record(i.diagnostics) ? i.diagnostics : {};
    const raw = i.incident?.reasonCode;
    const failureCodes = new Set(['P1001','P1002','P1017','P2002','P2003','P2010','P2025','P2028','VAPI_API_KEY_MISSING','VAPI_CALL_SYNC_PARTIAL','ECONNRESET','ECONNREFUSED','ETIMEDOUT','ABORT_ERR','AbortError','TIMEOUTERROR','TypeError','Error','FETCH_TIMEOUT','REQUEST_TIMEOUT','MAKE_SIGNUP_TIMEOUT']);
    return {
      reasonCode: REASONS.has(raw) ? raw : 'UNKNOWN_REASON_CODE',
      provider: providers.has(s.Provider) ? s.Provider : 'UNKNOWN_PROVIDER',
      providerCode: failureCodes.has(s['Provider code']) ? s['Provider code'] : 'UNKNOWN_CODE',
      failureCode: failureCodes.has(s['Failure code']) ? s['Failure code'] : 'UNKNOWN_CODE',
      workflow: workflows.has(s.Workflow) ? s.Workflow : 'UNKNOWN_WORKFLOW',
      occurrences: Number.isSafeInteger(d.occurrences) && d.occurrences >= 0 ? Math.min(d.occurrences,10000) : null,
      remediation: statuses.has(i.remediation?.status) ? i.remediation.status : 'UNKNOWN_STATUS',
      // Only compare to the known source commit time; do not publish customer timestamps.
      lastDetectedBeforeCurrentCommit: Number.isFinite(Date.parse(d.lastDetectedAt || i.detectedAt)) ? Date.parse(d.lastDetectedAt || i.detectedAt) < Date.parse('2026-10-25T04:55:12Z') : null,
    };
  });
  return result;
}

async function boundedJson(response) {
  if (!response.body || typeof response.body.getReader !== "function") {
    throw new DiagnosisError("unrecognized_response_body");
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        throw new DiagnosisError("operational_response_too_large");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (_error) {
    throw new DiagnosisError("invalid_operational_json");
  }
}

async function diagnose({ apiKey = process.env.MONITOR_API_KEY, fetchImpl = fetch } = {}) {
  if (typeof apiKey !== "string" || !apiKey.trim() || apiKey.length > 4096 || /[\r\n]/.test(apiKey)) {
    return { schemaVersion: 1, readOnly: true, authenticatedRead: false, complete: false, error: "monitor_auth_missing_or_invalid" };
  }
  try {
    const response = await fetchImpl(ENDPOINT, {
      method: "GET",
      redirect: "error",
      headers: { Authorization: `Bearer ${apiKey.trim()}`, Accept: "application/json", "Cache-Control": "no-store" },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      const status = Number.isInteger(response.status) && response.status >= 100 && response.status <= 599
        ? response.status : null;
      return { schemaVersion: 1, readOnly: true, authenticatedRead: false, complete: false,
        error: "operational_http_error", status };
    }
    return projectPayload(await boundedJson(response));
  } catch (error) {
    return { schemaVersion: 1, readOnly: true, authenticatedRead: false, complete: false,
      error: error instanceof DiagnosisError ? error.code : "operational_request_failed" };
  }
}

async function main(options) {
  const result = await diagnose(options);
  console.log(JSON.stringify(result, null, 2));
  return result.complete ? 0 : 2;
}

if (require.main === module) {
  main().then((code) => { process.exitCode = code; }).catch(() => {
    console.log(JSON.stringify({ schemaVersion: 1, readOnly: true, complete: false, error: "diagnostic_failed" }));
    process.exitCode = 2;
  });
}

module.exports = { ENDPOINT, diagnose, projectPayload };
