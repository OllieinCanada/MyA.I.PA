const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { normalizeSignupProvisioningPayload, buildProvisioningResourceName } = require('../server/signupProvisioning');
const { buildMakeSignupEventKey } = require('../server/makeSignupWebhook');
const { PREFIX, digest, createAssociationFence, createAssociationRepairService,
  atomicCommitAssociationFile, registerAssociationRepairRoutes } = require('../server/signupAssociationRepair');

function fixture() {
  const raw = { event: 'signup.completed', business: { name: 'Synthetic Electrical' },
    owner: { email: 'fixture@example.invalid', phone: '+19055550123' }, verification: { smsVerified: true, emailVerified: false } };
  const payload = normalizeSignupProvisioningPayload(raw, { signingSecret: 'isolated-association-test-only-secret' });
  const scope = { sourceId: buildMakeSignupEventKey(raw), phantomId: buildMakeSignupEventKey(payload), number: '+13653874357',
    twilioSid: 'PN' + 'a'.repeat(32), assistantId: 'assistant-fixture', phoneId: 'phone-fixture' };
  const source = { signupAttemptId: scope.sourceId, businessName: raw.business.name, ownerEmail: raw.owner.email,
    ownerPhone: raw.owner.phone, smsVerified: true, emailVerified: false, status: 'setup_error', makeError: 'MAKE_SIGNUP_RESPONSE_INCOMPLETE',
    agentTestStatus: 'failed', agentTestOwnerProviderStatus: 'undelivered', subscriptionStatus: 'unpaid' };
  const phantom = { signupAttemptId: scope.phantomId, ownerEmail: raw.owner.email, twilioPhoneNumber: scope.number,
    vapiAssistantId: scope.assistantId, vapiPhoneNumberId: scope.phoneId, status: 'setup_started', agentContentStatus: 'verified',
    oldEvidence: { note: 'Keep the entire historical row, including unknown fields' } };
  let store = { source, phantom, other: { signupAttemptId: 'other', note: 'keep' } };
  const control = { enabled: true, singleWriter: true, transactions: 0, commits: 0, reads: 0 }, journal = new Map();
  const attempt = { eventKey: scope.sourceId, businessName: raw.business.name, ownerEmail: raw.owner.email, ownerPhone: raw.owner.phone,
    payload: raw, status: 'setup_error', assignedPhone: null, vapiAssistantId: null, vapiPhoneNumberId: null,
    completedAt: null, updatedAt: new Date('2026-11-12T00:00:00Z') };
  const evidence = { sourceAttempt: attempt, phantomAttempt: null, signatureVerified: true,
    context: { signupEventKey: scope.sourceId, idempotencyKey: payload.provisioning.idempotencyKey,
      contextHash: payload.provisioning.contextHash, payload },
    receipts: Object.fromEntries([['twilio-number', { twilioPhoneNumber: scope.number, sid: scope.twilioSid }],
      ['vapi-assistant', { assistantId: scope.assistantId }], ['vapi-import', { id: scope.phoneId, number: scope.number, assistantId: scope.assistantId }]]
      .map(([kind, result]) => [kind, { status: 'completed', contextHash: payload.provisioning.contextHash, result }])),
    provider: { twilio: { sid: scope.twilioSid, number: scope.number, name: buildProvisioningResourceName('twilio-number', payload.provisioning.idempotencyKey) },
      phone: { id: scope.phoneId, number: scope.number, assistantId: scope.assistantId }, assistant: { id: scope.assistantId } },
    reserveNumbers: ['+13655550101', '+13655550102', '+13655550103', '+13655550104', '+13655550105'], otherAttempts: [] };
  const prisma = { runtimeStore: { findUnique: async ({ where }) => journal.has(where.key) ? { data: structuredClone(journal.get(where.key)) } : null },
    async $transaction(callback) {
      const count = ++control.transactions, nextJournal = new Map(structuredClone([...journal])), nextAttempt = structuredClone(attempt);
      const tx = { $queryRaw: async () => [], runtimeStore: {
        findUnique: async ({ where }) => nextJournal.has(where.key) ? { data: structuredClone(nextJournal.get(where.key)) } : null,
        create: async ({ data }) => { assert.equal(nextJournal.has(data.key), false); nextJournal.set(data.key, structuredClone(data.data)); },
        update: async ({ where, data }) => nextJournal.set(where.key, structuredClone(data.data)),
      }, signupAttempt: { findUnique: async () => structuredClone(nextAttempt), updateMany: async ({ where, data }) => {
        if (digest(where.updatedAt) !== digest(nextAttempt.updatedAt)) return { count: 0 };
        Object.assign(nextAttempt, data, { updatedAt: new Date('2026-11-12T00:01:00Z') }); return { count: 1 };
      } } };
      const result = await callback(tx);
      if (control.failBeforeCommit === count) throw Error('synthetic database commit rejected');
      journal.clear(); for (const [key, value] of nextJournal) journal.set(key, value); Object.assign(attempt, nextAttempt);
      if (control.loseAcknowledgement === count) throw Error('synthetic commit acknowledgement lost');
      return result;
    } };
  const fence = createAssociationFence();
  const service = createAssociationRepairService({ prisma, readStore: () => structuredClone(store), fence,
    readEvidence: async () => { control.reads++; if (control.readFailure) throw Error('synthetic GET timeout'); return structuredClone(evidence); },
    readDatabaseEvidence: async () => { control.databaseRecheck?.(); return structuredClone(evidence); },
    commitStore: project => { control.beforeFile?.(); const next = project(structuredClone(store)); store = next; control.commits++; },
    enabled: () => control.enabled, singleWriter: () => control.singleWriter });
  return { scope, evidence, attempt, control, journal, service, fence, get store() { return store; },
    set store(value) { store = value; }, actor: 'a'.repeat(64),
    async apply() { const { plan } = await service.inspect(scope); return service.apply(scope, plan.planDigest, 'a'.repeat(64)); } };
}

