const fs = require("fs");
const path = require("path");

const { humanizeIncidentReason, redactIncidentText } = require("./incidentAlerts");

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_INCIDENTS = 100;
const REMEDIATION_RECURRENCE_MS = 10 * 60 * 1000;
const REMEDIATION_STATUSES = new Set([
  "queued",
  "repairing",
  "verifying",
  "resolved",
  "recovered",
  "repair_dispatched",
  "repair_ready",
  "needs_user",
  "failed",
  "not_required",
]);
const TERMINAL_REMEDIATION_STATUSES = new Set(["resolved", "recovered", "repair_ready", "needs_user", "failed", "not_required"]);
const REOPENABLE_REMEDIATION_STATUSES = new Set(["resolved", "recovered"]);

function safeRuntimeIncidentId(value) {
  return /^[a-f0-9]{24}$/i.test(String(value || "")) ? String(value).toLowerCase() : "";
}

function readStore(filePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return Array.isArray(parsed?.items) ? parsed.items : [];
  } catch (_error) {
    return [];
  }
}

function writeStore(filePath, items) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify({ schemaVersion: 1, items }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporaryPath, filePath);
}

function safeRemediationText(value, maxLength = 420) {
  return redactIncidentText(value, { multiline: true, maxLength });
}

function createRemediationState(incident, previous, detectedAt) {
  const plan = incident?.remediation && typeof incident.remediation === "object" ? incident.remediation : {};
  const previousState = previous?.remediation && typeof previous.remediation === "object"
    ? previous.remediation
    : null;
  // Measure recurrence from the terminal remediation decision, not from the
  // most recent duplicate detection. Otherwise a failure arriving every few
  // minutes can keep moving lastDetectedAt and suppress a new generation
  // forever.
  const previousDetectedAt = new Date(previousState?.terminalAt || previousState?.updatedAt || previous?.detectedAt || 0).getTime();
  const currentDetectedAt = new Date(detectedAt).getTime();
  const recurrent = Boolean(
    previousState
      && REOPENABLE_REMEDIATION_STATUSES.has(previousState.status)
      && Number.isFinite(previousDetectedAt)
      && Number.isFinite(currentDetectedAt)
      && currentDetectedAt - previousDetectedAt >= REMEDIATION_RECURRENCE_MS
  );
  if (previousState && !recurrent) return previousState;

  const status = REMEDIATION_STATUSES.has(String(plan.status || ""))
    ? String(plan.status)
    : plan.automatic === true ? "queued" : "needs_user";
  const generation = Math.max(1, Number(previousState?.generation || 0) + (previousState ? 1 : 0));
  const created = {
    version: Math.max(1, Number(plan.version || 1)),
    generation,
    status,
    action: String(plan.action || "none").replace(/[^a-z0-9_.:-]+/gi, "_").slice(0, 80),
    automatic: plan.automatic === true,
    requiresUser: plan.requiresUser !== false,
    confidence: ["high", "medium", "low"].includes(String(plan.confidence || "").toLowerCase())
      ? String(plan.confidence).toLowerCase()
      : "medium",
    hypothesis: safeRemediationText(plan.hypothesis, 420),
    proposedSolution: safeRemediationText(plan.proposedSolution, 480),
    safetyBoundary: safeRemediationText(plan.safetyBoundary, 420),
    updatedAt: detectedAt,
    ...(TERMINAL_REMEDIATION_STATUSES.has(status) ? { terminalAt: detectedAt } : {}),
    history: [{
      status,
      at: detectedAt,
      summary: status === "queued"
        ? "Automatic remediation queued after the incident report was prepared."
        : status === "not_required"
          ? "No remediation was required."
          : "The incident requires a guarded user or operator action.",
    }],
  };
  return created;
}

