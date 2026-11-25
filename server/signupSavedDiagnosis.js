'use strict';
const { listSignupBugs } = require('./signupBugHistory');
const { signupBusinessKey } = require('./signupBusinessIdentity');
const { journalKey } = require('./intakeRecoveryJournal');
const verified = new WeakSet();
const codes = new Set(['P2028', 'P2024', 'SIGNUP_BUSINESS_MAPPING_BUSY', 'SIGNUP_BUSINESS_LOCK_UNVERIFIED']);
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

// A generic Make response must not hide an exact, already-saved server error.
// No name/phone/time-only lookup, external GET, write, retry, or send. The
// operation UUID is returned by our handoff function, never a request body.
async function readSavedSignupDiagnosis({ prisma, listSignups, record, operationId, failedStage, now = Date.now }) {
  if (!UUID.test(operationId || '') || failedStage !== 'VAPI_NUMBER_IMPORT'
      || !/^signup_[a-f0-9]{32}$/.test(record?.signupAttemptId || '')) return null;
  try {
    return await prisma.$transaction(async tx => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const attemptId = record.signupAttemptId, key = `${journalKey(attemptId)}:handoff:${operationId}`;
      const row = (await tx.runtimeStore.findUnique({ where: { key } }))?.data;
      const start = Date.parse(row?.startedAt), end = Date.parse(row?.updatedAt), at = now();
      if (!row || row.eventKey !== attemptId || row.operationId !== operationId || row.kind !== 'handoff'
          || !['accepted', 'uncertain'].includes(row.status) || row.businessKey !== signupBusinessKey(record)
          || !/^[a-f0-9]{64}$/.test(row.payloadHash || '') || !Number.isFinite(start) || !Number.isFinite(end)
          || end < start || end > at || at - end > 60_000 || end - start > 15 * 60_000) return null;
      // Error capture predates operation-ID correlation. Refuse competing
      // handoff windows instead of attributing a report to whichever won.
      const handoffs = await tx.runtimeStore.findMany({ where: { key: { startsWith: `${journalKey(attemptId)}:handoff:` } },
        orderBy: [{ createdAt: 'desc' }, { key: 'desc' }], take: 51 });
      if (handoffs.length > 50 || !handoffs.some(item => item.key === key)) return null;
      for (const other of handoffs.filter(item => item.key !== key)) {
        const from = Date.parse(other.data?.startedAt), until = Date.parse(other.data?.updatedAt);
        if (!Number.isFinite(from) || !Number.isFinite(until) || until < from) return null;
        if (from <= at && (other.data.status === 'started' || until >= start)) return null;
      }
      const report = await listSignupBugs({ prisma: tx, listSignups, attemptId, limit: 50 });
      // Never select a convenient subset of truncated/conflicting evidence.
      if (report.hasMore) return null;
      const candidates = report.events.filter(event => event.association === 'verified' && event.signupAttemptId === attemptId
        && ['assistant-import', 'business-mapping'].includes(event.stage)
        && Date.parse(event.capturedAt) >= start && Date.parse(event.capturedAt) <= Math.min(at, end + 5000));
      if (!candidates.length || candidates.some(event => !codes.has(event.diagnostic.code))
          || new Set(candidates.map(event => `${event.stage}:${event.diagnostic.code}`)).size !== 1) return null;
      const event = candidates[0];
      const result = Object.freeze({ code: event.diagnostic.code, stage: event.stage, reference: event.reference });
      verified.add(result); return result;
    }, { maxWait: 500, timeout: 1500, isolationLevel: 'RepeatableRead' });
  } catch { return null; } // Missing evidence is unknown, never a clean bill of health.
}
function describeSavedSignupDiagnosis(value) {
  if (!value || !verified.has(value)) return null;
  const checkpoint = value.stage === 'business-mapping' ? 'business/owner mapping' : 'number-import/pre-delivery checks';
  const reason = value.code === 'P2028' ? `Saved P2028: database transaction expired/closed during ${checkpoint}.`
    : value.code === 'P2024' ? `Saved P2024: database connection pool timed out during ${checkpoint}.`
    : value.code === 'SIGNUP_BUSINESS_MAPPING_BUSY' ? 'Saved database error: business mapping lock wait reached its limit; mapping was not admitted.'
    : 'Saved database error: business mapping lock proof unavailable; mapping was refused.';
  return { ...value, reason, nextAction: 'Inspect existing receipts and database timing. Keep the existing number; do not replay signup or provider actions.' };
}
module.exports = { readSavedSignupDiagnosis, describeSavedSignupDiagnosis };
