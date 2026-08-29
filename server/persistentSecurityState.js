const crypto = require("crypto");
const { prisma } = require("./prisma");

const memoryRateLimits = new Map();
const memoryLoginCodes = new Map();
const memoryWebhookClaims = new Map();
const memoryStoreEnabled =
  process.env.NODE_ENV === "test" && process.env.SECURITY_STATE_FORCE_DATABASE !== "true";
let lastRateLimitCleanupAt = Date.now();

function useMemoryStore() {
  return memoryStoreEnabled;
}

function asDate(value) {
  return value instanceof Date ? value : new Date(Number(value || Date.now()));
}

function isUniqueConstraintError(error) {
  return error?.code === "P2002";
}

async function consumeRateLimit({
  key,
  maxRequests,
  windowMs,
  now = Date.now(),
  client = prisma,
}) {
  const normalizedKey = String(key || "").trim().slice(0, 240);
  if (!normalizedKey) throw new Error("A rate-limit key is required.");
  const currentTime = asDate(now);
  const expiresAt = new Date(currentTime.getTime() + Number(windowMs || 0));

  if (useMemoryStore()) {
    const existing = memoryRateLimits.get(normalizedKey);
    const record = !existing || Number(existing.expiresAt) <= currentTime.getTime()
      ? { count: 1, windowStartedAt: currentTime.getTime(), expiresAt: expiresAt.getTime() }
      : { ...existing, count: existing.count + 1 };
    memoryRateLimits.set(normalizedKey, record);
    return {
      allowed: record.count <= maxRequests,
      count: record.count,
      remaining: Math.max(0, maxRequests - record.count),
      retryAfterMs: Math.max(0, record.expiresAt - currentTime.getTime()),
    };
  }

  if (typeof client.$queryRaw !== "function") {
    const error = new Error("The atomic persistent rate-limit operation is unavailable.");
    error.code = "ATOMIC_RATE_LIMIT_UNAVAILABLE";
    throw error;
  }
  // One PostgreSQL UPSERT owns both the window reset and increment. A
  // read-then-update sequence can undercount simultaneous first requests and
  // must not protect provider spend or security-sensitive dispatches.
  const records = await client.$queryRaw`
    INSERT INTO "SecurityRateLimit" (
      "key", "count", "windowStartedAt", "expiresAt", "createdAt", "updatedAt"
    ) VALUES (
      ${normalizedKey}, 1, ${currentTime}, ${expiresAt}, ${currentTime}, ${currentTime}
    )
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE
        WHEN "SecurityRateLimit"."expiresAt" > ${currentTime}
          THEN "SecurityRateLimit"."count" + 1
        ELSE 1
      END,
      "windowStartedAt" = CASE
        WHEN "SecurityRateLimit"."expiresAt" > ${currentTime}
          THEN "SecurityRateLimit"."windowStartedAt"
        ELSE ${currentTime}
      END,
      "expiresAt" = CASE
        WHEN "SecurityRateLimit"."expiresAt" > ${currentTime}
          THEN "SecurityRateLimit"."expiresAt"
        ELSE ${expiresAt}
      END,
      "updatedAt" = ${currentTime}
    RETURNING "count", "expiresAt"
  `;
  const record = Array.isArray(records) ? records[0] : null;
  if (!record || !Number.isInteger(Number(record.count)) || !(record.expiresAt instanceof Date)) {
    const error = new Error("The atomic persistent rate-limit operation returned an invalid record.");
    error.code = "ATOMIC_RATE_LIMIT_INVALID_RESULT";
    throw error;
  }

  if (
    currentTime.getTime() - lastRateLimitCleanupAt >= 10 * 60 * 1000 &&
    typeof client.securityRateLimit?.deleteMany === "function"
  ) {
    lastRateLimitCleanupAt = currentTime.getTime();
    await client.securityRateLimit.deleteMany({
      where: { expiresAt: { lte: currentTime } },
    });
  }

  return {
    allowed: record.count <= maxRequests,
    count: record.count,
    remaining: Math.max(0, maxRequests - record.count),
    retryAfterMs: Math.max(0, record.expiresAt.getTime() - currentTime.getTime()),
  };
}

