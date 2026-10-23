// IP limits count every attempt; identity limits count only verified, complete
// submissions. Never consume single-use proofs when the IP is already limited.
async function checkSignupAdmission({ security, ip, contactComplete }, { consumeIp, verifyCaptcha, consumeIdentity }) {
  const ipLimit = await consumeIp();
  if (!ipLimit.allowed) return { reasons: ["ip_rate_limit"], retryAfterMs: ipLimit.retryAfterMs };
  if (String(security.companyWebsite || "").trim()) return { reasons: ["bot_trap_filled"] };
  if (!contactComplete) return { reasons: ["missing_contact_detail"] };
  const captcha = await verifyCaptcha(security, ip);
  if (!captcha.ok) return { reasons: [captcha.reason || "captcha_failed"], captcha };
  const identityLimit = await consumeIdentity();
  return {
    reasons: identityLimit.allowed ? [] : ["identity_rate_limit"],
    retryAfterMs: identityLimit.allowed ? undefined : identityLimit.retryAfterMs,
    captcha,
  };
}

function signupSecurityResponse(reasons = []) {
  if (reasons.some((reason) => ["ip_rate_limit", "identity_rate_limit"].includes(reason))) {
    return { status: 429, body: { code: "SIGNUP_RATE_LIMITED", resetCaptcha: true,
      error: "Too many signup attempts. Please wait before trying again." } };
  }
  if (reasons.includes("missing_contact_detail")) {
    return { status: 400, body: { code: "SIGNUP_CONTACT_REQUIRED", resetCaptcha: true,
      error: "Please enter your contact phone, business phone and business address before continuing." } };
  }
  if (reasons.includes("bot_trap_filled")) {
    return { status: 400, body: { code: "SIGNUP_REJECTED", resetCaptcha: true,
      error: "Signup could not be completed right now. Please try again later." } };
  }
  const unavailable = reasons.some((reason) => ["captcha_unreachable", "captcha_not_configured",
    "captcha_provider_not_configured", "captcha_test_secret_forbidden", "invalid-input-secret", "missing-input-secret"].includes(reason));
  return { status: unavailable ? 503 : 400, body: {
    code: unavailable ? "SIGNUP_VERIFICATION_UNAVAILABLE" : "SIGNUP_CAPTCHA_FAILED", resetCaptcha: true,
    error: unavailable ? "Verification is temporarily unavailable. Please wait a moment and try again."
      : "Verification expired or could not be confirmed. Please complete the verification checks again and resubmit. Your form details are still here.",
  } };
}

module.exports = { checkSignupAdmission, signupSecurityResponse };
