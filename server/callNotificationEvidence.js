const { receiptKey, normalizeReceipt } = require('./twilioStatusInbox');
const SID = /^(?:SM|MM)[a-f0-9]{32}$/i;
const REJECTED = 'Tool call rejected based on configured rejection plan';
const STATES = ['accepted', 'scheduled', 'queued', 'sending', 'sent', 'failed', 'undelivered', 'canceled', 'delivered', 'read'];

function roleResult(value) {
  if (!value || typeof value !== 'object') return null;
  const id = String(value.messageId || value.messageSid || value.sid || '');
  return {
    attempted: typeof value.attempted === 'boolean' ? value.attempted : null,
    sent: typeof value.sent === 'boolean' ? value.sent : null,
    skipped: value.skipped === true,
    status: STATES.includes(value.status) || ['rejected', 'transport_error', 'suppressed', 'disabled_by_policy', 'waiting_for_customer_number', 'waiting_for_intake', 'rejected_before_execution'].includes(value.status) ? value.status : 'unknown',
    errorCode: /^[a-z0-9_-]{1,80}$/i.test(String(value.errorCode || '')) ? String(value.errorCode) : '',
    messageId: SID.test(id) ? id : '',
    messageIdSet: Boolean(value.messageIdSet || id),
    toLast4: String(value.toLast4 || '').replace(/\D/g, '').slice(-4),
    fromLast4: String(value.fromLast4 || '').replace(/\D/g, '').slice(-4),
  };
}

function parseToolResult(value) {
  if (typeof value === 'string' && value.trim() === REJECTED) {
    const role = { attempted: false, sent: false, status: 'rejected_before_execution', errorCode: 'SMS_CONFIRMATION_REJECTED' };
    return { ok: false, sent: false, status: 'rejected_before_execution', errorCode: 'SMS_CONFIRMATION_REJECTED',
      error: REJECTED, rejectedBeforeExecution: true, owner: roleResult(role), customer: roleResult(role) };
  }
  let parsed = value;
  if (typeof value === 'string') { try { parsed = JSON.parse(value); } catch { parsed = null; } }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: value === 'Success.' ? true : null, sent: null, status: value === 'Success.' ? 'completed' : 'unknown',
      errorCode: '', error: '', owner: null, customer: null };
  }
  return { ok: typeof parsed.ok === 'boolean' ? parsed.ok : null, sent: typeof parsed.sent === 'boolean' ? parsed.sent : null,
    complete: parsed.complete === true, status: String(parsed.status || '').slice(0, 80),
    errorCode: /^[a-z0-9_-]{1,80}$/i.test(String(parsed.errorCode || parsed.code || '')) ? String(parsed.errorCode || parsed.code) : '',
    error: parsed.error ? 'Notification tool reported a failure.' : '',
    rejectedBeforeExecution: false, owner: roleResult(parsed.owner), customer: roleResult(parsed.customer) };
}

function latestNotificationResult(summary) {
  return (summary?.results || []).filter(r => /^send_call_summaries_/i.test(r.name || '')).at(-1) || null;
}

function mergeToolSummaries(existing, next) {
  if (!existing) return next;
  if (!next?.count && !next?.results?.length) return existing;
  if (!existing.toolCallIds?.length) return next;
  const toolCallIds = [...new Set([...existing.toolCallIds, ...(next.toolCallIds || [])])];
  const results = new Map();
  const confidence = r => Number(r.rejectedBeforeExecution === true) * 2 + Number(r.ok != null)
    + Number(r.owner?.sent != null) + Number(r.customer?.sent != null);
  for (const result of [...(existing.results || []), ...(next.results || [])]) {
    const id = result.toolCallId || result.name;
    if (!results.has(id) || confidence(result) >= confidence(results.get(id))) results.set(id, result);
  }
  return { ...existing, ...next, toolCallIds, count: toolCallIds.length,
    countIsExact: existing.countIsExact === true && next.countIsExact === true,
    toolNames: [...new Set([...(existing.toolNames || []), ...(next.toolNames || [])])], results: [...results.values()] };
}

