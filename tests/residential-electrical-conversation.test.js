'use strict';
// Compiled prompt and deterministic guard/transport proof only. These checks
// do not prove model speech, audible playback, real delivery or live rollout.
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSignupAssistantConfig } = require('../server/signupAssistantTemplate');
const { CONSENT_NOTICE, fixedConsentOpening, normalizeConsentPrompt, signupSpeechPatch,
  inspectSignupSpeech, isResidentialElectrical, RESIDENTIAL_SERVICE_SENTENCE,
  RESIDENTIAL_HELP_QUESTION, ADDITIONAL_INFORMATION_QUESTION, RESIDENTIAL_SUCCESS_CLOSING,
  RESIDENTIAL_CONVERSATION_POLICY } = require('../server/signupSpeechPolicy');
const { updateMessages, assistantSecurityPatch } = require('../server/vapiIsolatedSmsProvisioning');
const { assessSignupAssistantContent } = require('../server/signupAssistantVerification');
const { prepareAutomaticAssistantConnection } = require('../server/automaticAssistantConnectionPlan');
const { assessConfirmationHistory, toolRejectionPlan } = require('../server/callConfirmation');
const { evaluateGeneratedPlan } = require('./support/generated-plan-offline.cjs');
const { executeAutomaticCallNotifications } = require('../server/automaticCallNotifications');
const { createDispatchStub } = require('../scripts/stub-notification-dispatch');

const context = { businessType: 'Electrical', specializations: ['Residential'] };
const a = content => ({ role: 'assistant', content });
const u = content => ({ role: 'user', content });
const sendQuestion = 'Should I send this request to the team now?';
const recap = 'You need a lighting repair in Example City next week; callback after 5. Is that right?';
function config(overrides = {}) {
  return buildSignupAssistantConfig({ businessProfile: { businessName: 'Example Electrical', services: 'Lighting repairs' },
    setupDetails: { businessType: context.businessType, serviceArea: 'Example City', ownerPhone: '+19055550100' },
    specializations: context.specializations, ...overrides }, { assignedPhone: '+13655550101' });
}
const promptOf = assistant => assistant.model.messages.find(m => m.role === 'system').content;

test('exact matching opening follows greeting and recording notice once, before listening', () => {
  const assistant = config();
  assert.equal(assistant.firstMessage, `Thanks for calling Example Electrical. ${CONSENT_NOTICE} ${RESIDENTIAL_SERVICE_SENTENCE} ${RESIDENTIAL_HELP_QUESTION}`);
  assert.equal((assistant.firstMessage.match(/\?/g) || []).length, 1);
  assert.equal((assistant.firstMessage.match(/recorded/g) || []).length, 1);
  assert.equal(fixedConsentOpening(assistant.firstMessage, context), assistant.firstMessage);
  assert.deepEqual(signupSpeechPatch(assistant), signupSpeechPatch(assistant, context));
  assert.ok(Object.values(inspectSignupSpeech(assistant)).every(Boolean));
  assert.match(promptOf(assistant), /Briefly acknowledge it and reuse information already supplied/);
  assert.doesNotMatch(promptOf(assistant), /Are you looking for a new installation, service, or repair today\?|Thank you for calling\. Goodbye\./);
  assert.equal(assistant.voice.voiceId, 'Jess');
  assert.match(promptOf(assistant), /downed, arcing, or sparking wire/);
});

