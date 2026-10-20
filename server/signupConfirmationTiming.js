// A short approval can reach the model from a partial transcript before it is
// committed to the history used by the SMS rejection plan. Apply this pause only
// after the explicit send question; preserve normal intake timing and all guards.
const CONFIRMATION_RULE = Object.freeze({
  type: 'assistant',
  regex: '(?:Should I send this request to the team now|Is all of that correct, and do you want me to submit it now)\\?',
  regexOptions: [{ type: 'ignore-case', enabled: true }],
  timeoutSeconds: 1.2,
});
function confirmationStartSpeakingPlan(plan = {}) {
  return { ...plan, customEndpointingRules: [structuredClone(CONFIRMATION_RULE),
    ...(plan.customEndpointingRules || []).filter(rule => rule.type !== CONFIRMATION_RULE.type || rule.regex !== CONFIRMATION_RULE.regex)] };
}
module.exports = { CONFIRMATION_RULE, confirmationStartSpeakingPlan };
