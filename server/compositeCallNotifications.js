const COMPOSITE_TOOL_NAME = "send_call_summaries_dynamic";
const POST_SEND_CLOSING_MARKER = "## MYAIPA NATURAL POST-SEND CLOSING";

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
  if (requestType === "routing_test") {
    return "MY AI PA TEST — First Class Rentals notification routing is working. No response or callback is required.";
  }
  if (requestType === "constituent_demo") {
    const lines = [
      "MY AI PA PRIVATE DEMO — Simulated constituent message:",
      `- Name: ${name}`,
      `- Phone: ${phone || "Not provided"}`,
    ];
    const community = cleanText(args.city, 120);
    const topic = cleanText(args.jobDetails, 300);
    const requestedAction = cleanText(args.preferredStartDate, 220);
    const preferredContact = cleanText(args.bestCallbackTime, 160);
    const message = cleanText(args.message, 600);
    if (community) lines.push(`- Community: ${community}`);
    if (topic) lines.push(`- Federal topic: ${topic}`);
    if (requestedAction) lines.push(`- Requested next step: ${requestedAction}`);
    if (preferredContact) lines.push(`- Preferred contact: ${preferredContact}`);
    if (message) lines.push(`- Message: ${message}`);
    lines.push("Unofficial test only — not sent to Dean Allison or his office.");
    return lines.join("\n").slice(0, 1600);
  }
  if (requestType === "tenant_urgent") {
    const lines = [
      "URGENT TENANT MESSAGE:",
      `- Tenant: ${name}`,
      `- Phone: ${phone || "Not provided"}`,
      `- Issue: ${cleanText(args.jobDetails || args.message || "Not provided", 500)}`,
    ];
    const property = cleanText(args.streetAddress, 180);
    const city = cleanText(args.city, 120);
    const callbackTime = cleanText(args.bestCallbackTime, 160);
    if (property) lines.push(`- Property: ${property}`);
    if (city) lines.push(`- City: ${city}`);
    if (callbackTime) lines.push(`- Preferred contact: ${callbackTime}`);
    lines.push("Urgent review requested — response time and emergency dispatch are not guaranteed.");
    return lines.join("\n").slice(0, 1600);
  }
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
  if (requestType === "routing_test") {
    return `MY AI PA TEST — ${businessName} customer confirmation routing is working. No response or callback is required.`;
  }
  if (requestType === "constituent_demo") {
    return "MY AI PA PRIVATE DEMO — Your simulated constituent-service message was recorded for this demonstration. It was not sent to or received by Dean Allison or his office, and no response from that office is expected.";
  }
  if (requestType === "tenant_urgent") {
    return `Thanks for calling ${businessName}. Your urgent tenant message has been received for review. A response time and emergency dispatch are not guaranteed. If anyone is in immediate danger, leave the area and call 911.`.slice(0, 1600);
  }
  if (requestType === "tenant_maintenance" || requestType === "tenant_complaint") {
    const label = requestType === "tenant_maintenance" ? "maintenance message" : "tenant concern";
    return `Thanks for calling ${businessName}. Your ${label} has been received for review. Your preferred contact time was noted, but a response time is not guaranteed.`.slice(0, 1600);
  }
  if (requestType === "message") {
    return `Thanks for calling ${businessName}. We received your message: "${cleanText(args.message || "No message provided", 500)}" The team will review it and follow up.`.slice(0, 1600);
  }
  const job = cleanText(args.jobDetails || `${requestType} service`, 500);
  const location = [cleanText(args.streetAddress, 180), cleanText(args.city, 120)].filter(Boolean).join(", ");
  const bestCallbackTime = cleanText(args.bestCallbackTime, 160);
  const preferredStartDate = cleanText(args.preferredStartDate, 160);
  const callbackNote = bestCallbackTime ? ` Your preferred callback time is ${bestCallbackTime}.` : "";
  const startNote = preferredStartDate ? ` Your preferred start timing is ${preferredStartDate}.` : "";
  return `Thanks for calling ${businessName}. We received your service request regarding ${job}${location ? ` at ${location}` : ""}.${callbackNote}${startNote} The team will follow up to discuss the details and next step.`.slice(0, 1600);
}