test('dry run is read-only; apply changes association fields only, with full history and one selectable owner', async () => {
  const f = fixture(), before = structuredClone(f.store), attemptBefore = structuredClone(f.attempt);
  const { plan } = await f.service.inspect(f.scope);
  assert.equal(f.control.commits, 0); assert.equal(f.control.transactions, 0);
  const result = await f.service.apply(f.scope, plan.planDigest, f.actor);
  assert.equal(result.applied, true); assert.equal(result.replayed, false);
  assert.equal(f.store.source.twilioPhoneNumber, f.scope.number); assert.equal(f.attempt.assignedPhone, f.scope.number);
  assert.equal(f.store.source.status, before.source.status); assert.equal(f.store.source.agentTestStatus, before.source.agentTestStatus);
  assert.equal(f.store.source.agentTestOwnerProviderStatus, 'undelivered'); assert.equal(f.store.source.subscriptionStatus, 'unpaid');
  assert.equal(f.store.source.emailVerified, false); assert.equal(f.attempt.status, attemptBefore.status); assert.equal(f.attempt.completedAt, null);
  assert.deepEqual(f.store.phantom.resourceAssociationRepair.history, before.phantom); assert.deepEqual(f.store.other, before.other);
  assert.equal(Object.values(f.store).filter(r => r.vapiPhoneNumberId === f.scope.phoneId).length, 1);
  assert.equal(f.journal.get(PREFIX + plan.repairId).phase, 'completed');
  assert.throws(() => f.fence.check(f.store, before), { code: 'ASSOCIATION_HISTORY_PROTECTED' });
});

test('completed replay fresh-reads proof but performs no further file or database writes', async () => {
  const f = fixture(); await f.apply(); const counts = [f.control.commits, f.control.transactions];
  const replay = await f.apply(); assert.equal(replay.replayed, true); assert.deepEqual([f.control.commits, f.control.transactions], counts);
});

