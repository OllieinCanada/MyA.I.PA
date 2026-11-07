'use strict';
function validateDrillTarget(env) {
  if (env.RUN_TRIAL_RESERVATION_DRILL !== '1' || env.CI !== 'true') throw Error('trial_drill_not_enabled');
  let url;
  try { url = new URL(env.TRIAL_RESERVATION_DRILL_DATABASE_URL); } catch { throw Error('trial_drill_target_invalid'); }
  if (url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1' || url.port !== '5432'
    || url.username !== 'trial_drill' || url.password !== 'synthetic-ci-only'
    || url.pathname !== '/myaipa_trial_reservation_drill_ci' || url.hash
    || url.searchParams.get('connection_limit') !== '4'
    || [...url.searchParams.keys()].length !== 1) throw Error('trial_drill_target_not_disposable_loopback');
  if (Object.keys(env).some(k => /^(?:VAPI_|TWILIO_|TELEGRAM_|STRIPE_|MAKE_|SMTP_)/.test(k) && env[k]))
    throw Error('trial_drill_provider_environment_forbidden');
  return url.toString();
}
module.exports = { validateDrillTarget };
