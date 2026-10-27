const test = require('node:test');
const assert = require('node:assert/strict');
test('PostgreSQL completion metadata and aggregate probe use a real read-only transaction',
  { skip: process.env.RUN_DATABASE_INTEGRATION !== '1' }, async () => {
  const { PrismaClient } = require('@prisma/client');
  const { KEY, saveCompletion } = require('../server/callSyncReceipt');
  const { inspectPostRelease } = require('../server/postReleaseVerification');
  const db = new PrismaClient(); const releaseCommit = 'c'.repeat(40); const now = Date.now();
  try {
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
    const row = await db.runtimeStore.findUnique({ where: { key: KEY } }); assert.equal(row.data.releaseCommit, releaseCommit);
  } finally { await db.runtimeStore.deleteMany({ where: { key: KEY } }); await db.$disconnect(); }
});
