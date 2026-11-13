// Preparation-only primitive: no application registration, Prisma construction,
// network transport, environment loading, CLI, automatic retry or rollback apply.
const crypto = require('node:crypto');
const { signupBusinessKey, isClosedSignup } = require('./signupBusinessIdentity');
const { registeredSignupEventKey } = require('./signupProvisioningContext');
const { buildMakeSignupEventKey } = require('./makeSignupWebhook');
const { buildProvisioningResourceName } = require('./signupProvisioning');
const { normalizeNorthAmericanE164 } = require('./canadianPhoneNumber');

const PREFIX = 'bounded-business-mapping:v1:';
const fail = code => { throw Object.assign(new Error(code), { code }); };
function stable(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])]));
  return value;
}
const digest = value => crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
const sorted = rows => [...rows].sort((a, b) => a.id - b.id);
const valuesFor = p => ({ twilioPhoneNumber: p.number, vapiPhoneNumberId: p.phoneId, vapiAssistantId: p.assistantId });
const expectedRows = p => [
  { businessId: p.businessId, matchType: 'phoneNumber', matchValue: p.number },
  { businessId: p.businessId, matchType: 'phoneNumberId', matchValue: p.phoneId },
  { businessId: p.businessId, matchType: 'assistantId', matchValue: p.assistantId },
];

function validatePolicy(p) {
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
  if (!Number.isSafeInteger(p.businessId) || p.businessId < 1 || !/^\+1[2-9]\d{9}$/.test(p.number || '')
    || !/^PN[a-f0-9]{32}$/i.test(p.twilioSid || '') || !/^[a-f0-9]{40}$/.test(p.release || '')
    || ![p.sourceId, p.phantomId].every(id => /^signup_[a-f0-9]{32}$/.test(id)) || p.sourceId === p.phantomId
    || ![p.phoneId, p.assistantId].every(id => uuid.test(id)) || p.phoneId === p.assistantId
    || !Array.isArray(p.preservedMappings) || p.preservedMappings.length !== 3
    || new Set(p.preservedMappings.map(r => r.id)).size !== 3
    || p.preservedMappings.some(r => !Number.isSafeInteger(r.id) || r.businessId !== p.businessId || !r.matchValue || !r.matchType)) fail('MAPPING_SCOPE_INVALID');
}

// Return only relevant route evidence, never the complete environment map.
function assessTargetOverrides(raw, policy) {
  const keys = [policy.assistantId, policy.phoneId, policy.number, policy.number.slice(1), policy.number.slice(2), String(policy.businessId)];
  let entries;
  try {
    const parsed = String(raw || '').trim() ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error();
    entries = Object.entries(parsed).map(([k, v]) => [k.trim().toLowerCase(), v]);
  } catch { return { valid: false, targets: [], conflict: true }; }
  const targets = keys.map(key => {
    const matches = entries.filter(([k]) => k === key);
    const ids = matches.map(([, v]) => Number(v));
    // More conservative than runtime's last-write-wins for duplicate canonical keys.
    return { key, present: matches.length > 0, businessIds: ids.filter(Number.isSafeInteger),
      conflict: matches.length > 1 || ids.some(id => !Number.isSafeInteger(id) || id !== policy.businessId) };
  });
  return { valid: true, targets, conflict: targets.some(t => t.conflict) };
}

