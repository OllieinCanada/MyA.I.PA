const crypto = require('node:crypto');
const { isClosedSignup } = require('./signupBusinessIdentity');
const promptHash = assistant => crypto.createHash('sha256').update(JSON.stringify(assistant?.model?.messages || [])).digest('hex');
function conflict(message) { return Object.assign(new Error(message), { statusCode: 409, code: 'TRIAL_SNAPSHOT_PUBLICATION_CONFLICT' }); }

// Admin-authorized, database-only publication. Never buys a number, creates an
// assistant, changes a phone route, invokes a tool or sends a notification.
async function publishTrialSnapshot({ input, signups, getAssistant, getPhone, getCalls, assertLifecycle, readGate, publishGate, fingerprint }) {
  const allowed = ['businessId', 'signupAttemptId', 'assistantId', 'phoneNumberId', 'expectedFingerprint', 'expectedPromptHash', 'apply'];
  if (!input || Object.keys(input).some(k => !allowed.includes(k)) || !Number.isSafeInteger(input.businessId)
    || input.businessId < 1 || !['signupAttemptId', 'assistantId', 'phoneNumberId'].every(k => typeof input[k] === 'string' && input[k].length > 0 && input[k].length <= 150)
    || !['expectedFingerprint', 'expectedPromptHash'].every(k => /^[a-f0-9]{64}$/.test(input[k] || ''))
    || (input.apply != null && typeof input.apply !== 'boolean')) throw Object.assign(new Error('Exact snapshot publication identity and hashes are required.'), { statusCode: 400 });
  const matches = signups.filter(s => !isClosedSignup(s) && (s.vapiAssistantId === input.assistantId || s.vapiPhoneNumberId === input.phoneNumberId));
  const signup = matches[0];
  if (matches.length !== 1 || signup.businessId !== input.businessId || signup.signupAttemptId !== input.signupAttemptId
    || signup.vapiAssistantId !== input.assistantId || signup.vapiPhoneNumberId !== input.phoneNumberId) throw conflict('Snapshot ownership is ambiguous.');
  await assertLifecycle(signup);
  const [assistant, phone, calls] = await Promise.all([getAssistant(input.assistantId), getPhone(input.phoneNumberId), getCalls(input.assistantId)]);
  if (!Array.isArray(calls) || calls.length >= 1000 || calls.some(c => ['queued', 'ringing', 'in-progress', 'forwarding'].includes(c.status))) throw conflict('The assistant is active or the idle check is incomplete.');
  if (assistant.id !== input.assistantId || phone.id !== input.phoneNumberId || phone.number !== signup.twilioPhoneNumber
    || fingerprint(assistant) !== input.expectedFingerprint || promptHash(assistant) !== input.expectedPromptHash) throw conflict('Published assistant content or exact phone identity changed.');
  if (phone.assistantId) {
    if (phone.assistantId !== input.assistantId) throw conflict('Phone is assigned to another assistant.');
    return { ok: true, refreshed: false, mode: 'direct', providerWrites: 0 };
  }
  if (signup.agentRouteBindingMode !== 'trial-gate' || phone.server?.url !== 'https://api.myaipa.ca/api/webhooks/voice') throw conflict('Protected dynamic route is not proven.');
  const gate = await readGate({ phoneNumberId: input.phoneNumberId, phoneNumber: { number: signup.twilioPhoneNumber } });
  if (!gate || gate.status !== 'active' || gate.businessId !== input.businessId || gate.assistantId !== input.assistantId) throw conflict('Saved gate ownership is not proven.');
  if (!input.apply) return { ok: true, refreshed: false, mode: 'dry-run', providerWrites: 0 };
  await publishGate({ signup, gate, assistant, identity: { businessId: input.businessId, signupAttemptId: input.signupAttemptId,
    assistantId: input.assistantId, phoneNumberId: input.phoneNumberId, aiNumber: signup.twilioPhoneNumber } });
  const verified = await readGate({ phoneNumberId: input.phoneNumberId, phoneNumber: { number: signup.twilioPhoneNumber } });
  if (verified?.assistantContentFingerprint !== input.expectedFingerprint || promptHash(verified.assistantSnapshot) !== input.expectedPromptHash) throw conflict('Snapshot read-back did not match the published prompt.');
  return { ok: true, refreshed: true, mode: 'trial-gate', promptHash: input.expectedPromptHash, providerWrites: 0 };
}
module.exports = { promptHash, publishTrialSnapshot };
