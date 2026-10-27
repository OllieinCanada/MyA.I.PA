const test = require('node:test');
const assert = require('node:assert/strict');
const { parseToolResult, notificationEvidence, enrichNotificationEvidence, mergeToolSummaries } = require('../server/callNotificationEvidence');
const { receiptKey } = require('../server/twilioStatusInbox');
const ownerSid = 'SM' + '1'.repeat(32), customerSid = 'SM' + '2'.repeat(32);
const result = () => ({ name: 'send_call_summaries_test', toolCallId: 'notify-1', ...parseToolResult({ ok: true, complete: true,
  owner: { attempted: true, sent: true, status: 'queued', messageId: ownerSid },
  customer: { attempted: true, sent: true, status: 'queued', messageId: customerSid } }) });
const summary = r => ({ count: 2, countIsExact: true, toolCallIds: ['notify-1', 'end-1'], toolNames: ['send_call_summaries_test', 'endCall'], results: [r] });
test('plain-text Vapi rejection remains a definite pre-execution failure, not an empty success', () => {
  const r = { name: 'send_call_summaries_test', ...parseToolResult('Tool call rejected based on configured rejection plan') };
  assert.equal(r.ok, false);assert.equal(r.errorCode, 'SMS_CONFIRMATION_REJECTED');
  const evidence = notificationEvidence(summary(r));
  assert.equal(evidence.submission, 'not_submitted');
  assert.equal(evidence.owner.state, 'not_submitted');assert.equal(evidence.customer.accepted, false);
  assert.equal(evidence.rejectedBeforeExecution, true);
});
test('complete:true and queued message IDs are acceptance, never proof of delivery', () => {
  const evidence = notificationEvidence(summary(result()));
  assert.equal(evidence.submission, 'owner_notification_accepted');
  assert.equal(evidence.owner.state, 'accepted');assert.equal(evidence.customer.delivered, false);
  assert.match(evidence.customer.label, /delivery not confirmed/);
});
test('saved signed receipt keys promote only their exact message and preserve carrier delivery on stale events', async () => {
  const row = (sid, status) => {const receipt = { MessageSid: sid, MessageStatus: status };return { key: receiptKey(receipt), data: { receipt, receivedAt: 1793035880000 } };};
  const db = { runtimeStore: { findMany: async ({ where }) => {
    assert.ok(where.key.in.includes(receiptKey({MessageSid:customerSid, MessageStatus:'delivered'})));
    return [row(customerSid, 'delivered'), row(customerSid, 'sent'), row(ownerSid, 'failed'), { ...row(ownerSid, 'delivered'), key: 'wrong-key' }];
  } } };
  const [call] = await enrichNotificationEvidence(db, [{ toolCallSummary: summary(result()) }]);
  assert.equal(call.notificationEvidence.customer.state, 'delivered');
  assert.equal(call.notificationEvidence.owner.state, 'failed');
  assert.equal(call.notificationEvidence.customer.receiptAt, '2026-10-26T17:31:20.000Z');
  assert.equal(JSON.stringify(call.notificationEvidence).includes(customerSid), false);
});
test('receipt database failure leaves delivery unconfirmed without issuing any provider request', async () => {
  const [call] = await enrichNotificationEvidence({runtimeStore:{findMany:async()=>{throw Error('offline');}}}, [{toolCallSummary:summary(result())}]);
  assert.equal(call.notificationEvidence.owner.state, 'accepted');
  assert.equal(call.notificationEvidence.owner.delivered, false);
  assert.equal(call.notificationEvidence.owner.receiptsAvailable, false);
});
test('partial success, unknown send outcomes and owner-disabled policy stay distinct', () => {
  const r = result();r.customer = parseToolResult({customer:{attempted:true,sent:false,status:'transport_error'}}).customer;
  assert.equal(notificationEvidence(summary(r)).customer.state, 'unconfirmed');
  r.owner = parseToolResult({owner:{attempted:false,sent:false,skipped:true,status:'disabled_by_policy'}}).owner;
  assert.equal(notificationEvidence(summary(r)).submission, 'owner_notification_disabled');
});
test('sparse out-of-order tool history cannot erase a known rejection or inflate invocation counts', () => {
  const rejected = {name:'send_call_summaries_test',toolCallId:'notify-1',...parseToolResult('Tool call rejected based on configured rejection plan')};
  const existing=summary(rejected);
  const sparse={count:1,countIsExact:true,toolCallIds:['end-1'],toolNames:['endCall'],results:[{name:'endCall',toolCallId:'end-1',...parseToolResult('Success.')}]};
  const merged=mergeToolSummaries(existing,sparse);
  assert.equal(merged.count,2);assert.equal(merged.results.length,2);
  assert.equal(notificationEvidence(merged).rejectedBeforeExecution,true);
  assert.equal(mergeToolSummaries(merged,existing).count,2);
});
