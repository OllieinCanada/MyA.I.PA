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

function noteContext(trace, checkpoint) {
  if (typeof trace !== 'function') return;
  try { const pending = trace(checkpoint); if (pending && typeof pending.catch === 'function') pending.catch(() => {}); }
  catch (_) { /* Observability cannot alter locks, writes, results or failures. */ }
}

async function withContextLock(prisma, key, callback, trace) {
  if (!prisma?.runtimeStore || typeof prisma.$transaction !== "function") {
    throw contextError("Durable provisioning context storage is unavailable.", "PROVISIONING_CONTEXT_STORE_UNAVAILABLE", 503);
  }
  noteContext(trace, 'context_transaction_wait');
  const result = await prisma.$transaction(async (tx) => {
    noteContext(trace, 'context_transaction_admitted');
    if (typeof tx.$queryRaw === "function") {
      // PostgreSQL returns `void` from pg_advisory_xact_lock. Prisma cannot
      // deserialize that unsupported result type, so project the lock result
      // as text while retaining the same transaction-scoped lock semantics.
      noteContext(trace, 'context_lock_wait');
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))::text AS lock_result`;
      noteContext(trace, 'context_lock_acquired');
    }
    return callback(tx);
  });
  noteContext(trace, 'context_transaction_completed');
  return result;
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

async function loadContext({ prisma, idempotencyKey, contextHash, lock = true, trace }) {
  const key = contextStoreKey(idempotencyKey);
  const expectedHash = String(contextHash || "").trim().toLowerCase();
  return withContextLock(prisma, key, async (tx) => {
    noteContext(trace, 'context_read_started');
    const row = await tx.runtimeStore.findUnique({ where: { key } });
    noteContext(trace, 'context_read_completed');
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
      noteContext(trace, 'context_update_started');
      await tx.runtimeStore.upsert({
        where: { key },
        update: { data: next },
        create: { key, data: next },
      });
      noteContext(trace, 'context_update_completed');
      return next;
    }
    return current;
  }, trace);
}

async function loadSignupProvisioningContext(options) {
  return (await loadContext(options)).payload;
}

async function loadSignupProvisioningContextForAttempt(options) {
  const record = await loadContext(options);
  return { payload: record.payload, eventKey: registeredSignupEventKey(record) };
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
  loadSignupProvisioningContextForAttempt,
  registerSignupProvisioningContextForAttempt,
  registeredSignupEventKey,
  CONTEXT_PREFIX,
  completeSignupProvisioningContext,
  contextStoreKey,
  loadSignupProvisioningContext,
  registerSignupProvisioningContext,
};
