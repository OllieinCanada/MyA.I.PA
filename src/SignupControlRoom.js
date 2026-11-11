import React, {useCallback,useEffect,useRef,useState} from 'react';
import SignupJourneyMap from './SignupJourneyMap';
import {controlRoomModel} from './signupControlRoomModel';
import './SignupControlRoom.css';

const time=value=>value && Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('en-CA',{timeZone:'America/Toronto',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',second:'2-digit'}):'No timestamp recorded';
const stateLabel=state=>({verified:'Backend verified',observed:'Browser / process observed',recorded:'Recorded',blocked:'Needs attention',pending:'Not verified',unknown:'Not observed',optional:'Not required',present:'Not validated'}[state]||'Unknown');
const mark=state=>['verified','observed','recorded'].includes(state)?'✓':state==='blocked'?'!':'−';
export default function SignupControlRoom({row,apiBase=''}) {
  const [report,setReport]=useState(null),[selected,setSelected]=useState('number'),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const request=useRef(null),generation=useRef(0),inspector=useRef(null);
  const [now,setNow]=useState(Date.now());
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),5000);return()=>{clearInterval(timer);generation.current++;request.current?.abort();};},[]);
  useEffect(()=>{generation.current++;request.current?.abort();request.current=null;setBusy(false);setReport(null);setError('');},[row.infoRevision]);
  const load=useCallback(async()=>{
    if(request.current)return;
    const controller=new AbortController(),version=generation.current;request.current=controller;setBusy(true);setError('');
    const timer=setTimeout(()=>controller.abort(),6500);
    try {
      const response=await fetch(apiBase+'/api/admin/signup-tracker/'+encodeURIComponent(row.attemptId)+'/setup',{credentials:'include',signal:controller.signal});
      const body=await response.json();
      if(!response.ok||body.setup?.readOnly!==true||!Array.isArray(body.setup.groups))throw Error('unavailable');
      if(version===generation.current&&!controller.signal.aborted){setReport(body.setup);setNow(Date.now());}
    } catch(_){if(version===generation.current)setError('Detailed evidence is unavailable. Showing last-known information, not a fresh check. No setup action was run.');}
    finally{clearTimeout(timer);if(request.current===controller){request.current=null;setBusy(false);}}
  },[apiBase,row.attemptId]);
  // Only the selected signup has this mounted workspace. Poll saved evidence,
  // never providers, and never while the browser is hidden.
  useEffect(()=>{const timer=setInterval(()=>{if(document.visibilityState==='visible')load();},60000);return()=>clearInterval(timer);},[load]);
  const setup=report||row.setup,model=controlRoomModel(row,setup,selected,now);
  const choose=id=>{setSelected(id);if(window.matchMedia('(max-width: 800px)').matches){requestAnimationFrame(()=>{inspector.current?.focus({preventScroll:true});inspector.current?.scrollIntoView({block:'start',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});});}};
  if(!setup)return null;
  const search=setup.number.search;
  return <section className="signup-control-room" aria-label={`Setup analysis for ${row.businessName}`}>
    <div className={'control-room-summary '+(row.stalled?'is-stalled':'')}><span className="control-summary-icon" aria-hidden="true">{row.stalled?'!':'i'}</span><div><h4>{model.headline}</h4><p>{model.explanation}</p></div><span className="control-read-only">Read-only</span></div>
    {error?<p role="alert" className="signup-tracker-error">{error}</p>:null}
    <div className="control-room-layout"><div className="control-room-main">
      <SignupJourneyMap row={row} onSelect={choose} selectedId={selected}/>
      <div className="setup-analysis-groups control-room-groups">{model.groups.map((group,index)=><section key={group.id} aria-label={group.title} className={selected===group.id?'is-selected':''}><h5><button type="button" aria-pressed={selected===group.id} onClick={()=>choose(group.id)}><span aria-hidden="true">{index+1}</span>{['Number','Assistant & script','Practice texts','Trial & readiness'][index]}</button></h5>
        {group.id==='number'?<div className="control-area-policy"><strong>Signed area-code order</strong><div className="control-area-chips">{setup.number.policyValid?setup.number.areaOrder.map((code,i)=><React.Fragment key={code}>{i>0?<span aria-hidden="true">→</span>:null}<b>{code}</b></React.Fragment>):<span>Not recorded</span>}</div><small>{setup.number.locked?'Locked request · policy unchanged':'Exact registered policy only'}</small></div>:null}
        <ul>{group.checks.map(check=><li key={check.id} className={'is-'+check.state}><span className="setup-check-symbol" aria-hidden="true">{mark(check.state)}</span><span>{check.label}<small>{stateLabel(check.state)}</small></span></li>)}</ul>
        {group.id==='activation'?<div className="control-readiness"><strong>{model.verified} of {model.total} backend checks verified</strong><div role="progressbar" aria-valuemin={0} aria-valuemax={model.total} aria-valuenow={model.verified} aria-label="Verified backend checks, not launch approval" className="control-readiness-meter">{Array.from({length:model.total},(_,i)=><span key={i} className={i<model.verified?'is-verified':''}/>)}</div><small>Not a launch approval.</small></div>:null}
      </section>)}</div>
    </div>
    <aside className="control-room-inspector" aria-label="Selected step evidence" tabIndex={-1} ref={inspector}>
      <span className="signup-tracker-eyebrow">Step inspector</span><h4>Selected step: {model.selected?.title || 'Number search'}</h4><p className="control-evidence-stamp">Saved evidence checked {time(setup.checkedAt)}</p>
      <button type="button" disabled={busy} onClick={load}>{busy?'Reading saved evidence…':'Analyze saved setup'}</button>
      <p className="control-coverage">{report?setup.coverage.replaceAll('_',' '):'Summary only · read detailed evidence for search history'}</p>
      {selected==='number'?<div className="control-search-detail"><strong>{model.freshSearch&&search?.phase==='searching'?`Searching ${search.areaCode || 'regional inventory'}`:search?`${search.stale || !model.freshSearch?'Stale observation':'Last observed search'}: ${search.phase.replaceAll('_',' ')}`:'Current search not observed'}</strong><p>Preferred area: {setup.number.preferredAreaCode || 'Unknown'}. {setup.number.locked?'Locked request: the original area-code policy is preserved.':''}</p><p>{setup.number.assignedLast4?`Assigned area ${setup.number.assignedAreaCode} · ending ${setup.number.assignedLast4}`:'No number assignment saved.'}</p></div>:null}
      <ul className="control-selected-checks">{model.detailChecks.map(check=><li key={check.id} className={'is-'+check.state}><strong><span aria-hidden="true">{mark(check.state)} </span>{check.label}</strong><small>{stateLabel(check.state)}</small><p>{check.detail}</p>{check.at?<time dateTime={check.at}>{time(check.at)}</time>:null}</li>)}</ul>
      {model.selected?.note?<p>{model.selected.note}</p>:null}
      <section className="control-room-timeline" aria-label="Signup event timeline"><h5>Event timeline</h5><p>Only recorded events with timestamps. Gaps do not mean nothing happened.</p><ol>{model.timeline.map(event=><li key={event.id} className={'is-'+event.state}><span aria-hidden="true">{mark(event.state)}</span><div><time dateTime={event.at}>{time(event.at)}</time><strong>{event.label}</strong><small>{event.source}</small></div></li>)}</ol>{!model.timeline.length?<p>No timestamped events recorded for this signup.</p>:null}</section>
      <div className="control-evidence-warning">Saved evidence ≠ guaranteed delivery. A search observation is not a purchase receipt.</div><p className="control-room-limitations">{setup.limitation}</p>
    </aside></div>
  </section>;
}
