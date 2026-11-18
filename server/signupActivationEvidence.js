'use strict';
const {signupBusinessKey}=require('./signupBusinessIdentity');
const {contextStoreKey}=require('./signupProvisioningContext');
const {provisioningStateKey}=require('./provisioningState');
const fail=code=>{throw Object.assign(new Error(code),{code,statusCode:409});};
// A consistent read-only database snapshot, followed by read-only provider GETs.
// This is preview evidence, not locked apply evidence or a billing absence proof.
function createActivationEvidenceReader({prisma,readAssistant,readPhone,getSigningSecret}){
 return async policy=>{
  if(!Number.isSafeInteger(policy.businessId)||policy.businessId<1
   ||!/^signup_[a-f0-9]{32}$/.test(policy.signupAttemptId||'')
   ||!/^signup_[a-f0-9]{32}$/.test(policy.phantomId||'')
   ||policy.signupAttemptId===policy.phantomId)fail('ACTIVATION_POLICY_REQUIRED');
  const proof=await prisma.$transaction(async tx=>{
   await tx.$executeRaw`SET TRANSACTION READ ONLY`;
   const attempt=await tx.signupAttempt.findUnique({where:{eventKey:policy.signupAttemptId}});
   const key=signupBusinessKey(attempt||{});
   if(!key)fail('ACTIVATION_SOURCE_REQUIRED');
   const phantom=await tx.signupAttempt.findUnique({where:{eventKey:policy.phantomId}});
   if(phantom)fail('ACTIVATION_PHANTOM_CONFLICT');
   const context=(await tx.runtimeStore.findUnique({where:{key:contextStoreKey(key)}}))?.data;
   const receipt=(await tx.runtimeStore.findUnique({where:{key:provisioningStateKey('vapi-assistant',key)}}))?.data;
   const billingRow=await tx.runtimeStore.findUnique({where:{key:provisioningStateKey('stripe-trial',key)}});
   const business=await tx.business.findUnique({where:{id:policy.businessId},include:{settings:true,vapiMappings:true}});
   return {attempt,context,receipt,billingReceipt:billingRow?billingRow.data:null,business};
  },{isolationLevel:'RepeatableRead',maxWait:5000,timeout:10000});
  if(!proof.attempt.vapiAssistantId||!proof.attempt.vapiPhoneNumberId)fail('ACTIVATION_ROUTE_CONFLICT');
  const [assistant,phone]=await Promise.all([readAssistant(proof.attempt.vapiAssistantId),readPhone(proof.attempt.vapiPhoneNumberId)]);
  return {...proof,assistant,phone,signingSecret:getSigningSecret()};
 };
}
// Apply adapter: uses the caller's transaction and existing provisioning locks.
// Missing rows are protected only against cooperating application writers, not
// arbitrary direct SQL. Single-process lifecycle fencing remains mandatory.
function createStableActivationProof({readAssistant,readPhone,getSigningSecret}){
 return async(tx,policy,run)=>{
  if(!Number.isSafeInteger(policy.businessId)||policy.businessId<1
   ||!/^signup_[a-f0-9]{32}$/.test(policy.signupAttemptId||'')
   ||!/^signup_[a-f0-9]{32}$/.test(policy.phantomId||'')||policy.signupAttemptId===policy.phantomId)fail('ACTIVATION_POLICY_REQUIRED');
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${'signup-business-bindings:v1'}))::text AS lock_result`;
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`bounded-business:${policy.businessId}`}))::text AS lock_result`;
  await tx.$queryRaw`SELECT id FROM "Business" WHERE id = ${policy.businessId} FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM "Settings" WHERE "businessId" = ${policy.businessId} FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM "VapiBusinessMapping" WHERE "businessId" = ${policy.businessId} FOR SHARE`;
  await tx.$queryRaw`SELECT "eventKey" FROM "SignupAttempt" WHERE "eventKey" IN (${policy.signupAttemptId}, ${policy.phantomId}) ORDER BY "eventKey" FOR SHARE`;
  const attempt=await tx.signupAttempt.findUnique({where:{eventKey:policy.signupAttemptId}}),key=signupBusinessKey(attempt||{});
  if(!key)fail('ACTIVATION_SOURCE_REQUIRED');
  const keys=[contextStoreKey(key),...['vapi-assistant','stripe-trial'].map(kind=>provisioningStateKey(kind,key))].sort();
  for(const k of keys){
   await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${k}))::text AS lock_result`;
   await tx.$queryRaw`SELECT key FROM "RuntimeStore" WHERE key = ${k} FOR SHARE`;
  }
  if(await tx.signupAttempt.findUnique({where:{eventKey:policy.phantomId}}))fail('ACTIVATION_PHANTOM_CONFLICT');
  const context=(await tx.runtimeStore.findUnique({where:{key:contextStoreKey(key)}}))?.data;
  const receipt=(await tx.runtimeStore.findUnique({where:{key:provisioningStateKey('vapi-assistant',key)}}))?.data;
  const billing=await tx.runtimeStore.findUnique({where:{key:provisioningStateKey('stripe-trial',key)}});
  const business=await tx.business.findUnique({where:{id:policy.businessId},include:{settings:true,vapiMappings:true}});
  if(!attempt.vapiAssistantId||!attempt.vapiPhoneNumberId)fail('ACTIVATION_ROUTE_CONFLICT');
  const [assistant,phone]=await Promise.all([readAssistant(attempt.vapiAssistantId),readPhone(attempt.vapiPhoneNumberId)]);
  return run({attempt,context,receipt,billingReceipt:billing?billing.data:null,business,assistant,phone,signingSecret:getSigningSecret()});
 };
}
module.exports={createActivationEvidenceReader,createStableActivationProof};
