// Opt-in only: a loopback disposable database, never a provider or production DB.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { PREFIX, TTL_MS, createPrismaObservationStore, createObservationService } = require('../server/signupFormObservation');
const enabled = process.env.RUN_SIGNUP_OBSERVATION_POSTGRES === '1';

test('actual PostgreSQL metadata CAS, exact JSON linkage, cap and namespace-only expiry', { skip: !enabled, timeout: 30000 }, async t => {
  const url = new URL(process.env.DATABASE_URL);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Only a loopback fixture database is allowed');
  assert.ok(/^\/myaipa_recovery_drill_[a-z0-9_]+$/.test(url.pathname) || (process.env.GITHUB_ACTIONS === 'true' && url.pathname === '/ci'), 'Only the named disposable local/CI database is allowed');
  const { PrismaClient } = require('@prisma/client'), prisma = new PrismaClient();
  const scope = PREFIX + 'fixture-' + crypto.randomUUID() + ':', unrelated = 'preserve-observation-fixture:' + crypto.randomUUID();
  // Remap only this test's keys. The actual Prisma JSON/CAS predicates and dates
  // remain unchanged, while cleanup cannot touch another test or signup history.
  const scopedKey = key => typeof key === 'string' ? scope + key.slice(PREFIX.length) : { ...key, startsWith: scope + key.startsWith.slice(PREFIX.length) };
  const runtimeStore = Object.fromEntries(['findUnique', 'create', 'updateMany', 'findMany', 'deleteMany'].map(method => [method, args => {
    const next = { ...args };
    if (args.where?.key) next.where = { ...args.where, key: scopedKey(args.where.key) };
    if (args.data?.key) next.data = { ...args.data, key: scopedKey(args.data.key) };
    return prisma.runtimeStore[method](next);
  }]));
  t.after(async () => {
    try { await prisma.runtimeStore.deleteMany({ where: { OR: [{ key: { startsWith: scope } }, { key: unrelated }] } }); }
    finally { await prisma.$disconnect(); }
  });
  let at = Date.now();
  const store = createPrismaObservationStore({ runtimeStore }), attemptId = 'signup_' + 'a'.repeat(32);
  const options = { store, slots: 1, now: () => at, authenticateAttempt: async () => ({ eventKey: attemptId, status: 'pending_verification', expiresAt: new Date(at + 60000) }) };
  const service = createObservationService(options), access = await service.create();
  const snapshot = { schemaVersion: 1, sequence: 1, expectedRevision: 0, currentStep: 'business_details', attemptedAdvance: true,
    fields: [{ id: 'business_name', presence: 'blank', visible: 'visible', required: true, interacted: true, validation: 'invalid', reason: 'required_missing' }] };
  await t.test('one concurrent revision wins and only its metadata persists', async () => {
    const results = await Promise.allSettled([service.observe(access.id, access.token, snapshot), service.observe(access.id, access.token, { ...snapshot, sequence: 2 })]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal((await service.read(access.id, access.token)).revision, 1);
    const records = await prisma.runtimeStore.findMany({ where: { key: { startsWith: scope } } });
    assert.equal(records.length, 1); assert.ok(records[0].data.tokenHash); assert.ok(!JSON.stringify(records).includes(access.token));
  });
  await t.test('PostgreSQL JSON-path exact attempt lookup joins only the authenticated attempt', async () => {
    await service.link(access.id, access.token, { attemptId: 'attempt_' + 'a'.repeat(20), attemptToken: 'synthetic-status-capability' });
    assert.equal((await service.describeAttempt(attemptId)).id, access.id); assert.equal(await service.describeAttempt('signup_' + 'b'.repeat(32)), null);
  });
  await t.test('a full fixed slot refuses creation without evicting the active record', async () => {
    await assert.rejects(service.create(), { code: 'FORM_OBSERVATION_CAPACITY' }); assert.equal((await service.read(access.id, access.token)).revision, 1);
  });
  await t.test('fixed TTL reuse and purge remove only expired scoped telemetry, not history', async () => {
    await prisma.runtimeStore.create({ data: { key: unrelated, data: { preserve: true }, createdAt: new Date(at - TTL_MS - 1000) } });
    at += TTL_MS + 1; await assert.rejects(service.read(access.id, access.token), { code: 'FORM_OBSERVATION_UNAUTHORIZED' });
    const replacement = await service.create(); assert.notEqual(replacement.id, access.id);
    assert.equal((await prisma.runtimeStore.findUnique({ where: { key: unrelated } })).data.preserve, true);
    assert.equal(await prisma.runtimeStore.count({ where: { key: { startsWith: scope } } }), 1);
  });
});
