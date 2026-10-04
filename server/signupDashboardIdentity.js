const { signupBusinessKey } = require("./signupBusinessIdentity");

function normalizedAttemptId(record = {}) {
  return String(record.signupAttemptId || "").trim();
}

function normalizeSignupSubmissionId(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized)
    ? normalized
    : "";
}

function getSignupAttemptKey(record = {}) {
  const attemptId = normalizedAttemptId(record);
  return attemptId ? `attempt:${attemptId}` : "";
}

function getSignupDashboardKey(record = {}) {
  const attemptKey = getSignupAttemptKey(record);
  if (attemptKey) return attemptKey;
  const subscriptionId = String(record.subscriptionId || "").trim();
  if (subscriptionId) return `sub:${subscriptionId}`;
  const businessKey = signupBusinessKey(record);
  if (businessKey) return `business:${businessKey}`;
  const ownerEmail = String(record.ownerEmail || "").trim().toLowerCase();
  if (ownerEmail) return `email:${ownerEmail}`;
  const checkoutSessionId = String(record.checkoutSessionId || "").trim();
  if (checkoutSessionId) return `checkout:${checkoutSessionId}`;
  return "";
}

function getSignupAliases(record = {}) {
  return [
    getSignupAttemptKey(record),
    signupBusinessKey(record) ? `business:${signupBusinessKey(record)}` : "",
    record.subscriptionId ? `sub:${String(record.subscriptionId).trim()}` : "",
    record.ownerEmail ? `email:${String(record.ownerEmail).trim().toLowerCase()}` : "",
    record.checkoutSessionId ? `checkout:${String(record.checkoutSessionId).trim()}` : "",
  ].filter(Boolean);
}

function findSignupDashboardExistingKey(store = {}, record = {}) {
  const attemptId = normalizedAttemptId(record);
  const attemptKey = getSignupAttemptKey(record);
  if (attemptId) {
    if (store[attemptKey]) return attemptKey;
    const legacyAttemptEntry = Object.entries(store).find(([, candidate]) => (
      normalizedAttemptId(candidate) === attemptId
    ));
    return legacyAttemptEntry?.[0] || attemptKey;
  }

  // Stripe webhooks often arrive without an attempt ID. Join by the exact
  // subscription (or a complete business identity before its first callback),
  // never by owner email. Otherwise a second billing-only signup is created.
  const subscriptionId = String(record.subscriptionId || "").trim();
  if (subscriptionId) {
    const exact = Object.entries(store).filter(([, candidate]) => normalizedAttemptId(candidate)
      && String(candidate.subscriptionId || "").trim() === subscriptionId);
    if (exact.length > 1) throw Object.assign(new Error("Subscription ownership is ambiguous."), { code: "SIGNUP_SUBSCRIPTION_IDENTITY_CONFLICT" });
    if (exact.length === 1) return exact[0][0];
    const businessKey = signupBusinessKey(record);
    const pending = businessKey ? Object.entries(store).filter(([, candidate]) => normalizedAttemptId(candidate)
      && signupBusinessKey(candidate) === businessKey && !candidate.subscriptionId) : [];
    if (pending.length > 1) throw Object.assign(new Error("Business billing ownership is ambiguous."), { code: "SIGNUP_SUBSCRIPTION_IDENTITY_CONFLICT" });
    if (pending.length === 1) return pending[0][0];
  }
  const aliases = getSignupAliases(record);
  return aliases.find((alias) => {
    const candidate = store[alias];
    return candidate && !normalizedAttemptId(candidate) && (!signupBusinessKey(record) || signupBusinessKey(candidate) === signupBusinessKey(record));
  }) || getSignupDashboardKey(record);
}

function selectSignupDashboardRecordForProvisioning(records = [], identity = {}) {
  const candidates = Array.isArray(records) ? records : [];
  const attemptId = normalizedAttemptId(identity);
  if (attemptId) {
    return candidates.find((candidate) => normalizedAttemptId(candidate) === attemptId) || null;
  }

  const ownerEmail = String(identity.ownerEmail || "").trim().toLowerCase();
  if (!ownerEmail) return null;
  const legacyMatches = candidates.filter((candidate) => (
    !normalizedAttemptId(candidate)
    && String(candidate?.ownerEmail || "").trim().toLowerCase() === ownerEmail
  ));
  return legacyMatches.length === 1 ? legacyMatches[0] : null;
}

