const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { recoveryFakeDatabase } = require("./helpers/recovery-fake-database");
const { saveRecoveryCopy, readRecoveryCopy, recordRecoveryOperation, recoveryIdentity, journalKey, RETENTION_MS } = require("../server/intakeRecoveryJournal");
const secret = "synthetic-recovery-test-secret-at-least-32";
const payload = () => ({ signupId: "qa-recovery-event", owner: { email: "qa@example.invalid" }, provisioning: { businessKey: "a".repeat(64) } });

test("concurrent copies are immutable, encrypted, and recoverable without extending expiry", async () => {
  const { prisma, rows } = recoveryFakeDatabase();
  const now = Date.now();
  const input = { prisma, payload: payload(), secret, now };
  const identities = await Promise.all([saveRecoveryCopy(input), saveRecoveryCopy({ ...input, payload: { ...payload(), submittedAt: "later" }, now: now + 1000 })]);
  assert.deepEqual(identities[0], identities[1]);
  assert.equal(rows.size, 1);
  assert.doesNotMatch(JSON.stringify([...rows.values()]), /qa@example/);
  assert.deepEqual((await readRecoveryCopy({ prisma, secret, eventKey: identities[0].eventKey })).payload, payload());
  assert.equal(Date.parse(rows.get(journalKey(identities[0].eventKey)).expiresAt), now + RETENTION_MS);
});
test("same event with changed business or payload fails closed", async () => {
  const { prisma } = recoveryFakeDatabase();
  await saveRecoveryCopy({ prisma, secret, payload: payload() });
  await assert.rejects(saveRecoveryCopy({ prisma, secret, payload: { ...payload(), owner: { email: "different@example.invalid" } } }), { code: "INTAKE_EVENT_PAYLOAD_CONFLICT" });
  await assert.rejects(saveRecoveryCopy({ prisma, secret, payload: { ...payload(), provisioning: { businessKey: "b".repeat(64) } } }), { code: "INTAKE_EVENT_PAYLOAD_CONFLICT" });
});
test("expired or tampered recovery copies cannot authorize replay/deletion", async () => {
  const { prisma, rows } = recoveryFakeDatabase();
  const identity = await saveRecoveryCopy({ prisma, secret, payload: payload(), now: 1000 });
  await assert.rejects(readRecoveryCopy({ prisma, secret, eventKey: identity.eventKey }), { code: "INTAKE_RECOVERY_COPY_EXPIRED" });
  await assert.rejects(saveRecoveryCopy({ prisma, secret, payload: payload() }), { code: "INTAKE_RECOVERY_COPY_EXPIRED" });
  const row = rows.get(journalKey(identity.eventKey)); row.expiresAt = new Date(Date.now() + 60000).toISOString(); row.sealed.bytes = "bad";
  await assert.rejects(readRecoveryCopy({ prisma, secret, eventKey: identity.eventKey }), { code: "INTAKE_RECOVERY_COPY_UNREADABLE" });
});
test("storage failure stops recovery; audit outcomes cannot be rewritten", async () => {
  await assert.rejects(saveRecoveryCopy({ prisma: {}, secret, payload: payload() }), { code: "INTAKE_DURABLE_STORE_REQUIRED" });
  const { prisma } = recoveryFakeDatabase();
  const identity = recoveryIdentity(payload()); const operationId = crypto.randomUUID();
  await recordRecoveryOperation({ prisma, identity, operationId, kind: "handoff", status: "started" });
  await recordRecoveryOperation({ prisma, identity, operationId, kind: "handoff", status: "uncertain" });
  await assert.rejects(recordRecoveryOperation({ prisma, identity, operationId, kind: "handoff", status: "verified" }), { code: "INTAKE_AUDIT_STATE_CONFLICT" });
});
test("live handoff saves recovery copy and start evidence before sending to Make", () => {
  const source = fs.readFileSync(path.join(__dirname, "../server/index.js"), "utf8");
  const handoff = source.slice(source.indexOf("async function sendMakeSignupCompleted"), source.indexOf("function requireAdmin"));
  assert.ok(handoff.indexOf("await saveRecoveryCopy") < handoff.indexOf("await fetch(safeUrl"));
  assert.ok(handoff.indexOf('status: "started"') < handoff.indexOf("await fetch(safeUrl"));
  assert.match(handoff, /status: response.ok \? "accepted" : "uncertain"/);
});
