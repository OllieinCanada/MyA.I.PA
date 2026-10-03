const crypto = require("node:crypto");
const { buildMakeSignupEventKey } = require("./makeSignupWebhook");

const PREFIX = "intake-recovery:v1:";
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const fail = (code) => Object.assign(new Error(code), { code, statusCode: 409 });
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().filter((key) => key !== "submittedAt" && value[key] !== undefined).map((key) => [key, canonical(value[key])]));
}
function recoveryIdentity(payload) {
  const businessKey = String(payload?.provisioning?.businessKey || payload?.provisioning?.idempotencyKey || "");
  if (!/^[a-f0-9]{64}$/.test(businessKey)) throw fail("INTAKE_BUSINESS_ID_REQUIRED");
  const eventKey = buildMakeSignupEventKey(payload);
  const payloadHash = crypto.createHash("sha256").update(JSON.stringify(canonical(payload))).digest("hex");
  return { eventKey, businessKey, payloadHash };
}
function encryptionKey(secret) {
  if (typeof secret !== "string" || secret.length < 24) throw fail("INTAKE_RECOVERY_SECRET_REQUIRED");
  return crypto.createHmac("sha256", secret).update("myaipa:intake-recovery:encryption:v1").digest();
}
function seal(payload, secret, identity) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  cipher.setAAD(Buffer.from(JSON.stringify(identity)));
  const bytes = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return { iv: iv.toString("base64url"), tag: cipher.getAuthTag().toString("base64url"), bytes: bytes.toString("base64url") };
}
function open(row, secret) {
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(secret), Buffer.from(row.sealed.iv, "base64url"));
  decipher.setAAD(Buffer.from(JSON.stringify({ eventKey: row.eventKey, businessKey: row.businessKey, payloadHash: row.payloadHash })));
  decipher.setAuthTag(Buffer.from(row.sealed.tag, "base64url"));
  try { return JSON.parse(Buffer.concat([decipher.update(Buffer.from(row.sealed.bytes, "base64url")), decipher.final()]).toString("utf8")); }
  catch (_) { throw fail("INTAKE_RECOVERY_COPY_UNREADABLE"); }
}
function journalKey(eventKey) {
  if (!/^signup_[a-f0-9]{32}$/.test(eventKey)) throw fail("INTAKE_EVENT_ID_REQUIRED");
  return `${PREFIX}${eventKey}`;
}
async function locked(prisma, key, work) {
  if (!prisma?.runtimeStore || typeof prisma.$transaction !== "function") throw fail("INTAKE_DURABLE_STORE_REQUIRED");
  return prisma.$transaction(async (tx) => {
    // No in-memory fallback: the database lock is required across workers.
    if (typeof tx.$queryRaw !== "function") throw fail("INTAKE_DATABASE_LOCK_REQUIRED");
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))::text AS lock_result`;
    return work(tx);
  });
}
async function saveRecoveryCopy({ prisma, payload, secret, now = Date.now() }) {
  const identity = recoveryIdentity(payload);
  const key = journalKey(identity.eventKey);
  encryptionKey(secret);
  return locked(prisma, key, async (tx) => {
    const row = (await tx.runtimeStore.findUnique({ where: { key } }))?.data;
    if (row) {
      if (row.businessKey !== identity.businessKey || row.payloadHash !== identity.payloadHash) throw fail("INTAKE_EVENT_PAYLOAD_CONFLICT");
      if (!row.sealed || !Number.isFinite(Date.parse(row.expiresAt)) || Date.parse(row.expiresAt) <= now) throw fail("INTAKE_RECOVERY_COPY_EXPIRED");
      // Check readability before allowing an external delivery or deletion.
      open(row, secret);
      return identity;
    }
    const data = { ...identity, sealed: seal(payload, secret, identity), savedAt: new Date(now).toISOString(), expiresAt: new Date(now + RETENTION_MS).toISOString() };
    await tx.runtimeStore.upsert({ where: { key }, create: { key, data }, update: { data } });
    return identity;
  });
}
async function readRecoveryCopy({ prisma, eventKey, secret, now = Date.now() }) {
  const row = (await prisma.runtimeStore.findUnique({ where: { key: journalKey(eventKey) } }))?.data;
  if (!row?.sealed || !Number.isFinite(Date.parse(row.expiresAt)) || Date.parse(row.expiresAt) <= now) throw fail("INTAKE_RECOVERY_COPY_EXPIRED");
  const payload = open(row, secret);
  const identity = recoveryIdentity(payload);
  if (identity.eventKey !== eventKey || identity.businessKey !== row.businessKey || identity.payloadHash !== row.payloadHash) throw fail("INTAKE_RECOVERY_COPY_MISMATCH");
  return { identity, payload };
}
async function recordRecoveryOperation({ prisma, identity, operationId, kind, status, now = Date.now() }) {
  if (!/^[a-f0-9-]{36}$/.test(operationId) || !["handoff", "queue-delete"].includes(kind) || !["started", "accepted", "uncertain", "verified"].includes(status)) throw fail("INTAKE_AUDIT_INPUT_INVALID");
  const key = `${journalKey(identity.eventKey)}:${kind}:${operationId}`;
  return locked(prisma, key, async (tx) => {
    const prior = (await tx.runtimeStore.findUnique({ where: { key } }))?.data;
    if (prior && (prior.businessKey !== identity.businessKey || prior.payloadHash !== identity.payloadHash || prior.status !== "started")) throw fail("INTAKE_AUDIT_STATE_CONFLICT");
    if (!prior && status !== "started") throw fail("INTAKE_AUDIT_START_REQUIRED");
    const data = { ...identity, operationId, kind, status, startedAt: prior?.startedAt || new Date(now).toISOString(), updatedAt: new Date(now).toISOString() };
    await tx.runtimeStore.upsert({ where: { key }, create: { key, data }, update: { data } });
  });
}
module.exports = { PREFIX, RETENTION_MS, canonical, recoveryIdentity, journalKey, saveRecoveryCopy, readRecoveryCopy, recordRecoveryOperation };
