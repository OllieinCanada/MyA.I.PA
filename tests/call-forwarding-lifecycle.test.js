const assert = require("node:assert/strict");
const test = require("node:test");
const {
  applyVerificationStatusCallback,
  createSetupToken,
  getSetupFromToken,
  initializeForwardingSetup,
  markDialerOpened,
  matchForwardedVerificationCall,
  sanitizeSetup,
  startVerification,
  updateSelections,
} = require("../server/callForwardingService");

function memoryPrisma() {
  const db = { setup: null, attempts: [], events: [] };
  const matches = (row, where = {}) => Object.entries(where).every(([key, value]) => {
    if (key === "status" && value?.in) return value.in.includes(row.status);
    if (key === "expiresAt" && value?.gt) return row.expiresAt > value.gt;
    if (key === "startedAt" && value?.gte) return row.startedAt >= value.gte;
    if (key === "setup" && value?.is) return Object.entries(value.is).every(([setupKey, setupValue]) => db.setup?.[setupKey] === setupValue);
    return row[key] === value;
  });
  const apply = (row, data) => {
    for (const [key, value] of Object.entries(data || {})) {
      if (value && typeof value === "object" && Object.hasOwn(value, "increment")) row[key] = Number(row[key] || 0) + value.increment;
      else if (value !== undefined) row[key] = value;
    }
    row.updatedAt = new Date();
    return { ...row };
  };
  const prisma = {
    callForwardingSetup: {
      upsert: async ({ update, create }) => {
        if (db.setup) return apply(db.setup, update);
        db.setup = { id: "setup-1", verificationAttempts: 0, forwardingVerifiedAt: null, lastFailureReason: null, createdAt: new Date(), updatedAt: new Date(), ...create };
        return { ...db.setup };
      },
      findUnique: async ({ where }) => db.setup && ((where.id && db.setup.id === where.id) || (where.signupKey && db.setup.signupKey === where.signupKey)) ? { ...db.setup } : null,
      update: ({ where, data }) => Promise.resolve(apply(db.setup, data)),
    },
    forwardingVerificationAttempt: {
      count: async ({ where }) => db.attempts.filter((row) => matches(row, where)).length,
      create: async ({ data }) => {
        const row = { id: `attempt-${db.attempts.length + 1}`, status: "PENDING", startedAt: new Date(), inboundVapiCallId: null, outboundCallSid: null, ...data };
        db.attempts.push(row); return { ...row };
      },
      findFirst: async ({ where }) => {
        const rows = db.attempts.filter((row) => matches(row, where)).sort((a, b) => b.startedAt - a.startedAt);
        return rows[0] ? { ...rows[0], ...(where.verificationCallerNumber ? { setup: { ...db.setup } } : {}) } : null;
      },
      findUnique: async ({ where, include }) => {
        const key = Object.keys(where)[0]; const row = db.attempts.find((item) => item[key] === where[key]);
        return row ? { ...row, ...(include?.setup ? { setup: { ...db.setup } } : {}) } : null;
      },
      update: ({ where, data }) => {
        const row = db.attempts.find((item) => item.id === where.id); return Promise.resolve(apply(row, data));
      },
    },
    callForwardingEvent: {
      upsert: async ({ where, create }) => {
        let row = db.events.find((item) => item.idempotencyKey === where.idempotencyKey);
        if (!row) { row = { id: `event-${db.events.length + 1}`, ...create }; db.events.push(row); }
        return { ...row };
      },
    },
    $transaction: async (operations) => Promise.all(operations),
  };
  return { prisma, db };
}

const env = { FORWARDING_SETUP_SECRET: "a-production-sized-test-secret-that-is-long", FORWARDING_SETUP_URL_TTL_SECONDS: "600" };

test("provisioning, carrier selection, dialer launch, and verification are idempotent", async () => {
  const { prisma, db } = memoryPrisma();
  let setup = await initializeForwardingSetup({ prismaClient: prisma, signupId: "signup-1", ownerEmail: "owner@example.ca", existingBusinessNumber: "+19055550123", assignedMyAiPaNumber: "+12895550199", vapiPhoneNumberId: "vapi-phone-1", carrier: "not_sure", lineType: "not_sure" });
  assert.equal(setup.status, "CARRIER_NEEDED");
  assert.equal(sanitizeSetup(setup).forwardingMode, "no_answer");

  setup = await updateSelections({ prismaClient: prisma, setup, carrier: "rogers", lineType: "mobile" });
  assert.equal(setup.status, "READY_TO_ACTIVATE");
  setup = await markDialerOpened({ prismaClient: prisma, setup });
  assert.equal(setup.status, "DIALER_OPENED");

  const placed = [];
  const first = await startVerification({ prismaClient: prisma, setup, verificationCallerNumber: "+12895550000", statusCallbackUrl: "https://api.example.ca/callback", placeCall: async (input) => { placed.push(input); return { sid: "CA-1" }; } });
  const second = await startVerification({ prismaClient: prisma, setup: first.setup, verificationCallerNumber: "+12895550000", statusCallbackUrl: "https://api.example.ca/callback", placeCall: async () => { throw new Error("must not run"); } });
  assert.equal(placed.length, 1);
  assert.equal(second.duplicate, true);

  const answered = await applyVerificationStatusCallback({ prismaClient: prisma, callSid: "CA-1", callStatus: "in-progress", answeredBy: "human" });
  assert.equal(answered.status, "ANSWERED");
  const success = await matchForwardedVerificationCall({ prismaClient: prisma, from: "+12895550000", destination: "", phoneNumberId: "vapi-phone-1", vapiCallId: "vapi-verification-1" });
  assert.equal(success.setup.status, "ACTIVE");
  assert.ok(success.setup.forwardingVerifiedAt);
  const duplicate = await matchForwardedVerificationCall({ prismaClient: prisma, from: "+12895550000", destination: "+12895550199", vapiCallId: "vapi-verification-1" });
  assert.equal(duplicate.duplicate, true);
  assert.equal(db.events.filter((event) => event.eventType === "verification_succeeded").length, 1);
});

