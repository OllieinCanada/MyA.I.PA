'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSignupLiveDiagnostics } = require('../server/signupLiveDiagnostics');
const { createProviderReader } = require('../server/signupDiagnosticProviders');
const { normalizeSignupProvisioningPayload } = require('../server/signupProvisioning');
const { buildMakeSignupEventKey } = require('../server/makeSignupWebhook');
const { contextStoreKey } = require('../server/signupProvisioningContext');
const { provisioningStateKey } = require('../server/provisioningState');
const { fingerprintAssistantContent } = require('../server/signupAssistantVerification');
const { buildAgentTestFingerprint } = require('../server/signupAgentTesting');
const AC='AC'+'a'.repeat(32), PN='PN'+'b'.repeat(32), assistantId='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',phoneId='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const privateText='secret-raw-provider-body private@example.test';
function fixture(){
  const input={businessName:'Invented Diagnostic Electric',ownerEmail:'invented@example.test',ownerPhone:'+19055550198',businessPhone:'+19055550199'};
  const payload=normalizeSignupProvisioningPayload(input,{signingSecret:'synthetic-signing-secret-32-characters'});
  const attempt=buildMakeSignupEventKey(payload), key=payload.provisioning.idempotencyKey;
  const context={payload,signupEventKey:attempt,contextHash:payload.provisioning.contextHash,registeredAt:'2026-11-15T12:00:00Z'};
  context.makeExecution={signupAttemptId:attempt,contextHash:context.contextHash,scenarioId:'123',executionId:'e'.repeat(32)};
  const assistant={id:assistantId,metadata:{businessId:44},model:{messages:[{role:'system',content:'Fictitious test script'}]}};
  const record={...input,signupAttemptId:attempt,status:'setup_started',businessId:44,twilioPhoneNumber:'+12895550101',vapiAssistantId:assistantId,vapiPhoneNumberId:phoneId,
    agentContentFingerprint:fingerprintAssistantContent(assistant)};
  record.agentTestFingerprint=buildAgentTestFingerprint({assistantId,aiNumber:record.twilioPhoneNumber,ownerPhone:record.ownerPhone,contentFingerprint:record.agentContentFingerprint});
  const fields=['smsVerificationMessageSid','agentTestOwnerMessageSid','agentTestCustomerMessageSid','setupFollowupSmsSid'];
  fields.forEach((f,i)=>record[f]='SM'+String(i+1).repeat(32));
  const receipts={
    'twilio-number':{status:'completed',result:{twilioSid:PN,phoneNumber:record.twilioPhoneNumber}},
    'vapi-assistant':{status:'completed',result:{id:assistantId}},
    'vapi-import':{status:'completed',result:{id:phoneId}},
  };
  const store=new Map([[contextStoreKey(key),{data:context}]]);
  for(const [kind,receipt] of Object.entries(receipts)){receipt.contextHash=context.contextHash;store.set(provisioningStateKey(kind,key),{data:receipt});}
  const rows=[record], calls=[];
  const prisma={runtimeStore:{findUnique:async({where})=>store.get(where.key)}};
  const env={TWILIO_ACCOUNT_SID:AC,TWILIO_AUTH_TOKEN:'synthetic-token',VAPI_API_KEY:'synthetic-vapi',MAKE_API_TOKEN:'synthetic-make'};
  const bodies=new Map([
    [PN+'.json',{sid:PN,account_sid:AC,phone_number:record.twilioPhoneNumber}],
    [assistantId,assistant], [phoneId,{id:phoneId,number:record.twilioPhoneNumber,assistantId,metadata:{businessId:44}}],
    ['e'.repeat(32),{scenarioLog:{id:'e'.repeat(32),status:1,timestamp:'2026-11-15T12:00:00Z'}}],
  ]);
  fields.forEach(f=>bodies.set(record[f]+'.json',{sid:record[f],account_sid:AC,to:record.ownerPhone,from:record.twilioPhoneNumber,status:'delivered',body:privateText}));
  let hook=()=>{},httpStatus=200;
  const fetchImpl=async(url,options)=>{
    assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(options.body,undefined);
    assert.ok(['api.twilio.com','api.vapi.ai','us2.make.com'].includes(new URL(url).hostname));
    calls.push(url); await hook(url);
    const body=bodies.get(new URL(url).pathname.split('/').at(-1));
    return new Response(JSON.stringify(body||{error:privateText}),{status:httpStatus});
  };
  const build=(extra={})=>createSignupLiveDiagnostics({prisma,list:()=>rows,env,fetchImpl,cooldownMs:0,...extra});
  return{attempt,record,context,receipts,rows,store,env,assistant,bodies,calls,build,fetchImpl,hook:fn=>hook=fn,status:s=>httpStatus=s};
}
const find=(r,id)=>r.groups.flatMap(g=>g.checks).find(c=>c.id===id);
test('all five diagnostic groups use exact GET references and never grant readiness or reveal raw payloads',async()=>{
  const f=fixture(), before=JSON.stringify([f.rows,[...f.store]]),r=await f.build()(f.attempt);
  assert.equal(r.groups.length,5);assert.equal(r.providerReads,8);assert.equal(f.calls.length,8);
  for(const id of ['context','number','assistant','route','verification','owner-practice','customer-copy-practice','completion'])assert.equal(find(r,id).state,'verified',id);
  assert.equal(find(r,'make').state,'observed');assert.equal(r.ready,false);assert.equal(r.resumeAllowed,false);assert.equal(r.readOnly,true);
  assert.doesNotMatch(JSON.stringify(r),/secret-raw|private@example|synthetic-token|synthetic-vapi|5550198|Fictitious test script/);
  assert.equal(JSON.stringify([f.rows,[...f.store]]),before);
});
test('Make HTTP request/CDN IDs never substitute for missing exact execution linkage',async()=>{
  const f=fixture();delete f.context.makeExecution;f.record.makeRequestId='e'.repeat(32);
  const r=await f.build()(f.attempt);assert.equal(find(r,'make').detail,'EXECUTION_LINK_MISSING');assert.equal(f.calls.some(u=>u.includes('make.com')),false);
});
test('missing resource references remain unknown, not an account-wide no-purchase claim',async()=>{
  const f=fixture();for(const k of ['twilioPhoneNumber','vapiAssistantId','vapiPhoneNumberId','smsVerificationMessageSid','agentTestOwnerMessageSid','agentTestCustomerMessageSid','setupFollowupSmsSid'])delete f.record[k];
  for(const r of Object.values(f.receipts)){r.status='failed';r.result=null;r.dispatchStartedAt=null;}
  delete f.context.makeExecution;const r=await f.build()(f.attempt);assert.equal(f.calls.length,1);assert.equal(find(r,'number').state,'unknown');assert.equal(find(r,'purchase').state,'failed');
});
for(const [name,mutate,code] of [
  ['unregistered context',f=>f.context.signupEventKey='signup_'+'f'.repeat(32),'EXACT_CONTEXT_UNAVAILABLE'],
  ['foreign receipt',f=>f.receipts['vapi-import'].contextHash='f'.repeat(64),'RECEIPT_CONTEXT_MISMATCH'],
  ['duplicate attempt',f=>f.rows.push({...f.record}),'SIGNUP_IDENTITY_CONFLICT'],
  ['archived target',f=>f.record.status='archived','SIGNUP_IDENTITY_CONFLICT'],
  ['shared resource',f=>f.rows.push({...f.record,signupAttemptId:'signup_'+'f'.repeat(32),status:'archived'}),'SIGNUP_RESOURCE_SHARED'],
  ['conflicting saved resource',f=>f.receipts['twilio-number'].result.phoneNumber='+13655550100','SAVED_RESOURCE_CONFLICT'],
])test('refuses '+name+' before any provider request',async()=>{const f=fixture();mutate(f);await assert.rejects(f.build()(f.attempt),e=>e.code===code);assert.equal(f.calls.length,0);});
for(const field of ['account_sid','phone_number','sid'])test('Twilio '+field+' mismatch cannot verify ownership',async()=>{
  const f=fixture();f.bodies.get(PN+'.json')[field]='foreign';const r=await f.build()(f.attempt);assert.equal(find(r,'number').state,'unknown');assert.equal(find(r,'number').detail,'PROVIDER_IDENTITY_CONFLICT');
});
for(const field of ['businessId','metadata'])test('Vapi conflicting '+field+' refuses verification without weakening tenant guard',async()=>{
  const f=fixture();f.assistant[field]=field==='metadata'?{businessId:45}:45;
  const r=await f.build()(f.attempt);assert.equal(find(r,'assistant').state,'unknown');assert.equal(find(r,'route').state,'unknown');
});
test('script change is failed; different phone assistant is failed; dynamic route remains unknown',async()=>{
  const f=fixture();f.assistant.model.messages[0].content='Changed script';f.bodies.get(phoneId).assistantId='c'.repeat(36);
  let r=await f.build()(f.attempt);assert.equal(find(r,'assistant').state,'failed');assert.equal(find(r,'route').state,'failed');
  delete f.bodies.get(phoneId).assistantId;r=await f.build()(f.attempt);assert.equal(find(r,'route').state,'unknown');
});
test('accepted is not delivered, failure is not resent, and recipient mismatch is unknown',async()=>{
  const f=fixture();f.bodies.get(f.record.agentTestOwnerMessageSid+'.json').status='queued';
  f.bodies.get(f.record.agentTestCustomerMessageSid+'.json').status='undelivered';
  f.bodies.get(f.record.smsVerificationMessageSid+'.json').to='+19055550999';
  const r=await f.build()(f.attempt);assert.equal(find(r,'owner-practice').state,'observed');assert.equal(find(r,'customer-copy-practice').state,'failed');assert.equal(find(r,'verification').state,'unknown');assert.equal(f.calls.length,8);
});
test('changed configuration does not fetch or borrow stale practice receipt proof',async()=>{
  const f=fixture();f.record.agentTestFingerprint='stale';const r=await f.build()(f.attempt);assert.equal(find(r,'owner-practice').state,'unknown');assert.equal(f.calls.length,6);
});
test('a record or durable receipt changing during provider reads invalidates the whole report',async()=>{
  for(const change of [f=>f.record.businessId=90,f=>f.receipts['twilio-number'].attempts=2]){
    const f=fixture();f.hook(()=>change(f));await assert.rejects(f.build()(f.attempt),e=>e.code==='DIAGNOSTIC_EVIDENCE_CHANGED');
  }
});
test('concurrent same-target reads are bounded and do not duplicate provider requests',async()=>{
  const f=fixture();let release;const pending=new Promise(r=>release=r);f.hook(()=>pending);
  const inspect=f.build(),first=inspect(f.attempt);await assert.rejects(inspect(f.attempt),e=>e.code==='DIAGNOSTIC_RATE_LIMITED');
  release();await first;assert.equal(f.calls.length,8);
});
test('a new overlapping resource association during reads invalidates the report',async()=>{
  const f=fixture();f.hook(()=>{if(f.rows.length===1)f.rows.push({signupAttemptId:'signup_'+'f'.repeat(32),vapiAssistantId:assistantId});});
  await assert.rejects(f.build()(f.attempt),e=>e.code==='SIGNUP_RESOURCE_SHARED');
});
test('one message cannot certify two legs or another signup under a different field',async()=>{
  let f=fixture();f.record.agentTestCustomerMessageSid=f.record.agentTestOwnerMessageSid;
  await assert.rejects(f.build()(f.attempt),e=>e.code==='SAVED_RESOURCE_CONFLICT');assert.equal(f.calls.length,0);
  f=fixture();f.rows.push({signupAttemptId:'signup_'+'f'.repeat(32),setupFollowupSmsSid:f.record.smsVerificationMessageSid});
  await assert.rejects(f.build()(f.attempt),e=>e.code==='SIGNUP_RESOURCE_SHARED');assert.equal(f.calls.length,0);
});
test('Make failure and waiting statuses stay separate from provider completion and unknown binding',async()=>{
  const f=fixture(),log=f.bodies.get('e'.repeat(32)).scenarioLog;
  log.status=3;f.record.makeFailedStage='TWILIO_NUMBER_PURCHASE';f.record.makeProviderCode='PRIVATE_SECRET_TOKEN_DO_NOT_PUBLISH';
  let r=await f.build()(f.attempt);assert.equal(find(r,'make').state,'failed');assert.match(find(r,'make-saved').detail,/TWILIO_NUMBER_PURCHASE/);assert.doesNotMatch(JSON.stringify(r),/PRIVATE_SECRET/);
  delete log.status;log.eventType='EXECUTION_PAUSED';r=await f.build()(f.attempt);assert.equal(find(r,'make').state,'unknown');
  f.context.makeExecution.contextHash='f'.repeat(64);f.calls.length=0;r=await f.build()(f.attempt);assert.equal(find(r,'make').detail,'EXECUTION_LINK_MISSING');assert.equal(f.calls.some(u=>u.includes('make.com')),false);
});
for(const status of [401,403,404,429,500])test('HTTP '+status+' stays unknown with no retry or raw error disclosure',async()=>{
  const f=fixture();f.status(status);const r=await f.build()(f.attempt);assert.equal(find(r,'number').state,'unknown');assert.equal(f.calls.length,8);assert.doesNotMatch(JSON.stringify(r),/secret-raw/);
});
test('client timeout, size and read budget are enforced without retry',async()=>{
  let reads=0;const env={TWILIO_ACCOUNT_SID:AC,TWILIO_AUTH_TOKEN:'synthetic'};
  let reader=createProviderReader({env,timeoutMs:10,fetchImpl:()=>{reads++;return new Promise(()=>{});}});
  await assert.rejects(reader.twilio('number',PN),e=>e.code==='READ_TIMEOUT');assert.equal(reads,1);
  reader=createProviderReader({env,maxBytes:10,fetchImpl:async()=>new Response(JSON.stringify({body:privateText}))});
  await assert.rejects(reader.twilio('number',PN),e=>e.code==='PROVIDER_RESPONSE_TOO_LARGE');
  reader=createProviderReader({env,maxReads:0,fetchImpl:()=>{throw Error('must not fetch');}});
  await assert.rejects(reader.twilio('number',PN),e=>e.code==='READ_BUDGET_EXHAUSTED');
});
test('arbitrary identifiers/origins never receive credentials',async()=>{
  const reader=createProviderReader({env:{TWILIO_ACCOUNT_SID:AC,TWILIO_AUTH_TOKEN:'synthetic',VAPI_API_KEY:'synthetic',MAKE_API_TOKEN:'synthetic',MAKE_API_BASE_URL:'https://evil.example/api/v2'},fetchImpl:()=>{throw Error('must not fetch');}});
  assert.throws(()=>reader.twilio('number','../../Messages'),e=>e.code==='RESOURCE_REFERENCE_MISSING');
  assert.throws(()=>reader.vapi('assistant','https://evil.example'),e=>e.code==='RESOURCE_REFERENCE_MISSING');
  assert.throws(()=>reader.make('123','e'.repeat(32)),e=>e.code==='PROVIDER_ORIGIN_REFUSED');
});

