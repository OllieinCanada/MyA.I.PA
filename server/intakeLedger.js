const crypto = require('node:crypto');
const { runProvisioningStep } = require('./provisioningState');
const LIMITS = { callerName: 120, callbackNumber: 40, serviceAddress: 500, requestedDate: 180, jobDetails: 1000 };
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const problem = (code, statusCode = 409) => Object.assign(new Error('Confirmed intake could not be accepted safely.'), { code, statusCode });
function normalizeDecision(input) {
  const { businessId, callId, eventId, expectedVersion } = input || {};
  if (![businessId, callId, eventId].every(v => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,180}$/.test(v)) || !callId.startsWith('staging-')) throw problem('INTAKE_STAGING_ID_REQUIRED', 400);
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) throw problem('INTAKE_VERSION_REQUIRED', 400);
  const finalize = input.finalize === true;
  if (!Array.isArray(input.operations) || (!input.operations.length && !finalize) || input.operations.length > 5) throw problem('INTAKE_OPERATIONS_INVALID', 400);
  const seen = new Set();
  const operations = input.operations.map(op => {
    if (!op || !Object.hasOwn(LIMITS, op.field) || seen.has(op.field) || !['write', 'update', 'ignore', 'retain'].includes(op.action)) throw problem('INTAKE_OPERATION_INVALID', 400);
    seen.add(op.field);
    if (['ignore', 'retain'].includes(op.action)) return { field: op.field, action: op.action };
    if (op.confirmed !== true || input.callerConfirmed !== true || !(op.value === null || typeof op.value === 'string')
      || (typeof op.value === 'string' && (!op.value.trim() || op.value.length > LIMITS[op.field]))) throw problem('INTAKE_CONFIRMATION_REQUIRED', 400);
    const value = op.value === null ? null : op.value.trim();
    if (op.field === 'callbackNumber' && value !== null && !/^\+[1-9]\d{7,14}$/.test(value)) throw problem('INTAKE_PHONE_INVALID', 400);
    return { field: op.field, action: op.action, confirmed: true, value };
  }).sort((a, b) => a.field.localeCompare(b.field));
  if (finalize && input.callerConfirmed !== true) throw problem('INTAKE_CONFIRMATION_REQUIRED', 400);
  return { businessId, callId, eventId, expectedVersion, operations, finalize };
}
function ledgerKey(businessId, callId) { return 'staging:intake-ledger:v1:' + hash(JSON.stringify([businessId, callId])); }
async function applyIntakeDecision({ prisma, input, trusted }) {
  const decision = normalizeDecision(input);
  if (trusted?.businessId !== Number(decision.businessId) || trusted.callId !== decision.callId || !Number.isSafeInteger(trusted.callDbId)) throw problem('INTAKE_SCOPE_MISMATCH', 403);
  const key = ledgerKey(decision.businessId, decision.callId), fingerprint = hash(JSON.stringify(decision));
  if (!prisma?.runtimeStore || !prisma.$transaction) throw problem('INTAKE_STORE_UNAVAILABLE', 503);
  return prisma.$transaction(async tx => {
    if (!tx.$queryRaw) throw problem('INTAKE_DATABASE_LOCK_REQUIRED', 503);
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))::text AS lock_result`;
    const call = await tx.call.findUnique({ where: { id: trusted.callDbId } });
    if (!call || call.businessId !== trusted.businessId || call.externalId !== trusted.providerCallId || call.externalProvider !== 'vapi-staging-ledger') throw problem('INTAKE_CALL_SCOPE_MISMATCH', 403);
    const row = await tx.runtimeStore.findUnique({ where: { key } });
    const state = row?.data || { schemaVersion: 1, version: 0, values: {}, receipts: [], finalized: false };
    if (state.schemaVersion !== 1 || !Array.isArray(state.receipts)) throw problem('INTAKE_SCHEMA_UNSUPPORTED');
    const receipt = state.receipts.find(r => r.eventId === decision.eventId);
    if (receipt) {
      if (receipt.fingerprint !== fingerprint) throw problem('INTAKE_EVENT_CONFLICT');
      return { duplicate: true, acceptedVersion: receipt.version, version: state.version, values: state.values, finalized: state.finalized, leadId: state.leadId || null, outboxKey: state.outboxKey || null };
    }
    if (state.finalized) throw problem('INTAKE_FINALIZED_RECONCILIATION_REQUIRED');
    if (state.version !== decision.expectedVersion) throw problem('INTAKE_VERSION_CONFLICT');
    if (state.receipts.length >= 100) throw problem('INTAKE_CAPACITY_REACHED');
    const values = { ...state.values };
    for (const op of decision.operations) {
      if (['ignore', 'retain'].includes(op.action)) continue;
      if (op.action === 'write' && Object.hasOwn(values, op.field)) throw problem('INTAKE_FIELD_EXISTS');
      if (op.action === 'update' && !Object.hasOwn(values, op.field)) throw problem('INTAKE_FIELD_MISSING');
      if (op.value === null) delete values[op.field]; else values[op.field] = op.value;
    }
    const version = state.version + 1;
    let leadId = null, outboxKey = null;
    if (decision.finalize) {
      if (!values.callbackNumber) throw problem('INTAKE_CONFIRMED_CALLBACK_REQUIRED');
      const summary = [values.jobDetails, values.serviceAddress && 'Address: ' + values.serviceAddress,
        values.requestedDate && 'Requested date: ' + values.requestedDate].filter(Boolean).join('\n') || 'Confirmed intake received';
      const fields = { businessId: call.businessId, callerId: call.callerId, name: values.callerName || 'Not provided', callbackNumber: values.callbackNumber, summary };
      const existingLead = await tx.lead.findUnique({ where: { callId: call.id } });
      if (existingLead && existingLead.businessId !== call.businessId) throw problem('INTAKE_LEAD_SCOPE_MISMATCH', 403);
      const lead = await tx.lead.upsert({ where: { callId: call.id }, create: { ...fields, callId: call.id, intent: 'GENERAL', urgency: 'MEDIUM' }, update: fields });
      leadId = lead.id; outboxKey = 'staging:intake-outbox:v1:' + hash(key);
      const data = { schemaVersion: 1, status: 'pending', businessId: call.businessId, callDbId: call.id,
        assistantId: trusted.assistantId || '',
        ledgerKey: key, ledgerVersion: version, leadId, purpose: 'owner-intake', values,
        sourceEventId: 'staging-intake:' + hash(key), createdAt: new Date().toISOString() };
      await tx.runtimeStore.upsert({ where: { key: outboxKey }, create: { key: outboxKey, data }, update: { data } });
    }
    const data = { schemaVersion: 1, version, values, finalized: decision.finalize, leadId, outboxKey,
      updatedAt: new Date().toISOString(), receipts: [...state.receipts, { eventId: decision.eventId, fingerprint, version }] };
    await tx.runtimeStore.upsert({ where: { key }, create: { key, data }, update: { data } });
    return { duplicate: false, acceptedVersion: version, version, values, finalized: decision.finalize, leadId, outboxKey };
  }, { maxWait: 5000, timeout: 10000 });
}
async function dispatchStagingIntakeNotification({ prisma, key, sendHandoff }) {
  if (!/^staging:intake-outbox:v1:[a-f0-9]{64}$/.test(key || '') || typeof sendHandoff !== 'function') throw problem('INTAKE_OUTBOX_REQUIRED', 400);
  const row = await prisma.runtimeStore.findUnique({ where: { key } });
  const item = row?.data;
  if (!item || item.schemaVersion !== 1) throw problem('INTAKE_OUTBOX_MISSING');
  const ledger = (await prisma.runtimeStore.findUnique({ where: { key: item.ledgerKey } }))?.data;
  if (!ledger?.finalized || ledger.version !== item.ledgerVersion || ledger.leadId !== item.leadId || JSON.stringify(ledger.values) !== JSON.stringify(item.values)) throw problem('INTAKE_OUTBOX_STALE');
  // Reuse the guarded text-dispatch kind. Unknown outcomes require reconciliation,
  // unlike an unguarded new provisioning kind which could retry a provider send.
  const result = await runProvisioningStep({ prisma, kind: 'signup-sms', idempotencyKey: 'staging-intake:' + hash(key),
    contextHash: hash(JSON.stringify([item.businessId, item.callDbId, item.ledgerVersion, item.values])),
    execute: async () => {
      const accepted = await sendHandoff(item);
      if (!accepted || accepted.error || accepted.status !== 'SENT') throw problem('INTAKE_HANDOFF_UNCONFIRMED', 503);
      return accepted;
    } });
  await prisma.runtimeStore.upsert({ where: { key }, create: { key, data: { ...item, status: 'submitted', result } },
    update: { data: { ...item, status: 'submitted', result } } });
  return result;
}
module.exports = { normalizeDecision, ledgerKey, applyIntakeDecision, dispatchStagingIntakeNotification };
