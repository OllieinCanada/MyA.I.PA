'use strict';
// Actual source purchase guards/handler, actual context loader and receipt
// algorithm; synthetic storage/provider doubles only. Not SQL/Make proof.
const assert=require('node:assert/strict');
const {fixture}=require('./provisioning-error-route-fixture');
const {memoryDb}=require('./twilio-status-memory-db');
const context=require('../../server/signupProvisioningContext');
const {runProvisioningStep}=require('../../server/provisioningState');
const FORMATS=Object.freeze(['empty-multipart','json']);
function state(){
 const claim=memoryDb(),rows=new Map();let tail=Promise.resolve();
 const value={claim,contexts:rows,fault:null,providerCalls:[],claimCalls:0,lostCompletionAck:false,loseCompletionAck:false};
 const store=map=>({findUnique:async({where})=>map.has(where.key)?{data:structuredClone(map.get(where.key))}:null,
  upsert:async({where,update,create})=>{const data=structuredClone(map.has(where.key)?update.data:create.data);map.set(where.key,data);return {data};}});
 value.contextDatabase={runtimeStore:store(rows),$transaction:fn=>{
  const job=tail.then(async()=>{
   if(value.fault==='pool')throw Object.assign(Error('Invented admission failure'),{code:'P2024'});
   const snapshot=new Map(structuredClone([...rows]));
   const result=await fn({runtimeStore:store(snapshot),$queryRaw:async strings=>{
    assert.match(strings.join('?'),/pg_advisory_xact_lock[\s\S]*::text AS lock_result/);
    if(value.fault==='lock')throw Object.assign(Error('Invented lock timeout'),{code:'P2028'});
    return [{lock_result:''}];
   }});
   if(value.fault==='before-commit')throw Object.assign(Error('Invented pre-commit loss'),{code:'P2028'});
   rows.clear();for(const[k,v]of snapshot)rows.set(k,v);
   if(value.fault==='after-commit')throw Object.assign(Error('Invented context acknowledgement loss'),{code:'P2028'});
   return result;
  });tail=job.catch(()=>{});return job;
 }};
 const native=claim.prisma.$transaction.bind(claim.prisma);
 claim.prisma.$transaction=async fn=>{
  const result=await native(fn);
  if(value.loseCompletionAck&&!value.lostCompletionAck&&[...claim.rows.values()].some(r=>r.data.status==='completed')){
   value.lostCompletionAck=true;throw Object.assign(Error('Invented completed-receipt acknowledgement loss'),{code:'P2028'});
  }
  return result;
 };
 return value;
}
function create({shared=state(),mode='valid'}={}){
 const f=fixture(mode),p=f.payload.provisioning,key=context.contextStoreKey(p.idempotencyKey);
 if(!shared.contexts.has(key))shared.contexts.set(key,{payload:structuredClone(f.payload),idempotencyKey:p.idempotencyKey,contextHash:p.contextHash,signupEventKey:f.target.attemptId});
 f.ctx.loadSignupProvisioningContextForAttempt=options=>context.loadSignupProvisioningContextForAttempt({...options,prisma:shared.contextDatabase});
 f.ctx.runProvisioningStep=options=>{shared.claimCalls++;return runProvisioningStep({...options,prisma:shared.claim.prisma});};
 const fakePurchase=f.ctx.purchaseTwilioPhoneNumber;
 f.ctx.purchaseTwilioPhoneNumber=async options=>{shared.providerCalls.push(structuredClone(options));return fakePurchase(options);};
 return Object.assign(f,{shared,key});
}
function request(f,format){
 assert.ok(FORMATS.includes(format));const p=f.payload.provisioning;
 const fields={areaCode:p.preferredAreaCode,region:p.preferredRegion,voiceUrl:'https://example.invalid/synthetic-voice-hook',voiceMethod:'POST'};
 const proof={idempotencyKey:p.idempotencyKey,contextHash:p.contextHash};
 const headers={'x-myaipa-integration-key':'synthetic-connection-key','x-provisioning-token':p.authorizationToken};
 if(format==='json')return {query:{},body:JSON.parse(JSON.stringify({...fields,provisioning:proof})),headers};
 return {query:Object.fromEntries(new URLSearchParams({...fields,...proof})),body:{},headers};
}
function wire(f,format){
 const r=request(f,format),query=new URLSearchParams(r.query).toString();
 return {path:f.path+(query?'?'+query:''),headers:{...r.headers,...(format==='json'?{'content-type':'application/json'}:{})},
  body:format==='json'?JSON.stringify(r.body):new FormData()};
}
function receipt(f){return [...f.shared.claim.rows.values()].find(r=>r.key.startsWith('provisioning:twilio-number:'))||[...f.shared.claim.rows.values()][0];}
module.exports={FORMATS,state,create,request,wire,receipt};
