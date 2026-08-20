const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const enabled = process.env.RUN_DATABASE_INTEGRATION === "1";

test("PostgreSQL enforces idempotency, uniqueness, and cascade behavior", { skip: !enabled }, async () => {
  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();
  const suffix = crypto.randomUUID();
  const phone = `+1905${String(Date.now()).slice(-7)}`;
  let businessId;
  let callerId;

  try {
    await prisma.$queryRaw`SELECT 1`;

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
    await prisma.webhookReplayClaim.deleteMany({ where: { key: `ci-replay-${suffix}` } }).catch(() => {});
    if (businessId) await prisma.business.delete({ where: { id: businessId } }).catch(() => {});
    if (callerId) await prisma.caller.delete({ where: { id: callerId } }).catch(() => {});
    await prisma.$disconnect();
  }
});
