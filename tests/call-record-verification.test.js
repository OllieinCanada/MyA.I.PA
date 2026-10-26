const { test } = require('node:test');
const assert = require('node:assert/strict');
const { inspectCallRecord, parseQuery, verificationHandler } = require('../server/callRecordVerification');
const query = { callId: '12345678-1234-7000-8000-123456789abc', businessId: '37' };
const row = { id: 4, businessId: 37, callerId: 8, status: 'COMPLETED', durationSec: 116,
  startedAt: new Date('2026-10-26T17:29:21Z'), endedAt: new Date('2026-10-26T17:31:17Z'),
  endedReason: 'customer-ended-call', twilioCallSid: 'CA' + '1'.repeat(32),
  transcript: 'PRIVATE_TRANSCRIPT', recordingUrl: 'PRIVATE_RECORDING', phone: 'PRIVATE_PHONE',
  token: 'PRIVATE_TOKEN' };
function fixture(rows = [row], count = 1) {
  const reads = [], commands = [];
  const tx = { $executeRawUnsafe: async sql => { commands.push(sql); }, call: {
    findMany: async args => { reads.push(args); return structuredClone(rows); },
    count: async args => { reads.push(args); return count; },
  } };
  const prisma = { $transaction: async (fn, options) => {
    assert.deepEqual(options, { maxWait: 500, timeout: 2500, isolationLevel: 'RepeatableRead' }); return fn(tx);
  } };
  return { prisma, reads, commands, inspect: change => inspectCallRecord({ prisma, query, ...change }) };
}
test('one exact saved record verifies inside a bounded read-only transaction with a privacy projection', async () => {
  const f = fixture(); const report = await f.inspect();
  assert.equal(report.savedRecordVerified, true); assert.equal(report.liveProviderVerified, false);
  assert.equal(report.record.durationSec, 116); assert.match(report.callRef, /^[a-f0-9]{64}$/);
  assert.deepEqual(f.commands, ['SET TRANSACTION READ ONLY', "SET LOCAL statement_timeout = '1500ms'"]);
  assert.deepEqual(f.reads[0].where, { externalProvider: 'vapi', externalId: query.callId });
  assert.equal(f.reads[0].take, 2); assert.equal(f.reads[0].select.transcript, undefined);
  assert.deepEqual(f.reads[1], { where: { twilioCallSid: row.twilioCallSid } });
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE|12345678|CA1111|businessId|callerId|"id"/);
});
test('missing and conflicting records never pass and never query a carrier identity', async () => {
  for (const rows of [[], [row, { ...row, id: 5 }]]) {
    const f = fixture(rows); const r = await f.inspect();
    assert.equal(r.savedRecordVerified, false); assert.equal(r.record, null); assert.equal(f.reads.length, 1);
    assert.equal(r.checks.providerRecord, rows.length ? 'conflict' : 'missing');
  }
});
test('wrong business suppresses saved metadata and does not query carrier identifiers', async () => {
  const f = fixture([{ ...row, businessId: 99 }]); const r = await f.inspect();
  assert.equal(r.checks.businessOwnership, 'mismatch'); assert.equal(r.record, null);
  assert.equal(r.savedRecordVerified, false); assert.equal(f.reads.length, 1);
});
test('missing or duplicated carrier identity cannot pass as one canonical physical call', async () => {
  for (const [changes, count] of [[{ twilioCallSid: null }, 1], [{}, 2], [{}, 0], [{}, undefined]]) {
    const f = fixture([{ ...row, ...changes }], count); if (count === undefined) f.prisma.$transaction = async fn => fn({
      $executeRawUnsafe: async () => {}, call: { findMany: async () => [{ ...row }], count: async () => undefined } });
    assert.equal((await f.inspect()).savedRecordVerified, false);
  }
});
for (const [label, change] of [
  ['failed setup', { status: 'FAILED', durationSec: 0, endedReason: 'assistant-request-returned-error' }],
  ['unfinished record', { status: 'STARTED', endedAt: null }],
  ['zero duration', { durationSec: 0 }], ['inconsistent duration', { durationSec: 10000 }],
  ['unknown end reason', { endedReason: 'PRIVATE_END_REASON' }], ['unknown status', { status: 'PRIVATE_STATUS' }],
  ['invalid dates', { endedAt: new Date('invalid') }], ['missing caller linkage', { callerId: null }],
]) test(`${label} stays unverified`, async () => {
  const r = await fixture([{ ...row, ...change }]).inspect(); assert.equal(r.savedRecordVerified, false);
  assert.doesNotMatch(JSON.stringify(r), /PRIVATE/);
});
test('query parser rejects enumeration, action flags, duplicate values and malformed identity before any read', async () => {
  for (const invalid of [{}, { ...query, apply: 'true' }, { ...query, callId: [query.callId] },
    { ...query, businessId: ['37'] }, { ...query, businessId: '0' }, { ...query, businessId: '2147483648' },
    { ...query, callId: 'all' }, { ...query, callId: query.callId.toUpperCase() }, { ...query, limit: '100' }]) {
    assert.throws(() => parseQuery(invalid)); const f = fixture();
    await assert.rejects(f.inspect({ query: invalid })); assert.equal(f.reads.length, 0); assert.equal(f.commands.length, 0);
  }
});
test('database failure returns static unknown evidence without raw exceptions', async () => {
  const prisma = { $transaction: async () => { throw Error('PRIVATE_DATABASE_CREDENTIAL'); } };
  const res = { code: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await verificationHandler({ prisma })({ query }, res);
  assert.equal(res.code, 503); assert.equal(res.body.verification, 'unknown');
  assert.equal(res.headers['Cache-Control'], 'no-store'); assert.doesNotMatch(JSON.stringify(res.body), /PRIVATE/);
});
