const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { normalizeSignupProvisioningPayload, buildProvisioningResourceName } = require('../../server/signupProvisioning');
const { buildMakeSignupEventKey } = require('../../server/makeSignupWebhook');
const { contextStoreKey } = require('../../server/signupProvisioningContext');
const { provisioningStateKey } = require('../../server/provisioningState');
const { signupBusinessKey } = require('../../server/signupBusinessIdentity');
const { createBoundedMappingLease, createBoundedMappingEvidenceReader } = require('../../server/boundedBusinessMappingAdapters');
function stable(x) { if (x instanceof Date) return x.toISOString(); if (Array.isArray(x)) return x.map(stable);
  return x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map(k => [k, stable(x[k])])) : x; }
const digest = x => crypto.createHash('sha256').update(JSON.stringify(stable(x))).digest('hex');
function createFixture(directory, { unreconciled = false } = {}) {
  const { createAssociationFence, atomicCommitAssociationFile } = require('../../server/signupAssociationRepair');
  const { createBoundedBusinessMappingWriter } = require('../../server/boundedBusinessMappingWriter');
  const secret = 'synthetic-integration-signing-secret', raw = { event: 'signup.completed', business: { name: 'Synthetic Integration Electrical' },
    owner: { email: 'fixture@example.invalid', phone: '+19055550123' }, verification: { smsVerified: true } };
  const payload = normalizeSignupProvisioningPayload(raw, { signingSecret: secret });
  const policy = { businessId: 7, release: 'a'.repeat(40), sourceId: buildMakeSignupEventKey(raw), phantomId: buildMakeSignupEventKey(payload),
    number: '+19055550124', twilioSid: 'PN' + 'b'.repeat(32), phoneId: '11111111-1111-4111-8111-111111111111', assistantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    preservedMappings: [
      { id: 24991, businessId: 7, matchType: 'phoneNumber', matchValue: '+19055550125' },
      { id: 24992, businessId: 7, matchType: 'phoneNumberId', matchValue: '33333333-3333-4333-8333-333333333333' },
      { id: 24993, businessId: 7, matchType: 'assistantId', matchValue: '44444444-4444-4444-8444-444444444444' },
    ] };
  const values = { twilioPhoneNumber: policy.number, vapiPhoneNumberId: policy.phoneId, vapiAssistantId: policy.assistantId };
  const repairId = digest({ ids: [policy.sourceId, policy.phantomId], contextHash: payload.provisioning.contextHash, values });
  const history = { signupAttemptId: policy.phantomId, ...values, status: 'setup_started', unknownHistoricalField: { keep: true } };
  const mark = { id: repairId, sourceId: policy.sourceId, phantomId: policy.phantomId, values };
  const source = { signupAttemptId: policy.sourceId, businessName: raw.business.name, ownerEmail: raw.owner.email, ownerPhone: raw.owner.phone,
    ...values, smsVerified: true, status: 'setup_error', agentTestStatus: 'failed', subscriptionStatus: 'unpaid', resourceAssociationRepair: mark };
  const phantom = { signupAttemptId: policy.phantomId, status: 'superseded_duplicate', canonicalSignupAttemptId: policy.sourceId,
    resourceAssociationRepair: { ...mark, history } };
  if (unreconciled) {
    delete source.resourceAssociationRepair; for(const key of Object.keys(values))delete source[key];
    Object.assign(phantom, history); delete phantom.resourceAssociationRepair; delete phantom.canonicalSignupAttemptId;
  }
  const file = path.join(directory, 'synthetic-dashboard.json'); fs.writeFileSync(file, JSON.stringify({ source, phantom }), { mode: 0o600 });
  const readStore = () => JSON.parse(fs.readFileSync(file, 'utf8')), fence = createAssociationFence();
  const context = { signupEventKey: policy.sourceId, idempotencyKey: payload.provisioning.idempotencyKey, contextHash: payload.provisioning.contextHash, payload };
  const identity = signupBusinessKey(source), contextKey = contextStoreKey(identity), records = new Map([[contextKey, context],
    ['signup-association-repair:v1:' + repairId, { phase: 'completed', repairId, historyDigest: digest(history) }],
    ['signup-business:' + identity, { businessId: 7, businessKey: identity }]]);
  const results = { 'twilio-number': { twilioPhoneNumber: policy.number, sid: policy.twilioSid }, 'vapi-assistant': { assistantId: policy.assistantId },
    'vapi-import': { id: policy.phoneId, number: policy.number, assistantId: policy.assistantId } };
  for (const [kind, result] of Object.entries(results)) records.set(provisioningStateKey(kind, identity), { status: 'completed', contextHash: context.contextHash, result });
  if(unreconciled)records.delete('signup-association-repair:v1:'+repairId);
  const snapshot = { complete: true, release: policy.release, checkedAt: new Date().toISOString(), scope: { ...policy },
    provider: { twilio: { sid: policy.twilioSid, number: policy.number, name: buildProvisioningResourceName('twilio-number', identity) },
      phone: { id: policy.phoneId, number: policy.number, assistantId: policy.assistantId }, assistant: { id: policy.assistantId } },
    reserveNumbers: Array.from({ length: 5 }, (_, i) => '+1905555013' + i) };
  const lease = createBoundedMappingLease({ fence, readStore, policy, singleProcess: () => true });
  const reader = createBoundedMappingEvidenceReader({ readStore, getProviderSnapshot: () => snapshot, getSigningSecret: () => secret, getRelease: () => policy.release });
  return { policy, source, phantom, file, readStore, fence, reader, lease, context, contextKey, records, snapshot,
    receiptKey: provisioningStateKey('vapi-import', identity), registryKey:'signup-business:'+identity,
    journalKey:'signup-association-repair:v1:'+repairId, actor: 'c'.repeat(64),
    writeStore(project) { return atomicCommitAssociationFile(file, current => { const before = structuredClone(current), next = project(current); fence.check(before, next); return next; }); },
    writer(prisma, overrides = () => '') { return createBoundedBusinessMappingWriter({ prisma, policy, readEvidence: reader, readOverrides: overrides,
      withAssociationLease: lease, enabled: () => true, singleWriter: () => true }); },
    attemptData: { eventKey: policy.sourceId, publicId: crypto.randomUUID(), statusTokenHash: 'd'.repeat(64), businessName: source.businessName,
      ownerEmail: source.ownerEmail, ownerPhone: source.ownerPhone, payload: raw, status: 'setup_error', assignedPhone: unreconciled ? null : policy.number,
      vapiPhoneNumberId: unreconciled ? null : policy.phoneId, vapiAssistantId: unreconciled ? null : policy.assistantId, expiresAt: new Date('2030-01-01T00:00:00Z') },
  };
}
function instrument(prisma, { onCreate, afterCommit } = {}) {
  return { async $transaction(fn, options) {
    let creates = 0;
    const result = await prisma.$transaction(tx => fn({ business: tx.business, signupAttempt: tx.signupAttempt, runtimeStore: tx.runtimeStore,
      $queryRaw: (...args) => tx.$queryRaw(...args), $executeRaw: (...args) => tx.$executeRaw(...args),
      vapiBusinessMapping: { findMany: (...args) => tx.vapiBusinessMapping.findMany(...args), create: async (...args) => {
        const row = await tx.vapiBusinessMapping.create(...args); creates++; await onCreate?.({ tx, index: creates }); return row;
      } },
    }), options);
    await afterCommit?.({ creates }); return result;
  } };
}
module.exports = { createFixture, instrument, digest };
