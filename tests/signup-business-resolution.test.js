const test = require("node:test");
const assert = require("node:assert/strict");

const {
  persistSignupBusinessId,
  resolveBusinessForSignup,
} = require("../server/signupBusinessResolution");

function createFakeDb({ businesses = [], mappings = [] } = {}) {
  const calls = { businessFindUnique: 0, businessFindMany: 0, mappingFindUnique: 0 };
  const db = {
    business: {
      async findUnique({ where }) {
        calls.businessFindUnique += 1;
        return businesses.find((business) => business.id === where.id) || null;
      },
      async findMany({ where, take }) {
        calls.businessFindMany += 1;
        return businesses.filter((business) => where.OR.some((condition) => {
          if (condition.name) {
            return String(business.name || "").toLowerCase() === String(condition.name.equals || "").toLowerCase();
          }
          if (condition.phone) return business.phone === condition.phone;
          return false;
        })).slice(0, take);
      },
    },
    vapiBusinessMapping: {
      async findUnique({ where }) {
        calls.mappingFindUnique += 1;
        const mapping = mappings.find((item) => item.matchValue === where.matchValue);
        if (!mapping) return null;
        return {
          ...mapping,
          business: businesses.find((business) => business.id === mapping.businessId) || null,
        };
      },
    },
  };
  return { db, calls };
}

test("persisted businessId wins without consulting ambiguous legacy identities", async () => {
  const first = { id: 11, name: "Same Name Electric", phone: "+19055550100" };
  const second = { id: 22, name: "Same Name Electric", phone: "+19055550100" };
  const { db, calls } = createFakeDb({ businesses: [first, second] });

  const business = await resolveBusinessForSignup({
    signup: { businessId: 22, businessName: "Same Name Electric", businessPhone: "+1 905 555 0100" },
    db,
  });

  assert.equal(business.id, 22);
  assert.equal(calls.businessFindUnique, 1);
  assert.equal(calls.mappingFindUnique, 0);
  assert.equal(calls.businessFindMany, 0);
});

test("a stale or malformed persisted businessId fails closed without legacy fallback", async () => {
  const onlyBusiness = { id: 11, name: "Reusable Name Electric", phone: "+19055550100" };
  const stale = createFakeDb({ businesses: [onlyBusiness] });

  const staleResult = await resolveBusinessForSignup({
    signup: { businessId: 999, businessName: onlyBusiness.name, businessPhone: onlyBusiness.phone },
    db: stale.db,
  });
  assert.equal(staleResult, null);
  assert.equal(stale.calls.businessFindUnique, 1);
  assert.equal(stale.calls.mappingFindUnique, 0);
  assert.equal(stale.calls.businessFindMany, 0);

  const malformed = createFakeDb({ businesses: [onlyBusiness] });
  const malformedResult = await resolveBusinessForSignup({
    signup: { businessId: "not-a-business", businessName: onlyBusiness.name, businessPhone: onlyBusiness.phone },
    db: malformed.db,
  });
  assert.equal(malformedResult, null);
  assert.equal(malformed.calls.businessFindUnique, 0);
  assert.equal(malformed.calls.mappingFindUnique, 0);
  assert.equal(malformed.calls.businessFindMany, 0);
});

test("exact assigned AI-number mapping wins when legacy name and phone are duplicated", async () => {
  const first = { id: 11, name: "Same Name Electric", phone: "+19055550100" };
  const second = { id: 22, name: "Same Name Electric", phone: "+19055550100" };
  const { db, calls } = createFakeDb({
    businesses: [first, second],
    mappings: [{ businessId: 22, matchType: "phoneNumber", matchValue: "+12895550199" }],
  });

  const business = await resolveBusinessForSignup({
    signup: {
      twilioPhoneNumber: "+1 (289) 555-0199",
      businessName: "Same Name Electric",
      businessPhone: "+1 905 555 0100",
    },
    db,
  });

  assert.equal(business.id, 22);
  assert.equal(calls.mappingFindUnique, 1);
  assert.equal(calls.businessFindMany, 0);
});

test("duplicate legacy business names fail closed", async () => {
  const { db } = createFakeDb({
    businesses: [
      { id: 11, name: "Shared Electric", phone: "+19055550111" },
      { id: 22, name: "Shared Electric", phone: "+19055550222" },
    ],
  });

  const business = await resolveBusinessForSignup({
    signup: { businessName: "Shared Electric" },
    db,
  });

  assert.equal(business, null);
});

test("duplicate legacy business phones fail closed", async () => {
  const { db } = createFakeDb({
    businesses: [
      { id: 11, name: "North Electric", phone: "+19055550111" },
      { id: 22, name: "South Electric", phone: "+19055550111" },
    ],
  });

  const business = await resolveBusinessForSignup({
    signup: { businessPhone: "+1 (905) 555-0111" },
    db,
  });

  assert.equal(business, null);
});

test("a phone-shaped non-phone Vapi mapping is not accepted as tenant proof", async () => {
  const { db } = createFakeDb({
    businesses: [{ id: 11, name: "North Electric", phone: "+19055550111" }],
    mappings: [{ businessId: 11, matchType: "assistantId", matchValue: "+12895550199" }],
  });

  const business = await resolveBusinessForSignup({
    signup: { twilioPhoneNumber: "+1 (289) 555-0199" },
    db,
  });

  assert.equal(business, null);
});

test("proven businessId is persisted only onto one matching existing signup record", () => {
  let writtenStore = null;
  const store = {
    "email:owner@example.com": {
      ownerEmail: "owner@example.com",
      businessName: "Example Electric",
      status: "setup_ready",
    },
  };

  const result = persistSignupBusinessId({
    signup: { ownerEmail: "OWNER@example.com" },
    businessId: 42,
    readStore: () => structuredClone(store),
    writeStore: (next) => { writtenStore = next; },
    now: () => new Date("2026-08-26T12:00:00.000Z"),
  });

  assert.deepEqual(result, {
    persisted: true,
    key: "email:owner@example.com",
    businessId: 42,
  });
  assert.equal(writtenStore["email:owner@example.com"].businessId, 42);
  assert.equal(writtenStore["email:owner@example.com"].status, "setup_ready");
  assert.equal(writtenStore["email:owner@example.com"].updatedAt, "2026-08-26T12:00:00.000Z");
});

test("businessId persistence refuses conflicting or ambiguous signup records", () => {
  let writes = 0;
  const conflict = persistSignupBusinessId({
    signup: { ownerEmail: "owner@example.com" },
    businessId: 42,
    readStore: () => ({ "email:owner@example.com": { ownerEmail: "owner@example.com", businessId: 7 } }),
    writeStore: () => { writes += 1; },
  });
  assert.equal(conflict.persisted, false);
  assert.equal(conflict.reason, "business-conflict");

  const ambiguous = persistSignupBusinessId({
    signup: { ownerEmail: "owner@example.com", subscriptionId: "sub_123" },
    businessId: 42,
    readStore: () => ({
      "email:owner@example.com": { ownerEmail: "owner@example.com" },
      "sub:sub_123": { subscriptionId: "sub_123" },
    }),
    writeStore: () => { writes += 1; },
  });
  assert.equal(ambiguous.persisted, false);
  assert.equal(ambiguous.reason, "ambiguous-signup");
  assert.equal(writes, 0);
});
