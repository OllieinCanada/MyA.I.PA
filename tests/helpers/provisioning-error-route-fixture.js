'use strict';
// Actual source middleware/handler + fake providers and persisted-memory stores.
// Not a PostgreSQL, full-server startup or live provider test.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const provision=require('../../server/signupProvisioning');
const identity=require('../../server/signupBusinessIdentity');
const {provisioningErrorEvidence,createProvisioningAuthFailureCapture}=require('../../server/signupProvisioningError');
const {privateStrings}=require('../../server/signupAssistantError');
const journal=require('../../server/signupBugHistory');
const {sanitizeMakeFailureEnvelope}=require('../../server/makeSignupWebhook');
const {createProvisioningRequestTrace}=require('../../server/provisioningRequestTrace');
const {fixture:memoryJournal}=require('./signup-bug-memory-db');
const source=fs.readFileSync(require.resolve('../../server/index'),'utf8').replace(/\r\n/g,'\n');
function section(start,end){const a=source.indexOf(start),b=source.indexOf(end,a+start.length);assert.ok(a>=0&&b>a,'Actual source boundaries must exist');return source.slice(a,b);}
const auth=section('function rejectProvisioningAuthentication(','\n// Strictly read-only proof collection');
const integrationKeyGuard=section('function hasValidIntegrationKey(','\nfunction getVapiWebhookSecret(');
const limiter=section('const provisioningRequestProcessRateLimiter = rateLimit({','\nconst adminLoginProcessRateLimiter = rateLimit({');
const loader=section('async function loadTrustedProvisioningContext(','\nasync function assertSignupLegacyResourcesSafe(');
const route=section('app.post(\n  "/api/integrations/twilio/purchase-number",','\napp.post(');
const errors=section('app.use((err, req, res, _next) => {','\nfunction runBackgroundJob(');
const runtimeArea=section('function runtimeAreaForRoute(','\nasync function preserveIncidentRemediationUpdate(');
const path='/api/integrations/twilio/purchase-number',secret='synthetic-signing-secret';
function fixture(mode='valid'){
 const db=memoryJournal(),target=db.add();
 const payload=provision.normalizeSignupProvisioningPayload(target.payload,{signingSecret:secret});
 const counts={claims:0,purchases:0,incidents:0,warnings:0},captures=[],traceEvents=[];let handlers,errorHandler;
 const record=options=>{const job=journal.safelyRecordSignupBug({...options,prisma:db.prisma,listSignups:db.listSignups});captures.push(job);return job;};
 const ctx={console:{error(){},warn(){counts.warnings++;}},process:{env:{PROVISIONING_SIGNING_SECRET:secret}},Object,String,Number,Error,
  provisioningRequestTrace:createProvisioningRequestTrace({write:e=>traceEvents.push(e)}),
  INTEGRATION_API_KEY:'synthetic-connection-key',
  getMakeSignupWebhookConfig:()=>({apiKey:'synthetic-make-key'}),getMakeSignupWebhookToken:()=>'',
  hasValidIntegrationKey:req=>req.headers['x-myaipa-integration-key']==='synthetic-connection-key',
  safeEqualString:(a,b)=>!!a&&!!b&&a===b,...provision,
  captureProvisioningAuthFailure:createProvisioningAuthFailureCapture({record}),
  provisioningErrorEvidence,privateStrings,
  prisma:{...db.prisma,signupAttempt:{...db.prisma.signupAttempt,findUnique:async()=>({status:mode==='closed'?'archived':'setup_error'})}},
  loadSignupProvisioningContextForAttempt:async()=>{if(mode==='missing-context')throw Object.assign(Error('No registered fixture context'),{code:'PROVISIONING_CONTEXT_NOT_REGISTERED',statusCode:401});return{payload,eventKey:target.attemptId};},
  assertSignupOpen:identity.assertSignupOpen,signupBusinessKey:identity.signupBusinessKey,isClosedSignup:identity.isClosedSignup,
  normalizePhoneForMatch:x=>x,listSignupDashboardRecords:db.listSignups,
  assertSignupLegacyResourcesSafe:async()=>{},signupHasProvisioningOrBillingResources:()=>false,
  runProvisioningStep:async options=>{counts.claims++;return options.execute();},
  verifySavedProvisioningResources:async()=>true,
  purchaseTwilioPhoneNumber:async()=>{counts.purchases++;if(mode==='timeout')throw Object.assign(Error('Synthetic purchase timed out; outcome unknown'),{code:'ETIMEDOUT',statusCode:504,telegramIncidentHandled:true});if(mode==='provider-rejection')throw Object.assign(Error('Synthetic provider rejected credentials'),{providerCode:'20003',providerStatus:401,statusCode:502,telegramIncidentHandled:true});return{twilioSid:'PN'+'1'.repeat(32),twilioPhoneNumber:'+12895550123'};},
  signupNumberSearchTracker:{record(){}},
  safelyRecordSignupBug:record,runtimeBugStage:journal.runtimeBugStage,shouldCaptureRuntimeBug:journal.shouldCaptureRuntimeBug,
  safelyNotifyRuntimeFailure:()=>{counts.incidents++;},sanitizeMakeFailureEnvelope,
  app:{post:(_path,...all)=>{handlers=all;},use:fn=>{errorHandler=fn;}},asyncRoute:fn=>fn,
 };
 vm.createContext(ctx);vm.runInContext(integrationKeyGuard+'\n'+auth+'\n'+loader+'\n'+route+'\n'+runtimeArea+'\n'+errors,ctx);
 const defaultBody={areaCode:payload.provisioning.preferredAreaCode,region:payload.provisioning.preferredRegion,provisioning:payload.provisioning};
 return {db,target,payload,ctx,counts,captures,traceEvents,handlers:()=>handlers,errorHandler:()=>errorHandler,defaultBody,path,
  limiter:(rateLimitFactory)=>{ctx.rateLimit=rateLimitFactory||require('express-rate-limit').rateLimit;return vm.runInContext(limiter+'\nprovisioningRequestProcessRateLimiter',ctx);},
  settle:()=>Promise.all(captures),
  async run({body=defaultBody,query={},headers={'x-myaipa-integration-key':'synthetic-connection-key'}}={}){
   const req={method:'POST',path,route:{path},query,headers,body};let status,response;
   const res={status(value){status=value;return this;},json(value){response=value;return this;}};
   try{let pass=false;handlers[0](req,res,()=>{pass=true;});if(pass){pass=false;handlers[1](req,res,()=>{pass=true;});if(pass)await handlers[2](req,res);}}
   catch(error){error.telegramIncidentHandled=true;errorHandler(error,req,res,()=>{});}
   await Promise.all(captures);return {req,status,response};
  }};
}
module.exports={fixture,path};
