const crypto = require("crypto");
const { buildMakeSignupEventKey } = require('./makeSignupWebhook');

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

function registeredSignupEventKey(record) {
  if (record?.signupEventKey !== undefined) {
    if (!/^signup_[a-f0-9]{32}$/.test(record.signupEventKey)) {
      throw contextError('The saved signup binding is invalid.', 'PROVISIONING_ATTEMPT_BINDING_INVALID');
    }
    return record.signupEventKey;
  }
  // Locked historical contexts are never silently rebound to another attempt.
  return buildMakeSignupEventKey(record?.payload);
}

async function registerContext({ prisma, payload, eventKey }) {
  if (eventKey !== undefined && !/^signup_[a-f0-9]{32}$/.test(eventKey)) {
    throw contextError('A server-derived signup event key is required.', 'PROVISIONING_ATTEMPT_BINDING_INVALID');
  }
  const idempotencyKey = String(payload?.provisioning?.idempotencyKey || "").trim().toLowerCase();
  const contextHash = String(payload?.provisioning?.contextHash || "").trim().toLowerCase();
  const key = contextStoreKey(idempotencyKey);
  if (!/^[a-f0-9]{64}$/.test(contextHash)) {
    throw contextError("A valid signed provisioning context is required.", "PROVISIONING_CONTEXT_HASH_INVALID", 401);
  }
  return withContextLock(prisma, key, async (tx) => {
    const row = await tx.runtimeStore.findUnique({ where: { key } });
    const current = rowData(row);
    if (current.contextHash === contextHash && current.payload
      && (!eventKey || current.signupEventKey !== undefined || current.lockedAt || current.completedAt)) return current;
    if ((current.lockedAt || current.completedAt) && current.payload) {
      // Once a paid provider step starts, retries must use the exact canonical
      // context that owns those resources instead of creating a second setup.
      return current;
    }
    const now = new Date().toISOString();
    const next = {
      version: 1,
      idempotencyKey,
      contextHash,
      payload,
      ...(eventKey ? { signupEventKey: eventKey } : {}),
      registeredAt: current.registeredAt || now,
      updatedAt: now,
    };
    await tx.runtimeStore.upsert({
      where: { key },
      update: { data: next },
      create: { key, data: next },
    });
    return next;
  });
}

async function registerSignupProvisioningContext(options) {
  return (await registerContext(options)).payload;
}

// The binding is server-owned context metadata, not a client payload field.
// Keep it under the same advisory lock as the immutable provider context.
async function registerSignupProvisioningContextForAttempt(options) {
  if (!options.eventKey) throw contextError('Signup binding is required.', 'PROVISIONING_ATTEMPT_BINDING_INVALID');
  const record = await registerContext(options);
  return { payload: record.payload, eventKey: registeredSignupEventKey(record) };
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
  registerSignupProvisioningContextForAttempt,
  registeredSignupEventKey,
  CONTEXT_PREFIX,
  completeSignupProvisioningContext,
  contextStoreKey,
  loadSignupProvisioningContext,
  registerSignupProvisioningContext,
};
