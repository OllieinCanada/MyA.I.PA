// The sealed fixture must honor the requested cutoff, not fabricate a fixed
// response that disagrees with the request. This is not a Stripe SDK shim.
function syntheticTrialFields(data, now = Math.floor(Date.now()/1000)) {
  if (data.trial_end != null && data.trial_period_days != null) throw Error('Conflicting synthetic trial parameters');
  const end=data.trial_end ?? now + Number(data.trial_period_days || 14)*86400;
  if(!Number.isSafeInteger(end)||end<=now)throw Error('Invalid synthetic trial cutoff');
  return {status:'trialing',trial_start:now,trial_end:end};
}
module.exports={syntheticTrialFields};
