const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { createBoundedBusinessMappingWriter, assessTargetOverrides } = require('../server/boundedBusinessMappingWriter');
const { normalizeSignupProvisioningPayload, buildProvisioningResourceName } = require('../server/signupProvisioning');
const { buildMakeSignupEventKey } = require('../server/makeSignupWebhook');
const hash = x => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const copy = x => structuredClone(x);

function fixture() {
  const time = Date.parse('2026-11-13T09:00:00Z');
  const raw = { event: 'signup.completed', business: { name: 'Synthetic Electric' },
    owner: { email: 'owner@example.invalid', phone: '+19055550123' }, verification: { smsVerified: true } };
  const payload = normalizeSignupProvisioningPayload(raw, { signingSecret: 'synthetic-mapping-tests-only' });
  const policy = { businessId: 7, release: 'a'.repeat(40), sourceId: buildMakeSignupEventKey(raw), phantomId: buildMakeSignupEventKey(payload),
    number: '+19055550124', phoneId: '11111111-1111-4111-8111-111111111111', assistantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    twilioSid: 'PN' + 'a'.repeat(32), preservedMappings: [
      { id: 24991, businessId: 7, matchType: 'phoneNumber', matchValue: '+19055550125' },
      { id: 24992, businessId: 7, matchType: 'phoneNumberId', matchValue: '33333333-3333-4333-8333-333333333333' },
      { id: 24993, businessId: 7, matchType: 'assistantId', matchValue: '44444444-4444-4444-8444-444444444444' },
    ] };
  const vals = { twilioPhoneNumber: policy.number, vapiPhoneNumberId: policy.phoneId, vapiAssistantId: policy.assistantId };
  // Production uses recursively sorted object hashing; preserve exact property order here too.
  function stable(x) { if (Array.isArray(x)) return x.map(stable); if (x && typeof x === 'object') return Object.fromEntries(Object.keys(x).sort().map(k => [k, stable(x[k])])); return x; }
  const actualRepairId = hash(stable({ ids: [policy.sourceId, policy.phantomId], contextHash: payload.provisioning.contextHash, values: vals }));
  const mark = { id: actualRepairId, sourceId: policy.sourceId, phantomId: policy.phantomId, values: vals };
  const history = { signupAttemptId: policy.phantomId, ...vals, status: 'setup_started', unknownHistory: { preserve: true } };
  const evidence = { checkedAt: new Date(time).toISOString(), providerCheckedAt: new Date(time).toISOString(), release: policy.release,
    source: { signupAttemptId: policy.sourceId, businessName: raw.business.name, ownerEmail: raw.owner.email, ownerPhone: raw.owner.phone,
      ...vals, status: 'setup_error', smsVerified: true, agentTestStatus: 'failed', subscriptionStatus: 'unpaid', resourceAssociationRepair: copy(mark) },
    phantom: { signupAttemptId: policy.phantomId, status: 'superseded_duplicate', canonicalSignupAttemptId: policy.sourceId,
      resourceAssociationRepair: { ...copy(mark), history } },
    sourceAttempt: { eventKey: policy.sourceId, businessName: raw.business.name, ownerEmail: raw.owner.email, ownerPhone: raw.owner.phone,
      payload: raw, status: 'setup_error', assignedPhone: policy.number, vapiPhoneNumberId: policy.phoneId, vapiAssistantId: policy.assistantId },
    context: { signupEventKey: policy.sourceId, idempotencyKey: payload.provisioning.idempotencyKey, contextHash: payload.provisioning.contextHash, payload },
    receipts: Object.fromEntries([['twilio-number', { twilioPhoneNumber: policy.number, sid: policy.twilioSid }],
      ['vapi-assistant', { assistantId: policy.assistantId }], ['vapi-import', { id: policy.phoneId, number: policy.number, assistantId: policy.assistantId }]]
      .map(([stage, result]) => [stage, { status: 'completed', contextHash: payload.provisioning.contextHash, result }])),
    provider: { twilio: { sid: policy.twilioSid, number: policy.number, name: buildProvisioningResourceName('twilio-number', payload.provisioning.idempotencyKey) },
      phone: { id: policy.phoneId, number: policy.number, assistantId: policy.assistantId }, assistant: { id: policy.assistantId } },
    signatureVerified: true, associationJournal: { phase: 'completed', repairId: actualRepairId, historyDigest: hash(stable(history)) },
    phantomAttempt: null, otherAttempts: [], otherAssociations: [], reserveNumbers: Array.from({ length: 5 }, (_, i) => '+1905555013' + i) };
  let rows = copy(policy.preservedMappings), journal = new Map(), queue = Promise.resolve(), held = false;
  const business = { id: 7, name: raw.business.name, phone: raw.owner.phone, settings: { ownerPhone: raw.owner.phone, mode: 'unchanged' } };
  const control = { enabled: true, singleWriter: true, writes: 0, creates: 0, transactions: 0, lockKeys: [], evidenceReads: 0, rawOverride: '', now: time };
  const prisma = { async $transaction(fn, options) {
    assert.equal(options.isolationLevel, 'Serializable');
    const previous = queue; let release; queue = new Promise(resolve => { release = resolve; }); await previous;
    const nextRows = copy(rows), nextJournal = new Map(copy([...journal]));
    const transactionNumber = ++control.transactions;
    try {
      const tx = { $queryRaw: async (_, key) => { control.lockKeys.push(key); return []; },
        business: { findUnique: async () => copy(control.missingBusiness ? null : business) },
        vapiBusinessMapping: { findMany: async () => copy(nextRows), create: async ({ data }) => {
          assert.equal(held, true); assert.ok(control.lockKeys.includes('signup-business-bindings:v1'));
          assert.ok(control.lockKeys.includes('bounded-business:7'));
          control.creates++;
          if (control.failInsert === control.creates) throw Error('synthetic insert failure');
          if (nextRows.some(r => r.matchValue === data.matchValue)) throw Error('unique');
          nextRows.push({ id: 30000 + control.creates, ...copy(data) });
          control.onInsert?.(data);
        } }, runtimeStore: {
          findUnique: async ({ where }) => nextJournal.has(where.key) ? { data: copy(nextJournal.get(where.key)) } : null,
          create: async ({ data }) => { assert.equal(nextJournal.has(data.key), false); nextJournal.set(data.key, copy(data.data)); },
        } };
      const result = await fn(tx);
      if (control.rejectCommit === transactionNumber) throw Error('synthetic commit rejection');
      if (control.loseBeforeCommit === transactionNumber) throw Error('synthetic connection loss before commit');
      if (JSON.stringify(rows) !== JSON.stringify(nextRows)) control.writes++;
      rows = nextRows; journal = nextJournal;
      if (control.loseAcknowledgement === transactionNumber) throw Error('synthetic lost commit acknowledgement');
      return result;
    } finally { release(); }
  } };
  const options = { prisma, policy, readEvidence: async () => { control.evidenceReads++; control.onEvidenceRead?.(); if (control.readFailure) throw Error('private synthetic detail'); return copy(evidence); },
    readOverrides: async () => control.rawOverride, enabled: () => control.enabled, singleWriter: () => control.singleWriter, now: () => control.now,
    withAssociationLease: async (ids, fn) => {
      assert.deepEqual(ids, [policy.sourceId, policy.phantomId]);
      if (held || control.lifecycleBusy) throw Object.assign(Error('busy'), { code: 'MAPPING_LIFECYCLE_BUSY' });
      held = true;
      try { return await fn({ assertHeld: () => { if (!held || control.leaseLost) throw Object.assign(Error('lost'), { code: 'MAPPING_LEASE_LOST' }); } }); }
      finally { held = false; }
    } };
  const writer = createBoundedBusinessMappingWriter(options);
  return { policy, evidence, business, control, options, writer, actor: 'b'.repeat(64),
    get rows() { return rows; }, get journal() { return journal; },
    async apply() { const plan = await writer.prepare(); return writer.apply(plan.planDigest, 'b'.repeat(64)); },
    async activity() { const [saved] = journal.values(); return { complete: true, operationId: saved.operationId, since: saved.completedAt,
      checkedAt: new Date(control.now).toISOString(), calls: 0, tools: 0, messages: 0, bookings: 0, otherDependencies: 0 }; } };
}

