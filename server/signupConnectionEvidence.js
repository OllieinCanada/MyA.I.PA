'use strict';
const {contextStoreKey}=require('./signupProvisioningContext');
const {provisioningStateKey}=require('./provisioningState');
const {digest}=require('./signupAssociationRepair');
const select={id:true,eventKey:true,status:true,stage:true,lastErrorCode:true,businessName:true,ownerEmail:true,ownerPhone:true,
 rejectedAt:true,assignedPhone:true,vapiAssistantId:true,vapiPhoneNumberId:true,updatedAt:true};
const fail=code=>{throw Object.assign(new Error(code),{code,statusCode:409});};
// All normal registry/mapping writers share this lock. Row locks also stabilize
// the real source/context/completed receipts. Missing rows do not protect against
// noncooperating direct SQL. Single-writer application coordination is required.
async function readConnectionDatabase(tx,p,{lock=false,operation}={}){
 const keys=[contextStoreKey(p.idempotencyKey),...['twilio-number','vapi-assistant',...(operation==='associate'?['vapi-import']:[])].map(k=>provisioningStateKey(k,p.idempotencyKey))].sort();
 if(lock){
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${'signup-business-bindings:v1'}))::text AS locked`;
  await tx.$queryRaw`SELECT id FROM "SignupAttempt" WHERE "eventKey"=${p.attemptId} FOR UPDATE`;
  for(const key of keys){
   await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))::text AS locked`;
   await tx.$queryRaw`SELECT key FROM "RuntimeStore" WHERE key=${key} FOR SHARE`;
  }
  await tx.$queryRaw`SELECT key FROM "RuntimeStore" WHERE key=${'signup-business:'+p.idempotencyKey} FOR SHARE`;
 }
 const context=(await tx.runtimeStore.findUnique({where:{key:contextStoreKey(p.idempotencyKey)}}))?.data;
 const attempt=await tx.signupAttempt.findUnique({where:{eventKey:p.attemptId},select});
 const stages=await Promise.all(['twilio-number','vapi-assistant','vapi-import'].map(kind=>tx.runtimeStore.findUnique({where:{key:provisioningStateKey(kind,p.idempotencyKey)}})));
 const registry=(await tx.runtimeStore.findUnique({where:{key:'signup-business:'+p.idempotencyKey}}))?.data||null;
 const otherAttempts=await tx.signupAttempt.findMany({where:{eventKey:{not:p.attemptId},OR:[{assignedPhone:p.number},{vapiAssistantId:p.assistantId},
  ...(stages[2]?.data?.result?.id?[{vapiPhoneNumberId:stages[2].data.result.id}]:[])]},select:{eventKey:true}});
 const routingKeys=[p.number,p.assistantId,...(stages[2]?.data?.result?.id?[stages[2].data.result.id]:[])];
 const mappings=await tx.vapiBusinessMapping.findMany({where:{matchValue:{in:routingKeys}},select:{id:true,businessId:true,matchType:true,matchValue:true}});
 // This bounded original-record path never migrates/steals a mapped tenant.
 if(mappings.length)fail('CONNECTION_MAPPING_SCOPE_CHANGED');
 return {context,attempt,registry,otherAttempts,numberStage:stages[0]?.data||null,assistantStage:stages[1]?.data||null,importStage:stages[2]?.data||null};
}
const databaseDigest=e=>digest(Object.fromEntries(['context','attempt','registry','otherAttempts','numberStage','assistantStage','importStage'].map(k=>[k,e[k]])));
function createConnectionReader({prisma,readStore,transport,getSigningSecret,getRelease,getPendingGate=()=>null,readOverrides=()=>'',now=()=>Date.now()}){
 return async(p,operation)=>{
  const startedAt=now();
  const db=await prisma.$transaction(async tx=>{
   await tx.$executeRaw`SET TRANSACTION READ ONLY`;
   return readConnectionDatabase(tx,p,{operation});
  },{isolationLevel:'RepeatableRead',maxWait:2000,timeout:10000});
  const providers=await transport.readInventories(p);
  const store=readStore(),raw=String(readOverrides()||'').trim();
  if(raw){
   let parsed;try{parsed=JSON.parse(raw);}catch{fail('CONNECTION_OVERRIDES_UNVERIFIED');}
   if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))fail('CONNECTION_OVERRIDES_UNVERIFIED');
   const keys=[p.number,p.assistantId,db.importStage?.result?.id].filter(Boolean);
   if(Object.keys(parsed).some(k=>keys.includes(k.trim().toLowerCase())))fail('CONNECTION_MAPPING_SCOPE_CHANGED');
  }
  return {...db,...providers,policy:p,store,operation,pendingGate:getPendingGate(),observedRelease:getRelease(),signingSecret:getSigningSecret(),
   readWindow:{startedAt,finishedAt:now()},now:now()};
 };
}
module.exports={createConnectionReader,readConnectionDatabase,databaseDigest};
