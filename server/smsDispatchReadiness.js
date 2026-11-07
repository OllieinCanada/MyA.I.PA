'use strict';
// Publishing preflight only. Never claims a notification or sends an SMS.
function dispatchUrlFromSuppressionUrl(value) {
  const raw = String(value || '').trim();
  let url;
  try { url = new URL(raw); } catch { throw Error('SMS dispatch requires a valid suppression URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw Error('SMS dispatch requires a credential-free HTTPS suppression URL.');
  }
  return raw.replace(/\/suppression\/check\/?$/, '/dispatch') === raw
    ? raw.replace(/\/$/, '') + '/dispatch' : raw.replace(/\/suppression\/check\/?$/, '/dispatch');
}
function assertDispatchEnvironment(environmentVariables) {
  const entries = Array.isArray(environmentVariables) ? environmentVariables : [];
  const required = ['CALL_ID', 'SMS_NOTIFICATION_DISPATCH_URL', 'SMS_SUPPRESSION_CHECK_URL', 'SMS_SUPPRESSION_API_KEY'];
  const env = {};
  for (const name of required) {
    const found = entries.filter(v => v?.name === name);
    if (found.length !== 1 || typeof found[0].value !== 'string' || !found[0].value.trim()) {
      throw Error('SMS dispatch publication requires one saved ' + name + '; use the reviewed migration first.');
    }
    env[name] = found[0].value.trim();
  }
  if (env.CALL_ID !== '{{ call.id }}') throw Error('SMS dispatch publication requires trusted CALL_ID.');
  if (env.SMS_NOTIFICATION_DISPATCH_URL !== dispatchUrlFromSuppressionUrl(env.SMS_SUPPRESSION_CHECK_URL)) {
    throw Error('SMS dispatch publication requires the matching reviewed backend endpoint.');
  }
  return env;
}
async function verifyDispatchReadiness({ environmentVariables, fetchImpl = fetch }) {
  const env = assertDispatchEnvironment(environmentVariables);
  let response, body;
  try {
    response = await fetchImpl(env.SMS_NOTIFICATION_DISPATCH_URL + '/readiness', {
      method: 'GET', headers: { Authorization: 'Bearer ' + env.SMS_SUPPRESSION_API_KEY },
      redirect: 'error', signal: AbortSignal.timeout(10000),
    });
    body = await response.json();
  } catch { throw Error('SMS dispatch backend readiness is unverified; no publishing allowed.'); }
  if (!response.ok || body.schemaVersion !== 1 || body.ready !== true || body.durableStore !== true) {
    throw Error('SMS dispatch backend is disabled or unready; no publishing allowed.');
  }
  return { ready: true, endpoint: env.SMS_NOTIFICATION_DISPATCH_URL };
}
module.exports = { dispatchUrlFromSuppressionUrl, assertDispatchEnvironment, verifyDispatchReadiness };