async function storeDashboardLoginCode({
  lookupHash,
  codeHash,
  expiresAt,
  now = Date.now(),
  client = prisma,
}) {
  const normalizedLookupHash = String(lookupHash || "").trim().toLowerCase();
  const normalizedCodeHash = String(codeHash || "").trim().toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(normalizedLookupHash) || !/^[a-f0-9]{64}$/.test(normalizedCodeHash)) {
    throw new Error("A valid hashed dashboard lookup and code are required.");
  }
  const expiration = asDate(expiresAt);

  if (useMemoryStore()) {
    memoryLoginCodes.set(normalizedLookupHash, {
      codeHash: normalizedCodeHash,
      attempts: 0,
      expiresAt: expiration.getTime(),
    });
    for (const [key, record] of memoryLoginCodes.entries()) {
      if (!record || Number(record.expiresAt) <= Number(now)) memoryLoginCodes.delete(key);
    }
    return;
  }

  await client.customerDashboardLoginCode.upsert({
    where: { lookupHash: normalizedLookupHash },
    create: {
      lookupHash: normalizedLookupHash,
      codeHash: normalizedCodeHash,
      attempts: 0,
      expiresAt: expiration,
    },
    update: {
      codeHash: normalizedCodeHash,
      attempts: 0,
      expiresAt: expiration,
    },
  });
  await client.customerDashboardLoginCode.deleteMany({
    where: { expiresAt: { lte: asDate(now) } },
  });
}

async function verifyDashboardLoginCode({
  lookupHash,
  codeHash,
  maxAttempts,
  now = Date.now(),
  client = prisma,
}) {
  const normalizedLookupHash = String(lookupHash || "").trim().toLowerCase();
  const normalizedCodeHash = String(codeHash || "").trim().toLowerCase();
  const currentTime = asDate(now);

  if (useMemoryStore()) {
    const record = memoryLoginCodes.get(normalizedLookupHash);
    if (!record || Number(record.expiresAt) <= currentTime.getTime()) {
      memoryLoginCodes.delete(normalizedLookupHash);
      return { ok: false, reason: "expired" };
    }
    if (record.codeHash === normalizedCodeHash) {
      memoryLoginCodes.delete(normalizedLookupHash);
      return { ok: true };
    }
    record.attempts += 1;
    if (record.attempts >= maxAttempts) {
      memoryLoginCodes.delete(normalizedLookupHash);
      return { ok: false, reason: "attempts" };
    }
    memoryLoginCodes.set(normalizedLookupHash, record);
    return {
      ok: false,
      reason: "invalid",
      remainingAttempts: Math.max(0, maxAttempts - record.attempts),
    };
  }

  const consumed = await client.customerDashboardLoginCode.deleteMany({
    where: {
      lookupHash: normalizedLookupHash,
      codeHash: normalizedCodeHash,
      expiresAt: { gt: currentTime },
      attempts: { lt: maxAttempts },
    },
  });
  if (consumed.count === 1) return { ok: true };

  const attempted = await client.customerDashboardLoginCode.updateMany({
    where: {
      lookupHash: normalizedLookupHash,
      expiresAt: { gt: currentTime },
      attempts: { lt: maxAttempts },
    },
    data: { attempts: { increment: 1 } },
  });
  if (attempted.count !== 1) {
    await client.customerDashboardLoginCode.deleteMany({
      where: { lookupHash: normalizedLookupHash },
    });
    return { ok: false, reason: "expired" };
  }

  const record = await client.customerDashboardLoginCode.findUnique({
    where: { lookupHash: normalizedLookupHash },
  });
  if (!record || record.attempts >= maxAttempts) {
    await client.customerDashboardLoginCode.deleteMany({
      where: { lookupHash: normalizedLookupHash },
    });
    return { ok: false, reason: "attempts" };
  }
  return {
    ok: false,
    reason: "invalid",
    remainingAttempts: Math.max(0, maxAttempts - record.attempts),
  };
}

