const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSignupProgress } = require('../server/signupProgress');
const { buildAgentRouteFingerprint, buildAgentTestFingerprint } = require('../server/signupAgentTesting');
function fixture() {
  const signup = { businessId: 123, twilioPhoneNumber: '+12895550199', ownerPhone: '+19055550123',
    vapiPhoneNumberId: 'private-phone-id', vapiAssistantId: 'private-assistant-id',
    agentContentStatus: 'verified', agentContentFingerprint: 'private-content-hash', agentContentVerifiedAt: 'now',
    agentRouteBindingStatus: 'verified', agentRouteBindingMode: 'trial-gate', agentRouteBindingVerifiedAt: 'now',
    agentTestOwnerDeliveredAt: 'now', agentTestOwnerProviderStatus: 'delivered', agentTestCustomerDeliveredAt: 'now', agentTestCustomerProviderStatus: 'delivered',
    smsRoutingStatus: 'healthy', subscriptionId: 'private-subscription', subscriptionStatus: 'trialing' };
  signup.agentRouteBindingFingerprint = buildAgentRouteFingerprint({ mode: 'trial-gate', businessId: 123, phoneNumberId: signup.vapiPhoneNumberId, aiNumber: signup.twilioPhoneNumber, assistantId: signup.vapiAssistantId });
  signup.agentTestFingerprint = buildAgentTestFingerprint({ assistantId: signup.vapiAssistantId, aiNumber: signup.twilioPhoneNumber, ownerPhone: signup.ownerPhone, contentFingerprint: signup.agentContentFingerprint });
  return signup;
}
test('each receipt advances only its real completed checkpoint; repeated reads do not invent work', () => {
  const input = { contactVerified: true, receipts: { 'twilio-number': { status: 'processing' } } };
  const first = buildSignupProgress(input);
  assert.equal(first.completed, 1); assert.equal(first.currentLabel, 'Assigning your My AI PA number');
  assert.deepEqual(buildSignupProgress(input), first);
  input.receipts['twilio-number'] = { status: 'completed', result: { twilioPhoneNumber: '+12895550199' } };
  const next = buildSignupProgress(input);
  assert.equal(next.completed, 2); assert.equal(next.currentLabel, 'Creating your assistant');
  assert.equal(next.steps.find(s => s.key === 'trial').status, 'pending');
});
test('completed current proofs tick all ten checkpoints without exposing private data', () => {
  const result = buildSignupProgress({ signup: fixture(), contactVerified: true, ready: true });
  assert.equal(result.total, 10); assert.equal(result.completed, 10);
  assert.ok(result.steps.every(step => step.status === 'done'));
  assert.doesNotMatch(JSON.stringify(result), /private-|5550199|5550123/);
});
test('stale text fingerprints and sent-only texts remain unchecked even with a ready flag', () => {
  for (const change of [{ agentTestFingerprint: 'stale' }, { agentTestOwnerProviderStatus: 'sent' }, { subscriptionStatus: 'paused' }, { stripeTrialError: 'DECLINED' }]) {
    const result = buildSignupProgress({ signup: { ...fixture(), ...change }, contactVerified: true, ready: true });
    assert.ok(result.completed < result.total);
    assert.notEqual(result.steps.at(-1).status, 'done');
  }
});
test('email verification is not mislabeled as phone verification', () => {
  assert.equal(buildSignupProgress({ channel: 'email', contactVerified: true }).steps[0].label, 'Contact verified');
  assert.equal(buildSignupProgress().completed, 0);
});