function canRemoveSignupAlias(candidate = {}, merged = {}) {
  if (!candidate || typeof candidate !== "object") return false;
  const mergedAttemptId = normalizedAttemptId(merged);
  const candidateAttemptId = normalizedAttemptId(candidate);
  if (mergedAttemptId || candidateAttemptId) {
    if (mergedAttemptId && !candidateAttemptId && isBillingAlias(candidate, merged)) return true;
    return Boolean(mergedAttemptId && candidateAttemptId && mergedAttemptId === candidateAttemptId);
  }
  return true;
}

function isBillingAlias(candidate = {}, canonical = {}) {
  const subscription = String(candidate.subscriptionId || "").trim();
  const businessKey = signupBusinessKey(candidate);
  return Boolean(!normalizedAttemptId(candidate) && normalizedAttemptId(canonical)
    && subscription && subscription === String(canonical.subscriptionId || "").trim()
    && businessKey && businessKey === signupBusinessKey(canonical)
    && !candidate.twilioPhoneNumber && !candidate.vapiAssistantId && !candidate.vapiPhoneNumberId
    && !candidate.checkoutSessionId && !candidate.signupSource);
}

function preserveSignupWorkflowForBilling(existing = {}, incoming = {}) {
  if (!normalizedAttemptId(existing) || !incoming.subscriptionId) return incoming;
  const result = { ...incoming };
  // Billing is a separate state dimension; a healthy Stripe update must not
  // replace setup_ready, pending_verification, or an unresolved setup failure.
  if (/^subscription_(trialing|active|updated)$/.test(String(incoming.status || ""))) result.status = existing.status || incoming.status;
  for (const key of ["ownerEmail", "ownerPhone", "ownerName", "businessName"]) {
    if (!String(result[key] || "").trim() && existing[key]) result[key] = existing[key];
  }
  return result;
}

function withoutBillingAliases(store = {}) {
  const result = { ...store };
  for (const [key, candidate] of Object.entries(store)) {
    const owners = Object.entries(store).filter(([, canonical]) => isBillingAlias(candidate, canonical));
    if (owners.length !== 1) continue;
    const [ownerKey] = owners[0];
    const canonical = { ...result[ownerKey] };
    // Preserve billing and gate evidence before removing a display-only alias.
    // Never borrow contacts, verification, readiness, or paid resource IDs.
    for (const field of ['subscriptionStatus','paymentMethodReady','trialStartAt','trialEndAt','periodStartAt','periodEndAt','trialUsageGateStatus','trialUsageGateActivatedAt','trialUsageLimitMinutes','trialUsageWarningMinutes','trialUsageCompletionReserveMinutes']) {
      if (canonical[field] == null && candidate[field] != null) canonical[field] = candidate[field];
    }
    if (Number.isFinite(Date.parse(candidate.agentRouteBindingVerifiedAt))
      && Date.parse(candidate.agentRouteBindingVerifiedAt) > (Date.parse(canonical.agentRouteBindingVerifiedAt) || 0)) {
      for (const field of ['agentRouteBindingStatus','agentRouteBindingMode','agentRouteBindingFingerprint','agentRouteBindingVerifiedAt']) {
        if (candidate[field] != null) canonical[field] = candidate[field];
      }
    }
    result[ownerKey] = canonical;
    delete result[key];
  }
  return result;
}

// Billing reminders are metadata for a subscription, not new signups. Never
// join by email: one owner can have multiple businesses or signup attempts.
function findSignupReminderKey(store = {}, reminder = {}) {
  const subscriptionId = String(reminder.subscriptionId || "").trim();
  if (!subscriptionId) return null;
  const matches = Object.entries(withoutBillingAliases(store)).filter(([, candidate]) =>
    String(candidate?.subscriptionId || "").trim() === subscriptionId
  );
  return matches.length === 1 ? matches[0][0] : null;
}

module.exports = {
  canRemoveSignupAlias,
  findSignupDashboardExistingKey,
  findSignupReminderKey,
  getSignupAliases,
  getSignupAttemptKey,
  getSignupDashboardKey,
  normalizeSignupSubmissionId,
  normalizedAttemptId,
  isBillingAlias,
  preserveSignupWorkflowForBilling,
  withoutBillingAliases,
  selectSignupDashboardRecordForProvisioning,
};
