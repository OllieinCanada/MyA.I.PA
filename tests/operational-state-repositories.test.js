const assert = require("node:assert/strict");
const test = require("node:test");

const { buildRuntimeIncident } = require("../server/runtimeAlerts");
const {
  acknowledgeRuntimeIncidentDb,
  listRuntimeIncidentsDb,
  recordRuntimeIncidentDb,
  updateRuntimeIncidentRemediationDb,
} = require("../server/runtimeIncidentRepository");
const {
  enqueueTelegramMessageDb,
  getTelegramDeliveryReceiptDb,
  processTelegramOutboxDb,
} = require("../server/telegramOutboxRepository");

function operationalPrismaMock() {
  const incidents = new Map();
  const messages = new Map();
  const runtimeIncidentRecord = {
    findUnique: async ({ where }) => incidents.get(where.id) || null,
    upsert: async ({ where, update, create }) => {
      const row = incidents.has(where.id) ? { ...incidents.get(where.id), ...update } : { ...create };
      incidents.set(where.id, structuredClone(row));
      return row;
    },
    update: async ({ where, data }) => {
      const row = { ...incidents.get(where.id), ...structuredClone(data) };
      incidents.set(where.id, row);
      return row;
    },
    findMany: async ({ where = {}, skip = 0, take = 100, select } = {}) => {
      let rows = [...incidents.values()];
      if (where.lastDetectedAt?.gte) rows = rows.filter((row) => row.lastDetectedAt >= where.lastDetectedAt.gte);
      rows.sort((a, b) => b.lastDetectedAt - a.lastDetectedAt);
      rows = rows.slice(skip, skip + take);
      return select ? rows.map((row) => ({ id: row.id })) : rows;
    },
    deleteMany: async ({ where }) => {
      let count = 0;
      for (const [id, row] of incidents) {
        const matchesId = where.id?.in ? where.id.in.includes(id) : where.id ? id === where.id : true;
        const matchesAge = where.lastDetectedAt?.lt ? row.lastDetectedAt < where.lastDetectedAt.lt : true;
        if (matchesId && matchesAge) { incidents.delete(id); count += 1; }
      }
      return { count };
    },
  };
  const telegramOutboxMessage = {
    findUnique: async ({ where }) => [...messages.values()].find((row) => (
      (where.id && row.id === where.id) || (where.dedupeHash && row.dedupeHash === where.dedupeHash)
    )) || null,
    findFirst: async ({ where }) => [...messages.values()].find((row) => row.id === where.id && row.status === where.status) || null,
    count: async ({ where }) => [...messages.values()].filter((row) => where.status.in.includes(row.status)).length,
    create: async ({ data }) => {
      const row = { attempts: 0, status: "PENDING", createdAt: new Date(), updatedAt: new Date(), ...data };
      messages.set(row.id, row);
      return row;
    },
    findMany: async ({ where = {}, orderBy, take = 100, skip = 0, select } = {}) => {
      let rows = [...messages.values()];
      if (where.OR) rows = rows.filter((row) => (
        (["PENDING", "RETRY"].includes(row.status) && row.nextAttemptAt <= where.OR[0].nextAttemptAt.lte)
        || (row.status === "PROCESSING" && row.leaseExpiresAt <= where.OR[1].leaseExpiresAt.lte)
      ));
      if (where.status === "DELIVERED") rows = rows.filter((row) => row.status === "DELIVERED");
      rows.sort((a, b) => orderBy?.deliveredAt === "desc" ? b.deliveredAt - a.deliveredAt : a.createdAt - b.createdAt);
      rows = rows.slice(skip, skip + take);
      return select ? rows.map((row) => ({ id: row.id })) : rows;
    },
    updateMany: async ({ where, data }) => {
      const row = messages.get(where.id);
      if (!row) return { count: 0 };
      if (where.claimToken && row.claimToken !== where.claimToken) return { count: 0 };
      if (where.status && typeof where.status === "string" && row.status !== where.status) return { count: 0 };
      messages.set(where.id, { ...row, ...data, updatedAt: new Date() });
      return { count: 1 };
    },
    deleteMany: async ({ where }) => {
      let count = 0;
      for (const id of where.id.in) if (messages.delete(id)) count += 1;
      return { count };
    },
  };
  const prisma = {
    runtimeIncidentRecord,
    telegramOutboxMessage,
    $transaction: async (callback) => callback({ runtimeIncidentRecord }),
  };
  return { prisma, incidents, messages };
}

test("runtime incidents survive through the Postgres repository lifecycle", async () => {
  const { prisma } = operationalPrismaMock();
  const incident = buildRuntimeIncident(Object.assign(new Error("Synthetic query defect"), {
    code: "DATABASE_QUERY_IMPLEMENTATION_FAILED",
  }), {
    whatFailed: "Synthetic query stopped",
    impact: "No customer resource changed.",
    dedupeFingerprint: "repository-lifecycle-test",
    remediation: { action: "codex_draft_repair", automatic: true, codexFirst: true, status: "queued" },
  });
  incident.remediation = { action: "codex_draft_repair", automatic: true, codexFirst: true, status: "queued" };
  assert.equal((await recordRuntimeIncidentDb(prisma, incident)).recorded, true);
  assert.equal((await listRuntimeIncidentsDb(prisma)).length, 1);
  const updated = await updateRuntimeIncidentRemediationDb(prisma, incident.incidentId, {
    status: "repair_ready",
    diagnosis: "The query used the wrong normalized key.",
    verification: "The repository regression test passed.",
    pullRequest: { prNumber: 123, headSha: "a".repeat(40), prUrl: "https://github.com/OllieinCanada/MyA.I.PA/pull/123" },
  });
  assert.equal(updated.item.knowledge.fixedCommit, "a".repeat(40));
  assert.equal((await acknowledgeRuntimeIncidentDb(prisma, incident.incidentId)).acknowledged, true);
  assert.equal((await listRuntimeIncidentsDb(prisma)).length, 0);
});

test("Telegram Postgres outbox deduplicates and saves a provider-backed receipt", async () => {
  const { prisma } = operationalPrismaMock();
  const input = {
    text: "A redacted operational update.",
    adminUrl: "https://www.myaipa.ca/#/admin?tab=attention&incident=abcdef1234567890abcdef12",
    buttonText: "Open incident",
    dedupeKey: "postgres-outbox-test",
    now: 1000,
  };
  const first = await enqueueTelegramMessageDb(prisma, input);
  assert.equal(first.queued, true);
  assert.equal((await enqueueTelegramMessageDb(prisma, input)).duplicate, true);
  const result = await processTelegramOutboxDb(prisma, {
    token: "test-token",
    chatId: "123",
    now: 2000,
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 44 } }) }),
  });
  assert.equal(result.sent, 1);
  const receipt = await getTelegramDeliveryReceiptDb(prisma, first.id);
  assert.equal(receipt.providerMessageId, 44);
});