test('prepare is read-only; apply atomically inserts three bindings and one durable receipt without changing readiness/history', async () => {
  const f = fixture(), before = copy({ rows: f.rows, evidence: f.evidence, business: f.business });
  const plan = await f.writer.prepare(); assert.equal(f.control.creates, 0); assert.equal(f.journal.size, 0);
  const result = await f.writer.apply(plan.planDigest, f.actor);
  assert.equal(result.applied, true); assert.equal(result.readinessGranted, false); assert.equal(f.rows.length, 6); assert.equal(f.journal.size, 1);
  assert.deepEqual(f.rows.slice(0, 3), before.rows); assert.deepEqual(f.evidence, before.evidence); assert.deepEqual(f.business, before.business);
  for (const key of [f.policy.number, f.policy.phoneId, f.policy.assistantId]) assert.deepEqual(f.rows.filter(r => r.matchValue === key).map(r => r.businessId), [7]);
});
test('exact replay is a no-op with no new mapping or receipt writes', async () => {
  const f = fixture(), plan = await f.writer.prepare(); await f.writer.apply(plan.planDigest, f.actor);
  assert.equal((await f.writer.apply(plan.planDigest, f.actor)).replayed, true); assert.equal(f.control.creates, 3); assert.equal(f.control.writes, 1);
});
test('policy is copied, not mutable by the caller after construction', async () => {
  const f = fixture(); f.policy.businessId = 99; await f.apply(); assert.equal(f.rows.at(-1).businessId, 7);
});
for (const [name, change] of [
  ['wrong original', f => { f.evidence.source.signupAttemptId = f.policy.phantomId; }],
  ['wrong phantom', f => { f.evidence.phantom.signupAttemptId = f.policy.sourceId; }],
  ['wrong registered context', f => { f.evidence.context.signupEventKey = f.policy.phantomId; }],
  ['unsigned context', f => { f.evidence.signatureVerified = false; }],
  ['unverified contact', f => { f.evidence.source.smsVerified = false; }],
  ['reconciliation incomplete', f => { f.evidence.associationJournal.phase = 'prepared'; }],
  ['history missing', f => { delete f.evidence.phantom.resourceAssociationRepair.history; }],
  ['full history modified', f => { f.evidence.phantom.resourceAssociationRepair.history.unknownHistory.preserve = false; }],
  ['phantom database attempt exists', f => { f.evidence.phantomAttempt = { eventKey: f.policy.phantomId }; }],
  ['other database association exists', f => { f.evidence.otherAttempts.push({ eventKey: 'synthetic-other' }); }],
  ['second active owner', f => { f.evidence.otherAssociations.push({ id: 'synthetic-other' }); }],
  ['wrong business owner', f => { f.business.settings.ownerPhone = '+19055550999'; }],
  ['missing business', f => { f.control.missingBusiness = true; }],
  ['wrong purchase receipt', f => { f.evidence.receipts['twilio-number'].result.sid = 'PN' + 'c'.repeat(32); }],
  ['wrong receipt context', f => { f.evidence.receipts['vapi-import'].contextHash = 'c'.repeat(64); }],
  ['wrong provider binding', f => { f.evidence.provider.phone.assistantId = f.policy.phoneId; }],
  ['provider-declared other tenant', f => { f.evidence.provider.assistant.metadata = { businessId: 8 }; }],
  ['source-declared other tenant', f => { f.evidence.source.businessId = 8; }],
  ['target is reserve', f => { f.evidence.reserveNumbers[0] = f.policy.number; }],
  ['stale evidence', f => { f.control.now += 300001; }],
  ['stale provider proof behind fresh database proof', f => { f.evidence.providerCheckedAt = new Date(f.control.now - 300001).toISOString(); }],
  ['future evidence', f => { f.control.now -= 1; }],
  ['wrong release', f => { f.evidence.release = 'f'.repeat(40); }],
  ['preserved mapping changed', f => { f.rows[0].businessId = 8; }],
]) test(`refuses ${name} before writes`, async () => { const f = fixture(); change(f); await assert.rejects(f.writer.prepare()); assert.equal(f.control.creates, 0); });

