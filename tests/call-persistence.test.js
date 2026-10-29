const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveCallRecord, isUniqueFailure, assertCallIdentity, mergeCallData, persistCall, persistCaller } = require('../server/callPersistence');
const identity = { businessId: 37, callerId: 4, externalProvider: 'vapi', externalId: 'test-call', twilioCallSid: 'CA-test' };
const data = { ...identity, status: 'COMPLETED', durationSec: 90, endedReason: 'customer-ended-call' };
const unique = modelName => Object.assign(Error('synthetic unique collision'), { code: 'P2002', meta: { modelName, target: modelName === 'Caller' ? ['phone'] : ['twilioCallSid'] } });

function fakeDatabase(initial = []) {
  const rows = new Map(initial.map(r => [r.id, { ...r }]));
  const queries = []; let transactions = 0;
  const call = {
    findMany: async ({ where }) => [...rows.values()].filter(r => where.OR.some(clause => Object.entries(clause).every(([k,v]) => r[k] === v))).map(r => ({ ...r })),
    findUnique: async ({ where }) => rows.has(where.id) ? { ...rows.get(where.id) } : null,
    create: async ({ data: input, include }) => {
      assert.equal(include, undefined, 'relation fetching belongs outside the locked transaction');
      if ([...rows.values()].some(r => r.twilioCallSid === input.twilioCallSid || (r.externalId === input.externalId && r.externalProvider === input.externalProvider))) throw unique('Call');
      const row = { id: rows.size + 1, ...input }; rows.set(row.id, row); return { ...row };
    },
    update: async ({ where, data: input, include }) => { assert.equal(include, undefined); const row = { ...rows.get(where.id), ...input }; rows.set(where.id, row); return { ...row }; },
  };
  const db = { call, $transaction: async (fn, options) => {
    transactions++; assert.ok(options.timeout <= 3000); assert.ok(options.maxWait <= 500);
    return fn({ call, $queryRaw: async (query) => {
      const sql = (query.strings || query).join('?'); queries.push(sql);
      if (!sql.includes('FOR UPDATE')) return [];
      const values = [...query.values], clauses = [];
      if (sql.includes('c.id =')) clauses.push({ id: values.shift() });
      if (sql.includes('c."externalProvider" =')) clauses.push({ externalProvider: values.shift(), externalId: values.shift() });
      if (sql.includes('c."twilioCallSid" =')) clauses.push({ twilioCallSid: values.shift() });
      return call.findMany({ where: { OR: clauses } });
    } });
  } };
  return { db, rows, queries, transactions: () => transactions };
}
const write = (db, input = data, id = identity) => persistCall({ db, identity: id, createData: input, updateData: existing => mergeCallData(existing, input) });

test('concurrent call receipts reconcile a unique-key race in a new transaction', async () => {
  const fake = fakeDatabase();
  const results = await Promise.all([write(fake.db), write(fake.db)]);
  assert.equal(fake.rows.size, 1);
  assert.equal(results[0].id, results[1].id);
  assert.equal(fake.transactions(), 3);
  assert.ok(fake.queries.some(q => q.includes('FOR UPDATE')));
});

test('updates use only configuration, one locked identity read and one scalar write', async () => {
  const fake = fakeDatabase([{ id: 1, ...data }]);
  fake.db.call.findUnique = async () => assert.fail('no redundant relation re-read inside transaction');
  const saved = await write(fake.db);
  assert.equal(saved.id, 1);
  assert.equal(fake.transactions(), 1);
  assert.equal(fake.queries.length, 2);
  assert.match(fake.queries[1], /ORDER BY c.id FOR UPDATE OF c/);
});

