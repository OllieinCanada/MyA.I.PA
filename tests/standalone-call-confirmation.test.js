'use strict';
// Deterministic prompt/guard proof, not proof of model speech or Vapi playback.
const test = require('node:test');
const assert = require('node:assert/strict');
const { INTAKE_POLICY } = require('../server/serviceIntakePrompt');
const { callerNumberFallbackPrompt } = require('../server/compositeCallNotifications');
const { updateMessages } = require('../server/vapiIsolatedSmsProvisioning');
const { assessConfirmationHistory, toolRejectionPlan } = require('../server/callConfirmation');
const { evaluateGeneratedPlan } = require('./support/generated-plan-offline.cjs');
const { confirmationConversationPolicy } = require('../server/confirmationConversationPolicy');
const a = content => ({ role: 'assistant', content });
const u = content => ({ role: 'user', content });
const save = 'Should I save this request for review?';
const send = 'Should I send this request to the team now?';
const recap = 'You need a light replaced in Example City, next week; callback after 5. Is that right?';

test('conversation policy requires an explicit known workflow and never mixes save and send consent', () => {
  for (const mode of [undefined, 'unknown', '__proto__', 'toString']) {
    assert.throws(() => confirmationConversationPolicy(mode), /CONFIRMATION_WORKFLOW_REQUIRED/);
  }
  assert.ok(confirmationConversationPolicy('draft').includes(save));
  assert.ok(!confirmationConversationPolicy('draft').includes(send));
  assert.ok(confirmationConversationPolicy('automatic').includes(send));
  assert.ok(!confirmationConversationPolicy('automatic').includes(save));
});

test('all managed draft prompts require separate recap and permission turns with bounded recovery', () => {
  for (const prompt of [INTAKE_POLICY, callerNumberFallbackPrompt('synthetic_tool'),
    updateMessages([{ role: 'system', content: 'Synthetic business facts.' }], 'synthetic_tool')[0].content]) {
    for (const rule of ['Is that right?', 'standalone assistant turn', 'Do not append the permission question',
      'one clarification attempt', 'Tool call rejected based on configured rejection plan',
      'unknown, timed out, accepted or already completed', 'Never treat a refusal as missing consent']) {
      assert.ok(prompt.includes(rule), rule);
    }
    assert.ok(prompt.includes(save));
  }
});

test('synthetic truncated working history rejects; only a fresh standalone question and reply recover', () => {
  for (const question of [save, send]) {
    const broken = [a('Your callback preference is anytime'), u('Yes, please.')];
    const histories = [
      [broken, false],
      [[...broken, u('Yes, please.')], false],
      [[a(recap), u('Yes, please.')], false],
      [[...broken, a(question)], false],
      [[...broken, a(question), u('Yes, please.')], true],
      [[a(recap), u('Yes.'), a(question), u('Yes, please.')], true],
      [[a(recap), u('Yes.'), a(question), u('No.')], false],
      [[a(recap), u('Yes.'), a(question), u('Yes, but change the city.')], false],
      [[a(recap), u('Yes.'), a(question), u('Yes.'), u('Wait.')], false],
      [[a(recap), u('Yes.'), a(question.slice(0, -10)), u('Yes.')], false],
    ];
    for (const [messages, allowed] of histories) {
      assert.equal(assessConfirmationHistory(messages).allowed, allowed, JSON.stringify(messages));
      assert.equal(evaluateGeneratedPlan(toolRejectionPlan(), messages), allowed, JSON.stringify(messages));
    }
  }
});
