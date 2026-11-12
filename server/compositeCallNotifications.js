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

function buildOwnerHeading(requestType) {
  const normalized = cleanText(requestType || "service", 40).toLowerCase();
  if (["installation", "new installation", "new_installation"].includes(normalized)) return "NEW INSTALLATION";
  if (normalized === "repair") return "REPAIR REQUEST";
  if (normalized === "maintenance") return "MAINTENANCE REQUEST";
  if (normalized === "quote") return "QUOTE REQUEST";
  return "SERVICE REQUEST";
}

function buildNextAction(requestType) {
  const normalized = cleanText(requestType || "service", 40).toLowerCase();
  if (["installation", "new installation", "new_installation", "quote"].includes(normalized)) return "Quote follow-up";
  if (normalized === "repair") return "Repair follow-up";
  if (normalized === "maintenance") return "Maintenance follow-up";
  return "Service follow-up";
}

function buildJobType(requestType) {
  const type = cleanText(requestType, 40).toLowerCase().replace(/_/g, " ");
  const labels = { installation: "New installation", "new installation": "New installation",
    repair: "Repair", maintenance: "Maintenance", quote: "Quote / estimate",
    service: "Service call", message: "Message / callback", rental: "Rental inquiry",
    application: "Rental application", "tenant maintenance": "Tenant maintenance",
    "tenant complaint": "Tenant concern", "tenant urgent": "Urgent tenant issue" };
  return labels[type] || "Not provided";
}

function reportedSafetyReminder(args) {
  // Explicit caller-reported context only: never infer danger from trade,
  // urgency, or keywords that could occur in a denial ("no sparks").
  return args.safetyConcern === "reported_hazard"
    ? "Safety: Stay away from the hazard. If anyone is in immediate danger, call 911. This text is not emergency dispatch."
    : "";
}

function discussedPricingReminder(summary) {
  if (summary.pricingDiscussed !== true || reportedSafetyReminder(summary)) return "";
  const statements = [
    // These are trusted server policy, not model-supplied tool parameters.
    // Keep the merged summary distinct from Vapi's public `args` object.
    summary.includePartsExtra !== false ? "Parts are extra." : "",
    summary.includeAssessment !== false ? "Final price confirmed after assessment, before work starts." : "",
  ].filter(Boolean);
  return statements.length ? `Pricing: ${statements.join(" ")}` : "";
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
      `- Job type: ${buildJobType(requestType)}`,
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
      `- Job type: ${buildJobType(requestType)}`,
      `- Message: ${cleanText(args.message || "No message provided", 500)}`,
      ...(reportedSafetyReminder(args) ? [`- URGENT: Caller reported a hazard. No emergency dispatch confirmed.`] : []),
    ].join("\n").slice(0, 1600);
  }
  const street = cleanText(args.streetAddress, 180);
  const city = cleanText(args.city, 120);
  const address = [street, city].filter(Boolean).join(", ") || "Not provided";
  const lines = [
    buildOwnerHeading(requestType),
    `- Caller: ${name}`,
    `- Phone: ${phone || "Not provided"}`,
    `- Job type: ${buildJobType(args.requestType)}`,
    `- Job: ${cleanText(args.jobDetails || requestType || "Not provided", 500)}`,
    `- Location: ${address}`,
    `- Preferred start date: ${cleanText(args.preferredStartDate || "Not provided", 120)}`,
    `- Preferred callback: ${cleanText(args.bestCallbackTime || "Not provided", 160)}`,
  ];
  const urgency = cleanText(args.urgency, 120);
  if (urgency) lines.push(`- Urgency: ${urgency}`);
  if (reportedSafetyReminder(args)) lines.push("- URGENT: Caller reported a hazard. No emergency dispatch confirmed.");
  if (discussedPricingReminder(args)) lines.push(`- ${discussedPricingReminder(args)}`);
  lines.push(`- Next action: ${buildNextAction(requestType)}`);
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
    return `Job type: ${buildJobType(requestType)}\nThanks for calling ${businessName}. Your urgent tenant message has been received for review. A response time and emergency dispatch are not guaranteed. If anyone is in immediate danger, leave the area and call 911.`.slice(0, 1600);
  }
  if (requestType === "tenant_maintenance" || requestType === "tenant_complaint") {
    const label = requestType === "tenant_maintenance" ? "maintenance message" : "tenant concern";
    return `Job type: ${buildJobType(requestType)}\nThanks for calling ${businessName}. Your ${label} has been received for review. Your preferred contact time was noted, but a response time is not guaranteed.`.slice(0, 1600);
  }
  if (requestType === "message") {
    return [reportedSafetyReminder(args), `Job type: ${buildJobType(requestType)}\nThanks for calling ${businessName}. We received your message: "${cleanText(args.message || "No message provided", 500)}" The team will review it and follow up.`].filter(Boolean).join("\n").slice(0, 1600);
  }
  const job = cleanText(args.jobDetails || `${requestType} service`, 500);
  const location = [cleanText(args.streetAddress, 180), cleanText(args.city, 120)].filter(Boolean).join(", ");
  const bestCallbackTime = cleanText(args.bestCallbackTime, 160);
  const preferredStartDate = cleanText(args.preferredStartDate, 160);
  const lines = [
    businessName.toUpperCase(),
    ...(reportedSafetyReminder(args) ? [reportedSafetyReminder(args)] : []),
    `Job type: ${buildJobType(args.requestType)}`,
    `Job: ${job}`,
  ];
  if (location) lines.push(`Location: ${location}`);
  if (preferredStartDate) lines.push(`Preferred start date: ${preferredStartDate}`);
  if (bestCallbackTime) lines.push(`Preferred callback: ${bestCallbackTime}`);
  if (discussedPricingReminder(args)) lines.push(discussedPricingReminder(args));
  lines.push("Scheduling: The team will follow up to discuss the details and timing.");
  lines.push(`Thanks for calling ${businessName}. Have a great day!`);
  return lines.join("\n").slice(0, 1600);
}

