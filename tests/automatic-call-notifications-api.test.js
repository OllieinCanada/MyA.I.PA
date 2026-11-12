'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createDispatchStub } = require('../scripts/stub-notification-dispatch');
const { AUTOMATIC_NOTIFICATION_TOOL } = require('../server/compositeCallNotifications');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'myaipa-automatic-webhook-'));
Object.assign(process.env, { NODE_ENV: 'test', DISABLE_LOCAL_ENV_FILES: '1', DATABASE_URL: '', DATA_DIR: directory,
  SECURITY_STATE_FORCE_DATABASE: 'false', VAPI_WEBHOOK_SECRET: 'synthetic-automatic-webhook-secret',
  VAPI_API_KEY: '', INTEGRATION_API_KEY: '', VAPI_AUTO_SYNC_ENABLED: 'false', TELEGRAM_BOT_TOKEN: '', TELEGRAM_CHAT_ID: '',
  TWILIO_ACCOUNT_SID: 'AC_INERT', TWILIO_AUTH_TOKEN: 'INERT', STRIPE_SECRET_KEY: '', SMTP_HOST: '', MAKE_SIGNUP_WEBHOOK_URL: '',
  SMS_AUTOMATIC_DISPATCH_ENABLED: 'true', TRIAL_REMINDER_DISABLE: 'true', MISSED_CALL_ALERT_ENABLED: 'false',
  DAILY_DIGEST_ENABLED: 'false', SIGNUP_SETUP_WORKER_PAUSED: 'true' });
const store = createDispatchStub();
global.__myAiPaPrisma = new Proxy({ ...store.db, smsSuppression: { findUnique: async () => null } }, {
  get(target, key) { if (key in target) return target[key]; if (key === 'then') return undefined;
    return new Proxy({}, { get: () => async () => { throw Error('Unexpected DB/model path; must not use legacy lead handoff'); } }); }
});
const automatic = require('../server/automaticCallNotifications');
const route = { assistantId: 'synthetic-assistant', from: '+19055550100', owner: '+19055550101', businessName: 'Synthetic Business',
  ownerEnabled: true, pricingOptions: { includePartsExtra: true, includeAssessment: true } };
automatic.createAutomaticWebhookRouteLoader = () => async () => route; // Unit tests cover the actual saved-route loader.
const realFetch = global.fetch, posts = []; let forbidden = 0;
global.fetch = async (url, options) => {
  if (new URL(String(url)).hostname === '127.0.0.1') return realFetch(url, options);
  if (url === 'https://api.twilio.com/2010-04-01/Accounts/AC_INERT/Messages.json') {
    posts.push(Object.fromEntries(new URLSearchParams(options.body)));
    return { ok: true, status: 201, json: async () => ({ sid: 'SM' + String(posts.length).repeat(32), status: 'queued' }) };
  }
  forbidden++; throw Error('External requests forbidden; no GET /call polling');
};
const { app } = require('../server/index');
let server, base;
test.before(async () => { server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); base = 'http://127.0.0.1:' + server.address().port; });
test.after(async () => { await new Promise(resolve => server.close(resolve)); global.fetch = realFetch; });
test.beforeEach(() => { store.rows.clear(); posts.length = 0; forbidden = 0; });
function payload(answer = 'Perfect. Yes.') {
  return { message: { type: 'tool-calls', call: { id: '11111111-2222-4333-8444-555555555555', assistantId: route.assistantId },
    phoneNumber: { number: route.from }, customer: { number: '+19055550102' }, artifact: { messagesOpenAIFormatted: [
      { role: 'assistant', content: 'Should I send this request to the team now?' }, { role: 'user', content: answer }] },
    toolCallList: [{ id: 'synthetic-tool-id', type: 'function', function: { name: AUTOMATIC_NOTIFICATION_TOOL,
      arguments: { businessName: route.businessName, requestType: 'message', name: 'Test', message: 'Please call me.', pricingDiscussed: false } } }] } };
}
async function request(body, authenticated = true) {
  const res = await fetch(base + '/api/webhooks/voice', { method: 'POST', headers: { 'content-type': 'application/json',
    ...(authenticated ? { 'x-vapi-secret': 'synthetic-automatic-webhook-secret' } : {}) }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}
test('real HTTP authenticated webhook sends inert owner/customer requests once and returns matched results', async () => {
  const first = await request(payload()), replay = await request(payload());
  assert.equal(first.status, 200); assert.equal(first.body.results[0].toolCallId, 'synthetic-tool-id');
  assert.equal(JSON.parse(first.body.results[0].result).complete, true); assert.equal(JSON.parse(replay.body.results[0].result).complete, true);
  assert.equal(posts.length, 2); assert.equal(posts[1].To, '+19055550102'); assert.equal(forbidden, 0);
});
test('unauthenticated webhook cannot reach the sender', async () => {
  assert.equal((await request(payload(), false)).status, 401); assert.equal(posts.length, 0);
});
test('refusal returns HTTP 200 with matched tool error, not success or a legacy handoff', async () => {
  const result = await request(payload('No, wait.'));
  assert.equal(result.status, 200); assert.equal(result.body.results[0].error, 'REFUSAL_CORRECTION_OR_UNCERTAINTY');
  assert.equal(posts.length, 0); assert.equal(store.rows.size, 0); assert.equal(forbidden, 0);
});
test('malformed tool arguments return matched errors before any sending', async () => {
  const p = payload(); p.message.toolCallList[0].function.arguments = '{private-broken-json';
  const result = await request(p); assert.equal(result.status, 200); assert.equal(result.body.results[0].error, 'VAPI_TOOL_ARGUMENTS_INVALID');
  assert.equal(posts.length, 0); assert.doesNotMatch(JSON.stringify(result.body), /private-broken/);
});
test('missing live artifact does not fall back to a persisted call snapshot', async () => {
  const p = payload(); p.message.call.artifact = p.message.artifact; delete p.message.artifact;
  const result = await request(p); assert.equal(result.body.results[0].error, 'automatic_notification_history_unverified'); assert.equal(posts.length, 0);
});
