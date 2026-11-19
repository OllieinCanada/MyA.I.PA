import React,{useState} from 'react';
import './SignupBugHistory.css';
import useSavedEvidence from './useSavedEvidence';
import SavedEvidenceStatus from './SavedEvidenceStatus';
const validHistory=body=>body?.readOnly===true&&Array.isArray(body.events)&&Array.isArray(body.groups);
const time=value=>new Date(value).toLocaleString('en-CA',{timeZone:'America/Toronto',month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});
export default function SignupBugHistory({apiBase='',attemptId,signupNames={},onInspectSignup}){
 const [issueId,setIssueId]=useState(''),[page,setPage]=useState(null);
 const filterKey=JSON.stringify([attemptId||'',issueId]);
 const cursor=page?.filterKey===filterKey?page.cursor:null;
 const params=new URLSearchParams();if(attemptId)params.set('attemptId',attemptId);if(issueId)params.set('issueId',issueId);if(cursor)params.set('cursor',cursor);
 const {data:shown,state,busy,load:refresh}=useSavedEvidence({url:apiBase+'/api/admin/signup-bugs?'+params,validate:validHistory,intervalMs:30000,auto:!cursor});
 const load=(nextCursor=null)=>cursor===nextCursor?refresh():setPage({filterKey,cursor:nextCursor});
 return <section className="signup-bug-history" aria-label={attemptId?'Bug history for this signup':'Application bug history'} aria-busy={busy}>
  <header><div><h4>{attemptId?'Bug history for this signup':'Bug history and diagnoses'}</h4><p>Saved reports for future reference. No automatic repair, sending or incident acknowledgement.</p></div><button type="button" disabled={busy} onClick={()=>load()}>{busy?'Reading history…':'Refresh latest bug history'}</button></header>
  <SavedEvidenceStatus state={state} label="Bug-history updates" intervalMs={30000} historical={Boolean(cursor)}/>
  {issueId?<button type="button" onClick={()=>setIssueId('')}>Show all signatures again</button>:null}
  {shown?.groups.map(group=>{const events=shown.events.filter(event=>event.issueId===group.issueId),first=events[0],dates=events.map(event=>event.capturedAt).filter(at=>Number.isFinite(Date.parse(at))).sort((a,b)=>Date.parse(a)-Date.parse(b));return <details key={group.issueId}><summary><strong>{group.reference} · {group.operation}</strong><span>{group.reportsOnPage} captured report{group.reportsOnPage===1?'':'s'} on this page</span></summary><div className="bug-group-body">
   {dates.length?<p>First captured on this page: {time(dates[0])} · Last captured on this page: {time(dates[dates.length-1])}. Not lifetime occurrence totals.</p>:null}
   {first?.signupAttemptId&&onInspectSignup?<button type="button" onClick={()=>onInspectSignup(first.signupAttemptId)}>Open signup: {signupNames[first.signupAttemptId]||'verified signup'}</button>:<p>{first?.signupAttemptId?'Linked to this verified signup.':'Not linked to a currently verified signup. No name/phone match was guessed.'}</p>}
   {!issueId?<button type="button" onClick={()=>setIssueId(group.issueId)}>View matching report history</button>:null}
   <ol>{events.map(event=><li key={event.eventRef}><time dateTime={event.capturedAt}>{time(event.capturedAt)}</time><p><strong>{event.diagnostic.message}</strong></p><p>{event.diagnostic.code?'Recorded code: '+event.diagnostic.code:'Unrecognized/missing code'}{event.diagnostic.httpStatus?' · HTTP '+event.diagnostic.httpStatus:''}{event.diagnostic.reference?' · Error reference '+event.diagnostic.reference:''}</p><p>Next: {event.nextAction}</p><small>{event.release?'Release '+event.release.slice(0,12):'Release not recorded'} · Needs investigation—not a confirmed software defect or a verified fix.</small></li>)}</ol>
  </div></details>;})}
  {shown&&!shown.events.length?<p>No captured reports on this page. This is not proof that no bugs occurred; unlinked failures may be in the application-wide history.</p>:null}
  {shown?.hasMore?<button type="button" disabled={busy} onClick={()=>load(shown.nextCursor)}>Read older reports</button>:null}
  <small>{shown?.limitation||'History is not loaded. This does not grant setup or launch readiness.'}</small>
 </section>;
}
