const test=require('node:test');
const assert=require('node:assert/strict');
const {ownership,assistantPatch,applyPlans,plansFor,POLICY}=require('../scripts/rollout-signup-assistant-policy');
const {speechSnapshot}=require('../scripts/repair-signup-speech');
const {checkSummary,checkPublishedConfiguration}=require('../scripts/check-signup-policy-rollout');
const {getVapiCompositeToolCode}=require('../server/compositeCallNotifications');
function fixture(){
 const signup={businessName:'Example Electric',signupAttemptId:'attempt-one',businessId:1,provisioningBusinessKey:'business-one',identityVerified:true,vapiAssistantId:'a',vapiPhoneNumberId:'p',twilioPhoneNumber:'+19055550123',ownerPhone:'+19055550124',status:'agent_testing'};
 const phone={id:'p',number:signup.twilioPhoneNumber,assistantId:'a'};
 const assistant={id:'a',latestVersion:'v1',firstMessage:'Thanks for calling Example Electric. How are you today?',voice:{provider:'old'},model:{provider:'openai',model:'gpt-4o',toolIds:['t'],messages:[{role:'system',content:'Business facts and approved rates: 90 visit, 100 hourly.'}]}};
 const tool={id:'t',latestVersion:'v1',function:{name:'send_call_summaries_0123_12345678_v2',parameters:{}},code:'old',environmentVariables:[{name:'SECRET',value:'keep'}]};
 const data={signups:[signup],phones:[phone],customers:[],mappings:[{matchType:'assistantId',matchValue:'a',businessId:1},{matchType:'phoneNumber',matchValue:signup.twilioPhoneNumber,businessId:1}]};
 const plan={signup,phone,assistant:structuredClone(assistant),tool:structuredClone(tool),payload:assistantPatch(assistant,tool),nextTool:{function:tool.function,code:'new'}};
 const writes=[];
 const api=async(endpoint,options={})=>{const target=endpoint.startsWith('/assistant')?assistant:tool;if(options.method){writes.push({endpoint,...options});Object.assign(target,structuredClone(options.body));target.latestVersion='v2';}return structuredClone(target);};
 return {signup,data,assistant,tool,plan,writes,api};
}
test('requires active verified business and exact mapping',()=>{
 const f=fixture();assert.equal(ownership(f.data,f.signup),'');
 assert.equal(ownership(f.data,{...f.signup,archivedAt:'now'}),'missing_active_verified_business_identity');
 assert.equal(ownership(f.data,{...f.signup,businessId:2}),'crm_ownership_mismatch');
 f.data.signups.push({...f.signup,signupAttemptId:'other',businessId:2});assert.equal(ownership(f.data,f.signup),'shared_active_signup_resource');
});

test('a scoped rollout retains the full ownership inventory and cannot ignore conflicting signups',async()=>{
 const f=fixture();f.data.assistants=[f.assistant];f.data.tools=[f.tool];
 const unrelated=await plansFor(f.data,f.api,{businessId:999});assert.equal(unrelated.plans.length,0);
 f.data.signups.push({...f.signup,signupAttemptId:'conflict',businessId:999});
 const scoped=await plansFor(f.data,f.api,{businessId:1});assert.equal(scoped.plans.length,0);
 assert.equal(scoped.skipped[0].reason,'shared_active_signup_resource');
});

