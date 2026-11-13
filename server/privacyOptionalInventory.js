'use strict';
// Candidate discovery only; no free-text/name/phone identity matching or policy decisions.
const fail=code=>{throw Object.assign(new Error(code),{code});};
async function discoverOptionalLinks({tx,target,calls,leads}){
 const records=[],partialRecords=[],coveredSurfaces=[],unresolvedSurfaces=[];
 const callIds=new Set(calls.map(r=>r.id)),leadIds=new Set(leads.map(r=>r.id));
 async function read(model,where,select){const rows=await tx[model].findMany({where,select,take:1001});
  if(!Array.isArray(rows)||rows.length>1000||new Set(rows.map(r=>r.id)).size!==rows.length)fail('PRIVACY_OPTIONAL_INVENTORY_INCOMPLETE');return rows;}
 for(const [model,surface,parentModel,parentKey,known,extraModel,extraKey]of [
  ['supportReport','SupportReport','call','callId',callIds,null,null],
  ['appointmentRequest','AppointmentRequest','call','callId',callIds,'staffMember','staffMemberId'],
  ['fieldServiceSync','FieldServiceSync','lead','leadId',leadIds,'fieldServiceConnection','connectionId']
 ]){
  const rows=await read(model,{OR:[{businessId:target.businessId},{[parentKey]:{in:[...known]}}]},{id:true,businessId:true,[parentKey]:true,...(extraKey?{[extraKey]:true}:{})});
  const ids=[...new Set(rows.map(r=>r[parentKey]).filter(v=>v!=null))];
  if(ids.some(id=>!Number.isSafeInteger(id)||id<1))fail('PRIVACY_OPTIONAL_BINDING_CONFLICT');
  const parents=await read(parentModel,{id:{in:ids}},{id:true,businessId:true,callerId:true});
  if(parents.some(r=>!ids.includes(r.id)))fail('PRIVACY_OPTIONAL_BINDING_CONFLICT');const map=new Map(parents.map(r=>[r.id,r]));
  let extras=new Map();if(extraModel){const keys=[...new Set(rows.map(r=>r[extraKey]).filter(v=>v!=null))];
   const linked=await read(extraModel,{id:{in:keys}},{id:true,businessId:true});if(linked.some(r=>!keys.includes(r.id)))fail('PRIVACY_OPTIONAL_BINDING_CONFLICT');extras=new Map(linked.map(r=>[r.id,r]));}
  let unresolved=false;const candidates=[];
  for(const r of rows){
   if(!Number.isSafeInteger(r.businessId)||r.businessId<1)fail('PRIVACY_OPTIONAL_BINDING_CONFLICT');
   const parent=map.get(r[parentKey]);
   if(r[parentKey]==null||!parent){unresolved=true;continue;}
   if(parent.businessId!==r.businessId)fail('PRIVACY_OPTIONAL_BINDING_CONFLICT');
   if(extraModel&&r[extraKey]!=null){const extra=extras.get(r[extraKey]);if(!extra){unresolved=true;continue;}if(extra.businessId!==r.businessId)fail('PRIVACY_OPTIONAL_BINDING_CONFLICT');}
   if(parent.businessId===target.businessId&&parent.callerId===target.callerId){
    if(!known.has(parent.id))fail('PRIVACY_OPTIONAL_BINDING_CONFLICT');candidates.push({surface:'database:'+surface,id:r.id,...target});
   }
  }
  if(unresolved){unresolvedSurfaces.push({surface:'database:'+surface,reason:'NULLABLE_OR_UNRESOLVED_PARENT'});partialRecords.push(...candidates);}
  else{coveredSurfaces.push('database:'+surface);records.push(...candidates);}
 }
 return {records,partialRecords,coveredSurfaces,unresolvedSurfaces};
}
module.exports={discoverOptionalLinks};
