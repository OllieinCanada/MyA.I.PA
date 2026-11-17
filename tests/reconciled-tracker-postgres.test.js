'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {digest}=require('../server/signupAssociationRepair');
const {readReconciledBusiness}=require('../server/reconciledTrackerEvidence');
const enabled=process.env.RUN_OBSERVABILITY_POSTGRES==='1';
if(enabled){const u=new URL(process.env.DATABASE_URL||'');assert.equal(process.env.CI,'true');assert.ok(['127.0.0.1','localhost'].includes(u.hostname));assert.equal(u.pathname,'/ci');assert.equal(u.username,'ci');}
test('real disposable SQL: recovered tracker reads are read-only, exact and fail closed',{skip:!enabled,timeout:30000},async t=>{
 const {PrismaClient}=require('@prisma/client'),db=new PrismaClient(),token=crypto.randomUUID();
 const record={signupAttemptId:'signup_'+digest(token).slice(0,32),twilioPhoneNumber:'+13655550101',vapiPhoneNumberId:crypto.randomUUID(),vapiAssistantId:crypto.randomUUID()};
 const context={contextHash:digest(token+'context')},phantomId='signup_'+digest(token+'phantom').slice(0,32);
 const values={twilioPhoneNumber:record.twilioPhoneNumber,vapiAssistantId:record.vapiAssistantId,vapiPhoneNumberId:record.vapiPhoneNumberId};
 const id=digest({ids:[record.signupAttemptId,phantomId],contextHash:context.contextHash,values}),operationId=digest({version:1,phoneId:record.vapiPhoneNumberId});
 record.resourceAssociationRepair={id,sourceId:record.signupAttemptId,phantomId,values};
 const associationKey='signup-association-repair:v1:'+id,mappingKey='bounded-business-mapping:v1:'+operationId,keys=[associationKey,mappingKey];
 const receipts={'twilio-number':{status:'completed',result:{twilioPhoneNumber:values.twilioPhoneNumber}},'vapi-assistant':{status:'completed',result:{assistantId:values.vapiAssistantId}},'vapi-import':{status:'completed',result:{id:values.vapiPhoneNumberId,number:values.twilioPhoneNumber,assistantId:values.vapiAssistantId}}};
 const businessIds=[];let owns=false,rows;
 const readonly={$transaction:(fn,options)=>db.$transaction(async tx=>{await tx.$executeRaw`SET TRANSACTION READ ONLY`;return fn(tx);},options)};
 const snapshot=async()=>JSON.stringify({journals:await db.runtimeStore.findMany({where:{key:{in:keys}},orderBy:{key:'asc'}}),mappings:await db.vapiBusinessMapping.findMany({where:{businessId:{in:businessIds}},orderBy:{id:'asc'}})});
 const read=()=>readReconciledBusiness({prisma:readonly,record,context,receipts});
 try{
  assert.equal(await db.runtimeStore.count({where:{key:{in:keys}}}),0);owns=true;
  for(let i=0;i<2;i++)businessIds.push((await db.business.create({data:{name:'Synthetic tracker '+token+' '+i,phone:'+19055550100',timezone:'America/Toronto'}})).id);
  rows=[];for(const [matchType,matchValue]of [['phoneNumber',values.twilioPhoneNumber],['phoneNumberId',values.vapiPhoneNumberId],['assistantId',values.vapiAssistantId]])rows.push(await db.vapiBusinessMapping.create({data:{businessId:businessIds[0],matchType,matchValue}}));
  const association={phase:'completed',repairId:id,scope:{sourceId:record.signupAttemptId,phantomId,number:values.twilioPhoneNumber,assistantId:values.vapiAssistantId,phoneId:values.vapiPhoneNumberId}};
  const mapping={phase:'completed',operationId,inserted:JSON.parse(JSON.stringify(rows))};
  await db.runtimeStore.create({data:{key:associationKey,data:association}});await db.runtimeStore.create({data:{key:mappingKey,data:mapping}});
  await t.test('actual reader succeeds in a native read-only transaction without changing rows',async()=>{const before=await snapshot();assert.equal((await read()).id,businessIds[0]);assert.equal(await snapshot(),before);});
  await t.test('uncertain journal is not completed evidence',async()=>{await db.runtimeStore.update({where:{key:mappingKey},data:{data:{...mapping,phase:'attempt_started'}}});const before=await snapshot();assert.equal(await read(),null);assert.equal(await snapshot(),before);await db.runtimeStore.update({where:{key:mappingKey},data:{data:mapping}});});
  await t.test('cross-tenant mapping refuses without modifications',async()=>{await db.vapiBusinessMapping.update({where:{id:rows[2].id},data:{businessId:businessIds[1]}});const before=await snapshot();assert.equal(await read(),null);assert.equal(await snapshot(),before);await db.vapiBusinessMapping.update({where:{id:rows[2].id},data:{businessId:businessIds[0]}});});
  await t.test('changed source/context and absent mappings cannot pass',async()=>{const before=await snapshot();assert.equal(await readReconciledBusiness({prisma:readonly,record,context:{contextHash:digest('changed')},receipts}),null);await db.vapiBusinessMapping.delete({where:{id:rows[2].id}});const missing=await snapshot();assert.equal(await read(),null);assert.equal(await snapshot(),missing);assert.notEqual(missing,before);});
 }finally{
  if(owns){await db.runtimeStore.deleteMany({where:{key:{in:keys}}});if(businessIds.length){await db.vapiBusinessMapping.deleteMany({where:{businessId:{in:businessIds}}});await db.business.deleteMany({where:{id:{in:businessIds}}});}assert.equal(await db.runtimeStore.count({where:{key:{in:keys}}}),0);assert.equal(await db.business.count({where:{id:{in:businessIds}}}),0);}
  await db.$disconnect();
 }
});
