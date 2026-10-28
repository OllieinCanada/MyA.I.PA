const test = require('node:test');
const assert = require('node:assert/strict');
test('PostgreSQL completion metadata and aggregate probe use a real read-only transaction',
  { skip: process.env.RUN_DATABASE_INTEGRATION !== '1' }, async () => {
  const { PrismaClient } = require('@prisma/client');
  const { KEY, saveCompletion } = require('../server/callSyncReceipt');
  const { inspectPostRelease } = require('../server/postReleaseVerification');
  const db = new PrismaClient(); const releaseCommit = 'c'.repeat(40); const now = Date.now();
  const crypto = require('node:crypto');
  const incidentId = crypto.randomBytes(12).toString('hex'), ref = crypto.randomBytes(32).toString('hex');
  const receiptKey = 'twilio-status-inbox:' + ref;
  try {
    await db.runtimeIncidentRecord.create({ data: { id: incidentId, fingerprint: incidentId,
      severity: 'critical', reasonCode: 'DATABASE_QUERY_IMPLEMENTATION_FAILED', remediation: 'needs_user',
      firstDetectedAt: new Date(now - 1000), lastDetectedAt: new Date(now - 1000),
      payload: { snapshot: { Workflow: 'saved Twilio delivery reports background job', 'Provider code': 'P2028' },
        privateCustomer: 'PRIVATE_CUSTOMER', token: 'PRIVATE_SECRET' } } });
    await db.runtimeStore.create({ data: { key: receiptKey, data: { status: 'completed', attempts: 2,
      receivedAt: now - 2000, completedAt: now - 1000, lastErrorCode: '',
      receipt: { MessageSid: 'SM' + crypto.randomBytes(16).toString('hex'), MessageStatus: 'delivered' } } } });
    await saveCompletion({ prisma: db, releaseCommit, startedAt: new Date(now - 2000).toISOString(),
      completedAt: new Date(now - 1000).toISOString(), fetched: 1, synced: 1, skippedUnmapped: 0 });
    let readOnly;
    const prisma = { $transaction: (fn, options) => db.$transaction(async tx => {
      const execute = tx.$executeRawUnsafe.bind(tx);
      return fn(new Proxy(tx, { get(target, prop) { if (prop === '$executeRawUnsafe') return async sql => {
        const r = await execute(sql);
        if (sql === 'SET TRANSACTION READ ONLY') {
          const rows = await tx.$queryRawUnsafe("SELECT current_setting('transaction_read_only') AS value");
          readOnly = rows[0].value;
        }
        return r;
      }; const v = target[prop]; return typeof v === 'function' ? v.bind(target) : v; } }));
    }, options) };
    const result = await inspectPostRelease({ prisma, releaseCommit, now });
    assert.equal(readOnly, 'on'); assert.equal(result.sync.completedOnRelease, true);
    assert.equal(result.sms.originalOperationOutcomes, 'unknown'); assert.equal(result.sms.incidentClosurePermitted, false);
    assert.equal(result.investigation.incidents.find(i => i.id === incidentId).providerCode, 'P2028');
    const window = result.investigation.receiptWindows.find(w => w.incidentId === incidentId);
    assert.equal(window.correlation, 'time_window_candidates_only'); assert.equal(window.jobs.find(j => j.jobRef === ref).attempts, 2);
    assert.equal(result.investigation.providerDeliveryVerified, false);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|MessageSid/);
    const row = await db.runtimeStore.findUnique({ where: { key: KEY } }); assert.equal(row.data.releaseCommit, releaseCommit);
  } finally { await db.runtimeStore.deleteMany({ where: { key: { in: [KEY, receiptKey] } } });
    await db.runtimeIncidentRecord.deleteMany({ where: { id: incidentId } }); await db.$disconnect(); }
});