test('simultaneous apply requests permit only one journal and file correction', async () => {
  const f = fixture(), { plan } = await f.service.inspect(f.scope);
  const results = await Promise.allSettled([f.service.apply(f.scope, plan.planDigest, f.actor), f.service.apply(f.scope, plan.planDigest, f.actor)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.code, 'ASSOCIATION_REPAIR_BUSY');
  assert.equal(f.control.commits, 1); assert.equal(f.journal.size, 1);
});

test('unrelated concurrent updates are merged from the freshest store; target edits are fenced', async () => {
  const f = fixture(); f.control.beforeFile = () => { f.store.other.note = 'new unrelated update';
    const wrong = structuredClone(f.store); wrong.source.status = 'changed';
    assert.throws(() => f.fence.check(f.store, wrong), { code: 'ASSOCIATION_REPAIR_BUSY' }); };
  await f.apply(); assert.equal(f.store.other.note, 'new unrelated update');
});

test('a stale target revision stops before file correction and leaves an inspectable pending journal', async () => {
  const f = fixture(); f.control.beforeFile = () => { f.store.source.makeError = 'a newer error'; };
  await assert.rejects(f.apply(), { code: 'ASSOCIATION_UNCERTAIN_INSPECT_FIRST' });
  assert.equal(f.control.commits, 0); assert.equal(f.attempt.assignedPhone, null);
  assert.equal([...f.journal.values()][0].phase, 'prepared');
  await assert.rejects(f.apply(), { code: 'ASSOCIATION_UNCERTAIN_INSPECT_FIRST' }); assert.equal(f.control.commits, 0);
});

test('lost prepared-journal acknowledgement is inspected and never automatically reapplied', async () => {
  const f = fixture(); f.control.loseAcknowledgement = 1;
  await assert.rejects(f.apply(), { code: 'ASSOCIATION_UNCERTAIN_INSPECT_FIRST' });
  assert.equal(f.journal.size, 1); assert.equal(f.control.commits, 0);
  await assert.rejects(f.apply(), { code: 'ASSOCIATION_UNCERTAIN_INSPECT_FIRST' }); assert.equal(f.control.commits, 0);
});

test('database failure after file rename preserves the pending journal/history and refuses blind retry', async () => {
  const f = fixture(); f.control.failBeforeCommit = 2;
  await assert.rejects(f.apply(), { code: 'ASSOCIATION_UNCERTAIN_INSPECT_FIRST' });
  assert.equal(f.control.commits, 1); assert.equal(f.attempt.assignedPhone, null);
  assert.equal([...f.journal.values()][0].phase, 'prepared');
  await assert.rejects(f.service.inspect(f.scope), error => error.code === 'ASSOCIATION_UNCERTAIN_INSPECT_FIRST'
    && error.inspection.journalPhase === 'prepared' && error.inspection.attemptAssociations.assignedPhone === null);
  await assert.rejects(f.apply()); assert.equal(f.control.commits, 1); assert.equal(f.attempt.completedAt, null);
});

test('lost final commit acknowledgement is resolved by fresh inspection without another write', async () => {
  const f = fixture(); f.control.loseAcknowledgement = 2;
  await assert.rejects(f.apply(), { code: 'ASSOCIATION_UNCERTAIN_INSPECT_FIRST' });
  assert.equal(f.attempt.assignedPhone, f.scope.number); assert.equal([...f.journal.values()][0].phase, 'completed');
  const replay = await f.apply(); assert.equal(replay.replayed, true); assert.equal(f.control.commits, 1); assert.equal(f.control.transactions, 2);
});

test('apply remains disabled unless both explicit development/operator gates are enabled', async () => {
  for (const flag of ['enabled', 'singleWriter']) { const f = fixture(); f.control[flag] = false;
    await assert.rejects(f.service.apply(f.scope, 'a'.repeat(64), f.actor), { code: 'ASSOCIATION_APPLY_DISABLED' });
    assert.equal(f.control.reads, 0); assert.equal(f.control.transactions, 0); }
});

test('a read timeout before journal preparation is not mislabeled as a completed or uncertain write', async () => {
  const f = fixture(); f.control.readFailure = true;
  await assert.rejects(f.service.apply(f.scope, 'a'.repeat(64), f.actor), { code: 'ASSOCIATION_EVIDENCE_UNAVAILABLE' });
  assert.equal(f.control.transactions, 0); assert.equal(f.control.commits, 0); assert.equal(f.journal.size, 0);
});

test('database proof is rechecked transactionally before preparing any correction', async () => {
  const f = fixture(), { plan } = await f.service.inspect(f.scope);
  f.control.databaseRecheck = () => { f.evidence.receipts['vapi-import'].contextHash = 'b'.repeat(64); };
  await assert.rejects(f.service.apply(f.scope, plan.planDigest, f.actor), { code: 'ASSOCIATION_UNCERTAIN_INSPECT_FIRST' });
  assert.equal(f.journal.size, 0); assert.equal(f.control.commits, 0); assert.equal(f.attempt.assignedPhone, null);
});

test('database proof changes after file commit leave an explicit pending journal, never a fabricated completion', async () => {
  const f = fixture(); let reads = 0;
  f.control.databaseRecheck = () => { if (++reads === 2) f.evidence.context.updatedAt = 'changed'; };
  await assert.rejects(f.apply(), { code: 'ASSOCIATION_UNCERTAIN_INSPECT_FIRST' });
  assert.equal(f.control.commits, 1); assert.equal(f.attempt.assignedPhone, null);
  assert.equal([...f.journal.values()][0].phase, 'prepared'); assert.equal(f.store.source.agentTestStatus, 'failed');
});

for (const [name, change, code] of [
  ['conflicting phantom email', f => { f.store.phantom.ownerEmail = 'other@example.invalid'; }, 'ASSOCIATION_PHANTOM_CONFLICT'],
  ['wrong binding', f => { f.evidence.context.signupEventKey = 'signup_' + 'f'.repeat(32); }, 'ASSOCIATION_BINDING_UNPROVEN'],
  ['real phantom SQL attempt', f => { f.evidence.phantomAttempt = { eventKey: f.scope.phantomId }; }, 'ASSOCIATION_BINDING_UNPROVEN'],
  ['unverified signature', f => { f.evidence.signatureVerified = false; }, 'ASSOCIATION_CONTEXT_UNPROVEN'],
  ['mixed receipt context', f => { f.evidence.receipts['vapi-import'].contextHash = 'a'.repeat(64); }, 'ASSOCIATION_RECEIPTS_UNPROVEN'],
  ['uncertain provider stage', f => { f.evidence.receipts['vapi-import'].status = 'failed'; }, 'ASSOCIATION_RECEIPTS_UNPROVEN'],
  ['wrong live assistant', f => { f.evidence.provider.phone.assistantId = 'other'; }, 'ASSOCIATION_PROVIDER_CONFLICT'],
  ['archived third-row owner', f => { f.store.other.vapiPhoneNumberId = f.scope.phoneId; f.store.other.status = 'archived'; }, 'ASSOCIATION_THIRD_OWNER'],
  ['reserve collision', f => { f.evidence.reserveNumbers[0] = f.scope.number; }, 'ASSOCIATION_RESERVE_PROOF_MISSING'],
  ['partially changed SQL associations', f => { f.attempt.assignedPhone = f.scope.number; }, 'ASSOCIATION_ATTEMPT_PARTIAL'],
]) test('refuses ' + name + ' without preparing a write', async () => {
  const f = fixture(); change(f); await assert.rejects(f.apply(), { code }); assert.equal(f.control.transactions, 0); assert.equal(f.control.commits, 0);
});

test('modified historical evidence is detected against the durable journal', async () => {
  const f = fixture(); await f.apply(); f.store.phantom.resourceAssociationRepair.history.oldEvidence.note = 'tampered';
  await assert.rejects(f.service.inspect(f.scope), { code: 'ASSOCIATION_HISTORY_CONFLICT' });
});

test('atomic file commit validates before writing and read-proves the renamed result', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'association-file-')), file = path.join(dir, 'store.json');
  fs.writeFileSync(file, JSON.stringify({ original: 1 }));
  atomicCommitAssociationFile(file, current => ({ ...current, next: 2 }));
  assert.deepEqual(JSON.parse(fs.readFileSync(file)), { original: 1, next: 2 });
  assert.throws(() => atomicCommitAssociationFile(file, () => { throw Error('stale'); }), /stale/);
  assert.deepEqual(JSON.parse(fs.readFileSync(file)), { original: 1, next: 2 });
});

