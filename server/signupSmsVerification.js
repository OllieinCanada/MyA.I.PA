const { normalizeE164, sendSmsViaTwilio } = require("./twilioSms");

function buildSignupVerificationText({ businessName, verificationUrl }) {
  return `My AI PA signup for ${String(businessName || "your business").trim()}: tap to verify your phone and continue setup. ${String(verificationUrl || "").trim()} This link expires in 24 hours.`;
}

async function deliverSignupVerificationText({
  ownerPhone,
  businessName,
  verificationUrl,
  sendSms = sendSmsViaTwilio,
} = {}) {
  const to = normalizeE164(ownerPhone, "Owner phone");
  const url = String(verificationUrl || "").trim();
  if (!/^https:\/\//i.test(url)) {
    const error = new Error("The signup verification URL must use HTTPS.");
    error.statusCode = 500;
    error.code = "SIGNUP_VERIFICATION_URL_INVALID";
    throw error;
  }
  const result = await sendSms({
    to,
    message: buildSignupVerificationText({ businessName, verificationUrl: url }),
  });
  if (!result || result.mocked === true) {
    const error = new Error("The verification text was not accepted by the SMS provider.");
    error.statusCode = 503;
    error.code = "SIGNUP_SMS_VERIFICATION_NOT_SENT";
    throw error;
  }
  return { ...result, to };
}

module.exports = {
  buildSignupVerificationText,
  deliverSignupVerificationText,
};
