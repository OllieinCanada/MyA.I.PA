const assert = require('node:assert/strict');
const test = require('node:test');
const { summarizeReceiptHealth, readTwilioReceiptHealth, withTwilioReceiptAttention } = require('../server/twilioReceiptHealth');

test('receipt health exposes counts and timestamps without message contents', () => {
 const now = 1000000;
 const result = summarizeReceiptHealth({ now, counts: { pending: 2, completed: 10, oldestPendingAt: now - 121000 },
   worker: { lastSuccessfulRunAt: now - 5000, receipt: { MessageSid: 'private' }, token: 'secret' } });
 assert.equal(result.status, 'warning');
 assert.equal(result.oldestPendingAgeSeconds, 121);
 assert.equal(result.counts.pending, 2);
 assert.doesNotMatch(JSON.stringify(result), /private|secret|MessageSid/);
 assert.equal(summarizeReceiptHealth({ now, counts: { failed: 1 }, worker: { lastSuccessfulRunAt: now } }).status, 'critical');
 assert.equal(summarizeReceiptHealth({ now, counts: { oldestPendingAt: now - 601000 }, worker: { lastSuccessfulRunAt: now } }).status, 'critical');
 assert.equal(summarizeReceiptHealth({ now, worker: { lastSuccessfulRunAt: now - 601000 } }).status, 'critical');
 assert.equal(summarizeReceiptHealth({ now }).status, 'unknown');
});

test('unconfirmed or delayed worker health appears in attention without closing historical incidents', () => {
 const inbox = { generatedAt: '2026-10-24T00:00:00Z', items: [{ id: 'history', kind: 'runtime_incident', severity: 'critical' }] };
 const health = { status: 'unavailable', reason: 'receipt_health_not_confirmed' };
 const result = withTwilioReceiptAttention(inbox, health, 1000000);
 assert.equal(result.summary.bySeverity.critical, 1);
 assert.equal(result.summary.bySeverity.warning, 1);
 assert.equal(result.summary.healthy, false);
 assert.match(result.items[0].id, /^[a-f0-9]{24}$/);
 assert.deepEqual(result.items[0].actions, []);
 assert.equal(result.items[1].id, 'history');
 assert.equal(withTwilioReceiptAttention(result, health).items.length, 2, 'Repeated snapshots do not duplicate the queue issue');
 const recovered = withTwilioReceiptAttention(result, { status: 'healthy' });
 assert.deepEqual(recovered.items, inbox.items, 'A healthy queue must not dismiss the original incident');
});

test('database health query aggregates only receipt metadata and fails closed', async () => {
 const now = 1000000;
 const prisma = { runtimeStore: { findUnique: async () => ({ data: { lastSuccessfulRunAt: now } }) },
   $queryRaw: async strings => {
     const sql = strings.join('');
     assert.match(sql, /COUNT\(\*\) FILTER/);
     assert.doesNotMatch(sql, /MessageSid|receipt'|Body|phone/);
     return [{ pending: 0, completed: 10, failed: 0 }];
   } };
 assert.equal((await readTwilioReceiptHealth({ prisma, now })).status, 'healthy');
 prisma.$queryRaw = async () => { throw Error('secret connection details'); };
 const unavailable = await readTwilioReceiptHealth({ prisma, now });
 assert.equal(unavailable.status, 'unavailable');
 assert.doesNotMatch(JSON.stringify(unavailable), /secret connection/);
});
