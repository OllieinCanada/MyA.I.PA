const { buildMakeSignupEventKey } = require('./makeSignupWebhook');
const { buildProvisioningResourceName } = require('./signupProvisioning');
const { signupBusinessKey } = require('./signupBusinessIdentity');

function hold(message) {
  throw Object.assign(new Error(message), { code: 'ASSISTANT_RECOVERY_UNSAFE', statusCode: 409 });
}
const phone = value => String(value || '').replace(/\D/g, '');
const closed = row => row.archivedAt || /archived|closed|abandoned/.test(String(row.status || ''));

// All inventories must be complete, successful reads supplied by the server.
// Neither a client-side inventory nor an email-only match can authorize creation.
function assertMissingAssistantRecovery({ payload, signupAttemptId, expectedPhone, records,
  numberStage, assistantStage, importStage, twilioNumbers, assistants, vapiPhones }) {
  const key = payload?.provisioning?.idempotencyKey, hash = payload?.provisioning?.contextHash;
  if (!/^[a-f0-9]{64}$/.test(key || '') || !/^[a-f0-9]{64}$/.test(hash || '')
    || !payload.provisioning.businessKey || payload.provisioning.businessKey !== signupBusinessKey(payload)
    || buildMakeSignupEventKey(payload) !== signupAttemptId) hold('The exact signed business context is required.');
  if (![records, twilioNumbers, assistants, vapiPhones].every(Array.isArray)) hold('Complete inventories are required.');
  const matches = records.filter(r => r.signupAttemptId === signupAttemptId);
  if (matches.length !== 1) hold('The exact signup is ambiguous.');
  const signup = matches[0];
  if (closed(signup) || !signup.identityVerified || signupBusinessKey(signup) !== signupBusinessKey(payload)
    || signup.status !== 'setup_error' || signup.twilioPhoneNumber || signup.vapiAssistantId
    || signup.vapiPhoneNumberId || signup.subscriptionId) hold('The signup is not an eligible verified partial setup.');
  if (!/^\+1\d{10}$/.test(expectedPhone || '') || numberStage?.contextHash !== hash
    || numberStage.status !== 'completed' || numberStage.result?.twilioPhoneNumber !== expectedPhone) hold('The saved completed number does not match.');
  if (assistantStage?.contextHash !== hash || !['failed', 'processing'].includes(assistantStage.status)
    || assistantStage.result || assistantStage.guardedRecovery) hold('The assistant stage cannot be reopened.');
  // During execution the caller owns a processing lease. The state helper checks
  // that the original state was failed and atomically consumes recovery once.
  if (importStage?.status || importStage?.result) hold('A downstream import has already started.');
  const sid = numberStage.result.twilioSid || numberStage.result.sid;
  const expectedName = buildProvisioningResourceName('twilio-number', key);
  const numbers = twilioNumbers.filter(n => n.sid === sid || phone(n.phone_number) === phone(expectedPhone)
    || n.friendly_name === expectedName);
  if (!sid || numbers.length !== 1 || numbers[0].sid !== sid
    || numbers[0].phone_number !== expectedPhone || numbers[0].friendly_name !== expectedName) hold('Twilio ownership does not match the saved business.');
  if (records.some(r => r.signupAttemptId !== signupAttemptId && phone(r.twilioPhoneNumber) === phone(expectedPhone))) hold('Another record references this number.');
  const assistantName = buildProvisioningResourceName('vapi-assistant', key);
  const phoneName = buildProvisioningResourceName('vapi-phone', key);
  if (assistants.some(a => a.name === assistantName)
    || vapiPhones.some(p => phone(p.number || p.twilioPhoneNumber) === phone(expectedPhone) || p.name === phoneName)) hold('Vapi has a resource that must be reconciled, not replaced.');
  return true;
}

module.exports = { assertMissingAssistantRecovery };
