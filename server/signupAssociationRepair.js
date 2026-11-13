const crypto = require('node:crypto');
const { signupBusinessKey, isClosedSignup } = require('./signupBusinessIdentity');
const { registeredSignupEventKey } = require('./signupProvisioningContext');
const { buildMakeSignupEventKey } = require('./makeSignupWebhook');
const { buildProvisioningResourceName } = require('./signupProvisioning');
const { normalizeNorthAmericanE164 } = require('./canadianPhoneNumber');

const PREFIX = 'signup-association-repair:v1:';
const ASSOCIATIONS = ['twilioPhoneNumber', 'vapiAssistantId', 'vapiPhoneNumberId'];
const fail = code => { throw Object.assign(new Error(code), { code, statusCode: 409 }); };
function stable(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])]));
  return value;
}
const digest = value => crypto.createHash('sha256').update(JSON.stringify(stable(value)) ?? 'undefined').digest('hex');
const selected = (store, ids) => Object.fromEntries(Object.entries(store).filter(([, r]) => ids.includes(r?.signupAttemptId)));
const attemptVersion = row => digest({ payload: row.payload, businessName: row.businessName, ownerEmail: row.ownerEmail,
  ownerPhone: row.ownerPhone, status: row.status, assignedPhone: row.assignedPhone || '',
  vapiAssistantId: row.vapiAssistantId || '', vapiPhoneNumberId: row.vapiPhoneNumberId || '', updatedAt: row.updatedAt });
const databaseEvidence = evidence => Object.fromEntries(['sourceAttempt', 'phantomAttempt', 'context', 'receipts', 'signatureVerified', 'otherAttempts']
  .map(k => [k, evidence[k] ?? (k === 'otherAttempts' ? [] : null)]));

// This fence participates in every application dashboard write, not just this
// repair. Synchronous compare/commit has no await window in the Node process.
function createAssociationFence() {
  const held = new Set();
  return {
    hold(ids) { if (ids.some(id => held.has(id))) fail('ASSOCIATION_REPAIR_BUSY'); ids.forEach(id => held.add(id)); },
    release(ids) { ids.forEach(id => held.delete(id)); },
    check(current, next) {
      for (const id of held) if (digest(selected(current, [id])) !== digest(selected(next, [id]))) fail('ASSOCIATION_REPAIR_BUSY');
      for (const [key, row] of Object.entries(current)) {
        const mark = row?.resourceAssociationRepair;
        if (!mark) continue;
        const replacement = next[key];
        if (!replacement || digest(mark) !== digest(replacement.resourceAssociationRepair)) fail('ASSOCIATION_HISTORY_PROTECTED');
        if (ASSOCIATIONS.some(f => (row[f] || '') !== (replacement[f] || ''))) fail('ASSOCIATION_OWNERSHIP_PROTECTED');
        if (Object.values(next).some(r => r?.signupAttemptId !== mark.sourceId
          && ASSOCIATIONS.some(f => r?.[f] && r[f] === mark.values[f]))) fail('ASSOCIATION_THIRD_OWNER');
      }
    },
  };
}

