const test = require('node:test');
const assert = require('node:assert/strict');
const { persistCallRecord } = require('../server/callRecordIdentity');

const clone = value => value == null ? value : structuredClone(value);
const conflict = error => error?.code === 'CALL_RECORD_IDENTITY_CONFLICT' && error.statusCode === 409;
const duplicate = target => Object.assign(new Error('synthetic unique conflict'), {
  code: 'P2002', meta: { modelName: 'Call', target },
});

function existing(changes = {}) {
  return { id: 31, businessId: 7, callerId: 44, externalProvider: 'vapi',
    externalId: 'vapi-existing', twilioCallSid: 'CA-synthetic', status: 'STARTED',
    durationSec: null, ...changes };
}

function fixture(initial = []) {
  const rows = initial.map(clone);
  const writes = [];
  const state = { beforeCreate: null, beforeUpdate: null };
  const matches = (row, where) => Object.entries(where).every(([key, value]) => {
    if (key === 'externalProvider_externalId') return row.externalProvider === value.externalProvider && row.externalId === value.externalId;
    return value === undefined || row[key] === value;
  });
  const prisma = { call: {
    findUnique: async ({ where }) => clone(rows.find(row => matches(row, where)) || null),
    create: async ({ data }) => {
      if (state.beforeCreate) await state.beforeCreate();
      if (data.twilioCallSid && rows.some(row => row.twilioCallSid === data.twilioCallSid)) throw duplicate(['twilioCallSid']);
      if (data.externalProvider && data.externalId && rows.some(row => row.externalProvider === data.externalProvider && row.externalId === data.externalId)) throw duplicate(['externalProvider', 'externalId']);
      const row = { id: 100 + rows.length, externalProvider: null, externalId: null, twilioCallSid: null, ...clone(data) };
      rows.push(row); writes.push({ kind: 'create', data: clone(data) }); return clone(row);
    },
    update: async ({ where, data }) => {
      if (state.beforeUpdate) await state.beforeUpdate();
      const row = rows.find(candidate => matches(candidate, where));
      if (!row) throw Object.assign(new Error('synthetic compare-and-set mismatch'), { code: 'P2025' });
      writes.push({ kind: 'update', where: clone(where), data: clone(data) });
      for (const [key, value] of Object.entries(data)) if (value !== undefined) row[key] = clone(value);
      return clone(row);
    },
  } };
  const input = {
    prisma, businessId: 7, externalProvider: 'vapi', externalId: 'vapi-existing', twilioCallSid: 'CA-synthetic',
    createData: { businessId: 7, callerId: 55, externalProvider: 'vapi', externalId: 'vapi-existing',
      twilioCallSid: 'CA-synthetic', status: 'COMPLETED', durationSec: 90 },
    updateData: () => ({ status: 'COMPLETED', durationSec: 90 }),
  };
  return { rows, writes, state, input, run: changes => persistCallRecord({ ...input, ...changes }) };
}

test('new call writes one record with its owned identity', async () => {
  const f = fixture();
  const result = await f.run();
  assert.equal(result.businessId, 7); assert.equal(result.callerId, 55);
  assert.equal(result.externalId, 'vapi-existing'); assert.equal(result.twilioCallSid, 'CA-synthetic');
  assert.equal(f.rows.length, 1); assert.equal(f.writes.length, 1);
});

test('same owned provider identity accepts metadata without replacing caller or identity fields', async () => {
  const prior = existing();
  const f = fixture([prior]);
  const result = await f.run({ updateData: () => ({ status: 'COMPLETED', durationSec: 90,
    businessId: 999, callerId: 999, externalProvider: 'vapi', externalId: 'overwrite', twilioCallSid: 'overwrite' }) });
  assert.equal(result.id, prior.id); assert.equal(f.rows.length, 1);
  for (const field of ['businessId', 'callerId', 'externalProvider', 'externalId', 'twilioCallSid']) assert.equal(result[field], prior[field], field);
  assert.equal(result.durationSec, 90);
  const update = f.writes.find(write => write.kind === 'update');
  for (const field of ['id', 'businessId', 'externalProvider', 'externalId', 'twilioCallSid']) assert.equal(update.where[field], prior[field], `conditional ${field}`);
});

test('a Twilio-only SID record is not silently merged with a different provider identity', async () => {
  const prior = existing({ externalProvider: 'twilio', externalId: 'CA-synthetic' });
  const f = fixture([prior]);
  await assert.rejects(f.run(), conflict);
  assert.deepEqual(f.rows, [prior]); assert.equal(f.writes.length, 0);
});

