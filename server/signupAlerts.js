const {
  buildIncidentTelegramAlert,
  redactIncidentText,
  sendIncidentTelegramAlert,
} = require("./incidentAlerts");
const { sanitizeMakeFailureEnvelope } = require("./makeSignupWebhook");
const { classifyOperationalError } = require("./operationalErrorClassifier");
const { card } = require("./providerNotifications");
const { validAdminUrl } = require("./incidentAlerts");

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

function formatAssignedAiNumber(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return safeLabel(value, "Not assigned yet", 40);
}

function makeFailureContext(input = {}, record = {}) {
  const explicit = input.makeFailure
    || input.providerFailure
    || input.makeAssessment
    || record.makeFailure
    || {
      failedStage: record.makeFailedStage,
      provider: record.makeFailureProvider,
      providerStatus: record.makeProviderStatus,
      providerCode: record.makeProviderCode,
      retryable: record.makeFailureRetryable,
    };
  return sanitizeMakeFailureEnvelope(explicit);
}

function classifySignupProviderFailure(failure = {}) {
  if (!failure.provider && !failure.providerStatus && !failure.providerCode && !failure.failedStage) return null;
  return classifyOperationalError({
    provider: failure.provider,
    providerStatus: failure.providerStatus,
    providerCode: failure.providerCode,
  }, {
    provider: failure.provider,
    providerStatus: failure.providerStatus,
    providerCode: failure.providerCode,
    operation: failure.failedStage || "signup provisioning",
  });
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
  const makeFailure = makeFailureContext(input, record);
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
    assignedAiNumber: record.twilioPhoneNumber ? formatAssignedAiNumber(record.twilioPhoneNumber) : "",
    assistantAssigned: Boolean(record.vapiAssistantId),
    trialStarted: Boolean(record.subscriptionId || record.trialStartedAt || record.stripeTrialStartedAt),
    status: input.state || record.status || "signup update",
    makeStatus: Number.isFinite(Number(record.makeStatus)) && Number(record.makeStatus) > 0
      ? Number(record.makeStatus)
      : null,
    makeResponseKind: String(record.makeResponseKind || "").trim().toLowerCase(),
    phoneProvisioningCode: String(record.phoneProvisioningCode || "").trim().toUpperCase(),
    makeFailure,
    providerClassification: classifySignupProviderFailure(makeFailure),
  };
}

function buildSignupSnapshot(input = {}) {
  const context = signupContext(input);
  const snapshot = {
    Business: context.businessName,
    Request: "14-day trial and AI phone-assistant setup",
    "Business type": context.businessType,
    "Service area": context.serviceArea,
    Services: context.services,
    Source: context.source,
    "Contact captured": yesNo(context.contactCaptured),
    "Contact verified": yesNo(context.verified),
    "AI number assigned": yesNo(context.phoneAssigned),
    "Assigned AI number": context.assignedAiNumber || "Not assigned yet",
    "Assistant assigned": yesNo(context.assistantAssigned),
    "Trial/billing started": yesNo(context.trialStarted),
    Stage: context.status,
  };
  if (context.makeFailure.failedStage) snapshot["Failed stage"] = context.makeFailure.failedStage;
  if (context.makeFailure.provider) snapshot.Provider = context.makeFailure.provider;
  if (context.makeFailure.providerStatus) snapshot["Provider HTTP status"] = context.makeFailure.providerStatus;
  if (context.makeFailure.providerCode) snapshot["Provider code"] = context.makeFailure.providerCode;
  if (typeof context.makeFailure.retryable === "boolean") {
    snapshot["Provider marked retryable"] = yesNo(context.makeFailure.retryable);
  }
  return snapshot;
}

