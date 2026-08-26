const {
  buildIncidentTelegramAlert,
  redactIncidentText,
  sendIncidentTelegramAlert,
} = require("./incidentAlerts");

function safeLabel(value, fallback = "unknown", maxLength = 160) {
  const text = redactIncidentText(String(value || ""), { maxLength })
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text || fallback;
}

function yesNo(value) {
  return value ? "yes" : "no";
}

function signupContext(input = {}) {
  const payload = input.payload && typeof input.payload === "object" ? input.payload : {};
  const record = input.record && typeof input.record === "object" ? input.record : {};
  const business = payload.business || payload.businessProfile || {};
  const assistant = payload.aiAssistant || payload.setupDetails || {};
  const specializations = [
    ...(Array.isArray(payload.specializations) ? payload.specializations : []),
    ...(Array.isArray(assistant.specializations) ? assistant.specializations : []),
  ].map((value) => safeLabel(value, "", 80)).filter(Boolean);
  const serviceText = specializations.length
    ? [...new Set(specializations)].slice(0, 5).join(", ")
    : business.services || record.serviceSummary || "Not supplied";
  const verification = payload.verification || {};
  return {
    businessName: input.businessName || business.name || business.businessName || record.businessName || "Name unavailable",
    businessType: assistant.businessType || payload.businessType || record.businessType || "Not supplied",
    serviceArea: assistant.serviceArea || payload.serviceArea || record.serviceArea || "Not supplied",
    services: serviceText,
    source: input.source || payload.source?.app || payload.source?.channel || record.signupSource || "website",
    contactCaptured: Boolean(payload.owner?.email || payload.owner?.phone || record.ownerEmail || record.ownerPhone),
    verified: Boolean(
      verification.emailVerified
      || verification.smsVerified
      || record.emailVerified
      || record.smsVerified
      || record.emailVerifiedAt
    ),
    phoneAssigned: Boolean(record.twilioPhoneNumber),
    assistantAssigned: Boolean(record.vapiAssistantId),
    trialStarted: Boolean(record.subscriptionId || record.trialStartedAt || record.stripeTrialStartedAt),
    status: input.state || record.status || "signup update",
    makeStatus: Number.isFinite(Number(record.makeStatus)) && Number(record.makeStatus) > 0
      ? Number(record.makeStatus)
      : null,
    makeResponseKind: String(record.makeResponseKind || "").trim().toLowerCase(),
    phoneProvisioningCode: String(record.phoneProvisioningCode || "").trim().toUpperCase(),
  };
}

function buildSignupSnapshot(input = {}) {
  const context = signupContext(input);
  return {
    Business: context.businessName,
    Request: "14-day trial and AI phone-assistant setup",
    "Business type": context.businessType,
    "Service area": context.serviceArea,
    Services: context.services,
    Source: context.source,
    "Contact captured": yesNo(context.contactCaptured),
    "Contact verified": yesNo(context.verified),
    "AI number assigned": yesNo(context.phoneAssigned),
    "Assistant assigned": yesNo(context.assistantAssigned),
    "Trial/billing started": yesNo(context.trialStarted),
    Stage: context.status,
  };
}

function signupReasonCode(input, context) {
  if (context.phoneProvisioningCode) return context.phoneProvisioningCode;
  if (context.makeResponseKind === "empty") return "MAKE_SIGNUP_RESPONSE_EMPTY";
  if (context.makeResponseKind === "acknowledged_incomplete") return "MAKE_SIGNUP_RESPONSE_INCOMPLETE";
  if (context.makeResponseKind === "rejected") return "MAKE_SIGNUP_REJECTED";
  const explicit = String(input.reasonCode || "").trim();
  if (/^[A-Z0-9_.:-]{3,100}$/i.test(explicit) && !/^(TRUE|FALSE)$/i.test(explicit)) return explicit;
  if (input.state === "review_required") return "SIGNUP_REVIEW_REQUIRED";
  if (input.state === "provisioning_failed") return "SIGNUP_PROVISIONING_FAILED";
  return "";
}

function signupLastCheckpoint(context) {
  if (context.phoneAssigned && context.assistantAssigned) return "The phone number and assistant were verified as assigned.";
  if (context.makeStatus) {
    return `The provisioning request reached the automation and returned HTTP ${context.makeStatus}, but setup completion still requires verification.`;
  }
  if (context.verified) return "The customer's contact verification completed before provisioning stopped.";
  if (context.contactCaptured) return "The signup details were saved and customer contact information was captured.";
  return "The signup request reached My AI PA, but no later successful checkpoint was verified.";
}

