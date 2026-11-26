'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const {prepareNumberConnection,projectConnectionAssociations}=require('../server/signupConnectionPreparation');
const {normalizeSignupProvisioningPayload,buildProvisioningResourceName}=require('../server/signupProvisioning');
const {buildSignupAssistantConfig}=require('../server/signupAssistantTemplate');
const {fingerprintAssistantContent}=require('../server/signupAssistantVerification');
const {normalizeNorthAmericanE164}=require('../server/canadianPhoneNumber');
const {buildTwilioImportRequest}=require('../server/vapiTwilioImportRequest');
const {verifyVapiPhoneAssistantBinding}=require('../server/vapiPhoneImportVerification');
const {runProvisioningStep,provisioningStateKey}=require('../server/provisioningState');
const {memoryDb}=require('./helpers/twilio-status-memory-db');
const index=fs.readFileSync(require.resolve('../server/index'),'utf8').replace(/\r\n/g,'\n');
const now=Date.parse('2026-11-01T12:00:00Z'),secret='invented-only-signing-secret';
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function fixture(imported=false){
 const payload=normalizeSignupProvisioningPayload({business:{name:'Invented Connection Roofing',services:'Fixture roof repair'},
  owner:{name:'Invented Owner',email:'fixture@example.invalid',phone:'+19055550123'},
  aiAssistant:{businessType:'Roofing',serviceArea:'Fixture area'}},{signingSecret:secret});
 const pv=payload.provisioning,id='signup_'+'a'.repeat(32),number='+13655550123',assistantId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',phoneId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 const config=buildSignupAssistantConfig(payload,{assignedPhone:number,resourceName:buildProvisioningResourceName('vapi-assistant',pv.idempotencyKey)});
 const record={signupAttemptId:id,businessName:payload.business.name,ownerEmail:payload.owner.email,ownerPhone:payload.owner.phone,
  identityVerified:true,status:'setup_error',lastErrorCode:'FIXTURE_ORIGINAL_FAILURE',trialStartedAt:null,
  smsRoutingStatus:'waiting',agentDeliveryTestStatus:'not_run',history:[{status:'setup_error',reason:'Invented preserved history'}]};
 const policy={attemptRowId:'fixtureoriginalrow',attemptId:id,idempotencyKey:pv.idempotencyKey,contextHash:pv.contextHash,
  number,twilioSid:'PN'+'1'.repeat(32),assistantId,release:'b'.repeat(40),configFingerprint:hash(config)};
 return {policy,observedRelease:policy.release,context:{signupEventKey:id,contextHash:pv.contextHash,payload},
  attempt:{id:policy.attemptRowId,eventKey:id,businessName:record.businessName,ownerEmail:record.ownerEmail,ownerPhone:record.ownerPhone,
   status:'setup_error',stage:'needs_attention',lastErrorCode:'FIXTURE_ORIGINAL_FAILURE',updatedAt:new Date(now-600000)},
  store:{original:record,unrelated:{signupAttemptId:'signup_'+'e'.repeat(32),status:'archived',businessName:'Other fixture',history:['Preserved']}},
  registry:null,otherAttempts:[],numberStage:{status:'completed',contextHash:pv.contextHash,result:{twilioPhoneNumber:number,twilioSid:policy.twilioSid}},
  assistantStage:{status:'completed',contextHash:pv.contextHash,result:{assistantId,contentFingerprint:fingerprintAssistantContent(config)}},
  importStage:imported?{status:'completed',contextHash:pv.contextHash,result:{id:phoneId,number,assistantId}}:null,
  inventories:{twilio:{httpStatus:200,data:{next_page_uri:null,incoming_phone_numbers:[{sid:policy.twilioSid,phone_number:number,
   account_sid:'AC'+'2'.repeat(32),friendly_name:buildProvisioningResourceName('twilio-number',pv.idempotencyKey),capabilities:{voice:true,sms:true},voice_url:'https://fixture.invalid/inbound'}]}},
   assistants:{httpStatus:200,data:[{id:assistantId,name:config.name}]},assistant:{httpStatus:200,data:{...structuredClone(config),id:assistantId}},
   phones:{httpStatus:200,data:imported?[{id:phoneId,number,assistantId,name:buildProvisioningResourceName('vapi-phone',pv.idempotencyKey),smsEnabled:false}]:[]}},
  signingSecret:secret,twilioAccountSid:'AC'+'2'.repeat(32),readWindow:{startedAt:now-1000,finishedAt:now-500},now};
}
const refused=(f,code)=>assert.throws(()=>prepareNumberConnection(f),code?{code}:undefined);
test('pre-import plan is pure, exact-bound, redacted, partial and grants no application',()=>{
 const f=fixture(),before=structuredClone(f),plan=prepareNumberConnection(f);
 assert.deepEqual(f,before);assert.equal(plan.phase,'prepare_phone_connection');assert.equal(plan.applyAllowed,false);assert.equal(plan.ready,false);
 assert.equal(plan.maximumPhoneImports,1);assert.equal(plan.numbersPurchased,0);assert.equal(plan.messages,0);
 assert.equal(plan.binding.phoneId,null);assert.equal(plan.proposedAttemptFields,null);assert.equal(plan.proposedDashboardFields,null);
 assert.match(plan.requirements.join(' '),/NEVER the broad/);assert.match(plan.remaining.join(' '),/No production runtime/);
 assert.doesNotMatch(JSON.stringify(plan),/fixture@example|Invented Owner|invented-only-signing-secret|authorizationToken|voice_url/);
});
test('exact original row/event, signed context, config and independent release must agree',()=>{
 for(const change of [f=>f.policy.extra=true,f=>f.policy.attemptRowId='differentrow',f=>f.policy.attemptId='signup_'+'c'.repeat(32),
  f=>f.context.signupEventKey='signup_'+'c'.repeat(32),f=>f.context.payload.business.name='Tampered fixture',
  f=>f.signingSecret='other',f=>f.observedRelease='d'.repeat(40),f=>f.policy.configFingerprint='d'.repeat(64),f=>f.context.completedAt=new Date(now).toISOString()]){
  const f=fixture();change(f);refused(f);
 }
});
test('stale/future/overlong/missing read window cannot be fixed with provider timestamps',()=>{
 for(const window of [null,{startedAt:now-61000,finishedAt:now-60000},{startedAt:now,finishedAt:now+1},
  {startedAt:now,finishedAt:now-1},{startedAt:now-31000,finishedAt:now}]){const f=fixture();f.readWindow=window;refused(f,'CONNECTION_EVIDENCE_STALE');}
});
test('closed/changed/ambiguous/protected/billing-bearing records and unknown tenant refuse',()=>{
 for(const change of [f=>f.attempt.status='archived',f=>f.attempt.ownerPhone='+19055550124',
  f=>f.store.original.identityVerified=false,f=>f.store.other={...f.store.original},f=>f.store.original.resourceAssociationRepair={id:'preserved'},
  f=>f.store.original.subscriptionId='fixture',f=>f.attempt.businessId=1,f=>f.store.original.businessId=1,
  f=>f.registry={businessId:1},f=>f.otherAttempts=null,f=>f.otherAttempts=[{eventKey:'foreign'}]]){const f=fixture();change(f);refused(f);}
});
test('all records, including closed history, participate in third-owner conflicts',()=>{
 for(const extra of [{twilioPhoneNumber:'+1 (365) 555-0123'},{vapiAssistantId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},
  {subscriptionId:'fixture-sub',sameBusiness:true}]){const f=fixture();f.store.unrelated={...f.store.unrelated,...(extra.sameBusiness?f.store.original:{}),
   ...extra,signupAttemptId:'signup_'+'e'.repeat(32),status:'archived'};refused(f,'CONNECTION_THIRD_OWNER');}
});
test('completed purchase and assistant receipts must bind exact resources/context/content',()=>{
 for(const change of [f=>f.numberStage=null,f=>f.numberStage.status='processing',f=>f.numberStage.result.twilioSid='PN'+'8'.repeat(32),
  f=>f.assistantStage.status='failed',f=>f.assistantStage.contextHash='changed',f=>f.assistantStage.result.assistantId='foreign',
  f=>f.assistantStage.result.contentFingerprint='a'.repeat(64)]){const f=fixture();change(f);refused(f);}
});
test('failed/truncated/ambiguous inventories never count as empty; number ownership stays strict',()=>{
 for(const change of [f=>f.inventories.twilio.httpStatus=500,f=>f.inventories.twilio.data.next_page_uri='/next',
  f=>f.inventories.twilio.data.incoming_phone_numbers[0].account_sid='AC'+'7'.repeat(32),
  f=>f.inventories.assistants.data={data:[]},f=>f.inventories.assistants.data={data:[],total:1},
  f=>f.inventories.phones.data={data:[],total:0,hasMore:true},f=>f.inventories.assistant.httpStatus=403,
  f=>f.inventories.assistants.data.push({id:'other',name:f.inventories.assistants.data[0].name}),
  f=>f.inventories.phones.data={data:[],total:0,warnings:['invented incomplete inventory']},
  f=>f.inventories.twilio.warnings=['invented failed page']]){const f=fixture();change(f);refused(f);}
});
test('full assistant proof includes tool/security fields and conflicting tenant metadata',()=>{
 for(const change of [f=>f.inventories.assistant.data.model.toolIds=[],f=>f.inventories.assistant.data.firstMessage='Changed',
  f=>f.inventories.assistant.data.metadata={businessId:8},f=>f.inventories.assistants.data[0].businessId=8,
  f=>f.inventories.assistant.data.metadata={businessKey:'foreign'}]){const f=fixture();change(f);refused(f);}
});
test('a phone/resource/claim appearing before import requires a new inspection, never another import',()=>{
 for(const change of [f=>f.inventories.phones.data=[{id:'existing',number:f.policy.number}],f=>f.store.original.vapiAssistantId=f.policy.assistantId,
  f=>f.importStage=undefined,f=>f.importStage={status:'processing'},f=>f.importStage={status:'failed',dispatchStartedAt:'unknown'}]){const f=fixture();change(f);refused(f);}
});
test('post-import association preview requires exact explicit provider binding and disabled SMS',()=>{
 for(const patch of [{number:undefined},{number:'+13655550124'},{assistantId:'foreign'},{smsEnabled:true},{smsEnabled:undefined},
  {name:'other'},{twilioAccountSid:'AC'+'3'.repeat(32)},{metadata:{businessId:9}}]){const f=fixture(true);Object.assign(f.inventories.phones.data[0],patch);refused(f,'CONNECTION_PHONE_BINDING_UNPROVEN');}
});
test('projection changes only three original resource references, retaining failures, trial and delivery evidence and unrelated history',()=>{
 const f=fixture(true),before=structuredClone(f),plan=prepareNumberConnection(f),projected=projectConnectionAssociations(f,plan.planDigest);
 assert.equal(plan.maximumPhoneImports,0);assert.equal(plan.applyAllowed,false);assert.equal(plan.alreadyAssociated,false);
 const oldAttempt=structuredClone(before.attempt),oldRecord=structuredClone(before.store.original);
 for(const key of Object.keys(plan.proposedAttemptFields))delete projected.attempt[key];
 for(const key of Object.keys(plan.proposedDashboardFields))delete projected.store.original[key];
 assert.deepEqual(projected.attempt,oldAttempt);assert.deepEqual(projected.store.original,oldRecord);
 assert.deepEqual(projected.store.unrelated,before.store.unrelated);assert.deepEqual(f,before);
});
test('projection rebuilds proof, detects stale evidence/plan tampering and is idempotent for exact associated state',()=>{
 const f=fixture(true),plan=prepareNumberConnection(f);
 for(const change of [g=>g.store.original.history.push({changed:true}),g=>g.attempt.updatedAt=new Date(now),g=>g.inventories.assistant.data.firstMessage='changed',
  g=>g.importStage.result.id='cccccccc-cccc-4ccc-8ccc-cccccccccccc']){const g=structuredClone(f);change(g);assert.throws(()=>projectConnectionAssociations(g,plan.planDigest));}
 assert.throws(()=>projectConnectionAssociations(f,'wrong'),{code:'CONNECTION_PLAN_CHANGED'});
 const projected=projectConnectionAssociations(f,plan.planDigest);f.attempt=projected.attempt;f.store=projected.store;
 const next=prepareNumberConnection(f);assert.equal(next.alreadyAssociated,true);assert.deepEqual(projectConnectionAssociations(f,next.planDigest).store,f.store);
});
test('conflicting partial associations never overwrite or silently claim ownership',()=>{
 for(const change of [f=>f.attempt.vapiAssistantId='foreign',f=>f.store.original.vapiPhoneNumberId='foreign',
  f=>f.store.unrelated.vapiPhoneNumberId=f.importStage.result.id]){const f=fixture(true);change(f);refused(f);}
});

