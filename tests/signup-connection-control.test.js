'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const express=require('express');
const {fixture,registerFixtureHttp}=require('./helpers/signup-connection-fixture');
const {journalKey}=require('../server/signupConnectionControl');
const {hashOperationalTarget}=require('../server/signupDecommission');
async function f(t,options){const value=await fixture(options);t.after(()=>value.cleanup());return value;}
test('real control preview is no-write; separately approved connection imports once and never saves associations or starts trial',async t=>{
 const x=await f(t),before=x.readStore(),source=await x.prisma.signupAttempt.findUnique({where:{eventKey:x.target.attemptId}}),p=await x.preview();
 assert.equal(p.applyAllowed,false);assert.equal(x.state.imports,0);assert.equal(x.state.fileWrites,0);
 const out=await x.service.execute(x.approve(p),x.auth);assert.equal(out.applied,true);assert.equal(out.ready,false);assert.equal(out.messagesSent,0);
 assert.equal(x.state.imports,1);assert.equal(x.state.fileWrites,0);assert.deepEqual(x.readStore(),before);
 assert.deepEqual(await x.prisma.signupAttempt.findUnique({where:{eventKey:x.target.attemptId}}),source);
 assert.equal((await x.prisma.runtimeStore.findUnique({where:{key:journalKey('connect',x.target)}})).data.phase,'completed');
 await assert.rejects(x.service.execute(x.approve(p),x.auth),/INSPECT_FIRST/);assert.equal(x.state.imports,1);
});
test('association-only stage saves exactly references; original failures/history/eligibility remain unchanged',async t=>{
 const x=await f(t,{imported:true}),before=x.readStore(),p=await x.preview();
 await x.service.execute(x.approve(p),x.auth);assert.equal(x.state.imports,0);assert.equal(x.state.fileWrites,1);
 const row=x.readStore().original;assert.equal(row.status,'setup_error');assert.deepEqual(row.history,before.original.history);
 assert.equal(row.agentTestStatus,'failed');assert.equal(row.trialStartAt,before.original.trialStartAt);assert.deepEqual(x.readStore().other,before.other);
 const db=await x.prisma.signupAttempt.findUnique({where:{eventKey:x.target.attemptId}});assert.equal(db.assignedPhone,x.target.number);assert.equal(db.status,'setup_error');assert.equal(db.lastErrorCode,'SYNTHETIC_OLD_ERROR');
});
for(const [name,change]of[
 ['disabled',x=>x.state.enabled=false],['wrong session',x=>x.state.actor='d'.repeat(64)],['wrong release',x=>x.state.policy.release='d'.repeat(40)],
 ['expired policy',x=>x.state.policy.expiresAt=new Date(x.state.now-1).toISOString()],['client scope extras',x=>x.state.policy.target.send=true],
 ['wrong original row',x=>x.state.policy.target.attemptRowId='differentoriginal']
])test(name+' fails closed without provider mutations or record writes',async t=>{
 const x=await f(t);change(x);await assert.rejects(x.preview());assert.equal(x.state.imports,0);assert.equal(x.state.fileWrites,0);
});
test('apply flag, approval, exact confirmation, source and fresh preview required',async t=>{
 for(const change of [x=>x.state.apply=false,x=>delete x.state.policy.approvedPlanDigest,x=>x.state.now+=60001,
  x=>{const s=x.readStore();s.original.history.push('changed');x.writeFixture(s);}]){
  const x=await f(t),p=await x.preview(),body=x.approve(p);change(x);await assert.rejects(x.service.execute(body,x.auth));assert.equal(x.state.imports,0);
 }
});
test('body cannot substitute target/evidence/token or turn inspect into apply',async t=>{
 const x=await f(t);for(const extra of [{target:x.target},{proof:{}},{authorizationToken:'fixture'}])await assert.rejects(x.service.execute({action:'preview',policyId:x.state.policy.policyId,...extra},x.auth),/REQUEST_INVALID/);
 assert.equal(x.state.imports,0);
});
test('unmanaged/expired accounts cannot be connected or silently given a new trial',async t=>{
 const x=await f(t),store=x.readStore();delete store.original.trialStartAt;delete store.original.trialEndAt;x.writeFixture(store);
 const p=await x.preview();await assert.rejects(x.service.execute(x.approve(p),x.auth),/ACCOUNT_ELIGIBILITY/);assert.equal(x.state.imports,0);assert.equal(x.state.fileWrites,0);
});
test('uncertain import remains blocked after restart even if provider resource and receipt are absent',async t=>{
 const x=await f(t);x.state.lost=true;const p=await x.preview();await assert.rejects(x.service.execute(x.approve(p),x.auth),/INSPECT_FIRST/);
 assert.equal(x.state.imports,1);x.state.phones=[];
 const {provisioningStateKey}=require('../server/provisioningState');await x.prisma.runtimeStore.deleteMany({where:{key:provisioningStateKey('vapi-import',x.target.idempotencyKey)}});
 const second=x.make(),next=await x.preview(second);await assert.rejects(second.execute(x.approve(next),x.auth),/INSPECT_FIRST/);assert.equal(x.state.imports,1);
});
test('file failure preserves durable intent and releases the running lifecycle fence',async t=>{
 const x=await f(t,{imported:true}),p=await x.preview();x.state.failFile=true;
 await assert.rejects(x.service.execute(x.approve(p),x.auth),/INSPECT_FIRST/);
 assert.equal((await x.prisma.runtimeStore.findUnique({where:{key:journalKey('associate',x.target)}})).data.phase,'prepared');
 x.options.fence.hold([x.target.attemptId]);x.options.fence.release([x.target.attemptId]);assert.equal(x.state.imports,0);
});
test('a late completed import receipt is preserved, never invalidated as a definitive negative',async t=>{
 const x=await f(t),{provisioningStateKey}=require('../server/provisioningState'),key=provisioningStateKey('vapi-import',x.target.idempotencyKey);
 const original=x.prisma.runtimeStore.findUnique,completed={status:'completed',contextHash:x.target.contextHash,result:{id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',number:x.target.number,assistantId:x.target.assistantId}};
 x.prisma.runtimeStore.findUnique=async args=>{
  if(args.where.key===key){await x.prisma.runtimeStore.upsert({where:{key},create:{key,data:completed},update:{data:completed}});}
  return original(args);
 };
 const p=await x.preview();await assert.rejects(x.service.execute(x.approve(p),x.auth),/INSPECT_FIRST/);
 assert.equal((await original({where:{key}})).data.status,'completed');assert.equal(x.state.imports,0);
});
test('an already-held cleanup reservation refuses connection before intent or provider dispatch',async t=>{
 const x=await f(t),p=await x.preview(),targetId=hashOperationalTarget({signupAttemptId:x.target.attemptId});
 await x.options.fence.withRemovalGuard(x.readStore,[targetId],async()=>{await assert.rejects(x.service.execute(x.approve(p),x.auth),/ASSOCIATION_REPAIR_BUSY/);});
 assert.equal(x.state.imports,0);
});
test('HTTP uses actual signed-session verifier, Origin and confirmation header; response never exposes secrets',async t=>{
 const x=await f(t),app=express();app.use(express.json());registerFixtureHttp(app,x);
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});t.after(()=>new Promise(resolve=>server.close(resolve)));
 const url='http://127.0.0.1:'+server.address().port+'/api/admin/signups/no-send-connection';
 const headers={Origin:'https://fixture.invalid','Content-Type':'application/json','x-myaipa-no-send-connection':'1',Cookie:'fixture_session='+x.token};
 let r=await fetch(url,{method:'POST',headers:{...headers,Cookie:''},body:JSON.stringify({action:'identify'})});assert.equal(r.status,401);
 r=await fetch(url,{method:'POST',headers:{...headers,Origin:'https://foreign.invalid'},body:JSON.stringify({action:'identify'})});assert.equal(r.status,403);
 r=await fetch(url,{method:'POST',headers,body:JSON.stringify({action:'preview',policyId:x.state.policy.policyId})});assert.equal(r.status,200);
 const text=await r.text();assert.doesNotMatch(text,/owner@example|invented-signing|invented-auth|authorizationToken|twilioAuthToken/);
 assert.equal(x.state.imports,0);assert.equal(x.state.fileWrites,0);
});
test('wired runtime uses existing fence singleton, signed session, disabled flags and narrow transport, not broad callbacks',()=>{
 const source=fs.readFileSync(require.resolve('../server/index'),'utf8');
 const start=source.indexOf('const noSendConnectionControl='),end=source.indexOf('const boundedMappingControl',start),wired=source.slice(start,end);
 assert.match(wired,/fence:signupAssociationFence/);assert.match(wired,/hasValidAdminSession/);assert.match(wired,/SIGNUP_CONNECTION_APPLY_ENABLED==='true'/);
 assert.doesNotMatch(wired,/createAssociationFence|testSignupAgentBeforeDelivery|safelyProvisionIsolatedSmsForSignup|completeSignupProvisioningContext/);
});
