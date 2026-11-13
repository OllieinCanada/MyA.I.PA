// Local adapter preparation only. Not registered with the application, transport,
// environment or production Prisma client. Depends on the shared PR235 fence.
const crypto = require('node:crypto');
const { signupBusinessKey } = require('./signupBusinessIdentity');
const { contextStoreKey, registeredSignupEventKey } = require('./signupProvisioningContext');
const { readProvisioningStep } = require('./provisioningState');
const { buildMakeSignupEventKey } = require('./makeSignupWebhook');
const { verifySignupProvisioningAuthorization } = require('./signupProvisioning');
const fail = code => { throw Object.assign(new Error(code), { code }); };
function stable(x) {
  if (x instanceof Date) return x.toISOString();
  if (Array.isArray(x)) return x.map(stable);
  return x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map(k => [k, stable(x[k])])) : x;
}
const digest = x => crypto.createHash('sha256').update(JSON.stringify(stable(x))).digest('hex');
const copy = x => structuredClone(x);
const selected = (store, ids) => Object.values(store).filter(r => ids.includes(r?.signupAttemptId));

function createBoundedMappingLease({ fence, readStore, policy, singleProcess = () => false }) {
  const ids = [policy.sourceId, policy.phantomId];
  if (!fence || !['hold', 'release', 'check', 'withRemovalGuard'].every(k => typeof fence[k] === 'function')) fail('MAPPING_FENCE_REQUIRED');
  return async (requested, operation) => {
    if (!singleProcess() || digest(requested) !== digest(ids)) fail('MAPPING_LIFECYCLE_SCOPE_REQUIRED');
    // PR235 hold participates in dashboard writes, repair and removal reservations.
    // Do not release if hold throws: that reservation belongs to another caller.
    fence.hold(ids);
    let active = true;
    try {
      const before = selected(readStore(), ids);
      if (ids.some(id => before.filter(r => r.signupAttemptId === id).length !== 1)) fail('MAPPING_EXACT_RECORDS_REQUIRED');
      const version = digest(before);
      return await operation({ assertHeld() {
        if (!active || digest(selected(readStore(), ids)) !== version) fail('MAPPING_LIFECYCLE_EVIDENCE_CHANGED');
      } });
    } finally { active = false; fence.release(ids); }
  };
}

