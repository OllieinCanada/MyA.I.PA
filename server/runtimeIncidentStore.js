const fs = require("fs");
const path = require("path");

const { humanizeIncidentReason, redactIncidentText } = require("./incidentAlerts");

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_INCIDENTS = 100;

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

module.exports = {
  acknowledgeRuntimeIncident,
  createAttentionItem,
  listRuntimeIncidents,
  recordRuntimeIncident,
};
