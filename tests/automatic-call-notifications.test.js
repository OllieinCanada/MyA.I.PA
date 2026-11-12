'use strict';
// Deterministic, inert transport only. This does not exercise Vapi or a phone.
const test = require('node:test'), assert = require('node:assert/strict');
const { createDispatchStub } = require('../scripts/stub-notification-dispatch');
const { automaticNotificationHandler, confirmedInput, createVapiAutomaticEvidenceReader } = require('../server/automaticCallNotifications');
const { getAutomaticVapiCompositeToolDefinition, automaticConfirmationPrompt } = require('../server/compositeCallNotifications');
const { reviewNotificationDraft } = require('../server/smsNotificationDrafts');
const callId = '11111111-2222-4333-8444-555555555555';
const args = { businessName: 'Synthetic Business', requestType: 'repair', name: 'Test', jobDetails: 'replace a light',
  streetAddress: '1 Test St', city: 'Example City', preferredStartDate: 'next week', bestCallbackTime: 'after 2 PM',
  workDetailsConfirmed: true, pricingDiscussed: false };
const route = { from: '+19055550100', owner: '+19055550101', ownerEnabled: true, assistantId: 'test-assistant',
  businessName: args.businessName, pricingOptions: { includePartsExtra: true, includeAssessment: true } };
