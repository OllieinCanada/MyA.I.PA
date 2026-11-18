'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {prepareVerifiedSignupRecord:prepare,projectPreparedVerification:project}=require('../server/signupActivationPreparation');
const {normalizeSignupProvisioningPayload}=require('../server/signupProvisioning');
const {buildMakeSignupEventKey}=require('../server/makeSignupWebhook');
const {buildSignupAssistantConfig}=require('../server/signupAssistantTemplate');
const {fingerprintAssistantContent}=require('../server/signupAssistantVerification');
const {VERSION}=require('../server/trialCalendarPolicy');
function fixture(){
 const signingSecret='invented-activation-secret-32-characters';
 const raw={business:{name:'Invented Electrical',services:'Invented repairs'},businessType:'Electrical',serviceArea:'Invented service area',owner:{name:'Invented Owner',email:'invented@example.test',phone:'+19055550123'},verification:{smsVerified:true}};
 const payload=normalizeSignupProvisioningPayload(raw,{signingSecret}),id=buildMakeSignupEventKey(raw);
 const record={signupAttemptId:id,businessName:raw.business.name,ownerEmail:raw.owner.email,ownerPhone:raw.owner.phone,
  twilioPhoneNumber:'+13655550101',vapiAssistantId:'fixture-assistant',vapiPhoneNumberId:'fixture-phone',status:'setup_error',smsVerified:true,
  resourceAssociationRepair:{historyMarker:'preserve'},agentTestStatus:'testing_required'};
 const assistant={...buildSignupAssistantConfig(payload,{assignedPhone:record.twilioPhoneNumber,resourceName:'Invented assistant'}),id:record.vapiAssistantId};
 const phone={id:record.vapiPhoneNumberId,number:record.twilioPhoneNumber,assistantId:assistant.id};
 const business={id:7,settings:{ownerPhone:record.ownerPhone},vapiMappings:[['phoneNumber',phone.number],['phoneNumberId',phone.id],['assistantId',assistant.id]].map(([matchType,matchValue])=>({businessId:7,matchType,matchValue}))};
 return {records:[record],attempt:{eventKey:id,payload:raw,businessName:record.businessName,ownerEmail:record.ownerEmail,ownerPhone:record.ownerPhone,status:'setup_error',assignedPhone:phone.number,vapiPhoneNumberId:phone.id,vapiAssistantId:assistant.id},
  context:{signupEventKey:id,payload,contextHash:payload.provisioning.contextHash},receipt:{status:'completed',contextHash:payload.provisioning.contextHash,result:{assistantId:assistant.id,contentFingerprint:fingerprintAssistantContent(assistant)}},
  assistant,phone,business,signingSecret,consent:{signupAttemptId:id,calendarPolicy:VERSION},billingReceipt:null,now:'2026-11-17T23:30:00.000Z'};
}
test('exact prepared patch verifies content/route and enrolls Toronto policy without readiness, clock, delivery or mutations',()=>{
 const f=fixture(),before=JSON.stringify(f),p=prepare(f);assert.equal(JSON.stringify(f),before);
 assert.equal(p.patch.trialCalendarEnrollmentVersion,VERSION);assert.equal(p.patch.agentContentStatus,'verified');assert.equal(p.patch.agentRouteBindingStatus,'verified');
 assert.equal(p.applyAllowed,false);assert.equal(p.trialStarted,false);assert.equal(p.messagesSent,0);
 const store={original:f.records[0],phantom:{status:'superseded_duplicate',history:{keep:true}},unrelated:{keep:true}},prior=structuredClone(store),next=project(store,p);
 assert.deepEqual(store,prior);assert.deepEqual(next.phantom,store.phantom);assert.deepEqual(next.unrelated,store.unrelated);
 for(const field of ['status','agentTestStatus','resourceAssociationRepair','twilioPhoneNumber','ownerPhone'])assert.deepEqual(next.original[field],store.original[field]);
 assert.equal(next.original.subscriptionId,undefined);assert.equal(next.original.trialStartAt,undefined);
 assert.throws(()=>project(next,p),/STALE_RECORD/);
});
for(const [name,change] of [
 ['wrong consent',f=>f.consent.signupAttemptId='signup_'+'f'.repeat(32)],['wrong policy',f=>f.consent.calendarPolicy='rolling-14'],
 ['missing explicit receipt read',f=>delete f.billingReceipt],['pending billing',f=>f.billingReceipt={status:'processing'}],['old trial',f=>f.records[0].trialEndAt='2026-01-01'],
 ['existing subscription',f=>f.records[0].subscriptionId='synthetic-sub'],['existing customer',f=>f.records[0].stripeCustomerId='synthetic-customer'],
 ['closed signup',f=>f.records[0].status='archived'],['duplicate signup',f=>f.records.push({...f.records[0]})],
 ['phone conflict',f=>f.phone.assistantId='foreign'],['source assignment conflict',f=>f.attempt.assignedPhone='+13655550199'],
 ['tenant claim',f=>f.assistant.metadata={businessId:8}],['mapping tenant conflict',f=>f.business.vapiMappings[0].businessId=8],
 ['owner conflict',f=>f.business.settings.ownerPhone='+19055550199'],['missing mapping',f=>f.business.vapiMappings.pop()],
 ['shared resource',f=>f.records.push({...f.records[0],signupAttemptId:'signup_'+'d'.repeat(32)})],
 ['changed script',f=>f.assistant.firstMessage='Changed business script'],['receipt conflict',f=>f.receipt.result.contentFingerprint='f'.repeat(64)],
 ['unsigned context',f=>f.context.payload.provisioning.authorizationToken='invalid']
])test(name+' refuses a proposal without writing or sending',()=>{const f=fixture();change(f);const before=JSON.stringify(f);assert.throws(()=>prepare(f));assert.equal(JSON.stringify(f),before);});
test('projection refuses changed records and tampered patch before any mutation',()=>{
 const f=fixture(),p=prepare(f),store={original:structuredClone(f.records[0])};
 const bad=structuredClone(p);bad.patch.status='setup_ready';assert.throws(()=>project(store,bad),/PLAN_CHANGED|PATCH_SCOPE/);
 store.original.ownerPhone='+19055550199';assert.throws(()=>project(store,p),/STALE_RECORD/);
});
