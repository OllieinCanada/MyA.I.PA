const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createIncidentRemediationPlan, dispatchCodexIncidentRepair } = require("../server/incidentRemediation");
const { buildRuntimeIncident } = require("../server/runtimeAlerts");
const {
  listRuntimeIncidents,
  recordRuntimeIncident,
  updateRuntimeIncidentRemediation,
} = require("../server/runtimeIncidentStore");
const { enqueueTelegramMessage, processTelegramOutbox } = require("../server/telegramOutbox");

test("synthetic signup defect reaches a verified draft and Telegram without touching provider resources", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "myaipa-incident-e2e-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const incidentFile = path.join(directory, "incidents.json");
  const outboxFile = path.join(directory, "outbox.json");
  let providerResourceMutations = 0;
  let githubDispatches = 0;
  let telegramMessages = 0;

  const base = buildRuntimeIncident(Object.assign(new Error("Synthetic signup binding mismatch"), {
    code: "SIGNUP_RECOVERY_VAPI_BINDING_MISMATCH",
  }), {
    area: "customer signup",
    route: "/api/integrations/signup",
    method: "POST",
    whatFailed: "Synthetic signup stopped at the agent binding check",
    impact: "No real customer or provider resource is involved.",
    lastCheckpoint: "The synthetic request stopped before provider provisioning.",
    nextAction: "Draft and independently test a code-only repair.",
    dedupeFingerprint: "synthetic-signup-incident-pipeline",
  });
  const plan = createIncidentRemediationPlan(base, {
    codeRepairEnabled: true,
    codeRepairConfigured: true,
  });
  assert.equal(plan.action, "codex_draft_repair");
  assert.equal(plan.codexFirst, true);
  const incident = { ...base, remediation: plan };
  const recorded = recordRuntimeIncident(incidentFile, incident);
  assert.equal(recorded.recorded, true);
  updateRuntimeIncidentRemediation(incidentFile, incident.incidentId, {
    status: "repairing",
    codexMemoPreservedAt: new Date().toISOString(),
  });

  const dispatch = await dispatchCodexIncidentRepair({
    incident: { ...incident, priorIncidents: "No earlier verified repair exists." },
    generation: 1,
    token: "short-lived-test-installation-token",
    repository: "OllieinCanada/MyA.I.PA",
    dispatchSecret: "synthetic-dispatch-secret-that-is-at-least-32-characters",
    fetchImpl: async (_url, options) => {
      githubDispatches += 1;
      assert.equal(JSON.parse(options.body).ref, "main");
      return { status: 204 };
    },
  });
  assert.equal(dispatch.status, "repair_dispatched");
  updateRuntimeIncidentRemediation(incidentFile, incident.incidentId, dispatch);

  const headSha = "a".repeat(40);
  const repaired = updateRuntimeIncidentRemediation(incidentFile, incident.incidentId, {
    status: "repair_ready",
    diagnosis: "A deterministic binding comparison used inconsistent normalized identifiers.",
    verification: "A clean synthetic regression test passed without contacting Twilio, Vapi, Stripe, or Make.",
    pullRequest: {
      prNumber: 999,
      headSha,
      prUrl: "https://github.com/OllieinCanada/MyA.I.PA/pull/999",
    },
  });
  assert.equal(repaired.updated, true);
  assert.equal(repaired.item.knowledge.fixedCommit, headSha);

  const queued = await enqueueTelegramMessage({
    filePath: outboxFile,
    text: "✅ MY AI PA — GUARDED REPAIR READY\nSynthetic signup defect has a tested draft. No provider resource was created.",
    adminUrl: "https://github.com/OllieinCanada/MyA.I.PA/pull/999",
    buttonText: "Open PR",
    dedupeKey: `synthetic:${incident.incidentId}`,
  });
  assert.equal(queued.queued, true);
  const delivery = await processTelegramOutbox({
    filePath: outboxFile,
    token: "test-token",
    chatId: "123",
    fetchImpl: async () => {
      telegramMessages += 1;
      return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 77 } }) };
    },
  });
  assert.equal(delivery.sent, 1);
  assert.equal(githubDispatches, 1);
  assert.equal(telegramMessages, 1);
  assert.equal(providerResourceMutations, 0);
  assert.equal(listRuntimeIncidents(incidentFile)[0].remediation.status, "repair_ready");
});
