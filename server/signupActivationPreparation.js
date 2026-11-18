'use strict';
const {digest}=require('./signupAssociationRepair');
const {isClosedSignup,signupBusinessKey}=require('./signupBusinessIdentity');
const {registeredSignupEventKey}=require('./signupProvisioningContext');
const {normalizeSignupProvisioningPayload,verifySignupProvisioningAuthorization}=require('./signupProvisioning');
const {buildSignupAssistantConfig}=require('./signupAssistantTemplate');
const {fingerprintAssistantContent}=require('./signupAssistantVerification');
const {buildAgentRouteFingerprint}=require('./signupAgentTesting');
const {VERSION}=require('./trialCalendarPolicy');
const fail=code=>{throw Object.assign(Error(code),{code});};

// Local preparation only, not an apply endpoint. Inputs must come from a future
// server-owned locked reader; never accept this proof/plan from an HTTP caller.
// There are deliberately no writers, transports, billing clients or callbacks.
function prepareVerifiedSignupRecord({records,attempt,context,receipt,assistant,phone,business,
 signingSecret,consent,billingReceipt,now=new Date().toISOString()}){
 const id=consent?.signupAttemptId;
 if(!/^signup_[a-f0-9]{32}$/.test(id||'')||consent?.calendarPolicy!==VERSION)fail('ACTIVATION_EXACT_CALENDAR_CONSENT_REQUIRED');
 if(!Array.isArray(records)||!attempt?.payload||attempt.eventKey!==id||isClosedSignup(attempt))fail('ACTIVATION_SOURCE_REQUIRED');
 const matches=records.filter(r=>r.signupAttemptId===id);
 if(matches.length!==1||isClosedSignup(matches[0]))fail('ACTIVATION_EXACT_OPEN_RECORD_REQUIRED');
 const record=matches[0],key=signupBusinessKey(record);
 if(!(record.smsVerified||record.emailVerified)||!(attempt.payload.verification?.smsVerified||attempt.payload.verification?.emailVerified))fail('ACTIVATION_CONTACT_UNVERIFIED');
 if(!key||signupBusinessKey(attempt)!==key||signupBusinessKey(context?.payload)!==key
  ||registeredSignupEventKey(context)!==id||context?.payload?.provisioning?.idempotencyKey!==key
  ||context.contextHash!==context.payload.provisioning.contextHash
  ||!verifySignupProvisioningAuthorization(context.payload,signingSecret))fail('ACTIVATION_CONTEXT_CONFLICT');
 if(!Number.isFinite(Date.parse(now)))fail('ACTIVATION_TIME_REQUIRED');
 if(!Number.isSafeInteger(business?.id)||business.id<1||record.businessId!=null&&record.businessId!==business.id
  ||phone?.id!==record.vapiPhoneNumberId||phone?.number!==record.twilioPhoneNumber
  ||phone?.assistantId!==record.vapiAssistantId||assistant?.id!==record.vapiAssistantId
  ||attempt.assignedPhone!==record.twilioPhoneNumber||attempt.vapiPhoneNumberId!==phone?.id||attempt.vapiAssistantId!==assistant?.id
  ||!/^\+1[2-9]\d{9}$/.test(record.twilioPhoneNumber||''))fail('ACTIVATION_ROUTE_CONFLICT');
 for(const resource of [assistant,phone])for(const claim of [resource.businessId,resource.metadata?.businessId])
  if(claim!=null&&String(claim)!==String(business.id))fail('ACTIVATION_TENANT_CONFLICT');
 if(business.settings?.ownerPhone&&business.settings.ownerPhone!==record.ownerPhone)fail('ACTIVATION_OWNER_CONFLICT');
 const expected=[['phoneNumber',record.twilioPhoneNumber],['phoneNumberId',phone.id],['assistantId',assistant.id]];
 if(!Array.isArray(business.vapiMappings)||business.vapiMappings.some(r=>r.businessId!=null&&r.businessId!==business.id)
  ||!expected.every(([type,value])=>business.vapiMappings.filter(r=>r.matchType===type&&r.matchValue===value).length===1)
  ||records.some(r=>r.signupAttemptId!==id&&['twilioPhoneNumber','vapiPhoneNumberId','vapiAssistantId'].some(f=>record[f]&&r[f]===record[f])))fail('ACTIVATION_OWNERSHIP_CONFLICT');
 const normalized=normalizeSignupProvisioningPayload(attempt.payload,{signingSecret,defaultRegion:'ON'});
 const fingerprint=fingerprintAssistantContent(assistant),expectedConfig=buildSignupAssistantConfig(normalized,{assignedPhone:phone.number,resourceName:assistant.name});
 if(receipt?.status!=='completed'||receipt.contextHash!==context.contextHash||receipt.result?.assistantId!==assistant.id
  ||receipt.result?.contentFingerprint!==fingerprint||fingerprintAssistantContent(expectedConfig)!==fingerprint)fail('ACTIVATION_SCRIPT_CONFLICT');
 // A new clock must never replace an existing or uncertain billing history.
 if(billingReceipt!==null||['subscriptionId','stripeSubscriptionId','stripeCustomerId','subscriptionStatus','trialStartAt','trialStartedAt','trialEndAt','trialEndsAt','trialCalendarPolicy'].some(k=>record[k]))fail('ACTIVATION_BILLING_INSPECTION_REQUIRED');
 if(record.trialCalendarEnrollmentVersion&&record.trialCalendarEnrollmentVersion!==VERSION)fail('ACTIVATION_CALENDAR_CONFLICT');
 const patch={businessId:business.id,agentContentStatus:'verified',agentContentFingerprint:fingerprint,
  agentContentVerifiedAt:now,agentContentVerificationSource:'exact_signup_payload_and_completed_receipt',agentContentErrorCode:'',
  agentRouteBindingStatus:'verified',agentRouteBindingMode:'direct',agentRouteBindingVerifiedAt:now,
  agentRouteBindingFingerprint:buildAgentRouteFingerprint({mode:'direct',businessId:business.id,phoneNumberId:phone.id,aiNumber:phone.number,assistantId:assistant.id}),
  agentRouteBindingErrorCode:'',trialCalendarEnrollmentVersion:VERSION};
 return {signupAttemptId:id,contextHash:context.contextHash,expectedRecordDigest:digest(record),patch,planDigest:digest({id,record,patch,contextHash:context.contextHash}),
  readOnly:true,applyAllowed:false,ready:false,trialStarted:false,messagesSent:0,
  remaining:['running-process guarded writer and fresh locked proof','automatic assistant installation/readback','bounded practice delivery receipts','normal trial and protected gate'],
  limitation:'Preparation only. Does not save this patch, install the tool, start a trial or send messages. Real writer/database/transport integration is not proven by this plan.'};
}
function projectPreparedVerification(store,plan){
 if(!plan?.readOnly||plan.applyAllowed!==false)fail('ACTIVATION_PREPARATION_REQUIRED');
 const entries=Object.entries(store).filter(([,r])=>r.signupAttemptId===plan.signupAttemptId);
 if(entries.length!==1||digest(entries[0][1])!==plan.expectedRecordDigest)fail('ACTIVATION_STALE_RECORD');
 if(digest({id:plan.signupAttemptId,record:entries[0][1],patch:plan.patch,contextHash:plan.contextHash})!==plan.planDigest)fail('ACTIVATION_PLAN_CHANGED');
 const allowed=new Set(['businessId','agentContentStatus','agentContentFingerprint','agentContentVerifiedAt','agentContentVerificationSource','agentContentErrorCode',
  'agentRouteBindingStatus','agentRouteBindingMode','agentRouteBindingVerifiedAt','agentRouteBindingFingerprint','agentRouteBindingErrorCode','trialCalendarEnrollmentVersion']);
 if(!plan.patch||Object.keys(plan.patch).some(k=>!allowed.has(k)))fail('ACTIVATION_PATCH_SCOPE_INVALID');
 return {...structuredClone(store),[entries[0][0]]:{...structuredClone(entries[0][1]),...structuredClone(plan.patch)}};
}
module.exports={prepareVerifiedSignupRecord,projectPreparedVerification};
