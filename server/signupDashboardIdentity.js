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
  const ownerEmail = String(record.ownerEmail || "").trim().toLowerCase();
  if (ownerEmail) return `email:${ownerEmail}`;
  const checkoutSessionId = String(record.checkoutSessionId || "").trim();
  if (checkoutSessionId) return `checkout:${checkoutSessionId}`;
  return "";
}

function getSignupAliases(record = {}) {
  return [
    getSignupAttemptKey(record),
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
    return candidate && !normalizedAttemptId(candidate);
  }) || getSignupDashboardKey(record);
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

module.exports = {
  canRemoveSignupAlias,
  findSignupDashboardExistingKey,
  getSignupAliases,
  getSignupAttemptKey,
  getSignupDashboardKey,
  normalizeSignupSubmissionId,
  normalizedAttemptId,
};
