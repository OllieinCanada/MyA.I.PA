'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {enforceAgentTestReadyStatus,buildAgentTestFingerprint,buildAgentRouteFingerprint,buildAgentReadiness,runAgentTextTest,AGENT_TEST_VERSION}=require('../server/signupAgentTesting');
const {verifyDispatchReadiness}=require('../server/smsDispatchReadiness');
const {projectSetup}=require('../server/adminSignupSetup');
function record(){
 const r={signupAttemptId:'signup_'+'a'.repeat(32),businessName:'Invented Electric',businessId:7,ownerEmail:'owner@example.invalid',ownerPhone:'+19055550101',
  twilioPhoneNumber:'+13655550100',vapiAssistantId:'invented-assistant',vapiPhoneNumberId:'invented-phone',status:'setup_ready',smsRoutingStatus:'healthy',
  agentContentStatus:'verified',agentContentFingerprint:'invented-content',agentContentVerifiedAt:'2026-11-26T10:00:00.000Z',agentRouteBindingStatus:'verified',agentRouteBindingMode:'direct',agentRouteBindingVerifiedAt:'2026-11-26T10:00:00.000Z',
  agentTestVersion:AGENT_TEST_VERSION,agentTestStatus:'passed',agentTestOwnerAcceptedAt:'2026-11-26T10:00:00.000Z',agentTestCustomerAcceptedAt:'2026-11-26T10:00:01.000Z',
  agentTestOwnerDeliveredAt:'2026-11-26T10:00:02.000Z',agentTestCustomerDeliveredAt:'2026-11-26T10:00:03.000Z',agentTestOwnerProviderStatus:'delivered',agentTestCustomerProviderStatus:'delivered',
  agentTestOwnerMessageSid:'SM'+'1'.repeat(32),agentTestCustomerMessageSid:'SM'+'2'.repeat(32),history:['preserve']};
 r.agentTestFingerprint=buildAgentTestFingerprint({assistantId:r.vapiAssistantId,aiNumber:r.twilioPhoneNumber,ownerPhone:r.ownerPhone,contentFingerprint:r.agentContentFingerprint});
 r.agentRouteBindingFingerprint=buildAgentRouteFingerprint({mode:'direct',businessId:r.businessId,phoneNumberId:r.vapiPhoneNumberId,aiNumber:r.twilioPhoneNumber,assistantId:r.vapiAssistantId});
 return r;
}
test('failed, waiting or absent routing never looks ready even when both practice texts delivered',()=>{
 for(const status of ['failed','waiting',undefined]){
  const r=record();r.smsRoutingStatus=status;const before=structuredClone(r),p=enforceAgentTestReadyStatus(r);
  assert.equal(p.status,'agent_testing');assert.equal(p.setupReadyBlockedReason,'SMS_ROUTING_NOT_VERIFIED');
  assert.equal(p.agentTestStatus,'passed');assert.equal(p.agentTestOwnerProviderStatus,'delivered');assert.deepEqual(r,before);
 }
 assert.equal(enforceAgentTestReadyStatus(record()).status,'setup_ready');
});
test('actual polling continuation cannot save ready before a failed final routing check; delivered receipts are not resent',async()=>{
 let current={...record(),status:'agent_testing'},dispatches=0;const writes=[];
 const business={id:7,settings:{ownerPhone:current.ownerPhone},vapiMappings:[['phoneNumber',current.twilioPhoneNumber],['phoneNumberId',current.vapiPhoneNumberId],['assistantId',current.vapiAssistantId]].map(([matchType,matchValue])=>({matchType,matchValue,businessId:7}))};
 const source=fs.readFileSync(require.resolve('../server/index'),'utf8'),start=source.indexOf('const agentTextTestContinuationLocks = new Map();'),end=source.indexOf('\nasync function getTrialCallUsage(',start);
 assert.ok(start>0&&end>start);
 const ctx={Map,String,Number,Date,Promise,runAgentTextTest,buildAgentReadiness,prisma:{business:{findUnique:async()=>business}},
  listSignupDashboardRecords:()=>[structuredClone(current)],upsertSignupDashboardRecord:r=>{current=enforceAgentTestReadyStatus(r);writes.push(structuredClone(current));return current;},
  dispatchSignupSms:async()=>{dispatches++;assert.fail('No resend');},sendSmsViaTwilio:()=>assert.fail('No real sender'),fetchSmsStatusViaTwilio:()=>assert.fail('Delivered receipts need no provider lookup'),
  isContactVerified:()=>true,hashOperationalTarget:()=> 'f'.repeat(24),signupOperationalIdentity:()=> 'synthetic',
  finalizeSignupAfterAgentTestByOperationalTarget:async()=>{assert.notEqual(current.status,'setup_ready','Ready must not precede finalization');throw Object.assign(Error('Synthetic final routing check failed'),{code:'SMS_DISPATCH_READINESS_TIMEOUT'});}};
 vm.createContext(ctx);vm.runInContext(source.slice(start,end),ctx);
 await assert.rejects(ctx.continueSignupAgentTextTestAfterDelivery(current.ownerEmail,current.signupAttemptId),/Synthetic final routing check failed/);
 assert.ok(writes.every(r=>r.status!=='setup_ready'));assert.equal(current.agentTestStatus,'passed');assert.equal(dispatches,0);
});
test('duplicate delivered callback preserves an already-finalized ready setup without re-finalizing or resending',async()=>{
 let current={...record(),setupFollowupStatus:'sent',setupReadyAt:'2026-11-26T10:00:04.000Z'};
 const original=structuredClone(current),business={id:7,settings:{ownerPhone:current.ownerPhone},vapiMappings:[['phoneNumber',current.twilioPhoneNumber],['phoneNumberId',current.vapiPhoneNumberId],['assistantId',current.vapiAssistantId]].map(([matchType,matchValue])=>({matchType,matchValue,businessId:7}))};
 const source=fs.readFileSync(require.resolve('../server/index'),'utf8'),start=source.indexOf('const agentTextTestContinuationLocks = new Map();'),end=source.indexOf('\nasync function getTrialCallUsage(',start);
 const ctx={Map,String,Number,Date,Promise,runAgentTextTest,buildAgentReadiness,prisma:{business:{findUnique:async()=>business}},
  listSignupDashboardRecords:()=>[structuredClone(current)],upsertSignupDashboardRecord:r=>{current=enforceAgentTestReadyStatus(r);return current;},
  dispatchSignupSms:()=>assert.fail('No resend'),sendSmsViaTwilio:()=>assert.fail('No sender'),fetchSmsStatusViaTwilio:()=>assert.fail('No receipt lookup required'),
  isContactVerified:()=>true,finalizeSignupAfterAgentTestByOperationalTarget:()=>assert.fail('Already finalized')};
 vm.createContext(ctx);vm.runInContext(source.slice(start,end),ctx);
 await ctx.continueSignupAgentTextTestAfterDelivery(current.ownerEmail,current.signupAttemptId);
 assert.equal(current.status,'setup_ready');assert.equal(current.setupReadyAt,original.setupReadyAt);
 for(const k of ['agentTestOwnerMessageSid','agentTestCustomerMessageSid','agentTestOwnerDeliveredAt','agentTestCustomerDeliveredAt'])assert.equal(current[k],original[k]);
});
const env=()=>[{name:'CALL_ID',value:'{{ call.id }}'},{name:'SMS_SUPPRESSION_CHECK_URL',value:'https://fixture.invalid/api/integrations/sms/suppression/check'},
 {name:'SMS_NOTIFICATION_DISPATCH_URL',value:'https://fixture.invalid/api/integrations/sms/dispatch'},{name:'SMS_SUPPRESSION_API_KEY',value:'NEVER-EXPORT-THIS-TEST-KEY'}];
