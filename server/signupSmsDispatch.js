const crypto = require('node:crypto');
const { runProvisioningStep, readProvisioningStep } = require('./provisioningState');

function signupSmsDispatchKey({identity,purpose,request}) {
  return crypto.createHash('sha256').update(JSON.stringify([
    identity, purpose, request.purpose || '', request.to, request.from || '',
  ])).digest('hex');
}

// Twilio message creation has no application idempotency key. A response lost
// after acceptance MUST remain ambiguous, never become permission to resend.
async function dispatchSignupSms({ prisma, identity, purpose, request, sendSms, reconcileCompleted }) {
  if (!identity || !purpose) throw Object.assign(new Error('A business-bound dispatch identity is required.'), { code: 'SMS_DISPATCH_IDENTITY_REQUIRED' });
  const key = signupSmsDispatchKey({identity,purpose,request});
  const contextHash = crypto.createHash('sha256').update(String(request.message)).digest('hex');
  try { return await runProvisioningStep({ prisma, kind: 'signup-sms', idempotencyKey: key, contextHash,
    execute: async () => {
      const receipt = await sendSms(request);
      if (!receipt?.sid) throw Object.assign(new Error('SMS acceptance has no message ID; reconcile before retrying.'), { code: 'SMS_ACCEPTANCE_UNCONFIRMED' });
      return { sid: receipt.sid, status: receipt.status || 'accepted', acceptedAt: new Date().toISOString() };
    },
  }); } catch(error) {
    if(error.code!=='PROVISIONING_CONTEXT_MISMATCH'||typeof reconcileCompleted!=='function')throw error;
    const {data}=await readProvisioningStep({prisma,kind:'signup-sms',idempotencyKey:key});
    if(data.status!=='completed'||!data.result?.sid)throw error;
    // A narrow caller-supplied proof may reuse a delivered receipt. The
    // original immutable context is never overwritten, and no send is retried.
    const receipt=await reconcileCompleted(data);
    if(!receipt?.sid||receipt.sid!==data.result.sid)throw error;
    return receipt;
  }
}
module.exports = { dispatchSignupSms, signupSmsDispatchKey };
