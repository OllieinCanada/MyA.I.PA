'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createActivationEvidenceReader,createStableActivationProof}=require('../server/signupActivationEvidence');
const {registerActivationPreview}=require('../server/signupActivationPreview');
const {provisioningStateKey}=require('../server/provisioningState');
const policy={signupAttemptId:'signup_'+'a'.repeat(32),phantomId:'signup_'+'b'.repeat(32),businessId:7};
function fixture(){
 const events=[];const attempt={eventKey:policy.signupAttemptId,businessName:'Invented Electrical',ownerEmail:'invented@example.test',ownerPhone:'+19055550123',vapiAssistantId:'fake-assistant',vapiPhoneNumberId:'fake-phone'};
 const tx={$executeRaw:async sql=>{events.push(String(sql));},signupAttempt:{findUnique:async({where})=>where.eventKey===policy.signupAttemptId?attempt:null},
  runtimeStore:{findUnique:async()=>null},business:{findUnique:async()=>({id:7})}};
 const options={prisma:{$transaction:async(fn,config)=>{assert.equal(config.isolationLevel,'RepeatableRead');events.push('snapshot');return fn(tx);}},
  readAssistant:async id=>{events.push('assistant-get');return {id};},readPhone:async id=>{events.push('phone-get');return {id};},getSigningSecret:()=> 'invented-test-secret'};
 return {events,tx,options};
}
test('reader requests read-only snapshot before SELECT delegates and performs provider reads only afterward',async()=>{
 const f=fixture(),proof=await createActivationEvidenceReader(f.options)(policy);
 assert.deepEqual(f.events,['snapshot','SET TRANSACTION READ ONLY','assistant-get','phone-get']);
 assert.equal(proof.billingReceipt,null);assert.equal(proof.assistant.id,'fake-assistant');
});
test('existing empty billing row is not treated as an absent receipt',async()=>{
 const f=fixture();f.tx.runtimeStore.findUnique=async({where})=>where.key.startsWith('signup-provisioning:stripe-trial:')?{data:{}}:null;
 const proof=await createActivationEvidenceReader(f.options)(policy);assert.deepEqual(proof.billingReceipt,{});
 assert.ok(provisioningStateKey('stripe-trial','fake').includes('stripe-trial'));
});
test('invalid policy refuses before any database/provider access',async()=>{
 const f=fixture();await assert.rejects(createActivationEvidenceReader(f.options)({...policy,businessId:'7'}),/POLICY_REQUIRED/);assert.deepEqual(f.events,[]);
});
test('conflicting phantom refuses all provider reads',async()=>{
 const f=fixture(),read=f.tx.signupAttempt.findUnique;f.tx.signupAttempt.findUnique=async q=>q.where.eventKey===policy.phantomId?{eventKey:policy.phantomId}:read(q);
 await assert.rejects(createActivationEvidenceReader(f.options)(policy),/PHANTOM_CONFLICT/);assert.ok(!f.events.includes('assistant-get'));
});
test('route handler contract independently rejects body-supplied proof and redacts exceptions (not HTTP transport proof)',async()=>{
 let handler,calls=0;registerActivationPreview({app:{post:(_p,...handlers)=>{handler=handlers.at(-1);}},requireAdmin:()=>{},limiter:()=>{},isAllowedOrigin:o=>o==='https://fixture.test',preview:async()=>{calls++;throw Error('PRIVATE_VALUE');}});
 const req={headers:{origin:'https://fixture.test','content-type':'application/json','x-myaipa-activation-preview':'1'},body:{proof:'invented'}};
 const response=()=>({statusCode:200,set(){},status(n){this.statusCode=n;return this;},json(data){this.data=data;return this;}});
 let res=response();await handler(req,res);assert.equal(res.statusCode,409);assert.equal(calls,0);
 req.body={};res=response();await handler(req,res);assert.equal(res.statusCode,503);assert.equal(calls,1);assert.ok(!JSON.stringify(res.data).includes('PRIVATE_VALUE'));
});
test('stable adapter takes source/tenant/context/receipt locks before provider reads and callback',async()=>{
 const f=fixture(),queries=[];f.tx.$queryRaw=async(strings,...values)=>{queries.push({sql:strings.join('?'),values});};
 let invoked=0;const stable=createStableActivationProof({...f.options,
  readAssistant:async id=>{assert.equal(queries.length,12);return {id,metadata:{businessId:7}};}});
 await stable(f.tx,policy,async proof=>{invoked++;assert.equal(proof.assistant.metadata.businessId,7);assert.equal(proof.billingReceipt,null);});
 assert.equal(invoked,1);assert.ok(queries.some(q=>q.sql.includes('"SignupAttempt"')&&q.sql.includes('FOR SHARE')));
 assert.equal(queries.filter(q=>q.sql.includes('"RuntimeStore"')).length,3);
 assert.ok(queries.some(q=>q.values.includes('signup-business-bindings:v1')));
});
test('stable adapter refuses invalid policy without lock or callback',async()=>{
 const f=fixture();let calls=0;f.tx.$queryRaw=async()=>{calls++;};
 await assert.rejects(createStableActivationProof(f.options)(f.tx,{...policy,phantomId:policy.signupAttemptId},()=>{calls++;}),/POLICY_REQUIRED/);assert.equal(calls,0);
});
test('stable adapter preserves provider read failure and never invokes save callback',async()=>{
 const f=fixture();f.tx.$queryRaw=async()=>{};let calls=0;
 const stable=createStableActivationProof({...f.options,readPhone:async()=>{throw Error('synthetic provider read timeout');}});
 await assert.rejects(stable(f.tx,policy,()=>{calls++;}),/timeout/);assert.equal(calls,0);
});
