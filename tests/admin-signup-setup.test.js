const test=require('node:test');const assert=require('node:assert/strict');
const {projectSetup,readSetupEvidence,createNumberSearchTracker}=require('../server/adminSignupSetup');
const {normalizeSignupProvisioningPayload}=require('../server/signupProvisioning');
const {contextStoreKey}=require('../server/signupProvisioningContext');
const {provisioningStateKey}=require('../server/provisioningState');
const {buildMakeSignupEventKey}=require('../server/makeSignupWebhook');
const {buildAgentTestFingerprint}=require('../server/signupAgentTesting');
const input={businessName:'Fixture Electric',ownerEmail:'fixture@example.test',ownerPhone:'+19055550198',businessPhone:'+19055550199',businessAddress:'23 Robb Street, Hamilton, ON L8L 1A1'};
function fixture(fallback=false){const payload=normalizeSignupProvisioningPayload(input,{signingSecret:'fixture-number-policy-signing-secret',allowRegionalFallback:fallback});const context={payload,contextHash:payload.provisioning.contextHash,lockedAt:'2026-11-10T20:00:00Z'};const record={...input,signupAttemptId:buildMakeSignupEventKey(payload)};return{context,record};}
test('full setup has eighteen independent checks without provider mutations or secrets',()=>{
 const setup=projectSetup({...input,subscriptionId:'secret-billing-id',agentTestOwnerMessageSid:'secret-message-id'});
 assert.equal(setup.readOnly,true);assert.equal(setup.groups.length,4);assert.equal(setup.groups.flatMap(g=>g.checks).length,18);
 assert.equal(setup.groups.flatMap(g=>g.checks).filter(c=>c.state==='verified').length,0);
 assert.doesNotMatch(JSON.stringify(setup),/secret-billing|secret-message|fixture@example|5550198|Robb/);
});
test('number, phone and assistant business mappings are separate exact checks',()=>{
 const record={businessId:44,twilioPhoneNumber:'+12895550111',vapiAssistantId:'assistant-a',vapiPhoneNumberId:'phone-a'};
 const business={id:44,vapiMappings:[{matchType:'phonenumber',matchValue:record.twilioPhoneNumber}]};
 const checks=projectSetup(record,{business}).groups[1].checks;
 assert.equal(checks.find(c=>c.id==='number-mapping').state,'verified');
 assert.equal(checks.find(c=>c.id==='phone-id-mapping').state,'pending');assert.equal(checks.find(c=>c.id==='assistant-mapping').state,'pending');
 assert.doesNotMatch(JSON.stringify(checks),/assistant-a|phone-a|5550111/);
});
test('signed strict and fallback policies are distinguished; no guessed current search',()=>{
 const strict=projectSetup(input,{context:fixture().context});assert.deepEqual(strict.number.areaOrder,['289']);assert.equal(strict.number.search,null);assert.equal(strict.number.locked,true);
 assert.deepEqual(projectSetup(input,{context:fixture(true).context}).number.areaOrder,['289','905','365','742']);
});
test('accepted practice text is not delivered and stale fingerprints cannot pass either check',()=>{
 const record={vapiAssistantId:'assistant',twilioPhoneNumber:'+12895550111',ownerPhone:'+19055550198',agentContentFingerprint:'content',agentTestOwnerAcceptedAt:'2026-11-10T20:00:00Z',agentTestOwnerProviderStatus:'accepted'};
 record.agentTestFingerprint=buildAgentTestFingerprint({assistantId:record.vapiAssistantId,aiNumber:record.twilioPhoneNumber,ownerPhone:record.ownerPhone,contentFingerprint:'content'});
 let checks=projectSetup(record).groups[2].checks;assert.equal(checks.find(c=>c.id==='Owner-accepted').state,'verified');assert.equal(checks.find(c=>c.id==='Owner-delivered').state,'pending');
 record.agentTestOwnerProviderStatus='delivered';record.agentTestOwnerDeliveredAt='2026-11-10T20:01:00Z';
 assert.equal(projectSetup(record).groups[2].checks.find(c=>c.id==='Owner-delivered').state,'verified');
 record.agentContentFingerprint='changed';checks=projectSetup(record).groups[2].checks;assert.equal(checks.find(c=>c.id==='Owner-accepted').state,'pending');assert.equal(checks.find(c=>c.id==='Owner-delivered').state,'pending');
});
test('failed and uncertain purchase is visible without replaying; trial activation alone never marks setup ready',()=>{
 const setup=projectSetup({subscriptionId:'sub',subscriptionStatus:'trialing',status:'setup_ready'},{receipts:{'twilio-number':{status:'failed',attempts:1,dispatchStartedAt:'2026-11-10'}}});
 assert.equal(setup.number.stage.uncertain,true);assert.equal(setup.groups[0].checks[1].state,'blocked');
 assert.equal(setup.groups[3].checks[0].state,'verified');assert.equal(setup.groups[3].checks[1].state,'pending');
});
test('exact read only performs context and three receipt reads; mismatched attempts or receipts never borrow another business',async()=>{
 const {context,record}=fixture(),key=context.payload.provisioning.idempotencyKey;const store=new Map([[contextStoreKey(key),{data:context}]]);let reads=0;
 const prisma={runtimeStore:{findUnique:async({where})=>{reads++;return store.get(where.key);}}};
 let setup=await readSetupEvidence({prisma,record});assert.equal(reads,4);assert.equal(setup.coverage,'exact_context_and_saved_receipts');
 store.set(provisioningStateKey('vapi-assistant',key),{data:{contextHash:'b'.repeat(64),status:'completed',result:{assistantId:'foreign'}}});
 setup=await readSetupEvidence({prisma,record});assert.equal(setup.coverage,'receipt_context_mismatch');assert.equal(setup.number.policyValid,false);
 const wrong={...record,signupAttemptId:'signup_'+'0'.repeat(32)};setup=await readSetupEvidence({prisma,record:wrong});assert.equal(setup.coverage,'exact_context_unavailable');
});
test('live search status is context-bound, stale at thirty seconds, bounded and expires after restart/ten minutes',()=>{
 let now=100000;const tracker=createNumberSearchTracker({now:()=>now}),key='a'.repeat(64),hash='b'.repeat(64);
 tracker.record(key,hash,{phase:'searching',areaCode:'289',private:'never stored'});tracker.record(key,hash,{phase:'empty',areaCode:'289'});tracker.record(key,hash,{phase:'searching',areaCode:'905'});
 assert.equal(tracker.read(key,hash).areaCode,'905');assert.equal(tracker.read(key,'c'.repeat(64)),null);assert.doesNotMatch(JSON.stringify(tracker.read(key,hash)),/never stored/);
 now+=30001;assert.equal(tracker.read(key,hash).stale,true);now+=600000;assert.equal(tracker.read(key,hash),null);assert.equal(createNumberSearchTracker().read(key,hash),null);
});
