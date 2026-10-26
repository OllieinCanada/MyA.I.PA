const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { ASSISTANT_REQUEST_BUDGET_MS, CALL_SETUP_FAILURE_MESSAGE, createAssistantRequestGuard,
  mapCallStatus, runAssistantRequest, shouldReportCallSetupFailure, withCallSetupFailureHook } = require('../server/voiceCallReliability');
const { classifyOperationalError } = require('../server/operationalErrorClassifier');
const { buildRuntimeIncident } = require('../server/runtimeAlerts');
const { buildIncidentTelegramAlert } = require('../server/incidentAlerts');
const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

test('answer budget leaves network headroom under the fixed Vapi deadline', () => {
  assert.ok(ASSISTANT_REQUEST_BUDGET_MS <= 4500);
});
test('fast proven assistant selection is returned unchanged', async () => {
  const result = await runAssistantRequest({ resolve: guard => guard.stage('lookup', async () => ({ assistantId: 'saved-assistant' })) });
  assert.deepEqual(result, { assistantId: 'saved-assistant' });
});
test('a stalled lookup returns a spoken failure without waiting for notification delivery', async () => {
  let fail;
  const result = await runAssistantRequest({ budgetMs: 15,
    resolve: () => new Promise(() => {}), onFailure: error => { fail = error; return new Promise(() => {}); } });
  assert.deepEqual(result, { error: CALL_SETUP_FAILURE_MESSAGE });
  await nextTurn();
  assert.equal(fail.code, 'VOICE_ASSISTANT_REQUEST_DEADLINE');
});
test('a late lookup cannot authorize or perform work after its stage checkpoint', async () => {
  let finish; let authorized = false;
  const result = await runAssistantRequest({ budgetMs: 10, resolve: async guard => {
    await guard.stage('lookup', () => new Promise(resolve => { finish = resolve; }));
    authorized = true;
    return { assistantId: 'too-late' };
  } });
  finish({}); await nextTurn();
  assert.equal(authorized, false);
  assert.ok(result.error);
});
test('failed database lookup fails closed; error reporters cannot replace the caller response', async () => {
  const result = await runAssistantRequest({ resolve: async () => { throw Error('synthetic DB unavailable'); }, onFailure: () => { throw Error('reporter unavailable'); } });
  assert.deepEqual(result, { error: CALL_SETUP_FAILURE_MESSAGE });
  await nextTurn();
});
test('stage timings and an explicit expiration are observable without personal data', async () => {
  let now = 0; const guard = createAssistantRequestGuard({ now: () => now });
  await guard.stage('gate', async () => { now = 25; });
  assert.deepEqual(guard.stages, { gate: 25 });
  guard.expire(); assert.throws(() => guard.check(), { code: 'VOICE_ASSISTANT_REQUEST_DEADLINE' });
});
test('call setup failure hook speaks without transferring to any forwarding line', () => {
  const ringing = { on: 'call.ringing', do: [{ type: 'say', exact: 'Welcome' }] };
  const hooks = withCallSetupFailureHook([ringing]);
  assert.equal(hooks[0], ringing);
  assert.equal(hooks[1].on, 'call.ending');
  assert.deepEqual(hooks[1].do, { type: 'say', exact: CALL_SETUP_FAILURE_MESSAGE });
  assert.ok(hooks[1].filters[0].oneOf.includes('assistant-request-returned-error'));
  assert.deepEqual(withCallSetupFailureHook(hooks), hooks);
});
test('custom call-ending hooks are not overwritten silently', () => {
  const hooks = [{ on: 'call.ending', do: { type: 'say', exact: 'Custom message' } }];
  assert.equal(withCallSetupFailureHook(hooks), hooks);
});
test('a generic ended status never hides a failed assistant request or fallback notice', () => {
  assert.equal(mapCallStatus('ended', 'assistant-request-returned-error'), 'FAILED');
  assert.equal(mapCallStatus('ended', 'call.ending.hook-executed-say'), 'FAILED');
  assert.equal(mapCallStatus('ended', 'customer-ended-call'), 'COMPLETED');
  assert.equal(mapCallStatus('ringing'), 'STARTED');
});
test('call/caller unique conflicts are not classified as signup conflicts', () => {
  for (const [modelName, target] of [['Call', ['twilioCallSid']], ['Caller', ['phone']]]) {
    const error = Object.assign(Error('Unique constraint failed'), { code: 'P2002', meta: { modelName, target } });
    const classified = classifyOperationalError(error, { route: '/api/webhooks/voice' });
    assert.equal(classified.category, 'call_record_conflict');
    assert.equal(classified.reasonCode, 'CALL_RECORD_DUPLICATE_WRITE_FAILED');
    assert.doesNotMatch(classified.nextAction, /Pick the one canonical signup/);
  }
});
test('Telegram identifies the known business and call without inventing a signup conflict', () => {
  const error = Object.assign(Error('Unique constraint'), { code: 'P2002', meta: { modelName: 'Call', target: ['twilioCallSid'] } });
  const incident = buildRuntimeIncident(error, { businessName: 'Example Electric', whatFailed: 'POST returned an error', snapshot: { 'Call ID': 'call-example' } });
  const text = buildIncidentTelegramAlert(incident);
  assert.match(text, /call record could not be saved safely/i);
  assert.match(text, /Business: Example Electric/);
  assert.match(text, /Call: call-example/);
  assert.doesNotMatch(text, /A duplicate or conflicting setup was blocked/);
});
test('deadline and terminal reports correlate to one call-setup incident', () => {
  const context = { area: 'AI call setup', method: 'POST', route: '/api/webhooks/voice',
    reasonCode: 'VOICE_ASSISTANT_SELECTION_FAILED', dedupeFingerprint: 'call-example:assistant-selection' };
  const one = buildRuntimeIncident(Object.assign(Error('deadline'), { code: 'VOICE_ASSISTANT_REQUEST_DEADLINE' }), context);
  const two = buildRuntimeIncident(Object.assign(Error('provider failure'), { code: 'VOICE_ASSISTANT_SELECTION_FAILED' }), context);
  assert.equal(one.incidentId, two.incidentId);
});
test('real voice route uses the guard and no disabled forwarding-test DB lookup', () => {
  const source = fs.readFileSync(require.resolve('../server/index'), 'utf8');
  const branch = source.slice(source.indexOf('if (vapiMessageType === "assistant-request")'), source.indexOf('if (vapiMessageType === "end-of-call-report")'));
  assert.match(branch, /runAssistantRequest/);
  assert.doesNotMatch(branch, /matchForwardedVerificationCall/);
  assert.match(source, /hooks: withCallSetupFailureHook\(phone.hooks\)/);
  assert.match(source, /hooksChanged \? \{ hooks: protectedHooks \}/);
});
test('an intentional trial policy hold never becomes an outage on terminal-event replay', () => {
  const input = { endedReason: 'assistant-request-returned-error', callId: 'call', businessId: 37,
    policy: { decision: 'block', callId: 'call', businessId: 37 } };
  assert.equal(shouldReportCallSetupFailure(input), false);
  assert.equal(shouldReportCallSetupFailure({ ...input, policy: null }), true);
  assert.equal(shouldReportCallSetupFailure({ ...input, businessId: 99 }), true);
  assert.equal(shouldReportCallSetupFailure({ ...input, callId: 'other-call' }), true);
  assert.equal(shouldReportCallSetupFailure({ ...input, endedReason: 'customer-ended-call' }), false);
});
