// Saved database evidence only. No worker, provider, file-store or incident actions.
const PREFIX = 'twilio-status-inbox:';
const PAGE_SIZE = 25;
const JOB_REF = /^[a-f0-9]{64}$/;
const JOB_STATES = new Set(['pending', 'processing', 'completed', 'failed']);
const DELIVERY_STATES = new Set(['accepted', 'scheduled', 'queued', 'sending', 'sent', 'delivered', 'read', 'failed', 'undelivered', 'canceled']);
const ERROR_CODES = new Set(['P2028', 'P2034', 'P1001', 'P1002', 'P1017', '40001', '40P01', '55P03', 'TWILIO_RECEIPT_PROCESSING_FAILED', 'TWILIO_WORKER_LEASE_LOST', 'TWILIO_WORKER_FAILED']);

class InspectionInputError extends Error {}
function invalid() { throw new InspectionInputError('invalid_receipt_inspection_query'); }
function iso(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return invalid();
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value.replace(/Z$/, value.includes('.') ? 'Z' : '.000Z')) return invalid();
  return new Date(time);
}
function parseInspectionQuery(query = {}) {
  if (!query || typeof query !== 'object' || Array.isArray(query)
    || Object.keys(query).some(k => !['jobRef', 'from', 'to', 'cursor'].includes(k))) return invalid();
  if (Object.hasOwn(query, 'jobRef')) {
    if (Object.keys(query).length !== 1 || typeof query.jobRef !== 'string' || !JOB_REF.test(query.jobRef)) return invalid();
    return { mode: 'exact_job', key: PREFIX + query.jobRef };
  }
  const from = iso(query.from), to = iso(query.to);
  if (to <= from || to - from > 24 * 60 * 60 * 1000) return invalid();
  if (Object.hasOwn(query, 'cursor') && (typeof query.cursor !== 'string' || !JOB_REF.test(query.cursor))) return invalid();
  return { mode: 'time_window_candidates', from, to, ...(query.cursor ? { after: PREFIX + query.cursor } : {}) };
}
function timestamp(value) {
  const n = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : NaN;
  return Number.isSafeInteger(n) && n > 0 && n <= 8640000000000000 ? new Date(n).toISOString() : null;
}
function projectJob(row) {
  const data = row?.data && typeof row.data === 'object' && !Array.isArray(row.data) ? row.data : {};
  const receipt = data.receipt && typeof data.receipt === 'object' ? data.receipt : {};
  const key = typeof row?.key === 'string' && row.key.startsWith(PREFIX) ? row.key.slice(PREFIX.length) : '';
  return {
    jobRef: JOB_REF.test(key) ? key : null,
    jobState: JOB_STATES.has(data.status) ? data.status : 'unknown',
    reportedDeliveryState: DELIVERY_STATES.has(receipt.MessageStatus) ? receipt.MessageStatus : 'unknown',
    attempts: Number.isSafeInteger(data.attempts) && data.attempts >= 0 && data.attempts <= 1000 ? data.attempts : null,
    receivedAt: timestamp(data.receivedAt), completedAt: timestamp(data.completedAt),
    createdAt: timestamp(row?.createdAt), lastUpdatedAt: timestamp(row?.updatedAt),
    leaseExpiresAt: timestamp(data.leaseExpiresAt), nextAttemptAt: timestamp(data.nextAttemptAt),
    lastErrorCode: data.lastErrorCode === '' ? null : ERROR_CODES.has(data.lastErrorCode) ? data.lastErrorCode : 'unknown',
  };
}

async function inspectReceiptState({ prisma, query }) {
  const input = parseInspectionQuery(query);
  const select = { key: true, data: true, createdAt: true, updatedAt: true };
  let rows;
  if (input.mode === 'exact_job') {
    const row = await prisma.runtimeStore.findUnique({ where: { key: input.key }, select });
    rows = row ? [row] : [];
  } else {
    // Keyset pagination is bounded. Time matching is a candidate search, not an
    // immutable attempt history: later updates and retention can hide old work.
    rows = await prisma.runtimeStore.findMany({ where: {
      key: { startsWith: PREFIX, ...(input.after ? { gt: input.after } : {}) },
      OR: [{ createdAt: { gte: input.from, lt: input.to } }, { updatedAt: { gte: input.from, lt: input.to } }],
    }, select, orderBy: { key: 'asc' }, take: PAGE_SIZE + 1 });
  }
  if (!Array.isArray(rows) || rows.length > PAGE_SIZE + 1) throw new Error('unrecognized_saved_receipt_state');
  const hasMore = rows.length > PAGE_SIZE;
  const jobs = rows.slice(0, PAGE_SIZE).map(projectJob);
  const cursor = hasMore ? jobs.at(-1)?.jobRef : null;
  const metadataComplete = jobs.length > 0 && jobs.every(j => j.jobRef && j.jobState !== 'unknown' && j.reportedDeliveryState !== 'unknown'
    && j.attempts !== null && j.receivedAt !== null && j.createdAt !== null && j.lastUpdatedAt !== null
    && j.lastErrorCode !== 'unknown'
    && (j.jobState !== 'failed' || j.lastErrorCode !== null)
    && (j.jobState !== 'completed' || j.completedAt !== null)
    && (j.jobState !== 'processing' || j.leaseExpiresAt !== null)
    && (j.jobState !== 'pending' || j.nextAttemptAt !== null));
  return {
    ok: true, readOnly: true, evidence: 'saved_receipt_state', selection: input.mode,
    jobs, pagination: { pageSize: PAGE_SIZE, hasMore, nextCursor: cursor },
    metadataComplete, originalOperationOutcome: 'unknown', providerDeliveryVerified: false,
    historicalCoverage: 'not_an_audit_trail',
    ...(!metadataComplete || (hasMore && !cursor) ? { warning: 'saved_metadata_incomplete' } : {}),
  };
}

function receiptInspectionHandler({ prisma }) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try { return res.json(await inspectReceiptState({ prisma, query: req.query })); }
    catch (error) {
      // Never pass DB exceptions into runtime incident capture or expose them.
      const invalidInput = error instanceof InspectionInputError;
      return res.status(invalidInput ? 400 : 503).json({ ok: false, readOnly: true,
        error: invalidInput ? 'invalid_receipt_inspection_query' : 'saved_receipt_state_unavailable',
        originalOperationOutcome: 'unknown', providerDeliveryVerified: false });
    }
  };
}
module.exports = { inspectReceiptState, parseInspectionQuery, receiptInspectionHandler };
