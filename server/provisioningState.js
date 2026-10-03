const crypto = require("crypto");

const PROVISIONING_STATE_PREFIX = "signup-provisioning:";
const DEFAULT_LEASE_MS = 5 * 60 * 1000;

function provisioningStateKey(kind, idempotencyKey) {
  const normalizedKind = String(kind || "step")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .slice(0, 48) || "step";
  const digest = crypto
    .createHash("sha256")
    .update(String(idempotencyKey || ""))
    .digest("hex");
  return `${PROVISIONING_STATE_PREFIX}${normalizedKind}:${digest}`;
}

function provisioningError(message, code, statusCode = 409) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function normalizeStoredData(row) {
  return row?.data && typeof row.data === "object" && !Array.isArray(row.data)
    ? row.data
    : {};
}

function validateContext(data, contextHash) {
  const expected = String(data?.contextHash || "").trim();
  const received = String(contextHash || "").trim();
  if (expected && received && expected !== received) {
    throw provisioningError(
      "This provisioning key is already assigned to a different signup context.",
      "PROVISIONING_CONTEXT_MISMATCH"
    );
  }
}

async function readProvisioningStep({ prisma, kind, idempotencyKey }) {
  if (!prisma?.runtimeStore) {
    throw provisioningError("Durable provisioning storage is unavailable.", "PROVISIONING_STORE_UNAVAILABLE", 503);
  }
  const key = provisioningStateKey(kind, idempotencyKey);
  const row = await prisma.runtimeStore.findUnique({ where: { key } });
  return { key, data: normalizeStoredData(row) };
}

async function claimProvisioningStep({
  prisma,
  kind,
  idempotencyKey,
  contextHash,
  leaseMs = DEFAULT_LEASE_MS,
  now = Date.now(),
}) {
  if (!prisma?.runtimeStore || typeof prisma.$transaction !== "function") {
    throw provisioningError("Durable provisioning storage is unavailable.", "PROVISIONING_STORE_UNAVAILABLE", 503);
  }
  const key = provisioningStateKey(kind, idempotencyKey);
  const safeLeaseMs = Math.max(30_000, Math.min(30 * 60 * 1000, Number(leaseMs) || DEFAULT_LEASE_MS));

  return prisma.$transaction(async (tx) => {
    if (typeof tx.$queryRaw === "function") {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))::text AS lock_result`;
    }
    const row = await tx.runtimeStore.findUnique({ where: { key } });
    const data = normalizeStoredData(row);
    validateContext(data, contextHash);

    if (data.status === "invalidated") {
      throw provisioningError("Saved provisioning resources require guarded recovery.", "PROVISIONING_RESULT_STALE");
    }

    if (data.status === "completed" && data.result && typeof data.result === "object") {
      return { claimed: false, completed: true, key, result: data.result, data };
    }

    const leaseExpiresAt = Number(new Date(data.leaseExpiresAt || 0).getTime());
    if (data.status === "processing" && leaseExpiresAt > now) {
      return { claimed: false, completed: false, inProgress: true, key, data };
    }

    const claimToken = crypto.randomUUID();
    const next = {
      version: 1,
      kind: String(kind || "step").slice(0, 80),
      status: "processing",
      contextHash: String(contextHash || "").trim().slice(0, 128),
      claimToken,
      attempts: Math.max(0, Number(data.attempts || 0)) + 1,
      claimedAt: new Date(now).toISOString(),
      leaseExpiresAt: new Date(now + safeLeaseMs).toISOString(),
      lastErrorCode: "",
      updatedAt: new Date(now).toISOString(),
    };
    await tx.runtimeStore.upsert({
      where: { key },
      update: { data: next },
      create: { key, data: next },
    });
    return { claimed: true, completed: false, inProgress: false, claimToken, key, data: next };
  });
}

async function completeProvisioningStep({ prisma, key, claimToken, result, now = Date.now() }) {
  if (!prisma?.runtimeStore || typeof prisma.$transaction !== "function") {
    throw provisioningError("Durable provisioning storage is unavailable.", "PROVISIONING_STORE_UNAVAILABLE", 503);
  }
  return prisma.$transaction(async (tx) => {
    if (typeof tx.$queryRaw === "function") {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))::text AS lock_result`;
    }
    const row = await tx.runtimeStore.findUnique({ where: { key } });
    const data = normalizeStoredData(row);
    if (data.status === "completed" && data.result && typeof data.result === "object") return data.result;
    if (!data.claimToken || data.claimToken !== claimToken) {
      throw provisioningError("The provisioning claim is no longer current.", "PROVISIONING_CLAIM_LOST");
    }
    const completed = {
      ...data,
      status: "completed",
      result: result && typeof result === "object" ? result : {},
      completedAt: new Date(now).toISOString(),
      leaseExpiresAt: null,
      lastErrorCode: "",
      updatedAt: new Date(now).toISOString(),
    };
    await tx.runtimeStore.upsert({
      where: { key },
      update: { data: completed },
      create: { key, data: completed },
    });
    return completed.result;
  });
}

