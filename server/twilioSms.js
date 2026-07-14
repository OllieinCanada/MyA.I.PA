function createHttpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeE164(value, field) {
  const raw = String(value || "").trim();
  const digits = raw.replace(/\D/g, "");
  const normalized = raw.startsWith("+")
    ? `+${digits}`
    : digits.length === 10
      ? `+1${digits}`
      : `+${digits}`;
  if (!/^\+[1-9]\d{7,14}$/.test(normalized)) {
    throw createHttpError(`${field} must be a valid E.164 phone number.`, 400);
  }
  return normalized;
}

function getTwilioSmsConfig(env = process.env) {
  return {
    accountSid: String(env.TWILIO_ACCOUNT_SID || "").trim(),
    authToken: String(env.TWILIO_AUTH_TOKEN || "").trim(),
    from: String(env.TWILIO_FROM_NUMBER || env.OWNER_SMS_FROM || "").trim(),
    apiBaseUrl: String(env.TWILIO_API_BASE_URL || "https://api.twilio.com").trim().replace(/\/+$/, ""),
  };
}

async function sendSmsViaTwilio({ to, message, env = process.env, fetchImpl = global.fetch }) {
  const text = String(message || "").trim();
  if (!text) throw createHttpError("message is required", 400);
  if (text.length > 1600) throw createHttpError("message must be 1600 characters or fewer", 400);

  const config = getTwilioSmsConfig(env);
  const configured = Boolean(config.accountSid && config.authToken && config.from);
  if (!configured) {
    if (String(env.NODE_ENV || "").toLowerCase() === "production") {
      throw createHttpError("Twilio SMS is not configured.", 503);
    }
    return {
      mocked: true,
      provider: "console",
      to: normalizeE164(to, "to"),
      from: config.from || null,
      message: text,
      status: "mocked",
      createdAt: new Date().toISOString(),
    };
  }

  if (typeof fetchImpl !== "function") {
    throw createHttpError("SMS transport is unavailable.", 503);
  }

  const normalizedTo = normalizeE164(to, "to");
  const normalizedFrom = normalizeE164(config.from, "TWILIO_FROM_NUMBER");
  const body = new URLSearchParams({ To: normalizedTo, From: normalizedFrom, Body: text });
  const response = await fetchImpl(
    `${config.apiBaseUrl}/2010-04-01/Accounts/${encodeURIComponent(config.accountSid)}/Messages.json`,
    {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body: body.toString(),
    }
  );

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = createHttpError("Twilio could not deliver the SMS request.", 502);
    error.providerStatus = response.status;
    error.providerCode = payload?.code || null;
    throw error;
  }

  return {
    mocked: false,
    provider: "twilio",
    sid: payload?.sid || "",
    status: payload?.status || "queued",
    to: payload?.to || normalizedTo,
    from: payload?.from || normalizedFrom,
    createdAt: payload?.date_created || new Date().toISOString(),
  };
}

module.exports = {
  getTwilioSmsConfig,
  normalizeE164,
  sendSmsViaTwilio,
};