function extract(start,end){const a=index.indexOf(start),b=index.indexOf(end,a+start.length);assert.ok(a>=0&&b>a);return index.slice(a,b);}
const importCode=extract('async function reconcileVapiPhoneNumberImport(','\nfunction getVapiPhoneNumber(');
const summarizeCode=extract('function sanitizeVapiImportName(','\nasync function findSignupVapiAssistantByResourceName(');
function rehearsal({lostResponse=false,wrongBinding=false,existing=false,blankNumber=false}={}){
 const f=fixture(),db=memoryDb(),requests=[],resources=new Map();let imports=0;
 const phoneId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',name=buildProvisioningResourceName('vapi-phone',f.policy.idempotencyKey);
 const expected={id:phoneId,number:f.policy.number,assistantId:f.policy.assistantId,name,smsEnabled:false};
 if(existing)resources.set(phoneId,structuredClone(expected));
 const ctx={Error,String,Boolean,JSON,VAPI_API_KEY:'invented-vapi-key',VAPI_API_BASE_URL:'https://fixture.invalid',
  TWILIO_ACCOUNT_SID:f.twilioAccountSid,TWILIO_AUTH_TOKEN:'4'.repeat(32),normalizeVapiImportPhone:normalizeNorthAmericanE164,
  buildTwilioImportRequest,verifyVapiPhoneAssistantBinding,getVapiAssistantId:r=>r.assistantId,
  getVapiPhoneNumber:r=>r.number||r.twilioPhoneNumber||'',
  parseJsonObject:s=>JSON.parse(s),createProviderHttpError:()=>Object.assign(Error('Invented provider failure'),{code:'VAPI_TWILIO_IMPORT_FAILED'}),
  fetchVapiCollection:async(resource,_keys,options)=>{assert.equal(resource,'phone-number');assert.equal(options.requireComplete,true);return [...resources.values()].map(x=>structuredClone(x));},
  requestVapiResource:async(resource,{method='GET',body}={})=>{
   assert.equal(resource,'phone-number/'+phoneId);assert.ok(['GET','PATCH'].includes(method));requests.push({resource,method});
   assert.ok(resources.has(phoneId));if(method==='PATCH'){assert.deepEqual(Object.keys(body).sort(),['assistantId','name']);Object.assign(resources.get(phoneId),body);}
   return structuredClone(resources.get(phoneId));
  },
  fetch:async(url,options)=>{
   assert.equal(url,'https://fixture.invalid/phone-number/import/twilio');assert.equal(options.method,'POST');
   const body=JSON.parse(options.body);assert.equal(body.smsEnabled,false);assert.equal(body.twilioPhoneNumber,f.policy.number);assert.equal(body.assistantId,f.policy.assistantId);
   assert.deepEqual(Object.keys(body).sort(),['assistantId','name','smsEnabled','twilioAccountSid','twilioAuthToken','twilioPhoneNumber']);
   imports++;requests.push({resource:'phone-number/import/twilio',method:'POST'});
   const value={...structuredClone(expected),...(wrongBinding?{assistantId:'foreign'}:{}),...(blankNumber?{number:undefined}:{})};resources.set(phoneId,value);
   if(lostResponse)throw Object.assign(Error('Invented lost response'),{code:'ETIMEDOUT'});
   return {ok:true,text:async()=>JSON.stringify(value)};
  }};
 vm.createContext(ctx);vm.runInContext(summarizeCode+'\n'+importCode,ctx);
 for(const [kind,data] of [['twilio-number',f.numberStage],['vapi-assistant',f.assistantStage]]){const key=provisioningStateKey(kind,f.policy.idempotencyKey);db.rows.set(key,{key,data:structuredClone(data)});}
 const worker=()=>()=>runProvisioningStep({prisma:db.prisma,kind:'vapi-import',idempotencyKey:f.policy.idempotencyKey,contextHash:f.policy.contextHash,
  verifyCompleted:async r=>resources.get(r.id)?.assistantId===f.policy.assistantId&&resources.get(r.id)?.number===f.policy.number,
  reconcile:()=>ctx.reconcileVapiPhoneNumberImport({twilioPhoneNumber:f.policy.number,assistantId:f.policy.assistantId,name}),
  execute:()=>ctx.importTwilioPhoneNumberToVapi({twilioPhoneNumber:f.policy.number,assistantId:f.policy.assistantId,name})});
 return {f,db,resources,requests,worker,get imports(){return imports;}};
}
test('sealed rehearsal runs actual import/binding helper and durable state once: no sender, purchase, billing or broad route exists in sandbox',async()=>{
 const r=rehearsal(),before=JSON.stringify([...r.db.rows]);prepareNumberConnection(r.f);
 const result=await r.worker()();assert.equal(result.assistantId,r.f.policy.assistantId);assert.equal(r.imports,1);
 assert.equal(r.db.rows.size,3);assert.equal(JSON.stringify([...r.db.rows].filter(([key])=>!key.includes(':vapi-import:'))),before);
 assert.equal(r.db.rows.get(provisioningStateKey('vapi-import',r.f.policy.idempotencyKey)).data.status,'completed');
 assert.ok(r.requests.every(x=>x.resource.startsWith('phone-number/')));
});
test('simultaneous and reconstructed fixture workers preserve one import and completed receipt',async()=>{
 const r=rehearsal(),results=await Promise.allSettled([r.worker()(),r.worker()(),r.worker()()]);
 assert.ok(results.some(x=>x.status==='fulfilled'));assert.equal(r.imports,1);
 for(const x of results)if(x.status==='rejected')assert.equal(x.reason.code,'PROVISIONING_ALREADY_IN_PROGRESS');
 assert.equal((await r.worker()()).reused,true);assert.equal(r.imports,1);
});
test('20 independent synthetic concurrency/restart repetitions each import once and never alter prerequisite receipts',async()=>{
 for(let i=0;i<20;i++){
  const r=rehearsal(),before=JSON.stringify([...r.db.rows]);
  const outcomes=await Promise.allSettled([r.worker()(),r.worker()(),r.worker()()]);
  assert.ok(outcomes.some(x=>x.status==='fulfilled'));await r.worker()();assert.equal(r.imports,1);
  assert.equal(JSON.stringify([...r.db.rows].filter(([key])=>!key.includes(':vapi-import:'))),before);
 }
});
test('a refusal or failed association projection leaves every input record and original failure intact',()=>{
 const f=fixture(true),plan=prepareNumberConnection(f);f.inventories.phones.data[0].assistantId='foreign';
 const before=structuredClone(f);assert.throws(()=>projectConnectionAssociations(f,plan.planDigest));assert.deepEqual(f,before);
 const pending=fixture(),unchanged=structuredClone(pending);assert.throws(()=>projectConnectionAssociations(pending,'unknown'),{code:'CONNECTION_PLAN_CHANGED'});
 assert.deepEqual(pending,unchanged);
});
test('lost import acknowledgement is never blindly retried: only inspected exact resource can reconcile',async()=>{
 const r=rehearsal({lostResponse:true});await assert.rejects(r.worker()(),{code:'ETIMEDOUT'});
 const key=provisioningStateKey('vapi-import',r.f.policy.idempotencyKey),failed=r.db.rows.get(key).data;
 assert.ok(failed.dispatchStartedAt);assert.equal(failed.status,'failed');assert.equal(failed.originalErrorCode,'ETIMEDOUT');
 const inspected=await r.worker()();assert.equal(inspected.reused,true);assert.equal(r.imports,1);
});
test('unknown import outcome with absent resource stays blocked across reconstructed workers',async()=>{
 const r=rehearsal({lostResponse:true});await assert.rejects(r.worker()(),{code:'ETIMEDOUT'});r.resources.clear();
 await assert.rejects(r.worker()(),{code:'PROVISIONING_RECONCILIATION_REQUIRED'});assert.equal(r.imports,1);
});
test('binding mismatch refuses and preserves failed dispatch instead of stealing another assistant',async()=>{
 const r=rehearsal({wrongBinding:true});await assert.rejects(r.worker()(),{code:'VAPI_PHONE_ASSISTANT_CONFLICT'});
 assert.equal(r.imports,1);assert.equal(r.requests.filter(x=>x.method==='PATCH').length,0);
 assert.equal(r.db.rows.get(provisioningStateKey('vapi-import',r.f.policy.idempotencyKey)).data.status,'failed');
});
test('existing exact phone binding is reused; malformed/absent explicit provider number is blocked by new preparation, not a summary fallback',async()=>{
 const r=rehearsal({existing:true});assert.equal((await r.worker()()).reused,true);assert.equal(r.imports,0);
 const missing=rehearsal({blankNumber:true});await missing.worker()();
 // Existing summarize helper uses the requested number as a fallback. This is
 // deliberately not counted as explicit provider proof for association writes.
 const f=fixture(true);f.inventories.phones.data=[...missing.resources.values()];refused(f,'CONNECTION_PHONE_BINDING_UNPROVEN');
});
test('completion persistence failure never permits a second import or clears completed prerequisite receipts',async()=>{
 const r=rehearsal(),tx=r.db.prisma.$transaction,before=JSON.stringify([...r.db.rows]);let n=0;
 r.db.prisma.$transaction=work=>{if(++n===3)throw Object.assign(Error('Invented completion persistence failure'),{code:'P2028'});return tx(work);};
 await assert.rejects(r.worker()(),{code:'P2028'});r.db.prisma.$transaction=tx;
 await r.worker()();assert.equal(r.imports,1);assert.equal(JSON.stringify([...r.db.rows].filter(([key])=>!key.includes(':vapi-import:'))),before);
});
test('runtime boundary is documented by exact source: broad route would provision SMS and test delivery; preparation does neither',()=>{
 const broad=extract('  "/api/integrations/vapi/import-twilio-number",','\napp.post(');
 assert.match(broad,/safelyProvisionIsolatedSmsForSignup/);assert.match(broad,/testSignupAgentBeforeDelivery/);assert.match(broad,/completeSignupProvisioningContext/);
 const source=fs.readFileSync(require.resolve('../server/signupConnectionPreparation'),'utf8');
 assert.doesNotMatch(source,/require\(['"](?:@prisma\/client|node:fs|fs|https|http)['"]\)|\bfetch\(/);
});
