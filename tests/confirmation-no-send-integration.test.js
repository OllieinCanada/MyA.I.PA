'use strict';
// Local phone-tool component integration only. No audio, PSTN, Vapi service,
// model behavior or delivery is exercised by this deterministic harness.
const test=require('node:test'),assert=require('node:assert/strict');
const {createDispatchStub}=require('../scripts/stub-notification-dispatch');
const {buildIsolatedToolPayload,updateMessages}=require('../server/vapiIsolatedSmsProvisioning');
const {toolRejectionPlan}=require('../server/callConfirmation');
const {evaluateGeneratedPlan}=require('./support/generated-plan-offline.cjs');
const {parseToolResult,notificationEvidence}=require('../server/callNotificationEvidence');
const {checkPublishedConfiguration}=require('../scripts/check-signup-policy-rollout');
let Liquid;try{({Liquid}=require(process.env.MYAIPA_LIQUID_EVALUATOR||'liquidjs'));}catch(e){if(process.env.MYAIPA_LIQUID_EVALUATOR)throw e;}
const engine=Liquid&&new Liquid();
const render=engine?(template,messages)=>engine.parseAndRenderSync(template,{messages}):undefined;
const tool=buildIsolatedToolPayload({aiNumber:'+19055550100',ownerNumber:'+19055550101',twilioAccountSid:'AC_INERT',twilioAuthToken:'INERT',suppressionCheckUrl:'https://stub.invalid/check',suppressionApiKey:'INERT',statusCallbackUrl:'https://api.myaipa.ca/api/webhooks/twilio/message-status'});
const q='Repair: replace a light at 1 Test St, Example City, sometime next week; callback after 2 PM. Should I send this request to the team now?';
const history=reply=>[{role:'assistant',content:q},{role:'user',content:reply},{role:'assistant',content:'Got it.'},{role:'assistant',tool_calls:[{id:'inert-tool',function:{name:tool.function.name}}]}];
const args={businessName:'Synthetic Business',name:'Test Caller',requestType:'repair',rawPhoneNumber:'+19055550999',streetAddress:'1 Test St',city:'Example City',jobDetails:'replace a light',preferredStartDate:'sometime next week',bestCallbackTime:'after 2 PM',pricingDiscussed:false,workDetailsConfirmed:true};
const env={TWILIO_ACCOUNT_SID:'AC_INERT',TWILIO_AUTH_TOKEN:'INERT',DEFAULT_FROM_NUMBER:'+19055550100',DEFAULT_OWNER_TO_NUMBER:'+19055550101',CALLER_NUMBER:'+19055550102',CALL_ID:'inert-call-1',SMS_SUPPRESSION_CHECK_URL:'https://stub.invalid/check',SMS_SUPPRESSION_API_KEY:'INERT',TWILIO_STATUS_CALLBACK_URL:'https://api.myaipa.ca/api/webhooks/twilio/message-status',OWNER_SMS_ENABLED:'true'};
const runner=new Function('args','env','fetch','btoa','URLSearchParams',`return (async()=>{${tool.code}\n})()`);
function evidence(result){return notificationEvidence({count:1,countIsExact:true,toolCallIds:['inert-tool'],results:[{toolCallId:'inert-tool',name:tool.function.name,...parseToolResult(result)}]});}
async function run({messages=history('Yes, please.'),input={},settings={},failRecipient=0,unknownRecipient=0}={}){
 const posts=[],checks=[];
 if(!evaluateGeneratedPlan(tool.rejectionPlan,messages,render))return{allowed:false,posts,checks,result:'Tool call rejected based on configured rejection plan'};
 const fetchStub=async(url,options)=>{
  if(url==='https://stub.invalid/check'){checks.push(url);return{ok:true,status:200,json:async()=>({allowed:true,suppressed:false})};}
  assert.match(String(url),/^https:\/\/api\.twilio\.com\/2010-04-01\/Accounts\/AC_INERT\/Messages\.json$/);
  const form=new URLSearchParams(options.body);posts.push(Object.fromEntries(form));
  if(posts.length===unknownRecipient)throw Error('Synthetic uncertain transport');
  if(posts.length===failRecipient)return{ok:false,status:400,json:async()=>({code:30007,message:'Synthetic rejection'})};
  return{ok:true,status:201,json:async()=>({sid:'SM'+String(posts.length).repeat(32),status:'queued'})};
 };
 const result=await runner({...args,...input},{...env,SMS_NOTIFICATION_DISPATCH_URL:'https://stub.invalid/dispatch',...settings},createDispatchStub().wrap(fetchStub),v=>Buffer.from(v).toString('base64'),URLSearchParams);
 return{allowed:true,posts,checks,result};
}
test('generated phone tool saves drafts but cannot submit provider messages',async()=>{assert.deepEqual(tool.rejectionPlan,toolRejectionPlan());const r=await run();assert.equal(r.result.complete,false);assert.equal(r.result.draftStored,true);assert.equal(r.posts.length,0);assert.equal(r.checks.length,0);assert.equal(evidence(r.result).customer.accepted,false);});
for(const answer of ['Perfect. Yes.','Yes, you can send it.','No worries, send it.'])test('approval only prepares a draft '+answer,async()=>{const r=await run({messages:history(answer)});assert.equal(r.result.draftStored,true);assert.equal(r.result.complete,false);assert.equal(r.posts.length,0);});
for(const answer of ['No.','Wait.','Yes, but change the address.','If I say yes, will you send it?'])test('blocked consent never reaches compiled sender '+answer,async()=>{const r=await run({messages:history(answer)});assert.equal(r.allowed,false);assert.equal(r.posts.length,0);assert.equal(r.checks.length,0);assert.equal(evidence(r.result).rejectedBeforeExecution,true);});
test('available later cancellation blocks before transport',async()=>{const r=await run({messages:[...history('Yes.'),{role:'user',content:'No, wait.'}]});assert.equal(r.allowed,false);assert.equal(r.posts.length,0);});
test('missing work detail cannot be bypassed by a clear yes',async()=>{const r=await run({input:{city:''}});assert.equal(r.posts.length,0);assert.equal(r.result.needsIntakeDetails,true);assert.equal(r.result.complete,false);});
test('provider failure modes are unreachable from the phone tool',async()=>{for(const options of [{failRecipient:2},{unknownRecipient:2}]){const r=await run(options);assert.equal(r.posts.length,0);assert.equal(r.result.draftStored,true);assert.equal(r.result.complete,false);}});
test('owner-disabled policy prepares only the caller draft',async()=>{const r=await run({settings:{OWNER_SMS_ENABLED:'false'}});assert.equal(r.posts.length,0);assert.equal(r.result.owner.skipped,true);assert.equal(r.result.customer.draftStored,true);});
test('explicit rollout checker rejects a stale rule even if ordinary provisioning calls it healthy',()=>{const assistant={firstMessage:'Synthetic only',model:{provider:'openai',model:'gpt-4o',toolIds:['inert'],messages:updateMessages([{role:'system',content:'Synthetic business facts'}],tool.function.name)}};assert.equal(checkPublishedConfiguration(assistant,{...tool,rejectionPlan:{conditions:[{type:'regex',regex:'.*'}]}}).confirmationPlan,false);assert.equal(checkPublishedConfiguration(assistant,tool).confirmationPlan,true);});
test('current-main separate work-start versus callback policy survives prompt integration',()=>{const text=updateMessages([{role:'system',content:'Keep these business facts.'}],tool.function.name)[0].content;for(const s of ['Work-start timing and callback timing are different facts.','Never copy one answer into both fields.','DRAFT REVIEW WORKFLOW','If transcription splits a reply','Keep these business facts.'])assert.ok(text.includes(s),s);});
