'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createActivationSave,PREFIX}=require('../server/signupActivationSave');
const {createActivationEvidenceReader,createStableActivationProof}=require('../server/signupActivationEvidence');
const {prepareVerifiedSignupRecord}=require('../server/signupActivationPreparation');
const {digest,createAssociationFence}=require('../server/signupAssociationRepair');
const {normalizeSignupProvisioningPayload}=require('../server/signupProvisioning');
const {buildMakeSignupEventKey}=require('../server/makeSignupWebhook');
const {buildSignupAssistantConfig}=require('../server/signupAssistantTemplate');
const {fingerprintAssistantContent}=require('../server/signupAssistantVerification');
const {contextStoreKey}=require('../server/signupProvisioningContext');
const {provisioningStateKey}=require('../server/provisioningState');
const {VERSION}=require('../server/trialCalendarPolicy');

test('disposable PostgreSQL: real reader, locked save, duplicate/refusal and preserved records',
 {skip:process.env.RUN_ACTIVATION_POSTGRES!=='1',timeout:60000},async t=>{
 const url=new URL(process.env.DATABASE_URL);
 assert.ok(process.env.GITHUB_ACTIONS==='true'&&url.hostname==='127.0.0.1'&&url.pathname==='/ci','Only disposable CI service is supported');
 const {PrismaClient}=require('@prisma/client'),prisma=new PrismaClient();
 const suffix=crypto.randomUUID(),secret='synthetic-activation-only-key';
 const raw={business:{name:'Fictitious '+suffix,services:'Invented repair'},businessType:'Electrical',serviceArea:'Imaginary region',owner:{email:'fake@example.test',phone:'+19055550123'},verification:{smsVerified:true}};
 const payload=normalizeSignupProvisioningPayload(raw,{signingSecret:secret}),id=buildMakeSignupEventKey(raw),phantomId='signup_'+crypto.randomBytes(16).toString('hex');
 const assistant={...buildSignupAssistantConfig(payload,{assignedPhone:'+13655550101',resourceName:'Synthetic assistant'}),id:'fake-assistant-'+suffix};
 const phone={id:'fake-phone-'+suffix,number:'+13655550101',assistantId:assistant.id};
 const context={signupEventKey:id,payload,contextHash:payload.provisioning.contextHash};
 const keys=[contextStoreKey(payload.provisioning.idempotencyKey),provisioningStateKey('vapi-assistant',payload.provisioning.idempotencyKey)];
 let business,policy,journalKey;
 try{
  business=await prisma.business.create({data:{name:raw.business.name,phone:phone.number,timezone:'America/Toronto',settings:{create:{ownerPhone:raw.owner.phone}},vapiMappings:{create:[['phoneNumber',phone.number],['phoneNumberId',phone.id],['assistantId',assistant.id]].map(([matchType,matchValue])=>({matchType,matchValue}))}}});
  await prisma.signupAttempt.create({data:{eventKey:id,publicId:'fixture-'+suffix,statusTokenHash:'synthetic-no-login',businessName:raw.business.name,ownerEmail:raw.owner.email,ownerPhone:raw.owner.phone,payload:raw,status:'setup_error',expiresAt:new Date(Date.now()+60000),assignedPhone:phone.number,vapiAssistantId:assistant.id,vapiPhoneNumberId:phone.id}});
  await prisma.runtimeStore.create({data:{key:keys[0],data:context}});
  await prisma.runtimeStore.create({data:{key:keys[1],data:{status:'completed',contextHash:context.contextHash,result:{assistantId:assistant.id,contentFingerprint:fingerprintAssistantContent(assistant)}}}});
  policy={signupAttemptId:id,phantomId,businessId:business.id,calendarPolicy:VERSION};journalKey=PREFIX+digest(policy);
  const deps={prisma,readAssistant:async()=>structuredClone(assistant),readPhone:async()=>structuredClone(phone),getSigningSecret:()=>secret};
  const proof=await createActivationEvidenceReader(deps)(policy),time=new Date().toISOString();
  let store={original:{signupAttemptId:id,businessName:raw.business.name,ownerEmail:raw.owner.email,ownerPhone:raw.owner.phone,smsVerified:true,status:'setup_error',twilioPhoneNumber:phone.number,vapiPhoneNumberId:phone.id,vapiAssistantId:assistant.id},phantom:{signupAttemptId:phantomId,status:'superseded_duplicate',history:['keep']},other:{keep:true}},writes=0;
  const before=structuredClone(store),sourceBefore=await prisma.signupAttempt.findUnique({where:{eventKey:id}});
  const plan=prepareVerifiedSignupRecord({...proof,records:Object.values(store),consent:policy,now:time});
  const options={prisma,fence:createAssociationFence(),readStore:()=>structuredClone(store),commitStore:project=>{store=project(store);writes++;},withStableProof:createStableActivationProof(deps),getPolicy:()=>policy,authorized:()=>true,enabled:()=>true,singleWriter:()=>true,now:()=>new Date().toISOString()};
  const request={actor:'synthetic-operator',expectedPlanDigest:plan.planDigest,verifiedAt:time,confirmation:'SAVE_VERIFIED_SETUP_ONLY'};
  await t.test('actual SQL proof and save succeed without readiness/trial/delivery claims',async()=>{
   assert.equal((await createActivationSave(options)(request)).saved,true);assert.equal(writes,1);
   assert.equal(store.original.agentContentStatus,'verified');assert.equal(store.original.trialCalendarEnrollmentVersion,VERSION);
   assert.equal(store.original.status,'setup_error');assert.equal(store.original.trialStartAt,undefined);
   assert.equal((await prisma.runtimeStore.findUnique({where:{key:journalKey}})).data.phase,'completed');
  });
  await t.test('new service instance refuses duplicate and preserves original SQL source/history',async()=>{
   await assert.rejects(createActivationSave(options)(request),/INSPECT_FIRST/);assert.equal(writes,1);
   assert.deepEqual(store.phantom,before.phantom);assert.deepEqual(store.other,before.other);
   assert.deepEqual(await prisma.signupAttempt.findUnique({where:{eventKey:id}}),sourceBefore);
  });
  await t.test('SQL read-only preview cannot mutate records and provider failures refuse',async()=>{
   await assert.rejects(createActivationEvidenceReader({...deps,readPhone:async()=>{throw Error('synthetic timeout');}})(policy),/timeout/);
   assert.equal(writes,1);assert.deepEqual(await prisma.signupAttempt.findUnique({where:{eventKey:id}}),sourceBefore);
  });
 }finally{
  if(journalKey)await prisma.runtimeStore.deleteMany({where:{key:journalKey}});
  await prisma.runtimeStore.deleteMany({where:{key:{in:keys}}});
  await prisma.signupAttempt.deleteMany({where:{eventKey:id}});
  if(business)await prisma.business.delete({where:{id:business.id}});
  assert.equal(await prisma.signupAttempt.count({where:{eventKey:id}}),0);
  assert.equal(await prisma.runtimeStore.count({where:{key:{in:[...keys,...journalKey?[journalKey]:[]]}}}),0);
  await prisma.$disconnect();
 }
});
