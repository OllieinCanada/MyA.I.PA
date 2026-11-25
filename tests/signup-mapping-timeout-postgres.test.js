'use strict';
// Never consumes project .env or a provider transport. Opt-in disposable SQL only.
const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const { ensureSignupBusinessBindings, closeSignupBusinessIdentity } = require('../server/signupBusinessRegistry');
const { signupBusinessKey } = require('../server/signupBusinessIdentity');
const { LOCK } = require('../server/signupBindingTransaction');
const { recordSignupBug, PREFIX } = require('../server/signupBugHistory');
const { readSavedSignupDiagnosis } = require('../server/signupSavedDiagnosis');
const { buildSignupTelegramAlert } = require('../server/signupAlerts');
const { journalKey } = require('../server/intakeRecoveryJournal');
const enabled = process.env.RUN_OBSERVABILITY_POSTGRES === '1';
function clients() {
  assert.equal(process.env.DISABLE_LOCAL_ENV_FILES, '1');
  const url = new URL(process.env.DATABASE_URL);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Loopback only');
  assert.ok(process.env.GITHUB_ACTIONS === 'true' && url.pathname === '/ci'
    || /^\/myaipa_mapping_timeout_[a-z0-9_]+$/.test(url.pathname), 'Execution-owned disposable database only');
  const { PrismaClient } = require('@prisma/client');
  return Array.from({ length: 3 }, () => new PrismaClient({ datasources: { db: { url: url.href } },
    __internal: { configOverride: config => ({ ...config, relativeEnvPaths: {} }) } }));
}
function hold(db) {
  let acquired, release;
  const ready = new Promise(resolve => { acquired = resolve; }), until = new Promise(resolve => { release = resolve; });
  const done = db.$transaction(async tx => { await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${LOCK}))::text AS lock_result`; acquired(); await until; }, { timeout: 15000 });
  // Ensure the reader waiting for readiness also observes an early SQL failure.
  return { ready: Promise.race([ready, done]), release, done };
}
test('real disposable SQL: bounded mapping waits, lifecycle/ownership/atomicity, and saved Telegram diagnosis',
  { skip: !enabled, timeout: 90000 }, async t => {
    const [db, other, locker] = clients(), marker = crypto.randomBytes(12).toString('hex');
    const attemptId = 'signup_' + crypto.createHash('sha256').update(marker).digest('hex').slice(0, 32);
    const payload = { business: { name: 'Synthetic mapping ' + marker }, owner: { email: 'fake@example.invalid', phone: '+19055550123' } };
    const signup = { signupAttemptId: attemptId, businessName: payload.business.name, ownerEmail: payload.owner.email, ownerPhone: payload.owner.phone };
    const mappings = [{ matchType: 'assistantId', matchValue: 'synthetic-assistant-' + marker }, { matchType: 'phoneNumberId', matchValue: 'synthetic-phone-' + marker }];
    const registryKey = 'signup-business:' + signupBusinessKey(signup), operationId = crypto.randomUUID(), handoffKey = journalKey(attemptId) + ':handoff:' + operationId;
    const eventId = crypto.randomUUID(), bugKey = PREFIX + crypto.createHash('sha256').update(JSON.stringify(eventId)).digest('hex');
    let owned = false, business, held;
    const bind = (prisma = db) => ensureSignupBusinessBindings({ prisma, signup, mappings, fallbackPhone: signup.ownerPhone, ownerPhone: signup.ownerPhone });
    try {
      assert.equal(await db.signupAttempt.findUnique({ where: { eventKey: attemptId } }), null);
      assert.equal(await db.runtimeStore.count({ where: { key: { in: [registryKey, handoffKey, bugKey] } } }), 0);
      assert.equal(await db.business.count({ where: { name: payload.business.name } }), 0);
      assert.equal(await db.vapiBusinessMapping.count({ where: { matchValue: { in: mappings.map(m => m.matchValue) } } }), 0);
      owned = true;
      await db.signupAttempt.create({ data: { eventKey: attemptId, publicId: marker, statusTokenHash: marker, businessName: signup.businessName,
        ownerEmail: signup.ownerEmail, ownerPhone: signup.ownerPhone, payload, status: 'provisioning', expiresAt: new Date(Date.now() + 3600000) } });
      await t.test('old blocking lock consumes transaction lifetime before the first signup read', async () => {
        held = hold(locker); await held.ready;
        const release = setTimeout(() => held.release(), 6000);
        try {
          await assert.rejects(db.$transaction(async tx => {
            await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${LOCK}))::text AS lock_result`;
            return tx.signupAttempt.findUnique({ where: { eventKey: attemptId } });
          }, { timeout: 5000 }), { code: 'P2028' });
        } finally { clearTimeout(release); held.release(); await held.done; }
        assert.equal(await db.business.count({ where: { name: signup.businessName } }), 0);
      });
      await t.test('new reader waits outside short transactions beyond the old five-second deadline', async () => {
        held = hold(locker); await held.ready;
        const pending = bind(); const release = setTimeout(() => held.release(), 6000);
        try { business = await pending; } finally { clearTimeout(release); held.release(); await held.done; }
        assert.equal(business.name, signup.businessName);
        assert.equal(await db.business.count({ where: { name: signup.businessName } }), 1);
        assert.equal(await db.vapiBusinessMapping.count({ where: { businessId: business.id } }), 2);
      });
      await t.test('separate clients and reconstructed writer reuse one business and exact mappings', async () => {
        const results = await Promise.all([bind(), bind(other), bind()]);
        assert.ok(results.every(row => row.id === business.id)); assert.equal(await db.business.count({ where: { name: signup.businessName } }), 1);
      });
      await t.test('real write then forced rollback leaves no partial settings change', async () => {
        const before = await db.settings.findUnique({ where: { businessId: business.id } });
        const fault = { $transaction: (fn, options) => db.$transaction(async tx => { await fn(tx); throw Error('synthetic forced rollback'); }, options) };
        await assert.rejects(ensureSignupBusinessBindings({ prisma: fault, signup, mappings, fallbackPhone: signup.ownerPhone, ownerPhone: '+19055550999' }), /synthetic forced rollback/);
        assert.deepEqual(await db.settings.findUnique({ where: { businessId: business.id } }), before);
      });
      await t.test('different business cannot claim either existing resource', async () => {
        const otherSignup = { ...signup, signupAttemptId: undefined, businessName: signup.businessName + ' other' };
        await assert.rejects(ensureSignupBusinessBindings({ prisma: other, signup: otherSignup, mappings, fallbackPhone: signup.ownerPhone, ownerPhone: signup.ownerPhone }), { code: 'AGENT_MAPPING_OWNERSHIP_CONFLICT' });
        assert.equal(await db.business.count({ where: { name: otherSignup.businessName } }), 0);
      });
      await t.test('commit acknowledgement loss is not retried, subsequent inspection finds the saved business', async () => {
        let calls = 0;
        const uncertain = { $transaction: async (fn, options) => { calls++; await db.$transaction(fn, options); throw Object.assign(Error('synthetic lost acknowledgement'), { code: 'ECONNRESET' }); } };
        await assert.rejects(bind(uncertain), { code: 'ECONNRESET' }); assert.equal(calls, 1);
        assert.equal((await db.runtimeStore.findUnique({ where: { key: registryKey } })).data.businessId, business.id);
      });
      await t.test('saved exact diagnosis reaches real Telegram builder through read-only SQL with unchanged evidence', async () => {
        const now = Date.now();
        await db.runtimeStore.create({ data: { key: handoffKey, data: { eventKey: attemptId, operationId, businessKey: signupBusinessKey(signup), payloadHash: 'f'.repeat(64),
          kind: 'handoff', status: 'accepted', startedAt: new Date(now - 1000).toISOString(), updatedAt: new Date(now).toISOString() } } });
        await recordSignupBug({ prisma: db, listSignups: () => [signup], attemptId, eventId, stage: 'business-mapping', error: { code: 'P2028', message: 'synthetic private raw message' }, now: () => now - 500 });
        const before = await db.runtimeStore.findMany({ where: { key: { in: [registryKey, handoffKey, bugKey] } }, orderBy: { key: 'asc' } });
        const input = { prisma: db, listSignups: () => [signup], record: signup, operationId, failedStage: 'VAPI_NUMBER_IMPORT', now: () => now + 1 };
        const saved = await readSavedSignupDiagnosis(input); assert.equal(saved.code, 'P2028');
        const text = buildSignupTelegramAlert({ state: 'provisioning_failed', eventKey: attemptId, record: signup, savedDiagnosis: saved });
        assert.match(text, /Saved P2028/); assert.match(text, /Saved diagnosis: BUG-/); assert.doesNotMatch(text, /synthetic private raw/);
        assert.equal(await readSavedSignupDiagnosis({ ...input, operationId: crypto.randomUUID() }), null);
        assert.deepEqual(await db.runtimeStore.findMany({ where: { key: { in: [registryKey, handoffKey, bugKey] } }, orderBy: { key: 'asc' } }), before);
      });
      await t.test('archive made while mapping waits is freshly read before any mapping mutation', async () => {
        held = hold(locker); await held.ready;
        const pending = bind(); const rejected = assert.rejects(pending, { code: 'SIGNUP_CLOSED' });
        await other.signupAttempt.update({ where: { eventKey: attemptId }, data: { status: 'abandoned_archived' } });
        held.release(); await held.done; await rejected;
        assert.equal(await db.vapiBusinessMapping.count({ where: { businessId: business.id } }), 2);
      });
      await t.test('coordinated registry tombstone also prevents reopening the existing business', async () => {
        await other.signupAttempt.update({ where: { eventKey: attemptId }, data: { status: 'provisioning' } });
        await closeSignupBusinessIdentity({ prisma: other, signup }); await assert.rejects(bind(), { code: 'SIGNUP_CLOSED' });
      });
    } finally {
      if (held) { held.release(); await held.done; }
      try {
        if (owned) {
          const rows = await db.business.findMany({ where: { name: signup.businessName }, select: { id: true } });
          for (const row of rows) {
            await db.vapiBusinessMapping.deleteMany({ where: { businessId: row.id, matchValue: { in: mappings.map(m => m.matchValue) } } });
            await db.settings.deleteMany({ where: { businessId: row.id } }); await db.business.delete({ where: { id: row.id } });
          }
          await db.runtimeStore.deleteMany({ where: { key: { in: [registryKey, handoffKey, bugKey] } } });
          await db.signupAttempt.deleteMany({ where: { eventKey: attemptId, publicId: marker } });
          assert.equal(await db.business.count({ where: { name: signup.businessName } }), 0);
          assert.equal(await db.runtimeStore.count({ where: { key: { in: [registryKey, handoffKey, bugKey] } } }), 0);
          assert.equal(await db.signupAttempt.count({ where: { eventKey: attemptId } }), 0);
        }
      } finally { await Promise.all([db.$disconnect(), other.$disconnect(), locker.$disconnect()]); }
    }
  });
