'use strict';
const {digest}=require('./signupAssociationRepair');
const {prepareVerifiedSignupRecord,projectPreparedVerification}=require('./signupActivationPreparation');
const fail=code=>{throw Object.assign(new Error(code),{code,statusCode:409});};
const PREFIX='signup-verified-save:v1:';

// Local integration component, deliberately not registered with the live server.
// withStableProof must hold the real source/context/receipt/business locks through
// the synchronous file projection and journal completion. Preview readers do NOT
// satisfy that adapter contract. No billing/provider mutation/message callbacks.
function createActivationSave({prisma,fence,readStore,commitStore,withStableProof,
 getPolicy,authorized=()=>false,enabled=()=>false,singleWriter=()=>false,now=()=>new Date().toISOString()}){
 function admission(actor,policy){
  if(enabled()!==true||singleWriter()!==true||authorized(actor,policy)!==true)fail('ACTIVATION_SAVE_DISABLED');
 }
 return async function save({actor,expectedPlanDigest,verifiedAt,confirmation}){
  const policy=structuredClone(getPolicy());
  if(!policy||!/^signup_[a-f0-9]{32}$/.test(policy.signupAttemptId||'')
   ||!/^signup_[a-f0-9]{32}$/.test(policy.phantomId||'')||policy.phantomId===policy.signupAttemptId)fail('ACTIVATION_POLICY_REQUIRED');
  admission(actor,policy);
  if(confirmation!=='SAVE_VERIFIED_SETUP_ONLY'||!/^[a-f0-9]{64}$/.test(expectedPlanDigest||'')
   ||!Number.isFinite(Date.parse(now()))||!Number.isFinite(Date.parse(verifiedAt))||Date.parse(now())-Date.parse(verifiedAt)>60000
   ||Date.parse(verifiedAt)>Date.parse(now()))fail('ACTIVATION_SAVE_CONFIRMATION_REQUIRED');
  if(typeof withStableProof!=='function')fail('ACTIVATION_LOCKED_PROOF_REQUIRED');
  const ids=[policy.signupAttemptId,policy.phantomId],key=PREFIX+digest(policy);
  fence.hold(ids);
  let fileAttempted=false;
  try{
   // Durable intent commits BEFORE the file can change. A pending intent always
   // requires inspection, including across new service instances/process restart.
   await prisma.$transaction(async tx=>{
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))::text AS lock_result`;
    if(await tx.runtimeStore.findUnique({where:{key}}))fail('ACTIVATION_SAVE_INSPECT_FIRST');
    admission(actor,policy);
    if(digest(getPolicy())!==digest(policy))fail('ACTIVATION_POLICY_CHANGED');
    await tx.runtimeStore.create({data:{key,data:{phase:'prepared',planDigest:expectedPlanDigest,policyDigest:digest(policy),verifiedAt}}});
   });
   await prisma.$transaction(async tx=>{
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))::text AS lock_result`;
    const row=await tx.runtimeStore.findUnique({where:{key}});
    if(row?.data?.phase!=='prepared'||row.data.planDigest!==expectedPlanDigest)fail('ACTIVATION_SAVE_INSPECT_FIRST');
    let admitted=false;
    await withStableProof(tx,policy,async proof=>{
     if(admitted)fail('ACTIVATION_PROOF_CALLBACK_REPEATED');
     admitted=true;
     const plan=prepareVerifiedSignupRecord({...proof,records:Object.values(readStore()),consent:policy,now:verifiedAt});
     if(plan.planDigest!==expectedPlanDigest)fail('ACTIVATION_STALE_PLAN');
     // Final admission AFTER database locks/provider reads; never use the
     // authorization decision made before a potentially long lock wait.
     admission(actor,policy);
     if(digest(getPolicy())!==digest(policy)||!Number.isFinite(Date.parse(now()))
      ||Date.parse(now())-Date.parse(verifiedAt)>60000||Date.parse(now())<Date.parse(verifiedAt))fail('ACTIVATION_POLICY_CHANGED');
     fileAttempted=true;
     const result=commitStore(current=>projectPreparedVerification(current,plan));
     if(result&&typeof result.then==='function')fail('ACTIVATION_SYNCHRONOUS_COMMIT_REQUIRED');
     const saved=Object.values(readStore()).filter(r=>r.signupAttemptId===policy.signupAttemptId);
     if(saved.length!==1||Object.entries(plan.patch).some(([k,v])=>digest(saved[0][k])!==digest(v)))fail('ACTIVATION_READBACK_UNCERTAIN');
     await tx.runtimeStore.update({where:{key},data:{data:{...row.data,phase:'completed',completedAt:now(),patchDigest:digest(plan.patch)}}});
    });
    if(!admitted||!fileAttempted)fail('ACTIVATION_LOCKED_PROOF_REQUIRED');
   });
   return {saved:true,ready:false,trialStarted:false,messagesSent:0};
  }catch(error){
   // Never retry/rollback a file write after a lost SQL acknowledgement. The
   // committed prepared journal survives rollback of the completion transaction.
   if(fileAttempted)fail('ACTIVATION_SAVE_UNCERTAIN_INSPECT_FIRST');
   throw error;
  }finally{fence.release(ids);}
 };
}
module.exports={createActivationSave,PREFIX};
