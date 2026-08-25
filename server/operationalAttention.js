const crypto = require("crypto");

const FAILED_SIGNUP = /(error|failed|rejected|blocked)/i;
const IN_PROGRESS_SIGNUP = /^(signup_received|checkout_completed|setup_started|pending_email_verification|subscription_(trialing|active))$/i;
const PROBLEM_HANDOFF_STATUSES = ["RETRY_DUE", "ESCALATION_DUE", "FAILED"];

function hashTarget(value) {
  return crypto.createHash("sha256").update(String(value || "unknown")).digest("hex").slice(0, 24);
}

function ageMinutes(value, now = new Date()) {
  const timestamp = new Date(value || 0).getTime();
  return Number.isFinite(timestamp) && timestamp > 0 ? Math.max(0, Math.floor((now.getTime() - timestamp) / 60_000)) : null;
}

function attentionItem(input) {
  const identity = `${input.kind}:${input.targetType || "none"}:${input.targetId || "none"}`;
  return {
    id: hashTarget(identity),
    kind: input.kind,
    severity: input.severity || "warning",
    title: input.title,
    summary: input.summary,
    detectedAt: input.detectedAt || new Date().toISOString(),
    ageMinutes: input.ageMinutes ?? null,
    businessId: input.businessId || null,
    targetType: input.targetType || "",
    targetId: input.targetId || "",
    actions: input.actions || [],
    ...(input.diagnostics ? { diagnostics: input.diagnostics } : {}),
  };
}

function safeDiagnosticLabel(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, "_")
    .slice(0, 80);
}

function signupDiagnostics(signup = {}, status = "unknown") {
  return {
    status: safeDiagnosticLabel(status) || "unknown",
    paymentStatus: safeDiagnosticLabel(signup.paymentStatus),
    makeStatus: Number.isFinite(Number(signup.makeStatus)) ? Number(signup.makeStatus) : null,
    makeError: Boolean(signup.makeError),
    smsRoutingStatus: safeDiagnosticLabel(signup.smsRoutingStatus),
    signupSource: safeDiagnosticLabel(signup.signupSource),
    reviewRequired: Boolean(signup.reviewRequired),
    emailVerified: Boolean(signup.emailVerified),
    smsVerified: Boolean(signup.smsVerified),
    hasAssignedPhone: Boolean(signup.twilioPhoneNumber),
    hasAssistant: Boolean(signup.vapiAssistantId),
    hasCheckout: Boolean(signup.checkoutSessionId),
    hasSubscription: Boolean(signup.subscriptionId),
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
    if (FAILED_SIGNUP.test(status) || signup.makeError || signup.smsRoutingStatus === "failed") {
      items.push(attentionItem({
        kind: signup.paymentStatus === "payment_failed" ? "payment_failed" : "signup_failed",
        severity: "critical",
        title: signup.paymentStatus === "payment_failed" ? "Customer payment failed" : "Signup setup failed",
        summary: "A signup needs review before the customer can finish setup.",
        detectedAt: updatedAt,
        ageMinutes: age,
        targetType: "signup",
        targetId,
        actions: ["recover_signup", "reopen_signup"],
        diagnostics: signupDiagnostics(signup, status),
      }));
    } else if (IN_PROGRESS_SIGNUP.test(status) && age != null && age >= stuckMinutes) {
      items.push(attentionItem({
        kind: "signup_stuck",
        severity: "warning",
        title: "Signup appears stuck",
        summary: `Setup has not advanced for at least ${stuckMinutes} minutes.`,
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
        detectedAt: signup.reopenedAt || updatedAt,
        ageMinutes: ageMinutes(signup.reopenedAt || updatedAt, now),
        targetType: "signup",
        targetId,
        actions: ["recover_signup"],
        diagnostics: signupDiagnostics(signup, status),
      }));
    }
    const duplicateKey = String(signup.ownerEmail || signup.checkoutSessionId || "").trim().toLowerCase();
    if (duplicateKey) seenIdentities.set(duplicateKey, (seenIdentities.get(duplicateKey) || 0) + 1);
  }
  for (const [identity, count] of seenIdentities) {
    if (count < 2) continue;
    items.push(attentionItem({
      kind: "signup_duplicate",
      severity: "warning",
      title: "Duplicate signup records detected",
      summary: `${count} records share the same signup identity and should be reviewed before provisioning.`,
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

async function getOperationalAttentionInbox({ prisma, signups = [], now = new Date(), lookbackHours = 24 } = {}) {
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
      select: { id: true, settings: { select: { ownerPhone: true } }, vapiMappings: { select: { id: true } } },
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

  const items = signupAttentionItems(signups, now, 10);
  for (const handoff of handoffs) {
    items.push(attentionItem({
      kind: "owner_text_failed",
      severity: handoff.status === "FAILED" ? "critical" : "warning",
      title: handoff.status === "RETRY_DUE" ? "Owner text needs a retry" : "Owner text needs attention",
      summary: handoff.lastErrorCode ? `Delivery record: ${String(handoff.lastErrorCode).slice(0, 80)}.` : "The owner notification did not complete normally.",
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
      items.push(attentionItem({
        kind: "business_mapping_incomplete",
        severity: "warning",
        title: "Business routing is incomplete",
        summary: !business.settings?.ownerPhone ? "An owner notification number is missing." : "No phone or assistant mapping is recorded.",
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
        detectedAt: execution.createdAt,
        ageMinutes: ageMinutes(execution.createdAt, now),
        businessId: execution.businessId,
        targetType: "tool_execution",
        targetId: execution.id,
        actions: ["sync_calls"],
      }));
      continue;
    }
    items.push(attentionItem({
      kind: execution.status === "FAILED" ? "call_tool_failed" : "call_tool_stuck",
      severity: execution.status === "FAILED" ? "critical" : "warning",
      title: execution.status === "FAILED" ? "Call action failed" : "Call action appears stuck",
      summary: execution.errorCode ? `Action result: ${String(execution.errorCode).slice(0, 80)}.` : "A call action did not finish normally.",
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
  signupAttentionItems,
  summarizeAttention,
};
