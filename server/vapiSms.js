const { normalizeE164 } = require("./twilioSms");

function createHttpError(message, statusCode, extra = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  Object.assign(error, extra);
  return error;
}

function getVapiSmsConfig(env = process.env) {
  return {
    apiKey: String(env.VAPI_API_KEY || "").trim(),
    apiBaseUrl: String(env.VAPI_API_BASE_URL || "https://api.vapi.ai").trim().replace(/\/+$/, ""),
    assistantId: String(env.VAPI_SMS_ASSISTANT_ID || "").trim(),
    phoneNumberId: String(env.VAPI_SMS_PHONE_NUMBER_ID || "").trim(),
  };
}

function buildVapiSmsRequest({ to, message, config }) {
  const text = String(message || "").trim();
  if (!text) throw createHttpError("message is required", 400);
  if (text.length > 1600) throw createHttpError("message must be 1600 characters or fewer", 400);

  return {
    assistantId: config.assistantId,
    input: text,
    transport: {
      provider: "twilio",
      phoneNumberId: config.phoneNumberId,
      customer: { number: normalizeE164(to, "to") },
      useLLMGeneratedMessageForOutbound: false,
    },
  };
}

async function sendSmsViaVapi({ to, message, env = process.env, fetchImpl = global.fetch }) {
  const config = getVapiSmsConfig(env);
  const configured = Boolean(config.apiKey && config.assistantId && config.phoneNumberId);

  if (!configured) {
    if (String(env.NODE_ENV || "").toLowerCase() === "production") {
      throw createHttpError("Vapi SMS is not configured.", 503, { providerCode: "VAPI_SMS_NOT_CONFIGURED" });
    }
    return {
      mocked: true,
      provider: "vapi",
      status: "accepted",
      to: normalizeE164(to, "to"),
      requestId: `mock-vapi-${Date.now()}`,
      messageId: null,
      createdAt: new Date().toISOString(),
    };
  }

  if (typeof fetchImpl !== "function") {
    throw createHttpError("Vapi SMS transport is unavailable.", 503, { providerCode: "VAPI_FETCH_UNAVAILABLE" });
  }

  const requestBody = buildVapiSmsRequest({ to, message, config });
  const response = await fetchImpl(`${config.apiBaseUrl}/chat`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw createHttpError("Vapi could not accept the SMS request.", 502, {
      providerStatus: response.status,
      providerCode: payload?.code || payload?.error?.code || "VAPI_SMS_REJECTED",
    });
  }

  return {
    mocked: false,
    provider: "vapi",
    status: "accepted",
    to: requestBody.transport.customer.number,
    requestId: payload?.id || payload?.chatId || "",
    messageId: payload?.message?.id || payload?.messageId || null,
    sessionId: payload?.sessionId || payload?.session?.id || null,
    createdAt: payload?.createdAt || new Date().toISOString(),
  };
}

module.exports = {
  buildVapiSmsRequest,
  getVapiSmsConfig,
  sendSmsViaVapi,
};
