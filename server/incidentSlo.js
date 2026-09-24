const DEFAULT_TARGETS = Object.freeze({
  captureMs: 10_000,
  codexDispatchMs: 60_000,
  containmentMs: 3 * 60_000,
  draftRepairMs: 30 * 60_000,
  maximumUnacknowledgedMs: 60 * 60_000,
});

function positiveMs(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function incidentSloTargets(env = process.env) {
  return {
    captureMs: positiveMs(env.INCIDENT_SLO_CAPTURE_MS, DEFAULT_TARGETS.captureMs),
    codexDispatchMs: positiveMs(env.INCIDENT_SLO_CODEX_DISPATCH_MS, DEFAULT_TARGETS.codexDispatchMs),
    containmentMs: positiveMs(env.INCIDENT_SLO_CONTAINMENT_MS, DEFAULT_TARGETS.containmentMs),
    draftRepairMs: positiveMs(env.INCIDENT_SLO_DRAFT_REPAIR_MS, DEFAULT_TARGETS.draftRepairMs),
    maximumUnacknowledgedMs: positiveMs(
      env.INCIDENT_SLO_MAXIMUM_UNACKNOWLEDGED_MS,
      DEFAULT_TARGETS.maximumUnacknowledgedMs
    ),
  };
}

function timestamp(value) {
  const parsed = new Date(value || 0).getTime();
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function duration(start, end) {
  const from = timestamp(start);
  const to = timestamp(end);
  return from && to && to >= from ? to - from : null;
}

function assessIncidentSlo(incidents, { now = Date.now(), targets = incidentSloTargets() } = {}) {
  const rows = (Array.isArray(incidents) ? incidents : []).map((item) => {
    const detectedAt = item?.diagnostics?.firstDetectedAt || item?.detectedAt;
    const lastDetectedAt = item?.diagnostics?.lastDetectedAt || item?.detectedAt;
    const remediation = item?.remediation || {};
    const captureMs = duration(detectedAt, item?.createdAt || item?.detectedAt);
    const codexDispatchMs = duration(detectedAt, remediation.codexMemoPreservedAt);
    const containmentMs = duration(detectedAt, remediation.containmentReportPreservedAt);
    const draftRepairMs = duration(detectedAt, remediation.completedAt || remediation.updatedAt);
    const ageMs = Math.max(0, Number(now) - timestamp(lastDetectedAt));
    const terminal = ["resolved", "recovered", "repair_ready", "not_required"].includes(String(remediation.status || ""));
    const breaches = [];
    if (captureMs != null && captureMs > targets.captureMs) breaches.push("capture");
    if (remediation.codexFirst === true && codexDispatchMs != null && codexDispatchMs > targets.codexDispatchMs) breaches.push("codex_dispatch");
    if (remediation.containmentReportPreservedAt && containmentMs > targets.containmentMs) breaches.push("containment");
    if (["repair_ready", "resolved", "recovered"].includes(String(remediation.status || "")) && draftRepairMs > targets.draftRepairMs) breaches.push("draft_repair");
    if (!terminal && ageMs > targets.maximumUnacknowledgedMs) breaches.push("unacknowledged");
    return {
      incidentId: item?.id || "",
      severity: item?.severity || "warning",
      status: remediation.status || "needs_user",
      captureMs,
      codexDispatchMs,
      containmentMs,
      draftRepairMs,
      ageMs,
      breaches,
    };
  });
  const breached = rows.filter((row) => row.breaches.length > 0);
  return {
    ok: breached.length === 0,
    measuredAt: new Date(Number(now)).toISOString(),
    targets,
    activeIncidentCount: rows.length,
    breachedIncidentCount: breached.length,
    breached,
  };
}

module.exports = {
  DEFAULT_TARGETS,
  assessIncidentSlo,
  incidentSloTargets,
};
