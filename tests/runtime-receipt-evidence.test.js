const test = require('node:test');
const assert = require('node:assert/strict');
const { inspectEvidence, projectEvidence } = require('../server/runtimeReceiptEvidence');
const at = '2026-10-24T12:00:00.000Z', id = 'a'.repeat(24), ref = 'b'.repeat(64);
const row = () => ({ id, severity: 'critical', reasonCode: 'DATABASE_QUERY_IMPLEMENTATION_FAILED',
  remediation: 'needs_user', occurrences: 2, firstDetectedAt: new Date(at), lastDetectedAt: new Date(at),
  workflow: 'saved Twilio delivery reports background job', providerCode: 'P2028', releaseCommit: 'c'.repeat(40),
  route: '/api/webhooks/voice', privateCustomer: 'PRIVATE_PHONE', message: 'PRIVATE_MESSAGE', credential: 'PRIVATE_SECRET' });
const saved = () => ({ key: 'twilio-status-inbox:' + ref, createdAt: new Date(at), updatedAt: new Date(at), data: {
  receipt: { MessageSid: 'SM' + 'd'.repeat(32), MessageStatus: 'delivered', To: 'PRIVATE_PHONE' },
  status: 'completed', attempts: 2, receivedAt: Date.parse(at), completedAt: Date.parse(at), lastErrorCode: '',
  token: 'PRIVATE_SECRET', body: 'PRIVATE_MESSAGE' } });
function db(rows = [row()], jobs = [saved()]) {
  const queries = [], reads = [];
  return { queries, reads, tx: { $queryRaw: async sql => { queries.push(String(sql)); return rows; },
    runtimeStore: { findMany: async args => { reads.push(args); return jobs; } } } };
}
test('projects bounded candidates without exporting messages, provider IDs or credentials', async () => {
  const d = db(), r = await inspectEvidence(d.tx);
  assert.equal(r.incidents[0].providerCode, 'P2028'); assert.equal(r.receiptWindows.length, 1);
  assert.equal(r.receiptWindows[0].jobs[0].jobRef, ref); assert.equal(r.receiptWindows[0].jobs[0].attempts, 2);
  assert.equal(r.receiptWindows[0].jobs[0].reportedDeliveryState, 'delivered');
  assert.equal(r.originalOperationOutcomes, 'unknown'); assert.equal(r.providerDeliveryVerified, false);
  assert.equal(r.incidentClosurePermitted, false); assert.equal(r.receiptWindows[0].correlation, 'time_window_candidates_only');
  assert.doesNotMatch(JSON.stringify(r), /PRIVATE_|MessageSid|SMdddd|credential|token|privateCustomer/);
  assert.match(d.queries[0], /LIMIT 21/); assert.doesNotMatch(d.queries[0], /SELECT \*|SELECT payload\b/);
  assert.equal(d.reads[0].take, 26); assert.equal(d.reads[0].where.OR[0].createdAt.gte.toISOString(), '2026-10-24T11:59:00.000Z');
});
test('distinct first and last detections produce separate candidate windows, not an audit trail', async () => {
  const d = db([{ ...row(), lastDetectedAt: new Date('2026-10-25T12:00:00.000Z') }]);
  const r = await inspectEvidence(d.tx); assert.equal(r.receiptWindows.length, 2);
  assert.deepEqual(r.receiptWindows.map(w => w.anchor), ['first_detected', 'last_detected']);
  assert.equal(r.historicalCoverage, 'not_an_audit_trail');
});
test('empty or truncated candidate searches never prove the original operation outcome', async () => {
  for (const jobs of [[], Array.from({ length: 26 }, () => saved())]) {
    const r = await inspectEvidence(db([row()], jobs).tx);
    assert.equal(r.receiptWindows[0].hasMore, jobs.length > 25);
    assert.equal(r.receiptWindows[0].jobs.length, Math.min(jobs.length, 25));
    assert.equal(r.originalOperationOutcomes, 'unknown'); assert.equal(r.providerDeliveryVerified, false);
  }
});
test('incident list and candidate queries have hard limits', async () => {
  const rows = Array.from({ length: 21 }, (_, n) => ({ ...row(), id: n.toString(16).padStart(24, '0'),
    lastDetectedAt: new Date('2026-10-25T12:00:00.000Z') }));
  const d = db(rows), r = await inspectEvidence(d.tx);
  assert.equal(r.incidents.length, 20); assert.equal(r.incidentsTruncated, true);
  assert.equal(r.receiptWindowsTruncated, true);
  assert.equal(d.reads.length, 8); assert.equal(r.receiptWindows.length, 8);
});
test('unknown/free-text scalar fields are removed at both server and CLI boundaries', async () => {
  const d = db([{ ...row(), reasonCode: 'PRIVATE_REASON', workflow: 'PRIVATE_WORKFLOW',
    providerCode: 'PRIVATE_SECRET', remediation: 'PRIVATE_EMAIL', route: 'PRIVATE_PHONE', releaseCommit: 'PRIVATE_TOKEN' }]);
  const r = await inspectEvidence(d.tx); assert.equal(r.incidents[0].reasonCode, 'unknown');
  assert.doesNotMatch(JSON.stringify(r), /PRIVATE_/);
  const clean = await inspectEvidence(db().tx);
  clean.incidents[0].extra = 'PRIVATE_SECRET'; clean.receiptWindows[0].jobs[0].extra = 'PRIVATE_PHONE';
  clean.originalOperationOutcomes = 'delivered'; clean.providerDeliveryVerified = true;
  assert.doesNotMatch(JSON.stringify(projectEvidence(clean)), /PRIVATE_/);
  assert.equal(projectEvidence(clean).providerDeliveryVerified, false);
});
test('incomplete metadata cannot be promoted to complete by the CLI projection', async () => {
  const r = await inspectEvidence(db().tx); r.receiptWindows[0].jobs[0].jobState = 'PRIVATE_STATE';
  assert.equal(projectEvidence(r).receiptWindows[0].metadataComplete, false);
});
test('database failure fails closed without invoking fallback/actions', async () => {
  await assert.rejects(inspectEvidence({ $queryRaw: async () => { throw Error('synthetic database failure'); } }));
  await assert.rejects(inspectEvidence(db([{ ...row(), id: 'PRIVATE_ID' }]).tx));
  assert.throws(() => projectEvidence({ schemaVersion: 2 }));
});
