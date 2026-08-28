const assert = require("node:assert/strict");
const test = require("node:test");

const {
  provisioningStateKey,
  runProvisioningStep,
} = require("../server/provisioningState");

function createFakePrisma() {
  const rows = new Map();
  const rawQueries = [];
  const runtimeStore = {
    async findUnique({ where }) {
      return rows.has(where.key) ? { key: where.key, data: rows.get(where.key) } : null;
    },
    async upsert({ where, update, create }) {
      const value = rows.has(where.key) ? update.data : create.data;
      rows.set(where.key, value);
      return { key: where.key, data: value };
    },
  };
  const prisma = {
    runtimeStore,
    async $transaction(callback) {
      return callback({
        runtimeStore,
        async $queryRaw(strings) {
          rawQueries.push(strings.join("?"));
          return [{ lock_result: "" }];
        },
      });
    },
  };
  return { prisma, rawQueries, rows };
}

test("provisioning state keys contain no raw signup identity", () => {
  const key = provisioningStateKey("twilio-number", "owner@example.ca:+19055550123");
  assert.match(key, /^signup-provisioning:twilio-number:[a-f0-9]{64}$/);
  assert.doesNotMatch(key, /owner|example|9055550123/i);
});

test("an exact replay returns the durable result without another provider call", async () => {
  const { prisma, rawQueries } = createFakePrisma();
  let executions = 0;
  const input = {
    prisma,
    kind: "twilio-number",
    idempotencyKey: "signup_provisioning_v1_abc",
    contextHash: "context-a",
    reconcile: async () => null,
    execute: async () => {
      executions += 1;
      return { twilioPhoneNumber: "+19055550123", twilioSid: "PN1" };
    },
  };

  const first = await runProvisioningStep(input);
  const second = await runProvisioningStep(input);
  assert.equal(first.twilioSid, "PN1");
  assert.equal(second.twilioSid, "PN1");
  assert.equal(second.reused, true);
  assert.equal(executions, 1);
  assert.ok(rawQueries.length >= 2);
  assert.ok(rawQueries.every((query) => /pg_advisory_xact_lock[\s\S]*::text AS lock_result/i.test(query)));
});

test("provider reconciliation closes the post-create crash window", async () => {
  const { prisma } = createFakePrisma();
  let executions = 0;
  const result = await runProvisioningStep({
    prisma,
    kind: "vapi-assistant",
    idempotencyKey: "signup_provisioning_v1_reconcile",
    contextHash: "context-a",
    reconcile: async () => ({ assistantId: "assistant-existing" }),
    execute: async () => {
      executions += 1;
      return { assistantId: "assistant-new" };
    },
  });
  assert.equal(result.assistantId, "assistant-existing");
  assert.equal(result.reused, true);
  assert.equal(executions, 0);
});

test("one provisioning key cannot be reused for a different signed context", async () => {
  const { prisma } = createFakePrisma();
  const base = {
    prisma,
    kind: "vapi-import",
    idempotencyKey: "signup_provisioning_v1_context",
    reconcile: async () => null,
    execute: async () => ({ phoneNumberId: "phone-1" }),
  };
  await runProvisioningStep({ ...base, contextHash: "context-a" });
  await assert.rejects(
    runProvisioningStep({ ...base, contextHash: "context-b" }),
    (error) => error.code === "PROVISIONING_CONTEXT_MISMATCH" && error.statusCode === 409
  );
});