test('trial snapshots refresh only after provider readback and are reconciled after a failed refresh',async()=>{
 const f=fixture();const published=[];
 const result=await applyPlans({io:{api:f.api},plans:[f.plan],recheck:async()=>{},backup:async()=>{},refreshGate:async(_p,a)=>{published.push(a.model.messages);if(published.length===1)throw Error('snapshot failed');}});
 assert.equal(result[0].verified,false);assert.equal(published.length,2);
 assert.deepEqual(published[1],f.plan.assistant.model.messages);
});
test('trial-gated pairing requires exact server and saved gate evidence',()=>{
 const f=fixture();delete f.data.phones[0].assistantId;
 assert.equal(ownership(f.data,f.signup),'phone_route_mismatch');
 f.signup.agentRouteBindingMode='trial-gate';f.data.phones[0].server={url:'https://api.myaipa.ca/api/webhooks/voice'};
 assert.equal(ownership(f.data,f.signup),'');
});
test('prompt migration is idempotent and preserves business facts, model and tools',()=>{
 const f=fixture(),patch=f.plan.payload;
 assert.ok(patch.model.messages[0].content.includes('90 visit, 100 hourly'));
 assert.ok(patch.model.messages[0].content.includes(POLICY));
 assert.deepEqual(patch.model.toolIds,['t']);assert.equal(patch.model.model,'gpt-4o');
 assert.deepEqual(assistantPatch({...f.assistant,...patch},f.tool),patch);
 assert.ok(patch.firstMessage.includes('This call will be recorded'));
 assert.ok(!patch.firstMessage.includes('Is that okay?'));
});

