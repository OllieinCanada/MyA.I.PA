import React, {useEffect,useRef,useState} from 'react';
import SignupJourneyMap from './SignupJourneyMap';
import SignupFailureDetails from './SignupFailureDetails';
import SignupLiveDiagnostics from './SignupLiveDiagnostics';
import SignupBugHistory from './SignupBugHistory';
import {controlRoomModel} from './signupControlRoomModel';
import './SignupControlRoom.css';
import useSavedEvidence from './useSavedEvidence';
import SavedEvidenceStatus from './SavedEvidenceStatus';
const validSetup=body=>body?.setup?.readOnly===true&&Array.isArray(body.setup.groups);

const time=value=>value && Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('en-CA',{timeZone:'America/Toronto',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',second:'2-digit'}):'No timestamp recorded';
const stateLabel=state=>({verified:'Backend verified',observed:'Browser / process observed',recorded:'Recorded',blocked:'Needs attention',pending:'Not verified',unknown:'Not observed',optional:'Not required',present:'Not validated'}[state]||'Unknown');
const mark=state=>['verified','observed','recorded'].includes(state)?'✓':state==='blocked'?'!':'−';
export default function SignupControlRoom({row,apiBase=''}) {
  const [selected,setSelected]=useState('number');
  const progressKey=JSON.stringify([row.infoRevision,row.status,row.blockerCode,row.lastProgressAt,row.completedSteps,row.steps]);
  const {data:report,state,error,busy,load}=useSavedEvidence({url:apiBase+'/api/admin/signup-tracker/'+encodeURIComponent(row.attemptId)+'/setup',validate:validSetup,intervalMs:10000,revision:progressKey});
  const [expandedFailure,setExpandedFailure]=useState(null);
  const inspector=useRef(null);
  const [now,setNow]=useState(Date.now());
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),5000);return()=>clearInterval(timer);},[]);
  useEffect(()=>setExpandedFailure(null),[row.infoRevision,row.attemptId]);
  // Changed saved progress invalidates the prior detail request immediately.
  // A later projection timestamp alone must not replace exact-context receipts
  // with a less complete saved-record-only projection.
  const setup=report?.setup||row.setup;
  const model=controlRoomModel(row,setup,selected,now);
  const choose=id=>{setSelected(id);if(window.matchMedia('(max-width: 800px)').matches){requestAnimationFrame(()=>{inspector.current?.focus({preventScroll:true});inspector.current?.scrollIntoView({block:'start',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});});}};
  if(!setup)return null;
  const search=setup.number.search;
  return <section className="signup-control-room" aria-label={`Setup analysis for ${row.businessName}`}>
    <div className={'control-room-summary '+(row.stalled||model.stations.some(s=>s.state==='blocked')?'is-stalled':'')}><span className="control-summary-icon" aria-hidden="true">!</span><div><span className="control-summary-question">What’s stopping this signup?</span><h4>{model.headline}</h4><p>{model.explanation}</p></div><span className="control-read-only">Read-only · saved evidence</span></div>
    <SavedEvidenceStatus state={state} label="Detailed updates" intervalMs={10000}/>
    <div className="control-room-layout"><div className="control-room-main">
      <nav className="control-station-overview" aria-label="Setup station status">{model.stations.map(station=><button key={station.id} type="button" aria-pressed={selected===station.id} onClick={()=>choose(station.id)}><span aria-hidden="true" className={'setup-check-symbol is-'+station.state}>{mark(station.state)}</span><span><strong>{station.title}</strong><small>{station.state==='verified'?'Backend checks verified':station.state==='blocked'?'Needs attention':'Not verified'}</small></span></button>)}</nav>
      <details className="control-earlier-journey"><summary>Earlier signup steps</summary><SignupJourneyMap row={row} onSelect={choose} selectedId={selected}/></details>
      <div className="setup-analysis-groups control-room-groups">{model.groups.map((group,index)=><section key={group.id} aria-label={group.title} className={selected===group.id?'is-selected':''}><h5><button type="button" aria-pressed={selected===group.id} onClick={()=>choose(group.id)}><span aria-hidden="true">{index+1}</span>{['Number','Assistant & script','Practice texts','Trial & readiness'][index]}</button></h5>
        {group.id==='number'?<div className="control-area-policy"><strong>Signed area-code order</strong><div className="control-area-chips">{setup.number.policyValid?setup.number.areaOrder.map((code,i)=><React.Fragment key={code}>{i>0?<span aria-hidden="true">→</span>:null}<b>{code}</b></React.Fragment>):<span>Not recorded</span>}</div><small>{setup.number.locked?'Locked request · policy unchanged':'Exact registered policy only'}</small></div>:null}
        <ul>{group.checks.map(check=><li key={check.id} className={'is-'+check.state}><span className="setup-check-symbol" aria-hidden="true">{mark(check.state)}</span><span>{check.label}<small>{stateLabel(check.state)}</small></span></li>)}</ul>
        {group.id==='activation'?<div className="control-readiness"><strong>{model.verified} of {model.total} backend checks verified</strong><div role="progressbar" aria-valuemin={0} aria-valuemax={model.total} aria-valuenow={model.verified} aria-label="Verified backend checks, not launch approval" className="control-readiness-meter">{Array.from({length:model.total},(_,i)=><span key={i} className={i<model.verified?'is-verified':''}/>)}</div><small>Not a launch approval.</small></div>:null}
      </section>)}</div>
    </div>
    <aside className="control-room-inspector" aria-label="Selected step evidence" tabIndex={-1} ref={inspector}>
      <span className="signup-tracker-eyebrow">Step inspector</span><h4>Selected step: {model.selected?.title || 'Number search'}</h4><p className="control-evidence-stamp">Saved evidence checked {time(setup.checkedAt)}</p>
      <section className="control-inspector-section"><h5>Expected</h5><p>{model.inspector.expected}</p></section>
      <section className="control-inspector-section"><h5>Found</h5><p>{model.detailChecks.filter(c=>c.state==='verified').length} of {model.detailChecks.length} selected checks backend verified. Recorded or observed does not mean verified.</p>{model.inspector.found.filter(check=>check.state==='blocked').map(check=><p key={check.id}><strong>{check.label}: </strong>{check.detail || 'Saved evidence needs review; the cause is not confirmed.'}</p>)}</section>
      <section className="control-inspector-section"><h5>Evidence</h5><span className="control-source-badge">Saved records · not a live provider check</span><p>Each check below retains its own status and timestamp. Missing evidence stays unverified.</p></section>
      <section className="control-inspector-section"><h5>Next safe step</h5><p>{model.inspector.next}</p></section>
      <button type="button" disabled={busy} onClick={load}>{busy?'Reading saved evidence…':'Analyze saved setup'}</button>
      <SignupLiveDiagnostics key={row.attemptId+':'+row.infoRevision} attemptId={row.attemptId} apiBase={apiBase} now={now}/>
      <p className="control-coverage">{report?setup.coverage.replaceAll('_',' '):'Summary only · read detailed evidence for search history'}</p>
      {selected==='number'?<div className="control-search-detail"><strong>{model.freshSearch&&search?.phase==='searching'?`Searching ${search.areaCode || 'regional inventory'}`:search?`${search.stale || !model.freshSearch?'Stale observation':'Last observed search'}: ${search.phase.replaceAll('_',' ')}`:'Current search not observed'}</strong><p>Preferred area: {setup.number.preferredAreaCode || 'Unknown'}. {setup.number.locked?'Locked request: the original area-code policy is preserved.':''}</p><p>{setup.number.assignedLast4?`Assigned area ${setup.number.assignedAreaCode} · ending ${setup.number.assignedLast4}`:'No number assignment saved.'}</p></div>:null}
      <ul className="control-selected-checks">{model.detailChecks.map(check=><li key={check.id} className={'is-'+check.state}><strong><span aria-hidden="true">{mark(check.state)} </span>{check.label}</strong><small>{stateLabel(check.state)}</small><p>{check.detail}</p>{check.at?<time dateTime={check.at}>{time(check.at)}</time>:null}</li>)}</ul>
      {model.selected?.note?<p>{model.selected.note}</p>:null}
      <div className="control-evidence-warning">Saved evidence ≠ guaranteed delivery. A search observation is not a purchase receipt.</div><p className="control-room-limitations">{setup.limitation}</p>
    </aside></div>
    <section className="control-room-timeline control-recent-history" aria-label="Signup event timeline"><h5>Recent history</h5><p>Only recorded events with timestamps. Gaps do not mean nothing happened. Unknown is not failed; accepted is not delivered.</p><ol>{model.timeline.map(event=><li key={event.id} className={'is-'+event.state}><span aria-hidden="true">{mark(event.state)}</span><div><time dateTime={event.at}>{time(event.at)}</time>{event.id==='twilio-number-failed'?<><button type="button" className="timeline-evidence-toggle" aria-expanded={expandedFailure===event.id} aria-controls={'purchase-details-'+row.attemptId} onClick={()=>{setExpandedFailure(expandedFailure===event.id?null:event.id);if(!report)load();}}>{event.label}<span aria-hidden="true">{expandedFailure===event.id?'−':'+'}</span></button>{expandedFailure===event.id?<div id={'purchase-details-'+row.attemptId}><SignupFailureDetails evidence={setup.purchaseEvidence} busy={busy} onRefresh={load} stale={Boolean(error)}/></div>:null}</>:<strong>{event.label}</strong>}<small>{event.source}</small></div></li>)}</ol>{!model.timeline.length?<p>No timestamped events recorded for this signup.</p>:null}</section>
    <SignupBugHistory apiBase={apiBase} attemptId={row.attemptId}/>
  </section>;
}
