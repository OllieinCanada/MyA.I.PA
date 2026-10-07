const test = require("node:test");
const assert = require("node:assert/strict");
const { assertTrialGateOwnership } = require("../server/trialGateOwnership");
const { signupBusinessKey } = require("../server/signupBusinessIdentity");
const { getTrialLifecycle, decideTrialCall } = require("../server/trialUsagePolicy");
const signup = { signupAttemptId: "one", businessName: "One Electric", ownerEmail: "owner@example.test", ownerPhone: "+19055550123", twilioPhoneNumber: "+12895550123", subscriptionId: "sub_one", subscriptionStatus: "trialing" };
const conflict = fn => assert.throws(fn, { code: "TRIAL_GATE_OWNERSHIP_CONFLICT" });

test("archived billing history cannot activate a trial or paid routing", () => {
  for (const subscriptionStatus of ["trialing", "active"]) {
    const lifecycle = getTrialLifecycle({ ...signup, archivedAt: "2026-10-01", subscriptionStatus });
    assert.equal(lifecycle.state, "archived");
    assert.equal(decideTrialCall({ lifecycle }).action, "block");
  }
});
test("same owner, different businesses cannot share an active trial phone", () => {
  conflict(() => assertTrialGateOwnership(signup, null, [signup, { ...signup, signupAttemptId: "two", businessName: "Two Plumbing" }]));
  conflict(() => assertTrialGateOwnership({ ...signup, signupAttemptId: undefined }, null, [{ ...signup, signupAttemptId: undefined, businessName: "Two Plumbing" }]));
});
test("an archived record cannot configure routing", () => {
  conflict(() => assertTrialGateOwnership({ ...signup, status: "abandoned_archived" }, null, []));
});
test("legacy gate must match the exact open subscription and business", () => {
  assertTrialGateOwnership(signup, { subscriptionId: "sub_one" }, [signup]);
  conflict(() => assertTrialGateOwnership(signup, { subscriptionId: "sub_old" }, [signup]));
  conflict(() => assertTrialGateOwnership(signup, { subscriptionId: "sub_one" }, [{ ...signup, archivedAt: "2026-10-01" }]));
  conflict(() => assertTrialGateOwnership(signup, { ownerEmail: signup.ownerEmail }, [signup]));
});
test("business-scoped gate allows same-business retry but rejects reassignment", () => {
  assertTrialGateOwnership(signup, { businessKey: signupBusinessKey(signup) }, [signup]);
  conflict(() => assertTrialGateOwnership(signup, { businessKey: "other" }, [signup]));
});
test("archived history does not claim a new unconfigured business phone", () => {
  assertTrialGateOwnership(signup, null, [signup, { ...signup, signupAttemptId: "old", businessName: "Old Plumbing", archivedAt: "2026-10-01" }]);
});
test("reused trial gate proves CRM ownership before patching provider routing", () => {
  const source = require("node:fs").readFileSync(require.resolve("../server/index.js"), "utf8");
  const branch = source.slice(source.indexOf("if (!currentAssistantId && existingConfig?.assistantId)"), source.indexOf("if (!currentAssistantId) {", source.indexOf("if (!currentAssistantId && existingConfig?.assistantId)")));
  assert.ok(branch.indexOf("ensureTrialBusinessAndMappings") < branch.indexOf("method: \"PATCH\""));
  assert.ok(branch.includes("...signup,"));
});
