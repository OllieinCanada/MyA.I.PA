function normalizePhoneForLookup(value) {
  return String(value || "").replace(/[^\d+]/g, "").replace(/^00/, "+").toLowerCase();
}

function normalizePersistedBusinessId(value) {
  const businessId = Number(value);
  return Number.isInteger(businessId) && businessId > 0 ? businessId : null;
}

function includeArgs(include) {
  return include && typeof include === "object" ? { include } : {};
}

/**
 * Resolve a signup to a business using only identities that cannot silently
 * select one tenant from an ambiguous set.
 */
async function resolveBusinessForSignup({ signup = {}, db, include } = {}) {
  if (!db?.business || !db?.vapiBusinessMapping) {
    throw new TypeError("A business data store is required.");
  }

  const hasPersistedBusinessId = signup.businessId != null && String(signup.businessId).trim() !== "";
  const businessId = normalizePersistedBusinessId(signup.businessId);
  if (hasPersistedBusinessId) {
    if (!businessId) return null;
    const business = await db.business.findUnique({
      where: { id: businessId },
      ...includeArgs(include),
    });
    // A persisted tenant identity is authoritative. If it is stale or invalid,
    // fail closed instead of falling back to a reusable name or phone number.
    return business || null;
  }

  const aiNumber = normalizePhoneForLookup(signup.twilioPhoneNumber);
  if (aiNumber) {
    const mapping = await db.vapiBusinessMapping.findUnique({
      where: { matchValue: aiNumber },
      include: { business: include ? { include } : true },
    });
    if (
      mapping?.business
      && String(mapping.matchType || "").trim().toLowerCase() === "phonenumber"
    ) {
      return mapping.business;
    }
  }

  const businessName = String(signup.businessName || "").trim();
  const businessPhone = normalizePhoneForLookup(signup.businessPhone);
  const lookup = [
    businessName ? { name: { equals: businessName, mode: "insensitive" } } : null,
    businessPhone ? { phone: businessPhone } : null,
  ].filter(Boolean);
  if (!lookup.length) return null;

  const candidates = await db.business.findMany({
    where: { OR: lookup },
    ...includeArgs(include),
    orderBy: { id: "asc" },
    take: 2,
  });
  return candidates.length === 1 ? candidates[0] : null;
}

function getSignupStoreAliases(signup = {}) {
  return [
    signup.subscriptionId ? `sub:${String(signup.subscriptionId).trim()}` : "",
    signup.ownerEmail ? `email:${String(signup.ownerEmail).trim().toLowerCase()}` : "",
    signup.checkoutSessionId ? `checkout:${String(signup.checkoutSessionId).trim()}` : "",
  ].filter(Boolean);
}

/**
 * Add the proven business identity to an existing signup record. This never
 * creates a record and refuses conflicting/ambiguous store identities.
 */
function persistSignupBusinessId({ signup = {}, businessId, readStore, writeStore, now = () => new Date() } = {}) {
  const normalizedBusinessId = normalizePersistedBusinessId(businessId);
  if (!normalizedBusinessId || typeof readStore !== "function" || typeof writeStore !== "function") {
    return { persisted: false, reason: "invalid-input" };
  }

  const store = readStore();
  if (!store || typeof store !== "object" || Array.isArray(store)) {
    return { persisted: false, reason: "invalid-store" };
  }

  const matchingKeys = [...new Set(
    getSignupStoreAliases(signup).filter((alias) => Object.prototype.hasOwnProperty.call(store, alias))
  )];
  if (matchingKeys.length !== 1) {
    return { persisted: false, reason: matchingKeys.length ? "ambiguous-signup" : "signup-not-found" };
  }

  const key = matchingKeys[0];
  const existing = store[key];
  if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
    return { persisted: false, reason: "invalid-record" };
  }
  const existingBusinessId = normalizePersistedBusinessId(existing.businessId);
  if (existingBusinessId && existingBusinessId !== normalizedBusinessId) {
    return { persisted: false, reason: "business-conflict" };
  }

  store[key] = {
    ...existing,
    businessId: normalizedBusinessId,
    updatedAt: now().toISOString(),
  };
  writeStore(store);
  return { persisted: true, key, businessId: normalizedBusinessId };
}

module.exports = {
  normalizePersistedBusinessId,
  persistSignupBusinessId,
  resolveBusinessForSignup,
};
