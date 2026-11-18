'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const express=require('express');
const {createActivationControl,registerActivationControl}=require('../server/signupActivationControl');
const {createAssociationFence}=require('../server/signupAssociationRepair');
const {normalizeSignupProvisioningPayload}=require('../server/signupProvisioning');
const {buildMakeSignupEventKey}=require('../server/makeSignupWebhook');
const {buildSignupAssistantConfig}=require('../server/signupAssistantTemplate');
const {fingerprintAssistantContent}=require('../server/signupAssistantVerification');
const {contextStoreKey}=require('../server/signupProvisioningContext');
const {provisioningStateKey}=require('../server/provisioningState');
const {VERSION}=require('../server/trialCalendarPolicy');
function fixture(){
 const secret='invented-control-test-key',actor='a'.repeat(64),release='b'.repeat(40),id='c'.repeat(64);
 const raw={business:{name:'Imaginary Services',services:'Imaginary repairs'},businessType:'Electrical',serviceArea:'Fictional area',owner:{email:'fake@example.test',phone:'+19055550123'},verification:{smsVerified:true}};
 const payload=normalizeSignupProvisioningPayload(raw,{signingSecret:secret}),signup=buildMakeSignupEventKey(raw),phantom='signup_'+'d'.repeat(32);
 const record={signupAttemptId:signup,businessName:raw.business.name,ownerEmail:raw.owner.email,ownerPhone:raw.owner.phone,status:'setup_error',smsVerified:true,twilioPhoneNumber:'+13655550101',vapiAssistantId:'fake-assistant',vapiPhoneNumberId:'fake-phone'};
 const assistant={...buildSignupAssistantConfig(payload,{assignedPhone:record.twilioPhoneNumber,resourceName:'Fake assistant'}),id:record.vapiAssistantId};
 const phone={id:record.vapiPhoneNumberId,number:record.twilioPhoneNumber,assistantId:assistant.id};
 const target={signupAttemptId:signup,phantomId:phantom,businessId:7,calendarPolicy:VERSION};
 const attempt={eventKey:signup,payload:raw,businessName:record.businessName,ownerEmail:record.ownerEmail,ownerPhone:record.ownerPhone,assignedPhone:phone.number,vapiAssistantId:assistant.id,vapiPhoneNumberId:phone.id};
 const business={id:7,settings:{ownerPhone:record.ownerPhone},vapiMappings:[['phoneNumber',phone.number],['phoneNumberId',phone.id],['assistantId',assistant.id]].map(([matchType,matchValue])=>({businessId:7,matchType,matchValue}))};
 const initial=new Map([[contextStoreKey(payload.provisioning.idempotencyKey),{signupEventKey:signup,payload,contextHash:payload.provisioning.contextHash}],
  [provisioningStateKey('vapi-assistant',payload.provisioning.idempotencyKey),{status:'completed',contextHash:payload.provisioning.contextHash,result:{assistantId:assistant.id,contentFingerprint:fingerprintAssistantContent(assistant)}}]]);
 let rows=initial,store={original:record,phantom:{signupAttemptId:phantom,status:'superseded_duplicate',history:['keep']},other:{keep:true}},writes=0,depth=0;
 const state={now:Date.parse('2026-11-18T02:00:00Z'),enabled:true,apply:false,actor,afterLock:null,probeHook:null,assistant,phone,
  policy:{schemaVersion:1,policyId:id,operatorSessionHash:actor,release,target,expiresAt:'2026-11-18T02:10:00Z'}};
 const db=map=>({$executeRaw:async()=>{},$queryRaw:async()=>{if(state.afterLock)state.afterLock();},
  signupAttempt:{findUnique:async({where})=>where.eventKey===signup?structuredClone(attempt):null},business:{findUnique:async()=>structuredClone(business)},
  runtimeStore:{findUnique:async({where})=>map.has(where.key)?{data:structuredClone(map.get(where.key))}:null,
   create:async({data})=>{assert.ok(!map.has(data.key));map.set(data.key,structuredClone(data.data));},update:async({where,data})=>map.set(where.key,structuredClone(data.data))}});
 const prisma={...db(rows),$transaction:async fn=>{depth++;const copy=new Map(structuredClone([...rows]));try{const result=await fn(db(copy));rows=copy;return result;}finally{depth--;}}};
 const options={prisma,fence:createAssociationFence(),readStore:()=>structuredClone(store),commitStore:project=>{store=project(store);writes++;},getPolicy:()=>state.policy,getRelease:()=>release,getSigningSecret:()=>secret,
  readAssistant:async()=>{assert.equal(depth,0,'No provider GET while SQL transaction is open');state.probeHook?.();return structuredClone(state.assistant);},
  readPhone:async()=>{assert.equal(depth,0,'No provider GET while SQL transaction is open');return structuredClone(state.phone);},
  enabled:()=>state.enabled,applyEnabled:()=>state.apply,singleWriter:()=>true,now:()=>state.now};
 const auth={actorHash:actor,reauthorize:()=>state.actor};
 const service=createActivationControl(options),preview=()=>service.execute({action:'preview',policyId:id},auth);
 return {state,options,auth,service,preview,writes:()=>writes,read:()=>structuredClone(store),
  approve:plan=>{state.apply=true;state.policy.approvedPlanDigest=plan.planDigest;return {action:'apply',policyId:id,planDigest:plan.planDigest,confirmation:'SAVE_VERIFIED_SETUP_ONLY'};}};
}
test('preview is no-write; approved save preserves history and cannot activate or send',async()=>{
 const f=fixture(),before=f.read(),plan=await f.preview();assert.equal(f.writes(),0);assert.equal(plan.applyAllowed,false);assert.equal(plan.verifiedAt,new Date(f.state.now).toISOString());
 const result=await f.service.execute(f.approve(plan),f.auth);assert.equal(result.saved,true);assert.equal(result.trialStarted,false);assert.equal(result.messagesSent,0);
 assert.deepEqual(f.read().phantom,before.phantom);assert.deepEqual(f.read().other,before.other);assert.equal(f.read().original.status,'setup_error');
 await assert.rejects(f.service.execute(f.approve(plan),f.auth),/INSPECT_FIRST/);assert.equal(f.writes(),1);
});
for(const [name,change]of[
 ['disabled',f=>f.state.enabled=false],['wrong session',f=>f.state.actor='e'.repeat(64)],['missing policy',f=>f.state.policy=null],
 ['wrong release',f=>f.state.policy.release='f'.repeat(40)],['expired policy',f=>f.state.policy.expiresAt='2026-11-18T01:59:00Z'],
 ['extra target fields',f=>f.state.policy.target.send=true],['wrong calendar',f=>f.state.policy.target.calendarPolicy='rolling14']
])test(name+' refuses without writes',async()=>{const f=fixture();change(f);await assert.rejects(f.preview());assert.equal(f.writes(),0);});
test('fresh preview and independently approved digest required; body cannot supply proof or target',async()=>{
 const f=fixture(),plan=await f.preview(),body=f.approve(plan);
 delete f.state.policy.approvedPlanDigest;await assert.rejects(f.service.execute(body,f.auth),/APPROVED_PREVIEW/);
 for(const extra of [{proof:{}},{target:{}},{verifiedAt:plan.verifiedAt}])await assert.rejects(f.service.execute({...body,...extra},f.auth),/REQUEST_INVALID/);
 assert.equal(f.writes(),0);
});
test('stale preview and modified provider configuration refuse saving',async()=>{
 const f=fixture(),plan=await f.preview(),body=f.approve(plan);f.state.now+=60001;
 await assert.rejects(f.service.execute(body,f.auth),/APPROVED_PREVIEW/);assert.equal(f.writes(),0);
 const g=fixture(),p=await g.preview(),b=g.approve(p);g.state.assistant.firstMessage='Different business';
 await assert.rejects(g.service.execute(b,g.auth),/SCRIPT_CONFLICT/);assert.equal(g.writes(),0);
});
test('session expiry during SQL wait and flag revocation at dispatch refuse saving',async()=>{
 for(const revoke of [f=>f.state.actor='',f=>f.state.apply=false]){
  const f=fixture(),plan=await f.preview(),body=f.approve(plan);let locks=0;
  f.state.afterLock=()=>{if(++locks===3)revoke(f);};await assert.rejects(f.service.execute(body,f.auth));assert.equal(f.writes(),0);
 }
});
test('policy change during provider GET refuses before any saving',async()=>{
 const f=fixture(),plan=await f.preview(),body=f.approve(plan);f.state.probeHook=()=>{f.state.policy.target.businessId=8;};
 await assert.rejects(f.service.execute(body,f.auth),/POLICY_CHANGED/);assert.equal(f.writes(),0);
});
test('actual HTTP requires admin, same-origin header and server-bound session; sanitized responses',async t=>{
 const f=fixture(),app=express();app.use(express.json());
 registerActivationControl({app,requireAdmin:(q,s,n)=>q.headers['x-fixture-admin']==='yes'?n():s.sendStatus(401),limiter:(_q,_s,n)=>n(),
  isAllowedOrigin:o=>o==='https://fixture.test',actorHash:q=>q.headers['x-fixture-session']==='bound'?f.state.actor:'',service:f.service});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
 const url=`http://127.0.0.1:${server.address().port}/api/admin/signups/verified-setup`,headers={'content-type':'application/json',origin:'https://fixture.test','x-myaipa-verified-setup':'1','x-fixture-admin':'yes','x-fixture-session':'bound'};
 const send=(h,body)=>fetch(url,{method:'POST',headers:h,body:JSON.stringify(body)}),body={action:'preview',policyId:f.state.policy.policyId};
 assert.equal((await send({...headers,'x-fixture-admin':''},body)).status,401);
 assert.equal((await send({...headers,'x-fixture-session':''},body)).status,401);
 assert.equal((await send({...headers,origin:'https://foreign.test'},body)).status,403);
 const response=await send(headers,body);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
 const text=await response.text();assert.doesNotMatch(text,/fake@example|invented-control-test-key/);assert.equal(f.writes(),0);
});
