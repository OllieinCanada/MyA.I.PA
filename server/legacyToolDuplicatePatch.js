'use strict';
// Offline preparation only. No provider client, env loader, HTTP route or writer.
// Not deployable until an independently authorized automatic admission gateway
// exists. The current production endpoint refuses phone-originated claims.
const crypto=require('node:crypto');
const {sendTwilioMessage,submitTwilioMessage}=require('./compositeCallNotifications');
const sha=code=>crypto.createHash('sha256').update(code).digest('hex');
function prepareLegacyDuplicatePatch({code,expectedSha256}={}){
 if(typeof code!=='string'||!/^[a-f0-9]{64}$/.test(expectedSha256||'')||sha(code)!==expectedSha256)throw Error('LEGACY_SOURCE_CHANGED');
 if(code.length>100000||/claimToken|SMS_NOTIFICATION_DISPATCH_URL/.test(code))throw Error('LEGACY_SOURCE_NOT_EXPECTED');
 const start=code.indexOf('async function sendTwilioMessage('),end=code.indexOf('async function executeCompositeNotifications(',start);
 if(start<0||end<=start||code.indexOf('async function sendTwilioMessage(',start+1)!==-1)throw Error('LEGACY_FUNCTION_AMBIGUOUS');
 let candidate=code.slice(0,start)+submitTwilioMessage.toString()+'\n\n'+sendTwilioMessage.toString()+'\n\n'+code.slice(end);
 const owner=/\bowner\s*=\s*await sendTwilioMessage\(\{/g,customer=/\bconst customer\s*=\s*await sendTwilioMessage\(\{/g;
 if([...candidate.matchAll(owner)].length!==1||[...candidate.matchAll(customer)].length!==1)throw Error('LEGACY_LEGS_AMBIGUOUS');
 candidate=candidate.replace(owner,match=>match+'\n      leg: "owner",').replace(customer,match=>match+'\n    leg: "customer",');
 candidate=candidate.replace('async function executeCompositeNotifications(', 'async function executeCompositeNotificationsLegacy(');
 candidate+='\n\n'+function executeCompositeNotifications(options){
   return executeCompositeNotificationsLegacy(options).then(result=>{
    const ownerDone=result.ownerSmsEnabled===false||Boolean(result.owner?.sent&&result.owner?.dispatchReceiptStored);
    const customerDone=Boolean(result.customer?.sent&&result.customer?.dispatchReceiptStored);
    const complete=ownerDone&&customerDone;
    return{...result,ok:complete,complete,
      requiresReconciliation:result.requiresReconciliation===true||Boolean(result.owner?.sent&&!result.owner?.dispatchReceiptStored)||Boolean(result.customer?.sent&&!result.customer?.dispatchReceiptStored)};
   });
  }.toString();
 if(/awaiting_manual_approval|requiresApproval/.test(candidate))throw Error('LEGACY_SEMANTICS_CHANGED');
 return{code:candidate,sourceSha256:expectedSha256,candidateSha256:sha(candidate),
  addedEnvironmentNames:['SMS_NOTIFICATION_DISPATCH_URL'],readyToApply:false,
  blocker:'Current dispatch HTTP route refuses automatic phone claims. Do not enable claims or publish this tool without reviewed server-owned authorization/consent integration.',
  unchanged:['owner/customer body builders','recipient construction','suppression check','automatic invocation semantics','trial and billing'],
  scope:'Reuse existing durable per-call/per-sender/per-leg claims; no in-memory production dedupe, timeout retry or manual-approval conversion'};
}
module.exports={prepareLegacyDuplicatePatch};