function buildAssociationPlan({ store, evidence, scope }) {
  const { sourceAttempt: attempt, phantomAttempt, context, receipts, provider, reserveNumbers, otherAttempts = [] } = evidence;
  const ids = [scope.sourceId, scope.phantomId];
  if (!ids.every(id => /^signup_[a-f0-9]{32}$/.test(id)) || ids[0] === ids[1]) fail('ASSOCIATION_SCOPE_INVALID');
  if (!attempt || attempt.eventKey !== scope.sourceId || registeredSignupEventKey(context) !== scope.sourceId
    || buildMakeSignupEventKey(attempt.payload) !== scope.sourceId
    || buildMakeSignupEventKey(context.payload) !== scope.phantomId || phantomAttempt) fail('ASSOCIATION_BINDING_UNPROVEN');
  const matches = ids.map(id => Object.entries(store).filter(([, r]) => r?.signupAttemptId === id));
  if (matches.some(rows => rows.length !== 1)) fail('ASSOCIATION_EXACT_RECORDS_REQUIRED');
  const [[sourceKey, source], [phantomKey, phantom]] = matches.map(rows => rows[0]);
  const businessKey = signupBusinessKey(source);
  if (!businessKey || businessKey !== signupBusinessKey(attempt) || businessKey !== signupBusinessKey(context.payload)
    || isClosedSignup(source) || isClosedSignup(attempt)) fail('ASSOCIATION_IDENTITY_CONFLICT');
  if (!(source.smsVerified || source.emailVerified)
    || !(attempt.payload?.verification?.smsVerified || attempt.payload?.verification?.emailVerified)) fail('ASSOCIATION_CONTACT_UNVERIFIED');
  for (const [key, normalize] of [['ownerEmail', x => String(x).trim().toLowerCase()],
    ['ownerPhone', normalizeNorthAmericanE164], ['businessName', x => String(x).normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase()]]) {
    if (phantom[key] && normalize(phantom[key]) !== normalize(source[key])) fail('ASSOCIATION_PHANTOM_CONFLICT');
  }
  if (!phantom.ownerEmail || context.idempotencyKey !== businessKey
    || context.payload.provisioning?.idempotencyKey !== businessKey || !/^[a-f0-9]{64}$/.test(context.contextHash || '')
    || context.contextHash !== context.payload.provisioning?.contextHash || evidence.signatureVerified !== true) fail('ASSOCIATION_CONTEXT_UNPROVEN');
  const stages = ['twilio-number', 'vapi-assistant', 'vapi-import'].map(k => receipts?.[k]);
  if (stages.some(r => r?.status !== 'completed' || r.contextHash !== context.contextHash || !r.result)) fail('ASSOCIATION_RECEIPTS_UNPROVEN');
  const [tw, as, im] = stages.map(r => r.result);
  if (!/^\+1[2-9]\d{9}$/.test(scope.number) || tw.twilioPhoneNumber !== scope.number
    || (tw.sid || tw.twilioSid) !== scope.twilioSid || as.assistantId !== scope.assistantId || im.id !== scope.phoneId
    || im.number !== scope.number || im.assistantId !== scope.assistantId) fail('ASSOCIATION_RECEIPT_CONFLICT');
  if (provider?.twilio?.sid !== scope.twilioSid || provider.twilio.number !== scope.number
    || provider.twilio.name !== buildProvisioningResourceName('twilio-number', businessKey)
    || provider.phone?.id !== scope.phoneId || provider.phone.number !== scope.number
    || provider.phone.assistantId !== scope.assistantId || provider.assistant?.id !== scope.assistantId) fail('ASSOCIATION_PROVIDER_CONFLICT');
  if (!Array.isArray(reserveNumbers) || new Set(reserveNumbers).size !== 5 || reserveNumbers.includes(scope.number)) fail('ASSOCIATION_RESERVE_PROOF_MISSING');
  const values = { twilioPhoneNumber: scope.number, vapiAssistantId: scope.assistantId, vapiPhoneNumberId: scope.phoneId };
  if (otherAttempts.length || Object.values(store).some(r => !ids.includes(r?.signupAttemptId)
    && ASSOCIATIONS.some(f => r?.[f] && r[f] === values[f]))) fail('ASSOCIATION_THIRD_OWNER');
  const repairId = digest({ ids, contextHash: context.contextHash, values });
  const alreadyApplied = attempt.assignedPhone === scope.number && attempt.vapiAssistantId === scope.assistantId
    && attempt.vapiPhoneNumberId === scope.phoneId && ASSOCIATIONS.every(f => source[f] === values[f] && !phantom[f])
    && source.resourceAssociationRepair?.id === repairId && phantom.resourceAssociationRepair?.id === repairId
    && phantom.resourceAssociationRepair?.history && phantom.status === 'superseded_duplicate'
    && phantom.canonicalSignupAttemptId === scope.sourceId;
  const history = alreadyApplied ? phantom.resourceAssociationRepair.history : phantom;
  if (!history || typeof history !== 'object' || history.signupAttemptId !== scope.phantomId
    || ASSOCIATIONS.some(f => history[f] !== values[f])) fail('ASSOCIATION_HISTORY_CONFLICT');
  if (!alreadyApplied && (ASSOCIATIONS.some(f => source[f]) || ASSOCIATIONS.some(f => phantom[f] !== values[f]) || isClosedSignup(phantom))) fail('ASSOCIATION_STATE_CHANGED');
  if ([['assignedPhone', scope.number], ['vapiAssistantId', scope.assistantId], ['vapiPhoneNumberId', scope.phoneId]]
    .some(([f, value]) => attempt[f] && attempt[f] !== value)) fail('ASSOCIATION_ATTEMPT_CONFLICT');
  if (!alreadyApplied && (attempt.assignedPhone || attempt.vapiAssistantId || attempt.vapiPhoneNumberId)) fail('ASSOCIATION_ATTEMPT_PARTIAL');
  const targetDigest = digest(selected(store, ids));
  const proofDigest = digest({ context, receipts, provider, reserves: [...reserveNumbers].sort() });
  const plan = { scope, repairId, alreadyApplied, databaseDigest: digest(databaseEvidence(evidence)),
    historyDigest: digest(history), targetDigest, attemptVersion: attemptVersion(attempt), proofDigest,
    planDigest: digest({ repairId, targetDigest, attemptVersion: attemptVersion(attempt), proofDigest }), values, sourceKey, phantomKey };
  return plan;
}