function signupReasonCode(input, context) {
  const explicit = String(input.reasonCode || "").trim();
  if (
    ["customer_followup_failed", "customer_followup_partial"].includes(input.state)
    && /^[A-Z0-9_.:-]{3,100}$/i.test(explicit)
    && !/^(TRUE|FALSE)$/i.test(explicit)
  ) return explicit;
  if (context.phoneProvisioningCode) return context.phoneProvisioningCode;
  if (context.makeResponseKind === "empty") return "MAKE_SIGNUP_RESPONSE_EMPTY";
  if (context.makeResponseKind === "acknowledged_incomplete") return "MAKE_SIGNUP_RESPONSE_INCOMPLETE";
  if (context.makeResponseKind === "rejected") return "MAKE_SIGNUP_REJECTED";
  if (/^[A-Z0-9_.:-]{3,100}$/i.test(explicit) && !/^(TRUE|FALSE)$/i.test(explicit)) return explicit;
  if (input.state === "review_required") return "SIGNUP_REVIEW_REQUIRED";
  if (input.state === "provisioning_failed") return "SIGNUP_PROVISIONING_FAILED";
  if (["customer_followup_failed", "customer_followup_partial"].includes(input.state)) {
    return "SIGNUP_COMPLETION_DELIVERY_FAILED";
  }
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
    return "Review this signup. Check for duplicates before approving recovery.";
  }
  if (["customer_followup_failed", "customer_followup_partial"].includes(state)) {
    return "Keep the existing number. Fix SMS/email delivery; resend only the setup message.";
  }
  return "Check Make, Twilio and Vapi. Recover this signup only after ruling out duplicates.";
}

function buildSignupIncidentInput(input = {}) {
  const context = signupContext(input);
  const providerFailure = context.providerClassification;
  const eventKey = /^signup_[a-f0-9]{32}$/i.test(String(input.eventKey || ""))
    ? String(input.eventKey).slice(-10)
    : "unknown";
  const review = input.state === "review_required";
  const deliveryFailure = ["customer_followup_failed", "customer_followup_partial"].includes(input.state);
  return {
    severity: input.state === "provisioning_failed" ? "critical" : "warning",
    title: review
      ? "Signup is waiting for manual review"
      : deliveryFailure ? "Signup completed but customer follow-up needs attention" : "Signup provisioning did not finish",
    whatFailed: review
      ? "The 14-day trial and AI phone-assistant setup was paused before provisioning."
      : deliveryFailure
        ? "The assigned number was created, but the setup-complete SMS or email did not fully reach the customer."
      : providerFailure?.whatFailed
        || "The 14-day trial signup did not produce a verified callable number and assigned assistant.",
    reasonCode: providerFailure?.reasonCode || signupReasonCode(input, context),
    reason: providerFailure?.reason || input.detail || "The signup workflow stopped without verified completion proof.",
    impact: providerFailure?.impact || (review
      ? "Setup is paused, not confirmed live."
      : deliveryFailure
        ? "The number exists, but the customer may not have received their setup message."
      : "Setup is not confirmed live. The customer may be waiting."),
    snapshot: {
      ...buildSignupSnapshot(input),
      "Attempt reference": eventKey,
    },
    lastCheckpoint: signupLastCheckpoint(context),
    nextAction: providerFailure?.nextAction || signupNextAction(input.state),
    signInDestination: providerFailure?.signInDestination,
    incidentId: input.incidentId || eventKey,
    affectedCustomer: input.record?.businessName || input.businessName,
    detectedAt: input.record?.updatedAt || input.record?.lastAttemptAt || new Date().toISOString(),
    adminUrl: input.adminUrl,
  };
}

