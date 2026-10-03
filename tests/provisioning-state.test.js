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
    verifyCompleted: async () => true,
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

test("missing cached resources are invalidated without executing a paid step", async () => {
  const { prisma, rows } = createFakePrisma();
  let executions = 0;
  const input = { prisma, kind: "vapi-assistant", idempotencyKey: "stale", contextHash: "a",
    execute: async () => { executions++; return { assistantId: "deleted" }; },
    verifyCompleted: async () => false };
  await runProvisioningStep(input);
  await assert.rejects(runProvisioningStep(input), { code: "PROVISIONING_RESULT_STALE" });
  const saved = rows.get(provisioningStateKey(input.kind, input.idempotencyKey));
  assert.equal(saved.status, "invalidated");
  assert.equal(saved.result.assistantId, "deleted");
  assert.ok(saved.completedAt);
  await assert.rejects(runProvisioningStep(input), { code: "PROVISIONING_RESULT_STALE" });
  assert.equal(executions, 1);
});

test("provider outage does not invalidate completion evidence or create replacements", async () => {
  const { prisma, rows } = createFakePrisma();
  let executions=0;
  const input={prisma,kind:"vapi-import",idempotencyKey:"outage",contextHash:"a",
    execute:async()=>{executions++;return {id:"phone"};},
    verifyCompleted:async()=>{throw Object.assign(new Error("unavailable"),{code:"VAPI_503"});}};
  await runProvisioningStep(input);
  await assert.rejects(runProvisioningStep(input),{code:"VAPI_503"});
  assert.equal(rows.get(provisioningStateKey(input.kind,input.idempotencyKey)).status,"completed");
  assert.equal(executions,1);
});

test("completed results cannot be reused without verification", async () => {
 const {prisma}=createFakePrisma();
 const input={prisma,kind:"twilio-number",idempotencyKey:"unverified",contextHash:"a",execute:async()=>({sid:"PN1"})};
 await runProvisioningStep(input);
 await assert.rejects(runProvisioningStep(input),{code:"PROVISIONING_RESULT_UNVERIFIED"});
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

test("lost provider responses cannot trigger a second paid creation without reconciliation", async () => {
  const { prisma } = createFakePrisma();
  let executions = 0;
  const input = { prisma, kind: "twilio-number", idempotencyKey: "lost-response", contextHash: "a",
    reconcile: async () => null, execute: async () => { executions++; throw new Error("provider response lost after creation"); } };
  await assert.rejects(runProvisioningStep(input));
  await assert.rejects(runProvisioningStep(input), { code: "PROVISIONING_RECONCILIATION_REQUIRED" });
  assert.equal(executions, 1);
  const recovered = await runProvisioningStep({ ...input, reconcile: async () => ({ twilioSid: "provider-existing" }) });
  assert.equal(recovered.twilioSid, "provider-existing"); assert.equal(executions, 1);
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
