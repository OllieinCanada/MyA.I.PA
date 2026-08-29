const crypto = require("crypto");

const FAILED_SIGNUP = /(error|failed|rejected|blocked)/i;
const BLOCKED_PROVISIONING = /^provisioning_(pending|unknown)$/i;
const IN_PROGRESS_SIGNUP = /^(signup_received|checkout_completed|setup_started|pending_email_verification|provisioning_(pending|unknown)|subscription_(trialing|active))$/i;
const PROBLEM_HANDOFF_STATUSES = ["RETRY_DUE", "ESCALATION_DUE", "FAILED"];
const CUSTOMER_BILLING_STATUSES = new Set(["payment_failed", "past_due", "unpaid", "paused"]);
const SAFE_BILLING_DIAGNOSTIC_STATUSES = new Set([
  ...CUSTOMER_BILLING_STATUSES,
  "active",
  "trialing",
  "paid",
  "canceled",
  "cancelled",
  "incomplete",
  "incomplete_expired",
  "expired",
  "failed",
]);
const SAFE_PROVIDER_REASONS = Object.freeze({
  "20003": "Twilio rejected the configured credentials.",
  "20404": "Twilio could not find the requested messaging resource.",
  "21211": "Twilio rejected the destination telephone number as invalid.",
  "21265": "Twilio rejected the destination because it is a short code rather than a full recipient phone number.",
  "21266": "Twilio rejected the message because its sender and recipient numbers are the same.",
  "21268": "Twilio does not allow messages to this premium-rate or information-service destination.",
  "21608": "Twilio blocked the message because the recipient or required compliance profile is not verified.",
  "21610": "Twilio blocked the text because the recipient previously opted out.",
  "30003": "Twilio could not reach the destination handset.",
  "30005": "Twilio reported an unknown destination handset.",
  "30006": "Twilio reported a landline or unreachable destination.",
  "30007": "Twilio or the carrier filtered the text message.",
  "30008": "Twilio could not confirm a more specific delivery failure.",
  "30034": "Twilio blocked the US-bound message because its 10DLC sender is not attached to an approved campaign.",
  "63038": "Twilio stopped outbound messages because the account reached its rolling daily message limit.",
});

function hashTarget(value) {
  return crypto.createHash("sha256").update(String(value || "unknown")).digest("hex").slice(0, 24);
}

function ageMinutes(value, now = new Date()) {
  const timestamp = new Date(value || 0).getTime();
  return Number.isFinite(timestamp) && timestamp > 0 ? Math.max(0, Math.floor((now.getTime() - timestamp) / 60_000)) : null;
}

function attentionItem(input) {
  const identity = `${input.kind}:${input.targetType || "none"}:${input.targetId || "none"}`;
  const businessName = safeIncidentText(input.businessName, "", 120);
  const confidence = ["high", "medium", "low"].includes(String(input.confidence || "").toLowerCase())
    ? String(input.confidence).toLowerCase()
    : "";
  const reasonCode = safeReasonCode(input.reasonCode);
  const incident = {
    reason: safeIncidentText(input.reason, input.summary || "The workflow needs review."),
    impact: safeIncidentText(input.impact, "The affected workflow may not finish normally."),
    lastCheckpoint: safeIncidentText(input.lastCheckpoint, "Operational check detected the issue."),
    nextAction: safeIncidentText(input.nextAction, "Open the Needs Attention queue and review the affected record."),
    ...(reasonCode ? { reasonCode } : {}),
    ...(confidence ? { confidence } : {}),
  };
  return {
    id: hashTarget(identity),
    kind: input.kind,
    severity: input.severity || "warning",
    title: input.title,
    summary: input.summary,
    ...(businessName ? { businessName } : {}),
    incident,
    detectedAt: input.detectedAt || new Date().toISOString(),
    ageMinutes: input.ageMinutes ?? null,
    businessId: input.businessId || null,
    targetType: input.targetType || "",
    targetId: input.targetId || "",
    actions: input.actions || [],
    ...(input.diagnostics ? { diagnostics: input.diagnostics } : {}),
  };
}

