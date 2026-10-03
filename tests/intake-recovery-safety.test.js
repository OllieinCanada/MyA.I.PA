const test = require("node:test");
const assert = require("node:assert/strict");
const { recoveryFakeDatabase } = require("./helpers/recovery-fake-database");
const { saveRecoveryCopy } = require("../server/intakeRecoveryJournal");
const { deleteStagingDuplicate, compareRecoveryEnvironments, assessIntakeResources } = require("../server/intakeRecoverySafety");
const secret = "synthetic-recovery-test-secret-at-least-32";
const payload = { signupId: "qa-recovery-event", owner: { email: "qa@example.invalid" }, provisioning: { businessKey: "a".repeat(64) } };
const target = { environment: "staging", hookId: "staging-hook", scenarioId: "staging-scenario", productionHookId: "production-hook", productionScenarioId: "production-scenario" };
async function setup() {
  const { prisma, rows } = recoveryFakeDatabase();
  const identity = await saveRecoveryCopy({ prisma, secret, payload });
  const queue = new Map(["duplicate", "survivor"].map((id) => [id, { id, payload, processing: false }]));
  const calls = [];
  const adapter = {
    state: async () => ({ hookId: target.hookId, scenarioId: target.scenarioId, active: false, runningExecutions: 0 }),
    item: async (_, id) => queue.get(id) || null,
    deleteOne: async (_, id) => { calls.push(id); queue.delete(id); return { deleted: id }; },
  };
  return { prisma, rows, queue, calls, adapter, input: { prisma, secret, adapter, target, candidateId: "duplicate", survivorId: "survivor", expectedIdentity: identity, confirmation: "DELETE_STAGING_DUPLICATE:duplicate" } };
}
test("queue recovery deletes exactly one verified staging duplicate and keeps recovery evidence", async () => {
  const { input, queue, rows, calls } = await setup();
  const result = await deleteStagingDuplicate(input);
  assert.equal(result.verified, true); assert.equal(result.recoveryCopyRetained, true);
  assert.deepEqual(calls, ["duplicate"]); assert.equal(queue.size, 1); assert.ok(queue.has("survivor"));
  const audit = [...rows.values()].find((row) => row.kind === "queue-delete");
  assert.equal(audit.status, "verified"); assert.match(audit.queueDecisionHash, /^[a-f0-9]{64}$/);
});
test("production, missing survivor, changed business/payload, active or archived records cannot be deleted", async () => {
  for (const change of [
    ({ input }) => { input.target = { ...target, environment: "production" }; },
    ({ queue }) => queue.delete("survivor"),
    ({ queue }) => queue.set("duplicate", { id: "duplicate", processing: false, payload: { ...payload, owner: { email: "legitimate@example.invalid" } } }),
    ({ adapter }) => { adapter.state = async () => ({ ...target, active: true, runningExecutions: 0 }); },
    ({ prisma }) => { prisma.signupAttempt.findUnique = async () => ({ status: "archived" }); },
  ]) {
    const item = await setup(); change(item);
    await assert.rejects(deleteStagingDuplicate(item.input)); assert.equal(item.calls.length, 0);
  }
});
test("state changes during inspection stop deletion; partial/ambiguous deletes are not retried", async () => {
  const item = await setup(); let reads = 0;
  item.adapter.state = async () => ({ ...target, active: ++reads > 1, runningExecutions: 0 });
  await assert.rejects(deleteStagingDuplicate(item.input), { code: "QUEUE_PROCESSING_NOT_PAUSED" }); assert.equal(item.calls.length, 0);
  const partial = await setup();
  partial.adapter.deleteOne = async (_, id) => { partial.calls.push(id); partial.queue.delete(id); throw new Error("lost response"); };
  await assert.rejects(deleteStagingDuplicate(partial.input)); assert.equal(partial.calls.length, 1);
  assert.equal([...partial.rows.values()].find((row) => row.kind === "queue-delete").status, "uncertain");
  await assert.rejects(deleteStagingDuplicate(partial.input), { code: "QUEUE_RECOVERY_ALREADY_ATTEMPTED" });
  assert.equal(partial.calls.length, 1);
});
test("concurrent operators cannot delete each other's survivor", async () => {
  const item = await setup();
  const opposite = { ...item.input, candidateId: "survivor", survivorId: "duplicate", confirmation: "DELETE_STAGING_DUPLICATE:survivor" };
  const results = await Promise.allSettled([deleteStagingDuplicate(item.input), deleteStagingDuplicate(opposite)]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(item.calls.length, 1);
  assert.equal(item.queue.size, 1);
});
test("parity requires release, blueprint and settings; ignores only explicit scalar environment differences", () => {
  const production = { releaseCommit: "release-1", blueprint: { flow: [{ module: "http:ActionSendData", mapper: { url: "https://production.example.invalid" } }] }, settings: { sequential: false, confidential: true } };
  const staging = structuredClone(production); staging.blueprint.flow[0].mapper.url = "https://staging.example.invalid";
  assert.equal(compareRecoveryEnvironments({ staging, production }).pass, false);
  const differences = [{ path: "/blueprint/flow/0/mapper/url", staging: staging.blueprint.flow[0].mapper.url, production: production.blueprint.flow[0].mapper.url, reason: "Isolated staging backend destination" }];
  assert.equal(compareRecoveryEnvironments({ staging, production, differences }).pass, true);
  staging.settings.confidential = false;
  assert.deepEqual(compareRecoveryEnvironments({ staging, production, differences }).driftPaths, ["/settings/confidential"]);
  assert.throws(() => compareRecoveryEnvironments({ staging: {}, production }), { code: "PARITY_SNAPSHOTS_INCOMPLETE" });
  assert.throws(() => compareRecoveryEnvironments({ staging, production, differences: [{ path: "/releaseCommit", staging: "a", production: "b", reason: "Hide mismatch" }] }), { code: "PARITY_EXCEPTION_INVALID" });
});
function resourceFixture() {
  const businessKey = payload.provisioning.businessKey; const eventKey = "signup_" + "b".repeat(32);
  const expected = { businessKey, eventKey, billingCount: 1, chargeCount: 0, textPurposes: ["owner-test", "customer-copy-test", "setup-ready"] };
  const all = {
    crm: [{ id: "business-1" }], twilioNumber: [{ id: "number-1", number: "+19055550123", routesToVapi: true }],
    vapiAssistant: [{ id: "assistant-1" }], vapiPhone: [{ id: "phone-1", assistantId: "assistant-1", number: "+19055550123", businessId: "business-1" }],
    billing: [{ id: "subscription-1" }], charges: [], texts: expected.textPurposes.map((purpose) => ({ id: `sms-${purpose}`, purpose, eventKey, status: "delivered" })),
  };
  const evidence = Object.fromEntries(Object.entries(all).map(([kind, records]) => [kind, { complete: true, checkedAt: new Date().toISOString(), businessKey, records: records.map((item) => ({ ...item, businessKey })) }]));
  return { expected, evidence };
}
test("one CRM record is not enough: every provider inventory, binding, charge and delivered text is checked", () => {
  const fixture = resourceFixture(); assert.equal(assessIntakeResources(fixture).pass, true);
  for (const mutate of [
    (f) => f.evidence.vapiAssistant.records.push({ id: "duplicate", businessKey: f.expected.businessKey }),
    (f) => f.evidence.charges.records.push({ id: "unexpected-charge", businessKey: f.expected.businessKey }),
    (f) => { f.evidence.billing.complete = false; },
    (f) => { f.evidence.vapiPhone.records[0].assistantId = "wrong-assistant"; },
    (f) => { f.evidence.texts.records[0].status = "sent"; },
    (f) => { f.evidence.texts.records = []; },
    (f) => { f.evidence.twilioNumber.checkedAt = "2000-01-01"; },
  ]) { const f = resourceFixture(); mutate(f); assert.equal(assessIntakeResources(f).pass, false); }
});
module.exports = { resourceFixture };