for (const [label, fields] of [
  ['plumber serving homes', { businessType: 'Plumbing', specializations: ['Residential'] }],
  ['commercial-only electrical', { businessType: 'Electrical', specializations: ['Commercial'] }],
  ['unknown property scope', { businessType: 'Electrical', specializations: [] }],
  ['electrical wording only in a business name', { businessType: 'General services', specializations: ['Residential'] }],
  ['ambiguous trade', { businessType: 'Electrical and Plumbing', specializations: ['Residential'] }],
]) test('does not install residential wording for ' + label, () => {
  const assistant = config({ businessProfile: { businessName: 'Residential Electrical Example', services: 'Residential electrical work' },
    setupDetails: { businessType: fields.businessType, serviceArea: 'Example City', ownerPhone: '+19055550100' }, specializations: fields.specializations });
  assert.equal(isResidentialElectrical(fields), false);
  assert.match(assistant.firstMessage, /How can I help you today\?$/);
  assert.ok(!assistant.firstMessage.includes(RESIDENTIAL_SERVICE_SENTENCE));
  assert.ok(!promptOf(assistant).includes(RESIDENTIAL_CONVERSATION_POLICY));
  assert.ok(!promptOf(assistant).includes(ADDITIONAL_INFORMATION_QUESTION));
  assert.match(promptOf(assistant), /Thank you for calling\. Goodbye\./);
});

test('mixed property choices keep all saved facts while matching only the saved electrical trade', () => {
  const assistant = config({ specializations: ['Residential', 'Commercial'] });
  assert.ok(assistant.firstMessage.includes(RESIDENTIAL_SERVICE_SENTENCE));
  assert.match(promptOf(assistant), /Property types served: Residential, Commercial/);
  assert.equal(isResidentialElectrical({ businessType: 'Electrical contractor', specializations: ['residential'] }), true);
  assert.equal(isResidentialElectrical({ businessType: 'Electrician', specializations: ['Residential'] }), true);
  assert.equal(isResidentialElectrical({ services: 'Residential electrical work', businessName: 'Electrician' }), false);
});

test('shared policy and tool migrations preserve exact canonical scope and content fingerprint idempotently', () => {
  const assistant = config();
  const migrated = { ...assistant, ...assistantSecurityPatch(assistant), model: { ...assistant.model,
    messages: updateMessages(assistant.model.messages, 'send_call_summaries_0101_abcdef12_v2') } };
  assert.equal(assessSignupAssistantContent({ expectedConfig: assistant, liveAssistant: migrated }).passed, true);
  assert.equal(normalizeConsentPrompt(promptOf(assistant)), promptOf(assistant));
  assert.equal(normalizeConsentPrompt(promptOf(migrated)), promptOf(migrated));
  assert.deepEqual(updateMessages(migrated.model.messages, 'send_call_summaries_0101_abcdef12_v2'), migrated.model.messages);
  assert.ok(Object.values(inspectSignupSpeech(migrated)).every(Boolean));
  assert.equal(promptOf(migrated).split(RESIDENTIAL_CONVERSATION_POLICY).length, 2);
  assert.equal(normalizeConsentPrompt('Business facts only.').includes(RESIDENTIAL_CONVERSATION_POLICY), false);
  assert.equal(signupSpeechPatch({ firstMessage: `Thanks for calling Example Electrical. ${RESIDENTIAL_SERVICE_SENTENCE}` }).firstMessage.includes(RESIDENTIAL_SERVICE_SENTENCE), false);
});

test('modified or duplicated scoped policy requires review rather than inferring or silently rewriting scope', () => {
  const text = promptOf(config());
  assert.throws(() => normalizeConsentPrompt(text.replace('our service manager', 'invented manager')), /CONVERSATION_REVIEW_REQUIRED/);
  assert.throws(() => normalizeConsentPrompt(text + '\n' + RESIDENTIAL_CONVERSATION_POLICY), /CONVERSATION_REVIEW_REQUIRED/);
});

