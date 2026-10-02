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
    return Boolean(mergedAttemptId && candidateAttemptId && mergedAttemptId === candidateAttemptId);
  }
  return true;
}

// Billing reminders are metadata for a subscription, not new signups. Never
// join by email: one owner can have multiple businesses or signup attempts.
function findSignupReminderKey(store = {}, reminder = {}) {
  const subscriptionId = String(reminder.subscriptionId || "").trim();
  if (!subscriptionId) return null;
  const matches = Object.entries(store).filter(([, candidate]) =>
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
  selectSignupDashboardRecordForProvisioning,
};