function buildSignupUpdateAlert(input = {}) {
  const context = signupContext(input);
  const delivery = input.record?.smsVerificationDeliveryStatus || "pending";
  const verificationStatus = delivery === "delivered"
    ? context.verified ? "Carrier confirmed delivery. Contact verified."
      : "Carrier confirmed delivery. Customer has not verified yet."
    : delivery === "failed" ? "Verification text failed. Setup remains blocked."
      : "Text submitted. Delivery is not confirmed. Setup remains blocked.";
  const labels = {
    received: "NEW SIGNUP RECEIVED",
    verification_sent: delivery === "delivered" ? "VERIFICATION TEXT DELIVERED"
      : delivery === "failed" ? "VERIFICATION TEXT FAILED" : "VERIFICATION TEXT PENDING",
    provisioning_ready: "SIGNUP SETUP VERIFIED",
  };
  const eventKey = /^signup_[a-f0-9]{32}$/i.test(String(input.eventKey || ""))
    ? String(input.eventKey).slice(-10)
    : "unknown";
  const status = input.state === "provisioning_ready"
    ? "Phone and assistant checked. Texts and a call still need testing."
    : input.state === "verification_sent"
      ? verificationStatus
      : input.record?.status === 'review_required' || input.record?.reviewRequired
        ? "Signup saved, but setup is paused for review."
        : "Signup saved. Setup is not confirmed ready yet.";
  const next = input.state === "provisioning_ready"
    ? "Confirm text delivery, trial activation and a test call."
    : input.state === "verification_sent"
      ? delivery === "delivered" ? "Check Messages or spam; tap Verify to continue."
        : delivery === "failed" ? "Check the delivery error; resend verification only."
          : "Wait for delivery confirmation. Do not create another signup."
      : "Check verification and any setup hold in the dashboard.";
  return [
    `📞 MY AI PA — ${labels[input.state] || "SIGNUP UPDATE"}`,
    safeLabel(context.businessName, "Name unavailable", 100),
    `${safeLabel(context.businessType, "Trade not supplied", 60)} · ${safeLabel(context.serviceArea, "Area not supplied", 80)}`,
    "",
    `Assigned AI number: ${context.assignedAiNumber || "Not assigned yet"}`,
    `Contact verified: ${yesNo(context.verified)} · Assistant assigned: ${yesNo(context.assistantAssigned)}`,
    `Trial started: ${yesNo(context.trialStarted)}`,
    "",
    `Status: ${status}`,
    ...(input.state === "verification_sent" ? [
      `Recipient: •••• ${String(input.record?.ownerPhone || "").replace(/\D/g, "").slice(-4) || "unknown"}`,
      ...(input.record?.smsVerificationErrorCode ? [`Delivery code: ${safeLabel(input.record.smsVerificationErrorCode, "unknown", 30)}`] : []),
    ] : []),
    `Next: ${next}`,
    "",
    `Reference: ${eventKey}`,
  ].join("\n");
}

function buildSignupTelegramAlert(input = {}) {
  if (["provisioning_failed", "review_required", "customer_followup_failed", "customer_followup_partial"].includes(input.state)) {
    return buildIncidentTelegramAlert(buildSignupIncidentInput(input));
  }
  return buildSignupUpdateAlert(input);
}

async function sendSignupTelegramAlert(input, { token, chatId, fetchImpl = fetch, replyMarkup = null } = {}) {
  if (["provisioning_failed", "review_required", "customer_followup_failed", "customer_followup_partial"].includes(input?.state)) {
    return sendIncidentTelegramAlert(buildSignupIncidentInput(input), { token, chatId, fetchImpl, replyMarkup });
  }
  if (!String(token || "").trim() || !String(chatId || "").trim()) {
    return { sent: false, skipped: true, reason: "telegram_not_configured" };
  }
  const adminUrl = validAdminUrl(input?.adminUrl);
  const form = new FormData();
  form.append('chat_id', String(chatId).trim());
  form.append('caption', buildSignupUpdateAlert(input));
  form.append('photo', new Blob([card('signup', input?.record?.reviewRequired || input?.record?.status === 'review_required' || input?.record?.smsVerificationDeliveryStatus === 'failed' ? 'warning' : 'info')], { type: 'image/png' }), 'signup-alert.png');
  const keyboard = replyMarkup?.inline_keyboard ? replyMarkup : adminUrl ? {
    inline_keyboard: [[{ text: "Open signup dashboard", url: adminUrl }]],
  } : null;
  if (keyboard) form.append('reply_markup', JSON.stringify(keyboard));
  const response = await fetchImpl(`https://api.telegram.org/bot${String(token).trim()}/sendPhoto`, {
    method: "POST",
    body: form,
    signal: typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(7_000) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok !== true || !data?.result?.message_id) {
    const error = new Error(`Telegram signup card was not confirmed (${response.status}).`);
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
