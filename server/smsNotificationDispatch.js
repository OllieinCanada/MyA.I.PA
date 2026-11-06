'use strict';
// Duplicate admission only, NOT speech-consent authority or delivery proof.
// A durable claim is never expired/released automatically, even after a crash.
const crypto=require('node:crypto');
const digest=v=>crypto.createHash('sha256').update(v).digest('hex');
const error=(code,status=409)=>Object.assign(new Error(code),{code,statusCode:status});
function context(input={}){
 const callId=String(input.callId||'').trim(),from=String(input.from||''),to=String(input.to||''),leg=String(input.leg||''),body=String(input.body||'');
 if(!/^[a-zA-Z0-9][a-zA-Z0-9:_-]{1,179}$/.test(callId)||!/^\+[1-9]\d{7,14}$/.test(from)||!/^\+[1-9]\d{7,14}$/.test(to)||!['owner','customer'].includes(leg)||!body||body.length>1600)throw error('notification_dispatch_context_invalid',400);
 return{key:'call-notification-dispatch:v1:'+digest(JSON.stringify([callId,from,leg])),contextHash:digest(JSON.stringify([callId,from,to,leg,body]))};
}
function safeResult(result){
 if(!result||typeof result!=='object'||Array.isArray(result)||typeof result.sent!=='boolean'||typeof result.attempted!=='boolean')throw error('notification_dispatch_result_invalid',400);
 const output={attempted:result.attempted,sent:result.sent,status:String(result.status||'unknown').slice(0,80)};
 if(result.sent&&!/^(?:SM|MM)[a-f0-9]{32}$/i.test(String(result.messageId||'')))throw error('notification_dispatch_receipt_invalid',400);
 for(const key of ['messageId','notificationKey','errorCode','toLast4','fromLast4'])if(typeof result[key]==='string')output[key]=result[key].slice(0,80);
 for(const key of ['skipped','messageIdSet','requiresReconciliation'])if(typeof result[key]==='boolean')output[key]=result[key];
 if(Number.isInteger(result.providerStatus))output.providerStatus=result.providerStatus;
 return output;
}
async function locked(prisma,key,fn){
 if(!prisma?.runtimeStore||typeof prisma.$transaction!=='function')throw error('notification_dispatch_store_unavailable',503);
 return prisma.$transaction(async tx=>{if(typeof tx.$queryRaw!=='function'||!tx.runtimeStore)throw error('notification_dispatch_lock_unavailable',503);await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))::text AS lock_result`;return fn(tx);},{maxWait:2000,timeout:5000});
}
async function claimNotificationDispatch({prisma,input,now=Date.now()}){
 const {key,contextHash}=context(input);
 return locked(prisma,key,async tx=>{const row=await tx.runtimeStore.findUnique({where:{key}});
  if(row){const data=row.data;if(!data||data.version!==1||data.contextHash!==contextHash)return{schemaVersion:1,granted:false,state:'context_conflict',requiresReconciliation:true};
   if(data.state==='completed'&&data.result)return{schemaVersion:1,granted:false,state:'completed',result:safeResult(data.result)};
   return{schemaVersion:1,granted:false,state:'unconfirmed',requiresReconciliation:true};}
  const claimToken=crypto.randomUUID();const data={version:1,state:'claimed',contextHash,claimTokenHash:digest(claimToken),claimedAt:new Date(now).toISOString(),possiblySubmitted:true};
  await tx.runtimeStore.create({data:{key,data}});return{schemaVersion:1,granted:true,state:'claimed',claimToken};
 });
}
async function completeNotificationDispatch({prisma,input,now=Date.now()}){
 const {key,contextHash}=context(input);const token=String(input.claimToken||'');if(!/^[a-f0-9-]{36}$/i.test(token))throw error('notification_dispatch_claim_invalid',400);const result=safeResult(input.result);
 return locked(prisma,key,async tx=>{const row=await tx.runtimeStore.findUnique({where:{key}}),data=row?.data;if(!data||data.version!==1||data.contextHash!==contextHash||data.claimTokenHash!==digest(token))throw error('notification_dispatch_claim_mismatch');
  if(data.state==='completed'){if(JSON.stringify(data.result)!==JSON.stringify(result))throw error('notification_dispatch_result_conflict');return{schemaVersion:1,stored:true};}
  if(data.state!=='claimed')throw error('notification_dispatch_state_invalid');await tx.runtimeStore.update({where:{key},data:{data:{...data,state:'completed',result,completedAt:new Date(now).toISOString()}}});return{schemaVersion:1,stored:true};
 });
}
function dispatchHandler({prisma,env=process.env,authenticate}){return async(req,res)=>{
 if(env.SMS_NOTIFICATION_DISPATCH_ENABLED!=='true')return res.status(503).json({schemaVersion:1,errorCode:'notification_dispatch_disabled'});
 if(typeof authenticate!=='function'||!authenticate(req))return res.status(401).json({schemaVersion:1,errorCode:'notification_dispatch_unauthorized'});
 try{const action=req.body?.action;if(!['claim','complete'].includes(action))throw error('notification_dispatch_action_invalid',400);const result=await(action==='claim'?claimNotificationDispatch:completeNotificationDispatch)({prisma,input:req.body});return res.json(result);}
 catch(e){return res.status(e.statusCode||503).json({schemaVersion:1,errorCode:e.statusCode?e.code:'notification_dispatch_store_unavailable'});}
};}
module.exports={claimNotificationDispatch,completeNotificationDispatch,dispatchHandler};
