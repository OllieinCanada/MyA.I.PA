const {buildJourney} = require('./signupJourneyModel');
const safeDate = value => Number.isFinite(Date.parse(value));
const groupNames={number:'Number',assistant:'Assistant & script',texts:'Practice texts',activation:'Trial & readiness'};
const knownStates=new Set(['verified','observed','recorded','blocked','pending','unknown','optional','present']);
function safeChecks(checks) {
  if (!Array.isArray(checks)) return [];
  return checks.map((check,index)=>check && typeof check==='object' && !Array.isArray(check)
    && typeof check.label==='string' && knownStates.has(check.state)
    ? {...check,id:typeof check.id==='string'?check.id:'unidentified-'+index,detail:typeof check.detail==='string'?check.detail:'',at:typeof check.at==='string'?check.at:null}
    : {id:'unavailable-'+index,label:'Check evidence unavailable',state:'unknown',detail:'A saved check could not be read.',at:null});
}
function safeGroups(groups) {
  if (!Array.isArray(groups)) return [];
  return groups.map((group,index)=>({...group,id:typeof group?.id==='string'?group.id:'unidentified-'+index,
    title:typeof group?.title==='string'?group.title:'Unknown setup station',checks:safeChecks(group?.checks)}));
}
function stationState(checks=[]) {
  const evidence=Array.isArray(checks)?checks:[];
  if(evidence.some(c=>c?.state==='blocked'))return 'blocked';
  const required=evidence.filter(c=>c?.state!=='optional');
  return required.length&&required.every(c=>c?.state==='verified')?'verified':'pending';
}
function currentStationId(row={}, groups=[]) {
  if (row.mode === 'waiting_customer' || row.mode === 'paused' || row.mode === 'closed' || row.mode === 'ready') return null;
  const key = row.steps?.find(step => step.status === 'current')?.key;
  const id = ({ number:'number', assistant:'assistant', content:'assistant', 'call-route':'assistant',
    'text-routing':'texts', 'owner-text':'texts', 'customer-text':'texts', trial:'activation', ready:'activation' })[key];
  if (id && groups.some(group => group.id === id)) return id;
  // A next-incomplete station is workflow position, never evidence that a
  // provider request is currently running. Customer-wait rows have no such cue.
  if (row.active !== true && row.mode !== 'working') return null;
  return (groups.find(group => stationState(group.checks) === 'blocked')
    || groups.find(group => stationState(group.checks) !== 'verified'))?.id || null;
}
function progressSummary(row={}, setup, now=Date.now()) {
  const model = controlRoomModel(row,setup,'number',now);
  const blocked = safeGroups(setup?.groups).flatMap(group => group.checks).find(check => check.state === 'blocked');
  const waitingCustomer = row.mode === 'waiting_customer';
  const purchaseFailed = setup?.number?.stage?.status === 'failed';
  const reason = waitingCustomer
    ? 'Waiting for customer verification. This is not proof of a technical failure.'
    : purchaseFailed ? setup?.purchaseEvidence?.explanation || model.explanation
      : blocked?.detail || (row.mode === 'working' || row.active === true
        ? 'No exact technical failure cause is established by the saved evidence.'
        : 'No technical failure is established by this saved status.');
  return { currentStep:row.currentStep || model.headline, reason,
    nextAction:purchaseFailed && setup?.purchaseEvidence?.nextAction || row.nextAction || model.inspector.next,
    waitingCustomer, checkedAt:setup?.checkedAt || row.lastProgressAt || null };
}
function controlRoomModel(row,setup,selected='number',now=Date.now()) {
  const nodes=buildJourney(row), groups=safeGroups(setup?.groups);
  const checks=groups.flatMap(g=>g.checks), verified=checks.filter(c=>c.state==='verified').length;
  const search=setup?.number?.search;
  const freshSearch=Boolean(search && safeDate(search.at) && now-Date.parse(search.at)>=0 && now-Date.parse(search.at)<=30000 && !search.stale);
  let headline=row.currentStep || 'Setup evidence not recorded';
  let explanation=row.nextAction || 'Review saved evidence before taking any action.';
  if (freshSearch && search.phase==='searching') { headline=`Searching ${search.areaCode || 'regional inventory'} for a phone number`; explanation='The current process reported this search. No number is assigned until its purchase and assignment are saved.'; }
  else if (setup?.number?.stage?.status==='failed') { headline='Phone-number setup needs review'; explanation='A failed purchase stage was saved. Inspect the existing receipts before any retry; this dashboard does not retry it.'; }
  const blocked=checks.find(c=>c.state==='blocked');
  if(blocked && setup?.number?.stage?.status!=='failed' && !(freshSearch&&search.phase==='searching')) {
    headline=blocked.label+' needs attention';
    explanation=blocked.detail || 'Saved evidence identifies a blocker. Inspect its receipts before taking action.';
  }
  const current=groups.find(g=>g.id===selected) || nodes.find(n=>n.id===selected) || groups[0];
  const detailChecks=current?.checks || current?.fields || [];
  const timeline=[...(setup?.timeline || [])];
  if(safeDate(row.formObservation?.lastObservedAt)) timeline.push({id:'browser-snapshot',label:`${row.formObservation.currentStepLabel || 'Form'} observed`,at:row.formObservation.lastObservedAt,state:'observed',source:'Browser metadata · not backend completion'});
  const unique=new Map();
  for(const event of timeline) if(safeDate(event.at)) unique.set(event.id,event);
  const currentId=currentStationId(row,groups);
  const stations=groups.map(g=>({id:g.id,title:groupNames[g.id]||g.title,state:stationState(g.checks),current:g.id===currentId}));
  const inspector={expected:({number:'A purchased number assigned to this exact signup.',assistant:'An assistant with the matching script and verified phone routing.',texts:'Separate evidence for routing, provider acceptance and delivery to each recipient.',activation:'Verified setup checks and a recorded eligible trial.'})[selected]||'Recorded evidence for this signup step.',
    found:detailChecks.length?detailChecks.map(c=>({id:c.id,label:c.label,state:c.state,detail:c.detail})):[],
    next:detailChecks.some(c=>c.state==='blocked')?'Inspect the saved failure and existing receipts before any retry.':'Review unverified checks before taking any separately approved setup action.'};
  return {nodes,groups,stations,inspector,verified,total:checks.length,headline,explanation,freshSearch,
    selected:current,detailChecks,timeline:[...unique.values()].sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)||a.id.localeCompare(b.id)).slice(-50)};
}
module.exports={controlRoomModel,stationState,currentStationId,progressSummary,safeGroups};
