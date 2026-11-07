'use strict';
function validatePostCallDrill(env) {
  if (env.RUN_POSTCALL_PERSISTENCE_DRILL !== '1' || env.DISABLE_LOCAL_ENV_FILES !== '1') throw Error('postcall_drill_requires_isolation');
  let url; try { url = new URL(env.POSTCALL_PERSISTENCE_DRILL_DATABASE_URL); } catch { throw Error('postcall_drill_invalid_target'); }
  if (env.DATABASE_URL !== url.href || url.protocol !== 'postgresql:' || !['127.0.0.1','localhost'].includes(url.hostname)
    || url.username !== 'postcall_drill' || url.password !== 'synthetic-ci-only' || url.pathname !== '/myaipa_postcall_drill_ci'
    || url.port !== '5432' || url.hash || [...url.searchParams.keys()].some(k => k !== 'connection_limit')) throw Error('postcall_drill_unsafe_target');
  for (const key of ['VAPI_API_KEY','TWILIO_ACCOUNT_SID','TWILIO_AUTH_TOKEN','TWILIO_API_KEY_SID','TWILIO_API_KEY_SECRET',
    'TELEGRAM_BOT_TOKEN','TELEGRAM_CHAT_ID','STRIPE_SECRET_KEY','SMTP_HOST','MAKE_SIGNUP_WEBHOOK_URL','RENDER_API_KEY']) {
    if (env[key]) throw Error('postcall_drill_provider_credential_forbidden');
  }
  return url.href;
}
module.exports = { validatePostCallDrill };
