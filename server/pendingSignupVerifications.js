const crypto = require("crypto");

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function tokenHash(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function publicRecord(record) {
  if (!record) return null;
  return {
    tokenHash: record.tokenHash,
    ownerEmail: record.ownerEmail,
    businessName: record.businessName,
    reviewReasons: Array.isArray(record.reviewReasons) ? record.reviewReasons : [],
    deliveryChannels: Array.isArray(record.deliveryChannels) ? record.deliveryChannels : [],
    ipHash: record.ipHash || "",
    purpose: record.purpose,
    payload: record.payload,
    createdAt: record.createdAt instanceof Date ? record.createdAt.getTime() : Number(record.createdAt || 0),
    expiresAt: record.expiresAt instanceof Date ? record.expiresAt.getTime() : Number(record.expiresAt || 0),
    claimedAt: record.claimedAt instanceof Date ? record.claimedAt.getTime() : Number(record.claimedAt || 0),
    verifiedAt: record.verifiedAt instanceof Date ? record.verifiedAt.getTime() : Number(record.verifiedAt || 0),
  };
}

function createPendingSignupVerificationStore({ prisma, minimumTtlMs = 24 * 60 * 60 * 1000 } = {}) {
  if (!prisma?.pendingSignupVerification) {
    throw new Error("PendingSignupVerification database storage is unavailable.");
  }

  async function prune(now = new Date()) {
    await prisma.pendingSignupVerification.deleteMany({
      where: {
        OR: [
          { expiresAt: { lte: now } },
          { usedAt: { not: null } },
          { supersededAt: { not: null } },
        ],
      },
    });
  }

  async function importLegacyRecords(legacyStore, now = new Date()) {
    const rows = Object.entries(legacyStore && typeof legacyStore === "object" ? legacyStore : {})
      .filter(([digest, record]) => (
        /^[a-f0-9]{64}$/i.test(digest)
        && record && typeof record === "object"
        && !record.usedAt
        && !record.supersededAt
        && Number(record.expiresAt || 0) > now.getTime()
      ))
      .map(([digest, record]) => ({
        tokenHash: digest.toLowerCase(),
        ownerEmail: String(record.ownerEmail || record.payload?.owner?.email || "").trim(),
        ownerEmailNormalized: normalize(record.ownerEmail || record.payload?.owner?.email),
        businessName: String(record.businessName || record.payload?.business?.name || "").trim(),
        businessNameNormalized: normalize(record.businessName || record.payload?.business?.name),
        purpose: String(record.purpose || "email_verification"),
        payload: record.payload || {},
        reviewReasons: Array.isArray(record.reviewReasons) ? record.reviewReasons : [],
        deliveryChannels: Array.isArray(record.deliveryChannels) ? record.deliveryChannels : [],
        ipHash: String(record.ipHash || ""),
        createdAt: new Date(Number(record.createdAt || now.getTime())),
        expiresAt: new Date(Number(record.expiresAt)),
        claimedAt: record.claimedAt ? new Date(Number(record.claimedAt)) : null,
        verifiedAt: record.verifiedAt ? new Date(Number(record.verifiedAt)) : null,
      }));
    if (!rows.length) return 0;
    const result = await prisma.pendingSignupVerification.createMany({ data: rows, skipDuplicates: true });
    return Number(result?.count || 0);
  }

  async function create({ payload, ownerEmail, businessName, reviewReasons, ipHash, purpose = "email_verification", ttlMs } = {}) {
    const token = crypto.randomBytes(32).toString("base64url");
    const digest = tokenHash(token);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + Math.max(minimumTtlMs, Number(ttlMs) || 0));
    const ownerEmailNormalized = normalize(ownerEmail);
    const businessNameNormalized = normalize(businessName);

    await prisma.$transaction(async (tx) => {
      await tx.pendingSignupVerification.deleteMany({
        where: { OR: [{ expiresAt: { lte: now } }, { usedAt: { not: null } }, { supersededAt: { not: null } }] },
      });
      if (purpose === "manual_review_recovery" || ["email_verification", "sms_verification", "contact_verification"].includes(purpose)) {
        await tx.pendingSignupVerification.updateMany({
          where: {
            purpose,
            usedAt: null,
            supersededAt: null,
            OR: [
              ...(ownerEmailNormalized ? [{ ownerEmailNormalized }] : []),
              ...(!ownerEmailNormalized && businessNameNormalized ? [{ businessNameNormalized }] : []),
            ],
          },
          data: { supersededAt: now },
        });
      }
      await tx.pendingSignupVerification.create({
        data: {
          tokenHash: digest,
          ownerEmail: String(ownerEmail || "").trim(),
          ownerEmailNormalized,
          businessName: String(businessName || "").trim(),
          businessNameNormalized,
          purpose,
          payload: payload || {},
          reviewReasons: Array.isArray(reviewReasons) ? reviewReasons : [],
          ipHash: String(ipHash || ""),
          createdAt: now,
          expiresAt,
        },
      });
    });
    return token;
  }

  async function claim(token, now = new Date()) {
    const digest = tokenHash(token);
    return prisma.$transaction(async (tx) => {
      await tx.pendingSignupVerification.deleteMany({
        where: { tokenHash: digest, OR: [{ expiresAt: { lte: now } }, { usedAt: { not: null } }, { supersededAt: { not: null } }] },
      });
      const claimed = await tx.pendingSignupVerification.updateMany({
        where: { tokenHash: digest, expiresAt: { gt: now }, usedAt: null, supersededAt: null, claimedAt: null },
        data: { claimedAt: now },
      });
      const record = await tx.pendingSignupVerification.findUnique({ where: { tokenHash: digest } });
      if (!record) return { status: "missing", tokenHash: digest, record: null };
      if (claimed.count === 0) return { status: "already_claimed", tokenHash: digest, record: publicRecord(record) };
      return { status: "claimed", tokenHash: digest, record: publicRecord(record) };
    });
  }

  async function retainForRecovery(digest, { record, payload, reviewReasons = record?.reviewReasons } = {}) {
    const now = new Date();
    const expiresAt = new Date(Math.max(Number(record?.expiresAt || 0), now.getTime() + 7 * 24 * 60 * 60 * 1000));
    const updated = await prisma.pendingSignupVerification.update({
      where: { tokenHash: digest },
      data: {
        payload: payload || record?.payload || {},
        purpose: "manual_review_recovery",
        reviewReasons: Array.isArray(reviewReasons) ? reviewReasons : [],
        verifiedAt: now,
        claimedAt: null,
        expiresAt,
      },
    });
    return publicRecord(updated);
  }

  async function removeToken(token) {
    await prisma.pendingSignupVerification.deleteMany({ where: { tokenHash: tokenHash(token) } });
  }

  async function removeHash(digest) {
    await prisma.pendingSignupVerification.deleteMany({ where: { tokenHash: digest } });
  }

  async function recordDeliveryChannels(token, channels) {
    const normalizedChannels = [...new Set((channels || []).map((channel) => String(channel || "").trim().toLowerCase()).filter(Boolean))];
    const updated = await prisma.pendingSignupVerification.updateMany({
      where: { tokenHash: tokenHash(token), usedAt: null, supersededAt: null },
      data: { deliveryChannels: normalizedChannels },
    });
    return updated.count > 0;
  }

  async function listActive(now = new Date()) {
    await prune(now);
    const records = await prisma.pendingSignupVerification.findMany({
      where: { expiresAt: { gt: now }, usedAt: null, supersededAt: null },
      orderBy: [{ verifiedAt: "desc" }, { createdAt: "desc" }],
    });
    return records.map(publicRecord);
  }

  async function consumeMatching(predicate) {
    const records = await listActive();
    const matches = records.filter(predicate);
    if (matches.length) {
      await prisma.pendingSignupVerification.updateMany({
        where: { tokenHash: { in: matches.map((record) => record.tokenHash) } },
        data: { usedAt: new Date() },
      });
    }
    return matches.length;
  }

  return { claim, create, importLegacyRecords, listActive, prune, recordDeliveryChannels, removeHash, removeToken, retainForRecovery, consumeMatching, tokenHash };
}

module.exports = { createPendingSignupVerificationStore, tokenHash };