function automaticCandidate() {
  const assistant = config();
  assistant.id = 'synthetic-residential-assistant';
  assistant.model.toolIds = ['synthetic-end-call', 'synthetic-legacy'];
  assistant.model.messages = updateMessages(assistant.model.messages, 'send_call_summaries_0101_abcdef12_v2');
  const fixture = { businessId: 7,
    signup: { businessId: 7, vapiAssistantId: assistant.id, vapiPhoneNumberId: 'synthetic-phone', twilioPhoneNumber: '+13655550101', ownerPhone: '+19055550100', status: 'setup_error' },
    assistant, phone: { id: 'synthetic-phone', number: '+13655550101', assistantId: assistant.id },
    legacyTool: { id: 'synthetic-legacy', type: 'code', function: { name: 'send_call_summaries_0101_abcdef12_v2' }, environmentVariables: [
      { name: 'DEFAULT_FROM_NUMBER', value: '+13655550101' }, { name: 'DEFAULT_OWNER_TO_NUMBER', value: '+19055550100' }] } };
  const before = structuredClone(fixture);
  const candidate = prepareAutomaticAssistantConnection(fixture);
  assert.deepEqual(fixture, before);
  return { fixture, candidate, prompt: candidate.assistantPatch.model.messages[0].content };
}

test('effective automatic candidate preserves exact additions question and result-gated closing without manual approval', () => {
  const { candidate, prompt } = automaticCandidate();
  assert.equal(prompt.split(ADDITIONAL_INFORMATION_QUESTION).length, 2);
  assert.equal(prompt.split(RESIDENTIAL_SUCCESS_CLOSING).length, 2);
  for (const rule of ['Only after all required intake information', 'A yes to that additional-information question',
    'A no means no additional information, not cancellation', 'Neither answer to the additional-information question grants sending permission',
    'Any correction requires an updated recap and fresh permission', 'successful handoff with complete true',
    'draftStored-only result is not a successful notification handoff', 'failed, missing or uncertain result',
    'Let the entire closing finish before invoking endCall', 'No manual operator approval is required', 'Never ask for manual operator approval',
    'accepted is not delivered', sendQuestion]) assert.ok(prompt.includes(rule), rule);
  assert.doesNotMatch(prompt, /Should I save this request for review\?|Human review is still required|Thank you for calling\. Goodbye\./);
  assert.equal(candidate.applyAllowed, false);
  assert.equal(candidate.liveTestAllowed, false);
});

test('draft-only migration retains its truthful result handling and does not gain automatic sending from conversation text', () => {
  const messages = updateMessages(config().model.messages, 'send_call_summaries_0101_abcdef12_v2');
  const prompt = messages[0].content;
  assert.match(prompt, /Phone calls can prepare drafts only/);
  assert.match(prompt, /draftStored true means only that drafts were saved for manual review/);
  assert.match(prompt, /No text messages have been sent/);
  assert.match(prompt, /draftStored-only result is not a successful notification handoff/);
});

const historyCases = [
  ['additional yes', [a(ADDITIONAL_INFORMATION_QUESTION), u('Yes.')], false],
  ['additional no', [a(ADDITIONAL_INFORMATION_QUESTION), u('No.')], false],
  ['added information without fresh permission', [a(ADDITIONAL_INFORMATION_QUESTION), u('Yes. Please use the rear entrance.')], false],
  ['old permission is consumed by an additional-info question', [a(sendQuestion), u('Yes.'), a(ADDITIONAL_INFORMATION_QUESTION), u('Yes.')], false],
  ['no additions followed by recap only', [a(ADDITIONAL_INFORMATION_QUESTION), u('No.'), a(recap), u('Yes.')], false],
  ['no additions is not cancellation after fresh send approval', [a(ADDITIONAL_INFORMATION_QUESTION), u('No.'), a(recap), u('Yes.'), a(sendQuestion), u('Yes.')], true],
  ['added details followed by corrected recap and permission', [a(ADDITIONAL_INFORMATION_QUESTION), u('Yes, the rear entrance.'), a(ADDITIONAL_INFORMATION_QUESTION), u('No.'), a(recap), u('Yes.'), a(sendQuestion), u('Yes.')], true],
  ['explicit refusal of sending', [a(ADDITIONAL_INFORMATION_QUESTION), u('No, don’t send it.'), a(sendQuestion), u('No.')], false],
  ['late correction', [a(recap), u('Yes.'), a(sendQuestion), u('Yes, but change the city.')], false],
];
for (const [name, messages, allowed] of historyCases) test('unchanged server and generated guard: ' + name, () => {
  assert.equal(assessConfirmationHistory(messages).allowed, allowed);
  assert.equal(evaluateGeneratedPlan(toolRejectionPlan(), messages), allowed);
});

