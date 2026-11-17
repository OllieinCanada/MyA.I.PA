import React, {useEffect,useRef,useState} from 'react';
import './SignupLiveDiagnostics.css';
const labels={verified:'Verified',failed:'Failed',observed:'Observed — not completion',unknown:'Unknown'};
const codes={RESOURCE_REFERENCE_MISSING:'No exact saved resource reference. Check provider receipts before any retry.',
  EXECUTION_LINK_MISSING:'No exact Make execution is linked. A request ID or matching time is not sufficient.',
  PROVIDER_CONFIGURATION_MISSING:'Read-only provider access is not configured.',
  PROVIDER_IDENTITY_CONFLICT:'Provider evidence does not match the exact saved identity.',
  INVENTORY_RESPONSE_INCOMPLETE:'Provider returned incomplete results. No absence or ownership conclusion is safe.',
  MULTIPLE_MARKER_MATCHES:'More than one number matches the setup marker. Inspect the conflict before any recovery.',
  RESOURCE_NOT_FOUND:'Referenced resource was not found in this account. This does not prove no purchase happened.',
  PROVIDER_ACCESS_DENIED:'Provider denied this read.',READ_TIMEOUT:'Provider read timed out. Outcome remains unknown.',
  PROVIDER_RATE_LIMITED:'Provider rate limit reached. No retry was attempted.'};
const time=value=>value&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('en-CA',{timeZone:'America/Toronto'}):'Not recorded';
export function RecoveryGuidance({guidance,stale=false}){
 if(guidance?.version!==1||guidance.readOnly!==true||guidance.applyAllowed!==false||!Array.isArray(guidance.steps))return null;
 return <section className="signup-live-group" aria-label="Safe recovery steps"><h6>What happens next</h6>
  <p>{stale?'Last-known guidance — refresh checks before taking any action.':guidance.nextAction}</p>
  <ol>{guidance.steps.filter(s=>s.state!=='observed_checks_verified').map(s=><li key={s.id}><strong>{s.label}: {s.state==='failed'?'Failed':'Unknown — check needed'}</strong><p>{s.next}</p></li>)}</ol>
  <p>No automatic resend, purchase or trial activation. Any fix must be verified before setup advances.</p><small>{guidance.limitation}</small>
 </section>;
}
export default function SignupLiveDiagnostics({attemptId,apiBase='',now=Date.now()}){
  const [report,setReport]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const request=useRef(null),mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;request.current?.abort();};},[]);
  async function run(){
    if(request.current)return;
    const controller=new AbortController();request.current=controller;setBusy(true);setError('');
    const timer=setTimeout(()=>controller.abort(),20000);
    try{
      const response=await fetch(apiBase+'/api/admin/signup-tracker/'+encodeURIComponent(attemptId)+'/diagnostics',{
        method:'POST',credentials:'include',cache:'no-store',signal:controller.signal,
        headers:{'Content-Type':'application/json','X-MyAIPA-Read-Only-Check':'1'},body:'{}'});
      const body=await response.json(),d=body.diagnostics;
      if(!response.ok||d?.version!==1||d.readOnly!==true||d.attemptId!==attemptId||!Array.isArray(d.groups)
        ||d.groups.length!==5||d.groups.some(g=>!Array.isArray(g.checks)))throw Error('unavailable');
      if(mounted.current&&!controller.signal.aborted)setReport(d);
    }catch(_){if(mounted.current)setError('Fresh checks unavailable. Any results below are last-known only, not a current pass. No action was retried.');}
    finally{clearTimeout(timer);if(request.current===controller)request.current=null;if(mounted.current)setBusy(false);}
  }
  const stale=report&&(Boolean(error)||now-Date.parse(report.checkedAt)>60000);
  return <section className="signup-live-diagnostics" aria-label="Read-only signup provider diagnostics">
    <h5>Check this signup</h5><p>Compare saved evidence with exact provider references. Never buys, retries setup, changes routing or sends messages.</p>
    <button type="button" onClick={run} disabled={busy}>{busy?'Checking exact references…':'Run read-only checks'}</button>
    {error?<p role="alert">{error}</p>:null}
    {report?<><p role="status">{stale?'Last-known snapshot — refresh required':'Point-in-time snapshot'} · {time(report.checkedAt)}</p>
      {report.groups.map(g=><section key={g.id} className="signup-live-group" aria-label={g.title}><h6>{g.title}</h6><ul>{g.checks.map(c=><li key={c.id}>
        <strong className={'diagnostic-state is-'+(labels[c.state]?c.state:'unknown')}>{labels[c.state]||'Unknown'}</strong>
        <p>{codes[c.detail]||(/^[A-Z_]+$/.test(c.detail||'')?'Provider read unavailable; outcome remains unknown.':c.detail)}</p>
        <small>{c.source} · Evidence time: {time(c.evidenceAt)}{c.checkedAt?` · Read: ${time(c.checkedAt)}`:''}</small>
      </li>)}</ul></section>)}
      <RecoveryGuidance guidance={report.recovery} stale={stale}/>
      <p>{report.nextAction}</p><small>{report.limitations}</small></>:<small>No live check has been run. Saved progress remains separate.</small>}
    <button type="button" disabled>Recovery not authorized by a diagnostic check</button>
  </section>;
}