for (const variant of ['other-tenant', 'wrong-type', 'phone-alias', 'international-prefix-alias', 'uuid-case', 'partial']) test(`refuses ${variant} mapping conflict before writes`, async () => {
  const f = fixture(); let row = { id: 9, businessId: 7, matchType: 'phoneNumber', matchValue: f.policy.number };
  if (variant === 'other-tenant') row.businessId = 8;
  if (variant === 'wrong-type') row.matchType = 'assistantId';
  if (variant === 'phone-alias') row.matchValue = '(905) 555-0124';
  if (variant === 'international-prefix-alias') row.matchValue = '0019055550124';
  if (variant === 'uuid-case') row = { ...row, matchType: 'assistantId', matchValue: f.policy.assistantId.toUpperCase() };
  f.rows.push(row); await assert.rejects(f.writer.prepare(), { code: 'MAPPING_TARGET_CONFLICT' }); assert.equal(f.control.creates, 0);
});
test('changed proof or unrelated mapping after dry run refuses apply', async () => {
  for (const change of [f => { f.evidence.source.agentTestStatus = 'different'; }, f => { f.rows.push({ id: 8, businessId: 9, matchType: 'assistantId', matchValue: 'unrelated' }); }]) {
    const f = fixture(), plan = await f.writer.prepare(); change(f);
    await assert.rejects(f.writer.apply(plan.planDigest, f.actor), { code: 'MAPPING_CHANGED_EVIDENCE' }); assert.equal(f.control.creates, 0);
  }
});
test('disabled defaults, missing lease and missing server-owned plan refuse before mutation', async () => {
  const f = fixture(); const disabled = createBoundedBusinessMappingWriter({ ...f.options, enabled: undefined });
  await assert.rejects(disabled.apply('a'.repeat(64), f.actor), { code: 'MAPPING_APPLY_DISABLED' });
  await assert.rejects(createBoundedBusinessMappingWriter({ ...f.options, withAssociationLease: undefined }).prepare(), { code: 'MAPPING_LIFECYCLE_LEASE_REQUIRED' });
  await assert.rejects(f.writer.apply('a'.repeat(64), f.actor), { code: 'MAPPING_PLAN_REQUIRED' }); assert.equal(f.control.creates, 0);
});
test('failure at each insert rolls back all three bindings and leaves preserved rows exact', async () => {
  for (const failInsert of [1, 2, 3]) { const f = fixture(), before = copy(f.rows); f.control.failInsert = failInsert;
    await assert.rejects(f.apply(), { code: 'MAPPING_UNCERTAIN_INSPECT_FIRST' }); assert.deepEqual(f.rows, before); assert.equal(f.journal.size, 0);
    assert.equal((await f.writer.inspectOutcome()).state, 'absent_at_read_only_snapshot'); }
});
test('lost commit acknowledgement is inspectable and never causes automatic retry', async () => {
  const f = fixture(), plan = await f.writer.prepare(); f.control.loseAcknowledgement = 2;
  await assert.rejects(f.writer.apply(plan.planDigest, f.actor), { code: 'MAPPING_UNCERTAIN_INSPECT_FIRST' });
  const result = await f.writer.inspectOutcome(); assert.equal(result.state, 'committed_exact'); assert.equal(result.retryAuthorized, false);
  await assert.rejects(f.writer.apply(plan.planDigest, f.actor), { code: 'MAPPING_UNCERTAIN_INSPECT_FIRST' }); assert.equal(f.control.creates, 3);
});
test('unknown before-commit failure stays absent but does not authorize replay', async () => {
  const f = fixture(), plan = await f.writer.prepare(); f.control.loseBeforeCommit = 2;
  await assert.rejects(f.writer.apply(plan.planDigest, f.actor), { code: 'MAPPING_UNCERTAIN_INSPECT_FIRST' });
  assert.equal((await f.writer.inspectOutcome()).state, 'absent_at_read_only_snapshot');
  await assert.rejects(f.writer.apply(plan.planDigest, f.actor), { code: 'MAPPING_UNCERTAIN_INSPECT_FIRST' }); assert.equal(f.rows.length, 3);
});
test('changed evidence or lost lifecycle lease during insert aborts the full transaction', async () => {
  for (const change of [f => { f.evidence.source.status = 'decommissioned'; }, f => { f.control.leaseLost = true; }, f => { f.control.rawOverride = JSON.stringify({ [f.policy.phoneId]: 8 }); }]) {
    const f = fixture(); f.control.onInsert = () => change(f);
    await assert.rejects(f.apply(), { code: 'MAPPING_UNCERTAIN_INSPECT_FIRST' }); assert.equal(f.rows.length, 3); assert.equal(f.journal.size, 0);
  }
});
test('50 repeated concurrent pairs permit one transaction to insert, with no duplicates', async () => {
  for (let i = 0; i < 50; i++) { const f = fixture(), plan = await f.writer.prepare();
    const results = await Promise.allSettled([f.writer.apply(plan.planDigest, f.actor), f.writer.apply(plan.planDigest, f.actor)]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(f.rows.length, 6); assert.equal(f.journal.size, 1); assert.equal(f.control.creates, 3);
  }
});
test('lifecycle-first reservation refuses before any DB writes', async () => {
  const f = fixture(), plan = await f.writer.prepare(); f.control.lifecycleBusy = true;
  await assert.rejects(f.writer.apply(plan.planDigest, f.actor), { code: 'MAPPING_LIFECYCLE_BUSY' }); assert.equal(f.control.creates, 0);
});
test('independent service instances share lifecycle exclusion and restart inspection needs no write', async () => {
  const f = fixture(), second = createBoundedBusinessMappingWriter(f.options);
  const firstPlan = await f.writer.prepare(), secondPlan = await second.prepare();
  const results = await Promise.allSettled([f.writer.apply(firstPlan.planDigest, f.actor), second.apply(secondPlan.planDigest, f.actor)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(f.control.creates, 3);
  const restarted = createBoundedBusinessMappingWriter(f.options);
  assert.equal((await restarted.inspectOutcome()).state, 'committed_exact');
  await assert.rejects(restarted.prepare(), { code: 'MAPPING_INSPECT_EXISTING_OPERATION' }); assert.equal(f.control.creates, 3);
});
test('DB commit rejection does not report success or authorize automatic retry', async () => {
  const f = fixture(), plan = await f.writer.prepare(); f.control.rejectCommit = 2;
  await assert.rejects(f.writer.apply(plan.planDigest, f.actor), { code: 'MAPPING_UNCERTAIN_INSPECT_FIRST' });
  assert.equal(f.rows.length, 3); assert.equal(f.journal.size, 0);
});
test('mutation of preserved mapping full contents after dry run refuses application', async () => {
  const f = fixture(), plan = await f.writer.prepare(); f.rows[0].label = 'new label';
  await assert.rejects(f.writer.apply(plan.planDigest, f.actor), { code: 'MAPPING_CHANGED_EVIDENCE' }); assert.equal(f.control.creates, 0);
});
test('rollback is a non-executable proposal restricted to new IDs and complete zero-activity proof', async () => {
  const f = fixture(); await f.apply(); const before = copy(f.rows);
  const plan = await f.writer.planRollback(() => f.activity()); assert.equal(plan.executable, false); assert.equal(plan.separateApprovalRequired, true);
  assert.deepEqual(plan.proposedDeleteIds, [30001, 30002, 30003]); assert.deepEqual(f.rows, before);
  for (const change of [a => { a.calls = 1; }, a => { a.complete = false; }, a => { a.since = 'wrong'; }, a => { a.operationId = 'wrong'; }, a => { delete a.otherDependencies; }]) {
    await assert.rejects(f.writer.planRollback(async () => { const a = await f.activity(); change(a); return a; }), { code: 'MAPPING_ROLLBACK_ACTIVITY_UNPROVEN' });
  }
  f.rows.at(-1).label = 'changed after application';
  await assert.rejects(f.writer.planRollback(() => f.activity()), { code: 'MAPPING_ROLLBACK_CHANGED_STATE' }); assert.equal(f.rows.length, 6);
});
test('rollback refuses existing-row changes and absent operation receipts', async () => {
  const f = fixture(); await assert.rejects(f.writer.planRollback(() => f.activity()), { code: 'MAPPING_ROLLBACK_RECEIPT_REQUIRED' });
  await f.apply(); f.rows[0].label = 'changed';
  await assert.rejects(f.writer.planRollback(() => f.activity()), { code: 'MAPPING_ROLLBACK_CHANGED_STATE' });
});
test('rollback refuses malformed receipt time or activity proof predating commit', async () => {
  const f = fixture(); await f.apply(); const [saved] = f.journal.values();
  await assert.rejects(f.writer.planRollback(async () => ({ ...await f.activity(), checkedAt: new Date(f.control.now - 1).toISOString() })), { code: 'MAPPING_ROLLBACK_ACTIVITY_UNPROVEN' });
  saved.completedAt = 'invalid';
  await assert.rejects(f.writer.planRollback(() => f.activity()), { code: 'MAPPING_ROLLBACK_RECEIPT_REQUIRED' });
});
test('override assessment rejects invalid, conflicting and duplicate normalized target keys without exposing unrelated entries', () => {
  const f = fixture(); for (const raw of ['invalid', '[]', JSON.stringify({ [f.policy.phoneId]: 8 }), JSON.stringify({ [f.policy.phoneId]: false }),
    JSON.stringify({ [f.policy.phoneId]: 7, [' ' + f.policy.phoneId + ' ']: 7 })]) assert.equal(assessTargetOverrides(raw, f.policy).conflict, true);
  const result = assessTargetOverrides(JSON.stringify({ unrelated: 'never-output-this', [f.policy.phoneId]: 7 }), f.policy);
  assert.equal(result.conflict, false); assert.equal(JSON.stringify(result).includes('never-output-this'), false);
});
test('module has no app/transport registration or rollback executor and is not wired into production', () => {
  const body = fs.readFileSync(require.resolve('../server/boundedBusinessMappingWriter'), 'utf8');
  assert.equal(/require\(['"](?:\.\/index|@prisma\/client|twilio)|fetch\(|\.deleteMany\(|\.delete\(/.test(body), false);
  assert.equal(fs.readFileSync(require.resolve('../server/index'), 'utf8').includes('boundedBusinessMappingWriter'), false);
});

// The existing Quality workflow supplies an owned, ephemeral loopback PostgreSQL
// service. Never load .env, use a provider DB or mutate its shared /ci schema.
test('real PostgreSQL bounded mapping transactions in a newly created disposable CI database', {
  skip: !(process.env.GITHUB_ACTIONS === 'true' && process.env.CI === 'true' && process.env.DATABASE_URL), timeout: 120000,
}, async t => {
  const url = new URL(process.env.DATABASE_URL);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname));
  assert.equal(url.pathname, '/ci'); assert.equal(url.username, 'ci');
  const { Client } = require('pg'), { PrismaClient } = require('@prisma/client');
  const path = require('node:path'), { spawnSync } = require('node:child_process');
  const database = 'myaipa_mapping_drill_' + crypto.randomBytes(10).toString('hex');
  assert.match(database, /^myaipa_mapping_drill_[a-f0-9]{20}$/);
  const admin = new Client({ connectionString: url.toString() });
  let prisma, created = false;
  await admin.connect();
  try {
    const identity = await admin.query('SELECT current_database() AS db, current_user AS usr');
    assert.deepEqual(identity.rows[0], { db: 'ci', usr: 'ci' });
    await admin.query(`CREATE DATABASE "${database}"`); created = true;
    url.pathname = '/' + database; url.search = '?connection_limit=4';
    const cli = path.join(path.dirname(require.resolve('prisma/package.json')), 'build', 'index.js');
    const pushed = spawnSync(process.execPath, [cli, 'db', 'push', '--skip-generate', '--schema', path.resolve(__dirname, '../prisma/schema.prisma')], {
      cwd: path.resolve(__dirname, '..'), encoding: 'utf8', windowsHide: true, timeout: 60000,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, SystemRoot: process.env.SystemRoot,
        DATABASE_URL: url.toString(), DISABLE_LOCAL_ENV_FILES: '1', PRISMA_HIDE_UPDATE_MESSAGE: '1' },
    });
    assert.equal(pushed.status, 0, 'schema initialization must pass in the generated disposable database');
    prisma = new PrismaClient({ datasources: { db: { url: url.toString() } },
      __internal: { configOverride: config => ({ ...config, relativeEnvPaths: {} }) } });
    async function seed() {
      const f = fixture();
      // All rows in this database are owned synthetic fixtures, never user data.
      await prisma.runtimeStore.deleteMany(); await prisma.vapiBusinessMapping.deleteMany();
      await prisma.settings.deleteMany(); await prisma.business.deleteMany();
      await prisma.business.create({ data: { id: 7, name: f.business.name, phone: f.business.phone, timezone: 'America/Toronto',
        settings: { create: { ownerPhone: f.business.settings.ownerPhone } } } });
      await prisma.vapiBusinessMapping.createMany({ data: f.policy.preservedMappings });
      return f;
    }
    const writer = (f, db = prisma) => createBoundedBusinessMappingWriter({ ...f.options, prisma: db });
    const preservation = async () => {
      const rows = await prisma.vapiBusinessMapping.findMany({ where: { id: { in: [24991, 24992, 24993] } }, orderBy: { id: 'asc' } });
      return rows.map(({ id, businessId, matchType, matchValue }) => ({ id, businessId, matchType, matchValue }));
    };
    await t.test('real commit, JSON audit receipt, exact replay and unique key', async () => {
      const f = await seed(), w = writer(f), plan = await w.prepare();
      assert.equal((await w.apply(plan.planDigest, f.actor)).applied, true);
      assert.equal((await w.apply(plan.planDigest, f.actor)).replayed, true);
      assert.equal(await prisma.vapiBusinessMapping.count(), 6); assert.equal(await prisma.runtimeStore.count(), 1);
      assert.deepEqual(await preservation(), f.policy.preservedMappings);
      await assert.rejects(prisma.vapiBusinessMapping.create({ data: { businessId: 7, matchType: 'assistantId', matchValue: f.policy.assistantId } }), { code: 'P2002' });
      assert.equal((await w.inspectOutcome()).state, 'committed_exact');
    });
    await t.test('second insert exception rolls back real rows and receipt atomically', async () => {
      const f = await seed(); let inserts = 0;
      const injected = { $transaction: (fn, options) => prisma.$transaction(tx => fn({
        business: tx.business, runtimeStore: tx.runtimeStore, $queryRaw: (...args) => tx.$queryRaw(...args),
        vapiBusinessMapping: { findMany: (...args) => tx.vapiBusinessMapping.findMany(...args), create: (...args) => {
          if (++inserts === 2) throw Error('synthetic precommit failure'); return tx.vapiBusinessMapping.create(...args);
        } },
      }), options) };
      const w = writer(f, injected), plan = await w.prepare();
      await assert.rejects(w.apply(plan.planDigest, f.actor), { code: 'MAPPING_UNCERTAIN_INSPECT_FIRST' });
      assert.equal(await prisma.vapiBusinessMapping.count(), 3); assert.equal(await prisma.runtimeStore.count(), 0);
      assert.deepEqual(await preservation(), f.policy.preservedMappings);
      assert.equal((await w.inspectOutcome()).state, 'absent_at_read_only_snapshot');
    });
    await t.test('lost real commit acknowledgement is inspected, not retried', async () => {
      const f = await seed(); let transactions = 0;
      const injected = { $transaction: async (fn, options) => { const result = await prisma.$transaction(fn, options);
        if (++transactions === 2) throw Error('synthetic acknowledgement loss after real commit'); return result; } };
      const w = writer(f, injected), plan = await w.prepare();
      await assert.rejects(w.apply(plan.planDigest, f.actor), { code: 'MAPPING_UNCERTAIN_INSPECT_FIRST' });
      assert.equal((await w.inspectOutcome()).state, 'committed_exact');
      await assert.rejects(w.apply(plan.planDigest, f.actor), { code: 'MAPPING_UNCERTAIN_INSPECT_FIRST' });
      assert.equal(await prisma.vapiBusinessMapping.count(), 6); assert.equal(await prisma.runtimeStore.count(), 1);
    });
    await t.test('real database serializes competing services without duplicate bindings', async () => {
      const f = await seed(), first = writer(f), second = writer(f);
      const a = await first.prepare(), b = await second.prepare();
      const results = await Promise.allSettled([first.apply(a.planDigest, f.actor), second.apply(b.planDigest, f.actor)]);
      assert.ok(results.some(r => r.status === 'fulfilled'));
      assert.equal(await prisma.vapiBusinessMapping.count(), 6); assert.equal(await prisma.runtimeStore.count(), 1);
      assert.deepEqual(await preservation(), f.policy.preservedMappings);
    });
    await t.test('shared advisory lock excludes an independent SQL lifecycle writer', async () => {
      const f = await seed(), w = writer(f), plan = await w.prepare();
      let release, acquired; const held = new Promise(resolve => { acquired = resolve; });
      const blocker = prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${'signup-business-bindings:v1'}))::text AS lock_result`;
        acquired(); await new Promise(resolve => { release = resolve; });
        await tx.vapiBusinessMapping.update({ where: { id: 24991 }, data: { label: 'concurrent synthetic lifecycle change' } });
      });
      await held;
      let settled = false; const pending = w.apply(plan.planDigest, f.actor).finally(() => { settled = true; });
      try { await new Promise(resolve => setTimeout(resolve, 100)); assert.equal(settled, false); }
      finally { release(); }
      await blocker;
      await assert.rejects(pending);
      assert.equal(await prisma.vapiBusinessMapping.count(), 3); assert.equal(await prisma.runtimeStore.count(), 0);
    });
    await t.test('other-tenant conflict refuses before adding any real rows', async () => {
      const f = await seed();
      await prisma.business.create({ data: { id: 8, name: 'Other synthetic tenant', phone: '+19055550199', timezone: 'UTC' } });
      await prisma.vapiBusinessMapping.create({ data: { businessId: 8, matchType: 'assistantId', matchValue: f.policy.assistantId } });
      await assert.rejects(writer(f).prepare(), { code: 'MAPPING_TARGET_CONFLICT' });
      assert.equal(await prisma.vapiBusinessMapping.count(), 4); assert.equal(await prisma.runtimeStore.count(), 0);
    });
  } finally {
    if (prisma) await prisma.$disconnect();
    // Generated name is validated above. Never drop /ci, a configured external DB
    // or any database not created by this exact test invocation.
    if (created) await admin.query(`DROP DATABASE "${database}"`);
    await admin.end();
  }
});