test('an owned unbound SID record can receive its first external binding without changing caller', async () => {
  const prior = existing({ externalProvider: null, externalId: null });
  const f = fixture([prior]); const result = await f.run();
  assert.equal(result.id, prior.id); assert.equal(result.callerId, prior.callerId);
  assert.equal(result.businessId, prior.businessId); assert.equal(result.twilioCallSid, prior.twilioCallSid);
  assert.equal(result.externalProvider, 'vapi'); assert.equal(result.externalId, 'vapi-existing');
  assert.equal(result.status, 'COMPLETED'); assert.equal(f.rows.length, 1);
});

test('repeated external identity updates the same record', async () => {
  const f = fixture([existing()]);
  const first = await f.run(), second = await f.run();
  assert.equal(first.id, second.id); assert.equal(f.rows.length, 1);
  assert.equal(f.writes.filter(write => write.kind === 'create').length, 0);
});

test('existing identity does not invoke a deferred new-caller factory', async () => {
  const f = fixture([existing()]);
  const result = await f.run({ createData: async () => { throw new Error('existing call must not create another caller'); } });
  assert.equal(result.id, 31); assert.equal(result.callerId, 44);
});

test('new call invokes its deferred create factory exactly once', async () => {
  const f = fixture(); let calls = 0;
  const result = await f.run({ createData: async () => { calls += 1; return clone(f.input.createData); } });
  assert.equal(calls, 1); assert.equal(result.callerId, 55); assert.equal(f.rows.length, 1);
});

test('same external identity can fill a missing Twilio SID with a conditional identity guard', async () => {
  const f = fixture([existing({ twilioCallSid: null })]);
  const result = await f.run();
  assert.equal(result.twilioCallSid, 'CA-synthetic'); assert.equal(result.callerId, 44);
  assert.equal(f.writes[0].where.twilioCallSid, null);
});

for (const binding of [{ externalProvider: 'vapi', externalId: null }, { externalProvider: null, externalId: 'vapi-existing' }]) {
  test(`partially bound SID identity is held safely (${binding.externalProvider || 'no provider'})`, async () => {
    const prior = existing(binding), f = fixture([prior]);
    await assert.rejects(f.run(), conflict);
    assert.deepEqual(f.rows, [prior]); assert.equal(f.writes.length, 0);
  });
}

for (const supplied of [{ externalProvider: 'vapi', externalId: null }, { externalProvider: null, externalId: 'vapi-new' }]) {
  for (const present of [false, true]) test(`partial incoming provider identity is rejected before caller creation (${supplied.externalProvider || 'no provider'}, ${present ? 'existing SID' : 'new call'})`, async () => {
    const prior = existing({ externalProvider: null, externalId: null });
    const f = fixture(present ? [prior] : []);
    let factories = 0;
    await assert.rejects(f.run({ ...supplied, createData: async () => {
      factories += 1; return clone(f.input.createData);
    } }), conflict);
    assert.equal(factories, 0); assert.equal(f.writes.length, 0);
    assert.deepEqual(f.rows, present ? [prior] : []);
  });
}

test('a concurrent compatible SID fill can be safely re-read and updated on the same owned call', async () => {
  const f = fixture([existing({ twilioCallSid: null })]);
  f.state.beforeUpdate = async () => {
    f.state.beforeUpdate = null;
    f.rows[0].twilioCallSid = 'CA-synthetic';
  };
  const result = await f.run();
  assert.equal(result.id, 31); assert.equal(result.businessId, 7); assert.equal(result.callerId, 44);
  assert.equal(result.twilioCallSid, 'CA-synthetic'); assert.equal(result.status, 'COMPLETED');
  assert.equal(f.writes.length, 1);
});

for (const selector of ['local', 'external', 'sid']) test(`foreign business ${selector} lookup is rejected without writes`, async () => {
  const row = existing({ businessId: 9 });
  const f = fixture([row]);
  const changes = selector === 'local' ? { localCallId: row.id, externalProvider: null, externalId: null, twilioCallSid: null }
    : selector === 'external' ? { twilioCallSid: null } : { externalProvider: null, externalId: null };
  await assert.rejects(f.run(changes), conflict);
  assert.deepEqual(f.rows, [row]); assert.equal(f.writes.length, 0);
});

test('external identity and Twilio SID pointing to different rows are not merged', async () => {
  const a = existing({ twilioCallSid: 'CA-other' }), b = existing({ id: 32, externalId: 'vapi-other' });
  const f = fixture([a, b]);
  await assert.rejects(f.run(), conflict);
  assert.deepEqual(f.rows, [a, b]); assert.equal(f.writes.length, 0);
});

