const assert = require('node:assert/strict');
const test = require('node:test');
const { assertMissingAssistantRecovery } = require('../server/signupAssistantRecovery');
const { normalizeSignupProvisioningPayload, buildProvisioningResourceName } = require('../server/signupProvisioning');
const { buildMakeSignupEventKey } = require('../server/makeSignupWebhook');
function fixture() {
  const payload = normalizeSignupProvisioningPayload({ event: 'signup.completed', submittedAt: '2026-10-01T10:00:00Z',
    business: { name: 'One Electric', address: 'Hamilton, ON', services: 'Electrical' },
    owner: { name: 'Test Owner', email: 'fixture@example.test', phone: '+19055550123' },
    aiAssistant: { businessType: 'Electrical', serviceArea: 'Hamilton' } }, { signingSecret: 'test-only-secret' });
  const signupAttemptId = buildMakeSignupEventKey(payload), expectedPhone = '+12895550123';
  const key = payload.provisioning.idempotencyKey, contextHash = payload.provisioning.contextHash;
  return { payload, signupAttemptId, expectedPhone,
    records: [{ signupAttemptId, businessName: payload.business.name, ownerEmail: payload.owner.email,
      ownerPhone: payload.owner.phone, identityVerified: true, status: 'setup_error' }],
    numberStage: { status: 'completed', contextHash, result: { twilioPhoneNumber: expectedPhone, twilioSid: 'PNfixture' } },
    assistantStage: { status: 'failed', contextHash }, importStage: {},
    twilioNumbers: [{ phone_number: expectedPhone, sid: 'PNfixture', friendly_name: buildProvisioningResourceName('twilio-number', key) }],
    assistants: [], vapiPhones: [] };
}
test('exact verified business with its completed number and missing resources is eligible', () => {
  assert.equal(assertMissingAssistantRecovery(fixture()), true);
});
test('closed, unverified, renamed or partially completed businesses fail closed', () => {
  for (const patch of [{archivedAt:'now'}, {status:'abandoned_archived'}, {identityVerified:false}, {businessName:'Another business'},
    {ownerEmail:'another@example.test'}, {ownerPhone:'+19055550124'}, {twilioPhoneNumber:'+12895550123'},
    {vapiAssistantId:'saved'}, {vapiPhoneNumberId:'saved'}, {subscriptionId:'saved'}]) {
    const f=fixture();Object.assign(f.records[0],patch);assert.throws(()=>assertMissingAssistantRecovery(f),{code:'ASSISTANT_RECOVERY_UNSAFE'});
  }
});
test('same owner is not permission to share a number; even archived references block replacement', () => {
  const f=fixture();f.records.push({...f.records[0],signupAttemptId:'other',status:'abandoned_archived',twilioPhoneNumber:f.expectedPhone});
  assert.throws(()=>assertMissingAssistantRecovery(f),/Another record/);
});
test('wrong signed identity, stages, inventory, or previously consumed recovery cannot authorize creation', () => {
  const changes=[f=>f.signupAttemptId='other', f=>f.payload.provisioning.businessKey='other',
    f=>f.numberStage.contextHash='other',f=>f.numberStage.result.twilioSid='other',
    f=>f.numberStage.status='failed', f=>f.expectedPhone='+12895550124',
    f=>f.assistantStage.contextHash='other',f=>f.assistantStage.status='invalidated',
    f=>f.assistantStage.result={assistantId:'deleted'},f=>f.assistantStage.guardedRecovery={authorizedAt:'now'},
    f=>f.importStage.status='failed', f=>f.twilioNumbers[0].friendly_name='other',
    f=>f.twilioNumbers.push({...f.twilioNumbers[0]}),f=>f.records.push({...f.records[0]}),f=>f.assistants=null];
  for(const change of changes){const f=fixture();change(f);assert.throws(()=>assertMissingAssistantRecovery(f),{code:'ASSISTANT_RECOVERY_UNSAFE'});}
});
test('existing or conflicting Vapi resources must be reconciled, never replaced', () => {
  for(const change of [f=>f.assistants.push({name:buildProvisioningResourceName('vapi-assistant',f.payload.provisioning.idempotencyKey)}),
    f=>f.vapiPhones.push({number:f.expectedPhone,assistantId:'other'}),
    f=>f.vapiPhones.push({name:buildProvisioningResourceName('vapi-phone',f.payload.provisioning.idempotencyKey)})]) {
    const f=fixture();change(f);assert.throws(()=>assertMissingAssistantRecovery(f),/must be reconciled/);
  }
});
