'use strict';

// Prompt preparation only. This does not bypass the conversation guard, prove
// audible playback, retry a tool or enable either notification workflow.
const QUESTIONS = Object.freeze({
  draft: 'Should I save this request for review?',
  automatic: 'Should I send this request to the team now?',
});

function confirmationConversationPolicy(mode) {
  if (!Object.hasOwn(QUESTIONS, mode)) throw new Error('CONFIRMATION_WORKFLOW_REQUIRED');
  const question = QUESTIONS[mode];
  const purpose = mode === 'automatic'
    ? 'Explain before the recap that submission includes owner and caller confirmation texts.'
    : 'Explain before the recap that this saves a draft for review, not a text message.';
  return `SEPARATE RECAP AND PERMISSION:
- ${purpose} Read back the current request and end with "Is that right?" Then stop speaking and wait for the caller. A yes to this recap confirms details only; do not invoke the tool yet.
- Resolve corrections or missing details and repeat the corrected recap before continuing. Once the current details are confirmed, ask exactly: "${question}" as a standalone assistant turn. Do not append the permission question to the long recap, pricing, another question or a closing sentence. Stop speaking and wait for a fresh, clear caller answer.
- Only a fresh clear approval of that permission question permits the tool. Never reuse a pricing yes, a recap yes, a previous yes or a split/unfinished reply. Never treat a refusal as missing consent: respect no, stop or cancel; resolve a correction or uncertainty before any new permission question.
- A definite pre-execution rejection permits one clarification attempt only. The exact result "Tool call rejected based on configured rejection plan", or a structured result with actionAttempted false, needsClarification true and errorCode FRESH_SEND_CONFIRMATION_REQUIRED, means that attempt did not execute. If the caller has not refused and the current details remain confirmed, ask the same standalone permission question again and wait for fresh approval before one new invocation. The rejection itself never grants approval.
- If that clarification is rejected again, explain that the save/submission could not be confirmed and offer direct contact with the business. Do not loop, claim success or invent contact details.
- Never retry an outcome that is unknown, timed out, accepted or already completed. Inspect saved receipts through the appropriate separate workflow; do not ask for another yes to bypass uncertainty or duplicate protection. A generic failure or missing response is not proof of pre-execution rejection.`;
}

module.exports = { confirmationConversationPolicy };
