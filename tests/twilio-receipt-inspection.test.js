const test = require('node:test');
const assert = require('node:assert/strict');
const { inspectReceiptState, parseInspectionQuery, receiptInspectionHandler } = require('../server/twilioReceiptInspection');
const ref = 'a'.repeat(64), prefix = 'twilio-status-inbox:';
const from = '2026-10-20T00:00:00Z', to = '2026-10-21T00:00:00Z';
function fixture(changes = {}) {
  return { key: prefix + ref, createdAt: new Date(from), updatedAt: new Date(to), data: {
    status: 'completed', receipt: { MessageStatus: 'delivered', MessageSid: 'PRIVATE_MESSAGE_ID', Body: 'PRIVATE_CONTENT' },
    attempts: 2, receivedAt: Date.parse(from), completedAt: Date.parse(to), lastErrorCode: '', token: 'PRIVATE_TOKEN', ...changes,
  } };
}

test('exact job read uses only findUnique and strips all customer/provider identifiers', async () => {
  const row = fixture();row.customerEmail = 'PRIVATE_EMAIL';
  const before = structuredClone(row);
  const prisma = { runtimeStore: { findUnique: async args => {
    assert.deepEqual(args.where, { key: prefix + ref });return row;
  } } };
  const r = await inspectReceiptState({ prisma, query: { jobRef: ref } });
  assert.equal(r.jobs[0].jobState, 'completed');assert.equal(r.jobs[0].reportedDeliveryState, 'delivered');
  assert.equal(r.originalOperationOutcome, 'unknown');assert.equal(r.providerDeliveryVerified, false);
  assert.equal(r.historicalCoverage, 'not_an_audit_trail');assert.equal(r.metadataComplete, true);
  assert.doesNotMatch(JSON.stringify(r), /PRIVATE|MessageSid|Body|customerEmail/);
  assert.deepEqual(row, before);
});

test('window search is bounded, parameterized and uses stable keyset pagination', async () => {
  const rows = Array.from({ length: 26 }, (_, i) => ({ ...fixture(), key: prefix + i.toString(16).padStart(64, '0') }));
  let args;
  const r = await inspectReceiptState({ prisma: { runtimeStore: { findMany: async a => { args = a;return rows; } } },
    query: { from, to, cursor: ref } });
  assert.equal(args.take, 26);assert.deepEqual(args.orderBy, { key: 'asc' });
  assert.equal(args.where.key.startsWith, prefix);assert.equal(args.where.key.gt, prefix + ref);
  assert.deepEqual(args.where.OR[0].createdAt, { gte: new Date(from), lt: new Date(to) });
  assert.equal(r.jobs.length, 25);assert.equal(r.pagination.hasMore, true);
  assert.equal(r.pagination.nextCursor, (24).toString(16).padStart(64, '0'));
  assert.equal(r.selection, 'time_window_candidates');
});

test('missing exact job and empty windows never imply historical recovery or delivery', async () => {
  for (const [query, runtimeStore] of [[{jobRef:ref},{findUnique:async()=>null}], [{from,to},{findMany:async()=>[]}]]) {
    const r=await inspectReceiptState({prisma:{runtimeStore},query});
    assert.deepEqual(r.jobs,[]);assert.equal(r.metadataComplete,false);assert.equal(r.originalOperationOutcome,'unknown');assert.equal(r.providerDeliveryVerified,false);
  }
});

test('malformed and extra query parameters fail before touching the database', async () => {
  const bad=[{}, {jobRef:'SM'+'a'.repeat(32)}, {jobRef:ref,from}, {from,to,cursor:['a']},
    {from,to,apply:'true'}, {from,to:'2026-10-22T00:00:00Z'}, {from:to,to:from},
    {from:'2026-02-30T00:00:00Z',to}, {from:from.replace('Z','+00:00'),to}, {jobRef:{equals:ref}}, null];
  for(const query of bad) await assert.rejects(inspectReceiptState({prisma:{},query}),/invalid_receipt_inspection_query/);
  assert.equal(parseInspectionQuery({from:'2026-10-20T00:00:00.000Z',to}).mode,'time_window_candidates');
});

test('corrupt saved metadata stays unknown without reflecting raw values', async () => {
  const r=await inspectReceiptState({prisma:{runtimeStore:{findUnique:async()=>fixture({status:'PRIVATE_STATUS',receipt:{MessageStatus:'PRIVATE_STATE'},attempts:'PRIVATE',receivedAt:Infinity,lastErrorCode:'PRIVATE_ERROR'})}},query:{jobRef:ref}});
  assert.equal(r.metadataComplete,false);assert.equal(r.jobs[0].jobState,'unknown');assert.equal(r.jobs[0].attempts,null);
  assert.equal(r.jobs[0].receivedAt,null);assert.equal(r.jobs[0].lastErrorCode,'unknown');assert.doesNotMatch(JSON.stringify(r),/PRIVATE/);
});

test('only finite source error enums are exported', async () => {
  const r=await inspectReceiptState({prisma:{runtimeStore:{findUnique:async()=>fixture({status:'failed',lastErrorCode:'P2028'})}},query:{jobRef:ref}});
  assert.equal(r.jobs[0].jobState,'failed');assert.equal(r.jobs[0].lastErrorCode,'P2028');
});

test('metadata completeness is state-aware and never treats missing evidence as passing', async () => {
  for (const changes of [{completedAt:null}, {status:'processing',leaseExpiresAt:null},
    {status:'pending',nextAttemptAt:null}, {status:'failed',lastErrorCode:''}, {status:'failed',lastErrorCode:'UNRECOGNIZED_PRIVATE_VALUE'}]) {
    const r=await inspectReceiptState({prisma:{runtimeStore:{findUnique:async()=>fixture(changes)}},query:{jobRef:ref}});
    assert.equal(r.metadataComplete,false);assert.equal(r.originalOperationOutcome,'unknown');
    assert.doesNotMatch(JSON.stringify(r),/UNRECOGNIZED_PRIVATE_VALUE/);
  }
});

test('handler failures are static, non-cacheable and do not enter incident capture', async () => {
  for(const [query,code] of [[{jobRef:ref},503],[{},400]]) {
    let result,status=200;const headers={};
    const res={setHeader:(k,v)=>{headers[k]=v;},status:n=>{status=n;return res;},json:r=>{result=r;return r;}};
    await receiptInspectionHandler({prisma:{runtimeStore:{findUnique:async()=>{throw Error('PRIVATE_CREDENTIAL_DB_URL');}}}})({query},res);
    assert.equal(status,code);assert.equal(headers['Cache-Control'],'no-store');
    assert.equal(result.originalOperationOutcome,'unknown');assert.doesNotMatch(JSON.stringify(result),/PRIVATE|CREDENTIAL/);
  }
});