function recipientEvidence(result, receipt, receiptsAvailable) {
  let state = 'unconfirmed';
  if (result?.status === 'rejected_before_execution') state = 'not_submitted';
  else if (result?.status === 'disabled_by_policy') state = 'disabled';
  else if (result?.sent === true && result.messageIdSet) state = 'accepted';
  else if (result?.attempted === false) state = result.status === 'waiting_for_customer_number' ? 'needs_number' : 'not_submitted';
  else if (result?.status === 'rejected') state = 'failed';
  // Only a saved, authenticated Twilio receipt can promote delivery. A queued
  // create response, completed phone call or tool's complete:true cannot.
  if (receipt) {
    if (['delivered', 'read'].includes(receipt.status)) state = 'delivered';
    else if (['failed', 'undelivered', 'canceled'].includes(receipt.status)) state = 'failed';
    else state = 'accepted';
  }
  const labels = { unconfirmed: 'Submission unconfirmed — do not resend automatically', not_submitted: 'Not submitted',
    disabled: 'Disabled by policy', accepted: 'Accepted by messaging provider — delivery not confirmed',
    needs_number: 'Waiting for a confirmed mobile number', failed: 'Messaging failed', delivered: 'Carrier reported delivered' };
  return { state, label: labels[state], accepted: Boolean((result?.sent === true && result.messageIdSet) || receipt), delivered: state === 'delivered',
    receiptStatus: receipt?.status || '', receiptAt: receipt?.at || null,
    errorCode: receipt?.errorCode || result?.errorCode || '', receiptsAvailable };
}

function notificationEvidence(summary, receipts = new Map(), receiptsAvailable = false) {
  const result = latestNotificationResult(summary);
  const owner = recipientEvidence(result?.owner, receipts.get(result?.owner?.messageId), receiptsAvailable);
  const customer = recipientEvidence(result?.customer, receipts.get(result?.customer?.messageId), receiptsAvailable);
  const submission = result?.rejectedBeforeExecution ? 'not_submitted' : owner.accepted ? 'owner_notification_accepted'
    : owner.state === 'disabled' ? 'owner_notification_disabled' : 'unconfirmed';
  return { available: Boolean(result), submission,
    submissionLabel: submission === 'not_submitted' ? 'Request not submitted: confirmation rejected'
      : submission === 'owner_notification_accepted' ? 'Owner handoff accepted by messaging provider'
        : submission === 'owner_notification_disabled' ? 'Owner notification disabled by policy' : 'Request handoff unconfirmed',
    rejectedBeforeExecution: result?.rejectedBeforeExecution === true,
    uniqueToolCalls: summary?.count ?? null, countIsExact: summary?.countIsExact === true,
    owner, customer,
    summary: 'Call completion, request handoff, message acceptance and carrier delivery are separate checks.' };
}

async function enrichNotificationEvidence(prisma, calls) {
  const ids = new Set(calls.flatMap(call => {
    const r = latestNotificationResult(call.toolCallSummary);
    return [r?.owner?.messageId, r?.customer?.messageId].filter(id => SID.test(id || ''));
  }));
  const receipts = new Map();
  let available = ids.size === 0;
  if (ids.size && prisma?.runtimeStore?.findMany) {
    const keys = [...ids].flatMap(MessageSid => STATES.map(MessageStatus => receiptKey({ MessageSid, MessageStatus })));
    try {
      const rows = await prisma.runtimeStore.findMany({ where: { key: { in: keys } }, select: { key: true, data: true } });
      available = true;
      for (const row of rows) {
        let receipt;
        try { receipt = normalizeReceipt(row.data?.receipt); } catch { continue; }
        if (!ids.has(receipt.MessageSid) || receiptKey(receipt) !== row.key) continue;
        const current = receipts.get(receipt.MessageSid);
        if (!current || STATES.indexOf(receipt.MessageStatus) > STATES.indexOf(current.status)) {
          const stamp = Number(row.data?.receivedAt);
          receipts.set(receipt.MessageSid, { status: receipt.MessageStatus, errorCode: receipt.ErrorCode || '',
            at: Number.isSafeInteger(stamp) && stamp > 0 ? new Date(stamp).toISOString() : null });
        }
      }
    } catch { available = false; } // An unavailable receipt store never becomes a delivery claim.
  }
  return calls.map(call => ({ ...call, notificationEvidence: notificationEvidence(call.toolCallSummary, receipts, available) }));
}

module.exports = { parseToolResult, latestNotificationResult, notificationEvidence, enrichNotificationEvidence, mergeToolSummaries };
