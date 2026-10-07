const { normalizeE164, sendSmsViaTwilio, fetchSmsStatusViaTwilio } = require("./twilioSms");

function verificationDeliveryFields(result = {}) {
  const status = String(result.status || "queued").toLowerCase();
  return {
    smsVerificationMessageSid: result.sid || "",
    smsVerificationProviderStatus: status,
    smsVerificationDeliveryStatus: ["delivered", "read"].includes(status) ? "delivered"
      : ["failed", "undelivered", "canceled"].includes(status) ? "failed" : "pending",
    smsVerificationErrorCode: result.errorCode || null,
  };
}

function verificationDeliveryUpdate(signup, { sid, status, errorCode } = {}) {
  if (!sid || signup.smsVerificationMessageSid !== sid) return null;
  if (signup.smsVerificationDeliveryStatus === "delivered") return null;
  if (signup.smsVerificationDeliveryStatus === "failed" && !["delivered", "read"].includes(status)) return null;
  return verificationDeliveryFields({ sid, status, errorCode });
}

function buildSignupVerificationText({ businessName, verificationUrl }) {
  return `Welcome abroad ${String(businessName || "your business").trim()} to my AI PA! tap link to continue. ${String(verificationUrl || "").trim()} This link expires in 24 hours.`;
}

async function deliverSignupVerificationText({
  ownerPhone,
  businessName,
  verificationUrl,
  sendSms = sendSmsViaTwilio,
  fetchStatus = sendSms === sendSmsViaTwilio ? fetchSmsStatusViaTwilio : null,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
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
  if (!result || result.mocked === true || !/^SM[0-9a-f]{32}$/i.test(result.sid || "")) {
    const error = new Error("The verification text was not accepted by the SMS provider.");
    error.statusCode = 503;
    error.code = "SIGNUP_SMS_VERIFICATION_NOT_SENT";
    throw error;
  }
  let delivery = result;
  // A timeout or missed callback is pending, not failure. Never resend here.
  for (let attempt = 0; typeof fetchStatus === "function" && attempt < 3; attempt += 1) {
    if (verificationDeliveryFields(delivery).smsVerificationDeliveryStatus !== "pending") break;
    if (attempt) await wait(1000);
    try { delivery = { ...delivery, ...await fetchStatus({ sid: result.sid }) }; }
    catch (_) { break; }
  }
  return { ...delivery, to };
}

module.exports = {
  buildSignupVerificationText,
  deliverSignupVerificationText,
  verificationDeliveryFields,
  verificationDeliveryUpdate,
};