function safeIncidentText(value, fallback = "", maxLength = 240) {
  const text = String(value || "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email removed]")
    .replace(/(?:\+?1[\s.-]?)?\(?[2-9]\d{2}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, "[phone removed]")
    .replace(/\b(token|secret|password|api[_ -]?key)\b(\s*[:=]\s*)[^\s,;]+/gi, "$1$2[removed]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
  return text || fallback;
}

function safeReasonCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_.:-]+/g, "_")
    .slice(0, 80);
}

function knownProviderReason(value) {
  const code = safeReasonCode(value);
  return SAFE_PROVIDER_REASONS[code] ? { reasonCode: code, reason: SAFE_PROVIDER_REASONS[code] } : null;
}

function safeDiagnosticLabel(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, "_")
    .slice(0, 80);
}

function safeBillingStatus(value) {
  const status = safeDiagnosticLabel(value);
  if (!status) return "";
  return SAFE_BILLING_DIAGNOSTIC_STATUSES.has(status) ? status : "other";
}

function getSignupBillingStatus(signup = {}, workflowStatus = "") {
  const candidates = [
    signup.paymentStatus,
    signup.subscriptionStatus,
    String(workflowStatus || "").replace(/^subscription_/i, ""),
  ];
  return candidates
    .map(safeBillingStatus)
    .find((status) => CUSTOMER_BILLING_STATUSES.has(status)) || "";
}

function signupBillingAttention(signup = {}, workflowStatus = "unknown") {
  const billingStatus = getSignupBillingStatus(signup, workflowStatus);
  if (billingStatus === "payment_failed") {
    return {
      kind: "payment_failed",
      title: "Customer payment failed",
      reason: "Stripe marked the customer's payment attempt as failed.",
      reasonCode: "PAYMENT_FAILED",
      impact: "The customer cannot start or continue paid service until the payment issue is resolved.",
      lastCheckpoint: "Stripe reported an invoice payment failure",
      nextAction: "Open the customer subscription and latest invoice in Stripe, resolve the payment method or invoice, then confirm the subscription is active before reopening setup.",
      confidence: "high",
    };
  }
  if (billingStatus === "past_due") {
    return {
      kind: "subscription_past_due",
      title: "Customer subscription is past due",
      reason: "Stripe reports that the customer's subscription is past due.",
      reasonCode: "SUBSCRIPTION_PAST_DUE",
      impact: "A customer invoice remains unresolved and service may be interrupted.",
      lastCheckpoint: "Stripe reported the subscription as past due",
      nextAction: "Open the customer subscription and latest invoice in Stripe, help the customer update payment or complete the invoice, then confirm the subscription is active.",
      confidence: "high",
    };
  }
  if (billingStatus === "unpaid") {
    return {
      kind: "subscription_unpaid",
      title: "Customer subscription is unpaid",
      reason: "Stripe reports that the customer's subscription is unpaid.",
      reasonCode: "SUBSCRIPTION_UNPAID",
      impact: "Paid service should remain unavailable until the customer subscription is restored.",
      lastCheckpoint: "Stripe reported the subscription as unpaid",
      nextAction: "Open the customer subscription and invoices in Stripe, resolve payment with the customer, then confirm the subscription is active before restoring service.",
      confidence: "high",
    };
  }
  if (billingStatus === "paused") {
    return {
      kind: "subscription_paused",
      title: "Customer subscription is paused",
      reason: "Stripe reports that the customer's subscription is paused.",
      reasonCode: "SUBSCRIPTION_PAUSED",
      impact: "The customer cannot continue paid service while the subscription remains paused.",
      lastCheckpoint: "Stripe reported the subscription as paused",
      nextAction: "Open the customer subscription in Stripe, confirm why it paused and whether a payment method is required, then resume it only when the billing state is valid.",
      confidence: "high",
    };
  }

  const stripeTrialFailed = Boolean(String(signup.stripeTrialError || "").trim());
  const subscriptionStatus = safeBillingStatus(signup.subscriptionStatus);
  const trialRecovered = Boolean(signup.subscriptionId) && ["trialing", "active"].includes(subscriptionStatus);
  if (stripeTrialFailed && !trialRecovered) {
    return {
      kind: "stripe_trial_creation_failed",
      title: "Stripe trial creation failed",
      reason: "The backend recorded a failure while asking Stripe to create the no-card trial subscription.",
      reasonCode: "STRIPE_TRIAL_CREATION_FAILED",
      impact: "The customer may have a provisioned assistant but does not have a confirmed trial subscription.",
      lastCheckpoint: "Assistant provisioning completed; Stripe trial creation did not",
      nextAction: "Open Stripe API logs and the My AI PA incident using the recorded time, verify the account and price configuration, confirm no subscription was created, then retry once.",
      confidence: "high",
    };
  }
  return null;
}

