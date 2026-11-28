'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {createProvisioningRequestTrace,proofFingerprint,signupFingerprint,safeError}=require('../server/provisioningRequestTrace');
const proof={idempotencyKey:'a'.repeat(64),contextHash:'b'.repeat(64),authorizationToken:'secret-token-not-logged'};
const id='signup_'+'c'.repeat(32),route='/api/integrations/twilio/purchase-number';
function request(path=route){return Object.assign(new EventEmitter(),{path,method:'POST',query:proof,
 headers:{'x-myaipa-integration-key':'private-key','x-provisioning-token':proof.authorizationToken},body:{ownerEmail:'private@example.invalid',signupAttemptId:id}});}
function response(){return Object.assign(new EventEmitter(),{headers:{},statusCode:200,writableFinished:false,setHeader(k,v){this.headers[k]=v;}});}
test('fingerprints are bounded, domain-separated and exclude all credentials',()=>{
 assert.match(proofFingerprint(proof),/^[a-f0-9]{64}$/);assert.equal(proofFingerprint({...proof,authorizationToken:'changed'}),proofFingerprint(proof));
 assert.equal(proofFingerprint({...proof,idempotencyKey:['a'.repeat(64)]}),null);assert.equal(proofFingerprint({...proof,contextHash:'x'.repeat(10000)}),null);
 assert.notEqual(signupFingerprint(id),proofFingerprint(proof));assert.equal(signupFingerprint('private@example.invalid'),null);
 assert.equal(proofFingerprint({get idempotencyKey(){throw Error('private');}}),null);
});
test('early arrival is untrusted; only signed proof plus explicit server binding links a signup',()=>{
 const events=[],trace=createProvisioningRequestTrace({write:e=>events.push(e),now:()=>100,getRelease:()=> 'd'.repeat(40)}),req=request(),res=response();let next=0;
 trace.middleware(req,res,()=>next++);assert.equal(next,1);assert.equal(events[0].phase,'received');assert.equal(events[0].signatureVerified,false);assert.equal(events[0].signupHash,null);
 trace.bindSignup(req,id);assert.equal(events.length,1);trace.verifiedProof(req,proof);trace.bindSignup(req,id);
 assert.equal(events.at(-1).signupHash,signupFingerprint(id));assert.equal(events.at(-1).signupIdentityVerified,true);
 assert.match(res.headers['X-MyAIPA-Provisioning-Trace'],/^[a-f0-9-]{36}$/);
 assert.doesNotMatch(JSON.stringify(events),/secret-token|private-key|private@example|authorizationToken|signup_cccc|aaaaaaaaaaaaaaaa|bbbbbbbbbbbbbbbb/);
});
test('context timeout is emitted immediately even when the database journal never resolves',async()=>{
 const events=[],trace=createProvisioningRequestTrace({write:e=>events.push(e)}),req=request(),res=response();trace.middleware(req,res,()=>{});trace.verifiedProof(req,proof);
 const error=Object.assign(Error('private SQL query and token'),{code:'P2028'});
 await assert.rejects(trace.step(req,'context_load',async()=>{throw error;}),e=>e===error);
 assert.equal(events.at(-1).phase,'failed');assert.equal(events.at(-1).lastCheckpoint,'context_load_started');assert.equal(events.at(-1).code,'P2028');
 const count=events.length;trace.failure(req,error);assert.equal(events.length,count);assert.equal(events.at(-1).signupIdentityVerified,false);
});
test('claim failure and loss after provider return have different last checkpoints',async()=>{
 for(const afterProvider of [false,true]){
  const events=[],trace=createProvisioningRequestTrace({write:e=>events.push(e)}),req=request();trace.middleware(req,response(),()=>{});
  await assert.rejects(trace.step(req,'provisioning_step',async()=>{if(afterProvider)await trace.step(req,'provider_dispatch',async()=>({simulated:true}));throw Object.assign(Error('private'),{code:'P2028'});}));
  assert.equal(events.at(-1).lastCheckpoint,afterProvider?'provider_dispatch_completed':'provisioning_step_started');
 }
});
test('internal context checkpoints only update memory until failure; no logging is added inside a transaction',async()=>{
 const events=[],trace=createProvisioningRequestTrace({write:e=>events.push(e)}),req=request();trace.middleware(req,response(),()=>{});
 await assert.rejects(trace.step(req,'context_load',async()=>{
  const count=events.length;trace.contextCheckpoint(req,'context_lock_wait');trace.contextCheckpoint(req,'private input');assert.equal(events.length,count);
  throw Object.assign(Error('private'),{code:'P2028'});
 }));
 assert.equal(events.at(-1).lastCheckpoint,'context_lock_wait');assert.equal(events.at(-1).code,'P2028');
});
test('failed context observers cannot change transaction results or introduce another write',async()=>{
 const {create}=require('./helpers/purchase-transport-fixture');
 for(const trace of [()=>{throw Error('private observer');},()=>Promise.reject(Error('private observer'))]){
  const f=create(),proof=f.payload.provisioning;
  const result=await f.ctx.loadSignupProvisioningContextForAttempt({idempotencyKey:proof.idempotencyKey,contextHash:proof.contextHash,trace});
  assert.equal(result.eventKey,f.target.attemptId);assert.ok(f.shared.contexts.get(f.key).lockedAt);assert.equal(f.shared.claimCalls,0);assert.equal(f.shared.providerCalls.length,0);
 }
});
test('a disconnected response is never logged as HTTP 200; late failure is retained',async()=>{
 const events=[],trace=createProvisioningRequestTrace({write:e=>events.push(e)}),req=request(),res=response();trace.middleware(req,res,()=>{});
 res.emit('close');req.emit('aborted');assert.equal(events.filter(e=>e.phase==='closed_before_response').length,1);
 assert.equal(Object.hasOwn(events.at(-1),'statusCode'),false);assert.equal(req.listenerCount('aborted'),0);assert.equal(res.listenerCount('finish'),0);
 await assert.rejects(trace.step(req,'provider_dispatch',async()=>{throw Object.assign(Error('private'),{code:'ETIMEDOUT'});}));
 assert.equal(events.at(-1).code,'ETIMEDOUT');assert.equal(events.filter(e=>e.phase==='failed').length,1);
});
test('finish/close produce one completion with the real status and bounded time',()=>{
 let time=100;const events=[],trace=createProvisioningRequestTrace({write:e=>events.push(e),now:()=>time}),req=request(),res=response();trace.middleware(req,res,()=>{});
 time+=10000000;res.statusCode=401;res.writableFinished=true;res.emit('finish');res.emit('close');
 assert.equal(events.length,2);assert.equal(events.at(-1).statusCode,401);assert.equal(events.at(-1).elapsedMs,3600000);
});
test('writer exceptions/rejections do not reject work, change errors or retry anything',async()=>{
 for(const write of [()=>{throw Error('private');},()=>Promise.reject(Error('private'))]){
  const trace=createProvisioningRequestTrace({write,getRelease:()=>{throw Error('private');}}),req=request(),res=response();let calls=0;trace.middleware(req,res,()=>calls++);
  assert.equal(calls,1);assert.equal(await trace.step(req,'provider_dispatch',()=>42),42);
  const original=Object.assign(Error('original'),{code:'P2028'});await assert.rejects(trace.step(req,'context_load',()=>{throw original;}),e=>e===original);res.emit('close');
 }
});
test('only fixed routes and bounded event names are traced, including Express case/slash variants',()=>{
 const events=[],trace=createProvisioningRequestTrace({write:e=>events.push(e)});let next=0;
 trace.middleware(request('/api/admin/signups'),response(),()=>next++);assert.equal(events.length,0);
 const req=request(route.toUpperCase()+'/');trace.middleware(req,response(),()=>next++);assert.equal(events[0].route,route);
 trace.checkpoint(req,'private-caller-label');trace.checkpoint(req,'connection_verified');trace.checkpoint(req,'connection_verified');assert.equal(events.length,2);assert.equal(next,2);
});
test('sampling has a fixed process-wide ceiling and reports a coverage gap',()=>{
 let time=1000;const events=[],trace=createProvisioningRequestTrace({write:e=>events.push(e),now:()=>time});
 for(let i=0;i<125;i++)trace.middleware(request(),response(),()=>{});
 assert.equal(events.length,120);time+=60000;trace.middleware(request(),response(),()=>{});
 assert.equal(events[120].phase,'coverage_gap');assert.equal(events[120].droppedRequests,5);assert.equal(events.length,122);
});
test('outgoing Make handoff fingerprints correlate with unverified callbacks without assuming success',()=>{
 const events=[],trace=createProvisioningRequestTrace({write:e=>events.push(e)}),h=trace.startHandoff(id,proof);h.finish(200);h.failure(Error('late'));h.finish(500);
 const req=request();trace.middleware(req,response(),()=>{});assert.equal(events.length,3);
 assert.equal(events[0].proofHash,events[2].proofHash);assert.equal(events[0].signupHash,signupFingerprint(id));assert.equal(events[2].signupHash,null);
 assert.equal(events[1].phase,'response_received');assert.equal(events[1].statusCode,200);assert.equal(Object.hasOwn(events[1],'success'),false);
});
test('errors retain only fixed codes and numeric status, never arbitrary message/stack/SQL',()=>{
 const secret='do-not-print-this-key';assert.deepEqual(safeError({code:secret,message:secret,stack:secret,providerStatus:401}),{code:'UNCLASSIFIED',providerStatus:401});
 assert.deepEqual(safeError({code:'P2028',providerStatus:'401'}),{code:'P2028',providerStatus:null});
 assert.deepEqual(safeError({type:'entity.parse.failed',message:secret}),{code:'INVALID_JSON',providerStatus:null});
 assert.deepEqual(safeError({get code(){throw Error(secret);}}),{code:'UNCLASSIFIED',providerStatus:null});
});