for(const [name,fetchImpl,code,status]of[
 ['timeout',async()=>{throw Object.assign(Error('secret raw timeout NEVER-EXPORT-THIS-TEST-KEY'),{name:'TimeoutError',code:'ETIMEDOUT'});},'SMS_DISPATCH_READINESS_TIMEOUT',0],
 ['network',async()=>{throw Object.assign(Error('private owner@example.invalid'),{cause:{code:'ECONNRESET'}});},'SMS_DISPATCH_READINESS_UNAVAILABLE',0],
 ['HTML 502',async()=>({ok:false,status:502,json:async()=>{throw Error('PRIVATE HTML');}}),'SMS_DISPATCH_READINESS_HTTP_ERROR',502],
 ['invalid JSON',async()=>({ok:true,status:200,json:async()=>{throw Error('PRIVATE BODY');}}),'SMS_DISPATCH_READINESS_INVALID_RESPONSE',200],
 ['unready',async()=>({ok:true,status:200,json:async()=>({schemaVersion:1,ready:false})}),'SMS_DISPATCH_READINESS_UNREADY',200],
])test('readiness '+name+' preserves safe operation/status/timing and does not leak raw errors or credentials',async()=>{
 let calls=0;await assert.rejects(verifyDispatchReadiness({environmentVariables:env(),fetchImpl:async(...args)=>{calls++;return fetchImpl(...args);}}),e=>{
  assert.equal(e.code,code);assert.equal(e.provider,'myaipa');assert.equal(e.providerStatus,status);
  assert.equal(e.readinessDiagnostic.operation,'sms_dispatch_readiness_get');assert.equal(e.readinessDiagnostic.timeoutMs,10000);
  assert.ok(Number.isSafeInteger(e.readinessDiagnostic.elapsedMs)&&e.readinessDiagnostic.elapsedMs>=0);
  assert.doesNotMatch(JSON.stringify(e),/NEVER-EXPORT|owner@example|PRIVATE|raw timeout/);return true;
 });assert.equal(calls,1,'A failed self-check must not replay provisioning');
});
test('tracker displays only whitelisted saved timing/code fields, not arbitrary diagnostics or credential values',()=>{
 const r={...record(),smsRoutingStatus:'failed',smsRoutingReadinessDiagnostic:{operation:'sms_dispatch_readiness_get',phase:'http',code:'SMS_DISPATCH_READINESS_HTTP_ERROR',httpStatus:502,elapsedMs:812,timeoutMs:10000,raw:'NEVER-EXPORT-PRIVATE'}};
 const detail=projectSetup(r).groups.find(g=>g.id==='texts').checks.find(c=>c.id==='text-routing');
 assert.equal(detail.state,'blocked');assert.match(detail.detail,/HTTP 502/);assert.match(detail.detail,/812 ms elapsed \/ 10000 ms/);
 assert.doesNotMatch(JSON.stringify(detail),/NEVER-EXPORT/);
 r.smsRoutingReadinessDiagnostic.phase='NEVER-EXPORT-PRIVATE';assert.doesNotMatch(JSON.stringify(projectSetup(r)),/NEVER-EXPORT/);
 const draft=projectSetup({...record(),smsNotificationMode:'draft_only'}).groups.find(g=>g.id==='texts').checks[0];
 assert.match(draft.detail,/Draft saving is not automatic sending/);
});
test('runtime incident and Telegram preview diagnose backend readiness rather than guessing a Vapi failure',async()=>{
 const {classifyOperationalError}=require('../server/operationalErrorClassifier');
 const {buildRuntimeIncident}=require('../server/runtimeAlerts');
 const {buildIncidentTelegramAlert}=require('../server/incidentAlerts');
 let error;try{await verifyDispatchReadiness({environmentVariables:env(),fetchImpl:async()=>({ok:false,status:502})});}catch(e){error=e;}
 const c=classifyOperationalError(error);assert.equal(c.category,'sms_backend_readiness');assert.equal(c.provider,'MYAIPA');
 const incident=buildRuntimeIncident(error,{area:'signup text delivery polling background job'}),text=buildIncidentTelegramAlert(incident);
 assert.match(text,/readiness check.*HTTP response/i);assert.doesNotMatch(text,/Cause not confirmed|add funds|NEVER-EXPORT/);
});
test('actual routing failure wrapper preserves safe diagnostics for the tracker and preview without notifying a real transport',async()=>{
 const {safeReadinessDiagnostic}=require('../server/smsDispatchReadiness'),crypto=require('node:crypto');
 let failure;try{await verifyDispatchReadiness({environmentVariables:env(),fetchImpl:async()=>{throw Object.assign(Error('PRIVATE RAW'),{name:'TimeoutError'});}});}catch(e){failure=e;}
 const source=fs.readFileSync(require.resolve('../server/index'),'utf8'),start=source.indexOf('function buildSignupSmsRoutingFailureContext('),end=source.indexOf('\nfunction normalizeVapiImportPhone(',start);
 assert.ok(start>0&&end>start);const ctx={String,Number,safeReadinessDiagnostic,console,
  hashKey:v=>crypto.createHash('sha256').update(v).digest('hex'),normalizeVapiImportPhone:v=>/^\+1\d{10}$/.test(v||'')?v:''};
 vm.createContext(ctx);vm.runInContext(source.slice(start,end),ctx);let notices=0;
 const result=await ctx.safelyProvisionIsolatedSmsForSignup({assistantId:'invented-assistant',aiNumber:'+13655550100',ownerNumber:'+19055550101'},
  {provision:async()=>{throw failure;},notify:(e,c)=>{notices++;assert.equal(e,failure);assert.equal(c.snapshot['Timeout ms'],10000);assert.equal(c.snapshot['Check result'],'timeout');}});
 assert.equal(result.failed,true);assert.equal(result.providerCode,'SMS_DISPATCH_READINESS_TIMEOUT');assert.equal(result.providerStatus,0);
 assert.deepEqual(JSON.parse(JSON.stringify(result.readinessDiagnostic)),failure.readinessDiagnostic);assert.equal(notices,1);
 assert.doesNotMatch(JSON.stringify(result),/PRIVATE RAW|NEVER-EXPORT/);
 for(const phase of ['unexpected','toString','__proto__'])assert.equal(safeReadinessDiagnostic({...failure.readinessDiagnostic,phase,code:undefined}),null);
});
for(const code of ['P2028','SECRET-RAW-CODE'])test('actual Twilio callback retains sanitized commit timing for '+(code==='P2028'?'DB timeout':'unknown error')+' and never ACKs an unsaved receipt',async()=>{
 const source=fs.readFileSync(require.resolve('../server/index'),'utf8').replace(/\r\n/g,'\n'),start=source.indexOf('app.post(\n  "/api/webhooks/twilio/message-status",'),end=source.indexOf('\napp.post(',start+1);assert.ok(start>0&&end>start);
 let handler,logs=[],tick=1000;
 const ctx={app:{post:(_path,...handlers)=>{handler=handlers.at(-1);}},twilioStatusCallbackProcessRateLimiter(){},express:{urlencoded:()=>()=>{}},asyncRoute:f=>f,
  process:{env:{}},Date:{now:()=>{tick+=10;return tick;}},String,Math,prisma:{},TWILIO_STATUS_CALLBACK_URL:'https://fixture.invalid/status',verifyTwilioWebhookRequest:()=>true,
  enqueueTwilioStatus:async()=>{throw Object.assign(Error('PRIVATE SQL BODY AND CREDENTIAL'),{code});},console:{warn:(...args)=>logs.push(args)}};
 vm.createContext(ctx);vm.runInContext(source.slice(start,end),ctx);
 const res={statusCode:200,status(s){this.statusCode=s;return this;},json(b){this.body=b;return this;},type(){assert.fail('Must not ACK failed commit');}};
 await handler({body:{MessageSid:'SM'+'a'.repeat(32),Body:'PRIVATE CUSTOMER TEXT'}},res);
 assert.equal(res.statusCode,503);assert.equal(logs.length,1);assert.equal(logs[0][1].operation,'enqueue_delivery_receipt');
 assert.equal(logs[0][1].outcome,'commit_unconfirmed');assert.equal(logs[0][1].elapsedMs,10);
 assert.equal(logs[0][1].code,code==='P2028'?'P2028':'RECEIPT_SAVE_UNAVAILABLE');assert.doesNotMatch(JSON.stringify(logs),/PRIVATE|SECRET-RAW|SMaaaa/);
});