test('explicit local ID and another canonical identity pointing to different rows are rejected', async () => {
  const a = existing({ id: 32, externalId: 'other', twilioCallSid: 'CA-other' }), b = existing();
  const f = fixture([a, b]);
  await assert.rejects(f.run({ localCallId: 32 }), conflict);
  assert.deepEqual(f.rows, [a, b]); assert.equal(f.writes.length, 0);
});

test('same provider with a different external ID cannot claim an existing Twilio SID', async () => {
  const prior = existing(); const f = fixture([prior]);
  await assert.rejects(f.run({ externalId: 'another-vapi-call' }), conflict);
  assert.deepEqual(f.rows, [prior]); assert.equal(f.writes.length, 0);
});

test('local or external identity cannot replace a different saved Twilio SID', async () => {
  const prior = existing(); const f = fixture([prior]);
  await assert.rejects(f.run({ localCallId: prior.id, twilioCallSid: 'CA-different' }), conflict);
  assert.deepEqual(f.rows, [prior]); assert.equal(f.writes.length, 0);
});

for (const target of [['twilioCallSid'], ['externalProvider', 'externalId']]) test(`an identity insert race reuses its owned winning record (${target.join(',')})`, async () => {
  const f = fixture();
  f.state.beforeCreate = async () => { f.state.beforeCreate = null; f.rows.push(existing()); throw duplicate(target); };
  const result = await f.run();
  assert.equal(result.id, 31); assert.equal(result.callerId, 44); assert.equal(result.durationSec, 90);
  assert.equal(f.rows.length, 1); assert.equal(f.writes.filter(write => write.kind === 'create').length, 0);
});

test('two concurrent reports converge on one owned record', async () => {
  const f = fixture();
  const [a, b] = await Promise.all([f.run(), f.run()]);
  assert.equal(a.id, b.id); assert.equal(f.rows.length, 1);
  assert.equal(f.writes.filter(write => write.kind === 'create').length, 1);
});

test('a foreign-business insert-race winner stays untouched', async () => {
  const winner = existing({ businessId: 9 }); const f = fixture();
  f.state.beforeCreate = async () => { f.state.beforeCreate = null; f.rows.push(clone(winner)); throw duplicate(['twilioCallSid']); };
  await assert.rejects(f.run(), conflict);
  assert.deepEqual(f.rows, [winner]); assert.equal(f.writes.length, 0);
});

test('an identity error with no recoverable winner is preserved', async () => {
  const failure = duplicate(['twilioCallSid']); const f = fixture();
  f.state.beforeCreate = async () => { throw failure; };
  await assert.rejects(f.run(), error => error === failure);
  assert.equal(f.rows.length, 0); assert.equal(f.writes.length, 0);
});

for (const failure of [duplicate(['id']), Object.assign(new Error('synthetic outage'), { code: 'P1001' })]) {
  test(`unrelated ${failure.code} failure is preserved`, async () => {
    const f = fixture(); f.state.beforeCreate = async () => { f.rows.push(existing()); throw failure; };
    await assert.rejects(f.run(), error => error === failure);
    assert.equal(f.rows.length, 1); assert.equal(f.rows[0].status, 'STARTED');
    assert.equal(f.writes.length, 0);
  });
}

test('missing unique-constraint metadata is not sufficient to recover an insert error', async () => {
  const failure = Object.assign(new Error('synthetic unknown unique conflict'), { code: 'P2002' });
  const f = fixture(); f.state.beforeCreate = async () => { f.rows.push(existing()); throw failure; };
  await assert.rejects(f.run(), error => error === failure);
  assert.equal(f.rows[0].status, 'STARTED'); assert.equal(f.writes.length, 0);
});

test('a Twilio SID race winner from another provider stays unchanged', async () => {
  const winner = existing({ externalProvider: 'twilio', externalId: 'CA-synthetic' });
  const f = fixture();
  f.state.beforeCreate = async () => { f.state.beforeCreate = null; f.rows.push(clone(winner)); throw duplicate(['twilioCallSid']); };
  await assert.rejects(f.run(), conflict);
  assert.deepEqual(f.rows, [winner]); assert.equal(f.writes.length, 0);
});

test('a changed ownership or identity between lookup and update fails closed', async () => {
  const f = fixture([existing()]);
  f.state.beforeUpdate = async () => { f.rows[0].businessId = 9; };
  await assert.rejects(f.run(), conflict);
  assert.equal(f.rows[0].businessId, 9); assert.equal(f.rows[0].status, 'STARTED');
  assert.equal(f.writes.length, 0);
});
