const assert = require("node:assert/strict");
const test = require("node:test");

process.env.NODE_ENV = "test";
process.env.SECURITY_STATE_FORCE_DATABASE = "true";

const {
  claimWebhookReplay,
  completeWebhookReplay,
  consumeRateLimit,
  storeDashboardLoginCode,
  verifyDashboardLoginCode,
} = require("../server/persistentSecurityState");

test("persistent rate limits create a window and atomically increment its count", async () => {
  const calls = [];
  let record = null;
  const client = {
    securityRateLimit: {
      findUnique: async () => record,
      upsert: async ({ create }) => {
        calls.push("upsert");
        record = create;
        return record;
      },
      update: async ({ data }) => {
        calls.push("update");
        record = { ...record, count: record.count + data.count.increment };
        return record;
      },
    },
  };

  const first = await consumeRateLimit({
    key: "security-rate:test:key",
    maxRequests: 1,
    windowMs: 60_000,
    now: 1_000,
    client,
  });
  const second = await consumeRateLimit({
    key: "security-rate:test:key",
    maxRequests: 1,
    windowMs: 60_000,
    now: 1_001,
    client,
  });

  assert.equal(first.allowed, true);
  assert.equal(second.allowed, false);
  assert.equal(second.count, 2);
  assert.deepEqual(calls, ["upsert", "update"]);
});

test("dashboard codes are stored hashed and a matching code is consumed once", async () => {
  const writes = [];
  const client = {
    customerDashboardLoginCode: {
      upsert: async (operation) => {
        writes.push(operation);
        return operation.create;
      },
      deleteMany: async (operation) => {
        if (operation.where?.codeHash === "b".repeat(64)) return { count: 1 };
        return { count: 0 };
      },
      updateMany: async () => ({ count: 0 }),
      findUnique: async () => null,
    },
  };

  await storeDashboardLoginCode({
    lookupHash: "a".repeat(32),
    codeHash: "b".repeat(64),
    expiresAt: 61_000,
    now: 1_000,
    client,
  });
  const verified = await verifyDashboardLoginCode({
    lookupHash: "a".repeat(32),
    codeHash: "b".repeat(64),
    maxAttempts: 5,
    now: 1_001,
    client,
  });

  assert.equal(writes.length, 1);
  assert.equal(writes[0].create.codeHash, "b".repeat(64));
  assert.equal(JSON.stringify(writes[0]).includes("123456"), false);
  assert.deepEqual(verified, { ok: true });
});

test("persistent webhook claims reject a completed duplicate and can complete an owned lease", async () => {
  const duplicateError = Object.assign(new Error("duplicate"), { code: "P2002" });
  const duplicateClient = {
    webhookReplayClaim: {
      deleteMany: async () => ({ count: 0 }),
      create: async () => {
        throw duplicateError;
      },
      updateMany: async () => ({ count: 0 }),
      findUnique: async () => ({ status: "COMPLETED" }),
    },
  };
  const duplicate = await claimWebhookReplay({
    key: "replay-key",
    provider: "stripe",
    eventIdHash: "event-hash",
    leaseMs: 60_000,
    retentionMs: 86_400_000,
    now: 1_000,
    client: duplicateClient,
  });
  assert.equal(duplicate.claimed, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.status, "completed");

  let completionWhere = null;
  const completed = await completeWebhookReplay({
    key: "replay-key",
    claimToken: "owned-token",
    retentionMs: 86_400_000,
    now: 2_000,
    client: {
      webhookReplayClaim: {
        updateMany: async ({ where }) => {
          completionWhere = where;
          return { count: 1 };
        },
      },
    },
  });
  assert.equal(completed, true);
  assert.deepEqual(completionWhere, {
    key: "replay-key",
    claimToken: "owned-token",
    status: "PROCESSING",
  });
});