test('a file rename failure leaves the old file intact and is never retried automatically', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'association-rename-')), file = path.join(dir, 'store.json');
  fs.writeFileSync(file, JSON.stringify({ original: 1 })); let renames = 0;
  const failedFs = { ...fs, renameSync() { renames++; throw Error('synthetic rename failure'); } };
  assert.throws(() => atomicCommitAssociationFile(file, () => ({ changed: true }), failedFs), /rename failure/);
  assert.equal(renames, 1); assert.deepEqual(JSON.parse(fs.readFileSync(file)), { original: 1 });
});

test('route rejects malformed or cross-origin requests and never accepts provider proof from a caller', async () => {
  let handler, applied = 0; const app = { post(_path, ...handlers) { handler = handlers.at(-1); } };
  registerAssociationRepairRoutes({ app, limiter() {}, requireAdmin() {}, isAllowedOrigin: origin => origin === 'https://admin.invalid',
    actorHash: () => 'a'.repeat(64), service: { inspect: async () => { throw Error('must not inspect'); }, apply: async () => { applied++; } } });
  for (const body of [{ action: 'apply', provider: {} }, { action: 'apply' }]) {
    let status; const res = { set() {}, status(n) { status = n; return this; }, json() {} };
    await handler({ headers: {}, body }, res); assert.equal(status, 403);
  }
  assert.equal(applied, 0);
});
