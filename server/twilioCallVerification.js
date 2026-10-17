// Permanent guard: stale clients and old credentials cannot restart callback
// tests. Forwarding setup is customer-led and makes no outbound test call.
const FORWARDING_TEST_CALLS_DISABLED = Object.freeze({
  ok: false,
  code: "FORWARDING_TEST_CALLS_DISABLED",
  error: "Automatic forwarding test calls have been removed. Open your setup link and follow the instructions from your business phone. My AI PA will not call you to test forwarding.",
});

function forwardingTestCallsDisabledError() {
  return Object.assign(new Error(FORWARDING_TEST_CALLS_DISABLED.error), {
    code: FORWARDING_TEST_CALLS_DISABLED.code,
    statusCode: 410,
  });
}

async function placeForwardingVerificationCall() {
  throw forwardingTestCallsDisabledError();
}

module.exports = { FORWARDING_TEST_CALLS_DISABLED, forwardingTestCallsDisabledError, placeForwardingVerificationCall };