function projectAssociationMove(store, plan) {
  if (digest(selected(store, [plan.scope.sourceId, plan.scope.phantomId])) !== plan.targetDigest) fail('ASSOCIATION_STALE_PLAN');
  if (Object.values(store).some(r => ![plan.scope.sourceId, plan.scope.phantomId].includes(r?.signupAttemptId)
    && ASSOCIATIONS.some(f => r?.[f] && r[f] === plan.values[f]))) fail('ASSOCIATION_THIRD_OWNER');
  const next = structuredClone(store), source = next[plan.sourceKey], phantom = next[plan.phantomKey];
  const mark = { id: plan.repairId, sourceId: plan.scope.sourceId, phantomId: plan.scope.phantomId, values: plan.values };
  next[plan.sourceKey] = { ...source, ...plan.values, resourceAssociationRepair: mark };
  next[plan.phantomKey] = { ...phantom, twilioPhoneNumber: '', vapiAssistantId: '', vapiPhoneNumberId: '',
    status: 'superseded_duplicate', canonicalSignupAttemptId: plan.scope.sourceId,
    resourceAssociationRepair: { ...mark, history: structuredClone(phantom) } };
  if (Object.values(next).filter(r => r?.vapiPhoneNumberId === plan.scope.phoneId).length !== 1) fail('ASSOCIATION_SELECTOR_AMBIGUOUS');
  return next;
}