function signupLastCheckpoint(status) {
  if (status === "pending_email_verification") return "Verification message sent";
  if (/^provisioning_/i.test(status)) return "Provisioning handoff returned";
  if (/^subscription_/i.test(status)) return "Trial or subscription recorded";
  if (status === "setup_started") return "Automated setup started";
  if (status === "signup_received") return "Signup received";
  if (status === "manual_review_reopened" || status === "review_required") return "Signup held for manual review";
  return "Signup workflow stopped before setup was ready";
}

function signupFailureReason(signup = {}, status = "unknown") {
  const phoneCode = safeReasonCode(signup.phoneProvisioningCode);
  const makeKind = safeDiagnosticLabel(signup.makeResponseKind);
  if (phoneCode === "PHONE_NUMBER_PENDING") {
    return { reason: "Provisioning returned without a verified phone number.", reasonCode: phoneCode, confidence: "high" };
  }
  if (phoneCode === "CANADIAN_PHONE_REQUIRED") {
    return { reason: "The assigned number failed the Canadian-number safety check.", reasonCode: phoneCode, confidence: "high" };
  }
  if (["PHONE_VALIDATION_UNAVAILABLE", "PHONE_NOT_OWNED", "VOICE_ROUTING_MISSING", "PHONE_VALIDATION_FAILED", "PROVISIONED_NUMBER_NOT_READY"].includes(phoneCode)) {
    return { reason: "The assigned number could not be verified as owned and ready for calls.", reasonCode: phoneCode, confidence: "high" };
  }
  if (makeKind === "empty") {
    return { reason: "The provisioning automation returned an empty response.", reasonCode: "MAKE_SIGNUP_RESPONSE_EMPTY", confidence: "high" };
  }
  if (makeKind === "acknowledged_incomplete") {
    return { reason: "The provisioning automation acknowledged the signup but did not return every required setup identifier.", reasonCode: "MAKE_SIGNUP_RESPONSE_INCOMPLETE", confidence: "high" };
  }
  if (makeKind === "rejected") {
    return { reason: "The provisioning automation rejected the signup request.", reasonCode: "MAKE_SIGNUP_REJECTED", confidence: "high" };
  }
  if (signup.smsRoutingStatus === "failed") {
    return { reason: "SMS routing did not complete for the signup.", reasonCode: "SMS_ROUTING_FAILED", confidence: "high" };
  }
  if (/^provisioning_(pending|unknown)$/i.test(status)) {
    return { reason: "Provisioning did not produce a verified phone and assistant before the safety timeout.", reasonCode: "PROVISIONING_NOT_READY", confidence: "high" };
  }
  return { reason: "The signup workflow stopped before the phone and assistant were verified.", reasonCode: "SIGNUP_SETUP_FAILED", confidence: "medium" };
}

