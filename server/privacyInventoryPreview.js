'use strict';
// Internal preview library only. No HTTP registration, writer, legal policy or erase admission.
const crypto=require('node:crypto');
const fail=code=>{throw Object.assign(new Error(code),{code});};
function canonical(v){if(Array.isArray(v))return v.map(canonical);if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])]));return v;}
const bytes=v=>Buffer.from(JSON.stringify(canonical(v)));
const hash=v=>crypto.createHash('sha256').update(bytes(v)).digest('hex');
function targetOf(input){
 if(!input||Object.keys(input).sort().join(',')!=='businessId,callerId'||![input.businessId,input.callerId].every(v=>Number.isSafeInteger(v)&&v>0))fail('PRIVACY_TARGET_REQUIRED');
 return {businessId:input.businessId,callerId:input.callerId};
}
function createPrivacyInventoryPreview({readInventory,readAuthority,authorityId,publicKey,referenceKey,requiredSurfaces,now=Date.now,maxAgeMs=10000}){
 if(typeof readInventory!=='function'||typeof readAuthority!=='function'||typeof authorityId!=='string'||!authorityId
  ||!publicKey||!Buffer.isBuffer(referenceKey)||referenceKey.length<32||!Array.isArray(requiredSurfaces)||!requiredSurfaces.length
  ||new Set(requiredSurfaces).size!==requiredSurfaces.length||!Number.isSafeInteger(maxAgeMs)||maxAgeMs<1||maxAgeMs>60000)fail('PRIVACY_TRUST_CONFIG_REQUIRED');
 const key=crypto.createPublicKey(publicKey);if(key.asymmetricKeyType!=='ed25519')fail('PRIVACY_AUTHORITY_KEY_REQUIRED');
 const reference=v=>crypto.createHmac('sha256',referenceKey).update(bytes(v)).digest('hex');
 async function current(scopeRef){
  const challenge=crypto.randomBytes(32).toString('hex'),envelope=await readAuthority({scopeRef,challenge});
  const p=envelope?.proof;let verified=false;
  try{verified=crypto.verify(null,bytes(p),key,Buffer.from(envelope.signature,'base64url'));}catch{}
  if(!verified||p?.authorityId!==authorityId||p.challenge!==challenge||p.scopeRef!==scopeRef||p.version!==1)fail('PRIVACY_AUTHORITY_UNTRUSTED');
  const age=now()-p.issuedAt;
  if(!Number.isSafeInteger(p.issuedAt)||!Number.isFinite(age)||age<0||age>maxAgeMs)fail('PRIVACY_AUTHORITY_STALE');
  if(!Number.isSafeInteger(p.revision)||p.revision<1||!Number.isSafeInteger(p.throughSequence)||p.throughSequence<0||p.throughSequence>1000
   ||!Array.isArray(p.journal)||p.journal.length!==p.throughSequence)fail('PRIVACY_JOURNAL_INCOMPLETE');
  for(const [i,e]of p.journal.entries())if(e?.sequence!==i+1||typeof e.scopeRef!=='string'||!/^[a-f0-9]{64}$/.test(e.scopeRef)
   ||typeof e.decisionRef!=='string'||!/^fixture-[a-z0-9-]+$/.test(e.decisionRef))fail('PRIVACY_JOURNAL_UNORDERED');
  if(!Array.isArray(p.holds)||p.holds.length!==1||p.holds[0]?.scopeRef!==scopeRef||p.holds[0]?.revision!==p.revision)fail('PRIVACY_HOLD_CONFLICT');
  if(p.holds[0].state!=='clear')fail('PRIVACY_HOLD_NOT_CLEAR');
  return {digest:hash({revision:p.revision,throughSequence:p.throughSequence,journal:p.journal,holds:p.holds}),revision:p.revision,throughSequence:p.throughSequence};
 }
 return async function preview(input){
  const target=targetOf(input),scopeRef=reference(target),before=await current(scopeRef);
  const inventory=await readInventory(target);
  if(inventory?.identity?.businessId!==target.businessId||inventory.identity.callerId!==target.callerId||inventory.identity.exact!==true)fail('PRIVACY_IDENTITY_CONFLICT');
  if(!Array.isArray(inventory.records)||inventory.records.length>1000||!Array.isArray(inventory.coveredSurfaces)||new Set(inventory.coveredSurfaces).size!==inventory.coveredSurfaces.length
   ||inventory.coveredSurfaces.some(v=>!requiredSurfaces.includes(v))||!Number.isSafeInteger(inventory.foreignTenantCount)||inventory.foreignTenantCount<0)fail('PRIVACY_INVENTORY_INCOMPLETE');
  const seen=new Set();for(const row of inventory.records){
   if(!requiredSurfaces.includes(row.surface)||!inventory.coveredSurfaces.includes(row.surface)||row.businessId!==target.businessId||row.callerId!==target.callerId
    ||!['string','number'].includes(typeof row.id)||String(row.id).length<1||String(row.id).length>200)fail('PRIVACY_RECORD_CONFLICT');
   const id=reference({surface:row.surface,id:row.id});if(seen.has(id))fail('PRIVACY_RECORD_CONFLICT');seen.add(id);
  }
  const after=await current(scopeRef);if(before.digest!==after.digest)fail('PRIVACY_AUTHORITY_CHANGED');
  const unresolved=inventory.unresolvedSurfaces||[];
  if(!Array.isArray(unresolved)||unresolved.some(r=>!requiredSurfaces.includes(r?.surface)||!['NO_CANONICAL_CALLER_LINK','UNRESOLVED_ROW_LINK'].includes(r?.reason)
   ||inventory.coveredSurfaces.includes(r.surface))||new Set(unresolved.map(r=>r.surface)).size!==unresolved.length)fail('PRIVACY_INVENTORY_INCOMPLETE');
  const missing=requiredSurfaces.filter(v=>!inventory.coveredSurfaces.includes(v));
  return {scope:'synthetic-privacy-inventory-preview-only',ready:false,applyAllowed:false,livePrivacyProven:false,liveRecoveryProven:false,
   scopeRef,authority:{verified:true,revision:after.revision,throughSequence:after.throughSequence},
   sharedIdentity:inventory.foreignTenantCount>0,foreignTenantCount:inventory.foreignTenantCount,
   inventory:inventory.records.map(row=>({surface:row.surface,reference:reference({surface:row.surface,id:row.id})})),
   coverage:{complete:missing.length===0,covered:[...inventory.coveredSurfaces],missing,unresolved},
   blockers:[...(missing.length?['MISSING_SURFACE_ADAPTERS']:[]),...(inventory.foreignTenantCount?['SHARED_IDENTITY_DISPOSITION_UNDECIDED']:[]),'NO_REQUESTER_OR_DISPOSITION_POLICY','NO_PRODUCTION_AUTHORITY_ADAPTER','NO_ERASURE_IMPLEMENTATION'],
   limitation:'Selected read snapshot only; not a production-wide capture fence, requester authorization, legal decision or erase receipt'};
 };
}
module.exports={createPrivacyInventoryPreview,canonical,hash,bytes,targetOf};
