'use strict';
const {digest}=require('./signupAssociationRepair');
const {prepareVerifiedSignupRecord}=require('./signupActivationPreparation');
const fail=code=>{throw Object.assign(new Error(code),{code,statusCode:409});};

// Preview only. No commit, transport, billing or activation capability is injected.
// The policy and proof are server-owned; neither is accepted from an HTTP body.
function createActivationPreview({readStore,readProof,fence,getPolicy,now=()=>new Date().toISOString()}){
 return async function preview(){
  const policy=structuredClone(getPolicy());
  if(!policy||!/^signup_[a-f0-9]{32}$/.test(policy.signupAttemptId||'')||!/^signup_[a-f0-9]{32}$/.test(policy.phantomId||'')
   ||policy.signupAttemptId===policy.phantomId)fail('ACTIVATION_POLICY_REQUIRED');
  const ids=[policy.signupAttemptId,policy.phantomId];
  fence.hold(ids);
  try{
   const store=readStore(),before=digest(store);
   const proof=await readProof(policy);
   if(digest(getPolicy())!==digest(policy)||digest(readStore())!==before)fail('ACTIVATION_PREVIEW_CHANGED');
   const plan=prepareVerifiedSignupRecord({...proof,records:Object.values(store),consent:policy,now:now()});
   return {readOnly:true,applyAllowed:false,ready:false,trialStarted:false,messagesSent:0,
    signupAttemptId:plan.signupAttemptId,planDigest:plan.planDigest,proposedFields:Object.keys(plan.patch),
    remaining:plan.remaining,limitation:plan.limitation};
  }finally{fence.release(ids);}
 };
}
function registerActivationPreview({app,requireAdmin,limiter,isAllowedOrigin,preview}){
 app.post('/api/admin/signups/activation-preview',limiter,requireAdmin,async(req,res)=>{
  res.set('Cache-Control','no-store');
  try{
   if(!req.headers.origin||!isAllowedOrigin(req.headers.origin)
    ||req.headers['x-myaipa-activation-preview']!=='1'
    ||!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||'')
    ||!req.body||Object.keys(req.body).length)fail('ACTIVATION_PREVIEW_REQUEST_INVALID');
   res.json(await preview());
  }catch(error){res.status(error.statusCode||503).json({error:'Activation preview unavailable.',
   code:String(error.code||'').startsWith('ACTIVATION_')?error.code:'ACTIVATION_EVIDENCE_UNAVAILABLE',readOnly:true,applyAllowed:false});}
 });
}
module.exports={createActivationPreview,registerActivationPreview};