function signupDiagnostics(signup = {}, status = "unknown") {
  return {
    status: safeDiagnosticLabel(status) || "unknown",
    paymentStatus: safeBillingStatus(signup.paymentStatus),
    subscriptionStatus: safeBillingStatus(signup.subscriptionStatus),
    stripeTrialFailed: Boolean(String(signup.stripeTrialError || "").trim()),
    makeStatus: Number.isFinite(Number(signup.makeStatus)) ? Number(signup.makeStatus) : null,
    makeError: Boolean(signup.makeError),
    smsRoutingStatus: safeDiagnosticLabel(signup.smsRoutingStatus),
    signupSource: safeDiagnosticLabel(signup.signupSource),
    reviewRequired: Boolean(signup.reviewRequired),
    emailVerified: Boolean(signup.emailVerified || signup.emailVerifiedAt),
    smsVerified: Boolean(signup.smsVerified || signup.smsVerifiedAt),
    hasAssignedPhone: Boolean(signup.twilioPhoneNumber),
    hasAssistant: Boolean(signup.vapiAssistantId),
    hasCheckout: Boolean(signup.checkoutSessionId),
    hasSubscription: Boolean(signup.subscriptionId),
    phoneProvisioningStatus: safeDiagnosticLabel(signup.phoneProvisioningStatus),
    phoneProvisioningCode: safeDiagnosticLabel(signup.phoneProvisioningCode),
    makeResponseKind: safeDiagnosticLabel(signup.makeResponseKind),
    signupAlertFailed: Boolean(signup.signupTelegramAlertError),
  };
}

function signupIdentity(signup = {}) {
  return String(signup.subscriptionId || signup.checkoutSessionId || signup.ownerEmail || signup.businessName || signup.signedUpAt || "unknown");
}