test('rollout migrates legacy approval rules so Yes, please reaches the SMS tool',async()=>{
 const f=fixture();
 f.assistant.name='myaipa-vapi-assistant-example';
 f.assistant.model.messages[0].content='- Business name: Example Electric\nMYAIPA_AGENT_VERSION: fixture';
 f.tool.environmentVariables=[{name:'DEFAULT_FROM_NUMBER',value:f.signup.twilioPhoneNumber},{name:'DEFAULT_OWNER_TO_NUMBER',value:f.signup.ownerPhone}];
 f.tool.rejectionPlan={conditions:[{type:'regex',regex:'^yes$',negate:true,target:{role:'user',position:-1}}]};
 const data={...f.data,assistants:[f.assistant],tools:[f.tool]};
 const {plans,skipped}=await plansFor(data,f.api);
 assert.deepEqual(skipped,[]);assert.equal(plans.length,1);
 const conditions=plans[0].nextTool.rejectionPlan.conditions[0].conditions;
 const accepts=new RegExp(conditions[0].regex.replace(/^\(\?i\)/,''),'i');
 const cancels=new RegExp(conditions[1].regex.replace(/^\(\?i\)/,''),'i');
 assert.equal(accepts.test('Yes, please.'),true);
 assert.equal(cancels.test("Yes, don't send it."),true);
 const result=await applyPlans({io:{api:f.api},plans,recheck:async()=>{},backup:async()=>{}});
 assert.equal(result[0].verified,true);
 assert.deepEqual(f.tool.rejectionPlan,plans[0].nextTool.rejectionPlan);
});
test('apply saves backup first and only patches exact content',async()=>{
 const f=fixture();let saved=false;
 const results=await applyPlans({io:{api:f.api},plans:[f.plan],recheck:async()=>assert.ok(saved),backup:async()=>{saved=true;}});
 assert.equal(results[0].verified,true);assert.equal(f.writes.length,2);
 assert.ok(f.writes.every(w=>w.method==='PATCH'));assert.deepEqual(f.tool.environmentVariables,[{name:'SECRET',value:'keep'}]);
});
test('failed backup prevents all writes',async()=>{
 const f=fixture();await assert.rejects(applyPlans({io:{api:f.api},plans:[f.plan],recheck:async()=>{},backup:async()=>{throw Error('disk');}}));assert.equal(f.writes.length,0);
});
test('concurrent change is preserved and prevents writes',async()=>{
 const f=fixture();f.assistant.model.model='new-model';
 const results=await applyPlans({io:{api:f.api},plans:[f.plan],recheck:async()=>{},backup:async()=>{}});
 assert.equal(results[0].verified,false);assert.equal(f.writes.length,0);
});
test('failed readback restores tool and assistant without touching another business',async()=>{
 const f=fixture();let calls=0;
 const results=await applyPlans({io:{api:f.api},plans:[f.plan,{...f.plan}],recheck:async()=>{if(++calls===2)throw Error('guard changed');},backup:async()=>{}});
 assert.equal(results.length,1);assert.equal(results[0].verified,false);assert.deepEqual(results[0].rollback,['restored','restored']);
 assert.deepEqual(speechSnapshot(f.assistant),speechSnapshot(f.plan.assistant));assert.equal(f.tool.code,'old');
});
test('published summary smoke uses stub transport for pricing, hazard and no hazard',async()=>{
 const tool={code:getVapiCompositeToolCode(),environmentVariables:['TWILIO_API_KEY_SID','TWILIO_API_KEY_SECRET','OWNER_SMS_ENABLED','PRICING_SUMMARY_OPTIONS'].map(name=>({name}))};
 for(const args of [{requestType:'repair',pricingDiscussed:true,safetyConcern:'none'},{requestType:'message',safetyConcern:'reported_hazard'},{requestType:'installation',safetyConcern:'none'}]) assert.equal(await checkSummary(tool,args),true);
});
test('policy rollout preserves individual choices and refuses a mismatched summary policy',()=>{
 const f=fixture();
 const choices={includeVisitFee:false,includeHourlyRate:true,includeAssessment:false,includePartsExtra:false,installationFreeEstimate:false};
 f.assistant.model.messages[0].content+='\nMYAIPA_PRICING_CHOICES: '+JSON.stringify(choices);
 assert.throws(()=>assistantPatch(f.assistant,f.tool),/pricing policy and summary tool do not match/);
 f.tool.environmentVariables.push({name:'PRICING_SUMMARY_OPTIONS',value:JSON.stringify({includePartsExtra:false,includeAssessment:false})});
 const patch=assistantPatch(f.assistant,f.tool);
 assert.ok(patch.model.messages[0].content.includes('MYAIPA_PRICING_CHOICES:'));
 assert.ok(!patch.model.messages[0].content.includes(POLICY));
});
test('published summary smoke respects all individual reminder choices with fake transport',async()=>{
 for(const includePartsExtra of [false,true])for(const includeAssessment of [false,true]){
  const tool={code:getVapiCompositeToolCode(),environmentVariables:['TWILIO_API_KEY_SID','TWILIO_API_KEY_SECRET','OWNER_SMS_ENABLED'].map(name=>({name})).concat({name:'PRICING_SUMMARY_OPTIONS',value:JSON.stringify({includePartsExtra,includeAssessment})})};
  assert.equal(await checkSummary(tool,{requestType:'repair',pricingDiscussed:true,safetyConcern:'none'}),true);
 }
});
test('summary smoke refuses unexpected remote code before execution',async()=>{
 await assert.rejects(checkSummary({code:'throw Error("must not run")'},{requestType:'repair'}),/audited local definition/);
});

test('published readback refuses an old confirmation plan even when tool code is current',()=>{
 const f=fixture();const {toolPatch}=require('../scripts/refresh-vapi-job-type');
 const {toolRejectionPlan}=require('../server/callConfirmation');
 const tool={...f.tool,...toolPatch(f.tool),rejectionPlan:toolRejectionPlan()};
 tool.environmentVariables.push({name:'TWILIO_STATUS_CALLBACK_URL',value:'https://api.myaipa.ca/api/webhooks/twilio/message-status'},{name:'CALLER_NUMBER',value:'{{ customer.number }}'});
 const assistant={...f.assistant,...assistantPatch(f.assistant,tool)};
 assert.ok(Object.values(checkPublishedConfiguration(assistant,tool)).every(Boolean));
 tool.rejectionPlan={conditions:[]};assert.equal(checkPublishedConfiguration(assistant,tool).confirmationPlan,false);
 tool.environmentVariables=tool.environmentVariables.filter(v=>v.name!=='TWILIO_STATUS_CALLBACK_URL');
 assert.equal(checkPublishedConfiguration(assistant,tool).statusReceipts,false);
});
