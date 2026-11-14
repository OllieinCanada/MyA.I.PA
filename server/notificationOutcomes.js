'use strict';
const crypto = require('node:crypto');
const { receiptKey, normalizeReceipt } = require('./twilioStatusInbox');
const SID = /^(?:SM|MM)[a-f0-9]{32}$/i;
const STATES = ['accepted','scheduled','queued','sending','sent','delivered','read','failed','undelivered','canceled'];
const hash = value => crypto.createHash('sha256').update(String(value)).digest('hex');
function classifyNotificationOutcome(result) {
  const sid = SID.test(result?.messageId || '') ? result.messageId : '';
  let state = 'unknown';
  if (result?.sent === true && sid) state = 'accepted';
  else if (result?.status === 'rejected' && Number.isInteger(result.providerStatus)
    && result.providerStatus >= 400 && result.providerStatus < 500 && result.providerStatus !== 408) state = 'not_sent';
  else if (result?.attempted === false && !result?.requiresReconciliation) state = 'not_sent';
  const receiptPersistenceUnconfirmed = state === 'accepted' && result.dispatchReceiptStored === false;
  const deliveryFailureReported = ['failed','undelivered','canceled'].includes(result?.status);
  return { state, label: state === 'accepted' ? 'Accepted by provider — phone delivery not proven'
    : state === 'not_sent' ? 'Not sent — provider refusal or no submission'
      : 'Unknown — inspect saved receipts; do not resend',
    severity: state === 'unknown' || receiptPersistenceUnconfirmed || deliveryFailureReported ? 'warning' : state === 'accepted' ? 'info' : 'warning',
    requiresInspection: state === 'unknown' || receiptPersistenceUnconfirmed || deliveryFailureReported,
    automaticRetryAllowed: false, deliveryProven: false,
    receiptPersistenceUnconfirmed, deliveryFailureReported };
}
function automaticNotificationAlert(result, callId) {
  const noSubmission = result?.actionAttempted === false && !result?.requiresInspection
    ? { attempted: false, sent: false } : null;
  return { event: 'call_notification_outcome', callReference: hash(callId || 'unbound'),
    scope: 'This invocation; earlier durable claims require separate receipt inspection',
    owner: classifyNotificationOutcome(result?.owner || noSubmission),
    customer: classifyNotificationOutcome(result?.customer || noSubmission),
    // Contains no phone numbers, bodies, credentials or arbitrary error strings.
    sendingPerformedByAlert: false };
}
async function inspectNotificationReceipts({ prisma, result }) {
  const outcome = classifyNotificationOutcome(result), sid = SID.test(result?.messageId || '') ? result.messageId : '';
  if (!sid) return { ...outcome, receiptCheck: 'missing_message_id', deliveryStatus: 'unverified', deliveryProven: false };
  const keys = STATES.map(MessageStatus => receiptKey({ MessageSid: sid, MessageStatus }));
  let rows;
  try { rows = await prisma.runtimeStore.findMany({ where: { key: { in: keys } }, select: { key: true, data: true }, take: keys.length + 1 }); }
  catch { return { ...outcome, receiptCheck: 'store_unavailable', requiresInspection: true, deliveryStatus: 'unverified' }; }
  if (!Array.isArray(rows) || rows.length > keys.length || new Set(rows.map(row=>row.key)).size !== rows.length)
    return { ...outcome, receiptCheck: 'invalid_evidence', requiresInspection: true, deliveryStatus: 'unverified' };
  const receipts = [];
  for (const row of rows) {
    let receipt;
    try { receipt = normalizeReceipt(row.data?.receipt); } catch { return { ...outcome, receiptCheck: 'invalid_evidence', requiresInspection: true, deliveryStatus: 'unverified' }; }
    if (row.data?.version !== 1 || !keys.includes(row.key) || receipt.MessageSid !== sid || receiptKey(receipt) !== row.key
      || !Number.isSafeInteger(row.data?.receivedAt) || row.data.receivedAt <= 0)
      return { ...outcome, receiptCheck: 'invalid_evidence', requiresInspection: true, deliveryStatus: 'unverified' };
    receipts.push(receipt);
  }
  const delivered = receipts.some(r=>['delivered','read'].includes(r.MessageStatus));
  const failed = receipts.some(r=>['failed','undelivered','canceled'].includes(r.MessageStatus));
  if (delivered && failed) return { ...outcome, receiptCheck: 'conflicting_receipts', requiresInspection: true, deliveryStatus: 'unverified' };
  return { ...outcome, receiptCheck: receipts.length ? 'saved_authenticated_inbox' : 'no_saved_receipt',
    ...(failed ? { label: 'Accepted by provider, but carrier reported delivery failure' } : {}),
    deliveryStatus: delivered ? 'delivered' : failed ? 'failed' : 'unverified', deliveryProven: delivered,
    severity: failed ? 'warning' : outcome.severity,
    requiresInspection: failed || outcome.requiresInspection,
    receiptStatus: receipts.map(r=>r.MessageStatus).sort().join(',') };
}
async function listNotificationOutcomeAlerts({ prisma, businessId }) {
  if (!Number.isSafeInteger(businessId) || businessId <= 0) throw Object.assign(Error('Exact business ID required'), { statusCode: 400 });
  const rows = await prisma.runtimeStore.findMany({ where: { key: { startsWith: 'call-notification-dispatch:v1:' },
    data: { path: ['authorization','businessId'], equals: businessId } }, orderBy: { updatedAt: 'desc' }, take: 101 });
  const alerts = [];
  for (const row of rows.slice(0,100)) {
    const data=row.data, auth=data?.authorization;
    if (auth?.source !== 'authenticated_vapi_conversation' || auth.businessId !== businessId
      || !['owner','customer'].includes(auth.leg) || !/^[a-f0-9]{64}$/.test(auth.callReference || '')) continue;
    // A held claim without a durable result stays unknown, even if an operator
    // believes a send probably failed. This GET cannot unlock or replay it.
    const result=data.state === 'completed' ? data.result : null;
    alerts.push({ callReference: auth.callReference, recipientRole: auth.leg,
      at: data.completedAt || data.claimedAt || null, claimState: data.state,
      ...(await inspectNotificationReceipts({ prisma, result })) });
  }
  return { alerts, complete: rows.length <= 100, limit: 100, readOnly: true, providerRequests: 0,
    scope: 'Automatic-admission claims only; absent rows do not prove a message was not sent.' };
}
module.exports = { classifyNotificationOutcome, automaticNotificationAlert, inspectNotificationReceipts, listNotificationOutcomeAlerts };
