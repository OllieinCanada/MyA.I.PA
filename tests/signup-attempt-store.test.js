const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createSignupAttemptStore,
  customerStatus,
  deriveSignupStatusAccess,
} = require("../server/signupAttemptStore");

const SECRET = "pilot-status-secret-that-is-long-enough";

function prismaMock() {
  const rows = new Map();
  return {
    rows,
    signupAttempt: {
      findUnique: async ({ where }) => [...rows.values()].find((row) => (
        (where.eventKey && row.eventKey === where.eventKey)
        || (where.publicId && row.publicId === where.publicId)
      )) || null,
      upsert: async ({ where, create, update }) => {
        const current = rows.get(where.eventKey);
        const row = { ...(current || create), ...(current ? update : {}), id: current?.id || "attempt-row", updatedAt: new Date() };
        rows.set(where.eventKey, row);
        return row;
      },
      update: async ({ where, data }) => {
        const current = where.eventKey
          ? rows.get(where.eventKey)
          : [...rows.values()].find((row) => row.id === where.id);
        const row = { ...current, ...data, updatedAt: new Date() };
        rows.set(row.eventKey, row);
        return row;
      },
    },
  };
}

test("status access is deterministic without exposing the signing secret", () => {
  const eventKey = `signup_${"a".repeat(32)}`;
  const first = deriveSignupStatusAccess(eventKey, SECRET);
  const second = deriveSignupStatusAccess(eventKey, SECRET);
  assert.deepEqual(first, second);
  assert.match(first.publicId, /^attempt_[a-f0-9]{20}$/);
  assert.doesNotMatch(first.token, /pilot-status-secret/);
});

test("a duplicate signup reuses one attempt and one access token", async () => {
  const prisma = prismaMock();
  const store = createSignupAttemptStore({ prisma, secret: SECRET });
  const eventKey = `signup_${"b".repeat(32)}`;
  const first = await store.register({ eventKey, payload: { one: true }, businessName: "Pilot Electric", ownerEmail: "Owner@Example.com" });
  const retry = await store.register({ eventKey, payload: { two: true }, businessName: "Pilot Electric", ownerEmail: "owner@example.com" });
  assert.equal(prisma.rows.size, 1);
  assert.deepEqual(first.access, retry.access);
  assert.equal((await store.authenticate(first.access.id, first.access.token)).eventKey, eventKey);
  assert.equal(await store.authenticate(first.access.id, "wrong-token"), null);
});

test("customer status explains review, failure, and completion without internal errors", () => {
  assert.equal(customerStatus({ status: "review_required", reviewRequired: true }).state, "final_checks");
  assert.match(customerStatus({ status: "setup_error", lastErrorCode: "PRIVATE_PROVIDER_DETAIL" }).message, /do not submit/i);
  const ready = customerStatus({ status: "setup_ready", assignedPhone: "+12895550123" });
  assert.equal(ready.state, "ready");
  assert.equal(ready.assignedPhone, "+12895550123");
});

test("expired signup status access is rejected", async () => {
  const prisma = prismaMock();
  const store = createSignupAttemptStore({ prisma, secret: SECRET });
  const eventKey = `signup_${"c".repeat(32)}`;
  const registered = await store.register({ eventKey, payload: {}, businessName: "Example" });
  prisma.rows.get(eventKey).expiresAt = new Date(Date.now() - 1_000);

  assert.equal(await store.authenticate(registered.access.id, registered.access.token), null);
});

test("duplicate submissions preserve progress, review policy, support, payload, and expiry", async () => {
  const prisma = prismaMock();
  const store = createSignupAttemptStore({ prisma, secret: SECRET });
  const eventKey = `signup_${"d".repeat(32)}`;
  const first = await store.register({ eventKey, payload: { original: true }, reviewRequired: true });
  await store.update(eventKey, { status: "provisioning", stage: "text_tests", reviewRequired: false });
  await store.requestSupport(first.record, "Please help me understand the next step.");
  const before = { ...prisma.rows.get(eventKey) };
  const retry = await store.register({ eventKey, payload: { replacement: true }, reviewRequired: true });
  assert.equal(retry.record.status, "provisioning");
  assert.equal(retry.record.stage, "text_tests");
  assert.equal(retry.record.reviewRequired, false);
  assert.deepEqual(retry.record.payload, { original: true });
  assert.deepEqual(retry.record.expiresAt, before.expiresAt);
  assert.deepEqual(retry.record.supportRequestedAt, before.supportRequestedAt);
  assert.deepEqual(retry.access, first.access);
});

test("invalid or missing expiry fails closed", async () => {
  const prisma = prismaMock();
  const store = createSignupAttemptStore({ prisma, secret: SECRET });
  const eventKey = `signup_${"e".repeat(32)}`;
  const registered = await store.register({ eventKey });
  for (const expiry of [undefined, null, "invalid-date"]) {
    prisma.rows.get(eventKey).expiresAt = expiry;
    assert.equal(await store.authenticate(registered.access.id, registered.access.token), null);
  }
});

test("numbers are not disclosed before readiness and superseded attempts are closed", () => {
  for (const status of ["provisioning", "setup_error", "review_required", "verification_pending", "superseded_duplicate"]) {
    assert.equal(customerStatus({ status, assignedPhone: "+12895550123" }).assignedPhone, "", status);
  }
  const closed = customerStatus({ status: "superseded_duplicate" });
  assert.equal(closed.state, "closed");
  assert.equal(closed.terminal, true);
  const held = customerStatus({ status: "setup_ready", reviewRequired: true, assignedPhone: "+12895550123" });
  assert.equal(held.state, "final_checks");
  assert.equal(held.assignedPhone, "");
});

test("support is scoped to the authenticated attempt and rejects empty descriptions", async () => {
  const prisma = prismaMock();
  const store = createSignupAttemptStore({ prisma, secret: SECRET });
  const first = await store.register({ eventKey: `signup_${"1".repeat(32)}` });
  const second = await store.register({ eventKey: `signup_${"2".repeat(32)}` });
  // Distinct database IDs reflect the real schema's unique row identities.
  prisma.rows.get(second.record.eventKey).id = "second-row";
  assert.equal(await store.authenticate(second.access.id, first.access.token), null);
  await assert.rejects(store.requestSupport(first.record, "short"), /Briefly describe/);
  const updated = await store.requestSupport(first.record, `Please\nhelp ${"x".repeat(1300)}`);
  assert.equal(updated.supportDescription.length, 1200);
  assert.doesNotMatch(updated.supportDescription, /\n/);
  assert.equal(prisma.rows.get(second.record.eventKey).supportDescription, undefined);
});
