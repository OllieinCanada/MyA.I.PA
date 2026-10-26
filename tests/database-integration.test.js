const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { createPendingSignupVerificationStore } = require("../server/pendingSignupVerifications");

const enabled = process.env.RUN_DATABASE_INTEGRATION === "1";

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

test("PostgreSQL reconciles owned call identities and rejects conflicting bindings", { skip: !enabled, timeout: 30_000 }, async () => {
  const { PrismaClient } = require("@prisma/client");
  const { persistCallRecord } = require("../server/callRecordIdentity");
  const prisma = new PrismaClient();
  const suffix = crypto.randomUUID();
  const businessIds = [], callerIds = [];
  const conflict = error => error?.code === "CALL_RECORD_IDENTITY_CONFLICT" && error.statusCode === 409;
  const sid = label => `CA-ci-${label}-${suffix}`;
  const external = label => `ci-${label}-${suffix}`;
  try {
    for (let index = 0; index < 2; index += 1) {
      const business = await prisma.business.create({ data: {
        name: `Call Identity CI ${index} ${suffix}`, phone: "+19995550101", timezone: "America/Toronto",
      } });
      businessIds.push(business.id);
      const caller = await prisma.caller.create({ data: { phone: `ci-call-identity-${index}-${suffix}` } });
      callerIds.push(caller.id);
    }
    const create = (changes = {}) => prisma.call.create({ data: {
      businessId: businessIds[0], callerId: callerIds[0], startedAt: new Date(), status: "STARTED", ...changes,
    } });
    const input = (externalId, twilioCallSid, changes = {}) => ({
      prisma, businessId: businessIds[0], externalProvider: "vapi", externalId, twilioCallSid,
      createData: { callerId: callerIds[1], startedAt: new Date(), status: "COMPLETED", durationSec: 42 },
      updateData: () => ({ status: "COMPLETED", durationSec: 42 }), ...changes,
    });

    const unbound = await create({ twilioCallSid: sid("unbound") });
    const bound = await persistCallRecord(input(external("bound"), unbound.twilioCallSid));
    assert.equal(bound.id, unbound.id);
    assert.equal(bound.businessId, businessIds[0]);
    assert.equal(bound.callerId, callerIds[0], "SID reconciliation must retain the existing caller");
    assert.equal(bound.externalProvider, "vapi");
    assert.equal(bound.externalId, external("bound"));
    assert.equal(bound.durationSec, 42);

    // Both requests finish their initial lookups before either INSERT reaches PostgreSQL.
    let release, arrivals = 0, uniqueConflicts = 0;
    const gate = new Promise(resolve => { release = resolve; });
    const racePrisma = { call: {
      findUnique: args => prisma.call.findUnique(args),
      update: args => prisma.call.update(args),
      create: async args => {
        arrivals += 1;
        if (arrivals === 2) release();
        await gate;
        try { return await prisma.call.create(args); }
        catch (error) { if (error.code === "P2002") uniqueConflicts += 1; throw error; }
      },
    } };
    const raceInput = input(external("race"), sid("race"), { prisma: racePrisma });
    const [first, second] = await Promise.all([persistCallRecord(raceInput), persistCallRecord(raceInput)]);
    assert.equal(arrivals, 2);
    assert.equal(uniqueConflicts, 1, "the real unique-constraint race must execute recovery");
    assert.equal(first.id, second.id);
    assert.equal(first.callerId, callerIds[1]);
    assert.equal(await prisma.call.count({ where: { twilioCallSid: sid("race") } }), 1);
    assert.equal(await prisma.call.count({ where: { externalProvider: "vapi", externalId: external("race") } }), 1);

    const foreign = await create({ businessId: businessIds[1], callerId: callerIds[1],
      externalProvider: "vapi", externalId: external("foreign"), twilioCallSid: sid("foreign") });
    await assert.rejects(persistCallRecord(input(external("foreign-incoming"), foreign.twilioCallSid)), conflict);
    assert.deepEqual(await prisma.call.findUnique({ where: { id: foreign.id } }), foreign);

    const a = await create({ externalProvider: "vapi", externalId: external("ambiguous-a"), twilioCallSid: sid("ambiguous-a") });
    const b = await create({ externalProvider: "vapi", externalId: external("ambiguous-b"), twilioCallSid: sid("ambiguous-b") });
    await assert.rejects(persistCallRecord(input(a.externalId, b.twilioCallSid)), conflict);
    assert.deepEqual(await prisma.call.findMany({ where: { id: { in: [a.id, b.id] } }, orderBy: { id: "asc" } }), [a, b]);

    const before = await prisma.call.findUnique({ where: { id: bound.id } });
    await assert.rejects(persistCallRecord(input(external("different-vapi-call"), bound.twilioCallSid)), conflict);
    assert.deepEqual(await prisma.call.findUnique({ where: { id: bound.id } }), before);
  } finally {
    if (businessIds.length) await prisma.business.deleteMany({ where: { id: { in: businessIds } } });
    if (callerIds.length) await prisma.caller.deleteMany({ where: { id: { in: callerIds } } });
    await prisma.$disconnect();
  }
});