function createAssociationRepairService({ prisma, readStore, commitStore, fence, readEvidence, readDatabaseEvidence, enabled = () => false,
  singleWriter = () => false, now = () => new Date().toISOString() }) {
  async function inspect(scope) {
    const evidence = await readEvidence(scope); // server-owned reads only; never accepts caller-supplied proof
    const store = readStore(), repairId = digest({ ids: [scope.sourceId, scope.phantomId], contextHash: evidence.context?.contextHash,
      values: { twilioPhoneNumber: scope.number, vapiAssistantId: scope.assistantId, vapiPhoneNumberId: scope.phoneId } });
    const journal = (await prisma.runtimeStore.findUnique({ where: { key: PREFIX + repairId } }))?.data;
    let plan;
    try { plan = buildAssociationPlan({ store, evidence, scope }); }
    catch (error) {
      if (journal) {
        error.inspection = { journalPhase: journal.phase, repairId, associationOwners: Object.values(store)
          .filter(r => [scope.sourceId, scope.phantomId].includes(r?.signupAttemptId))
          .map(r => ({ signupAttemptId: r.signupAttemptId, twilioPhoneNumber: r.twilioPhoneNumber || null,
            vapiAssistantId: r.vapiAssistantId || null, vapiPhoneNumberId: r.vapiPhoneNumberId || null })),
        attemptAssociations: { assignedPhone: evidence.sourceAttempt?.assignedPhone || null,
          vapiAssistantId: evidence.sourceAttempt?.vapiAssistantId || null, vapiPhoneNumberId: evidence.sourceAttempt?.vapiPhoneNumberId || null } };
        if (journal.phase !== 'completed') error.code = 'ASSOCIATION_UNCERTAIN_INSPECT_FIRST';
      }
      throw error;
    }
    if (journal && journal.historyDigest !== plan.historyDigest) fail('ASSOCIATION_HISTORY_CONFLICT');
    return { plan, journal };
  }
  async function apply(scope, expectedPlanDigest, actorHash) {
    if (!enabled() || !singleWriter()) fail('ASSOCIATION_APPLY_DISABLED');
    if (typeof readDatabaseEvidence !== 'function') fail('ASSOCIATION_DATABASE_RECHECK_REQUIRED');
    const ids = [scope.sourceId, scope.phantomId];
    fence.hold(ids);
    let writeAttempted = false;
    try {
      const { plan, journal } = await inspect(scope);
      if (journal) {
        if (journal.phase === 'completed' && plan.alreadyApplied) return { applied: true, replayed: true, repairId: plan.repairId };
        fail('ASSOCIATION_UNCERTAIN_INSPECT_FIRST');
      }
      if (plan.alreadyApplied) fail('ASSOCIATION_JOURNAL_MISSING');
      if (plan.planDigest !== expectedPlanDigest || !/^[a-f0-9]{32,80}$/.test(actorHash || '')) fail('ASSOCIATION_STALE_PLAN');
      const key = PREFIX + plan.repairId;
      writeAttempted = true;
      await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))::text AS lock_result`;
        if (await tx.runtimeStore.findUnique({ where: { key } })) fail('ASSOCIATION_UNCERTAIN_INSPECT_FIRST');
        const row = await tx.signupAttempt.findUnique({ where: { eventKey: scope.sourceId } });
        if (!row || attemptVersion(row) !== plan.attemptVersion) fail('ASSOCIATION_ATTEMPT_CHANGED');
        if (digest(databaseEvidence(await readDatabaseEvidence(tx, scope))) !== plan.databaseDigest) fail('ASSOCIATION_DATABASE_PROOF_CHANGED');
        await tx.runtimeStore.create({ data: { key, data: { version: 1, phase: 'prepared', repairId: plan.repairId,
          scope, planDigest: plan.planDigest, targetDigest: plan.targetDigest, historyDigest: plan.historyDigest, actorHash, preparedAt: now() } } });
      });
      // commitStore is synchronous and merges into the freshest whole store.
      // It must verify the two target revisions and atomically rename the file.
      commitStore(current => projectAssociationMove(current, plan));
      await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))::text AS lock_result`;
        const saved = await tx.runtimeStore.findUnique({ where: { key } });
        const row = await tx.signupAttempt.findUnique({ where: { eventKey: scope.sourceId } });
        if (saved?.data?.phase !== 'prepared' || !row || attemptVersion(row) !== plan.attemptVersion) fail('ASSOCIATION_UNCERTAIN_INSPECT_FIRST');
        if (digest(databaseEvidence(await readDatabaseEvidence(tx, scope))) !== plan.databaseDigest) fail('ASSOCIATION_DATABASE_PROOF_CHANGED');
        const result = await tx.signupAttempt.updateMany({ where: { eventKey: scope.sourceId, updatedAt: row.updatedAt,
          status: row.status, businessName: row.businessName, ownerEmail: row.ownerEmail, ownerPhone: row.ownerPhone,
          assignedPhone: row.assignedPhone, vapiAssistantId: row.vapiAssistantId, vapiPhoneNumberId: row.vapiPhoneNumberId,
          payload: { equals: row.payload } },
          data: { assignedPhone: scope.number, vapiAssistantId: scope.assistantId, vapiPhoneNumberId: scope.phoneId } });
        if (result.count !== 1) fail('ASSOCIATION_ATTEMPT_CHANGED');
        await tx.runtimeStore.update({ where: { key }, data: { data: { ...saved.data, phase: 'completed', completedAt: now() } } });
      });
      const after = await inspect(scope);
      if (!after.plan.alreadyApplied || after.journal?.phase !== 'completed') fail('ASSOCIATION_UNCERTAIN_INSPECT_FIRST');
      return { applied: true, replayed: false, repairId: plan.repairId };
    } catch (error) {
      // A rejected/unknown transaction response may have committed. No rollback,
      // retry, provider action or readiness promotion is attempted here.
      if (writeAttempted) {
        throw Object.assign(new Error('Inspect saved journal, file and attempt before retrying.'),
          { code: 'ASSOCIATION_UNCERTAIN_INSPECT_FIRST', statusCode: 409 });
      }
      if (!String(error.code || '').startsWith('ASSOCIATION_')) throw Object.assign(new Error('Read-only evidence unavailable.'),
        { code: 'ASSOCIATION_EVIDENCE_UNAVAILABLE', statusCode: 503 });
      throw error;
    } finally { fence.release(ids); }
  }
  return { inspect, apply };
}

