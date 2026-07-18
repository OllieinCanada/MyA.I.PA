const COMPOSITE_TOOL_NAME = "send_call_summaries_dynamic";

function cleanText(value, maxLength = 500) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function normalizeE164(value) {
  const raw = String(value || "").trim();
  const digits = raw.replace(/\D/g, "");
  const normalized = raw.startsWith("+") ? `+${digits}` : digits.length === 10 ? `+1${digits}` : `+${digits}`;
  return /^\+[1-9]\d{7,14}$/.test(normalized) ? normalized : "";
}

function stableHash(value) {
  let hash = 2166136261;
  const text = String(value || "");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function buildNotificationKeys(callId) {
  const base = cleanText(callId, 180);
  return {
    owner: stableHash(`${base}:owner`),
    customer: stableHash(`${base}:customer`),
  };
}

function buildOwnerBody(args) {
  const requestType = cleanText(args.requestType || "service", 40).toLowerCase();
  const name = cleanText(args.name || "Unknown caller", 120);
  const phone = normalizeE164(args.rawPhoneNumber || args.callbackNumber) || cleanText(args.rawPhoneNumber || args.callbackNumber, 40);
  if (requestType === "message") {
    return [
      "Message request:",
      `- Name: ${name}`,
      `- Phone: ${phone || "Not provided"}`,
      `- Message: ${cleanText(args.message || "No message provided", 500)}`,
    ].join("\n").slice(0, 1600);
  }
  const lines = [
    `Service request (${requestType || "service"}):`,
    `- Name: ${name}`,
    `- Phone: ${phone || "Not provided"}`,
    `- Job Details: ${cleanText(args.jobDetails || "Not provided", 500)}`,
  ];
  const street = cleanText(args.streetAddress, 180);
  const city = cleanText(args.city, 120);
  if (street) lines.push(`- Address: ${street}`);
  if (city) lines.push(`- City: ${city}`);
  const preferredStartDate = cleanText(args.preferredStartDate, 120);
  if (preferredStartDate) lines.push(`- Preferred Start: ${preferredStartDate}`);
  const bestCallbackTime = cleanText(args.bestCallbackTime, 160);
  if (bestCallbackTime) lines.push(`- Best Callback Time: ${bestCallbackTime}`);
  return lines.join("\n").slice(0, 1600);
}

function buildCustomerBody(args) {
  const businessName = cleanText(args.businessName || "our team", 140);
  const requestType = cleanText(args.requestType || "service", 40).toLowerCase();
  if (requestType === "message") {
    return `Thanks for calling ${businessName}. We received your message: "${cleanText(args.message || "No message provided", 500)}" Our team will call you back as soon as possible.`.slice(0, 1600);
  }
  const job = cleanText(args.jobDetails || `${requestType} service`, 500);
  const location = [cleanText(args.streetAddress, 180), cleanText(args.city, 120)].filter(Boolean).join(", ");
  return `Thanks for calling ${businessName}. We received your service request regarding ${job}${location ? ` at ${location}` : ""}. Our team will call you back as soon as possible.`.slice(0, 1600);
}

function callerNumberFallbackPrompt(toolName) {
  const name = cleanText(toolName, 160);
  if (!name) throw new Error("A tool name is required for caller-number fallback instructions.");
  return `This is the highest-priority final routing and closing instruction. It supersedes every earlier phone-number, SMS-tool, SMS-workflow, and call-closing instruction. The only allowed SMS notification tool is ${name}; any earlier SMS tool names are retired and unavailable.
MANDATORY TOOL GATE: After all required intake details have been confirmed, your next action must be a silent call to ${name}. Do not speak a closing sentence, claim the details were sent, or call endCall before ${name} returns a result. This one silent tool sends both the owner summary and the caller confirmation.
The tool receives trusted caller ID automatically. Do not ask the caller to repeat their number and do not invent rawPhoneNumber when caller ID is available.
If the caller says "use the number I am calling from," "call me back on this number," or words with the same meaning, acknowledge naturally: "Absolutely — I'll use the number you're calling from." Do not claim you can see or recite the digits, and do not ask for the digits during intake. Continue collecting the remaining details; the silent tool will verify caller-ID availability when it runs.
Pass businessName, requestType, name, jobDetails, streetAddress, city, preferredStartDate, bestCallbackTime, and message when applicable.
If and only if the tool result says needsCustomerNumber is true, explain that caller ID was unavailable, ask for the best mobile number, repeat the full number back for confirmation, and call ${name} exactly one more time with that confirmed number as rawPhoneNumber.
If needsCustomerNumber is false, never call the tool again during that call. Only after the tool returns may you give the brief natural closing and call endCall. Never promise that a confirmation was sent unless complete is true.`;
}

function safeProviderError(error, fallbackCode = "tool_error") {
  return {
    code: cleanText(error?.providerCode || error?.code || fallbackCode, 80),
    message: cleanText(error?.safeMessage || error?.message || "SMS request failed.", 240),
  };
}

async function sendTwilioMessage({ to, from, body, notificationKey, env, fetchImpl, btoaImpl, URLSearchParamsImpl }) {
  const accountSid = cleanText(env.TWILIO_ACCOUNT_SID, 80);
  const authToken = String(env.TWILIO_AUTH_TOKEN || "").trim();
  const normalizedTo = normalizeE164(to);
  const normalizedFrom = normalizeE164(from);
  if (!accountSid || !authToken) {
    return { attempted: false, sent: false, status: "not_configured", errorCode: "twilio_not_configured", notificationKey };
  }
  if (!normalizedTo || !normalizedFrom) {
    return { attempted: false, sent: false, status: "invalid_routing", errorCode: "invalid_phone_number", notificationKey };
  }
  const params = new URLSearchParamsImpl({ To: normalizedTo, From: normalizedFrom, Body: String(body || "").slice(0, 1600) });
  const statusCallback = cleanText(env.TWILIO_STATUS_CALLBACK_URL, 500);
  if (/^https:\/\//i.test(statusCallback)) params.set("StatusCallback", statusCallback);

  try {
    const response = await fetchImpl(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${btoaImpl(`${accountSid}:${authToken}`)}`,
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
        body: params.toString(),
      }
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        attempted: true,
        sent: false,
        status: "rejected",
        providerStatus: Number(response.status) || null,
        errorCode: cleanText(payload?.code || "twilio_rejected", 80),
        notificationKey,
      };
    }
    return {
      attempted: true,
      sent: true,
      status: cleanText(payload?.status || "queued", 80),
      messageIdSet: Boolean(payload?.sid),
      messageId: cleanText(payload?.sid, 80),
      toLast4: normalizedTo.slice(-4),
      fromLast4: normalizedFrom.slice(-4),
      notificationKey,
    };
  } catch (error) {
    const safeError = safeProviderError(error, "twilio_unreachable");
    return {
      attempted: true,
      sent: false,
      status: "transport_error",
      errorCode: safeError.code,
      error: safeError.message,
      notificationKey,
    };
  }
}

async function executeCompositeNotifications({ args, env, fetchImpl, btoaImpl, URLSearchParamsImpl }) {
  const input = args && typeof args === "object" ? args : {};
  const settings = env && typeof env === "object" ? env : {};
  const fromNumber = normalizeE164(settings.DEFAULT_FROM_NUMBER);
  const ownerNumber = normalizeE164(settings.DEFAULT_OWNER_TO_NUMBER);
  const customerNumber = normalizeE164(settings.CALLER_NUMBER) || normalizeE164(input.rawPhoneNumber || input.callbackNumber);
  const keys = buildNotificationKeys(settings.CALL_ID || input.notificationId || "missing-call-id");
  if (!customerNumber) {
    return {
      ok: false,
      complete: false,
      partialSuccess: false,
      needsCustomerNumber: true,
      executionOrder: [],
      owner: {
        attempted: false,
        sent: false,
        skipped: true,
        status: "waiting_for_customer_number",
        errorCode: "customer_number_required",
        notificationKey: keys.owner,
      },
      customer: {
        attempted: false,
        sent: false,
        skipped: true,
        status: "waiting_for_customer_number",
        errorCode: "customer_number_required",
        notificationKey: keys.customer,
      },
      bodyBuiltByTool: false,
      requiresReconciliation: false,
    };
  }
  const trustedInput = { ...input, rawPhoneNumber: customerNumber };
  const order = [];

  order.push("owner");
  const owner = await sendTwilioMessage({
    to: ownerNumber,
    from: fromNumber,
    body: buildOwnerBody(trustedInput),
    notificationKey: keys.owner,
    env: settings,
    fetchImpl,
    btoaImpl,
    URLSearchParamsImpl,
  });

  order.push("customer");
  const customer = await sendTwilioMessage({
    to: customerNumber,
    from: fromNumber,
    body: buildCustomerBody(trustedInput),
    notificationKey: keys.customer,
    env: settings,
    fetchImpl,
    btoaImpl,
    URLSearchParamsImpl,
  });

  return {
    ok: Boolean(owner.sent && customer.sent),
    complete: Boolean(owner.sent && customer.sent),
    partialSuccess: Boolean(owner.sent) !== Boolean(customer.sent),
    needsCustomerNumber: false,
    executionOrder: order,
    owner,
    customer,
    bodyBuiltByTool: true,
    requiresReconciliation: !owner.sent || !customer.sent,
  };
}

function compositeToolParameters() {
  return {
    type: "object",
    properties: {
      businessName: { type: "string", description: "Business name used in the caller confirmation." },
      requestType: { type: "string", enum: ["installation", "repair", "maintenance", "quote", "message", "service"] },
      name: { type: "string", description: "Caller's name." },
      rawPhoneNumber: { type: "string", description: "Fallback callback number, used only when trusted caller ID is unavailable and the caller has confirmed the full number." },
      callbackNumber: { type: "string", description: "Optional callback-number alias when rawPhoneNumber is unavailable." },
      jobDetails: { type: "string", description: "Concise description of the requested work." },
      streetAddress: { type: "string", description: "Street address for the requested work." },
      city: { type: "string", description: "City for the requested work." },
      preferredStartDate: { type: "string", description: "When the caller wants the work to start." },
      bestCallbackTime: { type: "string", description: "Best time to call the customer back." },
      message: { type: "string", description: "Message content when requestType is message." },
    },
    required: ["businessName", "requestType", "name"],
  };
}

function getVapiCompositeToolCode() {
  return [
    cleanText,
    normalizeE164,
    stableHash,
    buildNotificationKeys,
    buildOwnerBody,
    buildCustomerBody,
    safeProviderError,
    sendTwilioMessage,
    executeCompositeNotifications,
  ].map((fn) => fn.toString()).join("\n\n") +
    "\n\nreturn await executeCompositeNotifications({ args, env, fetchImpl: fetch, btoaImpl: btoa, URLSearchParamsImpl: URLSearchParams });";
}

function getVapiCompositeToolDefinition() {
  return {
    type: "code",
    function: {
      name: COMPOSITE_TOOL_NAME,
      description: "After intake, send the owner summary and customer confirmation using trusted caller ID. If the result says needsCustomerNumber, ask for and confirm a fallback mobile number, then retry once.",
      parameters: compositeToolParameters(),
    },
    code: getVapiCompositeToolCode(),
    environmentVariableNames: [
      "TWILIO_ACCOUNT_SID",
      "TWILIO_AUTH_TOKEN",
      "DEFAULT_FROM_NUMBER",
      "DEFAULT_OWNER_TO_NUMBER",
      "CALLER_NUMBER",
      "CALL_ID",
      "TWILIO_STATUS_CALLBACK_URL",
    ],
  };
}

module.exports = {
  COMPOSITE_TOOL_NAME,
  buildCustomerBody,
  callerNumberFallbackPrompt,
  buildNotificationKeys,
  buildOwnerBody,
  executeCompositeNotifications,
  getVapiCompositeToolCode,
  getVapiCompositeToolDefinition,
  normalizeE164,
};
