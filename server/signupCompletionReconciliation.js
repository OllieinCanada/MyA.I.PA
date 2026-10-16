const crypto=require('node:crypto');
const {buildSignupCompletionContent,normalizeAssignedPhone}=require('./signupCompletion');
const {signupSmsDispatchKey}=require('./signupSmsDispatch');
const {readProvisioningStep,runProvisioningStep}=require('./provisioningState');
const hash=x=>crypto.createHash('sha256').update(String(x)).digest('hex');
function stop(code){throw Object.assign(new Error('The saved setup message could not be verified for this exact signup.'),{code,statusCode:409});}

async function verifyDeliveredCompletionReceipt({stored,signup,expectedSender,frontendUrl,fetchReceipt,resolveLink,expectedSid,requireDelivered=true}) {
 const sid=stored?.result?.sid;
 if(stored?.status!=='completed'||!/^SM[a-f0-9]{32}$/i.test(sid||'')||(expectedSid&&sid!==expectedSid))stop('COMPLETION_SAVED_RECEIPT_MISMATCH');
 const message=await fetchReceipt(sid);
 const delivered=['delivered','read'].includes(message.status);
 if(message.sid!==sid||(!delivered&&(requireDelivered||!['accepted','queued','sending','sent'].includes(message.status))))stop('COMPLETION_DELIVERY_NOT_CONFIRMED');
 if(normalizeAssignedPhone(message.to)!==normalizeAssignedPhone(signup.ownerPhone)||!expectedSender||normalizeAssignedPhone(message.from)!==normalizeAssignedPhone(expectedSender))stop('COMPLETION_RECIPIENT_MISMATCH');
 if(typeof message.body!=='string'||hash(message.body)!==stored.contextHash)stop('COMPLETION_ORIGINAL_CONTENT_MISMATCH');
 const links=message.body.match(/https:\/\/[^\s]+/g)||[];
 if(links.length!==1)stop('COMPLETION_LINK_AMBIGUOUS');
 let link;try{link=new URL(links[0]);}catch{stop('COMPLETION_LINK_INVALID');}
 const frontend=new URL(frontendUrl);
 if(link.origin!==frontend.origin||link.pathname!=='/'||link.search||link.username||link.password||!/^#\/f\/[A-Za-z0-9_-]{24}$/.test(link.hash))stop('COMPLETION_LINK_INVALID');
 // Exact original template, not a loose substring match on a phone number.
 const canonical=buildSignupCompletionContent({assignedPhone:signup.twilioPhoneNumber,forwardingSetupUrl:links[0]}).sms;
 if(canonical!==message.body)stop('COMPLETION_BUSINESS_CONTENT_MISMATCH');
 const setup=await resolveLink(link.hash.slice(4));
 if(!setup||!signup.forwardingSetupId||setup.id!==signup.forwardingSetupId||!signup.businessId||Number(setup.businessId)!==Number(signup.businessId)
   ||setup.vapiPhoneNumberId!==signup.vapiPhoneNumberId||normalizeAssignedPhone(setup.assignedMyAiPaNumber)!==normalizeAssignedPhone(signup.twilioPhoneNumber))stop('COMPLETION_SETUP_OWNERSHIP_MISMATCH');
 return {sid,status:message.status,delivered,reconciled:true};
}

async function findStoredCompletionReceipt({prisma,signup}) {
 // Legacy recovery used the attempt ID before the CRM business ID existed.
 // Search only these exact identities, never owner email or a global SID scan.
 const identities=[signup.businessId,signup.signupAttemptId].filter(Boolean);
 const candidates=[];
 for(const identity of identities){
  const key=signupSmsDispatchKey({identity,purpose:'setup-complete',request:{to:signup.ownerPhone}});
  const {data}=await readProvisioningStep({prisma,kind:'signup-sms',idempotencyKey:key});
  if(data.status==='completed'&&data.result?.sid)candidates.push(data);
 }
 if(candidates.length>1)stop('COMPLETION_RECEIPT_AMBIGUOUS');
 return candidates[0]||null;
}
async function reconcileSignupCompletionReceipt({prisma,signup,expectedSid,...options}) {
 const stored=await findStoredCompletionReceipt({prisma,signup});
 if(!stored)stop('COMPLETION_RECEIPT_NOT_FOUND');
 return verifyDeliveredCompletionReceipt({stored,signup,expectedSid,...options});
}
function reconciledCompletionDelivery(signup,receipt) {
 // SMS proof cannot establish that an email succeeded. Preserve real email
 // failures, but never retry email or SMS while repairing the saved status.
 const errors=(signup.setupFollowupErrors||[]).filter(e=>e.channel!=='sms');
 const channels=[...new Set([...(signup.setupFollowupChannels||[]),'sms'])].sort();
 return {status:errors.length?'partial':receipt.delivered?'sent':'pending',channels,errors,receipts:{sms:receipt},skipped:true,reason:receipt.delivered?'delivered_sms_reconciled':'existing_sms_pending'};
}

async function dispatchCompletionEmail({prisma,signup,request,sendEmail}) {
 const idempotencyKey=hash(JSON.stringify([signup.businessId||signup.signupAttemptId,request.to]));
 // Rotating a secure link must not authorize another email for the same
 // exact setup. Changed recipients, numbers, assistants or setups still stop.
 const contextHash=hash(JSON.stringify([signup.signupAttemptId,signup.businessId,request.to,signup.twilioPhoneNumber,signup.vapiAssistantId,signup.forwardingSetupId,request.subject]));
 return runProvisioningStep({prisma,kind:'signup-completion-email',idempotencyKey,contextHash,execute:async()=>{
  const result=await sendEmail(request);
  return result?.skipped?{skipped:true,reason:result.reason||'unavailable'}:{sent:true};
 }});
}

function completionRecordFields(delivery,now=new Date().toISOString()) {
 const receipt=delivery.receipts?.sms;
 return {setupFollowupStatus:delivery.status,setupFollowupChannels:delivery.channels||[],setupFollowupErrors:delivery.errors||[],setupFollowupAttemptedAt:now,
  ...(delivery.channels?.length?{setupFollowupSentAt:now}:{}),
  ...(receipt?.sid?{setupFollowupSmsSid:receipt.sid,setupFollowupSmsProviderStatus:receipt.status,
    ...(receipt.delivered?{setupFollowupSmsDeliveredAt:now}:{})}:{}),
 };
}
function completionDeliveryUpdate(signup,{MessageSid,MessageStatus,ErrorCode},now=new Date().toISOString()){
 if(!signup.setupFollowupSmsSid||MessageSid!==signup.setupFollowupSmsSid)return null;
 const delivered=['delivered','read'].includes(MessageStatus),failed=['failed','undelivered','canceled'].includes(MessageStatus);
 if(['delivered','read'].includes(signup.setupFollowupSmsProviderStatus)&&!delivered&&!failed)return null;
 if(['failed','undelivered','canceled'].includes(signup.setupFollowupSmsProviderStatus)&&!delivered&&!failed)return null;
 const errors=(signup.setupFollowupErrors||[]).filter(e=>e.channel!=='sms');
 const channels=(signup.setupFollowupChannels||[]).filter(c=>c!=='sms');
 if(delivered)channels.push('sms');
 if(failed)errors.push({channel:'sms',code:String(ErrorCode||'TWILIO_MESSAGE_UNDELIVERED')});
 return {setupFollowupSmsProviderStatus:MessageStatus,
  ...(delivered||failed?{setupFollowupChannels:channels,setupFollowupErrors:errors,setupFollowupStatus:errors.length?(channels.length?'partial':'failed'):'sent'}:{}),
  ...(delivered?{setupFollowupSmsDeliveredAt:signup.setupFollowupSmsDeliveredAt||now}:{}),
 };
}
module.exports={verifyDeliveredCompletionReceipt,findStoredCompletionReceipt,reconcileSignupCompletionReceipt,reconciledCompletionDelivery,dispatchCompletionEmail,completionRecordFields,completionDeliveryUpdate};
