const assert = require("node:assert/strict");
const test = require("node:test");

const {
  completeSignupProvisioningContext,
  loadSignupProvisioningContext,
  registerSignupProvisioningContext,
} = require("../server/signupProvisioningContext");

function fakePrisma() {
  const rows = new Map();
  const runtimeStore = {
    async findUnique({ where }) { return rows.has(where.key) ? { key: where.key, data: rows.get(where.key) } : null; },
    async upsert({ where, update, create }) {
      const data = rows.has(where.key) ? update.data : create.data;
      rows.set(where.key, data);
      return { key: where.key, data };
    },
  };
  return { runtimeStore, async $transaction(callback) { return callback({ runtimeStore }); } };
}

function payload(fill, hash) {
  return {
    business: { name: fill },
    provisioning: { idempotencyKey: "a".repeat(64), contextHash: hash.repeat(64) },
  };
}

test("the newest retry can replace an unlocked signup context", async () => {
  const prisma = fakePrisma();
  await registerSignupProvisioningContext({ prisma, payload: payload("first", "1") });
  const latest = await registerSignupProvisioningContext({ prisma, payload: payload("latest", "2") });
  assert.equal(latest.business.name, "latest");
  assert.equal((await loadSignupProvisioningContext({
    prisma,
    idempotencyKey: "a".repeat(64),
    contextHash: "2".repeat(64),
  })).business.name, "latest");
});

test("a paid-stage lock forces later retries to reuse the canonical context", async () => {
  const prisma = fakePrisma();
  const first = payload("first", "1");
  await registerSignupProvisioningContext({ prisma, payload: first });
  await loadSignupProvisioningContext({
    prisma,
    idempotencyKey: "a".repeat(64),
    contextHash: "1".repeat(64),
  });
  const retry = await registerSignupProvisioningContext({ prisma, payload: payload("retry", "2") });
  assert.equal(retry.business.name, "first");
  assert.equal(retry.provisioning.contextHash, "1".repeat(64));
});

test("unregistered and mismatched contexts fail closed", async () => {
  const prisma = fakePrisma();
  await assert.rejects(loadSignupProvisioningContext({
    prisma,
    idempotencyKey: "a".repeat(64),
    contextHash: "1".repeat(64),
  }), (error) => error.code === "PROVISIONING_CONTEXT_NOT_REGISTERED" && error.statusCode === 401);
});

test("completion is stored against the exact locked context", async () => {
  const prisma = fakePrisma();
  await registerSignupProvisioningContext({ prisma, payload: payload("first", "1") });
  const result = await completeSignupProvisioningContext({
    prisma,
    idempotencyKey: "a".repeat(64),
    contextHash: "1".repeat(64),
    result: { phoneNumberId: "phone-1" },
  });
  assert.equal(result.phoneNumberId, "phone-1");
});
