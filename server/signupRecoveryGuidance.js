'use strict';
// Explanations only: no callbacks, clients, credentials, writes or execution.
const STEPS={
 saved:['Saved signup evidence','Inspect the exact signup, context and completed receipts. Do not infer ownership from a name or phone.'],
 number:['Number purchase','Check the existing purchase receipt and current number ownership before any recovery. Never buy another number for an uncertain attempt.'],
 make:['Make handoff','Inspect the exact linked execution and its saved response. Do not replay Make: it can purchase, create billing or send messages.'],
 assistant:['Assistant and script','Compare the exact assistant and script with the original signup payload and completed receipt. Prepare a reviewed correction if they differ.'],
 route:['Phone routing','Compare the number, assistant and business mapping together. Conflicting ownership must stop recovery.'],
 delivery:['Text delivery','Inspect the exact saved message receipt. Accepted is not delivered. A timeout or missing receipt never authorizes another text.'],
 trial:['Trial eligibility','Check the exact existing subscription and genuine setup proof. Starting a trial or changing billing needs separate approval.']
};
const DOMAIN={context:'saved',purchase:'number',number:'number',assigned:'number',policy:'saved',
 'assistant-created':'assistant',assistant:'assistant',script:'assistant',import:'route',route:'route',
 business:'route','number-mapping':'route','phone-id-mapping':'route','assistant-mapping':'route',
 make:'make','make-saved':'make','text-routing':'delivery',verification:'delivery',
 'owner-practice':'delivery','customer-copy-practice':'delivery',completion:'delivery',
 'Owner-accepted':'delivery','Owner-delivered':'delivery','Customer-accepted':'delivery','Customer-delivered':'delivery',trial:'trial'};
function buildSignupRecoveryGuidance({setup,live,reasonCode,uncertainPurchase=false}={}){
 const checks=[];
 for(const [source,report] of [['saved',setup],['live',live]]){
  if(report?.readOnly!==true||!Array.isArray(report.groups))continue;
  for(const group of report.groups)for(const c of Array.isArray(group?.checks)?group.checks:[]){
   const domain=DOMAIN[c?.id];if(!domain)continue;
   checks.push({domain,source,state:['failed','blocked'].includes(c.state)?'failed':c.state==='verified'?'verified':'unknown'});
  }
 }
 const steps=Object.entries(STEPS).map(([id,[label,next]])=>{
  const evidence=checks.filter(c=>c.domain===id),failed=evidence.some(c=>c.state==='failed');
  // Never collapse several checks into a pass when any required evidence is
  // absent, observed-only, or unknown. This is triage, not readiness admission.
  return {id,label,state:failed?'failed':evidence.length&&evidence.every(c=>c.state==='verified')?'observed_checks_verified':'unknown',next,
   sources:[...new Set(evidence.map(c=>c.source))]};
 });
 const optOut=['21610','SMS_SUPPRESSED','TWILIO_SMS_OPTED_OUT'].includes(reasonCode);
 const access=['EAUTH','PROVIDER_ACCESS_DENIED','PROVIDER_AUTHENTICATION_FAILED'].includes(reasonCode);
 const timeout=['P2028','P2024','MAKE_SIGNUP_TIMEOUT','PROVIDER_TIMEOUT','ETIMEDOUT','HTTP_TIMEOUT'].includes(reasonCode);
 const hold=uncertainPurchase===true||timeout;
 const nextAction=optOut?'Respect the opt-out. Do not resend or bypass suppression.'
  :access?'Inspect provider access/configuration without revealing credentials. Settings changes require approval.'
   :hold?'Inspect saved receipts and committed work first. Do not replay any purchase, text, billing or Make action.'
    :'Inspect failed and unknown steps below, prepare the smallest correction, then verify before separately approved activation.';
 return {version:1,readOnly:true,ready:false,applyAllowed:false,automaticRetryAllowed:false,
  providerReplayAllowed:false,verificationWriteAllowed:false,requiresReceiptInspection:hold||steps.some(s=>s.id==='delivery'&&s.state!=='observed_checks_verified'),
  nextAction,steps,process:['Detect and preserve the failed step','Alert through the existing incident/Telegram path','Check receipts and exact ownership','Prepare a bounded fix; obtain approval for consequential changes','Verify the result without repeating uncertain actions'],
  limitation:'Guidance only. No repair runs from this report. Code changes need tests and release; provider outages may require waiting. Missing evidence is not a failure diagnosis or a pass. Existing alert delivery is not guaranteed by this report.'};
}
module.exports={buildSignupRecoveryGuidance};
