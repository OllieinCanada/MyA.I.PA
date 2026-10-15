const crypto = require('node:crypto');
const { runProvisioningStep } = require('./provisioningState');

// Twilio message creation has no application idempotency key. A response lost
// after acceptance MUST remain ambiguous, never become permission to resend.
async function dispatchSignupSms({ prisma, identity, purpose, request, sendSms }) {
  if (!identity || !purpose) throw Object.assign(new Error('A business-bound dispatch identity is required.'), { code: 'SMS_DISPATCH_IDENTITY_REQUIRED' });
  const key = crypto.createHash('sha256').update(JSON.stringify([
    identity, purpose, request.purpose || '', request.to, request.from || '',
  ])).digest('hex');
  const contextHash = crypto.createHash('sha256').update(String(request.message)).digest('hex');
  return runProvisioningStep({ prisma, kind: 'signup-sms', idempotencyKey: key, contextHash,
    execute: async () => {
      const receipt = await sendSms(request);
      if (!receipt?.sid) throw Object.assign(new Error('SMS acceptance has no message ID; reconcile before retrying.'), { code: 'SMS_ACCEPTANCE_UNCONFIRMED' });
      return { sid: receipt.sid, status: receipt.status || 'accepted', acceptedAt: new Date().toISOString() };
    },
  });
}
module.exports = { dispatchSignupSms };
