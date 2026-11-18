import React,{useCallback,useEffect,useRef,useState} from 'react';
import './SignupBugHistory.css';
const time=value=>new Date(value).toLocaleString('en-CA',{timeZone:'America/Toronto',month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});
export default function SignupBugHistory({apiBase='',attemptId,signupNames={},onInspectSignup}){
 const [report,setReport]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[issueId,setIssueId]=useState('');
 const request=useRef(null),generation=useRef(0),cursor=useRef(null);
 const filterKey=JSON.stringify([attemptId||'',issueId]);
 const load=useCallback(async(nextCursor=null)=>{
  request.current?.abort();const controller=new AbortController(),version=++generation.current;request.current=controller;setBusy(true);setError('');
  const params=new URLSearchParams();if(attemptId)params.set('attemptId',attemptId);if(issueId)params.set('issueId',issueId);if(nextCursor)params.set('cursor',nextCursor);
  const timer=setTimeout(()=>controller.abort(),6500);
  try{const response=await fetch(apiBase+'/api/admin/signup-bugs?'+params,{credentials:'include',signal:controller.signal});const body=await response.json();
   if(!response.ok||body.readOnly!==true||!Array.isArray(body.events)||!Array.isArray(body.groups))throw Error('unavailable');
   if(generation.current===version&&!controller.signal.aborted){cursor.current=nextCursor;setReport({...body,filterKey});}
  }catch{if(generation.current===version)setError('Bug history could not be refreshed. Any displayed reports are last-known; missing reports do not mean no failure occurred.');}
  finally{clearTimeout(timer);if(request.current===controller){request.current=null;setBusy(false);}}
 },[apiBase,attemptId,issueId,filterKey]);
 useEffect(()=>{cursor.current=null;load();const timer=setInterval(()=>{if(document.visibilityState==='visible'&&!cursor.current&&!request.current)load();},60000);return()=>{clearInterval(timer);generation.current++;request.current?.abort();};},[load]);
 const shown=report?.filterKey===filterKey?report:null;
 return <section className="signup-bug-history" aria-label={attemptId?'Bug history for this signup':'Application bug history'} aria-busy={busy}>
  <header><div><h4>{attemptId?'Bug history for this signup':'Bug history and diagnoses'}</h4><p>Saved reports for future reference. No automatic repair, sending or incident acknowledgement.</p></div><button type="button" disabled={busy} onClick={()=>load()}>{busy?'Reading history…':'Refresh latest bug history'}</button></header>
  {error?<p role="alert">{error}</p>:null}
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
