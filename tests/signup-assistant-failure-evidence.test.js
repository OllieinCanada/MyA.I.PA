'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {signupDiagnosticError}=require('../server/signupDiagnosticError');
const {runtimeBugStage,shouldCaptureRuntimeBug}=require('../server/signupBugHistory');
const {sanitizeMakeFailureEnvelope,classifyMakeSignupResponse}=require('../server/makeSignupWebhook');
const {normalizeSignupProvisioningPayload,verifySignupProvisioningAuthorization}=require('../server/signupProvisioning');
const {assertSignupOpen,signupBusinessKey,isClosedSignup}=require('../server/signupBusinessIdentity');
const source=fs.readFileSync(require.resolve('../server/index'),'utf8').replace(/\r\n/g,'\n');
const begin=source.indexOf('async function loadTrustedProvisioningContext(');
const loader=source.slice(begin,source.indexOf('\nasync function ',begin+1));
const routeStart=source.indexOf('app.post(\n  "/api/integrations/vapi/create-signup-assistant",');
const route=source.slice(routeStart,source.indexOf('\napp.post(',routeStart+1));
const errorStart=source.indexOf('app.use((err, req, res, _next) => {');
const errors=source.slice(errorStart,source.indexOf('\nfunction runBackgroundJob(',errorStart));
assert.ok(begin>0&&routeStart>0&&errorStart>0);
const attemptId='signup_'+'a'.repeat(32),secret='synthetic-test-signing-secret';
function fixture(mode='valid',baseline=false){
 const payload=normalizeSignupProvisioningPayload({business:{name:'Fixture Electric',phone:'+12895550111'},owner:{name:'Fixture Owner',email:'fixture@example.invalid',phone:'+19055550112'},aiAssistant:{serviceArea:'Niagara'}},{signingSecret:secret});
 const reports=[],counts={execute:0,claim:0,reconcile:0};let handler,errorHandler;
 const ctx={console:{error(){}},process:{env:{}},Object,String,Number,Error,normalizePhoneForMatch:x=>x,
  getProvisioningAuthorizationInput:()=>payload.provisioning,
  loadSignupProvisioningContextForAttempt:async()=>{if(mode==='missing-context')throw Object.assign(Error('private context'),{code:'PROVISIONING_CONTEXT_NOT_REGISTERED',statusCode:409});return {payload:mode==='bad-signature'?{...payload,business:{name:'tampered'}}:payload,eventKey:attemptId};},
  verifySignupProvisioningAuthorization,getProvisioningSigningSecret:()=>secret,
  prisma:{signupAttempt:{findUnique:async()=>({status:mode==='closed'?'archived':'setup_error'})},runtimeStore:{findUnique:async()=>null}},
  assertSignupOpen,signupBusinessKey,isClosedSignup,listSignupDashboardRecords:()=>[],
  assertSignupLegacyResourcesSafe:async()=>{if(mode==='legacy-conflict')throw Object.assign(Error('private contact must not leak'),{code:'SIGNUP_ARCHIVED_RESOURCES_STILL_OWNED',statusCode:409});},
  signupHasProvisioningOrBillingResources:()=>false,
  app:{post:(_path,...handlers)=>{handler=handlers.at(-1);},use:fn=>{errorHandler=fn;}},
  requireProvisioningKey(){},requireProvisioningAuthorization(){},asyncRoute:fn=>fn,
  normalizeVapiImportPhone:value=>/^\+1[2-9]\d{9}$/.test(value||'')?value:'',
  requireCompletedProvisioningStage:async(_auth,_kind,result)=>{if(mode==='missing-receipt')throw Object.assign(Error('missing'),{code:'PROVISIONING_STAGE_DEPENDENCY_MISSING',statusCode:409});if(result.twilioPhoneNumber!=='+12895550113')throw Object.assign(Error('foreign'),{code:'PROVISIONING_STAGE_RESULT_MISMATCH',statusCode:409});},
  buildProvisioningResourceName:()=> 'fixture-assistant',verifySavedProvisioningResources:()=>true,
  runProvisioningStep:async({execute,reconcile})=>{counts.claim++;if(mode==='uncertain'){await reconcile();throw Object.assign(Error('uncertain'),{code:'PROVISIONING_RECONCILIATION_REQUIRED',statusCode:409});}return execute();},
  createSignupVapiAssistant:async input=>{if(input.reconcileOnly){counts.reconcile++;return null;}counts.execute++;if(mode==='provider-timeout')throw Object.assign(Error('private upstream payload'),{code:'ETIMEDOUT',statusCode:504,telegramIncidentHandled:true});return {assistantId:'fixture-assistant'};},
  runtimeBugStage,shouldCaptureRuntimeBug,sanitizeMakeFailureEnvelope,
  safelyNotifyRuntimeFailure:(_error,input)=>{reports.push(input);},
  safelyRecordSignupBug:async input=>{reports.push({attemptId:input.attemptId,stage:input.stage,diagnostic:signupDiagnosticError(input.error)});},
 };
 // Removing only the new early attribution reconstructs the prior loader.
 const testedLoader=baseline?loader.replace('req.signupProvisioningAttemptId = attemptId;',''):loader;
 vm.createContext(ctx);vm.runInContext(testedLoader+'\n'+route+'\n'+errors,ctx);
 return {ctx,payload,reports,counts,async run(body={assignedPhone:'+12895550113'}){
  const req={method:'POST',path:'/api/integrations/vapi/create-signup-assistant',route:{path:'/api/integrations/vapi/create-signup-assistant'},query:{},body,provisioningAuthorization:payload.provisioning};
  let response,status;const res={status(s){status=s;return this;},json(b){response=b;}};
  try{await handler(req,res);}catch(error){error.telegramIncidentHandled=true;errorHandler(error,req,res,()=>{});}
  return {req,status,response};
 }};
}
test('baseline reproduces a lost signup link for a pre-claim legacy refusal',async()=>{
 const f=fixture('legacy-conflict',true),r=await f.run();
 assert.equal(r.status,409);assert.equal(r.response.code,'SIGNUP_ARCHIVED_RESOURCES_STILL_OWNED');
 assert.equal(r.req.signupProvisioningAttemptId,undefined);assert.equal(f.reports.length,0);assert.equal(f.counts.claim,0);
});
test('pre-claim lifecycle and legacy failures retain original server-owned attribution',async()=>{
 for(const [mode,code] of [['closed','SIGNUP_CLOSED'],['legacy-conflict','SIGNUP_ARCHIVED_RESOURCES_STILL_OWNED']]){
  const f=fixture(mode),r=await f.run();assert.equal(r.status,409);assert.equal(r.response.code,code);
  assert.equal(r.req.signupProvisioningAttemptId,attemptId);assert.equal(f.reports[0].attemptId,attemptId);
  assert.equal(f.reports[0].stage,'assistant-create');assert.equal(f.reports[0].diagnostic.code,code);
  assert.equal(f.counts.claim,0);assert.equal(f.counts.execute,0);
 }
});
test('unverified signature and absent context never acquire signup attribution',async()=>{
 for(const mode of ['bad-signature','missing-context']){const f=fixture(mode),r=await f.run({signupAttemptId:attemptId});assert.ok(r.status>=400);assert.equal(r.req.signupProvisioningAttemptId,undefined);assert.equal(f.reports.length,0);assert.equal(f.counts.claim,0);}
});
test('missing phone, missing purchase receipt and mismatched number stop before provider claim',async()=>{
 for(const [mode,body,code] of [['valid',{},'ASSIGNED_PHONE_REQUIRED'],['missing-receipt',undefined,'PROVISIONING_STAGE_DEPENDENCY_MISSING'],['valid',{assignedPhone:'+12895550199'},'PROVISIONING_STAGE_RESULT_MISMATCH']]){
  const f=fixture(mode),r=await f.run(body);assert.equal(r.response.code,code);assert.equal(f.reports[0].diagnostic.code,code);assert.equal(f.counts.execute,0);assert.equal(f.counts.claim,0);
 }
});
test('valid handoff uses completed purchase number and returns assistant ID',async()=>{const f=fixture(),r=await f.run();assert.equal(r.status,201);assert.equal(r.response.assistantId,'fixture-assistant');assert.equal(f.counts.execute,1);assert.equal(f.reports.length,0);});
test('timeout and uncertain outcomes stay failures, with no automatic retry',async()=>{
 for(const [mode,code,dispatches] of [['provider-timeout','ETIMEDOUT',1],['uncertain','PROVISIONING_RECONCILIATION_REQUIRED',0]]){
  const f=fixture(mode),r=await f.run();assert.equal(r.response.code,code);assert.notEqual(r.response.success,true);assert.equal(f.counts.execute,dispatches);assert.equal(f.counts.claim,1);assert.equal(f.reports[0].diagnostic.code,code);
 }
});
test('journal projections expose allowlisted explanations, not raw errors or credentials',()=>{
 const raw='fixture@example.invalid Bearer secret-value';
 const safe=signupDiagnosticError({code:'ASSIGNED_PHONE_REQUIRED',message:raw,headers:{authorization:raw}});
 assert.equal(safe.code,'ASSIGNED_PHONE_REQUIRED');assert.match(safe.message,/do not buy again/);assert.ok(!JSON.stringify(safe).includes(raw));
 const unknown=signupDiagnosticError({code:raw,message:raw});assert.equal(unknown.code,null);assert.ok(!JSON.stringify(unknown).includes(raw));
});
test('Make structured failure preserves stage and code without treating HTTP success as setup success',()=>{
 const data={ok:false,success:false,failedStage:'VAPI_ASSISTANT_CREATE',provider:'VAPI',providerCode:'ASSIGNED_PHONE_REQUIRED',retryable:false};
 const result=classifyMakeSignupResponse(JSON.stringify(data),data);assert.equal(result.complete,false);assert.equal(result.providerCode,'ASSIGNED_PHONE_REQUIRED');assert.equal(result.failedStage,'VAPI_ASSISTANT_CREATE');assert.equal(result.retryable,false);
});
