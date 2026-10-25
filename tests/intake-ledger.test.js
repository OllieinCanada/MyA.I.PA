const test = require('node:test');
const assert = require('node:assert/strict');
const { memoryDb } = require('./helpers/twilio-status-memory-db');
const { applyIntakeDecision, dispatchStagingIntakeNotification } = require('../server/intakeLedger');
const { authorizeStagingIntake, handleStagingIntakeTool } = require('../server/stagingIntake');
const trusted = { businessId: 7, callId: 'staging-fixture-call', callDbId: 99, providerCallId: 'fixture-call' };
const base = { businessId: '7', callId: trusted.callId, callerConfirmed: true };
const initial = { ...base, eventId: 'capture', expectedVersion: 0, operations: [
  { field: 'callerName', action: 'write', value: 'Fixture Caller', confirmed: true },
  { field: 'callbackNumber', action: 'write', value: '+19055550123', confirmed: true },
  { field: 'serviceAddress', action: 'write', value: '10 Fixture Road', confirmed: true },
  { field: 'requestedDate', action: 'write', value: 'Tuesday', confirmed: true },
] };
const correction = { ...base, eventId: 'correct', expectedVersion: 1, operations: [
  { field: 'serviceAddress', action: 'update', value: '20 Fixture Road', confirmed: true },
  { field: 'requestedDate', action: 'update', value: 'Wednesday', confirmed: true },
  { field: 'jobDetails', action: 'ignore', value: 'unconfirmed guess' },
] };
const finish = { ...base, eventId: 'finish', expectedVersion: 2, operations: [], finalize: true };
function fixture() {
  const { prisma, rows } = memoryDb(), leads = new Map();
  const call = { id: 99, callerId: 44, businessId: 7, externalId: trusted.providerCallId, externalProvider: 'vapi-staging-ledger' };
  const models = { call: { findUnique: async () => call }, lead: {
    findUnique: async ({ where }) => leads.get(where.callId) || null,
    upsert: async ({ where, create, update }) => { const result = leads.has(where.callId) ? { ...leads.get(where.callId), ...update } : { id: 1, ...create }; leads.set(where.callId, result); return result; },
  } };
  const transaction = prisma.$transaction.bind(prisma);
  prisma.$transaction = work => transaction(tx => work({ ...tx, ...models }));
  Object.assign(prisma, models);
  return { prisma, rows, leads };
}
test('corrections replayed twice leave one latest confirmed record, one lead and one outbox item', async () => {
  const { prisma, rows, leads } = fixture();
  const apply = input => applyIntakeDecision({ prisma, input, trusted });
  const outcomes = [];
  for (const input of [initial, correction, finish, initial, correction, finish]) outcomes.push(await apply(input));
  assert.equal(outcomes.filter(x => x.duplicate).length, 3);
  assert.equal([...rows.keys()].filter(k => k.startsWith('staging:intake-ledger:')).length, 1);
  assert.equal([...rows.keys()].filter(k => k.startsWith('staging:intake-outbox:')).length, 1);
  assert.equal(leads.size, 1);
  assert.match([...leads.values()][0].summary, /20 Fixture Road/);
  assert.doesNotMatch(JSON.stringify([...rows.values()]), /Tuesday|10 Fixture Road|unconfirmed guess/);
  assert.equal(outcomes.at(-1).version, 3);
});
test('concurrent duplicates commit once and retain their result across a new module instance', async () => {
  const { prisma, rows } = fixture();
  const results = await Promise.all(Array.from({ length: 5 }, () => applyIntakeDecision({ prisma, input: initial, trusted })));
  assert.equal(results.filter(x => !x.duplicate).length, 1);
  delete require.cache[require.resolve('../server/intakeLedger')];
  const replay = await require('../server/intakeLedger').applyIntakeDecision({ prisma, input: initial, trusted });
  assert.equal(replay.duplicate, true); assert.equal(rows.size, 1);
});
test('stale, conflicting, unconfirmed and cross-business input cannot replace accepted facts', async () => {
  const { prisma } = fixture();
  await applyIntakeDecision({ prisma, input: initial, trusted });
  for (const input of [
    { ...correction, expectedVersion: 0 }, { ...initial, operations: [] },
    { ...correction, callerConfirmed: false }, { ...correction, businessId: '8' },
    { ...correction, operations: [{ field: 'transcript', action: 'write', value: 'not canonical', confirmed: true }] },
  ]) await assert.rejects(applyIntakeDecision({ prisma, input, trusted }));
  assert.equal((await applyIntakeDecision({ prisma, input: initial, trusted })).values.requestedDate, 'Tuesday');
});
test('partial hang-up creates no lead/notification, and a confirmed retraction removes the value', async () => {
  const { prisma, rows, leads } = fixture();
  await applyIntakeDecision({ prisma, input: initial, trusted });
  await applyIntakeDecision({ prisma, input: { ...correction, operations: [{ field: 'serviceAddress', action: 'update', value: null, confirmed: true }] }, trusted });
  const data = [...rows.values()][0].data;
  assert.equal(Object.hasOwn(data.values, 'serviceAddress'), false);
  assert.equal(data.finalized, false); assert.equal(leads.size, 0); assert.equal(rows.size, 1);
});
test('ambiguous notification acceptance is held for reconciliation and never automatically resent', async () => {
  const { prisma } = fixture();
  for (const input of [initial, correction]) await applyIntakeDecision({ prisma, input, trusted });
  const result = await applyIntakeDecision({ prisma, input: finish, trusted });
  let sends = 0;
  const sendHandoff = async () => { sends++; throw Object.assign(Error('accepted then connection lost'), { code: 'UND_ERR_SOCKET' }); };
  await assert.rejects(dispatchStagingIntakeNotification({ prisma, key: result.outboxKey, sendHandoff }));
  await assert.rejects(dispatchStagingIntakeNotification({ prisma, key: result.outboxKey, sendHandoff }), { code: 'PROVISIONING_RECONCILIATION_REQUIRED' });
  assert.equal(sends, 1);
});
test('a returned failed handoff is never saved as a successfully submitted notification', async () => {
  const { prisma, rows } = fixture();
  for (const input of [initial, correction]) await applyIntakeDecision({ prisma, input, trusted });
  const result = await applyIntakeDecision({ prisma, input: finish, trusted });
  await assert.rejects(dispatchStagingIntakeNotification({ prisma, key: result.outboxKey,
    sendHandoff: async () => ({ status: 'RETRY_DUE', error: 'unconfirmed provider result' }) }), { code: 'INTAKE_HANDOFF_UNCONFIRMED' });
  assert.equal(rows.get(result.outboxKey).data.status, 'pending');
});
test('staging capture is off by default and requires authenticated, exact tenant and assistant mapping', async () => {
  const call = { id: 'fixture-call', assistantId: 'fixture-assistant' };
  const env = { APP_ENV: 'staging', INTAKE_LEDGER_MODE: 'staging', STAGING_INTAKE_BUSINESS_ID: '7', STAGING_INTAKE_ASSISTANT_ID: 'fixture-assistant' };
  assert.doesNotThrow(() => authorizeStagingIntake({ authenticated: true, businessId: 7, call, env }));
  assert.throws(() => authorizeStagingIntake({ authenticated: true, businessId: 7, call, env: {} }));
  assert.throws(() => authorizeStagingIntake({ authenticated: false, businessId: 7, call, env }));
  assert.throws(() => authorizeStagingIntake({ authenticated: true, businessId: 8, call, env }));
  assert.throws(() => authorizeStagingIntake({ authenticated: true, businessId: 7, call, env: { ...env, RENDER_SERVICE_ID: 'srv-d92503a8qa3s73crdpog' } }));
  const { prisma } = fixture();
  await assert.rejects(handleStagingIntakeTool({ prisma, authenticated: true, businessId: 7, call, env,
    toolCall: { name: 'capture_confirmed_intake', parameters: { businessId: 8 } } }), { statusCode: 403 });
});
module.exports = { initial, correction, finish, fixture, trusted };
