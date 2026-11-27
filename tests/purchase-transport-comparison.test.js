'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {FORMATS,create,request,receipt}=require('./helpers/purchase-transport-fixture');
const {listSignupBugs}=require('../server/signupBugHistory');
let attemptedNetwork=0;const restore=[];
test.before(()=>{const block=(o,k)=>{const fn=o[k];o[k]=()=>{attemptedNetwork++;throw Error('TRANSPORT_COMPARISON_HAS_NO_NETWORK');};restore.push(()=>{o[k]=fn;});};block(globalThis,'fetch');for(const n of ['node:http','node:https']){block(require(n),'request');block(require(n),'get');}block(require('node:net').Socket.prototype,'connect');block(require('node:tls'),'connect');});
test.after(()=>{for(const r of restore.reverse())r();assert.equal(attemptedNetwork,0);});
test('both representations deliver exactly the same whitelisted fake purchase inputs',async()=>{
 const results=[];for(const format of FORMATS){const f=create(),r=await f.run(request(f,format));assert.equal(r.status,201);assert.equal(r.response.ok,true);assert.equal(f.shared.providerCalls.length,1);assert.ok(f.shared.contexts.get(f.key).lockedAt);assert.equal(receipt(f).data.status,'completed');results.push({input:f.shared.providerCalls[0],result:structuredClone(r.response)});}
 assert.deepEqual(results[0],results[1]);
});
test('JSON package contains only preferences and signed context selectors; credentials remain headers',()=>{
 const f=create(),r=request(f,'json');assert.deepEqual(r.query,{});assert.deepEqual(Object.keys(r.body).sort(),['areaCode','provisioning','region','voiceMethod','voiceUrl']);assert.deepEqual(Object.keys(r.body.provisioning).sort(),['contextHash','idempotencyKey']);assert.doesNotMatch(JSON.stringify(r.body),/synthetic-connection-key|synthetic-signing-secret|authorizationToken|owner|businessName|email|signup_/);
});
for(const format of FORMATS){
 for(const mode of ['missing-key','wrong-key','missing-token','wrong-token','missing-id','missing-hash'])test(format+' rejects '+mode+' before context locking or fake dispatch',async()=>{
  const f=create(),r=request(f,format),proof=format==='json'?r.body.provisioning:r.query;
  if(mode==='missing-key')delete r.headers['x-myaipa-integration-key'];if(mode==='wrong-key')r.headers['x-myaipa-integration-key']='untrusted';if(mode==='missing-token')delete r.headers['x-provisioning-token'];if(mode==='wrong-token')r.headers['x-provisioning-token']='f'.repeat(64);if(mode==='missing-id')delete proof.idempotencyKey;if(mode==='missing-hash')delete proof.contextHash;
  const out=await f.run(r);assert.equal(out.status,401);assert.equal(f.shared.providerCalls.length,0);assert.equal(f.shared.claimCalls,0);assert.equal(f.shared.contexts.get(f.key).lockedAt,undefined);
 });
 for(const field of ['areaCode','region'])test(format+' rejects changed '+field+' despite otherwise valid signature',async()=>{
  const f=create(),r=request(f,format);(format==='json'?r.body:r.query)[field]='changed';const out=await f.run(r);assert.equal(out.status,409);assert.equal(out.response.code,'PROVISIONING_INVENTORY_CONTEXT_MISMATCH');assert.equal(f.shared.providerCalls.length,0);assert.equal(f.shared.claimCalls,0);
 });
 test(format+' refuses missing context rather than inventing a replacement',async()=>{
  const f=create();f.shared.contexts.delete(f.key);const out=await f.run(request(f,format));assert.equal(out.status,401);assert.equal(out.response.code,'PROVISIONING_CONTEXT_NOT_REGISTERED');assert.equal(f.shared.providerCalls.length,0);assert.equal(f.shared.contexts.size,0);
 });
 test(format+' refuses changed saved context and does not attribute a forged signup ID',async()=>{
  const f=create(),r=request(f,format);f.shared.contexts.get(f.key).contextHash='b'.repeat(64);r.body.signupAttemptId='signup_'+'f'.repeat(32);const out=await f.run(r);assert.equal(out.status,401);assert.equal(f.shared.providerCalls.length,0);assert.equal(out.req.signupProvisioningAttemptId,undefined);
 });
 for(const fault of ['pool','lock','before-commit','after-commit'])test(format+' preserves '+fault+' failure without fake provider work',async()=>{
  const f=create();f.shared.fault=fault;const out=await f.run(request(f,format));assert.equal(out.status,500);assert.equal(out.response.code,fault==='pool'?'P2024':'P2028');assert.equal(f.shared.providerCalls.length,0);assert.equal(f.shared.claimCalls,0);assert.equal(!!f.shared.contexts.get(f.key).lockedAt,fault==='after-commit');
 });
 test(format+' refuses invalid JSON-context proof before any mock purchase',async()=>{
  const f=create(),r=request(f,format);const proof=format==='json'?r.body.provisioning:r.query;proof.contextHash='g'.repeat(64);const out=await f.run(r);assert.equal(out.status,401);assert.equal(f.shared.providerCalls.length,0);
 });
}
for(const firstFormat of FORMATS){const secondFormat=FORMATS.find(x=>x!==firstFormat);
 test(firstFormat+' → '+secondFormat+' reuses the exact completed receipt after worker reconstruction',async()=>{
  const first=create();assert.equal((await first.run(request(first,firstFormat))).status,201);const saved=structuredClone(receipt(first));const restarted=create({shared:first.shared});const result=await restarted.run(request(restarted,secondFormat));assert.equal(result.status,200);assert.equal(result.response.reused,true);assert.equal(restarted.counts.purchases,0);assert.equal(first.shared.providerCalls.length,1);assert.deepEqual(receipt(restarted),saved);
 });
 test(firstFormat+' and '+secondFormat+' concurrently admit one fake purchase only',async()=>{
  const f=create();let entered,release;const started=new Promise(r=>{entered=r;}),held=new Promise(r=>{release=r;});const original=f.ctx.purchaseTwilioPhoneNumber;f.ctx.purchaseTwilioPhoneNumber=async opts=>{entered();await held;return original(opts);};
  const first=f.run(request(f,firstFormat)),observed=first.then(result=>({result}),error=>({error}));
  const reached=await Promise.race([started.then(()=>true),observed.then(()=>false)]);if(!reached)throw(await observed).error||Error('FAKE_DISPATCH_NOT_ADMITTED');
  try{const concurrent=await f.run(request(f,secondFormat));assert.equal(concurrent.status,409);assert.equal(concurrent.response.code,'PROVISIONING_ALREADY_IN_PROGRESS');}finally{release();await first;}
  assert.equal(f.shared.providerCalls.length,1);assert.equal(receipt(f).data.status,'completed');
 });
 test(firstFormat+' timeout remains inspect-first under '+secondFormat+' after restart',async()=>{
  const f=create({mode:'timeout'}),out=await f.run(request(f,firstFormat));assert.equal(out.response.code,'ETIMEDOUT');assert.equal(f.shared.providerCalls.length,1);const restarted=create({shared:f.shared}),second=await restarted.run(request(restarted,secondFormat));assert.equal(second.response.code,'PROVISIONING_RECONCILIATION_REQUIRED');assert.equal(restarted.counts.purchases,0);assert.equal(f.shared.providerCalls.length,1);assert.equal(receipt(f).data.originalErrorCode,'ETIMEDOUT');assert.ok(receipt(f).data.dispatchStartedAt);
 });
 test(firstFormat+' lost completion acknowledgement preserves receipt under '+secondFormat,async()=>{
  const f=create();f.shared.loseCompletionAck=true;const out=await f.run(request(f,firstFormat));assert.equal(out.response.code,'P2028');assert.equal(f.shared.lostCompletionAck,true);assert.equal(receipt(f).data.status,'completed');const saved=structuredClone(receipt(f));const restarted=create({shared:f.shared});assert.equal((await restarted.run(request(restarted,secondFormat))).status,200);assert.equal(f.shared.providerCalls.length,1);assert.deepEqual(receipt(restarted),saved);
 });
}
test('failure histories do not expose JSON/header credentials or fake contact details',async()=>{
 for(const format of FORMATS){const f=create({mode:'timeout'});await f.run(request(f,format));const saved=await listSignupBugs({prisma:f.db.prisma,listSignups:f.db.listSignups});assert.ok(saved.events.length);assert.doesNotMatch(JSON.stringify(saved),/synthetic-connection-key|synthetic-signing-secret|@private\.example\.invalid|19055550123/);}
});
