const assert = require("node:assert/strict");
const test = require("node:test");
const { createPendingSignupVerificationStore } = require("../server/pendingSignupVerifications");

function mockPrisma() {
  const rows = new Map();
  const model = {
    async deleteMany({ where }) {
      let count = 0;
      for (const [key, row] of rows) {
        if (where?.tokenHash && where.tokenHash !== key) continue;
        const expired = row.expiresAt && row.expiresAt <= new Date();
        const inactive = Boolean(row.usedAt || row.supersededAt);
        if (where?.OR && !expired && !inactive) continue;
        rows.delete(key);
        count += 1;
      }
      return { count };
    },
    async updateMany({ where, data }) {
      let count = 0;
      for (const [key, row] of rows) {
        if (where.tokenHash && where.tokenHash !== key) continue;
        if (where.claimedAt === null && row.claimedAt) continue;
        if (where.usedAt === null && row.usedAt) continue;
        if (where.supersededAt === null && row.supersededAt) continue;
        rows.set(key, { ...row, ...data });
        count += 1;
      }
      return { count };
    },
    async create({ data }) {
      rows.set(data.tokenHash, { ...data, claimedAt: null, usedAt: null, supersededAt: null });
      return rows.get(data.tokenHash);
    },
    async findUnique({ where }) { return rows.get(where.tokenHash) || null; },
    async update({ where, data }) {
      const row = { ...rows.get(where.tokenHash), ...data };
      rows.set(where.tokenHash, row);
      return row;
    },
    async findMany() { return [...rows.values()]; },
    async createMany({ data, skipDuplicates }) {
      let count = 0;
      for (const row of data) {
        if (skipDuplicates && rows.has(row.tokenHash)) continue;
        rows.set(row.tokenHash, { ...row, usedAt: null, supersededAt: null });
        count += 1;
      }
      return { count };
    },
  };
  const prisma = { pendingSignupVerification: model, async $transaction(fn) { return fn(prisma); } };
  return { prisma, rows };
}

test("verification tokens are stored hashed and can be claimed only once", async () => {
  const { prisma, rows } = mockPrisma();
  const store = createPendingSignupVerificationStore({ prisma, minimumTtlMs: 1000 });
  const token = await store.create({
    payload: { business: { name: "Safe Co" } },
    ownerEmail: "owner@example.com",
    businessName: "Safe Co",
  });
  assert.equal(rows.has(token), false);
  const first = await store.claim(token);
  const second = await store.claim(token);
  assert.equal(first.status, "claimed");
  assert.equal(second.status, "already_claimed");
});

test("a claimed verification can be retained for safe recovery", async () => {
  const { prisma } = mockPrisma();
  const store = createPendingSignupVerificationStore({ prisma, minimumTtlMs: 1000 });
  const token = await store.create({
    payload: { state: "submitted" },
    ownerEmail: "owner@example.com",
    businessName: "Safe Co",
  });
  const claimed = await store.claim(token);
  const retained = await store.retainForRecovery(claimed.tokenHash, {
    record: claimed.record,
    payload: { state: "verified" },
    reviewReasons: ["provider_retry"],
  });
  assert.equal(retained.purpose, "manual_review_recovery");
  assert.equal(retained.claimedAt, 0);
  assert.deepEqual(retained.reviewReasons, ["provider_retry"]);
});

test("delivery proof is recorded without storing the raw token", async () => {
  const { prisma, rows } = mockPrisma();
  const store = createPendingSignupVerificationStore({ prisma, minimumTtlMs: 1000 });
  const token = await store.create({ ownerEmail: "owner@example.com", businessName: "Safe Co" });
  assert.equal(await store.recordDeliveryChannels(token, ["email", "email"]), true);
  const claimed = await store.claim(token);
  assert.deepEqual(claimed.record.deliveryChannels, ["email"]);
  assert.equal(rows.has(token), false);
});

test("a newer SMS verification supersedes the older active link for the same owner", async () => {
  const { prisma, rows } = mockPrisma();
  const store = createPendingSignupVerificationStore({ prisma, minimumTtlMs: 1000 });
  const first = await store.create({
    ownerEmail: "owner@example.com",
    businessName: "Safe Co",
    purpose: "sms_verification",
  });
  const second = await store.create({
    ownerEmail: "OWNER@example.com",
    businessName: "Safe Co",
    purpose: "sms_verification",
  });
  assert.notEqual(first, second);
  assert.equal((await store.claim(first)).status, "missing");
  assert.equal((await store.claim(second)).status, "claimed");
  assert.equal([...rows.values()].filter((row) => !row.supersededAt && !row.usedAt).length, 1);
});

test("active legacy records migrate once without overwriting PostgreSQL state", async () => {
  const { prisma, rows } = mockPrisma();
  const store = createPendingSignupVerificationStore({ prisma, minimumTtlMs: 1000 });
  const digest = "a".repeat(64);
  const legacy = {
    [digest]: {
      ownerEmail: "owner@example.com",
      businessName: "Legacy Co",
      payload: { source: "legacy" },
      createdAt: Date.now() - 1000,
      expiresAt: Date.now() + 60_000,
    },
    ["b".repeat(64)]: {
      ownerEmail: "expired@example.com",
      expiresAt: Date.now() - 1,
    },
  };
  assert.equal(await store.importLegacyRecords(legacy), 1);
  assert.equal(rows.get(digest).businessName, "Legacy Co");
  rows.set(digest, { ...rows.get(digest), businessName: "Database Wins" });
  assert.equal(await store.importLegacyRecords(legacy), 0);
  assert.equal(rows.get(digest).businessName, "Database Wins");
});
