'use strict';
// Publishing preflight only. Never claims a notification or sends an SMS.
const READINESS_CODES=Object.freeze({timeout:'SMS_DISPATCH_READINESS_TIMEOUT',network:'SMS_DISPATCH_READINESS_UNAVAILABLE',
 http:'SMS_DISPATCH_READINESS_HTTP_ERROR',response:'SMS_DISPATCH_READINESS_INVALID_RESPONSE',unready:'SMS_DISPATCH_READINESS_UNREADY'});
function safeReadinessDiagnostic(value){
 if(value?.operation!=='sms_dispatch_readiness_get'||!Object.hasOwn(READINESS_CODES,value.phase)||typeof value.code!=='string'||READINESS_CODES[value.phase]!==value.code
  ||!Number.isSafeInteger(value.elapsedMs)||value.elapsedMs<0||value.elapsedMs>2147483647||value.timeoutMs!==10000
  ||!Number.isInteger(value.httpStatus)||value.httpStatus!==0&&(value.httpStatus<100||value.httpStatus>599))return null;
 return {operation:'sms_dispatch_readiness_get',phase:value.phase,code:value.code,httpStatus:value.httpStatus,elapsedMs:value.elapsedMs,timeoutMs:10000};
}
function readinessFailure(phase,startedAt,httpStatus=0){
 const diagnostic=safeReadinessDiagnostic({operation:'sms_dispatch_readiness_get',phase,code:READINESS_CODES[phase],httpStatus,
  elapsedMs:Math.min(2147483647,Math.max(0,Date.now()-startedAt)),timeoutMs:10000});
 const detail=`My AI PA SMS-backend readiness GET: ${phase}${httpStatus?' (HTTP '+httpStatus+')':''}; elapsed ${diagnostic.elapsedMs} ms, timeout 10000 ms. No publishing allowed.`;
 const message=['unready','http'].includes(phase)?'SMS dispatch backend is disabled or unready; no publishing allowed.':'SMS dispatch backend readiness is unverified; no publishing allowed.';
 return Object.assign(Error(message),{code:diagnostic.code,provider:'myaipa',providerCode:diagnostic.code,providerStatus:httpStatus,providerDetail:detail,readinessDiagnostic:diagnostic});
}
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
  if (entries.some(v => /^TWILIO_(?:ACCOUNT_SID|AUTH_TOKEN|API_KEY_SID|API_KEY_SECRET)$/.test(v?.name || '') && v.value)) {
    throw Error('Draft-only phone tools must not retain messaging provider credentials; use a reviewed migration.');
  }
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
  const startedAt=Date.now();
  let response, body;
  try {
    response = await fetchImpl(env.SMS_NOTIFICATION_DISPATCH_URL + '/readiness', {
      method: 'GET', headers: { Authorization: 'Bearer ' + env.SMS_SUPPRESSION_API_KEY },
      redirect: 'error', signal: AbortSignal.timeout(10000),
    });
  } catch(error) {
    const codes=[error?.code,error?.cause?.code];
    const timeout=['TimeoutError','AbortError'].includes(error?.name)||codes.some(c=>['ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','ABORT_ERR'].includes(c));
    throw readinessFailure(timeout?'timeout':'network',startedAt);
  }
  const status=Number.isInteger(response?.status)?response.status:0;
  if(!response?.ok)throw readinessFailure('http',startedAt,status);
  try{body=await response.json();}catch(error){
    const timeout=['TimeoutError','AbortError'].includes(error?.name)||['ETIMEDOUT','UND_ERR_BODY_TIMEOUT'].includes(error?.cause?.code||error?.code);
    throw readinessFailure(timeout?'timeout':'response',startedAt,status);
  }
  if (!body || body.schemaVersion !== 1 || body.ready !== true || body.durableStore !== true || body.mode !== 'draft_only') throw readinessFailure('unready',startedAt,status);
  return { ready: true, endpoint: env.SMS_NOTIFICATION_DISPATCH_URL };
}
module.exports = { dispatchUrlFromSuppressionUrl, assertDispatchEnvironment, verifyDispatchReadiness, safeReadinessDiagnostic };
