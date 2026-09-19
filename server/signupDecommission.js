const crypto = require("crypto");

function clean(value) {
  return String(value || "").trim();
}

function normalizeEmail(value) {
  return clean(value).toLowerCase();
}

function normalizePhone(value) {
  const digits = clean(value).replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits ? `+${digits}` : "";
}

function hashOperationalTarget(record = {}) {
  const identity = clean(
    record.subscriptionId
      || record.checkoutSessionId
      || record.ownerEmail
      || record.businessName
      || record.signedUpAt
      || "unknown"
  );
  return crypto.createHash("sha256").update(identity).digest("hex").slice(0, 24);
}

function decommissionError(message, code, statusCode = 409) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function assertSharedSignupIdentity(signups = []) {
  if (!Array.isArray(signups) || signups.length < 1) {
    throw decommissionError("At least one signup record is required.", "SIGNUP_DECOMMISSION_TARGETS_REQUIRED", 400);
  }
  const emails = new Set(signups.map((record) => normalizeEmail(record.ownerEmail)).filter(Boolean));
  const phones = new Set(signups.map((record) => normalizePhone(record.ownerPhone)).filter(Boolean));
  if (emails.size < 1 || phones.size !== 1) {
    throw decommissionError(
      "The selected records do not share one verified owner phone.",
      "SIGNUP_DECOMMISSION_IDENTITY_MISMATCH"
    );
  }
  return { ownerEmails: [...emails].sort(), ownerPhone: [...phones][0] };
}

function selectNewestPendingSignup({ pendingStore = {}, identity = {}, expectedBusinessName = "", allowMissing = false } = {}) {
  const expectedName = clean(expectedBusinessName).toLowerCase();
  if (!expectedName) {
    throw decommissionError("The expected replacement business name is required.", "SIGNUP_DECOMMISSION_CANONICAL_NAME_REQUIRED", 400);
  }
  const matches = Object.entries(pendingStore)
    .filter(([, pending]) => pending?.payload)
    .filter(([, pending]) => {
      const payload = pending.payload || {};
      const email = normalizeEmail(pending.ownerEmail || payload?.owner?.email);
      const phone = normalizePhone(payload?.owner?.phone);
      const name = clean(pending.businessName || payload?.business?.name).toLowerCase();
      return Boolean(email) && phone === identity.ownerPhone && name === expectedName;
    })
    .sort((left, right) => Number(right[1]?.verifiedAt || right[1]?.createdAt || 0) - Number(left[1]?.verifiedAt || left[1]?.createdAt || 0));
  if (matches.length === 0 && allowMissing) return null;
  if (matches.length !== 1) {
    throw decommissionError(
      `Expected exactly one active replacement signup; found ${matches.length}.`,
      "SIGNUP_DECOMMISSION_CANONICAL_PAYLOAD_AMBIGUOUS"
    );
  }
  return matches[0];
}

function selectCanonicalSignupAttempt({ attempts = [], identity = {}, expectedBusinessName = "" } = {}) {
  const expectedName = clean(expectedBusinessName).toLowerCase();
  const matches = attempts
    .filter((attempt) => attempt?.payload)
    .filter((attempt) => {
      const payload = attempt.payload || {};
      const email = normalizeEmail(attempt.ownerEmail || payload?.owner?.email);
      const phone = normalizePhone(attempt.ownerPhone || payload?.owner?.phone);
      const name = clean(attempt.businessName || payload?.business?.name).toLowerCase();
      return Boolean(email) && phone === identity.ownerPhone && name === expectedName;
    });
  if (matches.length !== 1) {
    throw decommissionError(
      `Expected exactly one durable replacement signup; found ${matches.length}.`,
      "SIGNUP_DECOMMISSION_CANONICAL_ATTEMPT_AMBIGUOUS"
    );
  }
  return matches[0];
}

function collectSignupResourceReferences(signups = []) {
  const result = {
    phoneNumbers: new Set(),
    vapiPhoneIds: new Set(),
    vapiAssistantIds: new Set(),
    subscriptionIds: new Set(),
    customerIds: new Set(),
    checkoutSessionIds: new Set(),
  };
  for (const record of signups) {
    const phone = normalizePhone(record.twilioPhoneNumber);
    if (phone) result.phoneNumbers.add(phone);
    if (clean(record.vapiPhoneNumberId)) result.vapiPhoneIds.add(clean(record.vapiPhoneNumberId));
    if (clean(record.vapiAssistantId)) result.vapiAssistantIds.add(clean(record.vapiAssistantId));
    if (clean(record.subscriptionId)) result.subscriptionIds.add(clean(record.subscriptionId));
    if (clean(record.customerId)) result.customerIds.add(clean(record.customerId));
    if (clean(record.checkoutSessionId)) result.checkoutSessionIds.add(clean(record.checkoutSessionId));
  }
  return result;
}

function intersects(left, right) {
  return [...left].some((value) => right.has(value));
}

function assertExclusiveResourceOwnership({ targets = [], allSignups = [] } = {}) {
  const targetIds = new Set(targets.map(hashOperationalTarget));
  const resources = collectSignupResourceReferences(targets);
  for (const record of allSignups) {
    if (targetIds.has(hashOperationalTarget(record))) continue;
    const other = collectSignupResourceReferences([record]);
    if (
      intersects(resources.phoneNumbers, other.phoneNumbers)
      || intersects(resources.vapiPhoneIds, other.vapiPhoneIds)
      || intersects(resources.vapiAssistantIds, other.vapiAssistantIds)
      || intersects(resources.subscriptionIds, other.subscriptionIds)
      || intersects(resources.customerIds, other.customerIds)
      || intersects(resources.checkoutSessionIds, other.checkoutSessionIds)
    ) {
      throw decommissionError(
        "A selected provider resource is also referenced by an account outside the decommission set.",
        "SIGNUP_DECOMMISSION_RESOURCE_SHARED"
      );
    }
  }
  return resources;
}

function removeSignupTargetsFromStore(store = {}, targetIds = []) {
  const targets = new Set(targetIds);
  const next = {};
  let removed = 0;
  for (const [key, record] of Object.entries(store || {})) {
    if (targets.has(hashOperationalTarget(record))) removed += 1;
    else next[key] = record;
  }
  return { store: next, removed };
}

module.exports = {
  assertExclusiveResourceOwnership,
  assertSharedSignupIdentity,
  collectSignupResourceReferences,
  hashOperationalTarget,
  normalizePhone,
  removeSignupTargetsFromStore,
  selectCanonicalSignupAttempt,
  selectNewestPendingSignup,
};
