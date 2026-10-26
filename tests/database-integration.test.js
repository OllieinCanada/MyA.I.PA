const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { createPendingSignupVerificationStore } = require("../server/pendingSignupVerifications");

const enabled = process.env.RUN_DATABASE_INTEGRATION === "1";

test("Saved-call inspection uses a real PostgreSQL read-only transaction and exact ownership", { skip: !enabled, timeout: 15000 }, async () => {
  const { PrismaClient } = require("@prisma/client");
  const { inspectCallRecord, makeReferences } = require("../server/callRecordVerification");
  const prisma = new PrismaClient(); const callId = crypto.randomUUID(); let business, caller;
  try {
    business = await prisma.business.create({ data: { name: `CI inspection ${callId}`, phone: `ci-${callId}`, timezone: "America/Toronto" } });
    caller = await prisma.caller.create({ data: { phone: `ci-inspection-${callId}` } });
    await prisma.call.create({ data: { businessId: business.id, callerId: caller.id, externalProvider: "vapi", externalId: callId,
      status: "COMPLETED", durationSec: 10, startedAt: new Date(Date.now() - 10000), endedAt: new Date(),
      endedReason: "customer-ended-call", twilioCallSid: 'CA' + callId.replaceAll('-', '') } });
    const db = { $transaction: (fn, options) => prisma.$transaction(async tx => {
      const result = await fn(tx);
      const [state] = await tx.$queryRaw`SELECT current_setting('transaction_read_only') AS mode, current_setting('transaction_isolation') AS isolation`;
      assert.equal(state.mode, 'on'); assert.equal(state.isolation, 'repeatable read'); return result;
    }, options) };
    const query = makeReferences(callId, business.id);
    assert.equal((await inspectCallRecord({ prisma: db, query })).savedRecordVerified, true);
    const mismatch = await inspectCallRecord({ prisma: db, query: makeReferences(callId, business.id + 1000000) });
    assert.equal(mismatch.checks.businessOwnership, "mismatch"); assert.equal(mismatch.record, null);
    assert.equal(await prisma.call.count({ where: { businessId: business.id } }), 1);
  } finally {
    if (business) await prisma.business.delete({ where: { id: business.id } });
    if (caller) await prisma.caller.delete({ where: { id: caller.id } });
    await prisma.$disconnect();
  }
});

test("PostgreSQL reconciles concurrent voice receipts without losing terminal detail", { skip: !enabled, timeout: 20000 }, async () => {
  const { PrismaClient } = require("@prisma/client");
  const { persistCall, persistCaller, mergeCallData } = require("../server/callPersistence");
  const prisma = new PrismaClient();
  const suffix = crypto.randomUUID();
  let business;
  let caller;
  try {
    business = await prisma.business.create({ data: { name: `CI voice ${suffix}`, phone: `ci-business-${suffix}`, timezone: "America/Toronto" } });
    const callers = await Promise.all([0, 1].map(() => persistCaller(prisma, { phone: `ci-caller-${suffix}`, name: "Synthetic caller" })));
    caller = callers[0];
    assert.equal(callers[0].id, callers[1].id);
    const identity = { businessId: business.id, callerId: caller.id, externalProvider: "vapi", externalId: `ci-voice-${suffix}`, twilioCallSid: `CA${suffix.replaceAll("-", "")}` };
    const terminal = { ...identity, startedAt: new Date(), endedAt: new Date(), status: "FAILED", durationSec: 0, endedReason: "assistant-request-returned-error", aiSummary: "Synthetic setup failure" };
    const write = data => persistCall({ db: prisma, identity, createData: data, updateData: existing => mergeCallData(existing, data) });
    const records = await Promise.all([write(terminal), write(terminal)]);
    assert.equal(records[0].id, records[1].id);
    assert.equal(await prisma.call.count({ where: { twilioCallSid: identity.twilioCallSid } }), 1);
    const replay = await write({ ...identity, startedAt: terminal.startedAt, status: "STARTED", durationSec: null, endedReason: null, aiSummary: "" });
    assert.equal(replay.status, "FAILED");
    assert.equal(replay.endedReason, terminal.endedReason);
    assert.equal(replay.aiSummary, terminal.aiSummary);
    await assert.rejects(persistCall({ db: prisma, identity: { ...identity, callerId: caller.id + 1000000 }, createData: terminal, updateData: () => terminal }), { code: "CALL_RECORD_IDENTITY_CONFLICT" });
  } finally {
    if (business) await prisma.business.delete({ where: { id: business.id } });
    if (caller) await prisma.caller.delete({ where: { id: caller.id } });
    await prisma.$disconnect();
  }
});