function dispatchFixture(messages) {
  const { fixture, candidate } = automaticCandidate();
  const stub = createDispatchStub();
  const posts = [];
  const options = { prisma: stub.db, authenticated: true,
    env: { SMS_AUTOMATIC_NOTIFICATION_ENABLED: 'true', SMS_NOTIFICATION_DISPATCH_ENABLED: 'true', SMS_AUTOMATIC_NOTIFICATION_BUSINESS_IDS: '[7]', TWILIO_ACCOUNT_SID: 'AC' + '0'.repeat(32), TWILIO_AUTH_TOKEN: 'INERT' },
    message: { timestamp: Date.now(), call: { id: 'synthetic-residential-call', assistantId: fixture.assistant.id, phoneNumberId: fixture.phone.id, customer: { number: '+19055550102' } }, toolCallList: [{}], artifact: { messages: messages.map(m => ({ role: m.role, message: m.content })) } },
    toolCall: { id: 'synthetic-residential-tool-call', name: candidate.toolName, parameters: { businessName: 'Example Electrical', requestType: 'message', name: 'Example Caller', pricingDiscussed: false, message: 'Synthetic request' } },
    readContext: async () => ({ businessId: 7, businessName: 'Example Electrical', assistantId: fixture.assistant.id, phoneNumberId: fixture.phone.id, from: fixture.phone.number, owner: fixture.signup.ownerPhone, eligible: true, pricingOptions: null }),
    suppressionChecker: async () => false,
    fetchImpl: async (url, request) => {
      assert.equal(url, 'https://api.twilio.com/2010-04-01/Accounts/AC' + '0'.repeat(32) + '/Messages.json');
      posts.push(Object.fromEntries(new URLSearchParams(request.body)));
      return { ok: true, status: 201, json: async () => ({ sid: 'SM' + String(posts.length).padStart(32, '0'), status: 'queued' }) };
    } };
  return { options, posts };
}

test('matching compiled candidate plus actual automatic handler: additional yes causes zero fake sends', async () => {
  const f = dispatchFixture([a(ADDITIONAL_INFORMATION_QUESTION), u('Yes.')]);
  assert.equal((await executeAutomaticCallNotifications(f.options)).complete, false);
  assert.equal(f.posts.length, 0);
});

test('matching candidate saves and dispatches once only after separate fresh permission, never duplicate sends', async () => {
  const f = dispatchFixture([a(ADDITIONAL_INFORMATION_QUESTION), u('No.'), a(recap), u('Yes.'), a(sendQuestion), u('Yes.')]);
  const result = await executeAutomaticCallNotifications(f.options);
  assert.equal(result.complete, true);
  assert.deepEqual(f.posts.map(p => p.To), ['+19055550100', '+19055550102']);
  await executeAutomaticCallNotifications(f.options);
  assert.equal(f.posts.length, 2);
});

test('matching candidate preserves uncertain-outcome refusal rather than sending again to obtain a success closing', async () => {
  const f = dispatchFixture([a(recap), u('Yes.'), a(sendQuestion), u('Yes.')]);
  const transport = f.options.fetchImpl;
  f.options.fetchImpl = async (...args) => { await transport(...args); throw Error('Synthetic lost acknowledgement'); };
  assert.equal((await executeAutomaticCallNotifications(f.options)).complete, false);
  await executeAutomaticCallNotifications(f.options);
  assert.equal(f.posts.length, 2);
});
