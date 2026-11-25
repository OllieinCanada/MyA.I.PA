'use strict';
const crypto=require('node:crypto');
const {redactDetail}=require('./signupAssistantError');
const {signupDiagnosticError}=require('./signupDiagnosticError');
const ROUTES=Object.freeze({'/api/integrations/twilio/purchase-number':'purchase',
 '/api/integrations/vapi/create-signup-assistant':'assistant-create','/api/integrations/vapi/import-twilio-number':'assistant-import'});
const PHASES=Object.freeze({'key-auth':'Authenticate provisioning connection','signature-auth':'Verify signed provisioning request',
 context:'Validate saved signup context',preference:'Validate signed number-search preferences',claim:'Claim or inspect number purchase',purchase:'Search for and purchase the requested number'});
const AUTH_CODES=new Set(['PROVISIONING_AUTH_INVALID','PROVISIONING_AUTHORIZATION_INVALID','PROVISIONING_AUTH_NOT_CONFIGURED','PROVISIONING_SIGNING_NOT_CONFIGURED']);
const isAuth=phase=>phase==='key-auth'||phase==='signature-auth';
const valid=(operation,phase)=>Object.values(ROUTES).includes(operation)&&Object.hasOwn(PHASES,phase)&&(operation==='purchase'||isAuth(phase));
function provisioningErrorEvidence({operation,phase,error={},contextHash=null,privateValues=[],env=process.env}){
 if(!valid(operation,phase))return null;
 const diagnostic=signupDiagnosticError(error),raw=typeof error.providerDetail==='string'&&error.providerDetail?error.providerDetail:error.message;
 return {version:1,operation,phase,phaseLabel:PHASES[phase],contextHash:!isAuth(phase)&&/^[a-f0-9]{64}$/.test(contextHash||'')?contextHash:null,
  code:diagnostic.code,httpStatus:diagnostic.httpStatus,
  detail:redactDetail(raw,[...Object.entries(env).filter(([k])=>/secret|token|password|key|url/i.test(k)).map(([,v])=>v),...privateValues,...(!diagnostic.code?[error.code,error.providerCode]:[])]),
  errorReference:crypto.createHash('sha256').update(String(error.code||'')+'\n'+String(raw||'')).digest('hex').slice(0,16),
  requestOutcome:isAuth(phase)||phase==='context'||phase==='preference'?'request_not_dispatched':'uncertain_inspect_receipts',retryAllowed:false};
}
function readProvisioningError(value){
 if(!value||value.version!==1||!valid(value.operation,value.phase)||value.retryAllowed!==false
  ||!(value.contextHash===null||!isAuth(value.phase)&&/^[a-f0-9]{64}$/.test(value.contextHash||''))||typeof value.detail!=='string'||value.detail.length>600
  ||!/^[a-f0-9]{16}$/.test(value.errorReference||'')
  ||value.requestOutcome!==(isAuth(value.phase)||value.phase==='context'||value.phase==='preference'?'request_not_dispatched':'uncertain_inspect_receipts'))return null;
 const diagnostic=signupDiagnosticError({code:value.code,httpStatus:value.httpStatus});
 return {version:1,operation:value.operation,phase:value.phase,phaseLabel:PHASES[value.phase],contextHash:value.contextHash,
  code:diagnostic.code,httpStatus:diagnostic.httpStatus,detail:redactDetail(value.detail),errorReference:value.errorReference,requestOutcome:value.requestOutcome,retryAllowed:false};
}
function purchaseFailure(record={}){
 if(record.status!=='setup_error'||record.makeFailedStage!=='TWILIO_NUMBER_PURCHASE')return null;
 const diagnostic=signupDiagnosticError({code:record.makeProviderCode||record.makeError,providerStatus:record.makeProviderStatus});
 const auth=AUTH_CODES.has(diagnostic.code);
 return {stage:'number',label:auth?'Purchase request authentication failed':'Number purchase request failed',code:diagnostic.code,
  detail:diagnostic.code?diagnostic.code+' · '+diagnostic.message:'Make reports failure in the number-purchase request. The underlying error was not retained; this does not establish a Twilio rejection or timeout.',
  nextAction:'Inspect the purchase/authentication error and existing number receipts. Do not buy another number or rerun signup.'};
}
// Authentication refusals contain only server-selected messages, never caller IDs,
// supplied hashes/tokens/headers or guessed tenant attribution. Bound anonymous
// diagnostic writes to one sample per route/phase per minute per process (6 slots).
function createProvisioningAuthFailureCapture({record,now=Date.now,cooldownMs=60_000}){
 const admitted=new Map();
 return async function capture(req,phase,error){
  const operation=ROUTES[req?.route?.path||req?.path];
  if(req?.method!=='POST'||!operation||!isAuth(phase)||!AUTH_CODES.has(error?.code))return {recorded:false,ignored:true};
  const key=operation+':'+phase,time=now(),last=admitted.get(key);
  if(last!==undefined&&time-last<cooldownMs)return {recorded:false,suppressed:true};
  admitted.set(key,time);
  try{return await record({stage:'authorization',error,
   provisioningFailure:provisioningErrorEvidence({operation,phase,error,env:{}})});}
  catch{return {recorded:false,unavailable:true};}
 };
}
module.exports={provisioningErrorEvidence,readProvisioningError,purchaseFailure,createProvisioningAuthFailureCapture};