function postSendClosingPrompt() {
  return `${POST_SEND_CLOSING_MARKER}
This is the highest-priority post-send closing instruction.
- After the notification tool returns with complete set to true, say exactly: "I've sent your information to the team. Someone will contact you to discuss the request and arrange the next step."
- Let the entire final sentence finish before calling endCall. Do not add a promise about an appointment, quote, price, technician, or scheduled work.
- If complete is not true, do not claim both texts were sent. Briefly explain that you could not confirm both messages, tell the caller the team has their request only if the tool result confirms that, and ask whether there is anything else you can help with.
## END MYAIPA NATURAL POST-SEND CLOSING`;
}

function removeLegacyAbruptClosingInstructions(value) {
  return String(value || "")
    .replace(
      /\n*## Ending\s*After both SMS tool results return, say exactly:\s*"[^"]*Goodbye\."\s*Then call endCall immediately\.\s*Do not add any other words before or after that exact closing line\.\s*Do not wait for another caller response\./gi,
      ""
    )
    .replace(
      /\n*-\s*After both SMS tool results return, say exactly:\s*"[^"]*Goodbye\."\s*Then call endCall immediately\.\s*Do not add any other words\./gi,
      ""
    );
}

function callerNumberFallbackPrompt(toolName, { ownerSmsEnabled = true } = {}) {
  const name = cleanText(toolName, 160);
  if (!name) throw new Error("A tool name is required for caller-number fallback instructions.");
  const deliveryScope = ownerSmsEnabled
    ? "This one silent tool sends both the owner summary and the caller confirmation."
    : "This one silent tool sends the caller confirmation only. Owner SMS is temporarily disabled by policy.";
  return `This is the highest-priority final routing, business-claims, callback, tool-message, and closing instruction. It supersedes every earlier phone-number, SMS-tool, SMS-workflow, business-claims, callback-promise, and call-closing instruction. The only allowed SMS notification tool is ${name}; any earlier SMS tool names are retired and unavailable.

UNSUPPORTED BUSINESS CLAIMS:
- Treat only facts explicitly stated in the verified Business context as confirmed.
- Never infer or claim that the business is licensed, insured, bonded, certified, unionized, an equal-opportunity employer, offers a warranty, offers a discount, or follows a specific policy unless that exact fact is explicitly present in the verified Business context.
- If a requested fact is not explicitly verified, say: "I don't have that confirmed in the information available to me. The team can confirm when they call you back."
- If asked about an unverified discount, do not substitute the standard visit fee or hourly rate as the answer. State that the discount is unconfirmed, then offer to collect the caller's request for the team.

CALLBACK CONSISTENCY:
- A requested callback time is a preference, not a booked appointment or guarantee.
- Never promise that someone will call immediately, at a specific time, or within a specific period unless an explicit scheduling tool confirms it.
- Say "I'll note that preference for the team" rather than "we'll call you then" or "we'll have someone reach out then."
- If the caller changes to a callback preference that conflicts with an earlier one, do not continue intake and do not merely acknowledge the new preference. Your required next response is one concise clarification that preserves both preferences.
- When the earlier preference was after 3 and the caller then asks for "right away" or "as soon as possible," ask exactly: "Should I mark it as as soon as possible, with after 3 as your fallback?" Wait for the answer before continuing.
- Pass the caller's final clarified preference in bestCallbackTime.

REQUIRED WORK DETAILS:
- When the request needs a work location, ask exactly: "What is the address where the work needs to be done?"
- For installation, repair, maintenance, quote, or other service work, ask exactly: "When would you ideally like the work to begin?"
- Pass the caller's answer in preferredStartDate. Do not turn a preferred date into a booked appointment or promise.

MANDATORY TOOL GATE: After all required intake details have been confirmed, your next action must be a silent call to ${name}. Do not speak a closing sentence, claim the details were sent, or call endCall before ${name} returns a result. ${deliveryScope}
EXECUTION CONFIRMATION:
- Before calling ${name}, summarize the destination-neutral request details and ask exactly: "Should I send this request to the team now?"
- Call ${name} only when the caller's immediately following message clearly confirms that action.
- A confirmation from earlier in the call, including agreement to pricing or intake, is not permission to send.
- If the caller says cancel, stop, never mind, do not send, or otherwise withdraws consent, do not call the tool. A later send requires a fresh summary and confirmation.
The tool receives trusted caller ID automatically. Do not ask the caller to repeat their number and do not invent rawPhoneNumber when caller ID is available.
If the caller says "use the number I am calling from," "call me back on this number," or words with the same meaning, acknowledge naturally: "Absolutely — I'll use the number you're calling from." Do not claim you can see or recite the digits, and do not ask for the digits during intake. Continue collecting the remaining details; the silent tool will verify caller-ID availability when it runs.
Pass businessName, requestType, name, jobDetails, streetAddress, city, preferredStartDate, bestCallbackTime, and message when applicable.
If and only if the tool result says needsCustomerNumber is true, explain that caller ID was unavailable, ask for the best mobile number, repeat the full number back for confirmation, and call ${name} exactly one more time with that confirmed number as rawPhoneNumber.
If needsCustomerNumber is false, never call the tool again during that call. The tool's configured request-start message may say "Got it." Do not add model-generated waiting language such as "one moment," "hold on," or "this will just take a sec" before, during, or after the tool call.
Never promise that a confirmation was sent unless complete is true.

${postSendClosingPrompt()}`;
}

