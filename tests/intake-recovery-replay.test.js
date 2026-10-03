const test = require("node:test");
const assert = require("node:assert/strict");
const { recoveryFakeDatabase } = require("./helpers/recovery-fake-database");
const { saveRecoveryCopy } = require("../server/intakeRecoveryJournal");
const { runProvisioningStep } = require("../server/provisioningState");

test("sequential and simultaneous duplicate intake deliveries create one of every intended side effect", async () => {
  const { prisma } = recoveryFakeDatabase();
  const provider = new Map(); const counts = {};
  const kinds = ["crm", "twilio-number", "vapi-assistant", "vapi-import", "billing", "owner-test-text", "customer-test-text", "setup-ready-text"];
  const payload = { signupId: "qa-repeat", provisioning: { businessKey: "a".repeat(64) } };
  async function deliver() {
    await saveRecoveryCopy({ prisma, payload, secret: "synthetic-drill-secret-at-least-32" });
    for (const kind of kinds) await runProvisioningStep({ prisma, kind, idempotencyKey: payload.provisioning.businessKey, contextHash: "same-context",
      verifyCompleted: async (saved) => provider.get(kind)?.id === saved.id,
      reconcile: async () => provider.get(kind) || null,
      execute: async () => { counts[kind] = (counts[kind] || 0) + 1; const value = { id: `${kind}-one` }; provider.set(kind, value); return value; } });
  }
  // Cold simultaneous requests hit the actual provisioning lease. One may be
  // told "in progress"; safely replay it after the first execution completes.
  const race = await Promise.allSettled([deliver(), deliver()]);
  assert.ok(race.some((item) => item.status === "fulfilled"));
  for (const item of race.filter((item) => item.status === "rejected")) assert.equal(item.reason.code, "PROVISIONING_ALREADY_IN_PROGRESS");
  await deliver(); await deliver();
  assert.deepEqual(counts, Object.fromEntries(kinds.map((kind) => [kind, 1])));
});
test("interrupted paid setup reconciles an existing provider resource without creating it again", async () => {
  const { prisma } = recoveryFakeDatabase(); let existing; let creates = 0;
  const input = { prisma, kind: "vapi-assistant", idempotencyKey: "a".repeat(64), contextHash: "same-context",
    reconcile: async () => existing || null, verifyCompleted: async () => true,
    execute: async () => { creates++; existing = { id: "already-created" }; throw new Error("lost provider response"); } };
  await assert.rejects(runProvisioningStep(input));
  assert.equal((await runProvisioningStep(input)).id, "already-created"); assert.equal(creates, 1);
});