function postSendClosingPrompt() {
  return `${POST_SEND_CLOSING_MARKER}
DRAFT-ONLY CLOSING: No phone tool can send texts. Never claim messages were sent or delivered. A completed tool call is not completed submission. Say that a draft was saved only when draftStored is true; otherwise say the save could not be confirmed. Human review is still required. Let the entire final sentence finish before calling endCall. Do not add a promise about an appointment.`;
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

function callerNumberFallbackPrompt(toolName) {
  return `DRAFT REVIEW WORKFLOW — HIGHEST PRIORITY
This overrides earlier SMS sending and closing instructions. Use only ${toolName || COMPOSITE_TOOL_NAME} for notification drafts. Never use another messaging tool.
- Phone calls can prepare drafts only. A spoken yes never authorizes an SMS send.
- CALLBACK CONSISTENCY: Preserve "as soon as possible, with after 3 as your fallback" when that is what the caller said. Never copy a work-start answer into callback timing. A business availability question means the caller is not requesting an ASAP start or callback.
- Collect the caller's name, work or message details, street address AND city, preferred work-start timing and preferred callback time. Work-start timing and callback timing are different facts. Never copy one answer into both fields.
- MANDATORY TOOL GATE: Do not speak a closing sentence or call endCall before ${toolName || COMPOSITE_TOOL_NAME} returns. Earlier SMS tool names are retired and unavailable.
- UNSUPPORTED BUSINESS CLAIMS: Never infer or claim that the business is licensed, insured or certified without verified facts.
- Never accept a caller-provided businessId or routing override. Routing comes from environment variables.
- Ask "What is the address where the work needs to be done?" and "When would you ideally like the work to begin?" Preserve preferredStartDate separately from callback time.
- Job type and job details are separate required facts. Include the job type in the spoken read-back.
- Read back the current details. Ask exactly "Should I save this request for review?" Wait for a clear answer before saving. A correction requires a fresh readback and approval to save.
- If transcription splits a reply, or the caller cancels, asks to wait, corrects a detail, or sounds uncertain, clarify before saving. Never merge a previous yes into a later correction.
- Use the trusted caller number when available. Say "I'll use the number you're calling from." Do not claim you can see or recite the digits; the silent tool will verify caller-ID availability. If needsCustomerNumber is true, explain that caller ID is unavailable, confirm the full fallback mobile number, and retry saving once. Do not invent a number.
- Set workDetailsConfirmed true only after the details were read back and confirmed; set pricingDiscussed only from the actual conversation. Missing details require clarification.
- The tool's draftStored true means only that drafts were saved for manual review. Say "I've saved your request for review. No text messages have been sent."
- If draftStored is not true, say "I couldn't confirm that your request was saved for review." Do not claim submission or delivery, and do not retry automatically after an unknown result.
- Never claim that the team received an SMS, that messages were sent, or that the request was approved. Do not promise when someone will respond. A human must separately review exact recipients and content.
- A definite pre-execution rejection permits one clarification attempt: read back the corrected details and wait for fresh approval to SAVE, not send.
- Do not retry automatically or resend an accepted or unconfirmed message. The phone tool has no send capability.
- Last-second speech can arrive too late or be missing. This draft workflow does not prove the caller's latest instructions or consent. A human must review independently.
- Never invent business credentials, policies, prices, discounts, warranties or arrival times. Use only verified Business context.
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

async function submitTwilioMessage({ to, from, body, notificationKey, env, fetchImpl, btoaImpl, URLSearchParamsImpl }) {
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
    if (!/^(?:SM|MM)[a-f0-9]{32}$/i.test(String(payload?.sid || ''))) return { attempted: true, sent: false, status: 'unknown',
      errorCode: 'provider_response_incomplete', notificationKey };
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

// At-most-once admission is held server-side, not in a Vapi execution's memory.
// Missing configuration, lost claims and unknown outcomes never fall back to an
// unguarded Twilio POST. A new call/manual reconciliation is needed to recover.
async function sendTwilioMessage(options) {
  const { to, from, body, notificationKey, env, fetchImpl, leg } = options;
  const callId = String(env.CALL_ID || '').trim();
  const endpoint = String(env.SMS_NOTIFICATION_DISPATCH_URL || '').trim();
  const key = String(env.SMS_SUPPRESSION_API_KEY || '').trim();
  const unavailable = code => ({ attempted: false, sent: false, status: 'not_configured', errorCode: code, notificationKey });
  if (!key) return { attempted: false, sent: false, status: 'suppression_check_unavailable', errorCode: 'suppression_check_not_configured', notificationKey };
  if (!/^[a-zA-Z0-9][a-zA-Z0-9:_-]{1,179}$/.test(callId)) return unavailable('notification_call_id_required');
  if (!/^https:\/\//i.test(endpoint) || !['owner','customer'].includes(leg)) return unavailable('notification_dispatch_not_configured');
  const context = { callId, from: normalizeE164(from), to: normalizeE164(to), leg, body: String(body || '').slice(0, 1600) };
  const uncertain = code => ({ attempted: true, sent: false, status: 'unknown', errorCode: code, notificationKey, requiresReconciliation: true });
  const request = async payload => {
    const response = await fetchImpl(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const result = await response.json().catch(() => ({}));
    return { response, result };
  };
  let claim;
  try { const reply = await request({ action: 'claim', ...context });
    if (!reply.response.ok || reply.result.schemaVersion !== 1) return uncertain('notification_dispatch_unavailable');
    claim = reply.result;
  } catch { return uncertain('notification_dispatch_unreachable'); }
  if (claim.granted !== true) {
    if (claim.state === 'completed' && claim.result && typeof claim.result.sent === 'boolean' && typeof claim.result.attempted === 'boolean') return { ...claim.result, replayed: true, dispatchReceiptStored: true };
    return uncertain(claim.state === 'context_conflict' ? 'notification_dispatch_context_conflict' : 'notification_submission_unconfirmed');
  }
  if (!/^[a-f0-9-]{36}$/i.test(String(claim.claimToken || ''))) return uncertain('notification_dispatch_claim_invalid');
  const result = await submitTwilioMessage(options);
  try { const reply = await request({ action: 'complete', ...context, claimToken: claim.claimToken, result });
    if (reply.response.ok && reply.result.schemaVersion === 1 && reply.result.stored === true) return { ...result, dispatchReceiptStored: true };
  } catch { /* Keep the durable claim. Never resubmit an accepted/unknown send. */ }
  return { ...result, dispatchReceiptStored: false, requiresReconciliation: true };
}

async function executeCompositeNotifications({ args, env, fetchImpl, btoaImpl, URLSearchParamsImpl }) {
  const input = args && typeof args === "object" ? args : {};
  const settings = env && typeof env === "object" ? env : {};
  const ownerSmsEnabled = String(settings.OWNER_SMS_ENABLED ?? "true").trim().toLowerCase() !== "false";
  const fromNumber = normalizeE164(settings.DEFAULT_FROM_NUMBER);
  const ownerNumber = normalizeE164(settings.DEFAULT_OWNER_TO_NUMBER);
  const customerNumber = normalizeE164(settings.CALLER_NUMBER) || normalizeE164(input.rawPhoneNumber || input.callbackNumber);
  const keys = buildNotificationKeys(settings.CALL_ID || input.notificationId || "missing-call-id");
  const workRequest = ['installation', 'new installation', 'new_installation', 'service', 'repair', 'maintenance', 'quote'].includes(String(input.requestType || '').toLowerCase());
  const missingFields = [];
  if (typeof input.pricingDiscussed !== 'boolean') missingFields.push('pricingDiscussed');
  if (workRequest && input.safetyConcern !== 'reported_hazard') {
    for (const field of ['jobDetails', 'streetAddress', 'city', 'preferredStartDate', 'bestCallbackTime']) {
      if (!cleanText(input[field], 500)) missingFields.push(field);
    }
    if (input.workDetailsConfirmed !== true) missingFields.push('workDetailsConfirmed');
  }
  if (missingFields.length) {
    const leg = { attempted: false, sent: false, skipped: true, status: 'waiting_for_intake', errorCode: 'intake_confirmation_required' };
    return { ok: false, complete: false, needsIntakeDetails: true, missingFields, executionOrder: [],
      owner: { ...leg, notificationKey: keys.owner }, customer: { ...leg, notificationKey: keys.customer }, requiresReconciliation: false };
  }
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
  // Pricing reminders come from server-provisioned policy, never tool/caller arguments.
  let pricingOptions = { includePartsExtra: true, includeAssessment: true };
  const policyJson = env && env.PRICING_SUMMARY_OPTIONS;
  if (policyJson) {
    try {
      const parsed = JSON.parse(policyJson);
      if (typeof parsed.includePartsExtra !== "boolean" || typeof parsed.includeAssessment !== "boolean") throw new Error("Invalid policy");
      pricingOptions = { includePartsExtra: parsed.includePartsExtra, includeAssessment: parsed.includeAssessment };
    } catch {
      return { ok: false, complete: false, errorCode: "pricing_policy_invalid", executionOrder: [] };
    }
  }
  const trustedInput = { ...input, ...pricingOptions, rawPhoneNumber: customerNumber };
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
      leg: 'owner',
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
    leg: 'customer',
    to: customerNumber,
    from: fromNumber,
    body: buildCustomerBody(trustedInput),
    notificationKey: keys.customer,
    env: settings,
    fetchImpl,
    btoaImpl,
    URLSearchParamsImpl,
  });

  const confirmed = Boolean((!ownerSmsEnabled || (owner.sent && owner.dispatchReceiptStored)) && customer.sent && customer.dispatchReceiptStored);
  return {
    ok: confirmed,
    complete: confirmed,
    partialSuccess: ownerSmsEnabled ? Boolean(owner.sent) !== Boolean(customer.sent) : false,
    needsCustomerNumber: false,
    executionOrder: order,
    owner,
    customer,
    bodyBuiltByTool: true,
    requiresReconciliation: !customer.sent || (ownerSmsEnabled && !owner.sent) || owner.requiresReconciliation === true || customer.requiresReconciliation === true,
    ownerSmsEnabled,
  };
}

function compositeToolParameters() {
  return {
    type: "object",
    properties: {
      businessName: { type: "string", description: "Business name used in the caller confirmation." },
      requestType: { type: "string", description: "Caller-confirmed job type, separate from jobDetails. Ask if unknown; never infer from the business trade or property type.", enum: ["installation", "new installation", "new_installation", "repair", "maintenance", "quote", "message", "service", "rental", "application", "tenant_maintenance", "tenant_complaint", "tenant_urgent", "constituent_demo"] },
      name: { type: "string", description: "Caller's name." },
      rawPhoneNumber: { type: "string", description: "Fallback callback number, used only when trusted caller ID is unavailable and the caller has confirmed the full number." },
      callbackNumber: { type: "string", description: "Optional callback-number alias when rawPhoneNumber is unavailable." },
      jobDetails: { type: "string", description: "Concise description of the requested work." },
      streetAddress: { type: "string", description: "Street address for the requested work." },
      city: { type: "string", description: "City for the requested work." },
      preferredStartDate: { type: "string", description: "When the caller wants the work to start." },
      bestCallbackTime: { type: "string", description: "Best time to call the customer back." },
      urgency: { type: "string", description: "Caller-stated urgency. Capture it without diagnosing or promising dispatch." },
      safetyConcern: { type: "string", enum: ["none", "reported_hazard"], description: "Use reported_hazard only for a caller-reported current safety hazard. Use none for ordinary requests, denied danger, or past/resolved hazards. Not a diagnosis." },
      pricingDiscussed: { type: "boolean", description: "True only when an owner-approved repair/service pricing statement (selected rate, assessment policy, or parts policy) was actually discussed. False for installations, messages, hazard calls, or no pricing discussion. Never implies a quote was approved." },
      workDetailsConfirmed: { type: 'boolean', description: 'For ordinary work requests, true only after job details, street AND city, full start timing and callback preference were read back and confirmed. Missing/uncertain fields require clarification, not a guessed city or an automatic true.' },
      message: { type: "string", description: "Message content when requestType is message." },
    },
    required: ["businessName", "requestType", "name", "pricingDiscussed"],
  };
}

function getVapiCompositeToolCode() {
  return [
    cleanText,
    normalizeE164,
    stableHash,
    buildNotificationKeys,
    buildOwnerHeading,
    buildNextAction,
    buildJobType,
    reportedSafetyReminder,
    discussedPricingReminder,
    buildOwnerBody,
    buildCustomerBody,
    executeCompositeNotifications,
  ].map((fn) => fn.toString()).join("\n\n") + '\n' +
    preparePhoneNotificationDraft.toString().replace('function preparePhoneNotificationDraft(', 'function sendTwilioMessage(') +
    "\nconst result = await executeCompositeNotifications({ args, env, fetchImpl: fetch, btoaImpl: btoa, URLSearchParamsImpl: URLSearchParams });" +
    "\nconst draftStored = Boolean((result.owner?.draftStored || result.owner?.status === 'disabled_by_policy') && result.customer?.draftStored);" +
    "\nreturn { ...result, ok: draftStored, complete: false, draftStored, requiresApproval: draftStored, requiresReconciliation: false, status: draftStored ? 'awaiting_manual_approval' : 'draft_not_saved' };";
}

// The only transport function included in provider-generated code saves drafts.
async function preparePhoneNotificationDraft({ to, from, body, env, fetchImpl, leg, notificationKey }) {
  const pending = { attempted: false, sent: false, status: 'draft_not_saved', notificationKey };
  const endpoint = String(env.SMS_NOTIFICATION_DISPATCH_URL || '').trim();
  const key = String(env.SMS_SUPPRESSION_API_KEY || '').trim();
  if (!/^https:\/\//i.test(endpoint) || !key) return pending;
  try {
    const response = await fetchImpl(endpoint, { method: 'POST', redirect: 'error',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'draft', callId: String(env.CALL_ID || '').trim(),
        from: normalizeE164(from), to: normalizeE164(to), body: String(body || '').slice(0, 1600), leg }) });
    const reply = await response.json();
    if (!response.ok || reply.schemaVersion !== 1 || reply.draftStored !== true
      || !/^[a-f0-9]{64}$/.test(reply.draftId || '') || !Number.isInteger(reply.revision) || reply.revision < 1) return pending;
    return { ...pending, draftStored: true, draftId: reply.draftId, revision: reply.revision, status: 'awaiting_manual_approval' };
  } catch { return pending; }
}

function getVapiCompositeToolDefinition() {
  return {
    type: "code",
    function: {
      name: COMPOSITE_TOOL_NAME,
      description: "Save draft texts for manual review after intake. This tool cannot send SMS or approve sending. If needsCustomerNumber is true, confirm a fallback mobile number and try saving once more.",
      parameters: compositeToolParameters(),
    },
    code: getVapiCompositeToolCode(),
    environmentVariableNames: [
      "PRICING_SUMMARY_OPTIONS",
      "DEFAULT_FROM_NUMBER",
      "DEFAULT_OWNER_TO_NUMBER",
      "OWNER_SMS_ENABLED",
      "CALLER_NUMBER",
      "CALL_ID",
      "SMS_SUPPRESSION_CHECK_URL",
      "SMS_SUPPRESSION_API_KEY",
      "SMS_NOTIFICATION_DISPATCH_URL",
    ],
  };
}

module.exports = {
  COMPOSITE_TOOL_NAME,
  POST_SEND_CLOSING_MARKER,
  buildCustomerBody,
  buildNextAction,
  callerNumberFallbackPrompt,
  buildNotificationKeys,
  buildOwnerHeading,
  buildOwnerBody,
  checkSmsPermission,
  submitTwilioMessage,
  executeCompositeNotifications,
  getVapiCompositeToolCode,
  getVapiCompositeToolDefinition,
  normalizeE164,
  postSendClosingPrompt,
  removeLegacyAbruptClosingInstructions,
};
