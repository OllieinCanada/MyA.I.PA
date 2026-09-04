const test = require("node:test");
const assert = require("node:assert/strict");
const { hasCompletedSignupForCall, signupOnlyMessageResult } = require("../server/vapiSignupMessagingGuard");

test("signup and customer-service messaging are separated by completed call state", async () => {
  let query;
  const locked = await hasCompletedSignupForCall({
    callExternalId: "call-signup-1",
    prisma: { vapiToolExecution: { findFirst: async (input) => { query = input; return { id: 7 }; } } },
  });
  assert.equal(locked, true);
  assert.deepEqual(query.where.toolName.in, ["begin_myaipa_signup", "start_myaipa_signup"]);
  assert.equal(query.where.status, "COMPLETED");
  assert.deepEqual(signupOnlyMessageResult(), {
    ok: false,
    skipped: true,
    status: "blocked_signup_call",
    reason: "signup_verification_only",
    message: "Signup calls can send only the verification link.",
  });
});

test("ordinary service messaging remains available for a non-signup call", async () => {
  const locked = await hasCompletedSignupForCall({
    callExternalId: "call-service-1",
    prisma: { vapiToolExecution: { findFirst: async () => null } },
  });
  assert.equal(locked, false);
});
