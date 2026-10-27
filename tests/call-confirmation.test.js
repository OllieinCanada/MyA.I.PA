const test = require('node:test');
const assert = require('node:assert/strict');
const { acceptsConfirmation, toolRejectionPlan } = require('../server/callConfirmation');
const question = 'Your request is for electrical work next week. Should I send this request to the team now?';
const approvals = ['Yes.', 'Perfect. Yes.', 'Perfect.Yes.', 'Perfect, yes please.', 'Yes. Please.', 'Yes, please.', 'Yes, go ahead.',
  'Sure, send it.', 'Okay. Yes.', 'Absolutely!', 'Yeah, please do.', 'Yep.', 'Yup', 'Sounds good.', 'Go ahead.',
  'Uh, yes.', 'Um yes please.', 'Alright, yep.', 'That is right.', "That's correct.", 'Please send the request to the team.', 'Yes and please send it.'];
const refusals = ['No.', 'Not yet.', 'Maybe.', "I'm not sure.", 'Wait.', 'Hold on.', 'Cancel.', 'Never mind.',
  "Yes, don't send it.", 'Perfect, but change the city.', 'The address is correct, but do not text me.', "That's not correct.",
  'No, that is correct.', 'Yes unless I call back.', 'If I say yes, will you send it?', 'Yes?', 'Thanks.', '',
  'I said yes earlier.', 'He said yes.', 'Send it if the price is lower.', 'Correct the address.', 'Yes. Stop.'];
function rejectedByPlan(user, assistant) {
  return toolRejectionPlan().conditions[0].conditions.some(condition => {
    const input = condition.target.role === 'user' ? user : assistant;
    const matched = new RegExp(condition.regex.replace(/^\(\?i\)/, ''), 'i').test(input);
    return condition.negate ? !matched : matched;
  });
}
test('natural complete approvals include the exact recorded Perfect. Yes. regression', () => {
  for (const phrase of approvals) {
    assert.equal(acceptsConfirmation(phrase, question), true, phrase);
    assert.equal(rejectedByPlan(phrase, question), false, phrase);
  }
});
test('refusals, uncertainty, corrections and embedded approval words stay blocked', () => {
  for (const phrase of refusals) {
    assert.equal(acceptsConfirmation(phrase, question), false, phrase);
    assert.equal(rejectedByPlan(phrase, question), true, phrase);
  }
});
test('pricing agreement, address confirmation or a stale send question cannot authorize execution', () => {
  for (const context of ['Would you like to continue?', 'Is the city correct?', 'Should I send this request to the team now? What is your name?', '']) {
    assert.equal(acceptsConfirmation('Perfect. Yes.', context), false);
    assert.equal(rejectedByPlan('Perfect. Yes.', context), true);
  }
  assert.equal(acceptsConfirmation('Yes.', 'Is all of that correct, and do you want me to submit it now?'), true);
});
