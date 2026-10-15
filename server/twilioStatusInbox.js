const crypto = require('node:crypto');

const PREFIX = 'twilio-status-inbox:';
const WORKER_KEY = 'twilio-status-worker:v1';
const LEASE_MS = 120_000;
const STATES = new Set(['accepted', 'scheduled', 'queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'undelivered', 'canceled']);
function normalizeReceipt(body = {}) {
  const MessageSid = String(body.MessageSid || body.SmsSid || '').trim();
  const MessageStatus = String(body.MessageStatus || body.SmsStatus || '').trim().toLowerCase();
  if (!/^(SM|MM)[a-f0-9]{32}$/i.test(MessageSid) || !STATES.has(MessageStatus)) {
    throw Object.assign(new Error('A valid Twilio message SID and status are required.'), { statusCode: 400, code: 'TWILIO_RECEIPT_INVALID' });
  }
  const ErrorCode = /^\d{1,8}$/.test(String(body.ErrorCode || '')) ? String(body.ErrorCode) : '';
  return { MessageSid, MessageStatus, ...(ErrorCode ? { ErrorCode } : {}) };
}
function receiptKey(body) {
  const receipt = normalizeReceipt(body);
  return PREFIX + crypto.createHash('sha256').update(`${receipt.MessageSid}:${receipt.MessageStatus}`).digest('hex');
}
async function locked(prisma, key, work) {
  // No file/in-memory fallback. A failed durable write must return non-2xx.
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))::text AS lock_result`;
    return work(tx, (await tx.runtimeStore.findUnique({ where: { key } }))?.data || null);
  }, { maxWait: 2000, timeout: 4000 });
}
async function put(tx, key, data) {
  await tx.runtimeStore.upsert({ where: { key }, create: { key, data }, update: { data } });
}
async function enqueueTwilioStatus({ prisma, body, now = Date.now() }) {
  const receipt = normalizeReceipt(body), key = receiptKey(receipt);
  return locked(prisma, key, async (tx, existing) => {
    if (existing) return { key, duplicate: true, status: existing.status };
    await put(tx, key, { version: 1, receipt, status: 'pending', attempts: 0, receivedAt: now, nextAttemptAt: now });
    return { key, duplicate: false, status: 'pending' };
  });
}
async function drainTwilioStatuses({ prisma, processReceipt, onFailure = async () => {}, now = Date.now,
  batchSize = 10, leaseMs = LEASE_MS, heartbeatMs = 30_000 }) {
  const token = crypto.randomUUID();
  const acquired = await locked(prisma, WORKER_KEY, async (tx, data) => {
    if (data?.leaseExpiresAt > now()) return false;
    await put(tx, WORKER_KEY, { token, leaseExpiresAt: now() + leaseMs });
    return true;
  });
  if (!acquired) return { processed: 0, busy: true };
  let lost = false, heartbeat = Promise.resolve();
  const timer = setInterval(() => {
    heartbeat = heartbeat.then(() => locked(prisma, WORKER_KEY, async (tx, data) => {
      if (data?.token !== token || data.leaseExpiresAt <= now()) { lost = true; return; }
      await put(tx, WORKER_KEY, { token, leaseExpiresAt: now() + leaseMs });
    })).catch(() => { lost = true; });
  }, heartbeatMs);
  timer.unref?.();
  let processed = 0;
  try {
    const rows = await prisma.runtimeStore.findMany({ where: {
      key: { startsWith: PREFIX },
      OR: [
        { AND: [{ data: { path: ['status'], equals: 'pending' } }, { data: { path: ['nextAttemptAt'], lte: now() } }] },
        { AND: [{ data: { path: ['status'], equals: 'processing' } }, { data: { path: ['leaseExpiresAt'], lte: now() } }] },
      ],
    }, orderBy: { updatedAt: 'asc' }, take: Math.max(1, Math.min(50, batchSize)) });
    for (const row of rows) {
      if (lost) break;
      const job = await locked(prisma, row.key, async (tx, data) => {
        const owner = (await tx.runtimeStore.findUnique({ where: { key: WORKER_KEY } }))?.data;
        if (owner?.token !== token || owner.leaseExpiresAt <= now()) { lost = true; return null; }
        if (!data || !['pending', 'processing'].includes(data.status)
          || (data.status === 'pending' ? data.nextAttemptAt : data.leaseExpiresAt) > now()) return null;
        const next = { ...data, status: 'processing', token, leaseExpiresAt: now() + leaseMs, attempts: data.attempts + 1 };
        await put(tx, row.key, next); return next;
      });
      if (!job) continue;
      let failure;
      try { await processReceipt(normalizeReceipt(job.receipt)); } catch (error) { failure = error; }
      const saved = await locked(prisma, row.key, async (tx, current) => {
        const owner = (await tx.runtimeStore.findUnique({ where: { key: WORKER_KEY } }))?.data;
        if (current?.token !== token || owner?.token !== token || owner.leaseExpiresAt <= now()) { lost = true; return false; }
        const exhausted = job.attempts >= 8;
        // Store an error CODE only; provider messages can contain credentials.
        const code = String(failure?.code || 'TWILIO_RECEIPT_PROCESSING_FAILED').replace(/[^A-Z0-9_]/gi, '_').slice(0, 100);
        await put(tx, row.key, { ...current, token: null, leaseExpiresAt: 0,
          status: failure ? exhausted ? 'failed' : 'pending' : 'completed',
          nextAttemptAt: failure ? now() + Math.min(300_000, 5000 * (2 ** (job.attempts - 1))) : 0,
          completedAt: failure ? null : now(), lastErrorCode: failure ? code : '' });
        return true;
      });
      if (saved && failure) await onFailure({ code: String(failure.code || 'TWILIO_RECEIPT_PROCESSING_FAILED'), exhausted: job.attempts >= 8 });
      processed += 1;
    }
    // Bound completed receipts without removing pending/failed recovery work.
    await prisma.runtimeStore.deleteMany({ where: { key: { startsWith: PREFIX }, AND: [
      { data: { path: ['status'], equals: 'completed' } },
      { data: { path: ['completedAt'], lt: now() - 7 * 24 * 60 * 60 * 1000 } },
    ] } });
    return { processed, lostLease: lost };
  } finally {
    clearInterval(timer); await heartbeat;
    await locked(prisma, WORKER_KEY, async (tx, data) => {
      if (data?.token === token) await put(tx, WORKER_KEY, { token: null, leaseExpiresAt: 0 });
    });
  }
}
module.exports = { enqueueTwilioStatus, drainTwilioStatuses, normalizeReceipt, receiptKey, WORKER_KEY };
