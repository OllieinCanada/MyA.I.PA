'use strict';
// Regressions for the audited ordering schedules. Phone execution must never
// submit a provider message, even when its speech history is incomplete.
const test = require('node:test');
const assert = require('node:assert/strict');
const { getVapiCompositeToolDefinition } = require('../server/compositeCallNotifications');
const { toolRejectionPlan, assessConfirmationHistory } = require('../server/callConfirmation');
const { evaluateGeneratedPlan } = require('./support/generated-plan-offline.cjs');
const { createDispatchStub } = require('../scripts/stub-notification-dispatch');
const a = content => ({ role: 'assistant', content });
const u = content => ({ role: 'user', content });
const question = 'Repair at 1 Test St, Example City, next week; callback after 2 PM. Should I send this request to the team now?';
const yes = () => [a(question), u('Yes.')];
const withdrawal = u('No, wait. Do not send it.');
const input = { businessName: 'Synthetic Business', name: 'Test Caller', requestType: 'repair',
  jobDetails: 'replace a light', streetAddress: '1 Test St', city: 'Example City',
  preferredStartDate: 'next week', bestCallbackTime: 'after 2 PM', pricingDiscussed: false, workDetailsConfirmed: true };
const settings = { TWILIO_ACCOUNT_SID: 'AC_INERT', TWILIO_AUTH_TOKEN: 'INERT',
  DEFAULT_FROM_NUMBER: '+19055550100', DEFAULT_OWNER_TO_NUMBER: '+19055550101', CALLER_NUMBER: '+19055550102',
  CALL_ID: 'ordering-audit-call', SMS_SUPPRESSION_CHECK_URL: 'https://stub.invalid/check',
  SMS_SUPPRESSION_API_KEY: 'INERT', SMS_NOTIFICATION_DISPATCH_URL: 'https://stub.invalid/dispatch' };
const code = getVapiCompositeToolDefinition().code;
const runner = new Function('args', 'env', 'fetch', 'btoa', 'URLSearchParams', `return (async()=>{${code}\n})()`);
function harness({ during, outcome, loseCompletion = false } = {}) {
  const store = createDispatchStub(), posts = [], actions = [];
  const fake = async (url, options) => {
    if (url === settings.SMS_SUPPRESSION_CHECK_URL) return { ok: true, status: 200, json: async () => ({ allowed: true, suppressed: false }) };
    assert.equal(url, 'https://api.twilio.com/2010-04-01/Accounts/AC_INERT/Messages.json');
    const post = Object.fromEntries(new URLSearchParams(options.body));
    posts.push(post);
    if (during) await during(posts.length);
    if (outcome === 'unknown') throw Error('synthetic response lost after fake acceptance');
    if (outcome === 'missing-sid') return { ok: true, status: 201, json: async () => ({ status: 'queued' }) };
    return { ok: true, status: 201, json: async () => ({ sid: 'SM' + String(posts.length).repeat(32), status: 'queued' }) };
  };
  const wrapped = store.wrap(fake);
  const fetchStub = async (url, options) => {
    if (url === settings.SMS_NOTIFICATION_DISPATCH_URL) {
      const action = JSON.parse(options.body).action; actions.push(action);
      // Lose acknowledgement AFTER the completion was committed.
      const response = await wrapped(url, options);
      if (loseCompletion && action === 'complete') throw Error('synthetic completion acknowledgement lost');
      return response;
    }
    return wrapped(url, options);
  };
  async function run(messages = yes(), changed = {}, env = {}) {
    if (!evaluateGeneratedPlan(toolRejectionPlan(), messages)) return { blocked: true, complete: false };
    return runner({ ...input, ...changed }, { ...settings, ...env }, fetchStub,
      value => Buffer.from(value).toString('base64'), URLSearchParams);
  }
  return { run, posts, actions, store };
}
function gap(h) {
  assert.equal(h.posts.length, 0, 'Voice execution must only save drafts.');
}
test('ordering regression: delayed withdrawal is absent from evaluated history', async () => {
  const actual = [...yes(), withdrawal];
  assert.equal(assessConfirmationHistory(actual).allowed, false);
  const h = harness(); await h.run(actual.slice(0, -1)); gap(h);
});
test('ordering regression: permanently missing withdrawal is indistinguishable from an approved call', async () => {
  const approved = yes(), observedAfterLoss = structuredClone(approved);
  assert.deepEqual(observedAfterLoss, approved);
  const h = harness(); await h.run(observedAfterLoss); gap(h);
});
test('ordering regression: old yes reordered after new send question appears fresh', async () => {
  const actual = [a('Is that your name?'), u('Yes.'), a(question)];
  assert.equal(assessConfirmationHistory(actual).allowed, false);
  const h = harness(); await h.run([actual[0], actual[2], actual[1]]); gap(h);
});
test('ordering regression: supplied complete history can differ from provider evaluated prefix', async () => {
  // This MODELS the discrepancy; it does not reproduce Vapi internals.
  const supplied = [...yes(), u('Change the city.')], evaluated = yes();
  assert.equal(evaluateGeneratedPlan(toolRejectionPlan(), supplied), false);
  const h = harness(); await h.run(evaluated); gap(h);
});
test('delayed cancellation between draft saves cannot produce a provider send', async () => {
  const messages = yes(); const h = harness(); await h.run(messages); messages.push(withdrawal);
  await h.run(messages); assert.equal(assessConfirmationHistory(messages).allowed, false); gap(h);
});
test('ordering regression: partial approval metadata is not inspected by the local guard', async () => {
  const h = harness(); await h.run([a(question), { ...u('Yes.'), transcriptType: 'partial', final: false }]); gap(h);
});
test('ordering regression: approved readback does not bind the dispatched structured fields', async () => {
  const h = harness(); await h.run(yes(), { city: 'Different City' });
  assert.ok([...h.store.rows.values()].some(r => r.data.input?.body.includes('Different City'))); gap(h);
});
test('visible withdrawal blocks both legs before any claim', async () => {
  const h = harness(); assert.equal((await h.run([...yes(), withdrawal])).blocked, true);
  assert.equal(h.posts.length, 0); assert.equal(h.actions.length, 0);
});
test('split approval with later correction blocks before any claim', async () => {
  const h = harness(); await h.run([...yes(), u('but change the city.')]);
  assert.equal(h.posts.length, 0); assert.equal(h.actions.length, 0);
});
test('worker timestamps do not certify history completeness or chronology', () => {
  const messages = [ { ...a(question), timestamp: 9000 }, { ...u('Yes.'), timestamp: 1000 } ];
  assert.equal(assessConfirmationHistory(messages).allowed, true);
  assert.equal(evaluateGeneratedPlan(toolRejectionPlan(), messages), true);
});
test('voice replay and changed identity still cannot send provider messages', async () => {
  const h = harness(); for (const env of [{}, {}, { CALL_ID: 'another-call' }, { DEFAULT_FROM_NUMBER: '+19055550103' }]) {
    const result = await h.run(yes(), {}, env); assert.equal(result.complete, false); assert.equal(result.draftStored, true);
  }
  assert.equal(h.posts.length, 0);
});
