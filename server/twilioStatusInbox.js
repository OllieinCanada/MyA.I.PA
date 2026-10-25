const crypto = require('node:crypto');

const PREFIX = 'twilio-status-inbox:';
const WORKER_KEY = 'twilio-status-worker:v1';
const LEASE_MS = 120_000;
const runningWorkers = new WeakSet();
const TRANSIENT_DATABASE_CODES = new Set(['P2028', 'P2034', 'P1001', 'P1002', 'P1017', '40001', '40P01', '55P03']);
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
  // Only database work may run inside this callback. Never retry a provider send.
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT set_config('lock_timeout', '1000ms', true) AS lock_timeout`;
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))::text AS lock_result`;
        return work(tx, (await tx.runtimeStore.findUnique({ where: { key } }))?.data || null);
      }, { maxWait: 2000, timeout: 10000 });
    } catch (error) {
      const code = String(error?.meta?.code || error?.code || '');
      if (attempt >= 2 || !TRANSIENT_DATABASE_CODES.has(code)) throw error;
      const delay = attempt === 0 ? 100 + Math.random() * 200 : 500 + Math.random() * 500;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
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
async function runWorker({ prisma, processReceipt, onFailure = async () => {}, now = Date.now,
  batchSize = 10, leaseMs = LEASE_MS, heartbeatMs = 30_000 }) {
  const token = crypto.randomUUID();
  const acquired = await locked(prisma, WORKER_KEY, async (tx, data) => {
    if (data?.leaseExpiresAt > now()) return false;
    await put(tx, WORKER_KEY, { ...data, token, leaseExpiresAt: now() + leaseMs, lastStartedAt: now() });
    return { cleanupDue: !data?.lastCleanupAt || now() - data.lastCleanupAt >= 3600000 };
  });
  if (!acquired) return { processed: 0, busy: true };
  let lost = false, heartbeat = Promise.resolve();
  const timer = setInterval(() => {
    heartbeat = heartbeat.then(() => locked(prisma, WORKER_KEY, async (tx, data) => {
      if (data?.token !== token || data.leaseExpiresAt <= now()) { lost = true; return; }
      await put(tx, WORKER_KEY, { ...data, token, leaseExpiresAt: now() + leaseMs });
    })).catch(() => { lost = true; });
  }, heartbeatMs);
  timer.unref?.();
  let processed = 0;
  let completed = false, failureCode = '', cleaned = false, primaryError;
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
    // Retention is hourly and bounded, not a full JSON scan/delete every 5s.
    // Pending and failed jobs are never discarded by cleanup.
    if (acquired.cleanupDue && !lost) {
      const stale = await prisma.runtimeStore.findMany({ where: { key: { startsWith: PREFIX }, AND: [
        { data: { path: ['status'], equals: 'completed' } },
        { data: { path: ['completedAt'], lt: now() - 7 * 24 * 60 * 60 * 1000 } },
      ] }, take: 100, select: { key: true } });
      if (stale.length) await prisma.runtimeStore.deleteMany({ where: { key: { in: stale.map(row => row.key) },
        data: { path: ['status'], equals: 'completed' } } });
      cleaned = stale.length < 100;
    }
    completed = !lost;
    if (lost) failureCode = 'TWILIO_WORKER_LEASE_LOST';
    return { processed, lostLease: lost };
  } catch (error) {
    primaryError = error;
    failureCode = String(error?.code || 'TWILIO_WORKER_FAILED').replace(/[^A-Z0-9_]/gi, '_').slice(0, 100);
    throw error;
  } finally {
    clearInterval(timer); await heartbeat;
    try {
      await locked(prisma, WORKER_KEY, async (tx, data) => {
        if (data?.token === token) await put(tx, WORKER_KEY, { ...data, token: null, leaseExpiresAt: 0,
          lastFinishedAt: now(), ...(completed ? { lastSuccessfulRunAt: now(), lastErrorCode: '' }
            : { lastFailedAt: now(), lastErrorCode: failureCode || 'TWILIO_WORKER_FAILED' }),
          ...(cleaned ? { lastCleanupAt: now() } : {}), lastProcessed: processed });
      });
    } catch (releaseError) {
      // Preserve the original failure when database lease release fails too.
      if (!primaryError) throw releaseError;
    }
  }
}

async function drainTwilioStatuses(options) {
  const { prisma } = options;
  if (runningWorkers.has(prisma)) return { processed: 0, busy: true, local: true };
  runningWorkers.add(prisma);
  try { return await runWorker(options); } finally { runningWorkers.delete(prisma); }
}

module.exports = { enqueueTwilioStatus, drainTwilioStatuses, normalizeReceipt, receiptKey, WORKER_KEY };
