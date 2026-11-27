'use strict';
// Preparation/validation only. No Make API client, activation or trigger exists
// here. Blueprints containing a real connection key must remain in memory.
const assert=require('node:assert/strict');
const {ROUTE,buildSyntheticRequest}=require('../server/provisioningPreflightDiagnostic');
const {redactDetail}=require('../server/signupAssistantError');
const ORIGIN='https://api.myaipa.ca';
const VARIANTS=Object.freeze(['empty-multipart','marker-multipart']);
function privateResponseMapping(reference,connectionKey){
 // Fixed Make replace grammar: redact every occurrence before the webhook
 // response leaves Make. Only regex-literal-safe existing keys are admitted.
 return `{{replace(replace(${reference}; "/${connectionKey}/g"; "[redacted]"); "/[a-fA-F0-9]{64}/g"; "[redacted]")}}`;
}
function buildBlueprint({hookId,connectionKey,variant}){
 assert.ok(Number.isSafeInteger(hookId)&&hookId>0,'Owned hook ID required');
 assert.ok(typeof connectionKey==='string'&&/^[A-Za-z0-9_-]{16,512}$/.test(connectionKey),'Existing regex-literal-safe connection credential required in memory; never change credentials to fit this diagnostic');
 assert.ok(VARIANTS.includes(variant),'Explicit fixed body variant required');
 const responder=(id,status,body,type='application/json')=>({id,module:'gateway:WebhookRespond',version:1,parameters:{},mapper:{status,body,headers:[{key:'Content-Type',value:type}]}});
 const bindings={diagnosticId:'{{21.diagnosticId}}',issuedAt:'{{21.issuedAt}}',
  areaCode:'{{21.provisioning.preferredAreaCode}}',region:'{{21.provisioning.preferredRegion}}',
  voiceUrl:'https://example.invalid/provider-disabled',voiceMethod:'POST',
  idempotencyKey:'{{21.provisioning.idempotencyKey}}',contextHash:'{{21.provisioning.contextHash}}'};
 return {name:'Provider-disabled backend preflight / '+variant,flow:[
  {id:16,module:'gateway:CustomWebHook',version:1,parameters:{hook:hookId,maxResults:1},mapper:{}},
  {id:21,module:'json:ParseJSON',version:1,parameters:{type:''},mapper:{json:'{{16.value}}'},
   onerror:[responder(104,'400','{"diagnostic":true,"ok":false,"code":"MAKE_DIAGNOSTIC_PAYLOAD_INVALID","retryAllowed":false}')]},
  {id:9,module:'http:ActionSendData',version:3,parameters:{handleErrors:false},mapper:{
   url:ORIGIN+ROUTE,method:'post',serializeUrl:false,followAllRedirects:false,useMtls:false,
   followRedirect:false,rejectUnauthorized:true,parseResponse:false,shareCookies:false,
   timeout:'15',authUser:'',authPass:'',bodyType:'multipart_form_data',
   formDataFields:variant==='marker-multipart'?[{fieldType:'text',key:'_diagnostic_fixture',value:'synthetic-only'}]:[],
   qs:Object.entries(bindings).map(([name,value])=>({name,value})),
   headers:[{name:'x-provisioning-token',value:'{{21.provisioning.authorizationToken}}'},{name:'x-myaipa-integration-key',value:connectionKey}]},
   // Preserve technical error text while removing request credentials before
   // returning it. The caller performs a second redaction before persistence.
   onerror:[responder(101,'502',privateResponseMapping('9.error.message',connectionKey),'text/plain')]},
  responder(30,'{{9.statusCode}}',privateResponseMapping('9.data',connectionKey))
 ],metadata:{instant:true,version:1,scenario:{roundtrips:1,maxErrors:1,autoCommit:true,autoCommitTriggerLast:true,sequential:false,confidential:true,dlq:false,dataloss:false,freshVariables:false}}};
}
function assertSafeBlueprint(blueprint,expected){
 assert.deepEqual(blueprint,buildBlueprint(expected),'Any changed module, URL, handler, query, credential, redirect or setting requires review');
 return true;
}
function buildPayload(options){
 const request=buildSyntheticRequest(options),q=request.query;
 return {diagnosticId:q.diagnosticId,issuedAt:q.issuedAt,provisioning:{idempotencyKey:q.idempotencyKey,contextHash:q.contextHash,
  authorizationToken:request.authorizationToken,preferredAreaCode:q.areaCode,preferredRegion:q.region}};
}
function consumeResponse({httpStatus,text,diagnosticId,expectedRelease,connectionKey,authorizationToken,additionalRedactions=[]}){
 assert.ok(Number.isInteger(httpStatus)&&httpStatus>=100&&httpStatus<=599);
 assert.ok(/^mdiag_[a-f0-9]{32}$/.test(diagnosticId||''));
 assert.ok(/^[a-f0-9]{40}$/.test(expectedRelease||''),'Independently verified backend release required');
 assert.ok(typeof connectionKey==='string'&&connectionKey.length>=16&&/^[a-f0-9]{64}$/.test(authorizationToken||''),'Explicit request-credential redaction context required');
 const detail=()=>redactDetail(String(text||''),[connectionKey,authorizationToken,...additionalRedactions]);
 let value;try{value=JSON.parse(text);}catch{}
 if(!value||value.version!==1||value.diagnostic!==true||value.diagnosticId!==diagnosticId||value.release!==expectedRelease||value.httpStatus!==httpStatus
  ||value.providerCallsAllowed!==false||value.productionRecordWritesAllowed!==false||value.signupReplayAllowed!==false||value.retryAllowed!==false
  ||value.historicalFailureProven!==false||value.customerContextVerified!==false){
  return {scope:'provider-disabled-diagnostic-response',serverDiagnosticVerified:false,httpStatus,detail:detail(),retryAllowed:false,historicalFailureProven:false};
 }
 const stages=new Set(['connection-auth','signature-auth','synthetic-scope','database-admission','database-read-only','synthetic-context-lock','synthetic-context-read','database-finish','complete']);
 const codes=new Set(['DIAGNOSTIC_READ_ONLY_COMPLETE','PROVISIONING_AUTH_NOT_CONFIGURED','PROVISIONING_AUTH_INVALID','PROVISIONING_SIGNING_NOT_CONFIGURED','PROVISIONING_AUTHORIZATION_INVALID','DIAGNOSTIC_SCOPE_INVALID','DIAGNOSTIC_PROOF_EXPIRED','DIAGNOSTIC_SCOPE_MISMATCH','DIAGNOSTIC_READ_ONLY_UNCONFIRMED','DIAGNOSTIC_SYNTHETIC_LOCK_BUSY','DIAGNOSTIC_SYNTHETIC_KEY_CONFLICT','DIAGNOSTIC_DATABASE_OR_RUNTIME_FAILED']);
 if(!codes.has(value.code)||!Array.isArray(value.checkpoints)||value.checkpoints.length>10
  ||value.checkpoints.some(p=>!stages.has(p.stage)||!Number.isSafeInteger(p.elapsedMs)||p.elapsedMs<0)
  ||!Number.isSafeInteger(value.elapsedMs)||value.elapsedMs<0
  ||!(value.failedCheckpoint===null||stages.has(value.failedCheckpoint)))throw Error('DIAGNOSTIC_RESPONSE_UNTRUSTED');
 const order=[...stages],actual=value.checkpoints.map(p=>p.stage);
 if(!actual.length||actual.some((stage,i)=>stage!==order[i])
  ||value.checkpoints.some((p,i)=>i&&p.elapsedMs<value.checkpoints[i-1].elapsedMs)
  ||value.elapsedMs<value.checkpoints.at(-1).elapsedMs
  ||httpStatus!==200&&(value.ok!==false||value.failedCheckpoint!==actual.at(-1)))throw Error('DIAGNOSTIC_CHECKPOINT_PROOF_INVALID');
 const passed=httpStatus===200&&value.ok===true&&value.code==='DIAGNOSTIC_READ_ONLY_COMPLETE'&&value.failedCheckpoint===null
  &&value.readOnlyConfirmed===true&&value.syntheticLockAcquired===true&&value.syntheticContextAbsent===true&&actual.length===order.length;
 if(httpStatus===200&&!passed)throw Error('DIAGNOSTIC_SUCCESS_PROOF_INCOMPLETE');
 return {scope:'provider-disabled-diagnostic-response',serverDiagnosticVerified:true,release:expectedRelease,httpStatus,passed,code:value.code,
  databaseCode:/^P\d{4}$/.test(value.databaseCode||'')?value.databaseCode:null,
  sqlState:/^[A-Z0-9]{5}$/.test(value.sqlState||'')?value.sqlState:null,
  failedCheckpoint:value.failedCheckpoint,checkpoints:value.checkpoints.map(p=>({stage:p.stage,elapsedMs:p.elapsedMs})),elapsedMs:value.elapsedMs,
  retryAllowed:false,historicalFailureProven:false};
}
function main(args=process.argv.slice(2)){
 if(args.length&&!(args.length===1&&args[0]==='--plan'))throw Error('PLAN_ONLY_NO_API_EXECUTION_SUPPORTED');
 console.log(JSON.stringify({mode:'plan-only',endpoint:ORIGIN+ROUTE,variants:VARIANTS,maximumTriggers:2,
  originalScenarioChanged:false,requiresVerifiedBackendRelease:true,liveExecutionPerformed:false,providerPurchases:0,messages:0,
  scope:'Synthetic transport/auth/read-only SQL probe; not historical signup reconstruction or full provisioning proof'},null,2));
}
module.exports={ORIGIN,VARIANTS,buildBlueprint,assertSafeBlueprint,buildPayload,consumeResponse,main};
if(require.main===module){try{main();}catch{console.error('Only --plan is supported. No Make resource was created or executed.');process.exitCode=1;}}
