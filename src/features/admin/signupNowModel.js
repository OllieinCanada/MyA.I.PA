const { matchesSignupView } = require('./savedEvidencePolling');
const FORM_STEPS = [
  ['trade','Trade',['trade_choice']], ['property_types','Type',['property_types']],
  ['service_areas','Area',['service_areas']], ['business_details','Details',['owner_name','business_name','business_phone','business_email','street_address','city','province','postal_code']],
  ['pricing','Pricing',['pricing_choices','visit_fee','hourly_rate']], ['final_review','Review',['human_verification']],
];
const SORT_OPTIONS = [
  ['newest', 'Newest first'], ['oldest', 'Oldest first'],
  ['progress', 'Latest progress'], ['stuck', 'Longest stuck first'], ['name', 'Business name A–Z'],
];
const DATE_OPTIONS = [
  ['all', 'Any time'], ['today', 'Today · Toronto'], ['24h', 'Last 24 hours'],
  ['7d', 'Last 7 days'], ['30d', 'Last 30 days'],
];
const FILTERS = new Set(['watching', 'all', 'active', 'stalled', 'waiting_customer', 'ready', 'paused']);
const QUICK_VIEWS = [['newest','Newest'],['today','Today'],['attention','Needs attention'],['all','All']];
function quickSignupView(id, current = {}) {
  const sort = SORT_OPTIONS.some(([value]) => value === current.sort) ? current.sort : 'newest';
  if (!QUICK_VIEWS.some(([value]) => value === id)) return null;
  return { search: '', filter: id === 'attention' ? 'stalled' : 'all',
    dateRange: id === 'today' ? 'today' : 'all',
    sort: id === 'attention' ? 'stuck' : id === 'all' ? sort : 'newest' };
}
const timestamp = (value, now) => {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Date.parse(value) : NaN;
  return Number.isFinite(n) && n > 0 && n <= now ? n : null;
};
const compareKnown = (a, b, direction) => a == null ? b == null ? 0 : 1 : b == null ? -1 : direction * (a - b);
const torontoDay = value => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
function draftLabel(draft) { return draft.draftNames?.businessName || draft.draftNames?.ownerName || 'Visitor '+draft.id.slice(-8); }
function signupNowEntries(data, now = Date.now(), options = {}) {
  const filter = FILTERS.has(options.filter) ? options.filter : 'watching';
  const sort = SORT_OPTIONS.some(([id]) => id === options.sort) ? options.sort : 'newest';
  const dateRange = DATE_OPTIONS.some(([id]) => id === options.dateRange) ? options.dateRange : 'all';
  const query = String(options.search || '').trim().toLowerCase();
  const drafts = (data?.formObservations?.rows || []).filter(r => r.engaged && !r.linkedAttemptId).map(r => ({
    key:'draft:'+r.id,kind:'draft',label:draftLabel(r),
    at:timestamp(r.createdAt ?? r.startedAt,now),progressAt:timestamp(r.lastObservedAt,now),draft:r,
  }));
  const saved = (data?.rows || []).map(r => ({
    key:'signup:'+r.attemptId,kind:'signup',label:r.businessName,
    at:timestamp(r.signedUpAt,now),progressAt:timestamp(r.lastProgressAt,now),row:r,
  }));
  const visible = [...drafts,...saved].filter(entry => {
    const d = entry.draft, r = entry.row;
    const matches = r ? matchesSignupView(r,filter,now) : ['watching','active','all'].includes(filter) || filter === 'stalled' && d.stalled === true;
    if (!matches) return false;
    // Display names are explicitly unverified; never infer a submission link.
    const haystack = r ? [r.businessName,r.ownerName,r.currentStep,r.status,r.attemptId] : [entry.label,d.draftNames?.ownerName,d.id,d.currentStepLabel];
    if (!haystack.filter(Boolean).join(' ').toLowerCase().includes(query)) return false;
    if (dateRange === 'all') return true;
    if (entry.at == null) return false;
    if (dateRange === 'today') return torontoDay(entry.at) === torontoDay(now);
    const windowMs = { '24h': 86400000, '7d': 7 * 86400000, '30d': 30 * 86400000 }[dateRange];
    return now - entry.at <= windowMs;
  });
  const stalled = e => (e.row || e.draft).stalled === true;
  const elapsed = e => {
    const n = e.row ? e.row.elapsedMs : e.draft.observedAgeMs;
    return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
  };
  return visible.sort((a,b) => {
    let order = 0;
    if (sort === 'oldest') order = compareKnown(a.at,b.at,1);
    else if (sort === 'progress') order = compareKnown(a.progressAt,b.progressAt,-1);
    else if (sort === 'stuck') order = Number(stalled(b))-Number(stalled(a)) || (stalled(a) && stalled(b) ? compareKnown(elapsed(a),elapsed(b),-1) : 0);
    else if (sort === 'name') {
      const an=a.row?.businessName||a.draft?.draftNames?.businessName,bn=b.row?.businessName||b.draft?.draftNames?.businessName;
      order=Number(!an)-Number(!bn)||(an&&bn?an.localeCompare(bn,'en-CA',{sensitivity:'base',numeric:true}):0);
    }
    return order || compareKnown(a.at,b.at,sort === 'oldest' ? 1 : -1) || a.key.localeCompare(b.key);
  });
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
module.exports={FORM_STEPS,SORT_OPTIONS,DATE_OPTIONS,QUICK_VIEWS,quickSignupView,draftLabel,signupNowEntries,draftStages};
