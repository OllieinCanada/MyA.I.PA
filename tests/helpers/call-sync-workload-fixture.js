'use strict';
// Executes the application's actual upsert + sweep functions, without importing
// server startup, Prisma, provider SDKs, credentials or transports.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { createCallSyncWorkload } = require('../../server/callSyncWorkload');
const { attestCallSyncExclusion, summarizeCallSyncReporting } = require('../../server/callSyncReporting');
const { isCallSyncRoutingRefusal } = require('../../server/callSyncHealth');
const source = fs.readFileSync(path.join(__dirname, '../../server/index.js'), 'utf8');
const part = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, 'Exact application source boundaries required');
  return source.slice(from, to);
};
function createFixture({ count = 1, policy = {}, unoptimizedControl = false, writeCpuMs = 0 } = {}) {
  assert.ok(Number.isInteger(count) && count >= 1 && count <= 30);
  assert.ok(writeCpuMs >= 0 && writeCpuMs <= 5);
  const calls = Array.from({ length: count }, (_, i) => ({ id: `synthetic-history-${i}`, status: 'ended',
    startedAt: '2026-11-01T12:00:00.000Z', endedAt: '2026-11-01T12:01:00.000Z',
    assistantId: 'synthetic-assistant', phoneNumberId: 'synthetic-phone', businessId: 7,
    customer: { number: '+19055550100', name: 'Invented caller' }, transcript: 'Invented maintenance request.' }));
  const rows = new Map(), counts = { reads: 0, details: 0, writes: 0, usage: 0, requestLinks: 0, fileWrites: 0, pauses: 0 };
  let store = {}, detailError = false, usageError = false, linkError = false, routeError = false, fileError = false, missingDetail = false;
  const workload = unoptimizedControl
    ? { pace: async () => {}, unchanged: () => false, invalidate() {}, stage() {}, commit() {} }
    : createCallSyncWorkload(policy);
  const get = (object, key) => key.split('.').reduce((value, part) => value?.[part], object);
  const text = (object, keys) => keys.map(key => get(object, key)).find(value => typeof value === 'string' && value) || '';
  const reconcileRequest = async () => {
    counts.requestLinks++;
    if (linkError) throw Object.assign(new Error('Synthetic request-link failure'), { code: 'notification_request_store_unavailable' });
    return { state: 'no_confirmed_request', requestSaved: false, leadSaved: false };
  };
  const context = {
    Date, path, dataDir: 'not-used',
    callSyncWorkload: { ...workload, pace: async () => { counts.pauses++; await workload.pace(); } },
    prisma: {}, isCallSyncRoutingRefusal, attestCallSyncExclusion, summarizeCallSyncReporting,
    readSimulationEvidence: () => ({ status: 'absent' }),
    VAPI_VOICE_SIGNUP_ASSISTANT_ID: '', VAPI_VOICE_SIGNUP_PHONE_NUMBER_ID: '',
    resolveBusinessIdForVapiCall: async call => {
      if (routeError) throw Object.assign(new Error('Synthetic routing conflict'), { code: 'VAPI_BUSINESS_ROUTE_CONFLICT' });
      return call.businessId;
    },
    require: name => {
      if (name === './confirmedCallRequest') return { reconcileConfirmedRequest: reconcileRequest };
      assert.equal(name, './callPersistence', 'Closed application import map');
      return { resolveCallRecord: async (_, identity) => {
        counts.reads++;
        const row = rows.get(identity.externalId);
        if (row && row.businessId !== identity.businessId) throw Object.assign(new Error('Synthetic identity conflict'), { code: 'CALL_RECORD_IDENTITY_CONFLICT' });
        return row ? structuredClone(row) : null;
      } };
    },
    getVapiTwilioCallSid: call => call.twilioCallSid || '', getVapiNestedString: text,
    getVapiNestedValue: get, getVapiCost: call => call.cost ?? null, getVapiCostBreakdown: () => null,
    getVapiTranscript: call => call.transcript || '', getVapiSummary: () => '',
    getVapiRecordingUrl: call => call.recordingUrl || '', getVapiRecordingConsent: () => ({}),
    summarizeVapiToolCalls: () => ({ count: 0 }), summarizeVapiToolResults: () => [],
    getVapiCustomerSafeMessages: () => [], getVapiArtifactMetrics: () => null,
    getVapiDurationSeconds: call => call.durationSec ?? 60,
    mapVapiStatus: status => status === 'ended' ? 'COMPLETED' : 'STARTED',
    getSensitiveArtifactExpiry: () => null, CALL_TRANSCRIPT_RETENTION_DAYS: 1, CALL_RECORDING_RETENTION_DAYS: 1,
    notificationEvidence: () => ({ available: false }), normalizePhoneForMatch: value => String(value || ''),
    logCall: async payload => {
      counts.writes++;
      const until = performance.now() + writeCpuMs;
      while (performance.now() < until) { /* bounded synthetic CPU work, not measured SQL */ }
      const { callId, persistenceMode, callerPhone, callerName, ...data } = payload;
      const row = { ...data, id: callId || counts.writes, callerId: 11,
        caller: { id: 11, phone: callerPhone, name: callerName }, business: { id: payload.businessId, name: 'Invented business' } };
      rows.set(payload.externalId, structuredClone(row));
      let requestCapture;
      try { requestCapture = await reconcileRequest(); }
      catch (error) { requestCapture = { state: 'unconfirmed', errorCode: error.code }; }
      return { ...row, requestCapture };
    },
    fetchVapiCalls: async () => structuredClone(calls),
    fetchVapiCallDetail: async id => {
      counts.details++;
      if (detailError) throw Object.assign(new Error('Synthetic detail timeout'), { code: 'ETIMEDOUT' });
      if (missingDetail) return null;
      return structuredClone(calls.find(call => call.id === id));
    },
    readVapiCallSyncStore: () => structuredClone(store),
    writeVapiCallSyncStore: value => {
      counts.fileWrites++;
      if (fileError) throw Object.assign(new Error('Synthetic file failure'), { code: 'ENOSPC' });
      store = structuredClone(value);
    },
    reconcileTrialUsageAfterCall: async () => {
      counts.usage++;
      if (usageError) throw Object.assign(new Error('Synthetic usage database failure'), { code: 'P2028' });
    },
    console: { warn() {} },
  };
  vm.createContext(context);
  vm.runInContext(part('async function upsertVapiCall(', 'async function ingestVapiEndOfCallReport(')
    + part('async function performVapiCallSync(', 'async function fetchTwilioCalls('), context);
  return { calls, rows, counts, context, run: options => context.performVapiCallSync(options),
    setDetailError: value => { detailError = value; }, setUsageError: value => { usageError = value; },
    setLinkError: value => { linkError = value; }, setRouteError: value => { routeError = value; },
    setFileError: value => { fileError = value; }, setMissingDetail: value => { missingDetail = value; } };
}
module.exports = { createFixture };
