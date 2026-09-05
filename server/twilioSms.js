const { isSmsSuppressed } = require("./smsSuppression");

function createHttpError(message, statusCode, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
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
    apiKeySid: String(env.TWILIO_API_KEY_SID || "").trim(),
    apiKeySecret: String(env.TWILIO_API_KEY_SECRET || "").trim(),
    from: String(env.TWILIO_FROM_NUMBER || env.OWNER_SMS_FROM || "").trim(),
    statusCallbackUrl: String(env.TWILIO_STATUS_CALLBACK_URL || "").trim(),
    apiBaseUrl: String(env.TWILIO_API_BASE_URL || "https://api.twilio.com").trim().replace(/\/+$/, ""),
  };
}

function getTwilioRestCredentials(config) {
  const hasApiKey = Boolean(config.apiKeySid && config.apiKeySecret);
  return {
    username: hasApiKey ? config.apiKeySid : config.accountSid,
    password: hasApiKey ? config.apiKeySecret : config.authToken,
    mode: hasApiKey ? "api_key" : "auth_token",
  };
}

function getTwilioFailureSignal(payload = {}) {
  const code = String(payload?.code || "").trim();
  const message = String(payload?.message || "").trim().toUpperCase();

  if (/\b(?:BALANCE|BILLING|UNPAID|PAST[ _-]?DUE|PAYMENT|ADD FUNDS?)\b/.test(message)) {
    return "TWILIO_BILLING_RESTRICTED";
  }
  if (
    ["10001", "20005", "30002"].includes(code)
    || /\b(?:ACCOUNT (?:IS )?NOT ACTIVE|ACCOUNT INACTIVE|ACCOUNT (?:IS )?SUSPENDED|SUSPENDED ACCOUNT|ACCOUNT (?:IS )?CLOSED)\b/.test(message)
  ) {
    return "TWILIO_ACCOUNT_INACTIVE_OR_SUSPENDED";
  }
  // Twilio documents 20003 as both an authentication-shaped failure and a
  // possible suspended/closed account. Do not collapse it to "bad token."
  if (code === "20003") return "TWILIO_ACCOUNT_ACCESS_AMBIGUOUS";
  if (/\b(?:INVALID USERNAME|INVALID CREDENTIALS?|AUTHENTICATION (?:ERROR|FAILED)|PERMISSION DENIED)\b/.test(message)) {
    return "TWILIO_AUTHENTICATION_REJECTED";
  }
  return "";
}

async function sendSmsViaTwilio({
  to,
  from,
  message,
  env = process.env,
  fetchImpl = global.fetch,
  suppressionChecker = isSmsSuppressed,
}) {
  const text = String(message || "").trim();
  if (!text) throw createHttpError("message is required", 400);
  if (text.length > 1600) throw createHttpError("message must be 1600 characters or fewer", 400);

  const normalizedTo = normalizeE164(to, "to");
  const config = { ...getTwilioSmsConfig(env), ...(from ? { from: String(from).trim() } : {}) };
  const credentials = getTwilioRestCredentials(config);
  const configured = Boolean(config.accountSid && credentials.username && credentials.password && config.from);
  if (!configured) {
    if (String(env.NODE_ENV || "").toLowerCase() === "production") {
      throw createHttpError("Twilio SMS is not configured.", 503);
    }
    return {
      mocked: true,
      provider: "console",
      to: normalizedTo,
      from: config.from || null,
      message: text,
      status: "mocked",
      createdAt: new Date().toISOString(),
    };
  }

  if (typeof fetchImpl !== "function") {
    throw createHttpError("SMS transport is unavailable.", 503);
  }

  let suppressed;
  try {
    suppressed = await suppressionChecker(normalizedTo);
  } catch (_error) {
    throw createHttpError("SMS consent status could not be verified.", 503, "SMS_SUPPRESSION_CHECK_UNAVAILABLE");
  }
  if (suppressed) {
    throw createHttpError("This recipient has paused service text messages.", 409, "SMS_RECIPIENT_SUPPRESSED");
  }

  const normalizedFrom = normalizeE164(config.from, "TWILIO_FROM_NUMBER");
  const body = new URLSearchParams({ To: normalizedTo, From: normalizedFrom, Body: text });
  if (/^https:\/\//i.test(config.statusCallbackUrl)) {
    body.set("StatusCallback", config.statusCallbackUrl);
  }
  const response = await fetchImpl(
    `${config.apiBaseUrl}/2010-04-01/Accounts/${encodeURIComponent(config.accountSid)}/Messages.json`,
    {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString("base64")}`,
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
    error.providerSignal = getTwilioFailureSignal(payload);
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
  getTwilioFailureSignal,
  getTwilioRestCredentials,
  normalizeE164,
  sendSmsViaTwilio,
};
