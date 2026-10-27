const test = require('node:test');
const assert = require('node:assert/strict');
const { consolidateServicePrompt, INTAKE_POLICY } = require('../server/serviceIntakePrompt');
const { buildSignupAssistantConfig } = require('../server/signupAssistantTemplate');
const { updateMessages } = require('../server/vapiIsolatedSmsProvisioning');
const { getSystemPrompt } = require('../server/signupAssistantVerification');
test('consolidation removes only retired execution rules and preserves business prices and safety', () => {
  const source = `Business facts: Test business. Minimum visit 107. Hourly 666. Never approach a downed wire.
## Phone capture guardrail
Always demand the number.
## Confirmation
Reuse confirmed information.
## SMS and owner notification
Call send_customer_sms_dynamic and send_owner_sms_dynamic.
## Custom policy
Keep the owner-selected policy.`;
  const result = consolidateServicePrompt(source);
  assert.match(result, /Minimum visit 107\. Hourly 666/);
  assert.match(result, /Never approach a downed wire/);
  assert.match(result, /Keep the owner-selected policy/);
  assert.doesNotMatch(result, /Always demand|send_customer_sms_dynamic|send_owner_sms_dynamic/);
  assert.equal(consolidateServicePrompt(result), result);
  for (const rule of ['Would you like to continue?', 'Which city or town is that in?', 'never', 'workDetailsConfirmed']) assert.ok(result.toLowerCase().includes(rule.toLowerCase()));
});
test('fresh provisioning and an isolated SMS migration retain the same verified business-content fingerprint', () => {
  const config = buildSignupAssistantConfig({ businessProfile: { businessName: 'Test Electric', services: 'Lighting' },
    setupDetails: { businessType: 'Electrical', serviceArea: 'Test City', ownerPhone: '+15555550100' },
    pricing: { includeVisitFee: true, includeHourlyRate: true, includeAssessment: true, includePartsExtra: true, installationFreeEstimate: false, repairVisitFee: '107', repairHourlyRate: '666' } }, { assignedPhone: '+15555550101' });
  const migrated = { ...config, model: { ...config.model, messages: updateMessages(config.model.messages, 'send_call_summaries_test') } };
  assert.equal(getSystemPrompt(migrated), getSystemPrompt(config));
  assert.equal(migrated.model.messages[0].content.split(INTAKE_POLICY).length, 2);
  assert.match(migrated.model.messages[0].content, /BEFORE EXECUTION ONLY/);
  assert.match(migrated.model.messages[0].content, /DO NOT retry/);
});