function safeProviderError(error, fallbackCode = "tool_error") {
  return {
    code: cleanText(error?.providerCode || error?.code || fallbackCode, 80),
    message: cleanText(error?.safeMessage || error?.message || "SMS request failed.", 240),
  };
}

async function checkSmsPermission({ to, env, fetchImpl }) {
  const endpoint = cleanText(env.SMS_SUPPRESSION_CHECK_URL, 500);
  const apiKey = String(env.SMS_SUPPRESSION_API_KEY || "").trim();
  const normalizedTo = normalizeE164(to);
  if (!normalizedTo) {
    return { allowed: false, suppressed: false, status: "invalid_routing", errorCode: "invalid_phone_number" };
  }
  if (!/^https:\/\//i.test(endpoint) || !apiKey) {
    return {
      allowed: false,
      suppressed: false,
      status: "suppression_check_unavailable",
      errorCode: "suppression_check_not_configured",
    };
  }
  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ phoneNumber: normalizedTo }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.allowed !== true) {
      return {
        allowed: false,
        suppressed: payload?.suppressed === true,
        status: payload?.suppressed === true ? "suppressed" : "suppression_check_unavailable",
        errorCode: payload?.suppressed === true ? "recipient_opted_out" : "suppression_check_failed",
      };
    }
    return { allowed: true, suppressed: false, status: "allowed", errorCode: "" };
  } catch (_error) {
    return {
      allowed: false,
      suppressed: false,
      status: "suppression_check_unavailable",
      errorCode: "suppression_check_unreachable",
    };
  }
}

