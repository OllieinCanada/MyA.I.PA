// Exact saved-state inspection only: no provider clients, workers or incident helpers.
const { createHash } = require('node:crypto');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const STATUSES = new Set(['STARTED', 'COMPLETED', 'MISSED', 'ABANDONED', 'FAILED']);
const ENDINGS = new Set(['customer-ended-call', 'assistant-ended-call', 'assistant-request-failed',
  'assistant-request-returned-error', 'assistant-request-returned-unspeakable-error',
  'assistant-request-returned-invalid-assistant', 'assistant-request-returned-no-assistant']);
class InputError extends Error {}
const REF = /^[a-f0-9]{64}$/;
const MAX_CANDIDATES = 200;
function callReference(callId) { return createHash('sha256').update('vapi-call:' + callId).digest('hex'); }
function businessReference(callId, businessId) { return createHash('sha256').update('vapi-call:' + callId + ':business:' + businessId).digest('hex'); }
function makeReferences(callId, businessId) {
  if (typeof callId !== 'string' || !UUID.test(callId) || !Number.isSafeInteger(Number(businessId))
    || Number(businessId) <= 0 || Number(businessId) > 2147483647) throw new InputError();
  return { callRef: callReference(callId), businessRef: businessReference(callId, Number(businessId)) };
}
function parseQuery(query = {}) {
  if (!query || typeof query !== 'object' || Array.isArray(query)
    || Object.keys(query).length !== 2 || Object.keys(query).some(k => !['callRef', 'businessRef'].includes(k))
    || typeof query.callRef !== 'string' || !REF.test(query.callRef)
    || typeof query.businessRef !== 'string' || !REF.test(query.businessRef)) throw new InputError();
  return { callRef: query.callRef, businessRef: query.businessRef };
}

function timestamp(value) {
  return value instanceof Date && Number.isFinite(value.getTime()) && value.getTime() > 0 ? value.toISOString() : null;
}
function positiveId(value) { return Number.isSafeInteger(value) && value > 0; }
function projectRecord(row) {
  const duration = Number.isSafeInteger(row.durationSec) && row.durationSec >= 0 && row.durationSec <= 86400 ? row.durationSec : null;
  return { status: STATUSES.has(row.status) ? row.status : 'unknown',
    durationSec: duration, startedAt: timestamp(row.startedAt), endedAt: timestamp(row.endedAt),
    endedReason: ENDINGS.has(row.endedReason) ? row.endedReason : 'unknown',
    callerLinked: positiveId(row.callerId) };
}
async function inspectCallRecord({ prisma, query, releaseCommit = 'unknown', now = new Date() }) {
  const input = parseQuery(query);
  return prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '1500ms'");
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw Error('Unknown observation time');
    const candidates = await tx.call.findMany({ where: { externalProvider: 'vapi', startedAt: { gte: new Date(now.getTime() - 86400000), lte: now } },
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }], take: MAX_CANDIDATES + 1,
      select: { id: true, externalId: true, businessId: true, callerId: true, status: true, durationSec: true,
        startedAt: true, endedAt: true, endedReason: true, twilioCallSid: true } });
    if (!Array.isArray(candidates) || candidates.length > MAX_CANDIDATES + 1) throw Error('Unexpected saved state');
    const rows = candidates.slice(0, MAX_CANDIDATES).filter(row => typeof row.externalId === 'string'
      && UUID.test(row.externalId) && callReference(row.externalId) === input.callRef);
    const checks = { providerRecord: rows.length === 1 ? 'verified' : rows.length === 0 ? 'not_found' : 'conflict',
      businessOwnership: 'unknown', carrierIdentity: 'unknown', savedCompletion: 'unknown' };
    let record = null;
    if (rows.length === 1) {
      const row = rows[0];
      const providerCount = await tx.call.count({ where: { externalProvider: 'vapi', externalId: row.externalId } });
      checks.providerRecord = providerCount === 1 ? 'verified' : Number.isSafeInteger(providerCount) && providerCount > 1 ? 'conflict' : 'unknown';
      checks.businessOwnership = positiveId(row.businessId) ? businessReference(row.externalId, row.businessId) === input.businessRef ? 'verified' : 'mismatch' : 'unknown';
      // Do not expose another business's timestamps, status or carrier linkage.
      if (checks.businessOwnership === 'verified') {
        record = projectRecord(row);
        if (typeof row.twilioCallSid === 'string' && /^CA[a-fA-F0-9]{32}$/.test(row.twilioCallSid)) {
          const count = await tx.call.count({ where: { twilioCallSid: row.twilioCallSid } });
          checks.carrierIdentity = count === 1 ? 'verified' : Number.isSafeInteger(count) && count > 1 ? 'conflict' : 'unknown';
        }
        const normal = ['customer-ended-call', 'assistant-ended-call'].includes(record.endedReason);
        if (record.status === 'COMPLETED' && record.durationSec > 0 && record.startedAt && record.endedAt
          && Date.parse(record.endedAt) > Date.parse(record.startedAt)
          && Math.abs(record.durationSec - (Date.parse(record.endedAt) - Date.parse(record.startedAt)) / 1000) <= 2
          && normal && record.callerLinked && positiveId(row.id)) {
          checks.savedCompletion = 'verified';
        } else if (['FAILED', 'MISSED', 'ABANDONED'].includes(record.status)) checks.savedCompletion = 'not_completed';
      }
    }
    return { schemaVersion: 1, readOnly: true, evidence: 'saved_call_record',
      releaseCommit: /^[a-f0-9]{40}$/.test(releaseCommit) ? releaseCommit : 'unknown',
      callRef: input.callRef, search: { windowHours: 24, maxCandidates: MAX_CANDIDATES, truncated: candidates.length > MAX_CANDIDATES },
      savedRecordVerified: Object.values(checks).every(value => value === 'verified'),
      checks, record, liveProviderVerified: false };
  }, { maxWait: 500, timeout: 2500, isolationLevel: 'RepeatableRead' });
}
function verificationHandler({ prisma, getRelease = () => 'unknown' }) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try { return res.json(await inspectCallRecord({ prisma, query: req.query, releaseCommit: getRelease() })); }
    catch (error) {
      return res.status(error instanceof InputError ? 400 : 503).json({ ok: false, readOnly: true,
        verification: 'unknown', error: error instanceof InputError ? 'invalid_call_verification_query' : 'saved_call_state_unavailable' });
    }
  };
}
module.exports = { parseQuery, inspectCallRecord, verificationHandler, makeReferences, ENDINGS, STATUSES };
