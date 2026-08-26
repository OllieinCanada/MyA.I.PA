const assert = require("node:assert/strict");
const test = require("node:test");

const {
  resolveLegacyOwnerSmsBusinessRoute,
} = require("../server/legacyOwnerSmsRouting");

function fakePrisma({ businesses = [], calls = [] } = {}) {
  return {
    business: {
      findUnique: async ({ where }) => businesses.find((business) => business.id === where.id) || null,
    },
    call: {
      findFirst: async ({ where }) => calls.find((call) => where.OR.some((candidate) => (
        (candidate.id && candidate.id === call.id)
          || (candidate.externalId && candidate.externalId === call.externalId)
      ))) || null,
    },
  };
}

test("legacy owner SMS routing rejects a missing business and call context", async () => {
  await assert.rejects(
    resolveLegacyOwnerSmsBusinessRoute(
      { eventId: "event-missing-route" },
      { prismaClient: fakePrisma(), resolveMappedBusinessId: async () => 1 }
    ),
    (error) => error.statusCode === 422 && error.code === "VAPI_BUSINESS_ROUTE_REQUIRED"
  );
});

test("legacy owner SMS routing rejects malformed and unknown business IDs", async () => {
  await assert.rejects(
    resolveLegacyOwnerSmsBusinessRoute(
      { eventId: "event-invalid-route", businessId: "1 OR 1=1" },
      { prismaClient: fakePrisma(), resolveMappedBusinessId: async () => 1 }
    ),
    (error) => error.statusCode === 422 && error.code === "VAPI_BUSINESS_ROUTE_INVALID"
  );

  await assert.rejects(
    resolveLegacyOwnerSmsBusinessRoute(
      { eventId: "event-unknown-route", businessId: 77 },
      { prismaClient: fakePrisma(), resolveMappedBusinessId: async () => 77 }
    ),
    (error) => error.statusCode === 422 && error.code === "VAPI_BUSINESS_ROUTE_NOT_FOUND"
  );
});

test("legacy owner SMS routing rejects explicit and stored-call cross-tenant conflicts", async () => {
  const prismaClient = fakePrisma({
    businesses: [{ id: 1 }, { id: 2 }],
    calls: [{ id: 41, externalId: "call-business-one", businessId: 1 }],
  });
  await assert.rejects(
    resolveLegacyOwnerSmsBusinessRoute(
      {
        eventId: "event-cross-tenant",
        businessId: 2,
        callId: "call-business-one",
      },
      { prismaClient, resolveMappedBusinessId: async () => 2 }
    ),
    (error) => error.statusCode === 409 && error.code === "VAPI_BUSINESS_ROUTE_CONFLICT"
  );
});

test("legacy owner SMS routing accepts one existing business when all trusted routes agree", async () => {
  const prismaClient = fakePrisma({
    businesses: [{ id: 7 }],
    calls: [{ id: 42, externalId: "call-business-seven", businessId: 7 }],
  });
  const result = await resolveLegacyOwnerSmsBusinessRoute(
    {
      eventId: "event-agrees",
      businessId: 7,
      call: {
        id: "call-business-seven",
        assistantId: "assistant-business-seven",
      },
    },
    { prismaClient, resolveMappedBusinessId: async () => 7 }
  );

  assert.deepEqual(result, {
    businessId: 7,
    sources: ["explicit_business", "stored_call", "vapi_mapping"],
  });
});