async function sendTwilioMessage({ to, from, body, notificationKey, env, fetchImpl, btoaImpl, URLSearchParamsImpl }) {
  const accountSid = cleanText(env.TWILIO_ACCOUNT_SID, 80);
  const authToken = String(env.TWILIO_AUTH_TOKEN || "").trim();
  const apiKeySid = cleanText(env.TWILIO_API_KEY_SID, 80);
  const apiKeySecret = String(env.TWILIO_API_KEY_SECRET || "").trim();
  const hasApiKey = Boolean(apiKeySid && apiKeySecret);
  const restUsername = hasApiKey ? apiKeySid : accountSid;
  const restPassword = hasApiKey ? apiKeySecret : authToken;
  const normalizedTo = normalizeE164(to);
  const normalizedFrom = normalizeE164(from);
  if (!accountSid || !restUsername || !restPassword) {
    return { attempted: false, sent: false, status: "not_configured", errorCode: "twilio_not_configured", notificationKey };
  }
  if (!normalizedTo || !normalizedFrom) {
    return { attempted: false, sent: false, status: "invalid_routing", errorCode: "invalid_phone_number", notificationKey };
  }
  const permission = await checkSmsPermission({ to: normalizedTo, env, fetchImpl });
  if (!permission.allowed) {
    return {
      attempted: false,
      sent: false,
      skipped: true,
      status: permission.status,
      errorCode: permission.errorCode,
      notificationKey,
    };
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
          Authorization: `Basic ${btoaImpl(`${restUsername}:${restPassword}`)}`,
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
  const ownerSmsEnabled = String(settings.OWNER_SMS_ENABLED ?? "true").trim().toLowerCase() !== "false";
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
      owner: ownerSmsEnabled ? {
        attempted: false,
        sent: false,
        skipped: true,
        status: "waiting_for_customer_number",
        errorCode: "customer_number_required",
        notificationKey: keys.owner,
      } : {
        attempted: false,
        sent: false,
        skipped: true,
        status: "disabled_by_policy",
        errorCode: "owner_sms_disabled",
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
      ownerSmsEnabled,
    };
  }
  const trustedInput = { ...input, rawPhoneNumber: customerNumber };
  const order = [];

  let owner = {
    attempted: false,
    sent: false,
    skipped: true,
    status: "disabled_by_policy",
    errorCode: "owner_sms_disabled",
    notificationKey: keys.owner,
  };
  if (ownerSmsEnabled) {
    order.push("owner");
    owner = await sendTwilioMessage({
      to: ownerNumber,
      from: fromNumber,
      body: buildOwnerBody(trustedInput),
      notificationKey: keys.owner,
      env: settings,
      fetchImpl,
      btoaImpl,
      URLSearchParamsImpl,
    });
  }

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
    ok: Boolean((!ownerSmsEnabled || owner.sent) && customer.sent),
    complete: Boolean((!ownerSmsEnabled || owner.sent) && customer.sent),
    partialSuccess: ownerSmsEnabled ? Boolean(owner.sent) !== Boolean(customer.sent) : false,
    needsCustomerNumber: false,
    executionOrder: order,
    owner,
    customer,
    bodyBuiltByTool: true,
    requiresReconciliation: !customer.sent || (ownerSmsEnabled && !owner.sent),
    ownerSmsEnabled,
  };
}

function compositeToolParameters() {
  return {
    type: "object",
    properties: {
      businessName: { type: "string", description: "Business name used in the caller confirmation." },
      requestType: { type: "string", enum: ["installation", "repair", "maintenance", "quote", "message", "service", "rental", "application", "tenant_maintenance", "tenant_complaint", "tenant_urgent", "constituent_demo"] },
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
    checkSmsPermission,
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
      "TWILIO_API_KEY_SID",
      "TWILIO_API_KEY_SECRET",
      "DEFAULT_FROM_NUMBER",
      "DEFAULT_OWNER_TO_NUMBER",
      "OWNER_SMS_ENABLED",
      "CALLER_NUMBER",
      "CALL_ID",
      "TWILIO_STATUS_CALLBACK_URL",
      "SMS_SUPPRESSION_CHECK_URL",
      "SMS_SUPPRESSION_API_KEY",
    ],
  };
}

module.exports = {
  COMPOSITE_TOOL_NAME,
  POST_SEND_CLOSING_MARKER,
  buildCustomerBody,
  callerNumberFallbackPrompt,
  buildNotificationKeys,
  buildOwnerBody,
  checkSmsPermission,
  executeCompositeNotifications,
  getVapiCompositeToolCode,
  getVapiCompositeToolDefinition,
  normalizeE164,
  postSendClosingPrompt,
  removeLegacyAbruptClosingInstructions,
};
