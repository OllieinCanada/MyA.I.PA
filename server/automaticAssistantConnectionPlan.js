'use strict';
const crypto=require('node:crypto');
const {automaticSummaryToolDefinition}=require('./automaticCallNotifications');
const {getTrialLifecycle}=require('./trialUsagePolicy');
const {PROMPT_MARKER}=require('./vapiIsolatedSmsProvisioning');
const {INTAKE_POLICY}=require('./serviceIntakePrompt');
const intakeStart='## MYAIPA CONFIRMED SERVICE INTAKE',intakeEnd='## END MYAIPA CONFIRMED SERVICE INTAKE';

// Local preparation only: no provider client, writes, flags or dispatch.
function prepareAutomaticAssistantConnection({assistant,legacyTool,phone,signup,businessId,gate,webhookVerified=false}) {
 const refuse=()=>{throw Error('AUTOMATIC_CONNECTION_IDENTITY_UNPROVEN');};
 const legacyToolId=legacyTool?.id;
 const bindings=Object.fromEntries((legacyTool?.environmentVariables||[]).map(v=>[v.name,v.value]));
 if(!Number.isSafeInteger(businessId)||businessId<1||signup?.businessId!==businessId
  ||assistant?.id!==signup.vapiAssistantId||phone?.id!==signup.vapiPhoneNumberId||phone?.number!==signup.twilioPhoneNumber
  ||phone.assistantId!==assistant.id||!/^\+1[2-9]\d{9}$/.test(phone.number||'')||!legacyToolId
  ||legacyTool.type!=='code'||!/^send_call_summaries_\d{4}_[a-f0-9]{8}_v\d+$/i.test(legacyTool.function?.name||'')
  ||bindings.DEFAULT_FROM_NUMBER!==phone.number||bindings.DEFAULT_OWNER_TO_NUMBER!==signup.ownerPhone)refuse();
 const model=structuredClone(assistant.model||{});
 if(model.toolRefs?.length||assistant.toolRefs?.length||assistant.toolIds?.length||!Array.isArray(model.toolIds)
   ||model.toolIds.filter(id=>id===legacyToolId).length!==1||new Set(model.toolIds).size!==model.toolIds.length)refuse();
 const messages=model.messages||[],systems=messages.filter(m=>m.role==='system');
 if(systems.length!==1||typeof systems[0].content!=='string')refuse();
 const prompt=systems[0].content,end='## END MYAIPA ISOLATED SMS ROUTING';
 if(prompt.split(PROMPT_MARKER).length!==2||prompt.split(end).length!==2||prompt.indexOf(end)<prompt.indexOf(PROMPT_MARKER))refuse();
 const name='send_call_summaries_auto_'+phone.number.slice(-4)+'_'+crypto.createHash('sha256').update(assistant.id+'\0'+phone.id).digest('hex').slice(0,8)+'_v1';
 const tool=automaticSummaryToolDefinition(name);
 if((model.tools||[]).some(t=>/^send_call_summaries_/i.test(t.function?.name||'')))refuse();
 // Keep the existing server-recognized confirmation sentence exactly. A novel
 // question would sound reasonable but fail the deterministic admission guard.
 const block=`## MYAIPA AUTOMATIC CONFIRMATION\nRead back the service request, explain that submission includes owner and caller confirmation texts, then ask exactly: "Should I send this request to the team now?"\nOnly after clear caller approval, call ${name} once. A refusal before submission prevents it; a correction requires a new read-back and approval. Never ask for manual operator approval. Do not retry an unknown outcome. Provider acceptance is not delivery. Report the tool result honestly; never promise delivery or claim submission if it failed.\n## END MYAIPA AUTOMATIC CONFIRMATION`;
 let updated=prompt.slice(0,prompt.indexOf(PROMPT_MARKER))+block+prompt.slice(prompt.indexOf(end)+end.length);
 // The shared intake policy intentionally remains draft-only for legacy tools.
 // Migrate its exact known block in this candidate only; never append a
 // conflicting override or rewrite unknown custom business instructions.
 if(updated.includes(intakeStart)){
   if(updated.split(intakeStart).length!==2||!updated.includes(INTAKE_POLICY))throw Error('AUTOMATIC_CONNECTION_PROMPT_REVIEW_REQUIRED');
   const prefix=INTAKE_POLICY.slice(0,INTAKE_POLICY.indexOf('CURRENT DRAFT CONSENT AND CLARIFICATION:'))
    .replaceAll('permission to save a draft','permission to submit the request');
   const policy=prefix+'CURRENT AUTOMATIC CONSENT AND CLARIFICATION:\n'
    +'- Ask exactly "Should I send this request to the team now?" after the current recap and explain owner/caller texts. An earlier yes never approves changed details.\n'
    +'- A refusal or correction before submission blocks execution until fresh corrected readback and clear approval.\n'
    +'- Invoke the automatic tool once. Unknown outcomes require receipt inspection, never retries.\n'
    +'- Distinguish requestSaved, accepted, not sent and unknown from verified delivery. Do not claim completion when the tool reports failure. No manual operator approval is required.\n'+intakeEnd;
   updated=updated.replace(INTAKE_POLICY,policy);
 }
 if(['Should I save this request for review?','spoken yes never authorizes','saved for manual review','An authenticated human must'].some(text=>updated.includes(text)))throw Error('AUTOMATIC_CONNECTION_PROMPT_REVIEW_REQUIRED');
 systems[0].content=updated;
 model.toolIds=model.toolIds.filter(id=>id!==legacyToolId);model.tools=[...(model.tools||[]),tool];
 const lifecycle=getTrialLifecycle(signup);
 const missing=[];
 if(!['trial','paid'].includes(lifecycle.state))missing.push('verified_normal_account_eligibility');
 if(!gate||gate.status!=='active'||gate.businessId!==businessId||gate.assistantId!==assistant.id||gate.phoneNumberId!==phone.id
   ||gate.phoneNumber!==phone.number||!signup.subscriptionId||gate.subscriptionId!==signup.subscriptionId)missing.push('normal_active_phone_gate');
 if(!webhookVerified)missing.push('authenticated_webhook_configuration');
 return {candidatePrepared:true,applyAllowed:false,liveTestAllowed:false,missingPrerequisites:missing,
   toolName:name,assistantPatch:{model},requiresSeparateApproval:['provider_configuration_change','scoped_automatic_and_dispatch_flags','live_test'],
   limitation:'Preparation only. Does not attach billing, activate a trial, install a gate, change webhook credentials or send anything.'};
}
module.exports={prepareAutomaticAssistantConnection};