function createBoundedMappingEvidenceReader({ readStore, getProviderSnapshot, getSigningSecret, getRelease, now = () => Date.now() }) {
  return async (tx, p) => {
    const rows = copy(selected(readStore(), [p.sourceId, p.phantomId]));
    if ([p.sourceId, p.phantomId].some(id => rows.filter(r => r.signupAttemptId === id).length !== 1)) fail('MAPPING_EXACT_RECORDS_REQUIRED');
    const source = rows.find(r => r.signupAttemptId === p.sourceId), phantom = rows.find(r => r.signupAttemptId === p.phantomId);
    // The unpublished adapter must use the writer's same transaction. Protect
    // competing attempt inserts/assignment changes, not just today's matches.
    // This lock is preparation for rare record-only correction, not a hot path.
    await tx.$executeRaw`LOCK TABLE "SignupAttempt" IN SHARE MODE`;
    const [sourceAttempt, phantomAttempt, otherAttempts] = await Promise.all([
      tx.signupAttempt.findUnique({ where: { eventKey: p.sourceId } }),
      tx.signupAttempt.findUnique({ where: { eventKey: p.phantomId }, select: { eventKey: true } }),
      tx.signupAttempt.findMany({ where: { eventKey: { notIn: [p.sourceId, p.phantomId] }, OR: [
        { assignedPhone: p.number }, { vapiAssistantId: p.assistantId }, { vapiPhoneNumberId: p.phoneId },
      ] }, select: { eventKey: true } }),
    ]);
    const identity = signupBusinessKey(sourceAttempt || {});
    if (!identity || phantomAttempt || !Array.isArray(otherAttempts) || otherAttempts.length) fail('MAPPING_IDENTITY_UNPROVEN');
    const contextKey = contextStoreKey(identity);
    await tx.$queryRaw`SELECT key FROM "RuntimeStore" WHERE key = ${contextKey} FOR SHARE`;
    const context = (await tx.runtimeStore.findUnique({ where: { key: contextKey } }))?.data;
    const secret = getSigningSecret();
    if (typeof secret !== 'string' || !secret) fail('MAPPING_SIGNING_SECRET_REQUIRED');
    if (!context?.payload || registeredSignupEventKey(context) !== p.sourceId || buildMakeSignupEventKey(context.payload) !== p.phantomId
      || !verifySignupProvisioningAuthorization(context.payload, secret)) fail('MAPPING_CONTEXT_SIGNATURE_INVALID');
    const values = { twilioPhoneNumber: p.number, vapiPhoneNumberId: p.phoneId, vapiAssistantId: p.assistantId };
    const repairId = digest({ ids: [p.sourceId, p.phantomId], contextHash: context.contextHash, values });
    const keys = ['signup-association-repair:v1:' + repairId, 'signup-business:' + identity,
      ...['twilio-number', 'vapi-assistant', 'vapi-import'].map(kind => require('./provisioningState').provisioningStateKey(kind, identity))].sort();
    for (const key of keys) await tx.$queryRaw`SELECT key FROM "RuntimeStore" WHERE key = ${key} FOR SHARE`;
    const [association, registry, ...stages] = await Promise.all([
      tx.runtimeStore.findUnique({ where: { key: 'signup-association-repair:v1:' + repairId } }),
      tx.runtimeStore.findUnique({ where: { key: 'signup-business:' + identity } }),
      ...['twilio-number', 'vapi-assistant', 'vapi-import'].map(kind => readProvisioningStep({ prisma: tx, kind, idempotencyKey: identity })),
    ]);
    // This callback must return an already-read trusted snapshot, never perform
    // network IO inside the database transaction or stamp old proof with new time.
    const snapshot = getProviderSnapshot();
    const age = now() - Date.parse(snapshot?.checkedAt);
    const scopeKeys = ['businessId', 'sourceId', 'phantomId', 'number', 'twilioSid', 'phoneId', 'assistantId'];
    if (snapshot?.complete !== true || !Number.isFinite(age) || age < 0 || age > 300000
      || scopeKeys.some(k => snapshot.scope?.[k] !== p[k]) || snapshot.release !== getRelease() || snapshot.release !== p.release) fail('MAPPING_PROVIDER_SNAPSHOT_UNPROVEN');
    const store = readStore();
    if (digest(selected(store, [p.sourceId, p.phantomId])) !== digest(rows)) fail('MAPPING_LIFECYCLE_EVIDENCE_CHANGED');
    return copy({ source, phantom, sourceAttempt, phantomAttempt, otherAttempts, context,
      signatureVerified: true, associationJournal: association?.data || null, registry: registry?.data || null,
      receipts: Object.fromEntries(['twilio-number', 'vapi-assistant', 'vapi-import'].map((k, i) => [k, stages[i].data])),
      provider: snapshot.provider, reserveNumbers: snapshot.reserveNumbers,
      otherAssociations: Object.values(store).filter(r => ![p.sourceId, p.phantomId].includes(r?.signupAttemptId)
        && Object.keys(values).some(k => r?.[k] && r[k] === values[k])).map(r => ({ signupAttemptId: r.signupAttemptId })),
      // A stable proof-capture time, not a manufactured provider refresh. DB/file
      // values are freshly read each call and their entire content is digested.
      checkedAt: snapshot.checkedAt, providerCheckedAt: snapshot.checkedAt, release: snapshot.release,
    });
  };
}
module.exports = { createBoundedMappingLease, createBoundedMappingEvidenceReader };
