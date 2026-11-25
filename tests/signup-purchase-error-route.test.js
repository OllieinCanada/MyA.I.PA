'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./helpers/provisioning-error-route-fixture');
const {listSignupBugs}=require('../server/signupBugHistory');
const history=f=>listSignupBugs({prisma:f.db.prisma,listSignups:f.db.listSignups});
test('actual key and signature guards preserve rejection and never admit or attribute forged signup IDs',async()=>{
 for(const which of ['key','signature','malformed','missing-key-config','missing-signing-config']){
  const f=fixture();const options={};
  if(which==='key')options.headers={'x-myaipa-integration-key':'untrusted-key'};
  if(which==='signature')options.body={...f.defaultBody,signupAttemptId:f.target.attemptId,provisioning:{...f.payload.provisioning,authorizationToken:'f'.repeat(64)}};
  if(which==='malformed')options.body={signupAttemptId:f.target.attemptId,provisioning:{idempotencyKey:'malformed'}};
  if(which==='missing-key-config'){f.ctx.INTEGRATION_API_KEY='';f.ctx.getMakeSignupWebhookConfig=()=>({apiKey:''});options.headers={};}
  if(which==='missing-signing-config')f.ctx.process.env={};
  const result=await f.run(options);assert.equal(result.status,which.startsWith('missing-')?503:401);
  assert.equal(f.counts.claims,0);assert.equal(f.counts.purchases,0);assert.equal(result.req.signupProvisioningAttemptId,undefined);
  const saved=await history(f);assert.equal(saved.events.length,1);assert.equal(saved.events[0].stage,'authorization');assert.equal(saved.events[0].signupAttemptId,null);
  assert.equal(saved.events[0].provisioningFailure.phase,which==='key'||which==='missing-key-config'?'key-auth':'signature-auth');
  assert.equal(saved.events[0].provisioningFailure.contextHash,null);assert.equal(saved.events[0].provisioningFailure.requestOutcome,'request_not_dispatched');
  assert.doesNotMatch(JSON.stringify(saved),/untrusted-key|synthetic-connection-key|synthetic-signing-secret|ffffffffffffffff/);
 }
});
test('actual purchase preflight records original trusted context and refuses changed preference before purchase',async()=>{
 const f=fixture(),result=await f.run({body:{...f.defaultBody,areaCode:'999'}});
 assert.equal(result.status,409);assert.equal(result.response.code,'PROVISIONING_INVENTORY_CONTEXT_MISMATCH');assert.equal(f.counts.purchases,0);assert.equal(f.counts.claims,0);
 const e=(await history(f)).events[0];assert.equal(e.signupAttemptId,f.target.attemptId);assert.equal(e.provisioningFailure.phase,'preference');assert.equal(e.provisioningFailure.contextHash,f.payload.provisioning.contextHash);assert.equal(e.provisioningFailure.requestOutcome,'request_not_dispatched');
});
test('all existing accepted connection-key forms still require the signed request and admit it unchanged',async()=>{
 for(const headers of [{'x-myaipa-integration-key':'synthetic-connection-key'},{'x-vapi-secret':'synthetic-connection-key'},{'x-api-key':'synthetic-connection-key'},{authorization:'Bearer synthetic-connection-key'},{'x-make-apikey':'synthetic-make-key'},{'x-make-webhook-token':'synthetic-webhook-token'}]){
  const f=fixture();f.ctx.getMakeSignupWebhookToken=()=> 'synthetic-webhook-token';const result=await f.run({headers});assert.equal(result.status,201);assert.equal(f.counts.purchases,1);assert.equal(f.captures.length,0);
 }
});
test('database claim failure is captured as uncertain, never dispatched or retried',async()=>{
 const f=fixture();let claims=0;f.ctx.runProvisioningStep=async()=>{claims++;throw Object.assign(Error('Synthetic database transaction expired'),{code:'P2028',statusCode:503});};
 const result=await f.run(),event=(await history(f)).events[0];assert.equal(result.response.code,'P2028');assert.equal(result.status,503);assert.equal(event.provisioningFailure.phase,'claim');assert.equal(event.provisioningFailure.requestOutcome,'uncertain_inspect_receipts');assert.equal(f.counts.purchases,0);assert.equal(claims,1);
});
test('missing context stays unlinked; closed verified signup captures exact refusal without provisioning',async()=>{
 for(const mode of ['missing-context','closed']){const f=fixture(mode),r=await f.run(),e=(await history(f)).events[0];
  assert.equal(r.response.code,mode==='closed'?'SIGNUP_CLOSED':'PROVISIONING_CONTEXT_NOT_REGISTERED');assert.equal(f.counts.purchases,0);assert.equal(f.counts.claims,0);assert.equal(e.provisioningFailure.phase,'context');assert.equal(e.signupAttemptId,mode==='closed'?f.target.attemptId:null);
 }
});
test('provider rejection and timeout preserve error/status and uncertain outcome without a second dispatch',async()=>{
 for(const [mode,code]of [['timeout','ETIMEDOUT'],['provider-rejection','20003']]){
  const f=fixture(mode),r=await f.run(),e=(await history(f)).events[0];assert.equal(r.response.code,code);assert.equal(f.counts.purchases,1);assert.equal(f.captures.length,1);assert.equal(e.provisioningFailure.phase,'purchase');assert.equal(e.provisioningFailure.code,code);assert.equal(e.provisioningFailure.requestOutcome,'uncertain_inspect_receipts');assert.equal(e.provisioningFailure.retryAllowed,false);
 }
});
test('diagnostic persistence failure preserves original failure and never triggers a capture or purchase retry',async()=>{
 const f=fixture('timeout');let writes=0;f.ctx.safelyRecordSignupBug=async()=>{writes++;throw Error('unknown journal outcome');};
 const r=await f.run();assert.equal(r.response.code,'ETIMEDOUT');assert.equal(r.status,504);assert.equal(writes,1);assert.equal(f.counts.purchases,1);assert.equal(f.db.rows.size,0);
});
test('unconfirmed diagnostic save is reported without another storage or provider attempt',async()=>{
 const f=fixture('timeout');let writes=0;f.ctx.safelyRecordSignupBug=async()=>{writes++;return{recorded:false,unavailable:true};};
 const result=await f.run();assert.equal(result.status,504);assert.equal(result.response.code,'ETIMEDOUT');assert.equal(f.counts.purchases,1);assert.equal(writes,1);assert.equal(f.counts.warnings,1);
});
test('actual loopback HTTP middleware saves auth refusal unlinked and admitted purchase error under exact signup',async t=>{
 const express=require('express'),f=fixture('timeout'),app=express();app.use(express.json());
 const guards=f.handlers();app.post(f.path,guards[0],guards[1],(req,res,next)=>Promise.resolve(guards[2](req,res)).catch(next));app.use(f.errorHandler());
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});t.after(()=>new Promise(resolve=>server.close(resolve)));
 const url='http://127.0.0.1:'+server.address().port+f.path;
 let r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...f.defaultBody,signupAttemptId:f.target.attemptId})});
 assert.equal(r.status,401);assert.deepEqual(await r.json(),{error:'Invalid provisioning key.'});await f.settle();assert.equal(f.counts.purchases,0);
 r=await fetch(url,{method:'POST',headers:{'content-type':'application/json','x-myaipa-integration-key':'synthetic-connection-key'},body:JSON.stringify(f.defaultBody)});
 assert.equal(r.status,504);assert.equal((await r.json()).code,'ETIMEDOUT');await f.settle();
 const saved=await history(f);assert.equal(saved.events.length,2);assert.equal(saved.events.find(e=>e.stage==='authorization').signupAttemptId,null);assert.equal(saved.events.find(e=>e.stage==='purchase').signupAttemptId,f.target.attemptId);assert.equal(f.counts.purchases,1);
});

