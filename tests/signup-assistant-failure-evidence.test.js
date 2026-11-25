'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {signupDiagnosticError}=require('../server/signupDiagnosticError');
const {runtimeBugStage,shouldCaptureRuntimeBug}=require('../server/signupBugHistory');
const {assistantErrorEvidence,privateStrings}=require('../server/signupAssistantError');
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
  assistantErrorEvidence:baseline?()=>null:assistantErrorEvidence,privateStrings,
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
  safelyRecordSignupBug:async input=>{reports.push({attemptId:input.attemptId,stage:input.stage,diagnostic:signupDiagnosticError(input.error),assistantFailure:input.assistantFailure});},
 };
 // Removing only the new early attribution reconstructs the prior loader.
 const testedLoader=baseline?loader.replace('req.signupProvisioningAttemptId = attemptId;',''):loader;
 vm.createContext(ctx);vm.runInContext(testedLoader+'\n'+route+'\n'+errors,ctx);
 return {ctx,payload,reports,counts,routeHandler:()=>handler,errorHandler:()=>errorHandler,async run(body={assignedPhone:'+12895550113'},headers={}){
  const req={method:'POST',path:'/api/integrations/vapi/create-signup-assistant',route:{path:'/api/integrations/vapi/create-signup-assistant'},query:{},headers,body,provisioningAuthorization:payload.provisioning};
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
 for(const mode of ['bad-signature','missing-context']){const f=fixture(mode),r=await f.run({signupAttemptId:attemptId});assert.ok(r.status>=400);assert.equal(r.req.signupProvisioningAttemptId,undefined);assert.ok(f.reports.every(report=>report.attemptId===undefined));assert.equal(f.counts.claim,0);}
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

test('actual assistant route captures exact checkpoint and status before its provider claim',async()=>{
 const cases=[['valid',{},'phone','ASSIGNED_PHONE_REQUIRED'],['missing-receipt',undefined,'prerequisite','PROVISIONING_STAGE_DEPENDENCY_MISSING'],['closed',undefined,'context','SIGNUP_CLOSED']];
 for(const[mode,body,phase,code]of cases){const f=fixture(mode),r=await f.run(body),e=f.reports[0].assistantFailure;
  assert.equal(e.phase,phase);assert.equal(e.code,code);assert.equal(e.contextHash,f.payload.provisioning.contextHash);assert.equal(e.providerOutcome,'assistant_not_dispatched');assert.equal(e.retryAllowed,false);assert.equal(f.counts.claim,0);assert.equal(r.response.code,code);
 }
});
test('actual route records unknown assistant outcome without an extra attempt after transport failure',async()=>{
 const f=fixture('provider-timeout');await f.run();const e=f.reports[0].assistantFailure;
 assert.equal(e.phase,'create');assert.equal(e.code,'ETIMEDOUT');assert.equal(e.httpStatus,504);assert.equal(e.providerOutcome,'uncertain_inspect_receipts');assert.equal(f.counts.execute,1);
});

test('actual assistant handler redacts echoed request-header values from saved technical detail',async()=>{
 const f=fixture(),opaque='invented-opaque-header-value';
 f.ctx.createSignupVapiAssistant=async()=>{f.counts.execute++;throw Object.assign(Error('Upstream rejected '+opaque),{code:'ETIMEDOUT',statusCode:504});};
 const result=await f.run(undefined,{'x-fixture-debug-token':opaque});
 assert.equal(result.status,504);assert.equal(f.counts.execute,1);
 assert.doesNotMatch(JSON.stringify(f.reports[0].assistantFailure),/invented-opaque-header-value/);
 assert.match(f.reports[0].assistantFailure.detail,/Upstream rejected/);
});

test('diagnostic persistence failure cannot replace the original error or start a second capture',async()=>{
 const f=fixture();let captures=0;f.ctx.safelyRecordSignupBug=async()=>{captures++;throw Error('synthetic unavailable storage');};
 const r=await f.run({});assert.equal(r.status,400);assert.equal(r.response.code,'ASSIGNED_PHONE_REQUIRED');assert.equal(captures,1);assert.equal(f.counts.claim,0);assert.equal(f.counts.execute,0);
});
test('real loopback HTTP runs the actual assistant route through durable synthetic journal before returning failure',async t=>{
 const express=require('express'),{fixture:memory}=require('./helpers/signup-bug-memory-db'),{recordSignupBug,listSignupBugs}=require('../server/signupBugHistory');
 const f=fixture(),db=memory(),record={signupAttemptId:attemptId,businessName:f.payload.business.name,ownerEmail:f.payload.owner.email,ownerPhone:f.payload.owner.phone,status:'setup_error'};
 db.attempts.set(attemptId,{eventKey:attemptId,payload:f.payload});db.setRecords([record]);f.ctx.listSignupDashboardRecords=db.listSignups;
 f.ctx.safelyRecordSignupBug=input=>recordSignupBug({...input,prisma:db.prisma,listSignups:db.listSignups});
 const app=express();app.use(express.json());app.post('/assistant',(req,res,next)=>{if(req.headers['x-fixture-auth']!=='signed-test')return res.sendStatus(401);req.provisioningAuthorization=f.payload.provisioning;Promise.resolve(f.routeHandler()(req,res)).catch(next);});app.use(f.errorHandler());
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});t.after(()=>new Promise(resolve=>server.close(resolve)));
 const url='http://127.0.0.1:'+server.address().port+'/assistant';
 assert.equal((await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,401);assert.equal(db.rows.size,0);
 const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json','x-fixture-auth':'signed-test'},body:'{}'});
 assert.equal(response.status,400);assert.equal((await response.json()).code,undefined,'Fixture route is not the production integration URL; no extra public code propagation is inferred');
 const saved=await listSignupBugs({prisma:db.prisma,listSignups:db.listSignups,attemptId});assert.equal(saved.events.length,1);assert.equal(saved.events[0].assistantFailure.code,'ASSIGNED_PHONE_REQUIRED');assert.equal(saved.events[0].assistantFailure.phase,'phone');assert.equal(f.counts.claim,0);assert.equal(f.counts.execute,0);
});

test('actual assistant handler with real claim algorithm creates once across concurrent requests and reconstructed workers',async()=>{
 const {memoryDb}=require('./helpers/twilio-status-memory-db'),{runProvisioningStep}=require('../server/provisioningState');
 const db=memoryDb(),first=fixture();first.ctx.runProvisioningStep=options=>runProvisioningStep({...options,prisma:db.prisma});
 let release,entered;const started=new Promise(r=>{entered=r;}),held=new Promise(r=>{release=r;});
 first.ctx.createSignupVapiAssistant=async input=>{if(input.reconcileOnly){first.counts.reconcile++;return null;}first.counts.execute++;entered();await held;return {assistantId:'fixture-assistant'};};
 const pending=first.run();await started;const duplicate=await first.run();
 assert.equal(duplicate.response.code,'PROVISIONING_ALREADY_IN_PROGRESS');assert.equal(first.counts.execute,1);
 release();assert.equal((await pending).status,201);
 const restarted=fixture();restarted.ctx.runProvisioningStep=options=>runProvisioningStep({...options,prisma:db.prisma});
 const replay=await restarted.run();assert.equal(replay.status,200);assert.equal(replay.response.reused,true);assert.equal(restarted.counts.execute,0);
 assert.equal(db.rows.size,1);assert.equal([...db.rows.values()][0].data.status,'completed');
});

test('reconstructed assistant handler preserves uncertain-dispatch refusal instead of resending after timeout',async()=>{
 const {memoryDb}=require('./helpers/twilio-status-memory-db'),{runProvisioningStep}=require('../server/provisioningState');
 const db=memoryDb(),first=fixture('provider-timeout');first.ctx.runProvisioningStep=options=>runProvisioningStep({...options,prisma:db.prisma});
 assert.equal((await first.run()).response.code,'ETIMEDOUT');assert.equal(first.counts.execute,1);
 const before=[...db.rows.values()][0].data;assert.ok(before.dispatchStartedAt);assert.equal(before.status,'failed');
 const restarted=fixture();restarted.ctx.runProvisioningStep=options=>runProvisioningStep({...options,prisma:db.prisma});
 const result=await restarted.run();assert.equal(result.response.code,'PROVISIONING_RECONCILIATION_REQUIRED');assert.equal(restarted.counts.execute,0);
 assert.equal(restarted.counts.reconcile,1);assert.equal([...db.rows.values()][0].data.originalErrorCode,'ETIMEDOUT');
});
