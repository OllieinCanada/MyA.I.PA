const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { persistCall, resolveCallRecord } = require('../server/callPersistence');
const { notificationEvidence } = require('../server/callNotificationEvidence');

// Execute the actual ingestion function without loading the Express server,
// provider clients, background jobs, environment bindings, or production data.
const indexSource = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');
const start = indexSource.indexOf('async function upsertVapiCall(');
const end = indexSource.indexOf('\nasync function ingestVapiEndOfCallReport(', start);
assert.ok(start >= 0 && end > start, 'actual ingestion function must be available');
const functionSource = indexSource.slice(start, end);

function fixture(overrides = {}, cost = 0.2) {
  let row = {
    id: 72, businessId: 7, callerId: 44,
    externalProvider: null, externalId: null, twilioCallSid: 'CA-synthetic',
    startedAt: new Date('2026-01-01T00:00:00Z'), endedAt: new Date('2026-01-01T00:02:00Z'),
    status: 'COMPLETED', durationSec: 120, twilioPrice: 0.03,
    vapiCost: 0.1, totalInternalCost: 0.13,
    caller: { id: 44, phone: '+19055550123', name: 'Canonical caller' },
    business: { id: 7 }, ...overrides,
  };
  const logged = [], writes = [], store = {};
  const prisma = { call: {
    async findMany({ where }) { return where.OR.some(clause => Object.entries(clause).every(([key, value]) => row[key] === value)) ? [structuredClone(row)] : []; },
    async findUnique({ where }) {
      const match = where.externalProvider_externalId
        ? Object.entries(where.externalProvider_externalId).every(([key, value]) => row[key] === value)
        : Object.entries(where).every(([key, value]) => row[key] === value);
      return match ? structuredClone(row) : null;
    },
    async update({ where, data }) {
      assert.ok(Object.entries(where).every(([key, value]) => row[key] === value), 'conditional identity must match');
      writes.push(structuredClone(data));
      row = { ...row, ...structuredClone(data) };
      return structuredClone(row);
    },
    async create() { assert.fail('existing SID must not create a second call'); },
  } };
  prisma.$transaction = async callback => callback({ call: prisma.call,
    $queryRaw: async query => (query.strings || query).join('').includes('FOR UPDATE') ? [structuredClone(row)] : [] });
  const context = {
    require(name) {
      assert.equal(name, './callPersistence');
      return { resolveCallRecord };
    },
    prisma,
    notificationEvidence,
    resolveBusinessIdForVapiCall: async () => 7,
    getVapiNestedString: () => '',
    getVapiNestedValue: () => undefined,
    getVapiCost: () => cost,
    getVapiTwilioCallSid: call => call.twilioCallSid,
    getVapiTranscript: () => '', getVapiSummary: () => '', getVapiRecordingUrl: () => '',
    getVapiRecordingConsent: () => ({}),
    summarizeVapiToolCalls: () => ({}), summarizeVapiToolResults: () => [],
    getVapiCustomerSafeMessages: () => [], getVapiArtifactMetrics: () => undefined,
    getVapiDurationSeconds: call => call.durationSec,
    mapVapiStatus: () => 'COMPLETED', getVapiCostBreakdown: () => undefined,
    async logCall(payload) {
      logged.push(structuredClone(payload));
      return persistCall({ db: prisma, identity: { businessId: payload.businessId,
        callerId: row.callerId, callId: payload.callId, externalProvider: payload.externalProvider,
        externalId: payload.externalId, twilioCallSid: payload.twilioCallSid },
        createData: {}, updateData: existing => ({ durationSec: payload.durationSec, status: payload.status,
          externalProvider: payload.externalProvider, externalId: payload.externalId,
          vapiCost: payload.vapiCost ?? existing.vapiCost,
          totalInternalCost: payload.totalInternalCost ?? existing.totalInternalCost }),
      });
    },
  };
  const ingest = vm.runInNewContext(`(${functionSource})`, context);
  return { logged, writes, store, row: () => row,
    run: () => ingest({ id: 'vapi-synthetic', twilioCallSid: 'CA-synthetic', durationSec: 120 }, store) };
}

test('canonical unbound SID is promoted once; replay retains call, caller and accounting identity', async () => {
  const f = fixture();
  const first = await f.run();
  assert.equal(first.duplicate, true);
  assert.equal(first.usageChanged, true, 'new Vapi binding must enter Vapi-filtered trial accounting');
  assert.equal(first.localCallId, 72);
  assert.equal(first.notificationEvidence.available, false, 'missing notification proof remains unverified');
  assert.equal(f.logged[0].callerPhone, '+19055550123');
  assert.equal(f.logged[0].callerName, 'Canonical caller');
  assert.equal(f.logged[0].callId, 72);
  assert.equal(f.row().callerId, 44);
  assert.equal(f.row().externalProvider, 'vapi');
  assert.equal(f.row().externalId, 'vapi-synthetic');
  assert.equal(f.store['vapi-synthetic'].localCallId, 72);
  assert.ok(Math.abs(f.row().totalInternalCost - 0.23) < 1e-10, 'retain Twilio price plus Vapi cost');
  const second = await f.run();
  assert.equal(second.duplicate, true);
  assert.equal(second.usageChanged, false);
  assert.equal(second.localCallId, 72);
  assert.equal(f.row().callerId, 44);
  assert.equal(f.writes.length, 2);
});

test('missing Vapi cost preserves existing combined cost instead of zeroing it', async () => {
  const f = fixture({}, null);
  await f.run();
  assert.equal(f.logged[0].totalInternalCost, 0.13);
  assert.equal(f.row().totalInternalCost, 0.13);
  assert.equal(f.row().twilioPrice, 0.03);
});

for (const [label, binding] of [
  ['same-provider conflicting external ID', { externalProvider: 'vapi', externalId: 'different-vapi-call' }],
  ['unproven carrier binding', { externalProvider: 'twilio', externalId: 'CA-other' }],
  ['different business', { businessId: 8 }],
]) test(`ingestion rejects ${label} before logging or mutating calls`, async () => {
  const f = fixture(binding);
  const original = structuredClone(f.row());
  await assert.rejects(f.run(), error => error.code === 'CALL_RECORD_IDENTITY_CONFLICT' && error.statusCode === 409);
  assert.equal(f.logged.length, 0);
  assert.equal(f.writes.length, 0);
  assert.deepEqual(f.row(), original);
  assert.deepEqual(f.store, {});
});

test('an exact Twilio carrier record is promoted without replacing caller or losing carrier cost', async () => {
  const f = fixture({ externalProvider: 'twilio', externalId: 'CA-synthetic' });
  const result = await f.run();
  assert.equal(result.localCallId, 72);
  assert.equal(result.usageChanged, true);
  assert.equal(f.row().callerId, 44);
  assert.equal(f.row().externalProvider, 'vapi');
  assert.ok(Math.abs(f.row().totalInternalCost - 0.23) < 1e-10);
});