test('missing purchase acknowledgement can locate only a deterministic marker candidate, never assign it',async()=>{
  const f=fixture();delete f.record.twilioPhoneNumber;f.receipts['twilio-number'].status='failed';delete f.receipts['twilio-number'].result;
  const marker=f.context.payload.provisioning.resources.twilioNumber;
  f.bodies.set('IncomingPhoneNumbers.json',{incoming_phone_numbers:[{sid:PN,account_sid:AC,phone_number:'+13655550101',friendly_name:marker}],next_page_uri:null});
  const r=await f.build()(f.attempt);assert.equal(find(r,'number').state,'observed');assert.match(find(r,'number').detail,/exact server-generated provisioning marker/);
  assert.equal(f.record.twilioPhoneNumber,undefined);assert.ok(f.calls[0].includes('FriendlyName='+marker));assert.doesNotMatch(JSON.stringify(r),/\+13655550101/);
});
for(const mode of ['empty','duplicate','truncated','wrong-account','shared','missing-marker'])test('marker search '+mode+' cannot turn uncertain purchase into success',async()=>{
  const f=fixture();delete f.record.twilioPhoneNumber;f.receipts['twilio-number'].status='failed';delete f.receipts['twilio-number'].result;
  const marker=f.context.payload.provisioning.resources.twilioNumber;
  const item={sid:PN,account_sid:AC,phone_number:'+13655550101',friendly_name:marker};
  const inventory={incoming_phone_numbers:[item],next_page_uri:null};
  if(mode==='empty')inventory.incoming_phone_numbers=[];
  if(mode==='duplicate')inventory.incoming_phone_numbers.push({...item});
  if(mode==='truncated')inventory.next_page_uri='https://evil.example/must-not-follow';
  if(mode==='wrong-account')item.account_sid='AC'+'f'.repeat(32);
  if(mode==='shared')f.rows.push({signupAttemptId:'signup_'+'f'.repeat(32),twilioPhoneNumber:item.phone_number});
  if(mode==='missing-marker')delete f.context.payload.provisioning.resources.twilioNumber;
  f.bodies.set('IncomingPhoneNumbers.json',inventory);const r=await f.build()(f.attempt);
  assert.equal(find(r,'number').state,'unknown');assert.equal(r.resumeAllowed,false);assert.equal(r.ready,false);
  assert.ok(f.calls.every(u=>!u.includes('evil.example')));
});
