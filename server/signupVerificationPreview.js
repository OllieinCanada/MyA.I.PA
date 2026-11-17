'use strict';
const {isClosedSignup}=require('./signupBusinessIdentity');

// Saved-evidence inspection only. Deliberately accepts no sender, provider
// client, billing client, writer, callback or action argument.
function signupVerificationPreview(record, setup) {
 if(isClosedSignup(record))throw Object.assign(new Error('Closed signup cannot be prepared.'),{code:'SIGNUP_PREVIEW_CLOSED'});
 if(setup?.readOnly!==true||!Array.isArray(setup.groups))throw Error('SIGNUP_PREVIEW_EVIDENCE_UNAVAILABLE');
 const ids=['policy','purchase','assigned','assistant-created','script','import','route','business','number-mapping','phone-id-mapping','assistant-mapping','text-routing','Owner-accepted','Owner-delivered','Customer-accepted','Customer-delivered','trial'];
 const checks=setup.groups.flatMap(g=>g.checks||[]);
 const savedChecks=ids.map(id=>{
  const matches=checks.filter(c=>c.id===id),c=matches.length===1?matches[0]:null;
  return {id,state:c&&['verified','pending','blocked'].includes(c.state)?c.state:'unknown'};
 });
 return {readOnly:true,evidenceScope:'saved_evidence_only',liveProviderVerified:false,
  ready:false,applyAllowed:false,sendAllowed:false,trialActivationAllowed:false,
  coverage:setup.coverage||'unknown',savedChecks,
  nextActions:[
   {id:'verify-current-configuration',requiresApproval:false,effects:[],status:'required',description:'Compare exact saved signup/context and receipts with current assistant, phone, script and owner bindings; refuse conflicts.'},
   {id:'record-verification',requiresApproval:true,effects:['signup_record_write'],status:'not_authorized'},
   {id:'practice-delivery',requiresApproval:true,effects:['practice_sms','delivery_receipt_writes'],status:'not_authorized',description:'Owner-format and customer-format copies go to the verified owner only; inspect existing receipts and never retry uncertain sends.'},
   {id:'normal-trial',requiresApproval:true,effects:['billing_record_creation','trial_activation'],status:'not_authorized',description:'Separate action after genuine setup proof and exact existing-subscription inspection.'},
   {id:'automatic-connection',requiresApproval:true,effects:['assistant_configuration','scoped_feature_enablement'],status:'not_authorized'}
  ],limitation:'This preview neither finalizes setup nor authorizes later actions. Saved checks are not a current provider comparison or proof of delivery.'};
}
module.exports={signupVerificationPreview};
