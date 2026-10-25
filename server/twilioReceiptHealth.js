const { WORKER_KEY } = require('./twilioStatusInbox');
const { hashTarget, summarizeAttention } = require('./operationalAttention');

function summarizeReceiptHealth({ counts = {}, worker = null, now = Date.now() } = {}) {
  const value = key => Math.max(0, Number(counts[key]) || 0);
  const oldest = Number(counts.oldestPendingAt) || null;
  const lastSuccess = Number(worker?.lastSuccessfulRunAt) || null;
  const oldestPendingAgeSeconds = oldest ? Math.max(0, Math.floor((now - oldest) / 1000)) : null;
  const workerAgeSeconds = lastSuccess ? Math.max(0, Math.floor((now - lastSuccess) / 1000)) : null;
  const failed = value('failed'), pending = value('pending'), expiredLeases = value('expiredLeases');
  let status = !lastSuccess ? 'unknown' : 'healthy';
  if (oldestPendingAgeSeconds >= 120 || workerAgeSeconds >= 120 || expiredLeases
    || (pending > 0 && !oldest)) status = 'warning';
  if (oldestPendingAgeSeconds >= 600 || workerAgeSeconds >= 600 || failed) status = 'critical';
  return { status, checkedAt: new Date(now).toISOString(), counts: {
    pending, processing: value('processing'), completed: value('completed'), failed, expiredLeases,
  }, oldestPendingAgeSeconds, workerAgeSeconds,
    lastSuccessfulRunAt: lastSuccess ? new Date(lastSuccess).toISOString() : null,
    lastErrorCode: String(worker?.lastErrorCode || '').replace(/[^A-Z0-9_]/gi, '_').slice(0, 100),
  };
}

async function readTwilioReceiptHealth({ prisma, now = Date.now() }) {
  try {
    const [rows, worker] = await Promise.all([
      prisma.$queryRaw`SELECT
        COUNT(*) FILTER (WHERE data->>'status' = 'pending')::int AS pending,
        COUNT(*) FILTER (WHERE data->>'status' = 'processing')::int AS processing,
        COUNT(*) FILTER (WHERE data->>'status' = 'completed')::int AS completed,
        COUNT(*) FILTER (WHERE data->>'status' = 'failed')::int AS failed,
        COUNT(*) FILTER (WHERE data->>'status' = 'processing' AND
          CASE WHEN data->>'leaseExpiresAt' ~ '^[0-9]+$'
            THEN (data->>'leaseExpiresAt')::numeric <= ${now} ELSE true END)::int AS "expiredLeases",
        MIN(CASE WHEN data->>'receivedAt' ~ '^[0-9]+$' THEN (data->>'receivedAt')::numeric END)
          FILTER (WHERE data->>'status' = 'pending')::text AS "oldestPendingAt"
        FROM "RuntimeStore" WHERE key LIKE 'twilio-status-inbox:%'`,
      prisma.runtimeStore.findUnique({ where: { key: WORKER_KEY }, select: { data: true } }),
    ]);
    if (!rows?.length) return { status: 'unavailable', reason: 'receipt_health_not_confirmed' };
    return summarizeReceiptHealth({ counts: rows[0], worker: worker?.data, now });
  } catch (_) {
    return { status: 'unavailable', reason: 'receipt_health_not_confirmed' };
  }
}

function withTwilioReceiptAttention(inbox, health, now = Date.now()) {
  const items = (inbox.items || []).filter(item => item.kind !== 'twilio_receipt_worker');
  if (health.status !== 'healthy') {
    const unconfirmed = ['unknown', 'unavailable'].includes(health.status);
    items.unshift({
      id: hashTarget('twilio-receipt-worker:v1'), kind: 'twilio_receipt_worker',
      severity: health.status === 'critical' ? 'critical' : 'warning',
      title: unconfirmed ? 'SMS receipt-worker health is not confirmed' : 'Saved SMS delivery reports need attention',
      summary: unconfirmed ? 'The queue or a recent successful worker run could not be confirmed.'
        : 'Saved receipts are delayed, exhausted, or have expired processing leases.',
      businessName: '', targetType: 'worker', targetId: 'twilio-status-worker:v1', actions: [],
      detectedAt: health.lastSuccessfulRunAt || new Date(now).toISOString(),
      ageMinutes: health.workerAgeSeconds == null ? null : Math.floor(health.workerAgeSeconds / 60),
      incident: {
        reasonCode: 'TWILIO_RECEIPT_WORKER_UNHEALTHY',
        reason: unconfirmed ? 'No current healthy queue snapshot is available.' : 'The durable receipt queue failed its age or failure checks.',
        impact: 'Signup continuation may wait even when Twilio has delivered a text. This is not proof that SMS delivery failed.',
        lastCheckpoint: health.lastSuccessfulRunAt || 'Successful worker run not yet confirmed',
        nextAction: 'Check queue counts and worker logs, then reconcile the exact saved receipt. Do not resend texts or create another signup.',
      },
      snapshot: {
        'Queue status': health.status,
        'Pending receipts': health.counts?.pending ?? 'unknown',
        'Failed receipts': health.counts?.failed ?? 'unknown',
        'Oldest pending seconds': health.oldestPendingAgeSeconds ?? 'unknown',
        'Last successful worker run': health.lastSuccessfulRunAt || 'unknown',
      },
    });
  }
  return { ...inbox, items, summary: summarizeAttention(items), twilioReceipts: health };
}
module.exports = { readTwilioReceiptHealth, summarizeReceiptHealth, withTwilioReceiptAttention };
