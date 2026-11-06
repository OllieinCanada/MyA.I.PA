'use strict';
// This drill never falls back to DATABASE_URL or a project .env file.
function validateDrillTarget(env) {
  if (env.RUN_SMS_DISPATCH_POSTGRES_DRILL !== '1') throw Error('sms_drill_not_enabled');
  let url;
  try { url = new URL(env.SMS_DISPATCH_DRILL_DATABASE_URL); } catch { throw Error('sms_drill_target_invalid'); }
  if (url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1' || url.port !== '5432'
    || url.username !== 'sms_drill' || url.password !== 'synthetic-ci-only'
    || url.pathname !== '/myaipa_sms_dispatch_drill_ci' || url.hash
    || url.searchParams.get('connection_limit') !== '2'
    || [...url.searchParams.keys()].length !== 1) throw Error('sms_drill_target_not_disposable_loopback');
  return url.toString();
}

function workerEnvironment(env, url) {
  const output = { RUN_SMS_DISPATCH_POSTGRES_DRILL: '1', SMS_DISPATCH_DRILL_DATABASE_URL: url,
    DISABLE_LOCAL_ENV_FILES: '1' };
  for (const name of ['PATH', 'SystemRoot', 'TEMP', 'TMP', 'NODE_PATH']) if (env[name]) output[name] = env[name];
  return output;
}

function syntheticInput(callId, changed = false) {
  if (!/^sms-drill-[a-f0-9-]{36}$/.test(callId)) throw Error('sms_drill_case_invalid');
  return {
    args: { businessName: 'Synthetic business', requestType: 'repair', name: 'Synthetic caller',
      jobDetails: changed ? 'changed synthetic request' : 'synthetic light repair', streetAddress: '1 Test St',
      city: 'Test City', preferredStartDate: 'next week', bestCallbackTime: 'after 2 PM',
      workDetailsConfirmed: true, pricingDiscussed: false },
    env: { TWILIO_ACCOUNT_SID: 'AC_INERT', TWILIO_AUTH_TOKEN: 'INERT',
      DEFAULT_FROM_NUMBER: '+19055550100', DEFAULT_OWNER_TO_NUMBER: '+19055550101',
      CALLER_NUMBER: '+19055550102', CALL_ID: callId, SMS_SUPPRESSION_API_KEY: 'INERT',
      SMS_SUPPRESSION_CHECK_URL: 'https://stub.invalid/check',
      SMS_NOTIFICATION_DISPATCH_URL: 'https://stub.invalid/dispatch' }
  };
}

module.exports = { validateDrillTarget, workerEnvironment, syntheticInput };