function signupAttentionItems(signups = [], now = new Date(), stuckMinutes = 60) {
  const items = [];
  const seenIdentities = new Map();
  for (const signup of signups.filter(Boolean)) {
    const identity = signupIdentity(signup);
    const targetId = hashTarget(identity);
    const status = String(signup.status || "unknown");
    const updatedAt = signup.updatedAt || signup.signedUpAt || signup.createdAt;
    const age = ageMinutes(updatedAt, now);
    const billingAttention = signupBillingAttention(signup, status);
    if (billingAttention) {
      items.push(attentionItem({
        ...billingAttention,
        severity: "critical",
        summary: "A Stripe billing state needs review before the customer can finish or continue service.",
        businessName: signup.businessName,
        lastCheckpoint: billingAttention.lastCheckpoint || signupLastCheckpoint(status),
        detectedAt: signup.lastPaymentFailedAt || updatedAt,
        ageMinutes: ageMinutes(signup.lastPaymentFailedAt || updatedAt, now),
        targetType: "signup",
        targetId,
        actions: [],
        diagnostics: signupDiagnostics(signup, status),
      }));
    } else if (FAILED_SIGNUP.test(status) || signup.makeError || signup.smsRoutingStatus === "failed") {
      const failure = signupFailureReason(signup, status);
      items.push(attentionItem({
        kind: "signup_failed",
        severity: "critical",
        title: "Signup setup failed",
        summary: "A signup needs review before the customer can finish setup.",
        businessName: signup.businessName,
        ...failure,
        impact: "The customer does not yet have a verified, usable My AI PA setup.",
        lastCheckpoint: signupLastCheckpoint(status),
        nextAction: "Inspect the safe diagnostics, correct the failed checkpoint, then run guarded signup recovery.",
        detectedAt: updatedAt,
        ageMinutes: age,
        targetType: "signup",
        targetId,
        actions: ["recover_signup", "reopen_signup"],
        diagnostics: signupDiagnostics(signup, status),
      }));
    } else if (
      BLOCKED_PROVISIONING.test(status)
      && (Boolean(signup.phoneProvisioningCode) || (age != null && age >= stuckMinutes))
    ) {
      const failure = signupFailureReason(signup, status);
      items.push(attentionItem({
        kind: "signup_failed",
        severity: "critical",
        title: "Signup provisioning did not finish",
        summary: signup.phoneProvisioningCode
          ? "Provisioning returned without a verified usable phone and assistant."
          : `A verified signup has had no usable phone or assistant for at least ${stuckMinutes} minutes.`,
        businessName: signup.businessName,
        ...failure,
        impact: "The customer cannot use the promised assistant number.",
        lastCheckpoint: signupLastCheckpoint(status),
        nextAction: "Verify the phone and assistant records, then run guarded signup recovery or reopen the signup.",
        detectedAt: updatedAt,
        ageMinutes: age,
        targetType: "signup",
        targetId,
        actions: ["recover_signup", "reopen_signup"],
        diagnostics: signupDiagnostics(signup, status),
      }));
    } else if (IN_PROGRESS_SIGNUP.test(status) && age != null && age >= stuckMinutes) {
      const waitingForVerification = status === "pending_email_verification";
      items.push(attentionItem({
        kind: "signup_stuck",
        severity: "warning",
        title: "Signup appears stuck",
        summary: `Setup has not advanced for at least ${stuckMinutes} minutes.`,
        businessName: signup.businessName,
        reason: waitingForVerification
          ? "The signup is still waiting for the customer to verify their email."
          : "The signup has remained at the same safe checkpoint longer than expected.",
        impact: waitingForVerification
          ? "Provisioning cannot begin until verification is complete."
          : "The customer may be waiting without a usable phone or assistant.",
        lastCheckpoint: signupLastCheckpoint(status),
        nextAction: waitingForVerification
          ? "Resend the verification message or reopen the signup if the original request expired."
          : "Inspect the safe diagnostics, then recover or reopen the signup without creating duplicate resources.",
        reasonCode: waitingForVerification ? "EMAIL_VERIFICATION_PENDING" : "SIGNUP_CHECKPOINT_STALE",
        confidence: "high",
        detectedAt: updatedAt,
        ageMinutes: age,
        targetType: "signup",
        targetId,
        actions: status === "pending_email_verification"
          ? ["resend_signup_verification", "reopen_signup"]
          : ["recover_signup", "reopen_signup"],
        diagnostics: signupDiagnostics(signup, status),
      }));
    } else if (signup.reviewRequired || status === "manual_review_reopened") {
      items.push(attentionItem({
        kind: "signup_review_required",
        severity: "warning",
        title: "Signup is waiting for manual recovery",
        summary: "The signup was reopened and must remain visible until setup is completed or deliberately closed.",
        businessName: signup.businessName,
        reason: "A safety or operator review flag is holding the signup before it can go live.",
        impact: "No new phone or assistant should be provisioned until the review is completed.",
        lastCheckpoint: signupLastCheckpoint(status),
        nextAction: "Review the saved signup snapshot and run guarded recovery only after it is confirmed safe.",
        reasonCode: "MANUAL_REVIEW_REQUIRED",
        confidence: "high",
        detectedAt: signup.reopenedAt || updatedAt,
        ageMinutes: ageMinutes(signup.reopenedAt || updatedAt, now),
        targetType: "signup",
        targetId,
        actions: ["recover_signup"],
        diagnostics: signupDiagnostics(signup, status),
      }));
    }
    const duplicateKey = String(signup.ownerEmail || signup.checkoutSessionId || "").trim().toLowerCase();
    if (duplicateKey) {
      const duplicate = seenIdentities.get(duplicateKey) || { count: 0, businessName: "" };
      seenIdentities.set(duplicateKey, {
        count: duplicate.count + 1,
        businessName: duplicate.businessName || safeIncidentText(signup.businessName, "", 120),
      });
    }
  }
  for (const [identity, duplicate] of seenIdentities) {
    if (duplicate.count < 2) continue;
    items.push(attentionItem({
      kind: "signup_duplicate",
      severity: "warning",
      title: "Duplicate signup records detected",
      summary: `${duplicate.count} records share the same signup identity and should be reviewed before provisioning.`,
      businessName: duplicate.businessName,
      reason: "More than one signup record maps to the same redacted identity.",
      impact: "An unsafe retry could create duplicate phone, assistant, or billing resources.",
      lastCheckpoint: "Signup identity safety check",
      nextAction: "Compare the records and choose one canonical signup before provisioning anything.",
      reasonCode: "DUPLICATE_SIGNUP_IDENTITY",
      confidence: "high",
      targetType: "signup",
      targetId: hashTarget(identity),
    }));
  }
  return items;
}

