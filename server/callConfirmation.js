// Approval is the whole latest utterance, not a positive word embedded in a
// correction, refusal, question, quotation or hypothetical instruction.
const positive = "(?:yes|yeah|yep|yup|sure|perfect|absolutely|okay|ok|correct|confirmed|looks good|sounds good|go ahead|please do|that(?:'s| is) (?:right|correct)|(?:please )?send (?:it|that|the request)(?: to the team)?)";
const separator = "[\\s,.;:!?—-]+(?:and[\\s,.;:!?—-]+)?";
const courtesy = "(?:please|thanks|thank you)";
const APPROVAL_REGEX = `(?i)^\\s*(?:(?:uh+|um+|erm|hmm|well|alright)${separator})*${positive}(?:${separator}(?:${positive}|${courtesy}))*[\\s,.!?]*$`;
const WITHDRAWAL_REGEX = "(?i)(?:\\b(?:no|not|cancel|stop|wait|hold|never\\s*mind|do\\s+not|don't|don’t|withdraw|wrong|incorrect|change|except|but|unless|maybe|perhaps|if)\\b|\\?)";
const SEND_QUESTION_REGEX = "(?i)(?:Should I send this request to the team now|Is all of that correct, and do you want me to submit it now)\\?\\s*$";

function toolRejectionPlan() {
  const target = { position: -1, role: 'user' };
  return { conditions: [{ type: 'group', operator: 'OR', conditions: [
    { type: 'regex', regex: APPROVAL_REGEX, target, negate: true },
    { type: 'regex', regex: WITHDRAWAL_REGEX, target },
    { type: 'regex', regex: SEND_QUESTION_REGEX, target: { position: -1, role: 'assistant' }, negate: true },
  ] }] };
}

function acceptsConfirmation(user, assistant) {
  const matches = (pattern, value) => new RegExp(pattern.replace(/^\(\?i\)/, ''), 'i').test(String(value || ''));
  return matches(APPROVAL_REGEX, user) && !matches(WITHDRAWAL_REGEX, user) && matches(SEND_QUESTION_REGEX, assistant);
}

module.exports = { APPROVAL_REGEX, WITHDRAWAL_REGEX, SEND_QUESTION_REGEX, acceptsConfirmation, toolRejectionPlan };
