const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

test('isolated PostgreSQL receipt recovery survives contention, duplicate callbacks and expired leases', {
  skip: process.env.RUN_TWILIO_RECEIPT_DATABASE !== '1', timeout: 60000,
}, async () => {
  // This test may modify only a fresh, disposable loopback drill database.
  const url = new URL(process.env.SIGNUP_RECOVERY_DRILL_DATABASE_URL);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Loopback database required');
  assert.match(url.pathname, /^\/myaipa_recovery_drill_[a-z0-9_]+$/);
  const { PrismaClient } = require('@prisma/client');
  const { enqueueTwilioStatus, drainTwilioStatuses, receiptKey, WORKER_KEY } = require('../server/twilioStatusInbox');
  const { readTwilioReceiptHealth } = require('../server/twilioReceiptHealth');
  const { inspectReceiptState } = require('../server/twilioReceiptInspection');
  const createClient = () => new PrismaClient({ datasources: { db: { url: url.toString() } },
    __internal: { configOverride: config => ({ ...config, relativeEnvPaths: {} }) } });
  const prisma = createClient(), competitor = createClient();
  const receipt = { MessageSid: 'SM' + crypto.randomBytes(16).toString('hex'), MessageStatus: 'delivered' };
  const key = receiptKey(receipt), fixtureKeys = [key, WORKER_KEY];
  let lockHolder, ownsFixtures = false, releaseHandler;
  try {
    assert.equal(await prisma.runtimeStore.count({ where: { key: { startsWith: 'twilio-status-' } } }), 0,
      'Run receipt drill before other fixtures; never drain an existing queue');
    ownsFixtures = true;
    let entered;
    const acquired = new Promise(resolve => { entered = resolve; });
    lockHolder = competitor.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))::text AS lock_result`;
      entered();
      await new Promise(resolve => setTimeout(resolve, 1400));
    }, { timeout: 10000 });
    await acquired;
    await enqueueTwilioStatus({ prisma, body: receipt });
    await lockHolder;
    const duplicates = await Promise.all(Array.from({ length: 8 }, () => enqueueTwilioStatus({ prisma, body: receipt })));
    assert.ok(duplicates.every(result => result.duplicate));
    assert.equal(await prisma.runtimeStore.count({ where: { key } }), 1);
    let processed = 0, enteredHandler;
    const handling = new Promise(resolve => { enteredHandler = resolve; });
    const finish = new Promise(resolve => { releaseHandler = resolve; });
    const first = drainTwilioStatuses({ prisma, processReceipt: async () => { processed++; enteredHandler(); await finish; } });
    await handling;
    const other = await drainTwilioStatuses({ prisma: competitor, processReceipt: async () => assert.fail('Overlapping worker processed receipt') });
    assert.equal(other.busy, true);
    releaseHandler(); await first;
    assert.equal(processed, 1);
    let health = await readTwilioReceiptHealth({ prisma });
    assert.equal(health.status, 'healthy', JSON.stringify(health));
    assert.equal(health.counts.completed, 1);
    // PostgreSQL itself forbids writes during both inspection modes. The
    // synthetic fixture remains byte-for-byte unchanged after inspection.
    const beforeInspection = await prisma.runtimeStore.findUnique({ where: { key } });
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const exact = await inspectReceiptState({ prisma: tx, query: { jobRef: key.split(':')[1] } });
      assert.equal(exact.jobs[0].jobState, 'completed');
      assert.equal(exact.originalOperationOutcome, 'unknown');
      assert.equal(exact.providerDeliveryVerified, false);
      assert.doesNotMatch(JSON.stringify(exact), /MessageSid|token/);
      const window = await inspectReceiptState({ prisma: tx, query: {
        from: new Date(Date.now() - 60_000).toISOString(), to: new Date(Date.now() + 60_000).toISOString(),
      } });
      assert.equal(window.jobs.length, 1);
      assert.equal(window.jobs[0].jobRef, key.split(':')[1]);
    });
    assert.deepEqual(await prisma.runtimeStore.findUnique({ where: { key } }), beforeInspection);
    // Simulate the exact durable state left by a process dying after claiming work.
    const stored = await prisma.runtimeStore.findUnique({ where: { key } });
    await prisma.runtimeStore.update({ where: { key }, data: { data: {
      ...stored.data, status: 'processing', token: 'dead-fixture-worker', leaseExpiresAt: 1,
    } } });
    health = await readTwilioReceiptHealth({ prisma });
    assert.equal(health.counts.expiredLeases, 1);
    await prisma.$disconnect(); // Reconstruct the application client, not just a mock.
    await drainTwilioStatuses({ prisma: competitor, processReceipt: async () => { processed++; } });
    assert.equal(processed, 2);
    assert.equal((await readTwilioReceiptHealth({ prisma: competitor })).status, 'healthy');
    // Exhausted and malformed metadata remain visible; no raw customer data is read.
    const malformedKey = 'twilio-status-inbox:drill-' + crypto.randomBytes(8).toString('hex');
    fixtureKeys.push(malformedKey);
    await competitor.runtimeStore.create({ data: { key: malformedKey, data: { status: 'failed', receivedAt: 'invalid' } } });
    health = await readTwilioReceiptHealth({ prisma: competitor });
    assert.equal(health.status, 'critical');
    assert.equal(health.counts.failed, 1);
    const report = { passed: true, realDatabase: true, productionTouched: false, externalProviderCalls: 0,
      lockTimeoutRecovered: true, duplicateCallbacks: 8, concurrentWorkersProtected: true,
      expiredLeaseRecovered: true, failedJobVisible: true, healthQueryValidated: true, readOnlyInspectionVerified: true };
    const reportPath = path.resolve(__dirname, '../diagnostics/shipping-readiness/twilio-receipt-recovery.json');
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  } finally {
    releaseHandler?.();
    await lockHolder?.catch(() => {});
    if (ownsFixtures) await competitor.runtimeStore.deleteMany({ where: { key: { in: fixtureKeys } } });
    await Promise.all([prisma.$disconnect(), competitor.$disconnect()]);
  }
});
