const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const jwt = require("jsonwebtoken");
const {
  createSetupToken,
  getSetupFromToken,
  issueShortSetupToken,
  signupKeyFor,
  transitionStatus,
  verifySetupToken,
} = require("../server/callForwardingService");

const env = { FORWARDING_SETUP_SECRET: "this-is-a-long-forwarding-test-secret-12345", FORWARDING_SETUP_URL_TTL_SECONDS: "600" };
const setup = { id: "setup_123", signupKey: "key_abc" };

test("signed setup links identify one setup without containing Twilio credentials", () => {
  const token = createSetupToken(setup, env);
  const decoded = verifySetupToken(token, env);
  assert.equal(decoded.sid, setup.id);
  assert.equal(decoded.sk, setup.signupKey);
  assert.equal(token.includes("TWILIO"), false);
  assert.throws(() => verifySetupToken(`${token.slice(0, -1)}x`, env), /invalid or has expired/i);
});

test("signed setup links expire and reject the wrong audience", () => {
  const expired = jwt.sign({ typ: "forwarding-setup", sid: setup.id, sk: setup.signupKey }, env.FORWARDING_SETUP_SECRET, { algorithm: "HS256", expiresIn: -1, issuer: "myaipa-api", audience: "myaipa-forwarding-setup" });
  assert.throws(() => verifySetupToken(expired, env), /expired/i);
});

test("short setup links are random, hashed at rest, account-bound, and expire", async () => {
  const rows = [];
  const storedSetup = { ...setup, status: "READY_TO_ACTIVATE" };
  const prisma = {
    callForwardingSetupLink: {
      deleteMany: async () => ({ count: 0 }),
      create: async ({ data }) => {
        rows.push({ ...data, setup: storedSetup });
        return rows.at(-1);
      },
      findUnique: async ({ where }) => rows.find((row) => row.tokenHash === where.tokenHash) || null,
    },
    callForwardingSetup: { findUnique: async () => storedSetup },
    forwardingVerificationAttempt: { findFirst: async () => null },
  };
  const issued = await issueShortSetupToken({ prismaClient: prisma, setup: storedSetup, env });
  assert.equal(issued.token.length, 24);
  assert.equal(rows[0].tokenHash.length, 64);
  assert.equal(rows[0].tokenHash.includes(issued.token), false);
  assert.equal((await getSetupFromToken({ prismaClient: prisma, token: issued.token, env })).id, setup.id);
  await assert.rejects(() => getSetupFromToken({ prismaClient: prisma, token: `${issued.token.slice(0, -1)}x`, env }), /invalid or has expired/i);
  rows[0].expiresAt = new Date(Date.now() - 1000);
  await assert.rejects(() => getSetupFromToken({ prismaClient: prisma, token: issued.token, env }), /expired/i);
});

test("signup keys are stable but do not expose customer contact data", () => {
  const key = signupKeyFor({ signupId: "signup-1", ownerEmail: "Owner@Example.ca", existingBusinessNumber: "905-555-0123" });
  assert.equal(key.length, 64);
  assert.equal(key.includes("owner"), false);
  assert.equal(key, signupKeyFor({ signupId: "signup-1", ownerEmail: "owner@example.ca", existingBusinessNumber: "+19055550123" }));
});

test("forwarding state transitions are explicit, idempotent, and fail closed", () => {
  assert.equal(transitionStatus("READY_TO_ACTIVATE", "dialer_opened"), "DIALER_OPENED");
  assert.equal(transitionStatus("ACTIVE", "active"), "ACTIVE");
  assert.throws(() => transitionStatus("NOT_STARTED", "active"), /Cannot change/);
  assert.throws(() => transitionStatus("ACTIVE", "destroyed"), /Unknown/);
});

test("the API accepts the signed token only in the authorization header", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "server", "index.js"), "utf8");
  const helper = source.match(/function getForwardingBearerToken[\s\S]*?\n}/)?.[0] || "";
  assert.match(helper, /req\.headers\.authorization/);
  assert.doesNotMatch(helper, /req\.query|req\.body/);
  assert.match(source, /forwarding-verification-status",\s*forwardingVerificationCallbackProcessRateLimiter,\s*enforcePublicRouteRateLimit\("forwarding-verification-callback"/);
  assert.match(source, /forwarding\/setup-link",\s*enforcePublicRouteRateLimit\("forwarding-dashboard-link"/);
  assert.match(source, /#\/f\/\$\{encodeURIComponent\(shortLink\.token\)\}/);
  assert.doesNotMatch(source, /window\.location\.href\s*=\s*\$\{JSON\.stringify\(forwardingSetupUrl\)/);
  assert.match(source, /res\.redirect\(303, forwardingSetup\.setupUrl\)/);
});
