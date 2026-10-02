const test = require("node:test");
const assert = require("node:assert/strict");
const { signupBusinessKey } = require("../server/signupBusinessIdentity");
const { ensureSignupBusinessBindings, closeSignupBusinessIdentity, upsertOwnedProviderMapping } = require("../server/signupBusinessRegistry");
const { normalizeSignupProvisioningPayload, verifySignupProvisioningAuthorization } = require("../server/signupProvisioning");
const { runProvisioningStep } = require("../server/provisioningState");

const owner = { ownerEmail: "owner@example.test", ownerPhone: "+19055550111" };
const signup = (name = "North Electric", attempt = "one") => ({ ...owner, businessName: name, signupAttemptId: attempt });
const mappings = (suffix) => [ { matchType: "phoneNumber", matchValue: `+128955501${suffix}` }, { matchType: "assistantId", matchValue: `assistant-${suffix}` } ];

// Models transaction serialization AND rollback, rather than a mock that
// allows the very race the production advisory lock is intended to prevent.
function database() {
  let state = { businesses: [], mappings: [], rows: new Map(), settings: [] };
  let tail = Promise.resolve();
  const tx = {
    $queryRaw: async () => [{ lock_result: "" }],
    runtimeStore: {
      findUnique: async ({ where }) => state.rows.has(where.key) ? structuredClone(state.rows.get(where.key)) : null,
      upsert: async ({ where, create, update }) => {
        const row = { ...(state.rows.get(where.key) || create), ...(state.rows.has(where.key) ? update : {}) };
        state.rows.set(where.key, structuredClone(row)); return row;
      },
    },
    business: {
      findUnique: async ({ where }) => state.businesses.find((item) => item.id === where.id) || null,
      create: async ({ data }) => { const row = { ...data, id: state.businesses.length + 1 }; state.businesses.push(row); return row; },
    },
    settings: { upsert: async ({ create, update, where }) => {
      const row = state.settings.find((item) => item.businessId === where.businessId);
      if (row) Object.assign(row, update); else state.settings.push(create);
    } },
    vapiBusinessMapping: {
      findUnique: async ({ where }) => state.mappings.find((item) => item.matchValue === where.matchValue) || null,
      findMany: async ({ where }) => state.mappings.filter((item) => where.matchValue.in.includes(item.matchValue)),
      upsert: async ({ where, create, update }) => {
        const row = state.mappings.find((item) => item.matchValue === where.matchValue);
        if (row) Object.assign(row, update); else state.mappings.push(create);
      },
    },
  };
  const prisma = { ...tx, $transaction: (callback) => {
    const next = tail.then(async () => {
      const before = structuredClone(state);
      try { return await callback(tx); } catch (error) { state = before; throw error; }
    });
    tail = next.catch(() => {}); return next;
  } };
  return { prisma, state: () => state };
}

const bind = (db, identity, resources) => ensureSignupBusinessBindings({ prisma: db.prisma, signup: identity, mappings: resources, fallbackPhone: owner.ownerPhone, ownerPhone: owner.ownerPhone });

test("business identity is stable across submissions, distinct for shared-owner businesses and cannot be client spoofed", () => {
  assert.equal(signupBusinessKey(signup()), signupBusinessKey(signup("  NORTH  Electric ", "two")));
  assert.notEqual(signupBusinessKey(signup()), signupBusinessKey(signup("South Plumbing")));
  const input = { business: { name: "North Electric" }, owner: { email: owner.ownerEmail, phone: owner.ownerPhone }, provisioning: { businessKey: "forged" } };
  const normalized = normalizeSignupProvisioningPayload(input, { signingSecret: "test-only-provisioning-secret" });
  assert.equal(normalized.provisioning.businessKey, signupBusinessKey(signup()));
  assert.equal(verifySignupProvisioningAuthorization(normalized, "test-only-provisioning-secret"), true);
  assert.equal(verifySignupProvisioningAuthorization({ ...normalized, provisioning: { ...normalized.provisioning, businessKey: "forged" } }, "test-only-provisioning-secret"), false);
});

test("double submissions and simultaneous retries update one business setup", async () => {
  const db = database();
  const results = await Promise.all([bind(db, signup(), mappings("11")), bind(db, signup("North Electric", "two"), mappings("11"))]);
  assert.equal(results[0].id, results[1].id);
  assert.equal(db.state().businesses.length, 1);
  assert.equal(db.state().mappings.length, 2);
  const updated = await bind(db, signup(), mappings("12"));
  assert.equal(updated.id, results[0].id);
  assert.equal(db.state().businesses.length, 1);
});

test("multiple businesses sharing one owner receive separate IDs and resources", async () => {
  const db = database();
  const [north, south] = await Promise.all([bind(db, signup(), mappings("11")), bind(db, signup("South Plumbing"), mappings("12"))]);
  assert.notEqual(north.id, south.id);
  assert.equal(db.state().mappings.length, 4);
});

test("different businesses racing for one phone or assistant cannot share ownership", async () => {
  for (const sharedType of ["phoneNumber", "assistantId"]) {
    const db = database();
    const second = mappings("12").map((item) => item.matchType === sharedType ? mappings("11").find((a) => a.matchType === sharedType) : item);
    const results = await Promise.allSettled([bind(db, signup(), mappings("11")), bind(db, signup("South Plumbing"), second)]);
    assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
    assert.equal(results.find((item) => item.status === "rejected").reason.code, "AGENT_MAPPING_OWNERSHIP_CONFLICT");
    assert.equal(db.state().businesses.length, 1);
  }
});

test("reconciliation is inside the provisioning lease, so concurrent requests create once", async () => {
  const db = database();
  let release; const wait = new Promise((resolve) => { release = resolve; });
  let entered; const started = new Promise((resolve) => { entered = resolve; });
  let creates = 0;
  const args = { prisma: db.prisma, kind: "vapi-assistant", idempotencyKey: signupBusinessKey(signup()), contextHash: "same-context", verifyCompleted: async () => true,
    reconcile: async () => { creates++; entered(); await wait; return { assistantId: "only-one" }; }, execute: async () => { throw new Error("must not execute twice"); } };
  const first = runProvisioningStep(args);
  await started;
  await assert.rejects(runProvisioningStep(args), { code: "PROVISIONING_ALREADY_IN_PROGRESS" });
  release(); await first;
  assert.equal((await runProvisioningStep(args)).assistantId, "only-one");
  assert.equal(creates, 1);
});

test("archived records and registry tombstones cannot be rebound", async () => {
  const db = database();
  await assert.rejects(bind(db, { ...signup(), status: "abandoned_archived" }, mappings("11")), { code: "SIGNUP_CLOSED" });
  await closeSignupBusinessIdentity({ prisma: db.prisma, signup: signup() });
  await assert.rejects(bind(db, signup(), mappings("11")), { code: "SIGNUP_CLOSED" });
  assert.equal(db.state().businesses.length, 0);
});

test("admin and legacy mapping writers cannot bypass tenant ownership", async () => {
  const db = database();
  const first = await bind(db, signup(), mappings("11"));
  const second = await bind(db, signup("South Plumbing"), mappings("12"));
  await assert.rejects(upsertOwnedProviderMapping({ prisma: db.prisma, businessId: second.id, ...mappings("11")[0] }), { code: "AGENT_MAPPING_OWNERSHIP_CONFLICT" });
  assert.equal(db.state().mappings.find((item) => item.matchValue === mappings("11")[0].matchValue).businessId, first.id);
});
