'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),express=require('express'),fs=require('node:fs'),vm=require('node:vm');
const {fixture,registerFixtureHttp}=require('./helpers/signup-connection-fixture');
const {PATH,pendingGateProof,pendingServer,assertPendingPhone}=require('../server/signupPendingConnection');
const {journalKey}=require('../server/signupConnectionControl');
const {provisioningStateKey,runProvisioningStep}=require('../server/provisioningState');
const {verifyVapiPhoneAssistantBinding}=require('../server/vapiPhoneImportVerification');
async function setup(t,options={}){const x=await fixture({pending:true,...options});t.after(()=>x.cleanup());return x;}
test('unfinished original stages one existing number without a trial, attached assistant, readiness or messages',async t=>{
 const x=await setup(t),before=x.readStore(),row=await x.prisma.signupAttempt.findUnique({where:{eventKey:x.target.attemptId}}),p=await x.preview();
 assert.equal(p.binding.routeMode,'setup-pending');assert.equal(p.callAdmission,'blocked');
 assert.doesNotMatch(JSON.stringify(p),/invented-pending-gate-secret/);
 const r=await x.service.execute(x.approve(p),x.auth);assert.equal(r.messagesSent,0);assert.equal(r.trialStarted,false);assert.equal(r.ready,false);
 assert.equal(x.state.imports,1);assert.equal(x.state.phones[0].assistantId,undefined);assert.equal(x.state.phones[0].server.url,x.state.pendingGate.url);
 assert.deepEqual(x.readStore(),before);assert.deepEqual(await x.prisma.signupAttempt.findUnique({where:{eventKey:x.target.attemptId}}),row);
 assert.equal(await x.prisma.runtimeStore.findUnique({where:{key:provisioningStateKey('stripe-trial',x.target.idempotencyKey)}}),null);
 assert.ok(x.state.requests.every(r=>r.method==='GET'||r.method==='POST'&&r.url==='https://api.vapi.ai/phone-number'));
});
test('20 synthetic simultaneous staging repetitions import once; completed intents refuse reconstructed replay',async t=>{
 for(let i=0;i<20;i++){
  const x=await setup(t),p=await x.preview(),body=x.approve(p);
  const outcomes=await Promise.allSettled([x.service.execute(body,x.auth),x.service.execute(body,x.auth),x.service.execute(body,x.auth)]);
  assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);assert.equal(x.state.imports,1);assert.equal(x.state.fileWrites,0);
  await assert.rejects(x.preview(x.make()));assert.equal(x.state.imports,1);
 }
});
test('unverified pending readback never saves completion or associations and cannot dispatch twice',async t=>{
 for(const mutate of [x=>x.state.phones[0].assistantId='foreign',x=>delete x.state.phones[0].server.headers['x-vapi-secret'],
  x=>x.state.phones[0].fallbackDestination={number:'+19055550199'},x=>x.state.phones[0].server.url='https://foreign.invalid/route']){
  const x=await setup(t),p=await x.preview();x.state.hook=async({url,method})=>{
   if(method==='GET'&&url.startsWith('https://api.vapi.ai/phone-number/')&&!url.includes('?'))mutate(x);
  };
  await assert.rejects(x.service.execute(x.approve(p),x.auth),/INSPECT_FIRST/);
  const receipt=await x.prisma.runtimeStore.findUnique({where:{key:provisioningStateKey('vapi-import',x.target.idempotencyKey)}});
  assert.notEqual(receipt.data.status,'completed');assert.equal(x.state.fileWrites,0);assert.equal(x.state.imports,1);
  await assert.rejects(x.preview(x.make()));assert.equal(x.state.imports,1);
 }
});
test('pending association saves exact resources, not an active route, trial, delivery or complete signup',async t=>{
 const x=await setup(t,{imported:true}),before=x.readStore(),p=await x.preview();
 await x.service.execute(x.approve(p),x.auth);const after=x.readStore();
 assert.equal(after.original.twilioPhoneNumber,x.target.number);assert.equal(after.original.vapiAssistantId,x.target.assistantId);
 for(const k of ['twilioPhoneNumber','vapiAssistantId','vapiPhoneNumberId'])delete after.original[k];
 assert.deepEqual(after,before);assert.equal(x.state.imports,0);assert.equal(x.state.fileWrites,1);
});
test('staging never resets an existing, expired, canceled or paid trial',async t=>{
 for(const patch of [{trialEndAt:new Date(0).toISOString()},{trialStartAt:new Date().toISOString()},
  {subscriptionStatus:'expired'},{paymentStatus:'paid'},{checkoutStatus:'canceled'},{subscriptionId:'sub_invented'}]){
  const x=await setup(t),s=x.readStore();Object.assign(s.original,patch);x.writeFixture(s);
  await assert.rejects(x.preview());assert.equal(x.state.imports,0);
 }
});
test('direct connection still refuses an unfinished account; stage policy/confirmation cannot be substituted',async t=>{
 const x=await setup(t);x.state.policy.operation='connect';const p=await x.preview();
 await assert.rejects(x.service.execute(x.approve(p),x.auth),/ACCOUNT_ELIGIBILITY/);
 x.state.policy.operation='stage';const staged=await x.preview(),body=x.approve(staged);body.confirmation='NO_SEND_CONNECT';
 await assert.rejects(x.service.execute(body,x.auth),/APPROVED_PREVIEW/);assert.equal(x.state.imports,0);
});
test('missing/changed/unsafe pending gate refuses; live route escapes never count as staged',async t=>{
 for(const patch of [{url:'http://fixture.invalid'+PATH},{url:'https://127.0.0.1'+PATH},{url:'https://fixture.invalid/api/webhooks/voice'},
  {secret:''},{url:'https://fixture.invalid'+PATH+'?assistant=foreign'}]){
  const x=await setup(t);Object.assign(x.state.pendingGate,patch);await assert.rejects(x.preview());assert.equal(x.state.imports,0);
 }
 const x=await setup(t),p=await x.preview(),body=x.approve(p);x.state.pendingGate.secret+='changed';
 await assert.rejects(x.service.execute(body,x.auth));assert.equal(x.state.imports,0);
 const gate={url:'https://fixture.invalid'+PATH,secret:'invented-strong-gate-secret-000000000'},phone={smsEnabled:false,server:pendingServer(gate)};
 assert.doesNotThrow(()=>assertPendingPhone(phone,gate));assert.equal(phone.server.secret,undefined);
 for(const patch of [{assistantId:'foreign'},{squadId:'foreign'},{workflowId:'foreign'},{fallbackDestination:{}},{hooks:[{}]},
  {server:{...gate,secret:'redacted'}},{server:{...gate,headers:{authorization:'foreign'}}}])assert.throws(()=>assertPendingPhone({...phone,...patch},gate));
 assert.doesNotMatch(JSON.stringify(pendingGateProof(gate)),/invented-strong/);
});
test('uncertainty survives restart AND switching between stage and direct operation',async t=>{
 const x=await setup(t);assert.equal(journalKey('stage',x.target),journalKey('connect',x.target));
 x.state.lost=true;const p=await x.preview();await assert.rejects(x.service.execute(x.approve(p),x.auth),/INSPECT_FIRST/);
 x.state.phones=[];x.state.lost=false;let fresh=x.make();await assert.rejects(x.preview(fresh),/INSPECT_FIRST/);
 // Even absent provider/receipt evidence cannot erase the separately committed intent.
 await x.prisma.runtimeStore.deleteMany({where:{key:provisioningStateKey('vapi-import',x.target.idempotencyKey)}});
 const absent=await x.preview(fresh);await assert.rejects(fresh.execute(x.approve(absent),x.auth),/INSPECT_FIRST/);assert.equal(x.state.imports,1);
 x.state.policy.operation='connect';const s=x.readStore();s.original.trialStartAt=new Date(x.state.now-1000).toISOString();s.original.trialEndAt=new Date(x.state.now+60000).toISOString();x.writeFixture(s);
 // The import lease itself is uncertain even if an operator changes policies.
 fresh=x.make();const direct=await x.preview(fresh);await assert.rejects(fresh.execute(x.approve(direct),x.auth),/INSPECT_FIRST/);assert.equal(x.state.imports,1);
});
test('legacy completed-receipt verification cannot invalidate or activate a pending import',async t=>{
 const x=await setup(t,{imported:true}),key=provisioningStateKey('vapi-import',x.target.idempotencyKey),before=await x.prisma.runtimeStore.findUnique({where:{key}});let callbacks=0;
 await assert.rejects(runProvisioningStep({prisma:x.prisma,kind:'vapi-import',idempotencyKey:x.target.idempotencyKey,contextHash:x.target.contextHash,
  verifyCompleted:async()=>{callbacks++;return false;},execute:async()=>{callbacks++;}}),{code:'PROVISIONING_PENDING_SETUP_INSPECTION_REQUIRED'});
 assert.equal(callbacks,0);assert.deepEqual(await x.prisma.runtimeStore.findUnique({where:{key}}),before);
 const calls=[];await assert.rejects(verifyVapiPhoneAssistantBinding({phoneRecordId:'invented',assistantId:x.target.assistantId},
  {requestResource:async(...args)=>{calls.push(args);return x.state.phones[0];},getAssistantId:r=>r.assistantId,summarize:r=>r}),/must not be activated/);
 assert.equal(calls.length,1);
});
test('actual normal signup route helper cannot turn the staged phone into a live assistant route',async t=>{
 const x=await setup(t,{imported:true}),source=fs.readFileSync(require.resolve('../server/index'),'utf8').replace(/\r\n/g,'\n'),calls=[];
 const ctx={URL,SIGNUP_PENDING_GATE_PATH:PATH,createAgentRouteError:(a,m)=>Object.assign(Error(m),{code:a.code}),
  getVapiAssistantId:r=>r?.assistantId||'',getVapiPhoneNumber:r=>r?.number||'',normalizePhoneForMatch:x=>x,
  getVapiNestedString:r=>r.server?.url||r.serverUrl||''};vm.createContext(ctx);
 const start=source.indexOf('async function ensureSignupAgentRoute('),end=source.indexOf('\nasync function testSignupAgentBeforeDelivery(',start);
 assert.ok(start>=0&&end>start);vm.runInContext(source.slice(start,end),ctx);
 await assert.rejects(ctx.ensureSignupAgentRoute({signup:{vapiAssistantId:x.target.assistantId,vapiPhoneNumberId:x.state.phones[0].id,twilioPhoneNumber:x.target.number},business:{id:7}},
  {requestResource:async(path,opts)=>{calls.push({path,opts});return path.startsWith('assistant/')?x.state.assistant:x.state.phones[0];},
   readGate:async()=>{throw Error('must refuse before gate writes');},writeGate:async()=>{throw Error('must never mutate gate');}}),{code:'AGENT_SETUP_PENDING_SEPARATE_APPROVAL'});
 assert.equal(calls.length,2);assert.ok(calls.every(c=>!c.opts));
});
test('authenticated pending HTTP route always refuses, including caller-supplied paid/assistant hints; zero writes',async t=>{
 const x=await setup(t),app=express();app.use(express.json());registerFixtureHttp(app,x);
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});t.after(()=>new Promise(resolve=>server.close(resolve)));
 const url='http://127.0.0.1:'+server.address().port+PATH,before=x.readStore();
 for(const token of ['',x.state.pendingGate.secret])for(const payload of [{message:{type:'assistant-request'}},{paid:true,assistantId:x.target.assistantId},{message:{type:'tool-calls'}}]){
  const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','x-vapi-secret':token},body:JSON.stringify(payload)});
  assert.equal(r.status,token?200:401);const b=await r.json();assert.ok(b.error);assert.equal(b.assistantId,undefined);assert.equal(b.destination,undefined);
 }
 assert.deepEqual(x.readStore(),before);assert.equal(x.state.imports,0);assert.equal(x.state.fileWrites,0);
 const source=fs.readFileSync(require.resolve('../server/index'),'utf8');assert.match(source,/registerPendingSetupGate\(\{app,authenticate:requireVapiWebhookKey/);
});
