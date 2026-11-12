'use strict';
// Runs after the existing fresh-database crash drill, in its exact disposable
// loopback DB only. No provider requests; each fake POST appends one ledger row.
const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const { validateDrillTarget } = require('../scripts/sms-dispatch-postgres-safety');
const { prepareNotificationDraft: prepare, reviewNotificationDraft: review, dispatchReviewedNotification: send, dispatchConfirmedNotification } = require('../server/smsNotificationDrafts');
const { redactExpiredNotificationDrafts } = require('../server/smsNotificationDrafts');
test('manual notification approval uses real PostgreSQL transactions', { skip: process.env.RUN_SMS_MANUAL_APPROVAL_POSTGRES !== '1' && 'Requires the isolated SMS PostgreSQL CI service' }, async t => {
  const url = validateDrillTarget(process.env);
  const { PrismaClient } = require('@prisma/client');
  const db = new PrismaClient({ datasources: { db: { url } }, __internal: { configOverride: config => ({ ...config, relativeEnvPaths: {} }) } });
  const actor = 'b'.repeat(32), env = { SMS_MANUAL_DISPATCH_ENABLED: 'true', TWILIO_ACCOUNT_SID: 'AC_INERT', TWILIO_AUTH_TOKEN: 'INERT' };
  const passed = [];
  try {
    const identity = (await db.$queryRaw`SELECT current_database() AS db, current_user AS actor`)[0];
    assert.equal(identity.db, 'myaipa_sms_dispatch_drill_ci'); assert.equal(identity.actor, 'sms_drill');
    async function fixture() {
      const input = { callId: 'sms-drill-' + crypto.randomUUID(), from: '+19055550100', to: '+19055550101', leg: 'owner', body: 'Synthetic approval test' };
      const draft = await prepare({ prisma: db, input });
      const options = { prisma: db, id: draft.draftId, expectedRevision: draft.revision, expectedHash: draft.contextHash };
      return { input, options,
        approve: () => review({ ...options, action: 'approve', actor }),
        send: overrides => send({ ...options, env, suppressionChecker: async () => false,
          fetchImpl: async (_url, request) => {
            const params = new URLSearchParams(request.body);
            assert.equal(params.get('To'), input.to); assert.equal(params.get('Body'), input.body);
            const hash = crypto.createHash('sha256').update(params.get('Body')).digest('hex');
            await db.$executeRaw`INSERT INTO "SmsDispatchDrillTransport" ("caseId", "leg", "bodyHash") VALUES (${input.callId}, 'owner', ${hash})`;
            return { ok: true, status: 201, json: async () => ({ sid: 'SM' + '2'.repeat(32), status: 'queued' }) };
          }, ...overrides }),
        count: async () => Number((await db.$queryRaw`SELECT count(*) AS n FROM "SmsDispatchDrillTransport" WHERE "caseId"=${input.callId}`)[0].n) };
    }
    const check = async (name, fn) => t.test(name, async () => { await fn(); passed.push(name); });
    await check('draft and approval create zero transport rows', async () => {
      const f = await fixture(); await assert.rejects(f.send(), /approval_required/); await f.approve(); assert.equal(await f.count(), 0);
    });
    await check('concurrent admissions use database locks for one send', async () => {
      const f = await fixture(); await f.approve(); await Promise.allSettled([f.send(), f.send(), f.send()]); assert.equal(await f.count(), 1);
      await f.send(); assert.equal(await f.count(), 1);
    });
    await check('changed content invalidates an approved version', async () => {
      const f = await fixture(); await f.approve(); await prepare({ prisma: db, input: { ...f.input, body: 'Changed synthetic body' } });
      await assert.rejects(f.send(), /draft_changed/); assert.equal(await f.count(), 0);
    });
    await check('cancelled draft survives a new Prisma client', async () => {
      const f = await fixture(); await f.approve(); await review({ ...f.options, action: 'cancel', actor });
      const restarted = new PrismaClient({ datasources: { db: { url } }, __internal: { configOverride: config => ({ ...config, relativeEnvPaths: {} }) } });
      try { await assert.rejects(prepare({ prisma: restarted, input: f.input }), /draft_cancelled/); } finally { await restarted.$disconnect(); }
      await assert.rejects(f.send(), /approval_required/); assert.equal(await f.count(), 0);
    });
    await check('unknown outcome remains held across repeated dispatch requests', async () => {
      const f = await fixture(); await f.approve(); const result = await f.send({ fetchImpl: async () => { await db.$executeRaw`INSERT INTO "SmsDispatchDrillTransport" ("caseId", "leg", "bodyHash") VALUES (${f.input.callId}, 'owner', 'synthetic-accepted-before-response-loss')`; throw Error('synthetic uncertain transport'); } });
      assert.equal(result.result.sent, false); const replay = await f.send(); assert.equal(replay.result.sent, false); assert.equal(await f.count(), 1);
    });
    await check('disabled manual gate cannot be enabled by legacy flag', async () => {
      const f = await fixture(); await f.approve(); await assert.rejects(f.send({ env: { ...env, SMS_MANUAL_DISPATCH_ENABLED: 'false', SMS_NOTIFICATION_DISPATCH_ENABLED: 'true' } }), /dispatch_disabled/);
      assert.equal(await f.count(), 0);
    });
    await check('automatic caller-confirmed admission needs no admin approval and sends once across clients', async () => {
      const f = await fixture();
      const other = new PrismaClient({ datasources: { db: { url } }, __internal: { configOverride: config => ({ ...config, relativeEnvPaths: {} }) } });
      const automatic = prisma => dispatchConfirmedNotification({ ...f.options, prisma,
        env: { ...env, SMS_MANUAL_DISPATCH_ENABLED: 'false', SMS_AUTOMATIC_DISPATCH_ENABLED: 'true' },
        authorize: data => data.contextHash === f.options.expectedHash, suppressionChecker: async () => false,
        fetchImpl: async () => {
          await db.$executeRaw`INSERT INTO "SmsDispatchDrillTransport" ("caseId", "leg", "bodyHash") VALUES (${f.input.callId}, 'owner', 'automatic-confirmed')`;
          return { ok: true, status: 201, json: async () => ({ sid: 'SM' + '3'.repeat(32), status: 'queued' }) };
        } });
      try { await Promise.allSettled([automatic(db), automatic(other), automatic(db)]); assert.equal(await f.count(), 1); }
      finally { await other.$disconnect(); }
    });
    await check('automatic admission respects a committed cancellation and rejects missing authorization', async () => {
      const f = await fixture();
      const options = { ...f.options, env: { ...env, SMS_AUTOMATIC_DISPATCH_ENABLED: 'true' },
        suppressionChecker: async () => false, fetchImpl: () => assert.fail('must not send') };
      await assert.rejects(dispatchConfirmedNotification(options), /caller_confirmation_required/);
      await review({ ...f.options, action: 'cancel', actor });
      await assert.rejects(dispatchConfirmedNotification({ ...options, authorize: () => true }), /already_admitted/);
      assert.equal(await f.count(), 0);
    });
    await check('expired draft content is redacted without deleting admission records', async () => {
      const before = Number((await db.$queryRaw`SELECT count(*) AS n FROM "RuntimeStore" WHERE key LIKE 'call-notification-dispatch:v1:%'`)[0].n);
      assert.ok(await redactExpiredNotificationDrafts({ prisma: db, now: Date.now() + 86400001 }) > 0);
      const after = Number((await db.$queryRaw`SELECT count(*) AS n FROM "RuntimeStore" WHERE key LIKE 'call-notification-dispatch:v1:%'`)[0].n);
      assert.equal(after, before);
    });
  } finally {
    await db.$disconnect();
    const fs = require('node:fs'), path = require('node:path');
    const directory = path.join(__dirname, '../diagnostics/sms-dispatch-postgres/manual-approval'); fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify({ commit: process.env.SMS_DISPATCH_DRILL_EXPECTED_HEAD,
      realPostgreSQL: true, realSms: 0, casesPassed: passed.length, requiredCases: 9, cases: passed, passed: passed.length === 9 }, null, 2) + '\n');
  }
});