function createAttentionItem(incident, previous = null) {
  const id = safeRuntimeIncidentId(incident?.incidentId);
  if (!id) return null;
  const detectedAt = new Date(incident.detectedAt || Date.now()).toISOString();
  const previousOccurrences = Math.max(0, Number(previous?.diagnostics?.occurrences || 0));
  const sourceSnapshot = incident?.snapshot && typeof incident.snapshot === "object" && !Array.isArray(incident.snapshot)
    ? incident.snapshot
    : {};
  const snapshot = Object.fromEntries(Object.entries(sourceSnapshot)
    .slice(0, 12)
    .map(([key, value]) => [
      redactIncidentText(String(key || "Detail"), { maxLength: 50 }) || "Detail",
      redactIncidentText(String(value == null ? "unknown" : value), { maxLength: 180 }) || "unknown",
    ]));
  const snapshotBusiness = snapshot.Business || snapshot.business || "";
  const severity = ["critical", "warning", "info"].includes(String(incident.severity || "").toLowerCase())
    ? String(incident.severity).toLowerCase()
    : "critical";
  const remediation = createRemediationState(incident, previous, detectedAt);
  return {
    id,
    kind: "runtime_incident",
    severity,
    title: redactIncidentText(incident.whatFailed || "Runtime incident captured", { maxLength: 140 }),
    summary: redactIncidentText(incident.impact || "A My AI PA operation did not finish normally.", { maxLength: 240 }),
    businessName: redactIncidentText(snapshotBusiness, { maxLength: 120 }),
    incident: {
      reason: humanizeIncidentReason(incident.reasonCode, incident.reason),
      impact: redactIncidentText(incident.impact, { maxLength: 300 }),
      lastCheckpoint: redactIncidentText(incident.lastCheckpoint, { maxLength: 300 }),
      nextAction: redactIncidentText(incident.nextAction, { maxLength: 360 }),
      reasonCode: String(incident.reasonCode || "RUNTIME_FAILURE").replace(/[^a-z0-9_.:-]+/gi, "_").slice(0, 80),
      confidence: "medium",
    },
    snapshot,
    detectedAt,
    ageMinutes: 0,
    businessId: null,
    targetType: "runtime_incident",
    targetId: id,
    actions: ["acknowledge_runtime_incident"],
    remediation,
    diagnostics: {
      occurrences: previousOccurrences + 1,
      originalSeverity: severity,
      firstDetectedAt: previous?.diagnostics?.firstDetectedAt || detectedAt,
      lastDetectedAt: detectedAt,
    },
  };
}

function recordRuntimeIncident(filePath, incident) {
  try {
    const items = readStore(filePath);
    const id = safeRuntimeIncidentId(incident?.incidentId);
    const previous = items.find((item) => item.id === id) || null;
    const next = createAttentionItem(incident, previous);
    if (!next) return { recorded: false, reason: "invalid_incident_id" };
    const updated = [next, ...items.filter((item) => item.id !== id)].slice(0, MAX_INCIDENTS);
    writeStore(filePath, updated);
    return { recorded: true, item: next };
  } catch (_error) {
    return { recorded: false, reason: "runtime_incident_store_failed" };
  }
}

function listRuntimeIncidents(filePath, { now = new Date(), ttlMs = DEFAULT_TTL_MS } = {}) {
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const all = readStore(filePath);
  const active = all.filter((item) => {
    const detectedMs = new Date(item?.diagnostics?.lastDetectedAt || item?.detectedAt || 0).getTime();
    return safeRuntimeIncidentId(item?.id) && Number.isFinite(detectedMs) && nowMs - detectedMs <= ttlMs;
  }).map((item) => ({
    ...item,
    ageMinutes: Math.max(0, Math.floor((nowMs - new Date(item.detectedAt).getTime()) / 60_000)),
  }));
  if (active.length !== all.length) {
    try { writeStore(filePath, active); } catch (_error) { /* keep serving the safe in-memory result */ }
  }
  return active;
}

