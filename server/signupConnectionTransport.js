'use strict';
const {buildTwilioImportRequest}=require('./vapiTwilioImportRequest');
const {buildProvisioningResourceName}=require('./signupProvisioning');
const {pendingGateProof,pendingServer,assertPendingPhone}=require('./signupPendingConnection');
const {digest}=require('./signupAssociationRepair');
const fail=code=>{throw Object.assign(new Error(code),{code,statusCode:503});};
// Deliberately has no purchase, assistant mutation, SMS, call, email, billing or
// Make operation. Fixed HTTPS origins; no caller-selected URLs or redirects.
function createConnectionTransport({fetchImpl=fetch,getVapiKey,getTwilioCredentials,getPendingGate=()=>null}){
 async function request(url,headers,options={}){
  const r=await fetchImpl(url,{...options,headers:{Accept:'application/json',...headers},redirect:'error',signal:AbortSignal.timeout(5000)});
  if(!r.ok)fail('CONNECTION_PROVIDER_REQUEST_FAILED');
  try{return await r.json();}catch{fail('CONNECTION_PROVIDER_RESPONSE_INVALID');}
 }
 const vapi=(path,options={})=>request('https://api.vapi.ai/'+path,{Authorization:'Bearer '+getVapiKey(),...(options.method?{'Content-Type':'application/json'}:{})},options);
 async function readInventories(p){
  const c=getTwilioCredentials();
  if(!/^AC[a-f0-9]{32}$/i.test(c.accountSid||'')||!c.authToken||!getVapiKey())fail('CONNECTION_PROVIDER_AUTH_UNAVAILABLE');
  const twilio=request('https://api.twilio.com/2010-04-01/Accounts/'+encodeURIComponent(c.accountSid)+'/IncomingPhoneNumbers.json?PageSize=1000',
   {Authorization:'Basic '+Buffer.from(c.accountSid+':'+c.authToken).toString('base64')});
  const [numbers,assistants,assistant,phones]=await Promise.all([twilio,vapi('assistant?limit=1000'),vapi('assistant/'+encodeURIComponent(p.assistantId)),vapi('phone-number?limit=1000')]);
  return {twilioAccountSid:c.accountSid,inventories:{twilio:{httpStatus:200,data:numbers},assistants:{httpStatus:200,data:assistants},
   assistant:{httpStatus:200,data:assistant},phones:{httpStatus:200,data:phones}}};
 }
 async function importExisting(p,beforeDispatch){
  const c=getTwilioCredentials(),body=buildTwilioImportRequest({phoneNumber:p.number,assistantId:p.assistantId,accountSid:c.accountSid,
   authToken:c.authToken,name:buildProvisioningResourceName('vapi-phone',p.idempotencyKey)});
  if(typeof beforeDispatch!=='function')fail('CONNECTION_DISPATCH_AUTH_REQUIRED');
  // No await between final authorization and the actual provider request.
  beforeDispatch();
  const created=await vapi('phone-number/import/twilio',{method:'POST',body:JSON.stringify(body)});
  if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(created?.id||''))fail('CONNECTION_PHONE_ID_UNVERIFIED');
  const live=await vapi('phone-number/'+encodeURIComponent(created.id));
  if(live?.id!==created.id||live.number!==p.number||live.assistantId!==p.assistantId||live.smsEnabled!==false
   ||live.name!==body.name||live.twilioAccountSid&&live.twilioAccountSid!==c.accountSid
   ||[live.businessId,live.metadata?.businessId].some(x=>x!==undefined&&x!==null&&x!=='')
   ||live.metadata?.businessKey&&live.metadata.businessKey!==p.idempotencyKey
   ||live.metadata?.contextHash&&live.metadata.contextHash!==p.contextHash)fail('CONNECTION_PHONE_BINDING_UNPROVEN');
  return {id:live.id,number:live.number,assistantId:live.assistantId,name:live.name};
 }
 async function importPending(p,beforeDispatch,approvedGate){
  const gate=getPendingGate(),proof=pendingGateProof(gate);
  if(digest(proof)!==digest(approvedGate))fail('CONNECTION_PENDING_GATE_CHANGED');
  const c=getTwilioCredentials(),body=buildTwilioImportRequest({phoneNumber:p.number,assistantId:p.assistantId,accountSid:c.accountSid,
   authToken:c.authToken,name:buildProvisioningResourceName('vapi-phone',p.idempotencyKey)});
  // Documented Twilio-import variant of POST /phone-number, never a Vapi
  // number purchase. No assistant/squad/workflow/fallback is attached at import.
  delete body.assistantId;delete body.twilioPhoneNumber;body.provider='twilio';body.number=p.number;body.server=pendingServer(gate);
  if(typeof beforeDispatch!=='function')fail('CONNECTION_DISPATCH_AUTH_REQUIRED');
  beforeDispatch();
  const created=await vapi('phone-number',{method:'POST',body:JSON.stringify(body)});
  if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(created?.id||''))fail('CONNECTION_PHONE_ID_UNVERIFIED');
  const live=await vapi('phone-number/'+encodeURIComponent(created.id));
  if(live.id!==created.id||live.provider!=='twilio'||live.number!==p.number||live.name!==body.name||live.twilioAccountSid!==c.accountSid
   ||[live.businessId,live.metadata?.businessId].some(x=>x!==undefined&&x!==null&&x!=='')
   ||live.metadata?.businessKey&&live.metadata.businessKey!==p.idempotencyKey
   ||live.metadata?.contextHash&&live.metadata.contextHash!==p.contextHash)fail('CONNECTION_PHONE_BINDING_UNPROVEN');
  assertPendingPhone(live,gate);
  return {id:live.id,number:live.number,assistantId:p.assistantId,attachedAssistantId:null,name:live.name,routeMode:'setup-pending',pendingGate:proof};
 }
 return {readInventories,importExisting,importPending};
}
module.exports={createConnectionTransport};
