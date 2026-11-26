'use strict';
const crypto=require('node:crypto');
const PATH='/api/webhooks/voice/signup-pending';
const fail=()=>{throw Object.assign(new Error('CONNECTION_PENDING_GATE_UNPROVEN'),{code:'CONNECTION_PENDING_GATE_UNPROVEN'});};
// This configuration is supplied by the running server, never a request body.
function pendingGateProof(gate){
 let url;try{url=new URL(gate?.url);}catch{fail();}
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!==PATH
  ||url.port&&url.port!=='443'||!url.hostname.includes('.')||url.hostname.includes(':')||/^\d+(?:\.\d+){3}$/.test(url.hostname)
  ||/(?:^|\.)(?:localhost|local|internal)$/.test(url.hostname)
  ||typeof gate.secret!=='string'||gate.secret.length<32||gate.secret.length>512)fail();
 return {url:url.href,authFingerprint:crypto.createHash('sha256').update('signup-pending-gate:v1\0'+gate.secret).digest('hex')};
}
function assertNeverStartedSignup(row){
 // Do not turn an expired/paid/reused account into a new setup or reset a clock.
 if(['trialStartAt','trialEndAt','trialStartedAt','trialEndedAt','periodStartAt','periodEndAt','currentPeriodStartAt','currentPeriodEndAt']
  .some(k=>row?.[k])||['subscriptionStatus','paymentStatus','checkoutStatus'].some(k=>row?.[k]))
  throw Object.assign(new Error('CONNECTION_ACCOUNT_ELIGIBILITY_REQUIRED'),{code:'CONNECTION_ACCOUNT_ELIGIBILITY_REQUIRED'});
}
function assertPendingPhone(live,gate){
 const proof=pendingGateProof(gate);
 const headers=live?.server?.headers;
 if(!live||live.assistantId||live.assistant||live.squadId||live.squad||live.workflowId||live.workflow||live.fallbackDestination
  ||live.hooks!=null&&(!Array.isArray(live.hooks)||live.hooks.length)||live.smsEnabled!==false
  ||live.server?.url!==proof.url||live.serverUrl&&live.serverUrl!==proof.url||live.server?.secret||live.server?.credentialId
  ||!headers||Array.isArray(headers)||Object.keys(headers).length!==1||headers['x-vapi-secret']!==gate.secret)
  throw Object.assign(new Error('CONNECTION_PENDING_ROUTE_UNPROVEN'),{code:'CONNECTION_PENDING_ROUTE_UNPROVEN'});
 return proof;
}
function pendingServer(gate){
 const proof=pendingGateProof(gate);
 // Current Vapi Server schema authenticates via headers, not legacy secret.
 return {url:proof.url,headers:{'x-vapi-secret':gate.secret},timeoutSeconds:5,backoffPlan:{type:'fixed',maxRetries:0,baseDelaySeconds:1}};
}
function registerPendingSetupGate({app,authenticate,limiter}){
 // Intentionally terminal and independent of flags, trial state, database,
 // assistant selection, fallback destinations, workers and notification routes.
 app.post(PATH,limiter,authenticate,(_req,res)=>{
  res.set('Cache-Control','no-store');
  res.json({error:'This signup is not ready to receive calls. Please contact the business directly.'});
 });
}
module.exports={PATH,pendingGateProof,pendingServer,assertNeverStartedSignup,assertPendingPhone,registerPendingSetupGate};
