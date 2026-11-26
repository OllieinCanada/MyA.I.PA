'use strict';
const fs=require('node:fs'),path=require('node:path');
const {performance}=require('node:perf_hooks');
const {digest}=require('./signupAssociationRepair');
const {prepareNumberConnection,projectConnectionAssociations}=require('./signupConnectionPreparation');
const {createConnectionReader,readConnectionDatabase,databaseDigest}=require('./signupConnectionEvidence');
const {runProvisioningStep}=require('./provisioningState');
const {getTrialLifecycle}=require('./trialUsagePolicy');
const PREFIX='signup-connection:v1:';
const fail=(code,statusCode=409)=>{throw Object.assign(new Error(code),{code,statusCode});};
// A new release/configuration/approval must not reset an uncertain original
// operation. Bind intent identity to the original signup and durable account key;
// store the full target/plan digest inside the record for conflict inspection.
const journalKey=(operation,target)=>PREFIX+digest({operation,attemptId:target?.attemptId,idempotencyKey:target?.idempotencyKey});
function readConnectionPolicy(directory){
 const file=path.join(path.resolve(directory),'signup-connection-policy.json');
 if(!fs.existsSync(file))return null;
 const stat=fs.lstatSync(file);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.size>16384)fail('CONNECTION_POLICY_INVALID');
 return JSON.parse(fs.readFileSync(file,'utf8'));
}
// Disabled by default. Neither module construction nor preview invokes a writer.
// connect and associate have separate operator-bound policies and fresh previews.
function createConnectionControl({prisma,fence,readStore,commitStore,transport,getSigningSecret,getRelease,getPolicy,
 readOverrides=()=>'',enabled=()=>false,applyEnabled=()=>false,singleWriter=()=>false,now=()=>Date.now(),elapsedNow=()=>performance.now()}){
 const reader=createConnectionReader({prisma,readStore,transport,getSigningSecret,getRelease,readOverrides,now});
 const cache=new Map();
 function authorize(auth,applying=false){
  if(enabled()!==true||applying&&(applyEnabled()!==true||singleWriter()!==true))fail('CONNECTION_DISABLED',403);
  const actor=auth?.reauthorize?.();
  if(!/^[a-f0-9]{64}$/.test(actor||'')||actor!==auth.actorHash)fail('CONNECTION_SESSION_REQUIRED',401);
  return actor;
 }
 function policy(auth,id,applying=false){
  const actor=authorize(auth,applying),doc=structuredClone(getPolicy());
  if(!doc||doc.version!==1||doc.policyId!==id||!/^[a-f0-9]{64}$/.test(id||'')||doc.operatorSessionHash!==actor
   ||doc.release!==getRelease()||doc.target?.release!==doc.release||!['connect','associate'].includes(doc.operation)
   ||!Number.isFinite(Date.parse(doc.expiresAt))||Date.parse(doc.expiresAt)<=now()||Date.parse(doc.expiresAt)>now()+900000)fail('CONNECTION_POLICY_REQUIRED',403);
  return {doc,version:digest({id,actor,target:doc.target,operation:doc.operation,release:doc.release,expiresAt:doc.expiresAt})};
 }
 async function execute(body,auth){
  if(!body||Array.isArray(body)||typeof body!=='object'||Object.keys(body).some(k=>!['action','policyId','planDigest','confirmation'].includes(k))
   ||!['identify','preview','inspect','apply'].includes(body.action))fail('CONNECTION_REQUEST_INVALID',400);
  const actor=authorize(auth);
  if(body.action==='identify'){
   if(Object.keys(body).length!==1)fail('CONNECTION_REQUEST_INVALID',400);
   return {operatorSessionHash:actor,release:getRelease(),readOnly:true,ready:false,applyAllowed:false};
  }
  const {doc,version}=policy(auth,body.policyId),p=doc.target,key=journalKey(doc.operation,p);
  let transactionStarted=null;
  const recheck=applying=>{
   const fresh=policy(auth,body.policyId,applying);
   if(fresh.version!==version||applying&&fresh.doc.approvedPlanDigest!==body.planDigest)fail('CONNECTION_POLICY_CHANGED');
   if(applying&&(!Number.isFinite(entry?.at)||now()-entry.at>60000||now()<entry.at))fail('CONNECTION_PREVIEW_EXPIRED');
   // Leave at least 25 seconds of the 45-second SQL allowance for the bounded
   // provider POST/readback and receipt persistence. Prisma cannot cancel JS
   // callbacks when a transaction expires: do not dispatch after a long wait.
   if(applying&&transactionStarted!==null&&elapsedNow()-transactionStarted>20000)fail('CONNECTION_LOCK_BUDGET_EXPIRED');
  };
  let entry=cache.get(doc.policyId);
  if(body.action==='inspect'){
   const journal=await prisma.runtimeStore.findUnique({where:{key}});recheck(false);
   return {readOnly:true,phase:journal?.data?.phase||'absent',operation:doc.operation,ready:false,applyAllowed:false,
    limitation:'Inspection never clears an intent or authorizes another provider dispatch.'};
  }
  if(body.action!=='apply'&&(body.planDigest!==undefined||body.confirmation!==undefined))fail('CONNECTION_REQUEST_INVALID',400);
  if(entry?.busy)fail('CONNECTION_BUSY');
  if(entry?.attempted)fail('CONNECTION_OUTCOME_INSPECT_FIRST');
  if(body.action==='apply'&&(!entry||entry.version!==version||body.planDigest!==entry.plan.planDigest
   ||body.confirmation!==('NO_SEND_'+doc.operation.toUpperCase())||doc.approvedPlanDigest!==body.planDigest))fail('CONNECTION_APPROVED_PREVIEW_REQUIRED',403);
  if(!entry){
   for(const [id,value]of cache)if(!value.busy&&now()-value.at>60000)cache.delete(id);
   if(cache.size>=8)fail('CONNECTION_CAPACITY');
   entry={at:now(),busy:false,attempted:false};cache.set(doc.policyId,entry);
  }
  entry.busy=true;
  let held=false,intent=false;
  try{
   const evidence=await reader(p,doc.operation),plan=prepareNumberConnection(evidence);
   recheck(body.action==='apply');
   const wanted=doc.operation==='connect'?'prepare_phone_connection':'prepare_associations_only';
   if(plan.phase!==wanted||plan.alreadyAssociated)fail('CONNECTION_STAGE_CHANGED');
   if(body.action==='preview'){
    Object.assign(entry,{plan,version,at:now()});
    return {...plan,operation:doc.operation,policyId:doc.policyId,expiresAt:new Date(Math.min(Date.parse(doc.expiresAt),entry.at+60000)).toISOString()};
   }
   if(plan.planDigest!==body.planDigest)fail('CONNECTION_PLAN_CHANGED');
   // Connecting a number can immediately change inbound-call behaviour. The
   // existing normal account lifecycle is required; this path cannot start or
   // extend a trial to satisfy it. Association-only saving cannot grant access.
   if(doc.operation==='connect'&&!['trial','paid'].includes(getTrialLifecycle(evidence.store[plan.targetKey],now()).state))fail('CONNECTION_ACCOUNT_ELIGIBILITY_REQUIRED');
   if(typeof fence?.hold!=='function'||typeof fence?.release!=='function'||typeof commitStore!=='function')fail('CONNECTION_RUNTIME_FENCE_REQUIRED');
   fence.hold([p.attemptId]);held=true;
   entry.attempted=true;
   // Durable intent commits before any provider/file/association mutation. A
   // prepared intent blocks all new instances/policies, even with no receipt.
   await prisma.$transaction(async tx=>{
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))::text AS locked`;
    if(await tx.runtimeStore.findUnique({where:{key}}))fail('CONNECTION_OUTCOME_INSPECT_FIRST');
    recheck(true);
    await tx.runtimeStore.create({data:{key,data:{phase:'prepared',operation:doc.operation,planDigest:plan.planDigest,actorHash:actor,targetDigest:digest(p),preparedAt:new Date(now()).toISOString()}}});
   },{maxWait:2000,timeout:10000});intent=true;
   transactionStarted=elapsedNow();
   await prisma.$transaction(async tx=>{
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))::text AS locked`;
    const journal=await tx.runtimeStore.findUnique({where:{key}});
    if(journal?.data?.phase!=='prepared'||journal.data.planDigest!==plan.planDigest)fail('CONNECTION_OUTCOME_INSPECT_FIRST');
    const locked=await readConnectionDatabase(tx,p,{lock:true,operation:doc.operation});
    if(databaseDigest(locked)!==databaseDigest(evidence)||digest(readStore())!==digest(evidence.store))fail('CONNECTION_SOURCE_CHANGED');
    // Locks may have waited; revalidate the signed session, approval, flags and
    // source/provider observation age at actual dispatch, not at apply entry.
    prepareNumberConnection({...evidence,...locked,store:readStore(),now:now()});recheck(true);
    let result;
    if(doc.operation==='connect'){
     result=await runProvisioningStep({prisma,kind:'vapi-import',idempotencyKey:p.idempotencyKey,contextHash:p.contextHash,
      // A completion appearing after the approved absent-stage snapshot is a
      // changed scope, not a definitive negative about that existing resource.
      // Throw so runProvisioningStep preserves its completion evidence.
      verifyCompleted:async()=>{fail('CONNECTION_STAGE_CHANGED');},
      reconcile:async()=>{
       const current=await transport.readInventories(p);recheck(true);
       const fresh=prepareNumberConnection({...evidence,...locked,...current,store:readStore(),now:now()});
       if(fresh.planDigest!==plan.planDigest)fail('CONNECTION_PLAN_CHANGED');return null;
      },
      execute:()=>transport.importExisting(p,()=>{prepareNumberConnection({...evidence,...locked,store:readStore(),now:now()});recheck(true);})});
    }else{
     // Fresh explicit provider evidence was fetched before the transaction.
     // Locks stabilize the canonical source and all three completed receipts.
     const fresh={...evidence,...locked,store:readStore(),now:now()};
     const projection=projectConnectionAssociations(fresh,plan.planDigest);
     recheck(true);
     const row=locked.attempt;
     const changed=await tx.signupAttempt.updateMany({where:{id:p.attemptRowId,eventKey:p.attemptId,updatedAt:row.updatedAt,status:row.status,
      assignedPhone:row.assignedPhone,vapiAssistantId:row.vapiAssistantId,vapiPhoneNumberId:row.vapiPhoneNumberId},data:plan.proposedAttemptFields});
     if(changed.count!==1)fail('CONNECTION_SOURCE_CHANGED');
     // SQL and the file are not one atomic medium. A file change followed by
     // SQL rollback/lost commit retains the earlier prepared intent for inspection.
     recheck(true);
     const value=commitStore(current=>{
      const rebuilt=projectConnectionAssociations({...fresh,store:current},plan.planDigest);
      return rebuilt.store;
     });
     if(value&&typeof value.then==='function')fail('CONNECTION_SYNCHRONOUS_FILE_REQUIRED');
     if(digest(readStore())!==digest(projection.store))fail('CONNECTION_FILE_READBACK_UNCERTAIN');
     result={...plan.proposedDashboardFields};
    }
    await tx.runtimeStore.update({where:{key},data:{data:{...journal.data,phase:'completed',completedAt:new Date(now()).toISOString(),result}}});
   },{maxWait:2000,timeout:45000});
   return {ok:true,operation:doc.operation,applied:true,ready:false,trialStarted:false,messagesSent:0,numbersPurchased:0,readinessGranted:false};
  }catch(error){
   if(intent)fail('CONNECTION_OUTCOME_INSPECT_FIRST');
   throw error;
  }finally{if(held)fence.release([p.attemptId]);entry.busy=false;}
 }
 return {execute};
}
function registerConnectionControl({app,requireAdmin,limiter,isAllowedOrigin,actorHash,service}){
 app.post('/api/admin/signups/no-send-connection',limiter,requireAdmin,async(req,res)=>{
  res.set('Cache-Control','no-store');
  try{
   if(!req.headers.origin||!isAllowedOrigin(req.headers.origin)||req.headers['x-myaipa-no-send-connection']!=='1'
    ||!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||''))fail('CONNECTION_ORIGIN_REQUIRED',403);
   res.json(await service.execute(req.body,{actorHash:actorHash(req),reauthorize:()=>actorHash(req)}));
  }catch(error){
   const known=/^CONNECTION_[A-Z_]+$/.test(error.code||'');
   res.status(known?(error.statusCode||409):503).json({code:known?error.code:'CONNECTION_EVIDENCE_UNAVAILABLE',ready:false,applyAllowed:false,
    uncertain:known&&/UNCERTAIN|INSPECT_FIRST/.test(error.code)});
  }
 });
}
module.exports={PREFIX,journalKey,readConnectionPolicy,createConnectionControl,registerConnectionControl};