test('provider identifiers remain bound values, not interpolated SQL', async () => {
  const externalId = "call-' OR 1=1 --";
  const fake = fakeDatabase([{ id: 1, ...data, externalId }]);
  await write(fake.db, { ...data, externalId }, { ...identity, externalId });
  assert.equal(fake.rows.size, 1);
  assert.ok(fake.queries.every(sql => !sql.includes(externalId)));
});
test('a first-time caller upsert race reuses the exact existing phone', async () => {
  const caller = { id: 4, phone: '+15555550100', name: null };
  let updates = 0;
  const db = { caller: { upsert: async () => { throw unique('Caller'); }, findUnique: async ({where}) => { assert.equal(where.phone, caller.phone); return caller; },
    update: async ({where,data}) => { updates++; assert.equal(where.id,4); return {...caller,...data}; } } };
  assert.deepEqual(await persistCaller(db, {phone: caller.phone, name: null}), caller);
  assert.equal((await persistCaller(db, {phone: caller.phone, name: 'Test caller'})).name, 'Test caller');
  assert.equal(updates, 1);
});
test('unrelated caller failures are never treated as a successful replay', async () => {
  await assert.rejects(persistCaller({caller:{upsert:async()=>{throw Error('database unavailable');}}},{phone:'test'}), /database unavailable/);
});
test('one matching Twilio SID cannot move a call to another business or caller', async () => {
  for (const changed of [{businessId: 99}, {callerId: 99}, {externalId:'another-call'}]) {
    const fake = fakeDatabase([{id:1,...data}]);
    await assert.rejects(write(fake.db, {...data,...changed}, {...identity,...changed}), {code:'CALL_RECORD_IDENTITY_CONFLICT'});
    assert.deepEqual(fake.rows.get(1), {id:1,...data});
  }
});
test('two different matching records are not merged blindly', async () => {
  const fake=fakeDatabase([{id:1,...data,twilioCallSid:'CA-other'}, {id:2,...data,externalId:'other-call'}]);
  await assert.rejects(write(fake.db), {code:'CALL_RECORD_IDENTITY_CONFLICT'});
  assert.equal(fake.rows.size,2);
});
test('an exact carrier record may be promoted to its proven Vapi identity', () => {
  assert.doesNotThrow(()=>assertCallIdentity({...data,externalProvider:'twilio',externalId:'CA-test'},identity));
  assert.throws(()=>assertCallIdentity({...data,externalProvider:'twilio',externalId:'CA-other'},identity),{code:'CALL_RECORD_IDENTITY_CONFLICT'});
});
test('a synthetic unknown caller may be enriched only for the exact saved Vapi call', () => {
  assert.doesNotThrow(()=>assertCallIdentity({...data,callerId:9,caller:{phone:'unknown-vapi-test-call'}},identity));
  assert.throws(()=>assertCallIdentity({...data,callerId:9,caller:{phone:'unknown-vapi-other-call'}},identity),{code:'CALL_RECORD_IDENTITY_CONFLICT'});
});
test('sparse and out-of-order events preserve terminal details and reviewed outcome', async () => {
  const existing={id:1,...data,status:'FAILED',durationSec:90,endedAt:new Date('2026-10-26T14:32:00Z'),outcome:'FOLLOW_UP',aiSummary:'Detailed report',artifactMessages:[{role:'assistant'}],qualityScore:75};
  const fake=fakeDatabase([existing]);
  const next={...identity,status:'STARTED',endedAt:null,durationSec:null,outcome:'UNREVIEWED',aiSummary:'',artifactMessages:[]};
  const saved=await write(fake.db,next);
  assert.equal(saved.status,'FAILED'); assert.equal(saved.durationSec,90);
  assert.equal(saved.endedAt.getTime(),existing.endedAt.getTime());
  assert.equal(saved.outcome,'FOLLOW_UP');assert.equal(saved.aiSummary,'Detailed report');
  assert.deepEqual(saved.artifactMessages,existing.artifactMessages);
});
test('a generic completed event with no conversation cannot erase a failed setup', () => {
  const saved=mergeCallData({status:'FAILED',endedReason:'assistant-request-returned-error'}, {status:'COMPLETED',durationSec:null,endedReason:null});
  assert.equal(saved.status,'FAILED');assert.equal(saved.endedReason,'assistant-request-returned-error');
});
test('a database outage is not retried as if it were a duplicate event', async () => {
  let attempts=0;const db={$transaction:async()=>{attempts++;throw Error('offline');}};
  await assert.rejects(write(db), /offline/);assert.equal(attempts,1);
});

for (const [label, change] of [
  ['partial provider identity', { externalId: null }],
  ['partial external identity', { externalProvider: null }],
  ['invalid business', { businessId: 0 }],
  ['invalid local id', { callId: 'not-a-number' }],
]) test(`invalid ${label} fails before database work`, async () => {
  const fake = fakeDatabase();
  await assert.rejects(write(fake.db, data, { ...identity, ...change }), { code: 'CALL_RECORD_IDENTITY_CONFLICT' });
  assert.equal(fake.transactions(), 0);
  assert.equal(fake.rows.size, 0);
});
test('partial saved provider binding cannot be silently overwritten through its carrier SID', async () => {
  const fake = fakeDatabase([{ id: 1, ...data, externalId: null }]);
  await assert.rejects(write(fake.db), { code: 'CALL_RECORD_IDENTITY_CONFLICT' });
  assert.equal(fake.rows.get(1).externalId, null);
});
test('local id and provider identity naming different rows is an ambiguity, not an update preference', async () => {
  const fake = fakeDatabase([{ id: 1, ...data }, { id: 2, ...data, externalId: 'other', twilioCallSid: 'CA-other' }]);
  await assert.rejects(resolveCallRecord(fake.db, { ...identity, callId: 2 }), { code: 'CALL_RECORD_IDENTITY_CONFLICT' });
});
test('read-only carrier lookup preserves canonical caller before a sparse Vapi event is enriched', async () => {
  const fake = fakeDatabase([{ id: 1, ...data, externalProvider: null, externalId: null, caller: { phone: '+15555550100' } }]);
  const found = await resolveCallRecord(fake.db, { ...identity, callerId: undefined });
  assert.equal(found.callerId, 4);
  assert.equal(found.caller.phone, '+15555550100');
  assert.equal(fake.transactions(), 0);
});
test('only recognized identity unique constraints qualify for race recovery', () => {
  assert.equal(isUniqueFailure(unique('Call'), 'Call'), true);
  assert.equal(isUniqueFailure({ code: 'P2002', meta: { target: 'Call_externalProvider_externalId_key' } }, 'Call'), true);
  for (const target of [undefined, ['id'], ['externalProvider'], ['twilioCallSid', 'other'], 'unrelated_twilioCallSid_index']) {
    assert.equal(isUniqueFailure({ code: 'P2002', meta: { modelName: 'Call', target } }, 'Call'), false);
  }
});
