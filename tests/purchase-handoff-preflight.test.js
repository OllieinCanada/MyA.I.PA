'use strict';
// Actual source guards/route/context loader with generated fake data only.
// Transaction faults are deterministic models, not measured PostgreSQL timing.
// No Make engine, full HTTP server, application startup or provider connection.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {fixture}=require('./helpers/provisioning-error-route-fixture');
const context=require('../server/signupProvisioningContext');
const {normalizeSignupProvisioningPayload,verifySignupProvisioningAuthorization}=require('../server/signupProvisioning');
const {listSignupBugs}=require('../server/signupBugHistory');
const {runProvisioningStep}=require('../server/provisioningState');
const {memoryDb}=require('./helpers/twilio-status-memory-db');
const {buildSafeFailureCodeMapping}=require('../scripts/make-provisioning-failure-format');
const source=fs.readFileSync(require.resolve('../server/index'),'utf8').replace(/\r\n/g,'\n');
let transportAttempts=0;const undo=[];
test.before(()=>{
 const block=(object,key)=>{const original=object[key];object[key]=()=>{transportAttempts++;throw Error('SYNTHETIC_TRANSPORT_REFUSED');};undo.push(()=>{object[key]=original;});};
 block(globalThis,'fetch');
 for(const name of ['node:http','node:https']){const m=require(name);block(m,'request');block(m,'get');}
 block(require('node:net').Socket.prototype,'connect');block(require('node:tls'),'connect');
});
test.after(()=>{for(const restore of undo.reverse())restore();assert.equal(transportAttempts,0,'No test may attempt provider or database network access; this is instrumentation, not an OS sandbox');});
function request(f){
 const p=f.payload.provisioning;
 // Current module 9 sends proof/preferences in query plus two headers, not JSON.
 return {body:{},query:Object.fromEntries(new URLSearchParams({areaCode:p.preferredAreaCode,region:p.preferredRegion,
  voiceUrl:'https://example.invalid/synthetic-voice-hook',voiceMethod:'POST',idempotencyKey:p.idempotencyKey,contextHash:p.contextHash})),
  headers:{'x-myaipa-integration-key':'synthetic-connection-key','x-provisioning-token':p.authorizationToken}};
}
function contextFixture(f,{fault='',storedPayload=f.payload}={}){
 const key=context.contextStoreKey(f.payload.provisioning.idempotencyKey);
 let committed=new Map([[key,{payload:structuredClone(storedPayload),idempotencyKey:f.payload.provisioning.idempotencyKey,
  contextHash:storedPayload.provisioning.contextHash,signupEventKey:f.target.attemptId}]]),tail=Promise.resolve();
 const calls={transactions:0,locks:0,upserts:0};
 const store=rows=>({findUnique:async({where})=>rows.has(where.key)?{data:structuredClone(rows.get(where.key))}:null,
  upsert:async({where,update,create})=>{calls.upserts++;const data=structuredClone(rows.has(where.key)?update.data:create.data);rows.set(where.key,data);return{data};}});
 const prisma={runtimeStore:store(committed),async $transaction(fn,options){
  calls.transactions++;const previous=tail;let release;tail=new Promise(r=>{release=r;});await previous;
  try{
   if(fault==='pool')throw Object.assign(Error('Synthetic transaction admission unavailable'),{code:'P2024'});
   const working=new Map(structuredClone([...committed]));
   const result=await fn({runtimeStore:store(working),$queryRaw:async strings=>{
    calls.locks++;assert.match(strings.join('?'),/pg_advisory_xact_lock[\s\S]*::text AS lock_result/);
    if(fault==='lock')throw Object.assign(Error('Synthetic expired context-lock transaction'),{code:'P2028'});
    return[{lock_result:''}];
   }});
   if(fault==='before-commit')throw Object.assign(Error('Synthetic context commit refused'),{code:'P2028'});
   committed=working;
   if(fault==='after-commit')throw Object.assign(Error('Synthetic lost context commit acknowledgement'),{code:'P2028'});
   return result;
  }finally{release();}
 }};
 f.ctx.loadSignupProvisioningContextForAttempt=options=>context.loadSignupProvisioningContextForAttempt({...options,prisma});
 return {prisma,calls,read:()=>structuredClone(committed.get(key)),remove:()=>committed.delete(key)};
}
async function bugs(f){return (await listSignupBugs({prisma:f.db.prisma,listSignups:f.db.listSignups})).events;}
function limiterOptions(f){
 const a=source.indexOf('const provisioningRequestProcessRateLimiter = rateLimit({'),b=source.indexOf('\nconst adminLoginProcessRateLimiter = rateLimit({',a);
 assert.ok(a>=0&&b>a);f.ctx.rateLimit=options=>options;
 return vm.runInContext(source.slice(a,b)+'\nprovisioningRequestProcessRateLimiter',f.ctx);
}
test('current Make-style query/header request passes actual guards and real context loader',async()=>{
 const f=fixture(),c=contextFixture(f),r=await f.run(request(f));
 assert.equal(r.status,201);assert.equal(f.counts.claims,1);assert.equal(f.counts.purchases,1);
 assert.equal(c.calls.transactions,1);assert.equal(c.calls.locks,1);assert.ok(c.read().lockedAt);assert.equal((await bugs(f)).length,0);
});
test('actual limiter skip logic recognizes valid query-carried proof; invalid proof never bypasses it',()=>{
 for(const mode of ['valid','missing-key','missing-token','bad-token','missing-hash','bad-account']){
  const f=fixture(),r={...request(f),method:'POST',path:f.path,originalUrl:f.path+'?synthetic=1'};
  if(mode==='missing-key')delete r.headers['x-myaipa-integration-key'];
  if(mode==='missing-token')delete r.headers['x-provisioning-token'];
  if(mode==='bad-token')r.headers['x-provisioning-token']='f'.repeat(64);
  if(mode==='missing-hash')delete r.query.contextHash;
  if(mode==='bad-account')r.query.idempotencyKey='f'.repeat(64);
  assert.equal(limiterOptions(f).skip(r),mode==='valid',mode);
 }
});
for(const mode of ['missing-key','wrong-key','missing-token','bad-token','missing-hash','missing-account']){
 test('Make-style '+mode+' refuses before context locking, claim or fake provider dispatch',async()=>{
  const f=fixture(),c=contextFixture(f),options=request(f);
  if(mode==='missing-key')delete options.headers['x-myaipa-integration-key'];
  if(mode==='wrong-key')options.headers['x-myaipa-integration-key']='wrong-synthetic-key';
  if(mode==='missing-token')delete options.headers['x-provisioning-token'];
  if(mode==='bad-token')options.headers['x-provisioning-token']='f'.repeat(64);
  if(mode==='missing-hash')delete options.query.contextHash;
  if(mode==='missing-account')delete options.query.idempotencyKey;
  const r=await f.run(options);assert.equal(r.status,401);assert.equal(c.calls.transactions,0);assert.equal(c.read().lockedAt,undefined);
  assert.equal(f.counts.claims,0);assert.equal(f.counts.purchases,0);const e=(await bugs(f))[0];
  assert.equal(e.signupAttemptId,null);assert.equal(e.stage,'authorization');assert.equal(e.provisioningFailure.retryAllowed,false);
 });
}
test('a valid old signed request is refused after unlocked context replacement, without guessing another identity',async()=>{
 const f=fixture(),changed=normalizeSignupProvisioningPayload({...f.payload,aiAssistant:{...f.payload.aiAssistant,serviceArea:'Different invented service area'}},{signingSecret:'synthetic-signing-secret'});
 assert.equal(verifySignupProvisioningAuthorization(f.payload,'synthetic-signing-secret'),true);
 assert.equal(verifySignupProvisioningAuthorization(changed,'synthetic-signing-secret'),true);
 assert.notEqual(changed.provisioning.contextHash,f.payload.provisioning.contextHash);
 const c=contextFixture(f,{storedPayload:changed}),r=await f.run(request(f));
 assert.equal(r.status,401);assert.equal(r.response.code,'PROVISIONING_CONTEXT_NOT_REGISTERED');assert.equal(c.read().lockedAt,undefined);
 assert.equal(f.counts.purchases,0);assert.equal(f.counts.claims,0);assert.equal((await bugs(f))[0].signupAttemptId,null);
});
test('missing registered context refuses before claim with no replacement, purchase or storage retry',async()=>{
 const f=fixture(),c=contextFixture(f);c.remove();const r=await f.run(request(f));
 assert.equal(r.response.code,'PROVISIONING_CONTEXT_NOT_REGISTERED');assert.equal(c.calls.transactions,1);assert.equal(c.calls.upserts,0);assert.equal(f.counts.purchases,0);
});
for(const fault of ['pool','lock','before-commit','after-commit']){
 test('context '+fault+' fault preserves failure and makes zero fake purchase dispatches',async()=>{
  const f=fixture(),c=contextFixture(f,{fault}),r=await f.run(request(f));
  assert.equal(r.status,500);assert.equal(r.response.code,fault==='pool'?'P2024':'P2028');assert.equal(c.calls.transactions,1);
  assert.equal(f.counts.claims,0);assert.equal(f.counts.purchases,0);assert.equal(!!c.read().lockedAt,fault==='after-commit');
  const e=(await bugs(f))[0];assert.equal(e.provisioningFailure.phase,'context');assert.equal(e.signupAttemptId,null);assert.equal(e.provisioningFailure.retryAllowed,false);
 });
}
test('changed number preference fails after context commit, distinguishing it from absent lock evidence',async()=>{
 const f=fixture(),c=contextFixture(f),options=request(f);options.query.areaCode='999';const r=await f.run(options);
 assert.equal(r.status,409);assert.equal(r.response.code,'PROVISIONING_INVENTORY_CONTEXT_MISMATCH');assert.ok(c.read().lockedAt);
 assert.equal(f.counts.claims,0);assert.equal(f.counts.purchases,0);assert.equal((await bugs(f))[0].signupAttemptId,f.target.attemptId);
});
test('query/header path preserves duplicate and restart protection in 20 isolated rounds with real claim algorithm',{timeout:10000},async()=>{
 for(let round=0;round<20;round++){
 const f=fixture(),c=contextFixture(f),state=memoryDb();f.ctx.runProvisioningStep=options=>runProvisioningStep({...options,prisma:state.prisma});
 let release,entered;const held=new Promise(r=>{release=r;}),started=new Promise(r=>{entered=r;});
 f.ctx.purchaseTwilioPhoneNumber=async()=>{f.counts.purchases++;entered();await held;return{twilioPhoneNumber:'+12895550123',twilioSid:'PN'+'1'.repeat(32)};};
 const first=f.run(request(f)),outcome=first.then(result=>({result}),error=>({error}));
 const admitted=await Promise.race([started.then(()=>true),outcome.then(()=>false)]);
 if(!admitted){const completed=await outcome;throw completed.error||Error('Fake dispatch was never admitted: '+completed.result?.status);}
 try{const second=await f.run(request(f));assert.equal(second.response.code,'PROVISIONING_ALREADY_IN_PROGRESS');assert.equal(f.counts.purchases,1);}
 finally{release();await first;}
 const restarted=fixture();restarted.ctx.loadSignupProvisioningContextForAttempt=options=>context.loadSignupProvisioningContextForAttempt({...options,prisma:c.prisma});
 restarted.ctx.runProvisioningStep=options=>runProvisioningStep({...options,prisma:state.prisma});
 assert.equal((await restarted.run(request(restarted))).status,200);assert.equal(restarted.counts.purchases,0);
 }
});
function renderCurrentCode(message){
 let expression=buildSafeFailureCodeMapping(9).slice(2,-2);
 for(let depth=0;depth<=15;depth++){
  if(expression==='"PROVIDER_REQUEST_FAILED"')return 'PROVIDER_REQUEST_FAILED';
  const m=/^if\(contains\(9\.error\.message; "([^"\\]+)"\); "([A-Z0-9_]+)"; ([\s\S]+)\)$/.exec(expression);
  assert.ok(m,'Only the fixed generated grammar is interpreted, not arbitrary Make expressions');
  if(message.includes(m[1]))return m[2];expression=m[3];
 }
 throw Error('FIXED_MAPPING_DEPTH_EXCEEDED');
}
test('generic HTTP failures and unmapped DB codes are indistinguishable in the current fixed Make error mapping',()=>{
 for(const input of ['400 Bad Request','401 Unauthorized','403 Forbidden','429 Too Many Requests','500 Internal Server Error','502 Bad Gateway','503 Service Unavailable','P2024','P2028','ETIMEDOUT'])assert.equal(renderCurrentCode(input),'PROVIDER_REQUEST_FAILED',input);
 // Existing specific refusals still survive when Make actually supplies the body text.
 assert.equal(renderCurrentCode('Invalid provisioning key.'),'PROVISIONING_AUTH_INVALID');
 assert.equal(renderCurrentCode('Invalid signed provisioning request.'),'PROVISIONING_AUTHORIZATION_INVALID');
});
test('valid current saved context plus an unlocked row is not a unique diagnosis of the historical request',async()=>{
 for(const mode of ['bad-token','pool','lock']){
  const f=fixture(),c=contextFixture(f,{fault:mode==='bad-token'?'':mode}),options=request(f);
  if(mode==='bad-token')options.headers['x-provisioning-token']='f'.repeat(64);
  await f.run(options);
  assert.equal(verifySignupProvisioningAuthorization(c.read().payload,'synthetic-signing-secret'),true);
  assert.equal(c.read().lockedAt,undefined);assert.equal(f.counts.purchases,0);assert.equal(f.counts.claims,0);
 }
});
