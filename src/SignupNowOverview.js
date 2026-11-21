import React,{useState} from 'react';
import {signupNowEntries,draftStages} from './features/admin/signupNowModel';
import './SignupNowOverview.css';
import {tradeDisplay} from './signupTradeDisplay';
function TradeIcon({trade}){return <svg className="signup-now-trade-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={trade.path}/></svg>;}
const clock=value=>value?new Date(value).toLocaleTimeString('en-CA',{timeZone:'America/Toronto',hour:'numeric',minute:'2-digit',second:'2-digit'}):'Not observed';
const marks={blocked:'!',observed:'✓',partial:'·',unknown:'−',verified:'✓'};
const shortLabels={business_details:'Info',pricing:'Rates',final_review:'Final'};
export default function SignupNowOverview({data,entries:visibleEntries,onInspectSignup}){
 const [selection,setSelection]=useState(''),[inspector,setInspector]=useState(null);
 const entries=visibleEntries||signupNowEntries(data),selected=entries.find(e=>e.key===selection)||entries[0];
 const drafts=signupNowEntries(data,Date.now(),{filter:'all'}).filter(e=>e.kind==='draft');
 const draft=selected?.draft,groups=selected?.row?.setup?.groups||[];
 const trade=tradeDisplay(draft?.selectedTradeId);
 const stages=draft?draftStages(draft):groups.map((g,i)=>({id:g.id,label:['Number','Agent','Texts','Trial'][i]||g.title,fields:g.checks||[],state:(g.checks||[]).some(c=>c.state==='blocked')?'blocked':'unknown'}));
 const opened=inspector?.key===selected?.key?stages.find(s=>s.id===inspector.step):null;
 return <section className="signup-now" aria-label="Signups happening now">
  <header><div><span className="signup-tracker-eyebrow">Live signup watch</span><h3>Signups happening now</h3></div><span className="signup-now-note">Saved events · not continuous presence</span></header>
  <div className="signup-now-counts" aria-label="Totals across all loaded records">{[['Drafts',data?.formObservations&&!data.formObservations.coverage?.unavailable?drafts.length:'—'],['Setup',data?.summary?.active??'—'],['Attention',data?.summary?.stalled??'—'],['Ready',data?.summary?.ready??'—']].map(([label,value])=><div key={label}><strong>{value}</strong><span>{label}</span></div>)}</div>
  {data?.formObservations?.coverage?.unavailable?<p role="alert">Browser progress is unavailable. Missing drafts are not proof nobody started.</p>:null}
  {data?.formObservations?.coverage?.hasMore?<p>More drafts exist than this bounded view can display.</p>:null}
  {!entries.length?<p>{data?'No observed starts match this view. Try Reset view. Unobserved visitors are not counted.':'Reading saved signup starts…'}</p>:<>
   <div className="signup-now-visitors" role="group" aria-label="Choose signup to follow">{entries.map(entry=><button type="button" key={entry.key} aria-pressed={selected?.key===entry.key} title={entry.label} onClick={()=>{setSelection(entry.key);setInspector(null);}}><span>{entry.kind==='draft'?'Draft':'Saved'}</span><strong>{entry.label}</strong></button>)}</div>
   <div className="signup-now-selected"><div><strong>{selected.label}</strong>{draft?.draftNames?.ownerName?<span>Owner entered: {draft.draftNames.ownerName}</span>:null}<span>{draft?draft.currentStepLabel:selected.row.currentStep}</span></div><small>Last {draft?'browser event':'saved progress'}: {clock(draft?.lastObservedAt||selected.row?.lastProgressAt)} Toronto</small></div>
   {draft?<p className="signup-now-alert-status">{draft.startAlertQueuedAt?`Start alert queued ${clock(draft.startAlertQueuedAt)} Toronto; delivery not confirmed here.`:draft.startedAt?'Start alert awaits the next background check (normally within a minute).':'Older/interacted draft: no Start Trial alert is recorded.'} Unsubmitted draft · entered names are not verified identity. Only exact submission linkage can associate a saved signup.</p>:null}
   {draft?<div className="signup-now-trade-summary">{trade?<><TradeIcon trade={trade}/><div><strong>{trade.label}</strong><small>Visitor-selected trade · not verified</small></div></>:<span>Trade not recorded</span>}</div>:null}
   <nav className="signup-now-stages" style={{'--stages':stages.length||6}} aria-label="Compact signup steps">{stages.map((step,i)=><button key={step.id} type="button" className={'is-'+step.state+(step.current?' is-current':'')} aria-expanded={opened?.id===step.id} aria-label={'Inspect '+(draft?step.label+' form step':step.label+' saved checks')} onClick={()=>setInspector(opened?.id===step.id?null:{key:selected.key,step:step.id})}><span aria-hidden="true">{step.id==='trade'&&trade?<TradeIcon trade={trade}/>:marks[step.state]||i+1}</span><strong className={draft&&shortLabels[step.id]?'has-short-label':undefined}><span className="signup-now-label-full">{step.label}</span>{draft&&shortLabels[step.id]?<span className="signup-now-label-short" aria-hidden="true">{shortLabels[step.id]}</span>:null}</strong></button>)}</nav>
   <p className="signup-now-hint">Tap a small box to expand its evidence. No setup action runs.</p>
   {opened?<section className="signup-now-inspector" aria-label="Expanded signup step"><header><h4>{opened.label} · {draft?'browser observations':'saved setup checks'}</h4><button type="button" onClick={()=>setInspector(null)}>Close</button></header>
    {opened.id==='trade'?<p className="signup-now-trade-summary">{trade?<><TradeIcon trade={trade}/><strong>{trade.label}</strong><span>Selected in browser, not verified business identity.</span></>: 'Trade not recorded. Older status-only records cannot tell us which trade was selected.'}</p>:null}
    {!opened.fields.length?<p>No field observations were saved for this step.</p>:<ul>{opened.fields.map(f=><li key={f.id}><strong>{f.label}</strong><span>{draft&&['business_name','owner_name'].includes(f.id)&&draft.draftNames?.[f.id==='business_name'?'businessName':'ownerName']?<span className="signup-now-entered-name">Entered: {draft.draftNames[f.id==='business_name'?'businessName':'ownerName']} · </span>:null}{draft?f.observedAt==null?'Not observed':`${f.presence==='blank'?'Blank':f.presence==='present'?'Entered':'Unknown'} · ${f.validation==='invalid'?f.reasonLabel:f.validation==='valid'?'Passed browser validation':f.reasonLabel||'Validation not observed'}`:f.state==='verified'?'Saved check verified':f.detail||'Not verified'}</span></li>)}</ul>}
    <p>{draft?'Names and the selected trade are visitor-entered display information, not verified identity. Remaining fields show status only; contact/address values and security codes are not copied. Untouched/hidden fields are not assumed valid.':'Saved projection only. Open the detailed progress view for exact-context receipts; no provider check was run.'}</p>
   </section>:null}
   {selected.row?<button type="button" className="signup-now-open" onClick={()=>onInspectSignup?.(selected.row.attemptId)}>Expand {selected.row.businessName} progress</button>:null}
  </>}
 </section>;
}
