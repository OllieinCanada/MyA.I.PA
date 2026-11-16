'use strict';
const codes = new Set(['LOCAL_CANADIAN_NUMBER_INVENTORY_UNAVAILABLE','CANADIAN_NUMBER_INVENTORY_UNAVAILABLE',
  'PROVISIONING_STEP_FAILED','PROVISIONING_RECONCILIATION_REQUIRED','PROVISIONING_RESULT_STALE',
  'PROVISIONING_CONTEXT_MISMATCH','PROVISIONING_STORE_UNAVAILABLE','PROVISIONING_CLAIM_LOST',
  'PROVISIONING_RESULT_UNVERIFIED','ETIMEDOUT','ECONNRESET','ENOTFOUND','ABORT_ERR']);
const stamp = value => Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const code = value => codes.has(value) || /^\d{5}$/.test(value || '') ? String(value) : null;
function purchaseEvidence(record, receipts, coverage) {
  const receipt = receipts['twilio-number'];
  const trusted = coverage === 'exact_context_and_saved_receipts' || coverage === 'synthetic_exact_context_and_saved_receipts';
  const r = trusted ? receipt : null;
  const errorCode = code(r?.lastErrorCode);
  const inventory = /CANADIAN_NUMBER_INVENTORY_UNAVAILABLE/.test(errorCode || '');
  const result = r?.result;
  const assigned = /^\+1\d{10}$/.test(record.twilioPhoneNumber || '') ? record.twilioPhoneNumber : null;
  const matchedPurchase = r?.status === 'completed' && /^PN[a-f0-9]{32}$/i.test(result?.twilioSid || '')
    && assigned && result.phoneNumber === assigned;
  // Even a pre-dispatch failure describes only this saved attempt, not an
  // account-wide guarantee that no previous purchase exists.
  const notDispatched = r?.status === 'failed' && Object.hasOwn(r, 'dispatchStartedAt') && r.dispatchStartedAt === null;
  return { version: 1, readOnly: true, provider: 'Twilio',
    recordedError: errorCode || (r?.lastErrorCode ? 'Unrecognized saved code' : 'Not recorded'),
    explanation: inventory ? 'The saved search found no suitable number under its requested area-code policy.'
      : r?.status === 'failed' ? 'The purchase step failed. The saved code alone does not confirm whether a number was bought.'
        : 'No exact purchase failure is established by this evidence.',
    httpStatus: Number.isInteger(r?.lastProviderStatus) && r.lastProviderStatus >= 400 && r.lastProviderStatus <= 599 ? r.lastProviderStatus : null,
    receiptStatus: ['completed','failed','processing','invalidated'].includes(r?.status) ? r.status : 'unknown',
    outcome: matchedPurchase ? 'purchase_recorded' : notDispatched ? 'not_dispatched' : 'unknown',
    outcomeLabel: matchedPurchase ? 'Matching purchase recorded — not a live ownership check'
      : notDispatched ? 'No dispatch recorded for this attempt' : 'Purchase outcome unconfirmed',
    number: assigned ? `Area ${assigned.slice(2,5)} · ending ${assigned.slice(-4)} (saved assignment)` : 'No saved assignment',
    assistant: record.vapiAssistantId ? 'Saved assistant reference — ownership not checked live' : 'No saved assistant reference',
    evidenceAt: stamp(r?.failedAt || r?.completedAt || r?.updatedAt), coverage,
    source: trusted && r ? 'Exact-context durable receipt' : 'Saved signup only; exact receipt unavailable',
    liveProviderVerified: false, resumeAllowed: false,
    nextAction: 'Verify existing numbers and provider purchase receipts before any retry. Recovery needs a separately approved bounded plan.' };
}
module.exports = { purchaseEvidence };
