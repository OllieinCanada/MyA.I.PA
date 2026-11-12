// Conversation guard only: not proof of audible playback, sender admission,
// request-field correctness, delivery or absence of an unseen withdrawal.
const send = '(?:please )?(?:(?:you can|you may) )?(?:send|submit) (?:it|that|the request|this request)(?: to (?:the team|them))?(?: now| over)?';
const benignNo = `no (?:problem|worries)[\\s,.]+(?:go ahead|${send})`;
const positive = `(?:yes|yeah|yep|yup|sure|perfect|absolutely|certainly|okay|ok|correct|confirmed|i confirm|you bet|${benignNo}|looks good|sounds good|go ahead|please do|that(?:['’]s| is) (?:right|correct|fine)|${send})`;
const separator = '[\\s,.;:!?—-]+(?:and[\\s,.;:!?—-]+)?';
const APPROVAL_REGEX = `(?i)^\\s*(?:(?:uh+|um+|erm|hmm|well|alright)${separator})*${positive}(?:${separator}(?:${positive}|please|thanks|thank you))*[\\s,.!?]*$`;
const WITHDRAWAL_REGEX = "(?i)(?:\\b(?:no(?!\\s+(?:problem|worries)\\b)|not|cancel|stop|wait|hold|never\\s*mind|do\\s+not|don't|don’t|withdraw|wrong|incorrect|change|except|but|unless|maybe|perhaps|if)\\b|\\?)";
const QUESTIONS = Object.freeze(['Should I save this request for review?', 'Should I send this request to the team now?', 'Is all of that correct, and do you want me to submit it now?', 'Can I send this request to the team now?', 'May I send this request to the team now?', 'Would you like me to send this request to the team now?']);
const TRAILERS = Object.freeze(['', ' Please let me know.', ' Please let me know', ' Please confirm.', ' Please confirm']);
const QUESTION_SUFFIXES = Object.freeze(QUESTIONS.flatMap(q => TRAILERS.map(t => (q + t).toLowerCase())));
const ACKNOWLEDGEMENTS = Object.freeze(['got it', 'great', 'great, thank you', 'thank you', 'thanks', 'okay', 'ok', 'just a sec', 'one moment'].flatMap(s => [s, s + '.', s + '!']));
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const SEND_QUESTION_REGEX = `(?i)(?:${QUESTIONS.map(escapeRegex).join('|')})(?:\\s+Please (?:let me know|confirm)\\.?)?\\s*$`;
const matches = (pattern, text) => new RegExp(pattern.replace(/^\(\?i\)/, ''), 'i').test(text);
const textOf = message => typeof message?.content === 'string' ? message.content.trim().toLowerCase() : '';

// A second caller turn consumes the old question; acknowledgements cannot
// revive it. Only an exact short post-answer acknowledgement preserves a pair.
function assessConfirmationHistory(messages) {
  if (!Array.isArray(messages) || !messages.length || messages.length > 1000) return { allowed: false, reason: 'FRESH_SEND_CONFIRMATION_REQUIRED', needsClarification: true };
  let waiting = false, ready = false, latestUser = '';
  for (const message of messages) {
    const text = textOf(message);
    if (message?.role === 'user') { ready = waiting; waiting = false; latestUser = text; }
    else if (message?.role === 'assistant') {
      if (!text || ready && ACKNOWLEDGEMENTS.includes(text)) continue;
      ready = false; waiting = QUESTION_SUFFIXES.some(q => text.endsWith(q));
    } else if (!['system', 'tool', 'tool_call_result', 'tool_calls'].includes(message?.role)) { ready = false; waiting = false; }
  }
  if (matches(WITHDRAWAL_REGEX, latestUser)) return { allowed: false, reason: 'REFUSAL_CORRECTION_OR_UNCERTAINTY', needsClarification: true };
  if (!ready || !matches(APPROVAL_REGEX, latestUser)) return { allowed: false, reason: 'FRESH_SEND_CONFIRMATION_REQUIRED', needsClarification: true };
  return { allowed: true, reason: 'CURRENT_CONVERSATIONAL_PAIR', needsClarification: false };
}
function liquidLiteral(value) {
  return "'" + String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
}
function conversationCondition() {
  const literal = liquidLiteral;
  const acknowledgements = ACKNOWLEDGEMENTS.map(s => `{% if spoken == ${literal(s)} %}{% assign acknowledgement = true %}{% endif %}`).join('');
  const questions = QUESTION_SUFFIXES.map(s => `{% assign ending = spoken | slice: -${s.length}, ${s.length} %}{% if ending == ${literal(s)} %}{% assign waiting = true %}{% endif %}`).join('');
  return "{% assign waiting = false %}{% assign ready = false %}" +
    "{% for msg in messages %}{% if msg.role == 'user' %}{% assign ready = waiting %}{% assign waiting = false %}" +
    "{% elsif msg.role == 'assistant' %}{% assign spoken = msg.content | default: '' | downcase | strip %}{% if spoken != '' %}" +
    "{% assign acknowledgement = false %}" + acknowledgements +
    "{% assign inspect = true %}{% if ready %}{% if acknowledgement %}{% assign inspect = false %}{% endif %}{% endif %}" +
    "{% if inspect %}{% assign ready = false %}{% assign waiting = false %}" + questions + "{% endif %}{% endif %}" +
    "{% elsif msg.role == 'system' %}{% elsif msg.role == 'tool' %}{% elsif msg.role == 'tool_call_result' %}{% elsif msg.role == 'tool_calls' %}" +
    "{% else %}{% assign ready = false %}{% assign waiting = false %}{% endif %}{% endfor %}" +
    "{% if ready %}false{% else %}true{% endif %}";
}
function toolRejectionPlan() {
  const target = { position: -1, role: 'user' };
  return { conditions: [{ type: 'group', operator: 'OR', conditions: [
    { type: 'regex', regex: APPROVAL_REGEX, target, negate: true },
    { type: 'regex', regex: WITHDRAWAL_REGEX, target },
    { type: 'liquid', liquid: conversationCondition() },
  ] }] };
}
function acceptsConfirmation(user, assistant) {
  return assessConfirmationHistory([{ role: 'assistant', content: assistant }, { role: 'user', content: user }]).allowed;
}
module.exports = { APPROVAL_REGEX, WITHDRAWAL_REGEX, SEND_QUESTION_REGEX, acceptsConfirmation, toolRejectionPlan, assessConfirmationHistory, liquidLiteral };