function acknowledgeRuntimeIncident(filePath, incidentId) {
  const id = safeRuntimeIncidentId(incidentId);
  if (!id) return { acknowledged: false, reason: "invalid_incident_id" };
  const items = readStore(filePath);
  if (!items.some((item) => item.id === id)) return { acknowledged: false, reason: "not_found" };
  try {
    writeStore(filePath, items.filter((item) => item.id !== id));
    return { acknowledged: true, id };
  } catch (_error) {
    return { acknowledged: false, reason: "runtime_incident_store_failed" };
  }
}

function updateRuntimeIncidentRemediation(filePath, incidentId, transition = {}) {
  const id = safeRuntimeIncidentId(incidentId);
  if (!id) return { updated: false, reason: "invalid_incident_id" };
  const status = String(transition.status || "").trim().toLowerCase();
  if (!REMEDIATION_STATUSES.has(status)) return { updated: false, reason: "invalid_remediation_status" };
  const items = readStore(filePath);
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) return { updated: false, reason: "not_found" };
  const item = items[index];
  const current = item.remediation && typeof item.remediation === "object" ? item.remediation : {};
  if (TERMINAL_REMEDIATION_STATUSES.has(current.status) && current.status !== status) {
    return { updated: false, reason: "terminal_remediation_state", item };
  }
  const updatedAt = new Date(transition.updatedAt || Date.now()).toISOString();
  const history = Array.isArray(current.history) ? current.history.slice(-15) : [];
  history.push({
    status,
    at: updatedAt,
    summary: safeRemediationText(
      transition.summary || transition.actionTaken || transition.verification || `Remediation moved to ${status}.`,
      360
    ),
  });
  const remediation = {
    ...current,
    status,
    updatedAt,
    ...(current.terminalAt
      ? { terminalAt: current.terminalAt }
      : TERMINAL_REMEDIATION_STATUSES.has(status) ? { terminalAt: updatedAt } : {}),
    requiresUser: ["repair_ready", "needs_user", "failed"].includes(status)
      || transition.requiresUser === true,
    ...(transition.initialReportPreservedAt
      ? { initialReportPreservedAt: new Date(transition.initialReportPreservedAt).toISOString() }
      : {}),
    ...(["sent", "duplicate", "queued"].includes(String(transition.initialReportDelivery || ""))
      ? { initialReportDelivery: String(transition.initialReportDelivery) }
      : {}),
    ...(/^[a-f0-9]{24}$/i.test(String(transition.initialReportOutboxId || ""))
      ? { initialReportOutboxId: String(transition.initialReportOutboxId).toLowerCase() }
      : {}),
    ...(transition.completionReportPreservedAt
      ? { completionReportPreservedAt: new Date(transition.completionReportPreservedAt).toISOString() }
      : {}),
    ...(["sent", "queued"].includes(String(transition.completionReportDelivery || ""))
      ? { completionReportDelivery: String(transition.completionReportDelivery) }
      : {}),
    ...(/^[a-f0-9]{24}$/i.test(String(transition.completionReportOutboxId || ""))
      ? { completionReportOutboxId: String(transition.completionReportOutboxId).toLowerCase() }
      : {}),
    ...(transition.actionTaken ? { actionTaken: safeRemediationText(transition.actionTaken, 480) } : {}),
    ...(transition.verification ? { verification: safeRemediationText(transition.verification, 480) } : {}),
    ...(transition.nextAction ? { nextAction: safeRemediationText(transition.nextAction, 480) } : {}),
    ...(transition.referenceUrl ? { referenceUrl: String(transition.referenceUrl).slice(0, 2_048) } : {}),
    history,
  };
  const nextItem = { ...item, remediation };
  items[index] = nextItem;
  try {
    writeStore(filePath, items);
    return { updated: true, item: nextItem };
  } catch (_error) {
    return { updated: false, reason: "runtime_incident_store_failed" };
  }
}

module.exports = {
  acknowledgeRuntimeIncident,
  createAttentionItem,
  listRuntimeIncidents,
  recordRuntimeIncident,
  updateRuntimeIncidentRemediation,
};