async function failProvisioningStep({ prisma, key, claimToken, error, now = Date.now() }) {
  if (!prisma?.runtimeStore || typeof prisma.$transaction !== "function") return false;
  return prisma.$transaction(async (tx) => {
    if (typeof tx.$queryRaw === "function") {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))::text AS lock_result`;
    }
    const row = await tx.runtimeStore.findUnique({ where: { key } });
    const data = normalizeStoredData(row);
    if (data.status === "completed") return false;
    if (!data.claimToken || data.claimToken !== claimToken) return false;
    const failed = {
      ...data,
      status: "failed",
      failedAt: new Date(now).toISOString(),
      leaseExpiresAt: null,
      lastErrorCode: String(error?.code || "PROVISIONING_STEP_FAILED").slice(0, 100),
      updatedAt: new Date(now).toISOString(),
    };
    await tx.runtimeStore.upsert({
      where: { key },
      update: { data: failed },
      create: { key, data: failed },
    });
    return true;
  });
}

async function runProvisioningStep({
  prisma,
  kind,
  idempotencyKey,
  contextHash,
  reconcile,
  execute,
  verifyCompleted,
}) {
  const reuse = (key, result) => ["twilio-number", "vapi-assistant", "vapi-import"].includes(kind) || verifyCompleted
    ? verifyCompletedProvisioningResult({ prisma, key, result, verifyCompleted })
    : { ...result, reused: true };
  const existing = await readProvisioningStep({ prisma, kind, idempotencyKey });
  validateContext(existing.data, contextHash);
  if (existing.data.status === "completed" && existing.data.result && typeof existing.data.result === "object") {
    return reuse(existing.key, existing.data.result);
  }
  if (existing.data.status === "invalidated") {
    throw provisioningError("Saved provisioning resources are stale and require guarded recovery.", "PROVISIONING_RESULT_STALE");
  }

  // The lease also owns reconciliation, which closes the post-create crash window.
  const claim = await claimProvisioningStep({ prisma, kind, idempotencyKey, contextHash });
  if (claim.completed) return reuse(claim.key, claim.result);
  if (claim.inProgress) {
    throw provisioningError("This provisioning step is already running.", "PROVISIONING_ALREADY_IN_PROGRESS", 409);
  }

  try {
    // Reconciliation must not create missing paid resources. It runs under
    // the lease, and creation is confined to the first execute attempt.
    const reconciled = typeof reconcile === "function" ? await reconcile() : null;
    if (!reconciled && claim.data.attempts > 1 && ["twilio-number", "vapi-assistant", "vapi-import"].includes(kind)) {
      // A lost response or expired lease does not prove that the provider did
      // nothing. Reuse provider-confirmed resources, but never blindly create
      // another paid resource when a previous attempt has an unknown outcome.
      throw provisioningError("The prior provider attempt has no confirmed recovery result. Inspect provider inventory before creating a replacement.", "PROVISIONING_RECONCILIATION_REQUIRED");
    }
    const result = reconciled && typeof reconciled === "object"
      ? { reused: true, ...reconciled }
      : await execute();
    if (!result || typeof result !== "object") {
      throw provisioningError("The provider returned no provisioning result.", "PROVISIONING_RESULT_MISSING", 502);
    }
    await completeProvisioningStep({ prisma, key: claim.key, claimToken: claim.claimToken, result });
    return result;
  } catch (error) {
    await failProvisioningStep({ prisma, key: claim.key, claimToken: claim.claimToken, error }).catch(() => {});
    throw error;
  }
}

async function verifyCompletedProvisioningResult({ prisma, key, result, verifyCompleted }) {
  if (typeof verifyCompleted !== "function") {
    throw provisioningError("Saved provider resources must be verified before reuse.", "PROVISIONING_RESULT_UNVERIFIED", 503);
  }
  // A failed provider request is inconclusive: propagate it without erasing
  // completion evidence. Only a successful, definitive negative invalidates.
  const healthy = await verifyCompleted(result);
  if (healthy === true) return { ...result, reused: true };
  if (healthy !== false) throw provisioningError("Provider verification was inconclusive.", "PROVISIONING_RESULT_UNVERIFIED", 503);
  await prisma.$transaction(async (tx) => {
    if (typeof tx.$queryRaw === "function") await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))::text AS lock_result`;
    const row = await tx.runtimeStore.findUnique({ where: { key } });
    const data = normalizeStoredData(row);
    if (data.status !== "completed" || JSON.stringify(data.result) !== JSON.stringify(result)) {
      throw provisioningError("Provisioning state changed during verification.", "PROVISIONING_CLAIM_LOST");
    }
    const next = { ...data, status: "invalidated", invalidatedAt: new Date().toISOString(), lastErrorCode: "PROVISIONING_RESULT_STALE" };
    // Keep the original IDs and completion timestamp for reconciliation. Never
    // automatically recreate resources or restart a paid step from this state.
    await tx.runtimeStore.upsert({ where: { key }, update: { data: next }, create: { key, data: next } });
  });
  throw provisioningError("Saved provider resources are missing or no longer match this signup. Guarded recovery is required; no replacement was created.", "PROVISIONING_RESULT_STALE");
}

module.exports = {
  DEFAULT_LEASE_MS,
  PROVISIONING_STATE_PREFIX,
  claimProvisioningStep,
  completeProvisioningStep,
  failProvisioningStep,
  provisioningStateKey,
  readProvisioningStep,
  runProvisioningStep,
  validateContext,
  verifyCompletedProvisioningResult,
};
