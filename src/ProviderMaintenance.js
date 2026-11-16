import React,{useEffect,useRef,useState} from 'react';
import './ProviderMaintenance.css';
const time=value=>value?new Date(value).toLocaleString('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}):'Not checked';
export function MaintenanceNotice({notice,historical=false,observedAt}){
 return <article className={'provider-notice is-'+notice.kind}>
  <strong>{notice.title}</strong><p>{historical?'Historical observation · ':''}{notice.kind==='maintenance'?'Planned maintenance':'Provider incident'} · Provider status: {notice.status}</p>
  {notice.start?<p>Toronto window: {time(notice.start)} → {time(notice.end)}</p>:null}
  <p>Affected components: {notice.components.join(', ')||'Not specified'}</p><p>{notice.description}</p>
  <small>Provider update: {time(notice.updatedAt)}{observedAt?' · Observed '+time(observedAt):''}. Not proof of a problem with any particular signup.</small>
  <p><a href={notice.sourceUrl} target="_blank" rel="noopener noreferrer">Read official notice</a></p>
 </article>;
}
export default function ProviderMaintenance({apiBase=''}){
 const [report,setReport]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[clock,setClock]=useState(Date.now());
 const active=useRef(null),generation=useRef(0),cursor=useRef(null);
 async function load(older=null){
  active.current?.abort();const controller=new AbortController(),version=++generation.current;active.current=controller;setBusy(true);
  const timer=setTimeout(()=>controller.abort(),6500);
  try{const r=await fetch(apiBase+'/api/admin/provider-status'+(older?'?cursor='+encodeURIComponent(older):''),{credentials:'include',signal:controller.signal}),body=await r.json();
   if(!r.ok||body.readOnly!==true||!Array.isArray(body.providers)||!Array.isArray(body.history))throw Error('unavailable');
   if(version===generation.current&&!controller.signal.aborted){setReport(body);setError('');cursor.current=older;setClock(Date.now());}
  }catch{if(version===generation.current)setError('Provider evidence could not be refreshed. Any displayed information is last-known—not an all-clear.');}
  finally{clearTimeout(timer);if(active.current===controller){active.current=null;setBusy(false);}}
 }
 useEffect(()=>{
  setReport(null);load();const timer=setInterval(()=>{setClock(Date.now());if(document.visibilityState==='visible'&&!active.current&&!cursor.current)load();},60000);
  return()=>{clearInterval(timer);generation.current++;active.current?.abort();};
  // Each API scope owns its request generation. No customer/provider mutations.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[apiBase]);
 return <section className="provider-maintenance" aria-label="Upcoming maintenance and provider status" aria-busy={busy}>
  <header><div><h3>Upcoming maintenance & provider status</h3><p>Official notices, Toronto-time windows and saved history. Planned work is separate from bugs and confirmed application outages.</p></div><button type="button" disabled={busy} onClick={()=>load()}>{busy?'Reading status…':'Refresh saved status'}</button></header>
  {error?<p role="alert">{error}</p>:null}
  {!report?<p>Not loaded. Provider availability is not verified.</p>:<>
   <div className="provider-status-grid">{report.providers.map(provider=>{
    const fresh=!error&&provider.fresh&&clock-Date.parse(provider.lastSuccessfulAt)>=0&&clock-Date.parse(provider.lastSuccessfulAt)<=15*60000;
    return <details key={provider.id}><summary><strong>{provider.name}</strong><span>{fresh?'Provider reports: '+provider.indicator:'Unknown / stale / unsupported'}</span><small>Last successful read: {time(provider.lastSuccessfulAt)}</small></summary>
     <div><p>{provider.features}</p>{provider.failure?<p role="status">{provider.failure}</p>:null}<p><a href={provider.sourceUrl} target="_blank" rel="noopener noreferrer">Official status page</a></p>
     {!fresh?<p>Not current verified evidence. Listed notices are last-known; disappearance does not prove resolution.</p>:null}
     {provider.notices.length?provider.notices.map(notice=><MaintenanceNotice key={notice.id} notice={notice}/>):<p>{fresh?'No notices returned in this public snapshot. This is not application health or private-account coverage.':'No verified current notice inventory.'}</p>}</div>
    </details>;
   })}</div>
   <details><summary>Saved provider notice history · {report.history.length} observations on this page</summary><p>Retained versions—not a count of distinct customer failures. Missing notices are not automatically marked resolved.</p>{report.history.map(row=><MaintenanceNotice key={row.ref} notice={row.notice} historical observedAt={row.observedAt}/>)}{report.hasMore?<button disabled={busy} type="button" onClick={()=>load(report.nextCursor)}>Read older notices</button>:null}</details>
   <small>{report.limitation}</small>
  </>}
 </section>;
}