test('actual failed-auth limiter preserves refusals and cannot starve a valid signed request from the same IP',async t=>{
 const source=require('node:fs').readFileSync(require.resolve('../server/index'),'utf8');
 assert.ok(source.indexOf('], provisioningRequestProcessRateLimiter);')>source.indexOf('app.use(express.json({ limit: JSON_BODY_LIMIT }));'),'Real app must parse body-carried proof before deciding whether a valid request consumes the failed-auth budget');
 const express=require('express'),f=fixture(),app=express(),guards=f.handlers();app.use(express.json());
 const limiter=f.limiter();app.use(f.path,limiter);
 app.post(f.path,guards[0],guards[1],(req,res,next)=>Promise.resolve(guards[2](req,res)).catch(next));app.use(f.errorHandler());
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});t.after(()=>new Promise(resolve=>server.close(resolve)));
 const url='http://127.0.0.1:'+server.address().port+f.path;
 for(let i=0;i<32;i++){const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(f.defaultBody)});assert.equal(r.status,401);assert.deepEqual(await r.json(),{error:'Invalid provisioning key.'});}
 assert.equal(f.counts.claims,0);assert.equal(f.counts.purchases,0);await f.settle();assert.equal((await history(f)).events.length,1);
 const headers={'content-type':'application/json','x-myaipa-integration-key':'synthetic-connection-key'};
 let r=await fetch(url,{method:'POST',headers,body:JSON.stringify(f.defaultBody)});assert.equal(r.status,201);assert.equal(f.counts.purchases,1);
 r=await fetch(url,{method:'POST',headers,body:JSON.stringify({...f.defaultBody,provisioning:{...f.payload.provisioning,authorizationToken:'f'.repeat(64)}})});
 assert.equal(r.status,401);assert.deepEqual(await r.json(),{error:'Invalid signed provisioning request.'});assert.equal(f.counts.purchases,1);
 f.ctx.process.env={};r=await fetch(url,{method:'POST',headers,body:JSON.stringify(f.defaultBody)});
 assert.equal(r.status,503);assert.deepEqual(await r.json(),{error:'Provisioning request signing is not configured.'});assert.equal(f.counts.purchases,1);
 f.ctx.INTEGRATION_API_KEY='';f.ctx.getMakeSignupWebhookConfig=()=>({apiKey:''});
 r=await fetch(url,{method:'POST',headers,body:JSON.stringify(f.defaultBody)});assert.equal(r.status,503);assert.deepEqual(await r.json(),{error:'Provisioning authentication is not configured.'});
});
test('real claim algorithm with actual purchase route prevents concurrent and restarted duplicate purchases',async()=>{
 const {memoryDb}=require('./helpers/twilio-status-memory-db'),{runProvisioningStep}=require('../server/provisioningState');
 const db=memoryDb(),first=fixture();first.ctx.runProvisioningStep=options=>runProvisioningStep({...options,prisma:db.prisma});
 let release,entered;const started=new Promise(r=>{entered=r;}),held=new Promise(r=>{release=r;});
 first.ctx.purchaseTwilioPhoneNumber=async()=>{first.counts.purchases++;entered();await held;return{twilioSid:'PN'+'1'.repeat(32),twilioPhoneNumber:'+12895550123'};};
 const pending=first.run();await started;const concurrent=await first.run();assert.equal(concurrent.status,409);assert.equal(first.counts.purchases,1);release();assert.equal((await pending).status,201);
 const restarted=fixture();restarted.ctx.runProvisioningStep=options=>runProvisioningStep({...options,prisma:db.prisma});assert.equal((await restarted.run()).status,200);assert.equal(restarted.counts.purchases,0);
});
test('restarted actual purchase route refuses blind replacement after timeout with no completed receipt',async()=>{
 const {memoryDb}=require('./helpers/twilio-status-memory-db'),{runProvisioningStep}=require('../server/provisioningState');
 const db=memoryDb(),first=fixture('timeout');first.ctx.runProvisioningStep=options=>runProvisioningStep({...options,prisma:db.prisma});assert.equal((await first.run()).response.code,'ETIMEDOUT');
 const restarted=fixture();restarted.ctx.runProvisioningStep=options=>runProvisioningStep({...options,prisma:db.prisma});const r=await restarted.run();assert.equal(r.response.code,'PROVISIONING_RECONCILIATION_REQUIRED');assert.equal(restarted.counts.purchases,0);assert.equal([...db.rows.values()][0].data.originalErrorCode,'ETIMEDOUT');
});
