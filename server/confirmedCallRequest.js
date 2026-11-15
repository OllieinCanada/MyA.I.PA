'use strict';
// Database-only bridge. Never imports a provider, sends a notification or replays one.
const crypto = require('node:crypto');
const { buildOwnerBody } = require('./compositeCallNotifications');
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = suffix => Object.assign(new Error('Confirmed request requires inspection.'), { code: 'notification_request_' + suffix });
const keyFor = callId => 'confirmed-call-request:v1:' + hash(callId);
const phone = value => /^\+[1-9]\d{7,14}$/.test(value || '');

function requestFields(args, context, call) {
  if (!Number.isSafeInteger(context?.businessId) || context.businessId <= 0
    || context.eligible !== true || context.assistantId !== call?.assistantId
    || context.phoneNumberId !== call?.phoneNumberId || !context.businessName
    || !/^[a-zA-Z0-9][a-zA-Z0-9:_-]{1,179}$/.test(call?.id || '') || !phone(call?.customer?.number)) throw fail('scope_invalid');
  const work = ['installation','new installation','new_installation','service','repair','maintenance','quote'].includes(args.requestType);
  if (typeof args.pricingDiscussed !== 'boolean' || !String(args.name || '').trim()
    || args.requestType === 'message' && !String(args.message || '').trim()
    || work && args.safetyConcern !== 'reported_hazard' && (args.workDetailsConfirmed !== true
      || ['jobDetails','streetAddress','city','preferredStartDate','bestCallbackTime'].some(k => !String(args[k] || '').trim()))) throw fail('intake_incomplete');
  // Same server-owned business/caller bindings as the existing text workflow.
  return { name: String(args.name).trim().slice(0,120), callbackNumber: call.customer.number,
    summary: buildOwnerBody({ ...args, businessName: context.businessName, rawPhoneNumber: call.customer.number,
      ...(context.pricingOptions || {}) }), intent: 'GENERAL', urgency: 'MEDIUM' };
}
async function transaction(prisma, callId, work) {
  if (!prisma?.runtimeStore || !prisma?.$transaction) throw fail('store_unavailable');
  return prisma.$transaction(async tx => {
    if (!tx.$queryRaw || !tx.call || !tx.lead) throw fail('store_unavailable');
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${keyFor(callId)}))::text`;
    // Coordinate with ordinary canonical-call updates, not only this bridge.
    await tx.$queryRaw`SELECT id FROM "Call" WHERE "externalProvider" = 'vapi' AND "externalId" = ${callId} FOR UPDATE`;
    return work(tx);
  }, { maxWait: 500, timeout: 3000 });
}
async function canonicalCall(tx, callId, businessId, callbackHash) {
  const call = await tx.call.findUnique({ where: { externalProvider_externalId: { externalProvider: 'vapi', externalId: callId } }, include: { caller: true } });
  if (call && (call.externalProvider !== 'vapi' || call.externalId !== callId || call.businessId !== businessId
    || !Number.isSafeInteger(call.id) || call.callerId !== call.caller?.id || !phone(call.caller?.phone)
    || hash(call.caller.phone) !== callbackHash)) throw fail('call_conflict');
  return call;
}
async function link(tx, key, row, call) {
  if (!call && row.status === 'linked') throw fail('linked_call_changed');
  if (!call) return { state: 'pending_call', requestSaved: true, leadSaved: false };
  const existing = await tx.lead.findUnique({ where: { callId: call.id } });
  if (row.status === 'linked') {
    // A deleted/changed lead is an inspection case, never a resurrection.
    if (!existing || existing.id !== row.leadId || existing.businessId !== row.businessId
      || existing.callerId !== call.callerId) throw fail('linked_lead_changed');
    return { state: 'linked', requestSaved: true, leadSaved: true, leadId: existing.id };
  }
  if (row.status !== 'pending_call' || !row.fields) throw fail('receipt_invalid');
  if (row.fingerprint !== hash([row.businessId, row.callId, row.assistantId, row.phoneNumberId, row.routeHash, row.fields])
    || !phone(row.fields.callbackNumber) || row.callbackHash !== hash(row.fields.callbackNumber)) throw fail('receipt_invalid');
  if (existing) throw fail('unowned_lead_conflict');
  const lead = await tx.lead.create({ data: { ...row.fields, businessId: row.businessId, callerId: call.callerId, callId: call.id } });
  // Keep only binding/receipt information once the request is in its normal lead store.
  const { fields, ...receipt } = row;
  await tx.runtimeStore.update({ where: { key }, data: { data: { ...receipt, status: 'linked', leadId: lead.id } } });
  return { state: 'linked', requestSaved: true, leadSaved: true, leadId: lead.id };
}
async function captureConfirmedRequest({ prisma, call, context, args, authorization, assertFresh }) {
  const fields = requestFields(args, context, call), key = keyFor(call.id);
  if (typeof assertFresh !== 'function' || authorization?.source !== 'authenticated_vapi_conversation'
    || !Number.isSafeInteger(authorization.providerTimestamp)
    || Date.now() - authorization.providerTimestamp > 60000 || authorization.providerTimestamp - Date.now() > 5000
    || !['conversationHash','toolCallHash'].every(k => /^[a-f0-9]{64}$/.test(authorization[k] || ''))) throw fail('authorization_required');
  const routeHash = hash(context);
  const fingerprint = hash([context.businessId, call.id, context.assistantId, context.phoneNumberId, routeHash, fields]);
  return transaction(prisma, call.id, async tx => {
    await assertFresh(); // Recheck after waiting for both locks.
    const stored = await tx.runtimeStore.findUnique({ where: { key } });
    const row = stored?.data;
    if (row && (row.version !== 1 || row.businessId !== context.businessId || row.callId !== call.id
      || row.fingerprint !== fingerprint || row.callbackHash !== hash(fields.callbackNumber))) throw fail('context_conflict');
    const savedCall = await canonicalCall(tx, call.id, context.businessId, hash(fields.callbackNumber));
    if (!row && savedCall && (savedCall.status !== 'STARTED'
      && (!savedCall.endedAt || new Date(savedCall.endedAt).getTime() < authorization.providerTimestamp - 5000))) throw fail('historical_call_refused');
    await assertFresh();
    if (row) { const result = await link(tx, key, row, savedCall); await assertFresh(); return result; }
    const data = { version: 1, status: 'pending_call', businessId: context.businessId, callId: call.id,
      assistantId: context.assistantId, phoneNumberId: context.phoneNumberId,
      callbackHash: hash(fields.callbackNumber), routeHash, fingerprint, fields, authorization };
    await tx.runtimeStore.create({ data: { key, data } });
    const result = await link(tx, key, data, savedCall);
    await assertFresh();
    return result;
  });
}
async function reconcileConfirmedRequest({ prisma, callId }) {
  // No historical backfill and no extra locked transaction for ordinary calls.
  if (!prisma?.runtimeStore) throw fail('store_unavailable');
  if (!await prisma.runtimeStore.findUnique({ where: { key: keyFor(callId) }, select: { key: true } }))
    return { state: 'no_confirmed_request', requestSaved: false, leadSaved: false };
  return transaction(prisma, callId, async tx => {
    const key = keyFor(callId), row = (await tx.runtimeStore.findUnique({ where: { key } }))?.data;
    // Existing historical calls have no newly authorized request. Do not backfill them.
    if (!row) return { state: 'no_confirmed_request', requestSaved: false, leadSaved: false };
    if (row.version !== 1 || row.callId !== callId || !Number.isSafeInteger(row.businessId)
      || !/^[a-f0-9]{64}$/.test(row.callbackHash || '') || row.authorization?.source !== 'authenticated_vapi_conversation') throw fail('receipt_invalid');
    return link(tx, key, row, await canonicalCall(tx, callId, row.businessId, row.callbackHash));
  });
}
module.exports = { captureConfirmedRequest, reconcileConfirmedRequest, requestFields, keyFor };
