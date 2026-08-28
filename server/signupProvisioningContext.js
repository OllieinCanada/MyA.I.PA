const crypto = require("crypto");

const CONTEXT_PREFIX = "signup-provisioning-context:";

function contextStoreKey(idempotencyKey) {
  const key = String(idempotencyKey || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(key)) {
    const error = new Error("A valid provisioning idempotency key is required.");
    error.statusCode = 401;
    error.code = "PROVISIONING_CONTEXT_KEY_INVALID";
    throw error;
  }
  return `${CONTEXT_PREFIX}${crypto.createHash("sha256").update(key).digest("hex")}`;
}

function contextError(message, code, statusCode = 409) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function rowData(row) {
  return row?.data && typeof row.data === "object" && !Array.isArray(row.data) ? row.data : {};
}

async function withContextLock(prisma, key, callback) {
  if (!prisma?.runtimeStore || typeof prisma.$transaction !== "function") {
    throw contextError("Durable provisioning context storage is unavailable.", "PROVISIONING_CONTEXT_STORE_UNAVAILABLE", 503);
  }
  return prisma.$transaction(async (tx) => {
    if (typeof tx.$queryRaw === "function") {
      // PostgreSQL returns `void` from pg_advisory_xact_lock. Prisma cannot
      // deserialize that unsupported result type, so project the lock result
      // as text while retaining the same transaction-scoped lock semantics.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))::text AS lock_result`;
    }
    return callback(tx);
  });
}

async function registerSignupProvisioningContext({ prisma, payload }) {
  const idempotencyKey = String(payload?.provisioning?.idempotencyKey || "").trim().toLowerCase();
  const contextHash = String(payload?.provisioning?.contextHash || "").trim().toLowerCase();
  const key = contextStoreKey(idempotencyKey);
  if (!/^[a-f0-9]{64}$/.test(contextHash)) {
    throw contextError("A valid signed provisioning context is required.", "PROVISIONING_CONTEXT_HASH_INVALID", 401);
  }
  return withContextLock(prisma, key, async (tx) => {
    const row = await tx.runtimeStore.findUnique({ where: { key } });
    const current = rowData(row);
    if (current.contextHash === contextHash && current.payload) return current.payload;
    if ((current.lockedAt || current.completedAt) && current.payload) {
      // Once a paid provider step starts, retries must use the exact canonical
      // context that owns those resources instead of creating a second setup.
      return current.payload;
    }
    const now = new Date().toISOString();
    const next = {
      version: 1,
      idempotencyKey,
      contextHash,
      payload,
      registeredAt: current.registeredAt || now,
      updatedAt: now,
    };
    await tx.runtimeStore.upsert({
      where: { key },
      update: { data: next },
      create: { key, data: next },
    });
    return payload;
  });
}

async function loadSignupProvisioningContext({ prisma, idempotencyKey, contextHash, lock = true }) {
  const key = contextStoreKey(idempotencyKey);
  const expectedHash = String(contextHash || "").trim().toLowerCase();
  return withContextLock(prisma, key, async (tx) => {
    const row = await tx.runtimeStore.findUnique({ where: { key } });
    const current = rowData(row);
    if (!current.payload || current.contextHash !== expectedHash) {
      throw contextError(
        "The signed provisioning request does not match a registered signup context.",
        "PROVISIONING_CONTEXT_NOT_REGISTERED",
        401
      );
    }
    if (lock && !current.lockedAt) {
      const next = { ...current, lockedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      await tx.runtimeStore.upsert({
        where: { key },
        update: { data: next },
        create: { key, data: next },
      });
    }
    return current.payload;
  });
}

async function completeSignupProvisioningContext({ prisma, idempotencyKey, contextHash, result }) {
  const key = contextStoreKey(idempotencyKey);
  const expectedHash = String(contextHash || "").trim().toLowerCase();
  return withContextLock(prisma, key, async (tx) => {
    const row = await tx.runtimeStore.findUnique({ where: { key } });
    const current = rowData(row);
    if (!current.payload || current.contextHash !== expectedHash) {
      throw contextError("The completed setup does not match its registered context.", "PROVISIONING_CONTEXT_MISMATCH");
    }
    const next = {
      ...current,
      completedAt: current.completedAt || new Date().toISOString(),
      result: result && typeof result === "object" ? result : {},
      updatedAt: new Date().toISOString(),
    };
    await tx.runtimeStore.upsert({
      where: { key },
      update: { data: next },
      create: { key, data: next },
    });
    return next.result;
  });
}

module.exports = {
  CONTEXT_PREFIX,
  completeSignupProvisioningContext,
  contextStoreKey,
  loadSignupProvisioningContext,
  registerSignupProvisioningContext,
};
