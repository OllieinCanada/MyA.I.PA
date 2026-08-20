const crypto = require("crypto");

const AUDIT_PREFIX = "admin-audit:";
const SENSITIVE_KEY = /(password|secret|token|authorization|cookie|phone|email|address|transcript|recording)/i;

function decodeBase32(value) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = String(value || "").toUpperCase().replace(/[^A-Z2-7]/g, "");
  if (!normalized) return Buffer.alloc(0);
  let bits = "";
  for (const character of normalized) {
    const index = alphabet.indexOf(character);
    if (index < 0) return Buffer.alloc(0);
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
    bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  }
  return Buffer.from(bytes);
}

function totpCode(secret, atMs = Date.now(), stepSeconds = 30) {
  const key = decodeBase32(secret);
  if (!key.length) return "";
  const counter = Math.floor(Number(atMs) / 1000 / stepSeconds);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac("sha1", key).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const value = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(value).padStart(6, "0");
}

function verifyTotpCode(secret, candidate, { atMs = Date.now(), window = 1 } = {}) {
  const provided = String(candidate || "").trim();
  if (!/^\d{6}$/.test(provided) || !decodeBase32(secret).length) return false;
  for (let drift = -Math.max(0, window); drift <= Math.max(0, window); drift += 1) {
    const expected = totpCode(secret, Number(atMs) + drift * 30_000);
    const left = Buffer.from(provided);
    const right = Buffer.from(expected);
    if (left.length === right.length && crypto.timingSafeEqual(left, right)) return true;
  }
  return false;
}

function redactAuditDetails(value, depth = 0) {
  if (depth > 5) return "[truncated]";
  if (value == null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.replace(/\s+/g, " ").trim().slice(0, 240);
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => redactAuditDetails(item, depth + 1));
  if (typeof value !== "object") return String(value).slice(0, 240);
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 30)
      .map(([key, item]) => [key, SENSITIVE_KEY.test(key) ? "[redacted]" : redactAuditDetails(item, depth + 1)])
  );
}

async function recordAdminAuditEvent({ prisma, action, outcome, actorHash = "", targetType = "", targetId = "", details = {} }) {
  if (!prisma?.runtimeStore) return null;
  const createdAt = new Date().toISOString();
  const data = {
    action: String(action || "unknown").slice(0, 100),
    outcome: String(outcome || "unknown").slice(0, 40),
    actorHash: String(actorHash || "").slice(0, 80),
    targetType: String(targetType || "").slice(0, 80),
    targetId: String(targetId || "").slice(0, 160),
    details: redactAuditDetails(details),
    createdAt,
  };
  return prisma.runtimeStore.create({
    data: {
      key: `${AUDIT_PREFIX}${Date.now()}:${crypto.randomUUID()}`,
      data,
    },
  }).catch((error) => {
    console.warn("[admin:audit] event could not be persisted", { action: data.action, outcome: data.outcome, code: error?.code || "write_failed" });
    return null;
  });
}

async function listAdminAuditEvents({ prisma, limit = 100 } = {}) {
  if (!prisma?.runtimeStore) return [];
  const rows = await prisma.runtimeStore.findMany({
    where: { key: { startsWith: AUDIT_PREFIX } },
    orderBy: { createdAt: "desc" },
    take: Math.max(1, Math.min(500, Number(limit) || 100)),
  });
  return rows.map((row) => ({ id: row.key, ...(row.data || {}), storedAt: row.createdAt }));
}

module.exports = {
  AUDIT_PREFIX,
  decodeBase32,
  listAdminAuditEvents,
  recordAdminAuditEvent,
  redactAuditDetails,
  totpCode,
  verifyTotpCode,
};
