const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseSimulationEvidence, attestCallSyncExclusion, verifiedNonCustomerExclusion } = require('../server/callSyncReporting');
const { accountedNonCustomerSync, completeSync, createCallSyncMonitor, WORKFLOW } = require('../server/callSyncHealth');

const simulationId = '00000000-0000-4000-8000-000000000001';
const intakeId = '00000000-0000-4000-8000-000000000002';
const context = () => ({ signupIntake: { assistantId: 'intake-a', phoneNumberId: 'intake-p' },
  simulationEvidence: parseSimulationEvidence({ schemaVersion: 1, reportingOnly: true,
    sources: [{ sha256: 'a'.repeat(64) }], calls: [{ callId: simulationId, type: 'vapi.websocketCall', role: 'tester', sourceSha256: 'a'.repeat(64) }] }) });
function exclusion(call, code, ctx = context(), extra = {}) {
  return attestCallSyncExclusion({ vapiCallId: call.id, code, ...extra }, call, ctx);
}
function fixture() {
  const simulation = exclusion({ id: simulationId, type: 'vapi.websocketCall' }, 'VAPI_BUSINESS_ROUTE_REQUIRED');
  const intake = exclusion({ id: intakeId, type: 'inboundPhoneCall', assistantId: 'intake-a', phoneNumberId: 'intake-p' },
    'VAPI_BUSINESS_ROUTE_UNKNOWN_IDENTIFIER');
  return { fetched: 3, synced: 1, detailErrors: [], routingErrors: [simulation, intake] };
}
function harness(items = []) {
  const failures = [], recoveries = [], receipts = [], reports = [];
  const options = { listIncidents: async () => items, notifyFailure: async (...args) => failures.push(args),
    recoverIncident: async (...args) => recoveries.push(args), recordCompletion: async r => receipts.push(r),
    reportAccounting: r => reports.push(r), log: () => {} };
  return { run: createCallSyncMonitor(options), options, failures, recoveries, receipts, reports };
}

test('verified exclusions have separate accounting, never routing or full-completion evidence', () => {
  const result = fixture();
  assert.equal(completeSync(result), false, 'strict full completion remains unchanged');
  assert.deepEqual(accountedNonCustomerSync(result), { status: 'verified_non_customer_exclusions', fetched: 3,
    synced: 1, excluded: 2, counts: { verified_simulation: 1, signup_intake: 1 }, completionEvidence: false, grantsRouting: false });
});

test('accounted exclusions neither increment failure nor clear history, including monitor recreation', async () => {
  const history = [{ id: 'old-incident', snapshot: { Workflow: WORKFLOW }, remediation: { status: 'needs_user' } }];
  const original = structuredClone(history), h = harness(history);
  await h.run(async () => fixture());
  await createCallSyncMonitor(h.options)(async () => fixture());
  assert.deepEqual(history, original);
  assert.equal(h.reports.length, 2);
  for (const calls of [h.failures, h.recoveries, h.receipts]) assert.equal(calls.length, 0);
});

test('overlapping accounted runs share the scheduled task and report once', async () => {
  const h = harness(); let finish, calls = 0;
  const task = () => { calls++; return new Promise(resolve => { finish = resolve; }); };
  const one = h.run(task), two = h.run(task);
  await new Promise(resolve => setImmediate(resolve));
  finish(fixture()); await Promise.all([one, two]);
  assert.equal(calls, 1); assert.equal(h.reports.length, 1); assert.equal(h.failures.length, 0);
});

test('an all-simulation batch still cannot claim full completion or recover old history', async () => {
  const h = harness([{ id: 'history', snapshot: { Workflow: WORKFLOW }, remediation: { status: 'needs_user' } }]);
  const result = { fetched: 1, synced: 0, detailErrors: [], routingErrors: [fixture().routingErrors[0]] };
  await h.run(async () => result);
  assert.equal(h.reports.length, 1); assert.equal(h.reports[0].completionEvidence, false);
  assert.equal(h.receipts.length, 0); assert.equal(h.recoveries.length, 0); assert.equal(h.failures.length, 0);
});

test('one unverified exclusion mixed with trusted exclusions prevents accounted health', async () => {
  const result = fixture();
  result.routingErrors.push({ vapiCallId: 'unverified', code: 'VAPI_BUSINESS_ROUTE_REQUIRED', reportingCategory: 'verified_simulation' });
  result.fetched++;
  const h = harness(); await h.run(async () => result);
  assert.equal(h.reports.length, 0); assert.equal(h.failures.length, 1);
  assert.equal(h.receipts.length, 0); assert.equal(h.recoveries.length, 0);
});

test('report labels, aggregate green counts, clones and serialized attestations cannot grant accounting', () => {
  const f = fixture();
  for (const rows of [f.routingErrors.map(r => ({ ...r })), JSON.parse(JSON.stringify(f.routingErrors)),
    [{ code: 'VAPI_BUSINESS_ROUTE_UNKNOWN_IDENTIFIER', vapiCallId: intakeId, reportingCategory: 'signup_intake' }]]) {
    assert.equal(accountedNonCustomerSync({ ...f, fetched: rows.length + f.synced, routingErrors: rows,
      reporting: { counts: { unresolved_routing: 0 }, simulationEvidenceStatus: 'loaded' } }), null);
  }
  assert.equal(verifiedNonCustomerExclusion(undefined), null);
});

