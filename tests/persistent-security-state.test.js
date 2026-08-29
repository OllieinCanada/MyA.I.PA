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

test("persistent rate limits use one atomic SQL upsert under concurrent first requests", async () => {
  let record = null;
  let turn = Promise.resolve();
  const queries = [];
  const client = {
    async $queryRaw(strings, ...values) {
      assert.ok(Array.isArray(strings.raw), "Prisma must receive a tagged SQL template");
      const sql = strings.join("?");
      assert.match(sql, /INSERT INTO "SecurityRateLimit"/);
      assert.match(sql, /ON CONFLICT \("key"\) DO UPDATE/);
      assert.match(sql, /RETURNING "count", "expiresAt"/);
      queries.push(sql);
      const [, currentTime, expiresAt] = values;
      let release;
      const previous = turn;
      turn = new Promise((resolve) => { release = resolve; });
      await previous;
      try {
        record = !record || record.expiresAt <= currentTime
          ? { count: 1, expiresAt }
          : { count: record.count + 1, expiresAt: record.expiresAt };
        return [{ ...record }];
      } finally {
        release();
      }
    },
  };

  const results = await Promise.all(Array.from({ length: 20 }, () => consumeRateLimit({
    key: "security-rate:test:key",
    maxRequests: 5,
    windowMs: 60_000,
    now: 1_000,
    client,
  })));

  assert.equal(queries.length, 20);
  assert.deepEqual(results.map((result) => result.count).sort((left, right) => left - right),
    Array.from({ length: 20 }, (_, index) => index + 1));
  assert.equal(results.filter((result) => result.allowed).length, 5);
  assert.equal(results.at(-1).count, 20);
  assert.equal(results.at(-1).remaining, 0);
});

test("persistent rate limiting fails closed when the atomic query primitive is unavailable", async () => {
  await assert.rejects(
    consumeRateLimit({
      key: "security-rate:test:key",
      maxRequests: 1,
      windowMs: 60_000,
      now: 1_000,
      client: { securityRateLimit: {} },
    }),
    (error) => error?.code === "ATOMIC_RATE_LIMIT_UNAVAILABLE"
  );
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
