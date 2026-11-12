const {buildJourney} = require('./signupJourneyModel');
const safeDate = value => Number.isFinite(Date.parse(value));
function controlRoomModel(row,setup,selected='number',now=Date.now()) {
  const nodes=buildJourney(row), groups=setup?.groups || [];
  const checks=groups.flatMap(g=>g.checks), verified=checks.filter(c=>c.state==='verified').length;
  const search=setup?.number?.search;
  const freshSearch=Boolean(search && safeDate(search.at) && now-Date.parse(search.at)>=0 && now-Date.parse(search.at)<=30000 && !search.stale);
  let headline=row.currentStep || 'Setup evidence not recorded';
  let explanation=row.nextAction || 'Review saved evidence before taking any action.';
  if (freshSearch && search.phase==='searching') { headline=`Searching ${search.areaCode || 'regional inventory'} for a phone number`; explanation='The current process reported this search. No number is assigned until its purchase and assignment are saved.'; }
  else if (setup?.number?.stage?.status==='failed') { headline='Phone-number setup needs review'; explanation='A failed purchase stage was saved. Inspect the existing receipts before any retry; this dashboard does not retry it.'; }
  const current=groups.find(g=>g.id===selected) || nodes.find(n=>n.id===selected) || groups[0];
  const detailChecks=current?.checks || current?.fields || [];
  const timeline=[...(setup?.timeline || [])];
  if(safeDate(row.formObservation?.lastObservedAt)) timeline.push({id:'browser-snapshot',label:`${row.formObservation.currentStepLabel || 'Form'} observed`,at:row.formObservation.lastObservedAt,state:'observed',source:'Browser metadata · not backend completion'});
  const unique=new Map();
  for(const event of timeline) if(safeDate(event.at)) unique.set(event.id,event);
  return {nodes,groups,verified,total:checks.length,headline,explanation,freshSearch,
    selected:current,detailChecks,timeline:[...unique.values()].sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)||a.id.localeCompare(b.id)).slice(-50)};
}
module.exports={controlRoomModel};