test("PostgreSQL voice reservation is replay-safe and refuses a busy advisory lock promptly", { skip: !enabled, timeout: 20000 }, async () => {
  const { PrismaClient } = require("@prisma/client");
  const { Client } = require("pg");
  const { reserveCall } = require("../server/trialCallReservation");
  const { createAssistantRequestGuard } = require("../server/voiceCallReliability");
  const { decideTrialCall, getTrialLifecycle } = require("../server/trialUsagePolicy");
  const prisma = new PrismaClient();
  const blocker = new Client({ connectionString: process.env.DATABASE_URL });
  const suffix = crypto.randomUUID();
  const key = `ci-voice-reservation:${suffix}`;
  const callId = `ci-voice-call:${suffix}`;
  const callIndexKey = `ci-voice-index:${suffix}`;
  const cleanupKeys = [key, callIndexKey, `voice-call-policy:${callId}`];
  let connected = false;
  try {
    const params = { db: prisma, signup: { subscriptionStatus: "trialing", trialStartAt: Date.now() - 60000, trialEndAt: Date.now() + 86400000 },
      config: { businessId: 37, assistantMaxSeconds: 300 }, key, callId, callIndexKey,
      getUsedSeconds: async (_signup, _businessId, tx) => { await tx.$queryRaw`SELECT 1`; return 0; },
      getLifecycle: getTrialLifecycle, decide: decideTrialCall,
      limits: { maxCallSeconds: 300, warningSeconds: 1200, limitSeconds: 3600, completionReserveSeconds: 300, minCallSeconds: 30, reservationGraceSeconds: 60 } };
    const reserve = overrides => reserveCall({ ...params, guard: createAssistantRequestGuard(), ...overrides });
    assert.equal((await reserve()).action, "allow-saved");
    assert.equal((await reserve()).duplicateReservation, true);
    const row = await prisma.runtimeStore.findUnique({ where: { key } });
    assert.equal(Object.keys(row.data.reservations).length, 1);
    assert.equal(row.data.reservations[callId].allowanceSeconds, 300);
    await blocker.connect();
    connected = true;
    await blocker.query("BEGIN");
    await blocker.query("SELECT pg_advisory_xact_lock(hashtext($1))", [key]);
    const started = Date.now();
    await assert.rejects(reserve(), { code: "VOICE_TRIAL_RESERVATION_BUSY" });
    assert.ok(Date.now() - started < 2500, "a busy quota lock must not consume the Vapi answering deadline");
    await blocker.query("ROLLBACK");
    assert.equal((await reserve({ signup: { ...params.signup, trialEndAt: Date.now() - 1000 } })).action, "block");
    const policy = await prisma.runtimeStore.findUnique({ where: { key: `voice-call-policy:${callId}` } });
    assert.equal(policy.data.decision, "block");
    assert.equal(policy.data.callId, callId);
  } finally {
    if (connected) { await blocker.query("ROLLBACK").catch(() => {}); await blocker.end(); }
    await prisma.runtimeStore.deleteMany({ where: { key: { in: cleanupKeys } } });
    await prisma.$disconnect();
  }
});

