'use strict';
// Inert provider transport. Exercises documented webhook shapes, not Vapi/PSTN.
const test = require('node:test'), assert = require('node:assert/strict');
const { createDispatchStub } = require('../scripts/stub-notification-dispatch');
const { handleAutomaticNotificationTool, confirmWebhook, createAutomaticWebhookRouteLoader } = require('../server/automaticCallNotifications');
const { getAutomaticVapiCompositeToolDefinition, automaticConfirmationPrompt, AUTOMATIC_NOTIFICATION_TOOL } = require('../server/compositeCallNotifications');
const { prepareNotificationDraft, reviewNotificationDraft } = require('../server/smsNotificationDrafts');
const callId = '11111111-2222-4333-8444-555555555555';
const args = { businessName: 'Synthetic Business', requestType: 'repair', name: 'Test', jobDetails: 'replace a light',
  streetAddress: '1 Test St', city: 'Example City', preferredStartDate: 'next week', bestCallbackTime: 'after 2 PM',
  workDetailsConfirmed: true, pricingDiscussed: false };
const route = { from: '+19055550100', owner: '+19055550101', ownerEnabled: true, assistantId: 'test-assistant',
  businessName: args.businessName, pricingOptions: { includePartsExtra: true, includeAssessment: true } };
function message(answer = 'Perfect. Yes.', input = args) {
  return { type: 'tool-calls', call: { id: callId, assistantId: route.assistantId, phoneNumberId: 'phone-test' },
    phoneNumber: { id: 'phone-test', number: route.from }, customer: { number: '+19055550102' },
    artifact: { messagesOpenAIFormatted: [
      { role: 'assistant', content: 'Should I send this request to the team now?' }, { role: 'user', content: answer }
    ] }, toolCallList: [{ id: 'test-invocation', type: 'function',
      function: { name: AUTOMATIC_NOTIFICATION_TOOL, arguments: input } }] };
}
function harness({ ownerEnabled = true, lostResponse = false, invalidSid = false, suppressed = false,
  enabled = true, authenticated = true, routeError = false } = {}) {
  const store = createDispatchStub(), posts = [];
  const env = { SMS_AUTOMATIC_DISPATCH_ENABLED: enabled ? 'true' : 'false', TWILIO_ACCOUNT_SID: 'AC_INERT', TWILIO_AUTH_TOKEN: 'INERT' };
  const invoke = (m = message()) => handleAutomaticNotificationTool({ message: m, rawToolCall: m.toolCallList[0],
    authenticated, prisma: store.db, env,
    loadRoute: async () => { if (routeError) throw Error('db unavailable'); return { ...route, ownerEnabled }; },
    suppressionChecker: async () => suppressed,
    fetchImpl: async (url, request) => {
      posts.push({ url, ...Object.fromEntries(new URLSearchParams(request.body)), redirect: request.redirect });
      if (lostResponse) throw Error('accepted but response lost');
      return { ok: true, status: 201, json: async () => ({ sid: invalidSid ? 'invalid' : 'SM' + String(posts.length).repeat(32), status: 'queued' }) };
    } });
  return { ...store, posts, invoke };
}
test('documented live role/content history plus explicit toolCallList sends automatically once per leg', async () => {
  const h = harness(), first = await h.invoke(), again = await h.invoke();
  assert.equal(first.complete, true); assert.equal(first.requiresApproval, false); assert.equal(again.complete, true);
  assert.equal(h.posts.length, 2); assert.equal(h.posts[0].To, route.owner); assert.equal(h.posts[1].To, '+19055550102');
  assert.ok(h.posts.every(p => p.From === route.from && p.redirect === 'error')); assert.match(h.posts[1].Body, /replace a light/);
  assert.ok([...h.rows.values()].filter(r => r.data.authorizationBasis).every(r => r.data.authorizationBasis === 'caller_confirmation_snapshot' && !r.data.reviewedBy));
});
for (const answer of ['Yes, please.', 'Perfect. Yes.', 'No worries, send it.']) test('accepts clear approval ' + answer, async () => {
  const h = harness(); assert.equal((await h.invoke(message(answer))).complete, true); assert.equal(h.posts.length, 2);
});
for (const answer of ['No.', 'Wait.', 'Yes, but change the address.', 'Maybe.', 'If I say yes, will it send?']) test('blocks refusal/correction/uncertainty ' + answer, async () => {
  const h = harness(); await assert.rejects(h.invoke(message(answer))); assert.equal(h.posts.length, 0); assert.equal(h.rows.size, 0);
});
test('save-for-review consent cannot authorize sending', async () => {
  const m = message(); m.artifact.messagesOpenAIFormatted[0].content = 'Should I save this request for review?';
  const h = harness(); await assert.rejects(h.invoke(m), /FRESH_SEND_CONFIRMATION_REQUIRED/); assert.equal(h.posts.length, 0);
});
test('visible later withdrawal blocks both legs before any admission', async () => {
  const m = message(); m.artifact.messagesOpenAIFormatted.push({ role: 'user', content: 'No, wait.' });
  const h = harness(); await assert.rejects(h.invoke(m), /REFUSAL_CORRECTION_OR_UNCERTAINTY/); assert.equal(h.rows.size, 0);
});
test('stale call.artifact is not a fallback for a missing live artifact', async () => {
  const m = message(); m.call.artifact = m.artifact; delete m.artifact;
  const h = harness(); await assert.rejects(h.invoke(m), /history_unverified/); assert.equal(h.posts.length, 0);
});
test('native live messages work without the optional OpenAI-formatted representation', async () => {
  const m = message(); m.artifact = { messages: [{ role: 'bot', message: 'Should I send this request to the team now?' }, { role: 'user', message: 'Yes, please.' }] };
  assert.equal((await harness().invoke(m)).complete, true);
});
test('a visible refusal in either live representation cannot be ignored', async () => {
  const m = message(); m.artifact.messages = [{ role: 'bot', message: 'Should I send this request to the team now?' }, { role: 'user', message: 'No, wait.' }];
  const h = harness(); await assert.rejects(h.invoke(m), /REFUSAL_CORRECTION_OR_UNCERTAINTY/); assert.equal(h.posts.length, 0);
});
test('partial and oversized live history fail closed', async () => {
  for (const edit of [m => m.artifact.messagesOpenAIFormatted[1].final = false,
    m => m.artifact.messagesOpenAIFormatted = Array(1001).fill({ role: 'user', content: 'Yes.' })]) {
    const m = message(); edit(m); const h = harness(); await assert.rejects(h.invoke(m), /history_unverified/); assert.equal(h.posts.length, 0);
  }
});
for (const changed of [{ approved: true }, { city: {} }, { city: '' }, { workDetailsConfirmed: false }, { requestType: 'invented' }]) test('rejects malformed or incomplete arguments ' + JSON.stringify(changed), async () => {
  const h = harness(); await assert.rejects(h.invoke(message('Yes.', { ...args, ...changed }))); assert.equal(h.rows.size, 0);
});
test('malformed JSON and conflicting aliases are rejected before route loading', async () => {
  for (const edit of [t => t.function.arguments = '{broken', t => t.parameters = { ...args, city: 'Different' }]) {
    const m = message(); edit(m.toolCallList[0]); const h = harness({ routeError: true });
    await assert.rejects(h.invoke(m), /VAPI_TOOL_ARGUMENTS/); assert.equal(h.posts.length, 0);
  }
});
test('JSON-string arguments from the documented function variant work', async () => {
  const m = message(); m.toolCallList[0].function.arguments = JSON.stringify(args);
  assert.equal((await harness().invoke(m)).complete, true);
});
for (const edit of [m => m.call.assistantId = 'other-tenant', m => m.phoneNumber.number = '+19055550999',
  m => m.call.customer = { number: '+19055550999' }, m => delete m.customer,
  m => m.call.id = '', m => m.toolCallList[0].id = '']) test('conflicting/missing call identity is blocked ' + edit.toString(), async () => {
  const m = message(); edit(m); const h = harness(); await assert.rejects(h.invoke(m)); assert.equal(h.posts.length, 0);
});
test('inline assistant calls may use the exact server-saved route without inventing a provider assistant ID', async () => {
  const m = message(); delete m.call.assistantId;
  const result = await harness().invoke(m); assert.equal(result.complete, true);
});
test('model fallback phone never replaces trusted provider caller ID', async () => {
  const h = harness(); await h.invoke(message('Yes.', { ...args, rawPhoneNumber: '+19055550999' }));
  assert.equal(h.posts[1].To, '+19055550102');
});
test('concurrent duplicate webhooks admit once for each leg', async () => {
  const h = harness(); await Promise.all([h.invoke(), h.invoke(), h.invoke()]); assert.equal(h.posts.length, 2);
});
for (const mode of ['lostResponse', 'invalidSid']) test(mode + ' remains uncertain without replaying either leg', async () => {
  const h = harness({ [mode]: true }), first = await h.invoke(), again = await h.invoke();
  assert.equal(first.complete, false); assert.equal(again.complete, false); assert.equal(h.posts.length, 2);
});
test('owner-disabled policy sends only the customer leg', async () => {
  const h = harness({ ownerEnabled: false }), r = await h.invoke();
  assert.equal(r.complete, true); assert.equal(r.owner.skipped, true); assert.equal(h.posts.length, 1); assert.equal(h.posts[0].To, '+19055550102');
});
test('committed cancellation cannot be reopened by a replayed approval', async () => {
  const h = harness(), m = message();
  const input = confirmWebhook({ message: m, rawToolCall: m.toolCallList[0], route }).inputs[1];
  const d = await prepareNotificationDraft({ prisma: h.db, input });
  await reviewNotificationDraft({ prisma: h.db, id: d.draftId, expectedRevision: d.revision, expectedHash: d.contextHash, action: 'cancel', actor: 'a'.repeat(32) });
  const r = await h.invoke(); assert.equal(r.complete, false); assert.equal(h.posts.length, 1); assert.equal(h.posts[0].To, route.owner);
});
test('receipt commit failure never reopens provider admission', async () => {
  const h = harness(), update = h.db.runtimeStore.update;
  h.db.runtimeStore.update = async options => { if (options.data.data.state === 'completed') throw Error('commit unavailable'); return update(options); };
  assert.equal((await h.invoke()).complete, false); assert.equal((await h.invoke()).complete, false); assert.equal(h.posts.length, 2);
});
test('suppression, disabled gate, auth and route outage produce zero provider requests', async () => {
  for (const options of [{ suppressed: true }, { enabled: false }, { authenticated: false }, { routeError: true }]) {
    const h = harness(options); await h.invoke().catch(() => {}); assert.equal(h.posts.length, 0);
  }
});
test('automatic definition is synchronous Function tool with no code, credentials or API polling', () => {
  const tool = getAutomaticVapiCompositeToolDefinition();
  assert.equal(tool.type, 'function'); assert.equal(tool.async, false); assert.equal(tool.function.name, AUTOMATIC_NOTIFICATION_TOOL);
  assert.equal(tool.code, undefined); assert.equal(tool.environmentVariables, undefined); assert.equal(tool.environmentVariableNames, undefined);
  assert.match(automaticConfirmationPrompt(), /no admin approval is required/);
});
function routeFixture(change = {}) {
  const signup = { businessId: 7, vapiAssistantId: route.assistantId, twilioPhoneNumber: route.from, ownerPhone: route.owner };
  const gate = { status: 'active', businessId: 7, assistantId: route.assistantId, phoneNumber: route.from,
    automaticSms: { version: 1, ownerEnabled: false }, assistantSnapshot: { model: { messages: [] } } };
  return createAutomaticWebhookRouteLoader({ prisma: { business: { findUnique: async () => ({ name: args.businessName, settings: { ownerPhone: route.owner } }) } },
    env: { SMS_AUTOMATIC_ASSISTANT_IDS: route.assistantId }, readGate: async () => gate, selectSignup: async () => signup, ...change });
}
test('route loader uses saved route and business policy without any provider GET', async () => {
  const r = await routeFixture()(message()); assert.equal(r.ownerEnabled, false); assert.equal(r.owner, route.owner);
  assert.equal(r.from, route.from); assert.equal(r.assistantId, route.assistantId);
});
for (const change of [{ env: {} }, { readGate: async () => null }, { selectSignup: async () => null },
  { readGate: async () => ({ status: 'active', assistantId: route.assistantId }) },
  { readGate: async () => { throw Error('conflicting aliases'); } }]) test('unverified saved route fails closed ' + Object.keys(change), async () => {
  await assert.rejects(routeFixture(change)(message()));
});
