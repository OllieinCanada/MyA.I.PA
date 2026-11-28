'use strict';
// Real owned-loopback HTTP, actual source middleware/handlers. Memory databases
// and fake provider callbacks only; no production server startup or SQL proof.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const load=process.env.PURCHASE_TRANSPORT_APPROVED_NODE_MODULES
 ?require('node:module').createRequire(path.join(path.dirname(fs.realpathSync(process.env.PURCHASE_TRANSPORT_APPROVED_NODE_MODULES)),'package.json')):require;
const express=load('express'),rateLimit=load('express-rate-limit').rateLimit;
const {fixture}=require('./helpers/provisioning-error-route-fixture');
const {create,wire}=require('./helpers/purchase-transport-fixture');
const {createProvisioningRequestTrace,proofFingerprint,signupFingerprint}=require('../server/provisioningRequestTrace');
const source=fs.readFileSync(require.resolve('../server/index'),'utf8').replace(/\r\n/g,'\n');
test('database-independent traces on real local HTTP',{timeout:45000},async t=>{
 assert.equal(load('express/package.json').version,'4.22.3');
 const guard=require('../scripts/local-staging-egress').install(),servers=new Set();
 t.after(()=>{assert.equal(servers.size,0);assert.equal(guard.status().unexpectedOutboundAttempts,0);});
 async function boot(t,{f=fixture(),write,operation='purchase'}={}){
  const events=[],trace=createProvisioningRequestTrace({write:event=>{events.push(event);if(write)return write(event);}});f.ctx.provisioningRequestTrace=trace;
  let route=f.path,handlers=f.handlers();
  if(operation!=='purchase'){
   route='/api/integrations/vapi/'+(operation==='assistant'?'create-signup-assistant':'import-twilio-number');
   const start=source.indexOf('app.post(\n  "'+route+'",'),end=source.indexOf('\napp.post(',start+1);assert.ok(start>0&&end>start);
   f.ctx.app={post:(_path,...all)=>{handlers=all;}};f.ctx.normalizeVapiImportPhone=v=>v;f.ctx.requireCompletedProvisioningStage=async()=>{};
   f.ctx.createSignupVapiAssistant=async()=>{throw Object.assign(Error('private upstream secret'),{code:'ETIMEDOUT',statusCode:504,telegramIncidentHandled:true});};
   f.ctx.importTwilioPhoneNumberToVapi=async()=>{throw Object.assign(Error('private import secret'),{code:'P2028',statusCode:503,telegramIncidentHandled:true});};
   f.ctx.reconcileVapiPhoneNumberImport=async()=>null;
   vm.runInContext(source.slice(start,end),f.ctx);
  }
  const app=express();app.use(trace.middleware);app.use(express.json({limit:'8kb'}));app.use(route,f.limiter(rateLimit));
  app.post(route,handlers[0],handlers[1],(req,res,next)=>Promise.resolve(handlers[2](req,res)).catch(next));app.use(f.errorHandler());
  const server=require('node:http').createServer(app);servers.add(server);
  t.after(async()=>{server.closeAllConnections();if(server.listening)await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));servers.delete(server);});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});guard.allowPort(server.address().port);
  const origin='http://127.0.0.1:'+server.address().port;
  async function send({body,headers,signal,raw}={}){
   const payload=body||{...f.defaultBody,assignedPhone:'+12895550123',twilioPhoneNumber:'+12895550123',assistantId:'fake-assistant'};
   const r=await fetch(origin+route,{method:'POST',headers:{'content-type':'application/json','x-myaipa-integration-key':'synthetic-connection-key',...headers},body:raw??JSON.stringify(payload),signal});
   return {status:r.status,traceId:r.headers.get('x-myaipa-provisioning-trace'),body:await r.json()};
  }
  return {f,trace,events,send,origin,route};
 }
 await t.test('actual middleware is installed before compression rejection and every body parser',()=>{
  const at=source.indexOf('app.use(provisioningRequestTrace.middleware)');assert.ok(at>0);
  assert.ok(at<source.indexOf('app.use(rejectCompressedRequests)'));assert.ok(at<source.indexOf('app.use(express.json('));
 });
 await t.test('success links only verified context; request bodies and spoofed IDs never reach logs',async t=>{
  const h=await boot(t),r=await h.send({headers:{'x-myaipa-provisioning-trace':'caller-spoof-id'}});
  assert.equal(r.status,201);assert.match(r.traceId,/^[a-f0-9-]{36}$/);assert.equal(h.f.counts.purchases,1);
  assert.equal(h.events[0].signupIdentityVerified,false);assert.equal(h.events.at(-1).signupHash,signupFingerprint(h.f.target.attemptId));
  assert.equal(h.events.at(-1).statusCode,201);assert.ok(h.events.some(e=>e.lastCheckpoint==='provider_dispatch_completed'));
  assert.doesNotMatch(JSON.stringify(h.events),/synthetic-connection-key|synthetic-signing-secret|ownerEmail|ownerPhone|caller-spoof-id|authorizationToken|@/);
 });
 await t.test('wrong key records exact refusal before DB auth-capture and makes no claim',async t=>{
  const h=await boot(t),r=await h.send({headers:{'x-myaipa-integration-key':'private-wrong-key'}});
  assert.equal(r.status,401);assert.equal(h.f.counts.purchases,0);assert.equal(h.f.counts.claims,0);
  assert.equal(h.events.find(e=>e.phase==='failed').code,'PROVISIONING_AUTH_INVALID');assert.equal(h.events.at(-1).signupHash,null);
 });
 await t.test('bad signature correlates as unverified, never as a confirmed signup',async t=>{
  const h=await boot(t),proof={...h.f.payload.provisioning,authorizationToken:'f'.repeat(64)};
  const handoff=h.trace.startHandoff(h.f.target.attemptId,proof);handoff.finish(200);
  const r=await h.send({body:{...h.f.defaultBody,provisioning:proof,signupAttemptId:h.f.target.attemptId}});assert.equal(r.status,401);
  const failure=h.events.find(e=>e.phase==='failed');assert.equal(failure.code,'PROVISIONING_AUTHORIZATION_INVALID');
  assert.equal(failure.proofHash,h.events[0].proofHash);assert.equal(failure.signatureVerified,false);assert.equal(failure.signupIdentityVerified,false);
 });
 await t.test('malformed JSON logs parser rejection before auth and preserves no body text',async t=>{
  const h=await boot(t),r=await h.send({raw:'{"ownerEmail":"private-canary@example.invalid",'});assert.equal(r.status,400);
  assert.equal(h.events.find(e=>e.phase==='failed').code,'INVALID_JSON');assert.equal(h.f.captures.length,0);assert.equal(h.f.counts.claims,0);
  assert.doesNotMatch(JSON.stringify(h.events),/private-canary|ownerEmail/);
 });
 await t.test('P2028 is logged before a never-resolving diagnosis save; abort never implies success',async t=>{
  let observed,enteredSave,saveStarted=0;const failed=new Promise(r=>{observed=r;}),saving=new Promise(r=>{enteredSave=r;});
  const h=await boot(t,{write:event=>{if(event.phase==='failed')observed(event);}});
  h.f.ctx.loadSignupProvisioningContextForAttempt=async()=>{throw Object.assign(Error('private SQL/token'),{code:'P2028'});};
  h.f.ctx.safelyRecordSignupBug=()=>{saveStarted++;assert.ok(h.events.some(e=>e.phase==='failed'&&e.code==='P2028'));enteredSave();return new Promise(()=>{});};
  const controller=new AbortController(),pending=h.send({signal:controller.signal}),settled=pending.then(r=>({r}),e=>({e}));
  const event=await failed;assert.equal(event.code,'P2028');assert.equal(event.lastCheckpoint,'context_load_started');assert.equal(event.signupHash,null);
  await saving;assert.equal(saveStarted,1);assert.equal(h.f.counts.claims,0);assert.equal(h.f.counts.purchases,0);
  controller.abort();assert.equal((await settled).e?.name,'AbortError');
 });
 await t.test('known purchase timeout remains one uncertain fake dispatch, not a retry',async t=>{
  const h=await boot(t,{f:fixture('timeout')}),r=await h.send();assert.equal(r.status,504);assert.equal(r.body.code,'ETIMEDOUT');assert.equal(h.f.counts.purchases,1);
  const e=h.events.find(e=>e.phase==='failed');assert.equal(e.code,'ETIMEDOUT');assert.equal(e.lastCheckpoint,'provider_dispatch_started');assert.equal(e.signupIdentityVerified,true);
 });
 for(const [fault,checkpoint] of [['pool','context_transaction_wait'],['lock','context_lock_wait'],['before-commit','context_update_completed'],['after-commit','context_update_completed']]) {
  await t.test('actual context loader retains precise '+fault+' checkpoint without a provider claim',async t=>{
   const f=create(),h=await boot(t,{f});f.shared.fault=fault;const input=wire(f,'json'),r=await h.send({raw:input.body,headers:input.headers});assert.equal(r.status,500);
   const error=h.events.find(e=>e.phase==='failed');assert.equal(error.code,fault==='pool'?'P2024':'P2028');assert.equal(error.lastCheckpoint,checkpoint);
   assert.equal(error.signatureVerified,true);assert.equal(error.signupIdentityVerified,false);assert.equal(f.shared.providerCalls.length,0);assert.equal(f.shared.claimCalls,0);
   // A lost commit acknowledgement can leave the context locked. No trace
   // event grants replay or converts "write returned" into commit evidence.
   if(fault==='after-commit')assert.ok(f.shared.contexts.get(f.key).lockedAt);
  });
 }
 for(const operation of ['assistant','import'])await t.test('actual '+operation+' callback retains provider failure in an independent trace',async t=>{
  const h=await boot(t,{operation}),r=await h.send();assert.equal(r.status,operation==='assistant'?504:503);assert.equal(h.f.counts.purchases,0);
  const error=h.events.find(e=>e.phase==='failed');assert.equal(error.code,operation==='assistant'?'ETIMEDOUT':'P2028');assert.equal(error.lastCheckpoint,'provider_dispatch_started');assert.equal(error.signupIdentityVerified,true);
  assert.doesNotMatch(JSON.stringify(h.events),/private upstream|private import/);
 });
 await t.test('logger failure cannot change successful purchase response or increase dispatch count',async t=>{
  const h=await boot(t,{write:()=>{throw Error('private logger failure');}}),r=await h.send();assert.equal(r.status,201);assert.equal(h.f.counts.purchases,1);
 });
 await t.test('duplicate completion reuses actual receipt while retaining distinct request trace IDs',async t=>{
  const f=create(),h=await boot(t,{f}),input=wire(f,'json');
  const a=await h.send({raw:input.body,headers:input.headers}),b=await h.send({raw:input.body,headers:input.headers});
  assert.equal(a.status,201);assert.equal(b.status,200);assert.equal(b.body.reused,true);assert.notEqual(a.traceId,b.traceId);assert.equal(f.shared.providerCalls.length,1);
  const finishes=h.events.filter(e=>e.phase==='finished');assert.equal(finishes.length,2);assert.equal(finishes[0].proofHash,finishes[1].proofHash);assert.equal(finishes[0].proofHash,proofFingerprint(f.payload.provisioning));
 });
 await t.test('process-limiter refusal is traced without additional auth DB capture',async t=>{
  const h=await boot(t);for(let i=0;i<31;i++)assert.equal((await h.send({headers:{'x-myaipa-integration-key':'bad'}})).status,401);
  assert.equal(h.events.filter(e=>e.phase==='failed').length,31);assert.equal(h.f.captures.length,1);assert.equal(h.f.counts.claims,0);
 });
 await t.test('transport instrumentation rejects non-owned network targets',async()=>{const r=await guard.probes();assert.equal(r.rejected,6);assert.equal(r.unexpectedOutboundAttempts,0);});
});
