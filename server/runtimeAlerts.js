const crypto = require("crypto");

const {
  redactIncidentText,
  sendIncidentTelegramAlert,
} = require("./incidentAlerts");

const DEFAULT_DEDUPE_MS = 10 * 60 * 1000;
const sentIncidents = new Map();

function safeRuntimeCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_.:-]+/g, "_")
    .slice(0, 80);
}

function safeRuntimePath(value) {
  const path = String(value || "")
    .split(/[?#]/, 1)[0]
    .replace(/\b[0-9a-f]{20,}\b/gi, ":id")
    .replace(/\/[0-9]{2,}(?=\/|$)/g, "/:id")
    .slice(0, 160);
  return path || "unknown route";
}

function safeRuntimeMessage(error) {
  const message = redactIncidentText(String(error?.message || "")).trim().slice(0, 260);
  if (!message) return "The application failed without returning a safe diagnostic message. The root cause is not yet confirmed.";
  return `The application reported: ${message} Root cause is not yet independently confirmed.`;
}

function runtimeIncidentId(key) {
  return crypto.createHash("sha256").update(String(key || "runtime")).digest("hex").slice(0, 24);
}

function safeSnapshot(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return Object.fromEntries(Object.entries(input)
    .slice(0, 12)
    .map(([key, value]) => [
      String(key || "Detail").replace(/[^a-z0-9 _.-]+/gi, "").trim().slice(0, 50) || "Detail",
      redactIncidentText(String(value == null ? "unknown" : value)).trim().slice(0, 160) || "unknown",
    ]));
}

function buildRuntimeIncident(error, context = {}) {
  const area = String(context.area || context.workflow || "application request").trim().slice(0, 100);
  const route = safeRuntimePath(context.route || context.path);
  const method = safeRuntimeCode(context.method);
  const reasonCode = safeRuntimeCode(context.reasonCode || error?.code || (context.status ? `HTTP_${context.status}` : "RUNTIME_FAILURE"));
  const release = safeRuntimeCode(context.release);
  const fingerprintSource = context.dedupeFingerprint
    || [redactIncidentText(context.reason || error?.message || "unknown", { maxLength: 320 }), release, context.upstreamStatus || ""].join(":");
  const fingerprint = crypto.createHash("sha256").update(String(fingerprintSource)).digest("hex").slice(0, 16);
  const key = [area, method, route, reasonCode, fingerprint].join(":");
  return {
    severity: context.severity || "critical",
    whatFailed: context.whatFailed || `${area} failed`,
    reasonCode,
    reason: context.reason || safeRuntimeMessage(error),
    impact: context.impact || "The affected My AI PA operation did not finish and may need a safe retry.",
    snapshot: {
      ...safeSnapshot(context.snapshot),
      Workflow: area,
      ...(method ? { Method: method } : {}),
      ...(route ? { Route: route } : {}),
      ...(context.phase ? { Phase: String(context.phase).slice(0, 80) } : {}),
      ...(context.status ? { Status: String(context.status).slice(0, 40) } : {}),
      ...(context.upstreamStatus ? { "Provider status": String(context.upstreamStatus).slice(0, 40) } : {}),
      ...(release ? { Release: release } : {}),
      ...(context.businessName ? { Business: String(context.businessName).slice(0, 120) } : {}),
    },
    lastCheckpoint: context.lastCheckpoint || "The operation reached the application but did not complete normally.",
    nextAction: context.nextAction || "Open the admin dashboard and server logs, verify the affected provider state, then retry only if no duplicate action can be created.",
    incidentId: runtimeIncidentId(key),
    detectedAt: context.detectedAt || new Date().toISOString(),
    adminUrl: context.adminUrl || "",
    signInDestination: context.signInDestination || "My AI PA admin → Needs Attention and server logs",
    dedupeKey: key,
  };
}

function pruneDedupe(now, dedupeMs) {
  for (const [key, sentAt] of sentIncidents) {
    if (now - sentAt >= dedupeMs) sentIncidents.delete(key);
  }
}

async function notifyRuntimeIncident(error, context = {}, options = {}) {
  const token = String(options.token || "").trim();
  const chatId = String(options.chatId || "").trim();
  if (!token || !chatId || options.enabled === false) {
    return { sent: false, skipped: true, reason: "telegram_not_configured" };
  }
  const incident = buildRuntimeIncident(error, context);
  const now = Number(options.now || Date.now());
  const dedupeMs = Math.max(1000, Number(options.dedupeMs || DEFAULT_DEDUPE_MS));
  pruneDedupe(now, dedupeMs);
  if (sentIncidents.has(incident.dedupeKey)) {
    return { sent: false, skipped: true, reason: "duplicate_incident", incidentId: incident.incidentId };
  }
  sentIncidents.set(incident.dedupeKey, now);
  try {
    const result = await sendIncidentTelegramAlert(incident, {
      token,
      chatId,
      fetchImpl: options.fetchImpl,
    });
    if (!result.sent) sentIncidents.delete(incident.dedupeKey);
    return { ...result, incidentId: incident.incidentId };
  } catch (alertError) {
    sentIncidents.delete(incident.dedupeKey);
    return {
      sent: false,
      skipped: false,
      reason: "telegram_delivery_failed",
      incidentId: incident.incidentId,
      error: safeRuntimeCode(alertError?.code || "TELEGRAM_DELIVERY_FAILED"),
    };
  }
}

function resetRuntimeAlertDedupeForTests() {
  sentIncidents.clear();
}

module.exports = {
  buildRuntimeIncident,
  notifyRuntimeIncident,
  resetRuntimeAlertDedupeForTests,
  safeRuntimeCode,
  safeRuntimePath,
};
