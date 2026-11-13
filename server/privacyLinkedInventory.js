'use strict';
// Discovery only. Caller must pass the same read-only transaction as core identity resolution.
const fail=code=>{throw Object.assign(new Error(code),{code});};
const LIMIT=1000;
async function discoverSubjectLinks({tx,target,calls,leads,syncStore}){
 const callIds=new Set(calls.map(r=>r.id)),leadIds=new Set(leads.map(r=>r.id)),records=[],coveredSurfaces=[];
 const unresolvedSurfaces=['pending-stripe-signups.json','trial-reminders.json','signup-dashboard.json'].map(n=>({surface:'file:'+n,reason:'NO_CANONICAL_CALLER_LINK'}));
 const row=(surface,r)=>records.push({surface:'database:'+surface,id:r.id,...target});
 async function read(model,where,select){const result=await tx[model].findMany({where,select,take:LIMIT+1});
  if(!Array.isArray(result)||result.length>LIMIT||new Set(result.map(r=>r.id)).size!==result.length)fail('PRIVACY_LINK_INVENTORY_INCOMPLETE');return result;}
 for(const [model,surface]of [['callNote','CallNote'],['callTask','CallTask']]){
  const found=await read(model,{callId:{in:[...callIds]}},{id:true,callId:true});
  for(const r of found){if(!callIds.has(r.callId))fail('PRIVACY_LINK_BINDING_CONFLICT');row(surface,r);}coveredSurfaces.push('database:'+surface);
 }
 const outcomes=await read('leadOutcomeEvent',{leadId:{in:[...leadIds]}},{id:true,leadId:true,businessId:true});
 for(const r of outcomes){if(!leadIds.has(r.leadId)||r.businessId!==target.businessId)fail('PRIVACY_LINK_BINDING_CONFLICT');row('LeadOutcomeEvent',r);}coveredSurfaces.push('database:LeadOutcomeEvent');
 const handoffs=await read('leadHandoff',{OR:[{leadId:{in:[...leadIds]}},{callId:{in:[...callIds]}}]},{id:true,leadId:true,callId:true,businessId:true});
 for(const r of handoffs){if(!leadIds.has(r.leadId)||r.businessId!==target.businessId||(r.callId!=null&&!callIds.has(r.callId)))fail('PRIVACY_LINK_BINDING_CONFLICT');row('LeadHandoff',r);}coveredSurfaces.push('database:LeadHandoff');
 const handoffIds=new Set(handoffs.map(r=>r.id)),attempts=await read('leadNotificationAttempt',{handoffId:{in:[...handoffIds]}},{id:true,handoffId:true});
 for(const r of attempts){if(!handoffIds.has(r.handoffId))fail('PRIVACY_LINK_BINDING_CONFLICT');row('LeadNotificationAttempt',r);}coveredSurfaces.push('database:LeadNotificationAttempt');
 const attemptMap=new Map(attempts.map(r=>[r.id,r.handoffId]));
 const events=await read('leadNotificationEvent',{OR:[{handoffId:{in:[...handoffIds]}},{attemptId:{in:[...attemptMap.keys()]}}]},{id:true,handoffId:true,attemptId:true});
 for(const r of events){if(!handoffIds.has(r.handoffId)||(r.attemptId!=null&&attemptMap.get(r.attemptId)!==r.handoffId))fail('PRIVACY_LINK_BINDING_CONFLICT');row('LeadNotificationEvent',r);}coveredSurfaces.push('database:LeadNotificationEvent');
 // Source index.js persists these exact sync fields. Never infer identity from phone/name.
 if(!syncStore||typeof syncStore!=='object'||Array.isArray(syncStore))fail('PRIVACY_SYNC_STORE_REQUIRED');
 const entries=Object.entries(syncStore);if(entries.length>LIMIT)fail('PRIVACY_LINK_INVENTORY_INCOMPLETE');
 let unresolved=false;
 const declared=entries.filter(([key,r])=>r&&typeof r==='object'&&!Array.isArray(r)&&Number.isSafeInteger(r.localCallId)&&r.localCallId>0&&Number.isSafeInteger(r.businessId)&&r.businessId>0&&r.vapiCallId===key&&key.length>0&&key.length<=200);
 if(declared.length!==entries.length)unresolved=true;
 const ids=[...new Set(declared.map(([,r])=>r.localCallId))];
 const saved=await read('call',{id:{in:ids}},{id:true,businessId:true,callerId:true,externalProvider:true,externalId:true});
 const map=new Map(saved.map(r=>[r.id,r]));if(saved.some(r=>!ids.includes(r.id)))fail('PRIVACY_LINK_BINDING_CONFLICT');
 for(const [key,r]of declared){const savedCall=map.get(r.localCallId);
  if(!savedCall){unresolved=true;continue;}
  if(savedCall.businessId!==r.businessId||savedCall.externalProvider!=='vapi'||savedCall.externalId!==key)fail('PRIVACY_FILE_BINDING_CONFLICT');
  if(savedCall.businessId===target.businessId&&savedCall.callerId===target.callerId){if(!callIds.has(savedCall.id))fail('PRIVACY_LINK_BINDING_CONFLICT');records.push({surface:'file:vapi-call-sync.json',id:key,...target});}
 }
 if(unresolved){unresolvedSurfaces.push({surface:'file:vapi-call-sync.json',reason:'UNRESOLVED_ROW_LINK'});for(let i=records.length-1;i>=0;i--)if(records[i].surface==='file:vapi-call-sync.json')records.splice(i,1);}
 else coveredSurfaces.push('file:vapi-call-sync.json');
 return {records,coveredSurfaces,unresolvedSurfaces};
}
module.exports={discoverSubjectLinks};