function signupNextAction(state) {
  if (state === "review_required") {
    return "Open this exact signup, review the saved request and safety flags, and approve recovery only when no duplicate resources can be created.";
  }
  return "Open this exact incident, verify Make, Twilio, and Vapi state, then run guarded recovery only after duplicate phone, assistant, and billing actions are ruled out.";
}

function buildSignupIncidentInput(input = {}) {
  const context = signupContext(input);
  const eventKey = /^signup_[a-f0-9]{32}$/i.test(String(input.eventKey || ""))
    ? String(input.eventKey).slice(-10)
    : "unknown";
  const review = input.state === "review_required";
  return {
    severity: input.state === "provisioning_failed" ? "critical" : "warning",
    title: review ? "Signup is waiting for manual review" : "Signup provisioning did not finish",
    whatFailed: review
      ? "The 14-day trial and AI phone-assistant setup was paused before provisioning."
      : "The 14-day trial signup did not produce a verified callable number and assigned assistant.",
    reasonCode: signupReasonCode(input, context),
    reason: input.detail || "The signup workflow stopped without verified completion proof.",
    impact: review
      ? "The customer setup is not live. No phone, assistant, or billing action should be assumed while review is pending."
      : "The customer setup is not live. They may be waiting, and no phone, assistant, or trial/billing success should be assumed.",
    snapshot: {
      ...buildSignupSnapshot(input),
      "Attempt reference": eventKey,
    },
    lastCheckpoint: signupLastCheckpoint(context),
    nextAction: signupNextAction(input.state),
    incidentId: input.incidentId || eventKey,
    detectedAt: input.record?.updatedAt || input.record?.lastAttemptAt || new Date().toISOString(),
    adminUrl: input.adminUrl,
  };
}

function buildSignupUpdateAlert(input = {}) {
  const context = signupContext(input);
  const labels = {
    received: "NEW SIGNUP RECEIVED",
    verification_sent: "SIGNUP VERIFICATION SENT",
    provisioning_ready: "SIGNUP SETUP VERIFIED",
  };
  const eventKey = /^signup_[a-f0-9]{32}$/i.test(String(input.eventKey || ""))
    ? String(input.eventKey).slice(-10)
    : "unknown";
  const snapshotLines = Object.entries(buildSignupSnapshot(input))
    .map(([key, value]) => `• ${safeLabel(key)}: ${safeLabel(value, "Not supplied", 220)}`);
  return [
    `MY AI PA — ${labels[input.state] || "SIGNUP UPDATE"}`,
    "",
    "WHAT THIS SIGNUP IS FOR",
    ...snapshotLines,
    `• Attempt reference: ${eventKey}`,
    "",
    "CURRENT STATUS",
    safeLabel(input.detail || context.status, "Signup update received", 300),
    "",
    "WHAT HAPPENS NEXT",
    input.state === "provisioning_ready"
      ? "The verified setup can continue to trial activation and customer testing."
      : input.state === "verification_sent"
        ? "Provisioning stays paused until the customer verifies their contact details."
        : "My AI PA will hold or continue the setup according to the verification and manual-review safeguards.",
    "",
    "No customer email, phone number, street address, or provider credential is included.",
  ].join("\n").slice(0, 3_900);
}

function buildSignupTelegramAlert(input = {}) {
  if (["provisioning_failed", "review_required"].includes(input.state)) {
    return buildIncidentTelegramAlert(buildSignupIncidentInput(input));
  }
  return buildSignupUpdateAlert(input);
}

async function sendSignupTelegramAlert(input, { token, chatId, fetchImpl = fetch } = {}) {
  if (["provisioning_failed", "review_required"].includes(input?.state)) {
    return sendIncidentTelegramAlert(buildSignupIncidentInput(input), { token, chatId, fetchImpl });
  }
  if (!String(token || "").trim() || !String(chatId || "").trim()) {
    return { sent: false, skipped: true, reason: "telegram_not_configured" };
  }
  const body = {
    chat_id: String(chatId).trim(),
    disable_web_page_preview: true,
    text: buildSignupUpdateAlert(input),
    ...(String(input?.adminUrl || "").startsWith("https://") ? {
      reply_markup: {
        inline_keyboard: [[{ text: "Open signup dashboard", url: String(input.adminUrl) }]],
      },
    } : {}),
  };
  const response = await fetchImpl(`https://api.telegram.org/bot${String(token).trim()}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(7_000) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok !== true) {
    const error = new Error(data?.description || `Telegram signup alert failed (${response.status}).`);
    error.statusCode = 502;
    throw error;
  }
  return { sent: true, skipped: false, messageId: data?.result?.message_id || null };
}

module.exports = {
  buildSignupIncidentInput,
  buildSignupSnapshot,
  buildSignupTelegramAlert,
  safeLabel,
  sendSignupTelegramAlert,
  signupContext,
};