test("PostgreSQL enforces idempotency, uniqueness, and cascade behavior", { skip: !enabled }, async () => {
  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();
  const suffix = crypto.randomUUID();
  const phone = `+1905${String(Date.now()).slice(-7)}`;
  let businessId;
  let callerId;
  let pendingVerificationToken;

  try {
    await prisma.$queryRaw`SELECT 1`;

    const verificationStore = createPendingSignupVerificationStore({ prisma, minimumTtlMs: 1000 });
    pendingVerificationToken = await verificationStore.create({
      payload: { synthetic: true, suffix },
      ownerEmail: `integration-${suffix}@example.invalid`,
      businessName: `Verification Integration ${suffix}`,
    });
    const verificationClaims = await Promise.all([
      verificationStore.claim(pendingVerificationToken),
      verificationStore.claim(pendingVerificationToken),
    ]);
    assert.equal(verificationClaims.filter((result) => result.status === "claimed").length, 1);
    assert.equal(verificationClaims.filter((result) => result.status === "already_claimed").length, 1);
    assert.equal(await prisma.pendingSignupVerification.count({
      where: { tokenHash: verificationStore.tokenHash(pendingVerificationToken) },
    }), 1);

    const business = await prisma.business.create({
      data: {
        name: `CI Integration ${suffix}`,
        phone,
        timezone: "America/Toronto",
      },
    });
    businessId = business.id;

    const caller = await prisma.caller.create({ data: { phone: `+1289${String(Date.now() + 1).slice(-7)}` } });
    callerId = caller.id;

    const callExternalId = `ci-call-${suffix}`;
    const createCall = () => prisma.call.create({
      data: {
        businessId,
        callerId,
        startedAt: new Date(),
        status: "COMPLETED",
        externalProvider: "CI",
        externalId: callExternalId,
      },
    });
    const callRace = await Promise.allSettled([createCall(), createCall()]);
    assert.equal(callRace.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(callRace.filter((result) => result.status === "rejected").length, 1);
    assert.equal(await prisma.call.count({ where: { externalProvider: "CI", externalId: callExternalId } }), 1);

    const replayKey = `ci-replay-${suffix}`;
    const createReplayClaim = () => prisma.webhookReplayClaim.create({
      data: {
        key: replayKey,
        provider: "CI",
        eventIdHash: crypto.createHash("sha256").update(replayKey).digest("hex"),
        eventType: "integration-test",
        status: "PROCESSING",
        claimToken: crypto.randomUUID(),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const replayRace = await Promise.allSettled([createReplayClaim(), createReplayClaim()]);
    assert.equal(replayRace.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(replayRace.filter((result) => result.status === "rejected").length, 1);

    await prisma.business.delete({ where: { id: businessId } });
    businessId = undefined;
    assert.equal(await prisma.call.count({ where: { externalProvider: "CI", externalId: callExternalId } }), 0);
    assert.ok(await prisma.caller.findUnique({ where: { id: callerId } }), "business deletion must not delete a shared caller");
  } finally {
    if (pendingVerificationToken) {
      const { tokenHash } = require("../server/pendingSignupVerifications");
      await prisma.pendingSignupVerification.deleteMany({ where: { tokenHash: tokenHash(pendingVerificationToken) } }).catch(() => {});
    }
    await prisma.webhookReplayClaim.deleteMany({ where: { key: `ci-replay-${suffix}` } }).catch(() => {});
    if (businessId) await prisma.business.delete({ where: { id: businessId } }).catch(() => {});
    if (callerId) await prisma.caller.delete({ where: { id: callerId } }).catch(() => {});
    await prisma.$disconnect();
  }
});


test("PostgreSQL forced call insertion race recovers once and canonical SID lookup preserves ownership", { skip: !enabled, timeout: 20000 }, async () => {
  const { PrismaClient } = require("@prisma/client");
  const { persistCall, resolveCallRecord, mergeCallData } = require("../server/callPersistence");
  const prisma = new PrismaClient();
  const suffix = crypto.randomUUID();
  let business, caller, arrivals = 0, uniqueFailures = 0, release;
  const barrier = new Promise(resolve => { release = resolve; });
  try {
    business = await prisma.business.create({ data: { name: `CI identity ${suffix}`, phone: `ci-${suffix}`, timezone: "America/Toronto" } });
    caller = await prisma.caller.create({ data: { phone: `ci-identity-${suffix}` } });
    const identity = { businessId: business.id, callerId: caller.id, externalProvider: "vapi", externalId: suffix, twilioCallSid: `CA${suffix}` };
    const data = { ...identity, startedAt: new Date(), status: "COMPLETED", durationSec: 42 };
    const db = { $transaction: (fn, options) => prisma.$transaction(tx => fn({
      $queryRaw: tx.$queryRaw.bind(tx), call: {
        findMany: tx.call.findMany.bind(tx.call), findUnique: tx.call.findUnique.bind(tx.call), update: tx.call.update.bind(tx.call),
        create: async args => {
          arrivals++; if (arrivals === 2) release();
          await barrier;
          try { return await tx.call.create(args); }
          catch (error) { if (error.code === "P2002") uniqueFailures++; throw error; }
        },
      },
    }), options) };
    const write = () => persistCall({ db, identity, createData: data, updateData: row => mergeCallData(row, data) });
    const [a, b] = await Promise.all([write(), write()]);
    assert.equal(a.id, b.id); assert.equal(uniqueFailures, 1);
    assert.equal(await prisma.call.count({ where: { businessId: business.id } }), 1);
    const found = await resolveCallRecord(prisma, { ...identity, callerId: undefined });
    assert.equal(found.callerId, caller.id);
    await assert.rejects(resolveCallRecord(prisma, { ...identity, businessId: business.id + 1000000 }), { code: "CALL_RECORD_IDENTITY_CONFLICT" });
  } finally {
    release();
    if (business) await prisma.business.delete({ where: { id: business.id } });
    if (caller) await prisma.caller.delete({ where: { id: caller.id } });
    await prisma.$disconnect();
  }
});
