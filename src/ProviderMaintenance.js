import React,{useEffect,useState} from 'react';
import './ProviderMaintenance.css';
import useSavedEvidence from './useSavedEvidence';
import SavedEvidenceStatus from './SavedEvidenceStatus';
const validStatus=body=>body?.readOnly===true&&Array.isArray(body.providers)&&Array.isArray(body.history);
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
 const [cursor,setCursor]=useState(null),[clock,setClock]=useState(Date.now());
 const {data:report,state,error,busy,load:refresh}=useSavedEvidence({url:apiBase+'/api/admin/provider-status'+(cursor?'?cursor='+encodeURIComponent(cursor):''),validate:validStatus,intervalMs:60000,auto:!cursor});
 const load=(older=null)=>cursor===older?refresh():setCursor(older);
 useEffect(()=>{const timer=setInterval(()=>setClock(Date.now()),5000);return()=>clearInterval(timer);},[]);
 return <section className="provider-maintenance" aria-label="Upcoming maintenance and provider status" aria-busy={busy}>
  <header><div><h3>Upcoming maintenance & provider status</h3><p>Official notices, Toronto-time windows and saved history. Planned work is separate from bugs and confirmed application outages.</p></div><button type="button" disabled={busy} onClick={()=>load()}>{busy?'Reading status…':'Refresh saved status'}</button></header>
  <SavedEvidenceStatus state={state} label="Provider updates" intervalMs={60000} historical={Boolean(cursor)}/>
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
