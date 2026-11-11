// Presentation only: browser observations never become backend completion proofs.
const BUSINESS_FIELDS = [
  ['owner_name', 'Name'], ['business_name', 'Business name'],
  ['business_phone', 'Business phone'], ['business_email', 'Email address'],
  ['street_address', 'Business address'], ['city', 'City'],
  ['province', 'Province'], ['postal_code', 'Postal code'],
];
function describeField(field) {
  if (!field?.observedAt) return { state: 'unknown', label: 'Not observed' };
  if (field.visibleAtObservation === 'hidden') return { state: 'optional', label: 'Hidden · not a blocker' };
  if (field.presence === 'unknown') return { state: 'unknown', label: 'Not observed' };
  if (field.validation === 'invalid') return { state: 'blocked', label: field.reasonLabel || 'Check this field' };
  if (field.presence === 'blank') return field.required === false
    ? { state: 'optional', label: 'Optional · left blank' }
    : { state: 'blocked', label: field.interacted ? 'Required · left blank' : 'Blank · untouched; reason unknown' };
  if (field.validation === 'valid') return { state: 'observed', label: 'Browser checked' };
  return { state: 'present', label: 'Present · not validated' };
}
function buildJourney(row) {
  const observation = row.formObservation;
  const field = (id, label) => {
    const described = describeField(observation?.fields?.find(f => f.id === id));
    return { id, label, state: described.state, detail: described.label };
  };
  const groupState = fields => fields.some(f => f.state === 'blocked') ? 'blocked'
    : fields.every(f => ['observed', 'optional'].includes(f.state)) ? 'observed' : 'unknown';
  const choice = (id, title, fieldId) => {
    const fields = [field(fieldId, title)];
    return { id, title, fields, state: groupState(fields), source: 'Browser observation' };
  };
  const business = BUSINESS_FIELDS.map(([id, label]) => field(id, label));
  const pricing = [field('visit_fee', 'Minimum service fee'), field('hourly_rate', 'Hourly rate'),
    field('pricing_choices', 'Pricing announcements'),
    ...[['assessment', 'Technical assessment'], ['quote', 'New install · free quote'], ['parts', 'Parts extra']].map(([id, label]) =>
      ({ id, label, state: 'unknown', detail: 'Individual choice not recorded' }))];
  const trial = row.steps?.find(s => s.key === 'trial');
  return [
    { id: 'start', title: 'Start 14-day trial', state: row.signedUpAt ? 'recorded' : 'unknown', note: row.signedUpAt ? 'Signup received' : 'Start time not recorded', source: 'Saved signup · not trial activation' },
    choice('trade', 'Trade chosen', 'trade_choice'),
    choice('property', 'Property types', 'property_types'),
    choice('area', 'Service area', 'service_areas'),
    { id: 'business', title: 'Business details', fields: business, state: groupState(business), source: 'Browser observations · no typed values' },
    { id: 'pricing', title: 'Service-call pricing', fields: pricing, state: groupState(pricing),
      note: 'Assessment, free-quote and parts-extra choices are grouped in pricing announcements; individual selections are not recorded here.', source: 'Optional choices · not payment proof' },
    { id: 'review', title: 'Final review', state: observation?.currentStep === 'final_review' ? 'observed' : 'unknown',
      note: observation?.currentStep === 'final_review' ? 'Review screen reached' : 'Review not observed', source: 'Screen reached ≠ confirmed submission' },
    { id: 'captcha', title: 'Human verification', fields: [field('human_verification', 'CAPTCHA check')],
      state: describeField(observation?.fields?.find(f => f.id === 'human_verification')).state, source: 'Browser report · not backend acceptance' },
    { id: 'trial', title: '14-day trial', state: trial?.status === 'done' ? 'verified' : 'pending',
      fields: [['number','Number assigned'], ['assistant','Assistant created'], ['content','Business script matched'], ['call-route','Call routing checked'], ['owner-text','Owner practice text delivered'], ['customer-text','Customer-copy practice text delivered'], ['trial','Trial activated']].map(([key,label]) => ({id:key,label,state:row.steps?.some(s=>s.key===key&&s.status==='done')?'verified':'pending',detail:row.steps?.some(s=>s.key===key&&s.status==='done')?'Verified in saved evidence':'See full setup analysis below'})),
      note: trial?.status === 'done' ? 'Trial activated' : 'Activation not verified', source: 'Full number, assistant and practice-text breakdown below' },
  ];
}
module.exports = { BUSINESS_FIELDS, describeField, buildJourney };
