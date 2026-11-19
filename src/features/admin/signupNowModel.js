const { matchesSignupView } = require('./savedEvidencePolling');
const FORM_STEPS = [
  ['trade','Trade',['trade_choice']], ['property_types','Type',['property_types']],
  ['service_areas','Area',['service_areas']], ['business_details','Details',['owner_name','business_name','business_phone','business_email','street_address','city','province','postal_code']],
  ['pricing','Pricing',['pricing_choices','visit_fee','hourly_rate']], ['final_review','Review',['human_verification']],
];
const at = value => typeof value === 'number' ? value : Date.parse(value) || 0;
function signupNowEntries(data, now = Date.now()) {
  const drafts = (data?.formObservations?.rows || []).filter(r => r.engaged && !r.linkedAttemptId).map(r => ({
    key:'draft:'+r.id,kind:'draft',label:'Visitor '+r.id.slice(-8),at:at(r.lastObservedAt || r.createdAt),draft:r,
  }));
  const saved = (data?.rows || []).filter(r => matchesSignupView(r,'watching',now)).map(r => ({
    key:'signup:'+r.attemptId,kind:'signup',label:r.businessName,at:at(r.signedUpAt),row:r,
  }));
  return [...drafts,...saved].sort((a,b)=>b.at-a.at || a.key.localeCompare(b.key));
}
function draftStages(draft) {
  return FORM_STEPS.map(([id,label,ids])=>{
    const fields=(draft.fields||[]).filter(f=>ids.includes(f.id));
    const observed=fields.filter(f=>f.observedAt!=null),required=observed.filter(f=>f.required&&f.visibleAtObservation==='visible');
    const complete=ids.every(id=>observed.some(f=>f.id===id));
    const blocked=id===draft.currentStep&&fields.some(f=>f.currentStepVisible&&f.validation==='invalid');
    const state=blocked?'blocked':complete&&required.length&&required.every(f=>f.validation==='valid')?'observed':observed.length?'partial':'unknown';
    return {id,label,fields,state,current:id===draft.currentStep};
  });
}
module.exports={FORM_STEPS,signupNowEntries,draftStages};