function call(answer = 'Perfect. Yes.', question = 'Should I send this request to the team now?') {
  return { id: callId, status: 'in-progress', startedAt: new Date().toISOString(), assistantId: route.assistantId,
    customer: { number: '+19055550102' }, phoneNumber: { number: route.from }, artifact: { messagesOpenAIFormatted: [
      { role: 'assistant', content: question }, { role: 'user', content: answer },
      { role: 'assistant', tool_calls: [{ id: 'test-invocation', function: { name: 'send_call_summaries_test', arguments: JSON.stringify(args) } }] }
    ] } };
}
function response() { return { statusCode: 200, set() { return this; }, status(n) { this.statusCode = n; return this; }, json(body) { this.body = body; return this; } }; }
function harness({ evidence = { call: call(), route }, lostResponse = false, invalidSid = false, suppressed = false,
  authenticated = true, enabled = true, loadError = false } = {}) {
  const store = createDispatchStub(), posts = [];
  const env = { SMS_AUTOMATIC_DISPATCH_ENABLED: enabled ? 'true' : 'false', TWILIO_ACCOUNT_SID: 'AC_INERT', TWILIO_AUTH_TOKEN: 'INERT' };
  const handler = automaticNotificationHandler({ prisma: store.db, env, authenticate: () => authenticated,
    loadEvidence: async () => { if (loadError) throw Error('provider offline'); return structuredClone(evidence); },
    suppressionChecker: async () => suppressed,
    fetchImpl: async (url, request) => { posts.push({ url, ...Object.fromEntries(new URLSearchParams(request.body)), redirect: request.redirect });
      if (lostResponse) throw Error('accepted but response lost');
      return { ok: true, status: 201, json: async () => ({ sid: invalidSid ? 'invalid' : 'SM' + '1'.repeat(32), status: 'queued' }) }; } });
  const invoke = async (change = {}) => { const res = response(); await handler({ body: { action: 'send-confirmed', callId, leg: 'customer', args, ...change } }, res); return res; };
  return { ...store, invoke, posts };
}
test('clear approval sends the exact customer text without any manual approval; replay sends once', async () => {
  const h = harness(), first = await h.invoke(), again = await h.invoke();
  assert.equal(first.body.sent, true); assert.equal(first.body.requiresApproval, false); assert.equal(first.body.dispatchReceiptStored, true);
  assert.equal(again.body.sent, true); assert.equal(h.posts.length, 1); assert.equal(h.posts[0].To, '+19055550102');
  assert.equal(h.posts[0].From, route.from); assert.match(h.posts[0].Body, /replace a light/); assert.equal(h.posts[0].redirect, 'error');
  const draft = [...h.rows.values()].find(r => r.data.authorizationBasis);
  assert.equal(draft.data.authorizationBasis, 'caller_confirmation_snapshot'); assert.equal(draft.data.reviewedBy, undefined);
});
for (const answer of ['Yes, please.', 'Perfect. Yes.', 'No worries, send it.']) test('accepts explicit approval: ' + answer, async () => {
  const h = harness({ evidence: { call: call(answer), route } }); assert.equal((await h.invoke()).body.sent, true); assert.equal(h.posts.length, 1);
});
for (const answer of ['No.', 'Wait.', 'Yes, but change the address.', 'Maybe.', 'If I say yes, will it send?']) test('blocks refusal/correction/uncertainty: ' + answer, async () => {
  const h = harness({ evidence: { call: call(answer), route } }); assert.equal((await h.invoke()).statusCode, 409); assert.equal(h.posts.length, 0); assert.equal(h.rows.size, 0);
});
test('save-for-review permission is not permission to send', async () => {
  const h = harness({ evidence: { call: call('Yes.', 'Should I save this request for review?'), route } });
  assert.equal((await h.invoke()).body.errorCode, 'FRESH_SEND_CONFIRMATION_REQUIRED'); assert.equal(h.posts.length, 0);
});
test('available later withdrawal blocks before any durable admission', async () => {
  const c = call(); c.artifact.messagesOpenAIFormatted.push({ role: 'user', content: 'No, wait.' });
  const h = harness({ evidence: { call: c, route } }); assert.equal((await h.invoke()).statusCode, 409); assert.equal(h.rows.size, 0);
});
for (const change of [{ city: 'Different City' }, { workDetailsConfirmed: false }, { approved: true }, { name: {} }, { requestType: 'invented' }]) test('rejects changed or malformed arguments ' + JSON.stringify(change), async () => {
  const h = harness(); assert.equal((await h.invoke({ args: { ...args, ...change } })).statusCode, 409); assert.equal(h.posts.length, 0);
});
test('missing intake remains blocked even when provider tool arguments match', async () => {
  const c = call(), incomplete = { ...args, city: '' };
  c.artifact.messagesOpenAIFormatted.at(-1).tool_calls[0].function.arguments = JSON.stringify(incomplete);
  const h = harness({ evidence: { call: c, route } }); assert.equal((await h.invoke({ args: incomplete })).body.errorCode, 'automatic_notification_intake_required'); assert.equal(h.rows.size, 0);
});
for (const change of [{ assistantId: 'another-tenant' }, { customer: {} }, { phoneNumber: { number: '+19055550999' } }, { startedAt: 'invalid' }, { status: 'queued' }]) test('rejects unverified call/routing ' + JSON.stringify(change), async () => {
  const h = harness({ evidence: { call: { ...call(), ...change }, route } }); assert.equal((await h.invoke()).statusCode, 409); assert.equal(h.posts.length, 0);
});
test('missing history, partial user turns and stale calls fail closed', async () => {
  for (const c of [ { ...call(), artifact: {} }, { ...call(), startedAt: new Date(Date.now() - 1900000).toISOString() } ]) {
    const h = harness({ evidence: { call: c, route } }); assert.equal((await h.invoke()).statusCode, 409); assert.equal(h.posts.length, 0);
  }
  const c = call(); c.artifact.messagesOpenAIFormatted[1].final = false;
  assert.throws(() => confirmedInput({ call: c, route, callId, leg: 'customer', args }), /history_unverified/);
});
test('concurrent duplicate requests produce only one fake provider submission', async () => {
  const h = harness(); await Promise.all([h.invoke(), h.invoke(), h.invoke()]); assert.equal(h.posts.length, 1);
});
for (const mode of ['lostResponse', 'invalidSid']) test(mode + ' stays uncertain and never resubmits', async () => {
  const h = harness({ [mode]: true }); const first = await h.invoke(), again = await h.invoke();
  assert.equal(first.body.sent, false); assert.equal(again.body.sent, false); assert.equal(h.posts.length, 1);
});
test('a saved cancellation cannot be undone by automatic caller approval', async () => {
  const h = harness(); const input = confirmedInput({ call: call(), route, callId, leg: 'customer', args });
  const d = await require('../server/smsNotificationDrafts').prepareNotificationDraft({ prisma: h.db, input });
  await reviewNotificationDraft({ prisma: h.db, id: d.draftId, expectedRevision: d.revision, expectedHash: d.contextHash, action: 'cancel', actor: 'a'.repeat(32) });
  assert.equal((await h.invoke()).statusCode, 409); assert.equal(h.posts.length, 0);
});
test('suppression, disabled gates, auth and read outage produce zero provider submissions', async () => {
  for (const options of [{ suppressed: true }, { enabled: false }, { authenticated: false }, { loadError: true }]) {
    const h = harness(options); assert.notEqual((await h.invoke()).body.sent, true); assert.equal(h.posts.length, 0);
  }
});
test('candidate generated code carries no provider credentials and does not retry an uncertain result', async () => {
  const tool = getAutomaticVapiCompositeToolDefinition(); assert.doesNotMatch(tool.code, /api\.twilio\.com|TWILIO_AUTH_TOKEN|action: 'claim'/);
  assert.match(automaticConfirmationPrompt(), /no admin approval is required/);
  const runner = new Function('args', 'env', 'fetch', 'btoa', 'URLSearchParams', `return (async()=>{${tool.code}})()`);
  const h = harness(); let requests = 0;
  const result = await runner(args, { DEFAULT_FROM_NUMBER: route.from, DEFAULT_OWNER_TO_NUMBER: route.owner,
    OWNER_SMS_ENABLED: 'false', CALLER_NUMBER: '+19055550102', CALL_ID: callId,
    SMS_NOTIFICATION_DISPATCH_URL: 'https://stub.invalid/dispatch', SMS_SUPPRESSION_API_KEY: 'INERT' },
    async (url, request) => { requests++; assert.equal(url, 'https://stub.invalid/dispatch/confirmed');
      const res = await h.invoke(JSON.parse(request.body)); return { ok: res.statusCode === 200, json: async () => res.body }; },
    v => Buffer.from(v).toString('base64'), URLSearchParams);
  assert.equal(result.complete, true); assert.equal(h.posts.length, 1); assert.equal(requests, 1);
});
test('evidence reader uses fixed-origin bounded GETs and rejects an assistant not explicitly enabled', async () => {
  const reads = [];
  const load = createVapiAutomaticEvidenceReader({ prisma: {}, env: { VAPI_API_KEY: 'INERT' }, listEligibleSignups: () => [],
    fetchImpl: async (url, request) => { reads.push({ url, request }); return { ok: true, json: async () => call() }; } });
  await assert.rejects(load(callId), /assistant_not_enabled/); assert.equal(reads.length, 1);
  assert.match(reads[0].url, /^https:\/\/api\.vapi\.ai\/call\//); assert.equal(reads[0].request.redirect, 'error'); assert.ok(reads[0].request.signal);
});

function readerFixture({ changedTool, changedSignups, readFails = false } = {}) {
  const tool = { ...getAutomaticVapiCompositeToolDefinition(), function: { ...getAutomaticVapiCompositeToolDefinition().function, name: 'send_call_summaries_test' },
    environmentVariables: [
      { name: 'CALL_ID', value: '{{ call.id }}' }, { name: 'CALLER_NUMBER', value: '{{ customer.number }}' },
      { name: 'SMS_NOTIFICATION_DISPATCH_URL', value: 'https://stub.invalid/dispatch' },
      { name: 'SMS_SUPPRESSION_CHECK_URL', value: 'https://stub.invalid/suppression/check' },
      { name: 'SMS_SUPPRESSION_API_KEY', value: 'INERT' }, { name: 'DEFAULT_FROM_NUMBER', value: route.from },
      { name: 'DEFAULT_OWNER_TO_NUMBER', value: route.owner }
    ] };
  changedTool?.(tool);
  const signups = changedSignups || [{ businessId: 1, twilioPhoneNumber: route.from, ownerPhone: route.owner, vapiAssistantId: route.assistantId }];
  const reads = [];
  const load = createVapiAutomaticEvidenceReader({
    prisma: { business: { findUnique: async () => ({ name: args.businessName, settings: { ownerPhone: route.owner } }) } },
    env: { VAPI_API_KEY: 'INERT', SMS_AUTOMATIC_ASSISTANT_IDS: route.assistantId }, listEligibleSignups: () => signups,
    fetchImpl: async (url, request) => {
      reads.push({ url, request }); if (readFails) throw Error('read timeout');
      const data = url.includes('/call/') ? call() : url.includes('/tool/') ? tool : {
        model: { toolIds: ['test-tool-id'], messages: [{ role: 'system', content: automaticConfirmationPrompt() }] } };
      return { ok: true, json: async () => data };
    }
  });
  return { load, reads };
}
test('evidence reader binds current call, exact owned code, business, sender and owner before authorization', async () => {
  const f = readerFixture(), evidence = await f.load(callId);
  const input = confirmedInput({ ...evidence, callId, leg: 'customer', args });
  assert.equal(input.to, '+19055550102'); assert.equal(input.from, route.from); assert.equal(f.reads.length, 3);
  assert.ok(f.reads.every(r => r.request.signal === f.reads[0].request.signal));
});
for (const [name, changedTool] of [
  ['foreign sender', t => t.environmentVariables.find(e => e.name === 'DEFAULT_FROM_NUMBER').value = '+19055550999'],
  ['foreign owner', t => t.environmentVariables.find(e => e.name === 'DEFAULT_OWNER_TO_NUMBER').value = '+19055550999'],
  ['retained provider secret', t => t.environmentVariables.push({ name: 'TWILIO_AUTH_TOKEN', value: 'INERT' })],
  ['changed code', t => t.code += '\n// changed'],
  ['duplicate settings', t => t.environmentVariables.push({ name: 'DEFAULT_FROM_NUMBER', value: route.from })]
]) test('evidence reader rejects ' + name, async () => {
  await assert.rejects(readerFixture({ changedTool }).load(callId));
});
test('ambiguous signup identity and read timeout fail closed without retrying', async () => {
  const one = { businessId: 1, twilioPhoneNumber: route.from, ownerPhone: route.owner, vapiAssistantId: route.assistantId };
  await assert.rejects(readerFixture({ changedSignups: [one, one] }).load(callId), /route_unverified/);
  const f = readerFixture({ readFails: true }); await assert.rejects(f.load(callId)); assert.equal(f.reads.length, 1);
});
test('completion-store failure cannot re-admit automatic sending', async () => {
  const h = harness(), original = h.db.runtimeStore.update;
  h.db.runtimeStore.update = async options => { if (options.data.data.state === 'completed') throw Error('commit unavailable'); return original(options); };
  assert.equal((await h.invoke()).statusCode, 503); await h.invoke(); assert.equal(h.posts.length, 1);
});
test('caller-supplied history and routing overrides cannot authorize the route', async () => {
  const h = harness(); for (const fields of [{ messages: call().artifact.messagesOpenAIFormatted }, { from: route.from }, { approved: true }]) {
    assert.equal((await h.invoke(fields)).statusCode, 409);
  }
  assert.equal(h.posts.length, 0); assert.equal(h.rows.size, 0);
});