function atomicCommitAssociationFile(filePath, project, fsImpl = require('node:fs')) {
  const current = JSON.parse(fsImpl.readFileSync(filePath, 'utf8'));
  const next = project(current); // synchronous CAS + merge of current unrelated rows
  const temporary = `${filePath}.association-${process.pid}-${crypto.randomUUID()}.tmp`;
  const fd = fsImpl.openSync(temporary, 'wx', fsImpl.statSync(filePath).mode & 0o777);
  try { fsImpl.writeFileSync(fd, JSON.stringify(next, null, 2) + '\n'); fsImpl.fsyncSync(fd); }
  finally { fsImpl.closeSync(fd); }
  fsImpl.renameSync(temporary, filePath);
  const saved = JSON.parse(fsImpl.readFileSync(filePath, 'utf8'));
  if (digest(saved) !== digest(next)) fail('ASSOCIATION_FILE_READBACK_UNCERTAIN');
}

function registerAssociationRepairRoutes({ app, requireAdmin, limiter, isAllowedOrigin, actorHash, service }) {
  app.post('/api/admin/signups/reconcile-resource-associations', limiter, requireAdmin, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      if (!req.headers.origin || !isAllowedOrigin(req.headers.origin) || req.headers['x-myaipa-record-repair'] !== '1'
        || !/^application\/json(?:\s*;|$)/i.test(String(req.headers['content-type'] || ''))) fail('ASSOCIATION_ORIGIN_REQUIRED');
      const body = req.body || {}, keys = ['sourceId', 'phantomId', 'number', 'twilioSid', 'assistantId', 'phoneId'];
      if (Object.keys(body).some(k => ![...keys, 'action', 'confirmation', 'planDigest'].includes(k))
        || keys.some(k => typeof body[k] !== 'string' || body[k].length > 160)) fail('ASSOCIATION_SCOPE_INVALID');
      const scope = Object.fromEntries(keys.map(k => [k, body[k]]));
      if (body.action === 'dry_run') {
        const { plan, journal } = await service.inspect(scope);
        return res.json({ ok: true, dryRun: true, scope, planDigest: plan.planDigest, repairId: plan.repairId,
          alreadyApplied: Boolean(plan.alreadyApplied), journalPhase: journal?.phase || 'none', readinessGranted: false });
      }
      if (body.action !== 'apply' || body.confirmation !== 'RECONCILE_EXISTING_SIGNUP_RECORDS_ONLY'
        || !/^[a-f0-9]{64}$/.test(body.planDigest || '')) fail('ASSOCIATION_CONFIRMATION_REQUIRED');
      const result = await service.apply(scope, body.planDigest, actorHash(req));
      res.json({ ok: true, ...result, readinessGranted: false });
    } catch (error) {
      const known = /^ASSOCIATION_[A-Z_]+$/.test(error.code || '');
      res.status(['ASSOCIATION_APPLY_DISABLED', 'ASSOCIATION_ORIGIN_REQUIRED'].includes(error.code) ? 403
        : error.code === 'ASSOCIATION_EVIDENCE_UNAVAILABLE' ? 503 : known ? 409 : 503).json({
        ok: false, code: known ? error.code : 'ASSOCIATION_EVIDENCE_UNAVAILABLE',
        error: 'No setup, provider, message or billing action was run. Inspect records and journal before retrying.',
        ...(known && error.inspection ? { inspection: error.inspection } : {}) });
    }
  });
}

module.exports = { PREFIX, ASSOCIATIONS, digest, attemptVersion, databaseEvidence, createAssociationFence,
  buildAssociationPlan, projectAssociationMove, createAssociationRepairService, atomicCommitAssociationFile, registerAssociationRepairRoutes };
