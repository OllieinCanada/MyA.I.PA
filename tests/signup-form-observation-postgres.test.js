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

test('real PostgreSQL start alerts deduplicate across workers, lost acknowledgements and restarts without sending', { skip: !enabled, timeout: 60000 }, async t => {
  const url = new URL(process.env.DATABASE_URL);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname));
  assert.ok(/^\/myaipa_recovery_drill_[a-z0-9_]+$/.test(url.pathname) || (process.env.GITHUB_ACTIONS === 'true' && url.pathname === '/ci'), 'Only the execution-owned disposable local/CI database is allowed');
  const { PrismaClient } = require('@prisma/client');
  const { enqueueTelegramMessageDb } = require('../server/telegramOutboxRepository');
  const makeDb = () => new PrismaClient({ datasources: { db: { url: url.href } }, __internal: { configOverride: c => ({ ...c, relativeEnvPaths: {} }) } });
  const db = makeDb(), other = makeDb(), scope = PREFIX + 'start-fixture-' + crypto.randomUUID() + ':', ownedHashes = [];
  const scopedKey = key => typeof key === 'string' ? scope + key.slice(PREFIX.length) : { ...key, startsWith: scope + key.startsWith.slice(PREFIX.length) };
  function storeFor(client) {
    const runtimeStore = Object.fromEntries(['findUnique', 'create', 'updateMany', 'findMany', 'deleteMany'].map(method => [method, args => {
      const next = { ...args };
      if (args.where?.key) next.where = { ...args.where, key: scopedKey(args.where.key) };
      if (args.data?.key) next.data = { ...args.data, key: scopedKey(args.data.key) };
      return client.runtimeStore[method](next);
    }]));
    return createPrismaObservationStore({ runtimeStore });
  }
  t.after(async () => {
    try {
      await db.runtimeStore.deleteMany({ where: { key: { startsWith: scope } } });
      await db.telegramOutboxMessage.deleteMany({ where: { dedupeHash: { in: ownedHashes } } });
      assert.equal(await db.runtimeStore.count({ where: { key: { startsWith: scope } } }), 0);
      assert.equal(await db.telegramOutboxMessage.count({ where: { dedupeHash: { in: ownedHashes } } }), 0);
    } finally { await Promise.all([db.$disconnect(), other.$disconnect()]); }
  });
  let at = Date.now();
  const store = storeFor(db), options = storage => ({ store: storage, slots: 1, now: () => at, authenticateAttempt: async () => null });
  const service = createObservationService(options(store)), restarted = () => createObservationService(options(storeFor(other)));
  const event = { schemaVersion: 1, sequence: 1, expectedRevision: 0, currentStep: 'trade', attemptedAdvance: false, started: true, fields: [] };
  const frontendUrl = 'https://fixture.invalid';
  async function newStart() {
    const access = await service.create();
    const key = 'signup-form-start:' + access.id, hash = crypto.createHash('sha256').update(key).digest('hex');
    assert.equal(await db.telegramOutboxMessage.count({ where: { dedupeHash: hash } }), 0, 'Never overwrite another fixture');
    ownedHashes.push(hash);
    await service.observe(access.id, access.token, event);
    return { ...access, hash };
  }
  const enqueue = item => enqueueTelegramMessageDb(db, { ...item, now: at });
  let access = await newStart();
  await t.test('separate SQL connections and concurrent workers persist one pending start, not a delivered claim', async () => {
    await Promise.all([service.processStalls({ enqueue, frontendUrl }), restarted().processStalls({ enqueue: item => enqueueTelegramMessageDb(other, { ...item, now: at }), frontendUrl })]);
    const rows = await db.telegramOutboxMessage.findMany({ where: { dedupeHash: access.hash } });
    assert.equal(rows.length, 1); assert.equal(rows[0].status, 'PENDING'); assert.equal(rows[0].providerMessageId, null); assert.equal(rows[0].deliveredAt, null);
    assert.ok((await restarted().listAdmin()).rows[0].startAlertQueuedAt);
    assert.equal((await restarted().processStalls({ enqueue, frontendUrl })).startsQueued, 0);
  });
  await t.test('a lost acknowledgement after actual outbox commit is inspected as the same key on restart', async () => {
    at += TTL_MS + 1; access = await newStart();
    await assert.rejects(service.processStalls({ frontendUrl, enqueue: async item => { await enqueue(item); throw Error('Synthetic lost enqueue acknowledgement'); } }), /lost enqueue acknowledgement/);
    assert.equal((await service.listAdmin()).rows[0].startAlertQueuedAt, null);
    assert.equal(await other.telegramOutboxMessage.count({ where: { dedupeHash: access.hash } }), 1);
    assert.equal((await restarted().processStalls({ enqueue, frontendUrl })).startsQueued, 1);
    assert.equal(await db.telegramOutboxMessage.count({ where: { dedupeHash: access.hash } }), 1);
    assert.ok((await service.listAdmin()).rows[0].startAlertQueuedAt);
  });
  await t.test('a failed metadata marker CAS preserves fresh browser progress and cannot enqueue a second outbox item', async () => {
    at += TTL_MS + 1; access = await newStart();
    const compareSwap = store.compareSwap; let inject = true;
    store.compareSwap = async (key, previous, next) => {
      if (next.startAlertQueuedAt && inject) {
        inject = false;
        await service.observe(access.id, access.token, { ...event, sequence: 2, expectedRevision: 1, started: false, currentStep: 'property_types' });
        return false;
      }
      return compareSwap(key, previous, next);
    };
    try { await service.processStalls({ enqueue, frontendUrl }); }
    finally { store.compareSwap = compareSwap; }
    assert.equal((await service.listAdmin()).rows[0].currentStep, 'property_types');
    assert.equal((await service.listAdmin()).rows[0].startAlertQueuedAt, null);
    await restarted().processStalls({ enqueue, frontendUrl });
    const current = (await service.listAdmin()).rows[0];
    assert.equal(current.currentStep, 'property_types'); assert.equal(current.revision, 2); assert.ok(current.startAlertQueuedAt);
    assert.equal(await db.telegramOutboxMessage.count({ where: { dedupeHash: access.hash } }), 1);
  });
});