test('invalid accounting, duplicate call identities and failed or incomplete reads remain failures', async () => {
  const f = fixture();
  const changes = [{ fetched: 4 }, { fetched: -1 }, { synced: 1.5 }, { synced: Number.MAX_SAFE_INTEGER + 1 },
    { detailErrors: [{}] }, { detailErrors: undefined }, { routingErrors: undefined },
    { fetched: 3, routingErrors: [f.routingErrors[0], f.routingErrors[0]] }];
  for (const change of changes) {
    const result = { ...f, ...change }, h = harness();
    assert.equal(accountedNonCustomerSync(result), null);
    await h.run(async () => result);
    assert.equal(h.failures.length, 1); assert.equal(h.reports.length, 0);
    assert.equal(h.receipts.length, 0); assert.equal(h.recoveries.length, 0);
  }
});

test('genuine unknown, malformed, conflict and incomplete routes are never hidden by source/category tags', async () => {
  for (const code of ['VAPI_BUSINESS_ROUTE_UNKNOWN_IDENTIFIER', 'VAPI_BUSINESS_ROUTE_CONFLICT',
    'VAPI_BUSINESS_ROUTE_INVALID_IDENTIFIER', 'VAPI_BUSINESS_ROUTE_INCOMPLETE']) {
    const call = { id: intakeId, type: 'inboundPhoneCall', assistantId: 'foreign', phoneNumberId: 'intake-p',
      metadata: { synthetic: true, reportingCategory: 'signup_intake' } };
    const row = exclusion(call, code, context(), { reportingCategory: 'signup_intake' });
    const result = { fetched: 1, synced: 0, detailErrors: [], routingErrors: [row] }, h = harness();
    assert.equal(row.reportingCategory, 'unresolved_routing');
    assert.equal(accountedNonCustomerSync(result), null);
    await h.run(async () => result);
    assert.equal(h.failures.length, 1); assert.equal(h.receipts.length, 0); assert.equal(h.recoveries.length, 0);
  }
});

test('known intake identity does not excuse conflict, missing alias, malformed IDs or a changed call', () => {
  const base = { id: intakeId, type: 'inboundPhoneCall', assistantId: 'intake-a', phoneNumberId: 'intake-p' };
  for (const call of [{ ...base, phoneNumberId: undefined }, { ...base, phoneNumber: { id: 'foreign' } },
    { ...base, assistantId: {} }, { ...base, type: 'vapi.websocketCall' }, { ...base, id: 'not-a-call-id' }]) {
    assert.equal(verifiedNonCustomerExclusion(exclusion(call, 'VAPI_BUSINESS_ROUTE_UNKNOWN_IDENTIFIER')), null);
  }
  assert.equal(verifiedNonCustomerExclusion(exclusion(base, 'VAPI_BUSINESS_ROUTE_CONFLICT')), null);
  assert.equal(verifiedNonCustomerExclusion(exclusion(base, 'VAPI_BUSINESS_ROUTE_UNKNOWN_IDENTIFIER', context(), { vapiCallId: simulationId })), null);
});

test('simulation proof must be exact, parsed and bound to a no-identifier websocket call', () => {
  for (const call of [{ id: intakeId, type: 'vapi.websocketCall' },
    { id: simulationId, type: 'inboundPhoneCall' }, { id: simulationId, type: 'vapi.websocketCall', assistantId: 'foreign' }]) {
    assert.equal(verifiedNonCustomerExclusion(exclusion(call, 'VAPI_BUSINESS_ROUTE_REQUIRED')), null);
  }
  assert.equal(verifiedNonCustomerExclusion(exclusion({ id: simulationId, type: 'vapi.websocketCall' },
    'VAPI_BUSINESS_ROUTE_REQUIRED', { simulationEvidence: { status: 'loaded' } })), null);
});

test('a thrown provider/database failure remains a failure even after reporting known exclusions', async () => {
  const h = harness(); await h.run(async () => fixture());
  await assert.rejects(h.run(async () => { throw Object.assign(new Error('synthetic failure'), { code: 'P1001' }); }));
  assert.equal(h.failures.length, 1); assert.equal(h.recoveries.length, 0); assert.equal(h.receipts.length, 0);
});

test('existing complete-sync receipt and recovery policy is not changed by exclusion accounting', async () => {
  const h = harness(); await h.run(async () => ({ fetched: 1, synced: 1, detailErrors: [], routingErrors: [] }));
  assert.equal(h.receipts.length, 1); assert.equal(h.reports.length, 0); assert.equal(h.failures.length, 0);
});

test('application binds original provider reads into accounting; routing and dispatch remain untouched', () => {
  const source = fs.readFileSync(path.join(__dirname, '../server/index.js'), 'utf8');
  const sync = source.slice(source.indexOf('async function performVapiCallSync'), source.indexOf('async function fetchTwilioCalls'));
  assert.match(sync, /routingErrors\.push\(attestCallSyncExclusion\(/);
  assert.match(sync, /\}, fullCall, reportingContext\)\)/);
  assert.match(sync, /if \(!isCallSyncRoutingRefusal\(error\)\) throw error/);
  assert.doesNotMatch(sync, /sendSms|sendText|sendEmail|dispatchNotification/);
});
