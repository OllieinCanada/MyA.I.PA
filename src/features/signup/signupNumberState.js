const canonical = value => {
  if (!/^\+?[\d\s().-]+$/.test(String(value || '').trim())) return '';
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length === 10 ? `+1${digits}` : digits.length === 11 && digits.startsWith('1') ? `+${digits}` : '';
};
function signupNumberState(result, { unavailable = false } = {}) {
  if (!result) return { state: 'idle', title: 'AI forwarding number appears here.', detail: 'No number assigned yet.' };
  const status = result.signupStatus || {}, provisioning = result.phoneProvisioning || {};
  const failure = result.setupNeedsAttention || status.state === 'needs_attention' || provisioning.status === 'failed';
  if (status.state === 'closed') return { state: 'closed', title: 'This signup is closed.', detail: 'Number assignment is not continuing.' };
  if (unavailable) return { state: 'unknown', title: 'Number assignment could not be checked.', detail: 'The saved signup remains available. Current assignment is not verified; do not submit again.' };
  if (failure) return { state: 'failed', title: 'Number assignment needs attention.', detail: 'Check the recorded outcome before retrying. A failed request does not prove that nothing was purchased.' };
  const verification = result.verificationRequired || result.smsVerificationRequired || result.emailVerificationRequired || status.state === 'verification_required';
  if (verification) return { state: 'waiting', title: 'Verify your contact information first.', detail: 'Number assignment is not confirmed. Open your verification message to continue.' };
  const number = canonical(result.twilioPhoneNumber || provisioning.e164), current = canonical(status.assignedPhone);
  const conflicting = Boolean(result.twilioPhoneNumber && provisioning.e164 && canonical(result.twilioPhoneNumber) !== canonical(provisioning.e164))
    || Boolean(status.assignedPhone && (!current || current !== number));
  const provisioned = String(provisioning.status || (result.twilioPhoneNumber ? 'ready' : '')).toLowerCase() === 'ready';
  const ready = !result.reviewRequired && !conflicting && provisioned && number
    && (!result.signupStatus || (status.state === 'ready' && current === number));
  if (ready) return { state: 'assigned', title: 'Your assigned My AI PA number', number, detail: 'Assignment verified. Calls and texts are not verified by this display.' };
  if (result.reviewRequired || status.state === 'final_checks') return { state: 'waiting', title: 'Your setup needs attention.', detail: 'Your signup is saved. Check the recorded setup status; do not submit again.' };
  // A local submit spinner or a restored status pointer is not proof of an
  // active server assignment. Only the explicit saved provisioning stage is.
  if (!conflicting && status.state === 'processing' && status.stage === 'provisioning' && status.terminal !== true)
    return { state: 'preparing', title: 'Your My AI PA number is being prepared.', detail: 'Waiting for verified assignment. This is saved setup progress, not a live provider test.' };
  return { state: 'unknown', title: 'Number assignment is not verified.', detail: 'Your signup is saved. Check its current status before taking another action.' };
}
function isSignupStatusSnapshot(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && ['processing', 'ready', 'closed', 'needs_attention', 'verification_required', 'final_checks'].includes(value.state));
}
module.exports = { signupNumberState, isSignupStatusSnapshot };
