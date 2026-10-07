const { isClosedSignup, signupBusinessKey } = require("./signupBusinessIdentity");
const { normalizeNorthAmericanE164 } = require("./canadianPhoneNumber");

function assertTrialGateOwnership(signup, existing, records = []) {
  const fail = () => { throw Object.assign(new Error("This trial phone has conflicting or unverified business ownership. Routing was not changed."), { code: "TRIAL_GATE_OWNERSHIP_CONFLICT", statusCode: 409 }); };
  if (isClosedSignup(signup)) fail();
  const key = signupBusinessKey(signup);
  if (!key) fail();
  const number = normalizeNorthAmericanE164(signup.twilioPhoneNumber);
  for (const other of records) {
    if (isClosedSignup(other) || (signup.signupAttemptId && other.signupAttemptId === signup.signupAttemptId)) continue;
    if (number && normalizeNorthAmericanE164(other.twilioPhoneNumber) === number && signupBusinessKey(other) !== key) fail();
  }
  if (!existing) return;
  // Old configurations carried only a subscription. Require that exact receipt
  // AND an unambiguous open business, never an owner-email match.
  if (existing.businessKey) {
    if (existing.businessKey !== key) fail();
  } else {
    if (!existing.subscriptionId || existing.subscriptionId !== signup.subscriptionId) fail();
    const owners = records.filter(row => row.subscriptionId === existing.subscriptionId);
    if (!owners.length || owners.some(row => isClosedSignup(row) || signupBusinessKey(row) !== key)) fail();
  }
}

module.exports = { assertTrialGateOwnership };
