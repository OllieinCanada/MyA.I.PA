const {
  applyRuntimeIncidentTransition,
  createAttentionItem,
} = require("./runtimeIncidentStore");

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_INCIDENTS = 100;

function validId(value) {
  return /^[a-f0-9]{24}$/i.test(String(value || "")) ? String(value).toLowerCase() : "";
}

function recordData(item) {
  return {
    fingerprint: String(item?.knowledge?.fingerprint || item?.id || "").slice(0, 80),
    severity: String(item?.severity || "warning").slice(0, 20),
    reasonCode: String(item?.incident?.reasonCode || "RUNTIME_FAILURE").slice(0, 80),
    remediation: String(item?.remediation?.status || "needs_user").slice(0, 40),
    generation: Math.max(1, Number(item?.remediation?.generation || 1)),
    recurrenceCount: Math.max(1, Number(item?.diagnostics?.occurrences || 1)),
    firstDetectedAt: new Date(item?.diagnostics?.firstDetectedAt || item?.detectedAt || Date.now()),
    lastDetectedAt: new Date(item?.diagnostics?.lastDetectedAt || item?.detectedAt || Date.now()),
    payload: item,
  };
}

async function recordRuntimeIncidentDb(prismaClient, incident) {
  const id = validId(incident?.incidentId);
  if (!id) return { recorded: false, reason: "invalid_incident_id" };
  try {
    const item = await prismaClient.$transaction(async (tx) => {
      const previousRow = await tx.runtimeIncidentRecord.findUnique({ where: { id } });
      const next = createAttentionItem(incident, previousRow?.payload || null);
      if (!next) throw Object.assign(new Error("Invalid incident"), { code: "INVALID_INCIDENT" });
      await tx.runtimeIncidentRecord.upsert({
        where: { id },
        update: recordData(next),
        create: { id, ...recordData(next) },
      });
      return next;
    }, { isolationLevel: "Serializable" });
    const stale = await prismaClient.runtimeIncidentRecord.findMany({
      orderBy: { lastDetectedAt: "desc" },
      skip: MAX_INCIDENTS,
      select: { id: true },
    });
    if (stale.length) await prismaClient.runtimeIncidentRecord.deleteMany({ where: { id: { in: stale.map((row) => row.id) } } });
    return { recorded: true, item };
  } catch (_error) {
    return { recorded: false, reason: "runtime_incident_store_failed" };
  }
}

async function listRuntimeIncidentsDb(prismaClient, { now = new Date(), ttlMs = DEFAULT_TTL_MS } = {}) {
  const current = now instanceof Date ? now : new Date(now);
  const cutoff = new Date(current.getTime() - Number(ttlMs || DEFAULT_TTL_MS));
  await prismaClient.runtimeIncidentRecord.deleteMany({ where: { lastDetectedAt: { lt: cutoff } } });
  const rows = await prismaClient.runtimeIncidentRecord.findMany({
    where: { lastDetectedAt: { gte: cutoff } },
    orderBy: { lastDetectedAt: "desc" },
    take: MAX_INCIDENTS,
  });
  return rows.map((row) => ({
    ...row.payload,
    ageMinutes: Math.max(0, Math.floor((current.getTime() - new Date(row.payload?.detectedAt || row.lastDetectedAt).getTime()) / 60_000)),
  }));
}

async function acknowledgeRuntimeIncidentDb(prismaClient, incidentId) {
  const id = validId(incidentId);
  if (!id) return { acknowledged: false, reason: "invalid_incident_id" };
  const deleted = await prismaClient.runtimeIncidentRecord.deleteMany({ where: { id } });
  return deleted.count === 1 ? { acknowledged: true, id } : { acknowledged: false, reason: "not_found" };
}

async function updateRuntimeIncidentRemediationDb(prismaClient, incidentId, transition = {}) {
  const id = validId(incidentId);
  if (!id) return { updated: false, reason: "invalid_incident_id" };
  try {
    return await prismaClient.$transaction(async (tx) => {
      const row = await tx.runtimeIncidentRecord.findUnique({ where: { id } });
      if (!row) return { updated: false, reason: "not_found" };
      const applied = applyRuntimeIncidentTransition(row.payload, transition);
      if (!applied.updated) return applied;
      await tx.runtimeIncidentRecord.update({ where: { id }, data: recordData(applied.item) });
      return applied;
    }, { isolationLevel: "Serializable" });
  } catch (_error) {
    return { updated: false, reason: "runtime_incident_store_failed" };
  }
}

module.exports = {
  acknowledgeRuntimeIncidentDb,
  listRuntimeIncidentsDb,
  recordRuntimeIncidentDb,
  updateRuntimeIncidentRemediationDb,
};
