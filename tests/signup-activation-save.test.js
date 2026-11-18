'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createActivationSave}=require('../server/signupActivationSave');
const {createAssociationFence}=require('../server/signupAssociationRepair');
const {atomicCommitAssociationFile}=require('../server/signupAssociationRepair');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {prepareVerifiedSignupRecord}=require('../server/signupActivationPreparation');
const {normalizeSignupProvisioningPayload}=require('../server/signupProvisioning');
const {buildMakeSignupEventKey}=require('../server/makeSignupWebhook');
const {buildSignupAssistantConfig}=require('../server/signupAssistantTemplate');
const {fingerprintAssistantContent}=require('../server/signupAssistantVerification');
const {VERSION}=require('../server/trialCalendarPolicy');
function fixture(){
 const secret='invented-only-save-test-secret';
 const raw={business:{name:'Imaginary Electrical',services:'Imaginary repairs'},businessType:'Electrical',serviceArea:'Fictional area',owner:{email:'fake@example.test',phone:'+19055550123'},verification:{smsVerified:true}};
 const payload=normalizeSignupProvisioningPayload(raw,{signingSecret:secret}),id=buildMakeSignupEventKey(raw),phantomId='signup_'+'f'.repeat(32),time='2026-11-17T23:30:00.000Z';
 const record={signupAttemptId:id,businessName:raw.business.name,ownerEmail:raw.owner.email,ownerPhone:raw.owner.phone,smsVerified:true,status:'setup_error',twilioPhoneNumber:'+13655550101',vapiPhoneNumberId:'fake-phone',vapiAssistantId:'fake-assistant'};
 const assistant={...buildSignupAssistantConfig(payload,{assignedPhone:record.twilioPhoneNumber,resourceName:'Fake assistant'}),id:record.vapiAssistantId};
 const proof={attempt:{eventKey:id,payload:raw,businessName:record.businessName,ownerEmail:record.ownerEmail,ownerPhone:record.ownerPhone,assignedPhone:record.twilioPhoneNumber,vapiPhoneNumberId:record.vapiPhoneNumberId,vapiAssistantId:record.vapiAssistantId},
  context:{signupEventKey:id,payload,contextHash:payload.provisioning.contextHash},receipt:{status:'completed',contextHash:payload.provisioning.contextHash,result:{assistantId:assistant.id,contentFingerprint:fingerprintAssistantContent(assistant)}},assistant,
  phone:{id:record.vapiPhoneNumberId,number:record.twilioPhoneNumber,assistantId:assistant.id},business:{id:7,settings:{ownerPhone:record.ownerPhone},vapiMappings:[['phoneNumber',record.twilioPhoneNumber],['phoneNumberId',record.vapiPhoneNumberId],['assistantId',assistant.id]].map(([matchType,matchValue])=>({businessId:7,matchType,matchValue}))},signingSecret:secret,billingReceipt:null};
 const policy={signupAttemptId:id,phantomId,calendarPolicy:VERSION,businessId:7};
 let store={original:record,phantom:{signupAttemptId:phantomId,status:'superseded_duplicate',history:['preserve']},other:{untouched:true}},journal=new Map(),writes=0;
 const state={proof,policy,clock:time,allowed:true,flag:true,loseCompletion:false,afterLock:null};
 const prisma={$transaction:async fn=>{
  const copy=new Map(structuredClone([...journal]));
  const tx={$queryRaw:async()=>{if(state.afterLock)await state.afterLock();},runtimeStore:{findUnique:async({where})=>copy.has(where.key)?{data:structuredClone(copy.get(where.key))}:null,
   create:async({data})=>{assert.ok(!copy.has(data.key));copy.set(data.key,structuredClone(data.data));},update:async({where,data})=>copy.set(where.key,structuredClone(data.data))}};
  await fn(tx);if(state.loseCompletion&&[...copy.values()].some(r=>r.phase==='completed'))throw Error('synthetic lost acknowledgement');journal=copy;
 }};
 const options={prisma,fence:createAssociationFence(),readStore:()=>structuredClone(store),commitStore:project=>{store=project(store);writes++;},getPolicy:()=>state.policy,
  withStableProof:async(_tx,_policy,run)=>run(proof),authorized:()=>state.allowed,enabled:()=>state.flag,singleWriter:()=>true,now:()=>state.clock};
 const plan=prepareVerifiedSignupRecord({...proof,records:Object.values(store),consent:policy,now:time});
 const request={actor:'invented-operator',expectedPlanDigest:plan.planDigest,verifiedAt:time,confirmation:'SAVE_VERIFIED_SETUP_ONLY'};
 return {state,options,request,read:()=>structuredClone(store),writes:()=>writes,journal:()=>[...journal.values()]};
}
test('bounded save preserves phantom/unrelated rows and never starts trial or claims delivery',async()=>{
 const f=fixture(),before=f.read(),result=await createActivationSave(f.options)(f.request);
 assert.deepEqual(result,{saved:true,ready:false,trialStarted:false,messagesSent:0});assert.equal(f.writes(),1);
 assert.deepEqual(f.read().phantom,before.phantom);assert.deepEqual(f.read().other,before.other);
 assert.equal(f.read().original.status,'setup_error');assert.equal(f.read().original.trialStartAt,undefined);assert.equal(f.journal()[0].phase,'completed');
 await assert.rejects(createActivationSave(f.options)(f.request),/INSPECT_FIRST/);assert.equal(f.writes(),1);
});
for(const [name,change] of [
 ['disabled',f=>f.state.flag=false],['unauthorized',f=>f.state.allowed=false],['missing proof adapter',f=>delete f.options.withStableProof],
 ['missing single-writer confirmation',f=>f.options.singleWriter=()=>false],['wrong confirmation',f=>f.request.confirmation='activate'],
 ['stale approval',f=>f.state.clock='2026-11-17T23:32:00.000Z'],['wrong plan',f=>f.request.expectedPlanDigest='0'.repeat(64)],
 ['changed script',f=>f.state.proof.assistant.firstMessage='Changed'],['changed source',f=>f.state.proof.attempt.payload.business.name='Different']
])test(name+' refuses zero file writes',async()=>{const f=fixture();change(f);await assert.rejects(createActivationSave(f.options)(f.request));assert.equal(f.writes(),0);});
test('authorization revoked while waiting on lock refuses before file write',async()=>{
 const f=fixture();let locks=0;f.state.afterLock=async()=>{if(++locks===2)f.state.allowed=false;};
 await assert.rejects(createActivationSave(f.options)(f.request),/DISABLED/);assert.equal(f.writes(),0);assert.equal(f.journal()[0].phase,'prepared');
});
test('flag disabled in stable proof callback refuses at dispatch',async()=>{
 const f=fixture();f.options.withStableProof=async(_tx,_p,run)=>{f.state.flag=false;return run(f.state.proof);};
 await assert.rejects(createActivationSave(f.options)(f.request),/DISABLED/);assert.equal(f.writes(),0);
});
test('lost completion acknowledgement retains intent; new service cannot repeat write',async()=>{
 const f=fixture();f.state.loseCompletion=true;await assert.rejects(createActivationSave(f.options)(f.request),/UNCERTAIN_INSPECT_FIRST/);
 assert.equal(f.writes(),1);assert.equal(f.journal()[0].phase,'prepared');
 f.state.loseCompletion=false;await assert.rejects(createActivationSave(f.options)(f.request),/INSPECT_FIRST/);assert.equal(f.writes(),1);
});
test('shared running fence excludes a second concurrent instance',async()=>{
 const f=fixture();let resume;const blocked=new Promise(r=>resume=r);
 f.options.withStableProof=async(_tx,_p,run)=>{await blocked;return run(f.state.proof);};
 const first=createActivationSave(f.options)(f.request);
 await assert.rejects(createActivationSave(f.options)(f.request),/BUSY/);resume();await first;assert.equal(f.writes(),1);
});
test('adapter omitting callback cannot report a successful save',async()=>{
 const f=fixture();f.options.withStableProof=async()=>{};
 await assert.rejects(createActivationSave(f.options)(f.request),/LOCKED_PROOF_REQUIRED/);assert.equal(f.writes(),0);
});
test('adapter repeating callback leaves uncertainty and never repeats file write',async()=>{
 const f=fixture();f.options.withStableProof=async(_tx,_p,run)=>{await run(f.state.proof);await run(f.state.proof);};
 await assert.rejects(createActivationSave(f.options)(f.request),/UNCERTAIN_INSPECT_FIRST/);assert.equal(f.writes(),1);assert.equal(f.journal()[0].phase,'prepared');
});
test('actual atomic JSON writer preserves history and unrelated rows in an execution-owned fixture',async t=>{
 const f=fixture(),directory=fs.mkdtempSync(path.join(os.tmpdir(),'activation-save-fixture-'));
 const file=path.join(directory,'fake-signups.json');
 t.after(()=>{for(const name of fs.readdirSync(directory))fs.unlinkSync(path.join(directory,name));fs.rmdirSync(directory);});
 fs.writeFileSync(file,JSON.stringify(f.read()));
 const before=JSON.parse(fs.readFileSync(file,'utf8'));
 f.options.readStore=()=>JSON.parse(fs.readFileSync(file,'utf8'));
 f.options.commitStore=project=>atomicCommitAssociationFile(file,project);
 const result=await createActivationSave(f.options)(f.request),after=f.options.readStore();
 assert.equal(result.saved,true);assert.deepEqual(after.phantom,before.phantom);assert.deepEqual(after.other,before.other);
 assert.equal(after.original.agentContentStatus,'verified');assert.equal(after.original.status,'setup_error');
 assert.deepEqual(fs.readdirSync(directory),['fake-signups.json']);
});
test('uncertain file readback leaves durable intent and requires inspection',async()=>{
 const f=fixture(),commit=f.options.commitStore;f.options.commitStore=project=>{commit(project);throw Error('synthetic lost readback');};
 await assert.rejects(createActivationSave(f.options)(f.request),/UNCERTAIN_INSPECT_FIRST/);
 assert.equal(f.journal()[0].phase,'prepared');assert.equal(f.writes(),1);
 await assert.rejects(createActivationSave(f.options)(f.request),/INSPECT_FIRST/);assert.equal(f.writes(),1);
});