test("verification timeout becomes a useful failure without corrupting the setup", async () => {
  const { prisma, db } = memoryPrisma();
  const setup = await initializeForwardingSetup({ prismaClient: prisma, signupId: "signup-2", ownerEmail: "two@example.ca", existingBusinessNumber: "+19055550124", assignedMyAiPaNumber: "+12895550198", carrier: "rogers", lineType: "mobile" });
  db.setup.status = "VERIFICATION_PENDING";
  db.attempts.push({ id: "attempt-timeout", setupId: setup.id, status: "PENDING", startedAt: new Date(Date.now() - 120000), expiresAt: new Date(Date.now() - 1000), verificationCallerNumber: "+12895550000", expectedDestination: "+12895550198" });
  const token = createSetupToken(db.setup, env);
  const failed = await getSetupFromToken({ prismaClient: prisma, token, env });
  assert.equal(failed.status, "VERIFICATION_FAILED");
  assert.match(failed.lastFailureReason, /didn't receive/i);
  assert.equal(db.attempts[0].status, "EXPIRED");
});

test("an answered test call tells the customer to leave the next call unanswered", async () => {
  const { prisma, db } = memoryPrisma();
  const setup = await initializeForwardingSetup({ prismaClient: prisma, signupId: "signup-answered", ownerEmail: "answered@example.ca", existingBusinessNumber: "+19055550127", assignedMyAiPaNumber: "+12895550195", carrier: "rogers", lineType: "mobile" });
  db.setup.status = "VERIFICATION_PENDING";
  db.attempts.push({ id: "attempt-answered", setupId: setup.id, status: "ANSWERED", startedAt: new Date(Date.now() - 200000), expiresAt: new Date(Date.now() - 1000), verificationCallerNumber: "+12895550000", expectedDestination: "+12895550195" });
  const failed = await getSetupFromToken({ prismaClient: prisma, token: createSetupToken(db.setup, env), env });
  assert.match(failed.lastFailureReason, /answered before it could forward/i);
  assert.equal(db.events.at(-1).metadata.reason, "answered_before_forwarding");
});

test("duplicate provisioning preserves a verified setup when the assigned number is unchanged", async () => {
  const { prisma, db } = memoryPrisma();
  const first = await initializeForwardingSetup({ prismaClient: prisma, signupId: "signup-replay", ownerEmail: "replay@example.ca", existingBusinessNumber: "+19055550126", assignedMyAiPaNumber: "+12895550196", carrier: "rogers", lineType: "mobile" });
  db.setup.status = "ACTIVE";
  db.setup.forwardingVerifiedAt = new Date("2026-09-06T12:00:00Z");
  const replay = await initializeForwardingSetup({ prismaClient: prisma, signupId: "signup-replay", ownerEmail: "replay@example.ca", existingBusinessNumber: "+19055550126", assignedMyAiPaNumber: "+12895550196", carrier: "not_sure", lineType: "not_sure" });
  assert.equal(replay.status, "ACTIVE");
  assert.equal(replay.carrier, "ROGERS");
  assert.equal(replay.lineType, "MOBILE");
  assert.equal(replay.forwardingVerifiedAt.toISOString(), "2026-09-06T12:00:00.000Z");
  assert.equal(first.signupKey, replay.signupKey);
});

test("verification call provider failure is recorded and can be retried", async () => {
  const { prisma, db } = memoryPrisma();
  const setup = await initializeForwardingSetup({ prismaClient: prisma, signupId: "signup-3", ownerEmail: "three@example.ca", existingBusinessNumber: "+19055550125", assignedMyAiPaNumber: "+12895550197", carrier: "rogers", lineType: "mobile" });
  await assert.rejects(() => startVerification({ prismaClient: prisma, setup, verificationCallerNumber: "+12895550000", statusCallbackUrl: "https://api.example.ca/callback", placeCall: async () => { throw Object.assign(new Error("Twilio unavailable"), { code: "TWILIO_DOWN" }); } }), /Twilio unavailable/);
  assert.equal(db.setup.status, "VERIFICATION_FAILED");
  assert.equal(db.attempts[0].status, "FAILED");
  assert.equal(db.events.some((event) => event.eventType === "verification_failed"), true);
});