function validateEvidence(p, e, business, overrides, now) {
  const age = now - Date.parse(e?.checkedAt);
  const providerAge = now - Date.parse(e?.providerCheckedAt);
  if (!Number.isFinite(age) || age < 0 || age > 300000 || !Number.isFinite(providerAge) || providerAge < 0
    || providerAge > 300000 || e.release !== p.release) fail('MAPPING_EVIDENCE_STALE');
  if (!overrides.valid || overrides.conflict) fail('MAPPING_OVERRIDE_CONFLICT');
  const { source, phantom, sourceAttempt: attempt, context, receipts, provider, associationJournal } = e;
  const vals = valuesFor(p), ids = [p.sourceId, p.phantomId];
  const identity = signupBusinessKey(source || {});
  if (!identity || source?.signupAttemptId !== p.sourceId || phantom?.signupAttemptId !== p.phantomId
    || attempt?.eventKey !== p.sourceId || registeredSignupEventKey(context) !== p.sourceId
    || buildMakeSignupEventKey(attempt?.payload || {}) !== p.sourceId
    || buildMakeSignupEventKey(context?.payload || {}) !== p.phantomId
    || identity !== signupBusinessKey(attempt) || identity !== signupBusinessKey(context.payload)
    || isClosedSignup(source) || isClosedSignup(attempt) || e.signatureVerified !== true
    || context.idempotencyKey !== identity || context.payload?.provisioning?.idempotencyKey !== identity
    || !/^[a-f0-9]{64}$/.test(context.contextHash || '') || context.contextHash !== context.payload?.provisioning?.contextHash
    || !(source.smsVerified || source.emailVerified)
    || !(attempt.payload?.verification?.smsVerified || attempt.payload?.verification?.emailVerified)) fail('MAPPING_IDENTITY_UNPROVEN');
  if (!business || business.id !== p.businessId || business.name !== source.businessName
    || !normalizeNorthAmericanE164(source.ownerPhone)
    || normalizeNorthAmericanE164(business.settings?.ownerPhone) !== normalizeNorthAmericanE164(source.ownerPhone)
    || normalizeNorthAmericanE164(business.phone) !== normalizeNorthAmericanE164(source.ownerPhone)
    || normalizeNorthAmericanE164(business.phone) === p.number || e.registry?.closed
    || [source.businessId, attempt.businessId].some(id => id !== undefined && id !== null && id !== p.businessId)
    || (e.registry?.businessId && e.registry.businessId !== p.businessId)) fail('MAPPING_BUSINESS_CONFLICT');
  const repairId = digest({ ids, contextHash: context.contextHash, values: vals });
  const history = phantom.resourceAssociationRepair?.history;
  if (associationJournal?.phase !== 'completed' || associationJournal.repairId !== repairId
    || source.resourceAssociationRepair?.id !== repairId || phantom.resourceAssociationRepair?.id !== repairId
    || [source, phantom].some(r => r.resourceAssociationRepair.sourceId !== p.sourceId || r.resourceAssociationRepair.phantomId !== p.phantomId
      || digest(r.resourceAssociationRepair.values) !== digest(vals))
    || phantom.status !== 'superseded_duplicate' || phantom.canonicalSignupAttemptId !== p.sourceId
    || history?.signupAttemptId !== p.phantomId || associationJournal.historyDigest !== digest(history)
    || Object.keys(vals).some(k => source[k] !== vals[k] || phantom[k] || history[k] !== vals[k])
    || attempt.assignedPhone !== p.number || attempt.vapiPhoneNumberId !== p.phoneId || attempt.vapiAssistantId !== p.assistantId
    || e.phantomAttempt !== null || !Array.isArray(e.otherAttempts) || e.otherAttempts.length
    || !Array.isArray(e.otherAssociations) || e.otherAssociations.length) fail('MAPPING_RECONCILIATION_REQUIRED');
  const stages = ['twilio-number', 'vapi-assistant', 'vapi-import'].map(k => receipts?.[k]);
  if (stages.some(r => r?.status !== 'completed' || r.contextHash !== context.contextHash || !r.result)) fail('MAPPING_RECEIPTS_UNPROVEN');
  const [tw, as, im] = stages.map(r => r.result);
  if (tw.twilioPhoneNumber !== p.number || (tw.sid || tw.twilioSid) !== p.twilioSid || as.assistantId !== p.assistantId
    || im.id !== p.phoneId || im.number !== p.number || im.assistantId !== p.assistantId
    || provider?.twilio?.sid !== p.twilioSid || provider.twilio.number !== p.number
    || provider.twilio.name !== buildProvisioningResourceName('twilio-number', identity)
    || provider.phone?.id !== p.phoneId || provider.phone.number !== p.number || provider.phone.assistantId !== p.assistantId
    || provider.assistant?.id !== p.assistantId
    || [provider.phone, provider.assistant].some(r => [r.businessId, r.metadata?.businessId].some(id => id !== undefined && id !== null && String(id) !== String(p.businessId)))
    || !Array.isArray(e.reserveNumbers) || e.reserveNumbers.length !== 5
    || new Set(e.reserveNumbers).size !== 5 || e.reserveNumbers.includes(p.number)) fail('MAPPING_RESOURCE_CONFLICT');
}