async function claimWebhookReplay({
  key,
  provider,
  eventIdHash,
  eventType = "",
  leaseMs,
  retentionMs,
  claimToken = "",
  now = Date.now(),
  client = prisma,
}) {
  const normalizedKey = String(key || "").trim();
  if (!normalizedKey) return { claimed: false, duplicate: false, skipped: true, key: "" };
  const currentTime = asDate(now);
  const token = claimToken || crypto.randomBytes(18).toString("base64url");
  const recordData = {
    provider: String(provider || "").trim().toLowerCase().slice(0, 80),
    eventIdHash: String(eventIdHash || "").trim().slice(0, 80),
    eventType: String(eventType || "").trim().slice(0, 160) || null,
    status: "PROCESSING",
    claimToken: token,
    claimedAt: currentTime,
    leaseExpiresAt: new Date(currentTime.getTime() + Number(leaseMs || 0)),
    expiresAt: new Date(currentTime.getTime() + Number(retentionMs || 0)),
    completedAt: null,
  };

  if (useMemoryStore()) {
    const existing = memoryWebhookClaims.get(normalizedKey);
    if (
      existing?.status === "COMPLETED" ||
      (existing?.status === "PROCESSING" && Number(existing.leaseExpiresAt) > currentTime.getTime())
    ) {
      return {
        claimed: false,
        duplicate: true,
        skipped: false,
        key: normalizedKey,
        status: existing.status.toLowerCase(),
      };
    }
    memoryWebhookClaims.set(normalizedKey, {
      ...recordData,
      claimedAt: recordData.claimedAt.getTime(),
      leaseExpiresAt: recordData.leaseExpiresAt.getTime(),
      expiresAt: recordData.expiresAt.getTime(),
    });
    return { claimed: true, duplicate: false, skipped: false, key: normalizedKey, claimToken: token };
  }

  await client.webhookReplayClaim.deleteMany({ where: { expiresAt: { lte: currentTime } } });
  try {
    await client.webhookReplayClaim.create({ data: { key: normalizedKey, ...recordData } });
    return { claimed: true, duplicate: false, skipped: false, key: normalizedKey, claimToken: token };
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
  }

  const recovered = await client.webhookReplayClaim.updateMany({
    where: {
      key: normalizedKey,
      OR: [
        { expiresAt: { lte: currentTime } },
        { status: "PROCESSING", leaseExpiresAt: { lte: currentTime } },
      ],
    },
    data: recordData,
  });
  if (recovered.count === 1) {
    return { claimed: true, duplicate: false, skipped: false, key: normalizedKey, claimToken: token };
  }

  const existing = await client.webhookReplayClaim.findUnique({ where: { key: normalizedKey } });
  return {
    claimed: false,
    duplicate: Boolean(existing),
    skipped: false,
    key: normalizedKey,
    status: String(existing?.status || "").toLowerCase(),
  };
}

async function completeWebhookReplay({
  key,
  claimToken,
  retentionMs,
  now = Date.now(),
  client = prisma,
}) {
  if (!key || !claimToken) return false;
  const currentTime = asDate(now);
  if (useMemoryStore()) {
    const record = memoryWebhookClaims.get(key);
    if (!record || record.claimToken !== claimToken) return false;
    memoryWebhookClaims.set(key, {
      ...record,
      status: "COMPLETED",
      completedAt: currentTime.getTime(),
      leaseExpiresAt: null,
      expiresAt: currentTime.getTime() + Number(retentionMs || 0),
    });
    return true;
  }
  const result = await client.webhookReplayClaim.updateMany({
    where: { key, claimToken, status: "PROCESSING" },
    data: {
      status: "COMPLETED",
      completedAt: currentTime,
      leaseExpiresAt: null,
      expiresAt: new Date(currentTime.getTime() + Number(retentionMs || 0)),
    },
  });
  return result.count === 1;
}

async function releaseWebhookReplay({ key, claimToken, client = prisma }) {
  if (!key || !claimToken) return false;
  if (useMemoryStore()) {
    const record = memoryWebhookClaims.get(key);
    if (!record || record.claimToken !== claimToken) return false;
    memoryWebhookClaims.delete(key);
    return true;
  }
  const result = await client.webhookReplayClaim.deleteMany({
    where: { key, claimToken, status: "PROCESSING" },
  });
  return result.count === 1;
}

function resetMemorySecurityState() {
  memoryRateLimits.clear();
  memoryLoginCodes.clear();
  memoryWebhookClaims.clear();
}

module.exports = {
  claimWebhookReplay,
  completeWebhookReplay,
  consumeRateLimit,
  releaseWebhookReplay,
  resetMemorySecurityState,
  storeDashboardLoginCode,
  verifyDashboardLoginCode,
};
