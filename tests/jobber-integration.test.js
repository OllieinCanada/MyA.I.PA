const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getAuthorizationUrl,
  parseState,
  syncLeadToJobber,
} = require("../server/jobberIntegration");

const env = {
  JOBBER_CLIENT_ID: "jobber-client-id",
  JOBBER_CLIENT_SECRET: "jobber-client-secret",
  JOBBER_REDIRECT_URI: "https://api.myaipa.ca/api/integrations/jobber/oauth/callback",
  FIELD_SERVICE_TOKEN_ENCRYPTION_KEY: "unit-test-token-encryption-key-that-is-long-enough",
  FIELD_SERVICE_OAUTH_STATE_SECRET: "unit-test-oauth-state-secret-that-is-long-enough",
};

test("Jobber authorization state is signed, expiring, and business-bound", () => {
  const url = new URL(getAuthorizationUrl({ businessId: 42, env }));
  assert.equal(url.origin, "https://api.getjobber.com");
  assert.equal(url.searchParams.get("client_id"), env.JOBBER_CLIENT_ID);
  assert.equal(url.searchParams.get("redirect_uri"), env.JOBBER_REDIRECT_URI);
  assert.equal(parseState(url.searchParams.get("state"), env).businessId, 42);
  assert.throws(() => parseState(`${url.searchParams.get("state")}x`, env), /invalid jobber connection state/i);
});

test("Jobber lead sync safely skips businesses that have not connected", async () => {
  const prisma = {
    lead: { findFirst: async () => ({ id: 9, businessId: 4, name: "Taylor Reed", callbackNumber: "+19055550123" }) },
    fieldServiceConnection: { findUnique: async () => null },
  };
  assert.deepEqual(await syncLeadToJobber({ prisma, businessId: 4, leadId: 9, env }), { skipped: true, reason: "jobber_not_connected" });
});
