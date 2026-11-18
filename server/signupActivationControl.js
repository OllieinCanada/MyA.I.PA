'use strict';
const fs=require('node:fs'),path=require('node:path');
const {digest}=require('./signupAssociationRepair');
const {createActivationPreview}=require('./signupActivationPreview');
const {createActivationSave,PREFIX}=require('./signupActivationSave');
const {createActivationEvidenceReader,createStableActivationProof}=require('./signupActivationEvidence');
const {VERSION}=require('./trialCalendarPolicy');
const fail=(code,statusCode=409)=>{throw Object.assign(new Error(code),{code,statusCode});};

function readActivationPolicy(directory){
 const file=path.join(path.resolve(directory),'signup-verified-setup-policy.json');
 if(!fs.existsSync(file))return null;
 const stat=fs.lstatSync(file);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.size>16384)fail('ACTIVATION_POLICY_INVALID');
 return JSON.parse(fs.readFileSync(file,'utf8'));
}
// Only the running server supplies the fence, transports (GET only), policy,
// authenticated-session verifier and canonical file writer. No new guard instance.
function createActivationControl({prisma,fence,readStore,commitStore,getPolicy,getRelease,
 readAssistant,readPhone,getSigningSecret,enabled=()=>false,applyEnabled=()=>false,
 singleWriter=()=>false,now=()=>Date.now()}){
 const cache=new Map();
 function authorize(auth){
  if(enabled()!==true)fail('ACTIVATION_CONTROL_DISABLED',403);
  const actor=auth?.reauthorize?.();
  if(!/^[a-f0-9]{64}$/.test(actor||'')||actor!==auth.actorHash)fail('ACTIVATION_SESSION_REQUIRED',401);
  return actor;
 }
 function policy(actor,id){
  const doc=structuredClone(getPolicy());
  if(!doc||doc.schemaVersion!==1||doc.policyId!==id||!/^[a-f0-9]{64}$/.test(id||'')
   ||doc.operatorSessionHash!==actor||doc.release!==getRelease()||!/^[a-f0-9]{40}$/.test(doc.release||'')
   ||!Number.isFinite(Date.parse(doc.expiresAt))||Date.parse(doc.expiresAt)<=now()||Date.parse(doc.expiresAt)>now()+900000)fail('ACTIVATION_POLICY_REQUIRED',403);
  const target=doc.target,fields=['signupAttemptId','phantomId','businessId','calendarPolicy'];
  if(!target||Array.isArray(target)||Object.keys(target).length!==fields.length||Object.keys(target).some(k=>!fields.includes(k))
   ||!Number.isSafeInteger(target.businessId)||target.businessId<1||target.calendarPolicy!==VERSION
   ||![target.signupAttemptId,target.phantomId].every(x=>/^signup_[a-f0-9]{32}$/.test(x||''))
   ||target.signupAttemptId===target.phantomId)fail('ACTIVATION_POLICY_INVALID');
  return {doc,target,version:digest({actor,id,release:doc.release,expiresAt:doc.expiresAt,target})};
 }
 const deps={prisma,readAssistant,readPhone,getSigningSecret};
 async function execute(body,auth){
  const actor=authorize(auth);
  if(!body||Array.isArray(body)||typeof body!=='object'||Object.keys(body).some(k=>!['action','policyId','planDigest','confirmation'].includes(k))
   ||!['identify','preview','inspect','apply'].includes(body.action))fail('ACTIVATION_REQUEST_INVALID',400);
  if(body.action==='identify'){
   if(Object.keys(body).length!==1)fail('ACTIVATION_REQUEST_INVALID',400);
   return {operatorSessionHash:actor,release:getRelease(),readOnly:true,ready:false,applyAllowed:false};
  }
  const {doc,target,version}=policy(actor,body.policyId);
  if(body.action!=='apply'&&(body.planDigest!==undefined||body.confirmation!==undefined))fail('ACTIVATION_REQUEST_INVALID',400);
  if(body.action==='inspect'){
   const row=await prisma.runtimeStore.findUnique({where:{key:PREFIX+digest(target)}});
   authorize(auth);if(policy(actor,body.policyId).version!==version)fail('ACTIVATION_POLICY_CHANGED');
   return {readOnly:true,ready:false,applyAllowed:false,journalPhase:row?.data?.phase||'absent',
    limitation:'Journal inspection only; an absent or completed journal is not a delivery, trial or permission receipt.'};
  }
  let entry=cache.get(doc.policyId);
  if(entry?.busy)fail('ACTIVATION_CONTROL_BUSY');
  if(entry?.attempted)fail('ACTIVATION_SAVE_INSPECT_FIRST');
  if(body.action==='apply'&&(!entry||entry.version!==version||now()-entry.createdAt>60000
   ||body.planDigest!==entry.plan.planDigest||doc.approvedPlanDigest!==body.planDigest
   ||body.confirmation!=='SAVE_VERIFIED_SETUP_ONLY'||applyEnabled()!==true))fail('ACTIVATION_FRESH_APPROVED_PREVIEW_REQUIRED',403);
  if(!entry){
   for(const [key,value]of cache)if(!value.busy&&!value.attempted&&now()-value.createdAt>60000)cache.delete(key);
   if(cache.size>=8)fail('ACTIVATION_CONTROL_CAPACITY');
   entry={busy:false,attempted:false,createdAt:now()};cache.set(doc.policyId,entry);
  }
  entry.busy=true;
  try{
   if(body.action==='preview'){
    const preview=createActivationPreview({readStore,readProof:createActivationEvidenceReader(deps),fence,getPolicy:()=>policy(actor,doc.policyId).target,now:()=>new Date(now()).toISOString()});
    const plan=await preview();authorize(auth);
    if(policy(actor,doc.policyId).version!==version)fail('ACTIVATION_POLICY_CHANGED');
    Object.assign(entry,{plan,version,createdAt:now()});
    return {...plan,policyId:doc.policyId,expiresAt:new Date(Math.min(Date.parse(doc.expiresAt),entry.createdAt+60000)).toISOString()};
   }
   // Provider GETs happen BEFORE SQL locks, not inside the file/SQL commit
   // transaction. The locked source and script checks below bind this fresh
   // server-owned snapshot to the exact preview; callers cannot supply it.
   const matches=Object.values(readStore()).filter(r=>r.signupAttemptId===target.signupAttemptId);
   if(matches.length!==1||!matches[0].vapiAssistantId||!matches[0].vapiPhoneNumberId)fail('ACTIVATION_ROUTE_CONFLICT');
   const [assistant,phone]=await Promise.all([readAssistant(matches[0].vapiAssistantId),readPhone(matches[0].vapiPhoneNumberId)]);
   authorize(auth);if(policy(actor,doc.policyId).version!==version)fail('ACTIVATION_POLICY_CHANGED');
   const snapshot={...deps,
    readAssistant:async id=>{if(assistant?.id!==id)fail('ACTIVATION_ROUTE_CONFLICT');return structuredClone(assistant);},
    readPhone:async id=>{if(phone?.id!==id)fail('ACTIVATION_ROUTE_CONFLICT');return structuredClone(phone);}};
   entry.attempted=true;
   const save=createActivationSave({prisma,fence,readStore,commitStore,withStableProof:createStableActivationProof(snapshot),
    getPolicy:()=>policy(actor,doc.policyId).target,enabled:()=>enabled()===true&&applyEnabled()===true,singleWriter,
    authorized:()=>{authorize(auth);const fresh=policy(actor,doc.policyId);return fresh.version===version&&fresh.doc.approvedPlanDigest===body.planDigest;},
    now:()=>new Date(now()).toISOString()});
   return await save({actor,expectedPlanDigest:entry.plan.planDigest,verifiedAt:entry.plan.verifiedAt,confirmation:body.confirmation});
  }finally{entry.busy=false;}
 }
 return {execute};
}
function registerActivationControl({app,requireAdmin,limiter,isAllowedOrigin,actorHash,service}){
 app.post('/api/admin/signups/verified-setup',limiter,requireAdmin,async(req,res)=>{
  res.set('Cache-Control','no-store');
  try{
   if(!req.headers.origin||!isAllowedOrigin(req.headers.origin)||req.headers['x-myaipa-verified-setup']!=='1'
    ||!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||''))fail('ACTIVATION_ORIGIN_REQUIRED',403);
   res.json(await service.execute(req.body,{actorHash:actorHash(req),reauthorize:()=>actorHash(req)}));
  }catch(error){
   const known=/^ACTIVATION_[A-Z_]+$/.test(error.code||'');
   res.status(known?(error.statusCode||409):503).json({code:known?error.code:'ACTIVATION_EVIDENCE_UNAVAILABLE',ready:false,
    applyAllowed:false,uncertain:known&&/UNCERTAIN|INSPECT_FIRST/.test(error.code)});
  }
 });
}
module.exports={createActivationControl,registerActivationControl,readActivationPolicy};