function relevantMappings(rows, p) {
  const aliases = new Set([p.phoneId, p.assistantId, p.number.replace(/\D/g, ''), p.number.slice(2)]);
  return rows.filter(r => aliases.has(String(r.matchValue).trim().toLowerCase())
    || aliases.has(String(r.matchValue).replace(/\D/g, '').replace(/^00/, '')));
}

function createBoundedBusinessMappingWriter({ prisma, policy, readEvidence, readOverrides,
  withAssociationLease, enabled = () => false, singleWriter = () => false, now = () => Date.now() }) {
  const p = clone(policy); validatePolicy(p);
  const operationId = digest(p), key = PREFIX + operationId, plans = new Map(), uncertain = new Set();
  async function leased(fn) {
    if (typeof withAssociationLease !== 'function') fail('MAPPING_LIFECYCLE_LEASE_REQUIRED');
    return withAssociationLease([p.sourceId, p.phantomId], async lease => {
      if (typeof lease?.assertHeld !== 'function') fail('MAPPING_LIFECYCLE_LEASE_REQUIRED');
      lease.assertHeld();
      return fn(lease);
    });
  }
  async function transaction(fn) {
    return prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${'signup-business-bindings:v1'}))::text AS lock_result`;
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`bounded-business:${p.businessId}`}))::text AS lock_result`;
      return fn(tx);
    }, { isolationLevel: 'Serializable', maxWait: 5000, timeout: 10000 });
  }
  async function state(tx) {
    const business = await tx.business.findUnique({ where: { id: p.businessId }, include: { settings: true } });
    const rows = sorted(await tx.vapiBusinessMapping.findMany()); // Complete, uncapped DB set, not admin projection.
    const evidence = await readEvidence(tx, p);
    const overrides = assessTargetOverrides(await readOverrides(), p);
    validateEvidence(p, evidence, business, overrides, now());
    for (const expected of p.preservedMappings) {
      const actual = rows.find(r => r.id === expected.id);
      if (!actual || Object.keys(expected).some(k => actual[k] !== expected[k])) fail('MAPPING_PRESERVED_ROW_CHANGED');
    }
    const targets = relevantMappings(rows, p), expected = expectedRows(p);
    if (targets.some(r => !expected.some(w => Object.keys(w).every(k => w[k] === r[k])))
      || (targets.length !== 0 && (targets.length !== 3 || new Set(targets.map(r => r.matchType)).size !== 3))) fail('MAPPING_TARGET_CONFLICT');
    const basis = digest({ business, evidence, overrides, rows: rows.filter(r => !targets.includes(r)) });
    return { business, rows, evidence, overrides, targets, basis };
  }
  async function prepare() {
    return leased(lease => transaction(async tx => {
      const s = await state(tx); lease.assertHeld();
      const journal = (await tx.runtimeStore.findUnique({ where: { key } }))?.data;
      if (journal || s.targets.length) fail('MAPPING_INSPECT_EXISTING_OPERATION');
      const planDigest = digest({ operationId, basis: s.basis });
      plans.set(planDigest, clone({ basis: s.basis, before: s.rows }));
      return { operationId, planDigest, action: 'add_three_mapping_rows', readinessGranted: false };
    }));
  }
  async function apply(planDigest, actorHash) {
    if (!enabled() || !singleWriter()) fail('MAPPING_APPLY_DISABLED');
    if (uncertain.has(operationId)) fail('MAPPING_UNCERTAIN_INSPECT_FIRST');
    if (!/^[a-f0-9]{64}$/.test(actorHash || '') || !plans.has(planDigest)) fail('MAPPING_PLAN_REQUIRED');
    let attempted = false;
    try {
      return await leased(lease => transaction(async tx => {
        const s = await state(tx), saved = (await tx.runtimeStore.findUnique({ where: { key } }))?.data;
        if (saved) {
          if (saved.operationId !== operationId || saved.planDigest !== planDigest || saved.basis !== s.basis
            || saved.phase !== 'completed' || digest(sorted(saved.inserted)) !== digest(sorted(s.targets))) fail('MAPPING_JOURNAL_CONFLICT');
          return { operationId, applied: true, replayed: true, readinessGranted: false };
        }
        const plan = plans.get(planDigest);
        if (s.targets.length || plan.basis !== s.basis) fail('MAPPING_CHANGED_EVIDENCE');
        lease.assertHeld();
        attempted = true;
        for (const row of expectedRows(p)) await tx.vapiBusinessMapping.create({ data: row });
        const after = sorted(await tx.vapiBusinessMapping.findMany());
        const inserted = relevantMappings(after, p);
        if (inserted.length !== 3 || digest(after.filter(r => !inserted.includes(r))) !== digest(plan.before)
          || inserted.some(r => !expectedRows(p).some(w => Object.keys(w).every(k => r[k] === w[k])))) fail('MAPPING_WRITE_READBACK_CONFLICT');
        if (digest(await readEvidence(tx, p)) !== digest(s.evidence)
          || digest(assessTargetOverrides(await readOverrides(), p)) !== digest(s.overrides)
          || digest(await tx.business.findUnique({ where: { id: p.businessId }, include: { settings: true } })) !== digest(s.business)) fail('MAPPING_CHANGED_EVIDENCE');
        lease.assertHeld();
        await tx.runtimeStore.create({ data: { key, data: clone({ operationId, phase: 'completed', planDigest,
          basis: s.basis, inserted, before: plan.before, actorHash, completedAt: new Date(now()).toISOString() }) } });
        return { operationId, applied: true, replayed: false, readinessGranted: false };
      }));
    } catch (error) {
      if (attempted) { uncertain.add(operationId); fail('MAPPING_UNCERTAIN_INSPECT_FIRST'); }
      if (!String(error.code || '').startsWith('MAPPING_')) fail('MAPPING_EVIDENCE_UNAVAILABLE');
      throw error;
    }
  }
  // Inspection never unlocks/retries a failed write, changes state or grants readiness.
  async function inspectOutcome() {
    return transaction(async tx => {
      const rows = sorted(await tx.vapiBusinessMapping.findMany());
      const journal = (await tx.runtimeStore.findUnique({ where: { key } }))?.data;
      const targets = relevantMappings(rows, p);
      const completed = journal?.operationId === operationId && journal.phase === 'completed'
        && digest(sorted(journal.inserted)) === digest(sorted(targets))
        && digest(rows.filter(r => !targets.includes(r))) === digest(journal.before);
      return { operationId, state: completed ? 'committed_exact' : !journal && !targets.length ? 'absent_at_read_only_snapshot' : 'conflict_or_partial',
        insertedIds: completed ? targets.map(r => r.id) : [], retryAuthorized: false, readinessGranted: false };
    });
  }
  // Deliberately no rollback executor: deleting routing records needs new approval.
  async function planRollback(readActivity) {
    return leased(lease => transaction(async tx => {
      const rows = sorted(await tx.vapiBusinessMapping.findMany()), saved = (await tx.runtimeStore.findUnique({ where: { key } }))?.data;
      if (!saved || saved.operationId !== operationId || saved.phase !== 'completed'
        || !Number.isFinite(Date.parse(saved.completedAt)) || Date.parse(saved.completedAt) > now()) fail('MAPPING_ROLLBACK_RECEIPT_REQUIRED');
      const targets = relevantMappings(rows, p);
      if (targets.length !== 3 || digest(sorted(targets)) !== digest(sorted(saved.inserted))
        || targets.some(r => p.preservedMappings.some(old => old.id === r.id))
        || digest(rows.filter(r => !targets.includes(r))) !== digest(saved.before)) fail('MAPPING_ROLLBACK_CHANGED_STATE');
      if (typeof readActivity !== 'function') fail('MAPPING_ROLLBACK_ACTIVITY_UNPROVEN');
      const a = await readActivity(tx, p, saved.completedAt);
      if (a?.complete !== true || a.operationId !== operationId || a.since !== saved.completedAt
        || !Number.isFinite(Date.parse(a.checkedAt)) || now() - Date.parse(a.checkedAt) < 0 || now() - Date.parse(a.checkedAt) > 300000
        || Date.parse(a.checkedAt) < Date.parse(saved.completedAt)
        || !['calls', 'tools', 'messages', 'bookings', 'otherDependencies'].every(k => a[k] === 0)) fail('MAPPING_ROLLBACK_ACTIVITY_UNPROVEN');
      lease.assertHeld();
      return { operationId, proposedDeleteIds: targets.map(r => r.id), executable: false, separateApprovalRequired: true };
    }));
  }
  return { prepare, apply, inspectOutcome, planRollback };
}

module.exports = { createBoundedBusinessMappingWriter, assessTargetOverrides };