function summarizeAttention(items = []) {
  const bySeverity = { critical: 0, warning: 0, info: 0 };
  const byKind = {};
  for (const item of items) {
    bySeverity[item.severity] = (bySeverity[item.severity] || 0) + 1;
    byKind[item.kind] = (byKind[item.kind] || 0) + 1;
  }
  return { total: items.length, bySeverity, byKind, healthy: items.length === 0 };
}

async function getOperationalAttentionInbox({ prisma, signups = [], runtimeIncidents = [], now = new Date(), lookbackHours = 24 } = {}) {
  const cutoff = new Date(now.getTime() - Math.max(1, lookbackHours) * 60 * 60 * 1000);
  const stuckToolCutoff = new Date(now.getTime() - 10 * 60 * 1000);
  const [handoffs, calls, businesses, toolExecutions, supportReports] = await Promise.all([
    prisma.leadHandoff.findMany({
      where: { status: { in: PROBLEM_HANDOFF_STATUSES } },
      select: { id: true, status: true, businessId: true, callId: true, updatedAt: true, retryCount: true, lastErrorCode: true },
      orderBy: { updatedAt: "desc" },
      take: 200,
    }),
    prisma.call.findMany({
      where: { status: "COMPLETED", startedAt: { gte: cutoff } },
      select: { id: true, businessId: true, startedAt: true, lead: { select: { id: true } }, leadHandoffs: { select: { id: true } } },
      orderBy: { startedAt: "desc" },
      take: 300,
    }),
    prisma.business.findMany({
      select: { id: true, name: true, settings: { select: { ownerPhone: true } }, vapiMappings: { select: { id: true } } },
      take: 500,
    }),
    prisma.vapiToolExecution.findMany({
      where: { OR: [{ status: "FAILED" }, { status: "PROCESSING", createdAt: { lt: stuckToolCutoff } }, { status: "COMPLETED", createdAt: { gte: cutoff } }] },
      select: { id: true, businessId: true, status: true, createdAt: true, errorCode: true, result: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    prisma.supportReport.findMany({
      where: { severity: "HIGH", status: { not: "RESOLVED" } },
      select: { id: true, businessId: true, createdAt: true, status: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);

  const businessNames = new Map(
    businesses.map((business) => [Number(business.id), safeIncidentText(business.name, "", 120)])
  );
  const businessNameFor = (businessId) => businessNames.get(Number(businessId)) || "";
  const activeRuntimeIncidents = (Array.isArray(runtimeIncidents) ? runtimeIncidents : [])
    .filter((item) => item?.incident?.reasonCode !== "CONTROLLED_READINESS_REMEDIATION_TEST")
    .filter((item) => !["resolved", "recovered", "not_required"].includes(String(item?.remediation?.status || "")));
  const items = [
    ...signupAttentionItems(signups, now, 10),
    ...activeRuntimeIncidents,
  ];
  for (const handoff of handoffs) {
    const failed = handoff.status === "FAILED";
    const retryDue = handoff.status === "RETRY_DUE";
    const providerFailure = knownProviderReason(handoff.lastErrorCode);
    items.push(attentionItem({
      kind: "owner_text_failed",
      severity: failed ? "critical" : "warning",
      title: retryDue ? "Owner text needs a retry" : "Owner text needs attention",
      summary: "The owner notification did not complete normally.",
      businessName: businessNameFor(handoff.businessId),
      reason: providerFailure?.reason || (failed
        ? "The owner notification ended in a failed delivery state."
        : retryDue
          ? "The owner notification did not complete and is eligible for another guarded attempt."
          : "The owner did not acknowledge the lead before the configured response window ended."),
      impact: "The business owner may not have received or acknowledged a new lead.",
      lastCheckpoint: failed ? "Owner text delivery failed" : retryDue ? "Owner text retry became due" : "Owner acknowledgement window expired",
      nextAction: retryDue || failed
        ? "Retry the owner text once, then verify the recorded delivery result."
        : "Verify the backup contact and review the lead escalation before sending again.",
      reasonCode: providerFailure?.reasonCode || (failed ? "OWNER_TEXT_DELIVERY_FAILED" : retryDue ? "OWNER_TEXT_RETRY_DUE" : "OWNER_ACKNOWLEDGEMENT_OVERDUE"),
      confidence: "high",
      detectedAt: handoff.updatedAt,
      ageMinutes: ageMinutes(handoff.updatedAt, now),
      businessId: handoff.businessId,
      targetType: "lead_handoff",
      targetId: handoff.id,
      actions: ["retry_owner_text"],
    }));
  }
  for (const call of calls) {
    if (!call.lead || call.leadHandoffs.length) continue;
    items.push(attentionItem({
      kind: "call_missing_handoff",
      severity: "critical",
      title: "Completed lead has no recorded owner handoff",
      summary: "The call completed and produced a lead, but no owner text delivery record exists.",
      businessName: businessNameFor(call.businessId),
      reason: "A completed call produced a lead without creating an owner-notification record.",
      impact: "The owner may never receive the lead details needed for follow-up.",
      lastCheckpoint: "Lead saved after completed call",
      nextAction: "Resync the call, then confirm an owner handoff and delivery record were created.",
      reasonCode: "LEAD_HANDOFF_MISSING",
      confidence: "high",
      detectedAt: call.startedAt,
      ageMinutes: ageMinutes(call.startedAt, now),
      businessId: call.businessId,
      targetType: "call",
      targetId: String(call.id),
      actions: ["sync_calls"],
    }));
  }
  for (const business of businesses) {
    if (!business.settings?.ownerPhone || !business.vapiMappings.length) {
      const ownerPhoneMissing = !business.settings?.ownerPhone;
      items.push(attentionItem({
        kind: "business_mapping_incomplete",
        severity: "warning",
        title: "Business routing is incomplete",
        summary: ownerPhoneMissing ? "An owner notification number is missing." : "No phone or assistant mapping is recorded.",
        businessName: business.name,
        reason: ownerPhoneMissing
          ? "The business has no configured owner notification number."
          : "The business has no trusted phone or assistant mapping.",
        impact: ownerPhoneMissing
          ? "Lead alerts cannot be delivered to the business owner."
          : "Incoming calls cannot be safely attributed to this business.",
        lastCheckpoint: "Business routing configuration audit",
        nextAction: ownerPhoneMissing
          ? "Add and verify the approved owner notification number."
          : "Connect the correct phone and assistant mapping, then rerun the routing audit.",
        reasonCode: ownerPhoneMissing ? "OWNER_NOTIFICATION_PHONE_MISSING" : "PHONE_ASSISTANT_MAPPING_MISSING",
        confidence: "high",
        businessId: business.id,
        targetType: "business",
        targetId: String(business.id),
      }));
    }
  }
  for (const execution of toolExecutions) {
    const result = execution.result && typeof execution.result === "object" ? execution.result : {};
    if (execution.status === "COMPLETED") {
      const ownerExpected = result.ownerSmsEnabled !== false;
      const ownerFailed = ownerExpected && result.owner && result.owner.sent !== true;
      const customerFailed = result.customer && result.customer.sent !== true;
      if (!result.requiresReconciliation && !ownerFailed && !customerFailed) continue;
      const failedSides = [ownerFailed ? "owner" : "", customerFailed ? "customer" : ""].filter(Boolean);
      items.push(attentionItem({
        kind: customerFailed ? "call_text_incomplete" : "owner_text_failed",
        severity: "critical",
        title: failedSides.length ? `${failedSides.join(" and ")} text did not complete` : "Call texts need reconciliation",
        summary: "The call action completed, but the expected text delivery result was incomplete.",
        businessName: businessNameFor(execution.businessId),
        reason: failedSides.length
          ? `The call action completed without a successful ${failedSides.join(" and ")} text result.`
          : "The completed call action still requires notification reconciliation.",
        impact: customerFailed
          ? "The customer may not know the request was received, and the owner may also be missing follow-up details."
          : "The owner may not have received the callback-ready lead summary.",
        lastCheckpoint: "Call action completed",
        nextAction: "Resync the call and verify each expected text has a final delivery record before retrying.",
        reasonCode: customerFailed ? "CALL_TEXT_RESULT_INCOMPLETE" : "OWNER_TEXT_RESULT_INCOMPLETE",
        confidence: "high",
        detectedAt: execution.createdAt,
        ageMinutes: ageMinutes(execution.createdAt, now),
        businessId: execution.businessId,
        targetType: "tool_execution",
        targetId: execution.id,
        actions: ["sync_calls"],
      }));
      continue;
    }
    const executionFailed = execution.status === "FAILED";
    const providerFailure = knownProviderReason(execution.errorCode);
    items.push(attentionItem({
      kind: executionFailed ? "call_tool_failed" : "call_tool_stuck",
      severity: executionFailed ? "critical" : "warning",
      title: executionFailed ? "Call action failed" : "Call action appears stuck",
      summary: "A call action did not finish normally.",
      businessName: businessNameFor(execution.businessId),
      reason: providerFailure?.reason || (executionFailed
        ? "A call-side action stopped before it completed."
        : "A call-side action remained in progress beyond the safety window."),
      impact: "Lead capture or follow-up messaging may be incomplete for the affected call.",
      lastCheckpoint: executionFailed ? "Call action recorded a failure" : "Call action started but did not finish",
      nextAction: "Resync the affected call, inspect the safe action result, and retry only if no completed result exists.",
      reasonCode: providerFailure?.reasonCode || (executionFailed ? "CALL_TOOL_EXECUTION_FAILED" : "CALL_TOOL_EXECUTION_STUCK"),
      confidence: "high",
      detectedAt: execution.createdAt,
      ageMinutes: ageMinutes(execution.createdAt, now),
      businessId: execution.businessId,
      targetType: "tool_execution",
      targetId: execution.id,
      actions: ["sync_calls"],
    }));
  }
  for (const report of supportReports) {
    items.push(attentionItem({
      kind: "high_priority_support",
      severity: "critical",
      title: "High-priority customer report is open",
      summary: "A customer-reported problem is waiting for investigation or resolution.",
      businessName: businessNameFor(report.businessId),
      reason: "A customer submitted a high-priority report that is still open.",
      impact: "The customer is waiting for acknowledgement, investigation, or a confirmed resolution.",
      lastCheckpoint: `Support report is ${safeIncidentText(report.status, "open", 40).toLowerCase()}`,
      nextAction: "Open the support report, confirm the reported symptoms, and move it into investigation.",
      reasonCode: "HIGH_PRIORITY_SUPPORT_OPEN",
      confidence: "medium",
      detectedAt: report.createdAt,
      ageMinutes: ageMinutes(report.createdAt, now),
      businessId: report.businessId,
      targetType: "support_report",
      targetId: report.id,
    }));
  }

  const priority = { critical: 0, warning: 1, info: 2 };
  items.sort((left, right) => (priority[left.severity] ?? 9) - (priority[right.severity] ?? 9) || (right.ageMinutes || 0) - (left.ageMinutes || 0));
  return { generatedAt: now.toISOString(), summary: summarizeAttention(items), items };
}

module.exports = {
  ageMinutes,
  getOperationalAttentionInbox,
  hashTarget,
  knownProviderReason,
  signupAttentionItems,
  summarizeAttention,
};
