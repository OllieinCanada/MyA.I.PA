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

test('admin missing-assistant recovery is single-use, durable and cannot relax other stages', async () => {
  const {prisma,rows}=createFakePrisma();let creates=0,checks=0;
  const input={prisma,kind:'vapi-assistant',idempotencyKey:'guarded',contextHash:'exact',
    reconcile:async()=>null,execute:async()=>{creates++;throw Error('lost response');}};
  await assert.rejects(runProvisioningStep(input));
  rows.get(provisioningStateKey(input.kind,input.idempotencyKey)).dispatchStartedAt=new Date(Date.now()-31*60000).toISOString();
  const original=rows.get(provisioningStateKey(input.kind,input.idempotencyKey)).originalErrorCode;
  await assert.rejects(runProvisioningStep({...input,missingAssistantRecovery:{actorHash:'a'.repeat(32),verifyAbsent:async()=>{checks++;return true;}}}));
  const saved=rows.get(provisioningStateKey(input.kind,input.idempotencyKey));
  assert.equal(creates,2);assert.equal(checks,1);assert.equal(saved.originalErrorCode,original);
  assert.equal(saved.guardedRecovery.inventoryVerified,true);
  await assert.rejects(runProvisioningStep({...input,missingAssistantRecovery:{actorHash:'a'.repeat(32),verifyAbsent:async()=>{checks++;return true;}}}),{code:'PROVISIONING_RECONCILIATION_REQUIRED'});
  assert.equal(creates,2);assert.equal(checks,1);
  for(const kind of ['twilio-number','vapi-import','signup-sms','signup-completion-email']) {
    const other={...input,kind,idempotencyKey:kind};await assert.rejects(runProvisioningStep(other));
    await assert.rejects(runProvisioningStep({...other,missingAssistantRecovery:{actorHash:'a'.repeat(32),verifyAbsent:async()=>true}}),{code:'PROVISIONING_RECONCILIATION_REQUIRED'});
  }
});
test('failed, inconclusive, missing or invalid admin proofs never dispatch', async () => {
  for(const recovery of [undefined, {actorHash:'invalid',verifyAbsent:async()=>true},
    {actorHash:'a'.repeat(32),verifyAbsent:async()=>false},{actorHash:'a'.repeat(32),verifyAbsent:async()=>undefined},
    {actorHash:'a'.repeat(32),verifyAbsent:async()=>{throw Error('provider unavailable');}}]) {
    const {prisma,rows}=createFakePrisma();let creates=0;
    const input={prisma,kind:'vapi-assistant',idempotencyKey:'failed-proof',contextHash:'exact',reconcile:async()=>null,
      execute:async()=>{creates++;throw Error('original');}};
    await assert.rejects(runProvisioningStep(input));
    rows.get(provisioningStateKey(input.kind,input.idempotencyKey)).dispatchStartedAt=new Date(Date.now()-31*60000).toISOString();
    await assert.rejects(runProvisioningStep({...input,missingAssistantRecovery:recovery}));assert.equal(creates,1);
  }
});
test('recovery holds its lease through inventory verification and replays the completed assistant', async () => {
  const {prisma,rows}=createFakePrisma();let creates=0,release,entered;
  const started=new Promise(resolve=>{entered=resolve;});const wait=new Promise(resolve=>{release=resolve;});
  const base={prisma,kind:'vapi-assistant',idempotencyKey:'concurrent-recovery',contextHash:'exact',reconcile:async()=>null,
    verifyCompleted:async()=>true,execute:async()=>{creates++;return {assistantId:'one'};}};
  rows.set(provisioningStateKey(base.kind,base.idempotencyKey),{kind:base.kind,status:'failed',contextHash:'exact',attempts:1,dispatchStartedAt:new Date(Date.now()-31*60000).toISOString()});
  const recovery=runProvisioningStep({...base,missingAssistantRecovery:{actorHash:'a'.repeat(32),verifyAbsent:async()=>{entered();await wait;return true;}}});
  await started;await assert.rejects(runProvisioningStep(base),{code:'PROVISIONING_ALREADY_IN_PROGRESS'});release();
  assert.equal((await recovery).assistantId,'one');assert.equal((await runProvisioningStep(base)).assistantId,'one');assert.equal(creates,1);
});
test('even an admin cannot retry an unsettled provider write',async()=>{
  const {prisma}=createFakePrisma();let creates=0,checks=0;
  const input={prisma,kind:'vapi-assistant',idempotencyKey:'settling',contextHash:'exact',reconcile:async()=>null,
    execute:async()=>{creates++;throw Error('lost response');}};
  await assert.rejects(runProvisioningStep(input));
  await assert.rejects(runProvisioningStep({...input,missingAssistantRecovery:{actorHash:'a'.repeat(32),verifyAbsent:async()=>{checks++;return true;}}}),{code:'PROVISIONING_RECONCILIATION_REQUIRED'});
  assert.equal(creates,1);assert.equal(checks,0);
});

test('sanitized provider explanation survives a later reconciliation hold', async () => {
  const {prisma,rows}=createFakePrisma();
  const input={prisma,kind:'vapi-import',idempotencyKey:'diagnostic-fixture',contextHash:'context',
    reconcile:async()=>null,verifyCompleted:async()=>true,execute:async()=>{throw Object.assign(new Error('Import failed'),{providerCode:'VAPI_TWILIO_IMPORT_FAILED',providerStatus:400,providerDetail:'name must be shorter; person@example.com'});}};
  await assert.rejects(runProvisioningStep(input));
  await assert.rejects(runProvisioningStep(input));
  const d=rows.get(provisioningStateKey(input.kind,input.idempotencyKey));
  assert.match(d.originalProviderDetail,/name must be shorter/);
  assert.doesNotMatch(d.originalProviderDetail,/person@example.com/);
  assert.equal(d.originalProviderStatus,400);
  assert.equal(d.originalErrorCode,'VAPI_TWILIO_IMPORT_FAILED');
  assert.equal(d.lastProviderDetail,d.originalProviderDetail);
});

test('a rejected import recovers from one operator-confirmed phone without dispatching again', async () => {
  const {prisma}=createFakePrisma();
  let dispatches=0,providerPhone=null;
  const input={prisma,kind:'vapi-import',idempotencyKey:'isolated-rejected-import',contextHash:'exact-context',
    reconcile:async()=>providerPhone,verifyCompleted:async result=>result.id===providerPhone?.id,
    execute:async()=>{dispatches++;throw Object.assign(Error('Rejected'),{providerCode:'VAPI_TWILIO_IMPORT_FAILED',providerStatus:400,providerDetail:'isolated validation rejection'});}};
  await assert.rejects(runProvisioningStep(input));
  await assert.rejects(runProvisioningStep(input),{code:'PROVISIONING_RECONCILIATION_REQUIRED'});
  assert.equal(dispatches,1);
  // Model the explicit operator repair, not an automatic retry or a purchased number.
  providerPhone={id:'one-isolated-phone',assistantId:'one-isolated-assistant',number:'+19055550123'};
  const recovered=await runProvisioningStep(input);
  assert.equal(recovered.id,providerPhone.id);assert.equal(recovered.reused,true);
  const replayed=await Promise.all([runProvisioningStep(input),runProvisioningStep(input)]);
  assert.ok(replayed.every(x=>x.id===providerPhone.id&&x.reused));
  assert.equal(dispatches,1);
});

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
