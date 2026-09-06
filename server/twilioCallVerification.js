const { normalizeSmsPhone } = require("./smsSuppression");

function buildBasicAuth(accountSid, apiKeySid, apiKeySecret, authToken) {
  const username = String(apiKeySid || accountSid || "").trim();
  const password = String(apiKeySecret || authToken || "").trim();
  if (!accountSid || !username || !password) {
    const error = new Error("Twilio verification-call credentials are not configured.");
    error.code = "FORWARDING_TWILIO_NOT_CONFIGURED";
    error.statusCode = 503;
    throw error;
  }
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

async function placeForwardingVerificationCall({
  to,
  from,
  statusCallbackUrl,
  attemptId,
  env = process.env,
  fetchImpl = global.fetch,
}) {
  const accountSid = String(env.TWILIO_ACCOUNT_SID || "").trim();
  const authorization = buildBasicAuth(
    accountSid,
    env.TWILIO_API_KEY_SID,
    env.TWILIO_API_KEY_SECRET,
    env.TWILIO_AUTH_TOKEN
  );
  const destination = normalizeSmsPhone(to, "existingBusinessNumber");
  const callerId = normalizeSmsPhone(from, "verificationCallerNumber");
  if (typeof fetchImpl !== "function") throw new Error("fetch is unavailable");

  const form = new URLSearchParams();
  form.set("To", destination);
  form.set("From", callerId);
  form.set("Timeout", "30");
  form.set("MachineDetection", "Enable");
  form.set("Twiml", `<Response><Pause length="35"/><Hangup/></Response>`);
  form.set("StatusCallback", statusCallbackUrl);
  form.set("StatusCallbackEvent", "initiated ringing answered completed");
  form.set("StatusCallbackMethod", "POST");
  form.set("Recording", "false");

  const response = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Calls.json`, {
    method: "POST",
    headers: { Authorization: authorization, "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text }; }
  if (!response.ok || !data.sid) {
    const error = new Error(data.message || `Twilio verification call failed (${response.status}).`);
    error.code = "FORWARDING_VERIFICATION_CALL_FAILED";
    error.providerCode = data.code;
    error.statusCode = response.status >= 400 && response.status < 500 ? 400 : 502;
    throw error;
  }
  return { sid: data.sid, status: data.status || "queued", to: destination, from: callerId, attemptId };
}

module.exports = { buildBasicAuth, placeForwardingVerificationCall };
