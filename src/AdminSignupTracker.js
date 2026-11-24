import React, { useEffect, useMemo, useRef, useState } from 'react';
import './AdminSignupTracker.css';
import './SignupTrackerCompact.css';
import SignupControlRoom from './SignupControlRoom';
import SignupBugHistory from './SignupBugHistory';
import ProviderMaintenance from './ProviderMaintenance';
import useSavedEvidence from './useSavedEvidence';
import SavedEvidenceStatus from './SavedEvidenceStatus';
import SignupNowOverview from './SignupNowOverview';
import { signupNowEntries, draftLabel, SORT_OPTIONS, DATE_OPTIONS, QUICK_VIEWS, quickSignupView } from './features/admin/signupNowModel';
const validTracker = body => body?.ok === true && Array.isArray(body.rows);

const FIELDS = { serviceSummary: ['Services', 400], serviceArea: ['Service area', 160], businessWebsite: ['Business website', 300], businessAddress: ['Business address', 400], specializationNotes: ['Business notes', 2000] };
const time = value => value && Number.isFinite(new Date(value).getTime()) ? new Date(value).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Toronto', timeZoneName: 'short' }) : 'Not recorded';
export const elapsedLabel = value => value == null ? 'Not timed yet' : value < 60000 ? 'Less than a minute' : `${Math.floor(value / 60000)} min without progress`;
const modeLabel = row => row.stalled ? 'Needs attention · 10+ min' : ({ working: 'In progress', waiting_customer: 'Waiting for customer', ready: 'Ready', paused: 'Paused · no alerts', closed: 'Closed · no alerts', inactive: 'Not onboarding' }[row.mode] || 'Unknown');
export function FormObservationReport({ observation }) {
  if (!observation) return <p>Field-level coverage: not observed. Missing observations are not assumed to be blank fields.</p>;
  return <section className="signup-form-field-report" aria-label="Observed form field status"><p><strong>Browser-reported progress, not verified identity.</strong> Last observed {time(observation.lastObservedAt)} ({observation.observedAgeMs == null ? 'age unknown' : `${Math.floor(observation.observedAgeMs / 60000)} min old`}). Current observed step: {observation.currentStepLabel}. {observation.draftNames?.businessName?<>Business entered: {observation.draftNames.businessName}. </>:null}{observation.draftNames?.ownerName?<>Owner entered: {observation.draftNames.ownerName}. </>:null}Only the two entered names are displayed; other fields show status, not typed values. A person’s reason for stopping is unknown.</p>
    <ul>{observation.fields.map(field => <li key={field.id}><strong>{field.label}</strong><span>{field.visibleAtObservation === 'hidden' ? 'Hidden at last observation — not a blocker' : field.presence === 'unknown' ? 'Not observed — not known to be blank' : field.presence === 'blank' ? field.required === false ? 'Optional blank — not a blocker' : `Visible blank${field.interacted ? ` · ${field.reasonLabel}` : ' · untouched; reason unknown'}` : field.validation === 'invalid' ? `Invalid · ${field.reasonLabel}` : field.validation === 'valid' ? 'Present · validation passed' : 'Present · validation not observed'}{field.observedAt && !field.currentStepVisible ? ' · earlier step, not currently visible' : ''}</span></li>)}</ul>
    <small>{observation.coverage.observedFields} / {observation.coverage.totalFields} instrumented fields observed. Coverage: {observation.coverage.instrumentedSteps.join(', ').replaceAll('_', ' ')}. Optional/hidden fields are not treated as required blockers. Human verification here is browser-reported completion only—not backend acceptance. Verification codes and card/payment fields are never recorded.</small></section>;
}

export default function AdminSignupTracker({ apiBase = '' }) {
  const {data,setData,busy,state,load,pause,resume} = useSavedEvidence({url:apiBase+'/api/admin/signup-tracker',validate:validTracker});
  const [filter, setFilter] = useState('watching'), [search, setSearch] = useState(''), [expanded, setExpanded] = useState(''), [draftExpanded, setDraftExpanded] = useState('');
  const [sort, setSort] = useState('newest'), [dateRange, setDateRange] = useState('all');
  const [quickView, setQuickView] = useState(null);
  const [focused, setFocused] = useState('');
  const [editor, setEditor] = useState(null), [saving, setSaving] = useState(false), [saveError, setSaveError] = useState(''), [message, setMessage] = useState('');
  const writing = useRef(null), editorSection = useRef(null);
  useEffect(() => () => writing.current?.abort(), []);
  const entries = useMemo(() => signupNowEntries(data, Date.now(), { filter, search, sort, dateRange }), [data, filter, search, sort, dateRange]);
  const rows = entries.filter(entry => entry.row).map(entry => entry.row);
  const draftRows = entries.filter(entry => entry.draft).map(entry => entry.draft);
  const chooseQuickView = id => { const view=quickSignupView(id,{sort}); if(!view)return; setSearch(view.search);setFilter(view.filter);setSort(view.sort);setDateRange(view.dateRange);setQuickView(id); };
  const inspectSignup = attempt => { setQuickView(null);setFilter('all'); setSearch(''); setDateRange('all'); setFocused(attempt); requestAnimationFrame(()=>document.getElementById('saved-signup-'+attempt)?.scrollIntoView({block:'start'})); };
  const openEditor = row => { setEditor({ attemptId: row.attemptId, businessName: row.businessName, expectedRevision: row.infoRevision, details: { ...row.info } }); setSaveError(''); setMessage(''); };
  useEffect(() => { if (editor?.attemptId) { editorSection.current?.focus({ preventScroll: true }); editorSection.current?.scrollIntoView({ block: 'start' }); } }, [editor?.attemptId]);
  const save = async event => {
    event.preventDefault(); if (writing.current || !editor) return;
    pause();
    const controller = new AbortController(); writing.current = controller; setSaving(true); setSaveError('');
    const timeout = setTimeout(() => controller.abort(), 6500);
    try {
      const response = await fetch(apiBase + '/api/admin/signups/' + encodeURIComponent(editor.attemptId) + '/business-info', {
        method: 'PATCH', credentials: 'include', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'X-MyAIPA-Admin-Editor': '1' },
        body: JSON.stringify({ expectedRevision: editor.expectedRevision, details: editor.details }),
      });
      const body = await response.json();
      if (!response.ok || !body.row || body.publishedToReceptionist !== false) throw new Error(body.error || 'The save was not confirmed. Reload the saved information before changing the draft.');
      setData(current => ({ ...current, rows: current.rows.map(row => row.attemptId === body.row.attemptId ? body.row : row) }));
      setMessage(`Saved business information for ${editor.businessName}. The live receptionist was not changed.${body.auditRecorded === false ? ' The audit log could not be confirmed; please check with support.' : ''}`); setEditor(null);
    } catch (e) { setSaveError(e.name === 'AbortError' ? 'The save result is uncertain. Keep this draft and check the saved information; do not repeat signup.' : e.message); }
    finally { clearTimeout(timeout); writing.current = null; setSaving(false); resume(); }
  };
  return <section className="signup-tracker" aria-label="Signup progress tracker" aria-busy={busy}>
    <header className="signup-tracker-header">
      <div><span className="signup-tracker-eyebrow">My AI PA · Admin</span><h2>Signup control room</h2><p>One clear journey. Every recorded check. The exact step that needs you.</p></div>
      <div className="signup-tracker-refresh"><button type="button" disabled={busy} onClick={load}>{busy ? 'Checking…' : 'Refresh signups'}</button><small>Last checked {time(data?.generatedAt)}</small></div>
    </header>
    <SavedEvidenceStatus state={state}/>
    <div className="signup-tracker-quick-views" role="group" aria-label="Quick signup views">{QUICK_VIEWS.map(([id,label])=><button type="button" key={id} aria-pressed={quickView===id} onClick={()=>chooseQuickView(id)}>{label}</button>)}</div>
    <div className="signup-tracker-toolbar" role="group" aria-label="Find and sort signups">
      <label>Search signups<input type="search" value={search} placeholder="Business, owner, visitor ID or setup step" onChange={e => {setQuickView(null);setSearch(e.target.value);}} /></label>
      <label>Show<select aria-label="Show signups" value={filter} onChange={e => {setQuickView(null);setFilter(e.target.value);}}><option value="watching">Active setup + recently ready</option><option value="active">Active setup</option><option value="stalled">Needs attention</option><option value="waiting_customer">Waiting for customer</option><option value="ready">Ready</option><option value="paused">Paused</option><option value="all">All records</option></select></label>
      <label>Sort by<select aria-label="Sort signups" value={sort} onChange={e => {setQuickView(null);setSort(e.target.value);}}>{SORT_OPTIONS.map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
      <label>Started<select aria-label="Signup start date" value={dateRange} onChange={e => {setQuickView(null);setDateRange(e.target.value);}}>{DATE_OPTIONS.map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
    </div>
    <div className="signup-tracker-view-summary"><p role="status">Showing {rows.length} {rows.length === 1 ? 'signup' : 'signups'} · {draftRows.length} {draftRows.length === 1 ? 'draft' : 'drafts'}</p><button type="button" onClick={()=>{setQuickView(null);setFilter('watching');setSearch('');setSort('newest');setDateRange('all');}}>Reset view</button></div>
    <p className="signup-tracker-view-help">Newest first uses the original start, not the latest refresh. Latest progress uses recorded progress only. Unknown dates sort last and are excluded from date ranges. Active setup + recently ready includes all active setups and accounts ready in the last 24 hours. Filters cover loaded records only.</p>
    <SignupNowOverview data={data} entries={entries} evidenceState={state} onInspectSignup={inspectSignup}/>
    {message ? <p role="status" className="signup-tracker-saved">{message}</p> : null}
    <details className="signup-tracker-totals"><summary>More setup totals</summary><div className="signup-tracker-kpis">
      {[['Active setup', data?.summary?.active, 'People still onboarding'], ['Needs attention', data?.summary?.stalled, '10+ minutes with no progress'], ['Waiting on customer', data?.summary?.waitingCustomer, 'Verification still needed'], ['Setup ready', data?.summary?.ready, 'No stuck-signup alerts']].map(([label, value, note]) => <div key={label}><span>{label}</span><strong>{value ?? '—'}</strong><small>{note}</small></div>)}
    </div></details>
    <details className="signup-tracker-policy"><summary>How to read this dashboard · evidence, alerts and safety</summary><span>A 10-minute heads-up, not an automatic retry. Admin + Telegram alerts once per stalled setup episode. Paused, closed and ready accounts are excluded. Waiting for customer verification is not proof of a technical failure.</span><span>Submitted verification, trial and setup checkpoints use saved backend evidence. A checkout return URL is not payment proof; external checkout is not observed by this form tracker. This form has no separate terms-agreement checkbox, and showing a notice is not proof of agreement.</span></details>
    <div className="signup-tracker-rows">
      {rows.map(row => <article id={'saved-signup-'+row.attemptId} key={row.attemptId || row.businessName} className={'signup-tracker-row ' + (row.stalled ? 'is-stalled ' : '') + (row.attemptId === focused ? 'is-focused' : 'is-compact')}>
        <div className="signup-tracker-row-main">
          <div className="signup-tracker-business"><span className={'signup-tracker-badge is-' + (row.stalled ? 'stalled' : row.mode)}>{modeLabel(row)}</span><h3>{row.businessName}</h3><p>{row.ownerName || 'Owner not recorded'} · Started {time(row.signedUpAt)}</p><button className="control-open-signup" type="button" aria-pressed={row.attemptId===focused} aria-expanded={row.attemptId===focused} onClick={()=>setFocused(row.attemptId===focused?'':row.attemptId)}>Inspect {row.businessName}</button></div>
          <div className="signup-tracker-step"><span>Current step</span><strong>{row.currentStep}</strong><div className="signup-tracker-progress" aria-label={`${row.completedSteps} of ${row.totalSteps} setup checkpoints complete`}>{row.steps.map(step => <span key={step.key} className={'is-' + step.status} title={`${step.label}: ${step.status}`} />)}</div><small>{row.completedSteps} / {row.totalSteps} checkpoints verified</small></div>
          <div className="signup-tracker-time"><strong>{elapsedLabel(row.elapsedMs)}</strong><small>{row.timeBasis === 'tracking_started' ? 'Timed from tracking start; earlier progress time unknown' : `Last observed progress ${time(row.lastProgressAt)}`}</small>{row.alertQueuedAt ? <span>Telegram alert queued {time(row.alertQueuedAt)}</span> : row.stalled ? <span>Alert awaits the background check</span> : null}</div>
        </div>
        {row.attemptId===focused?<div className="signup-tracker-row-actions"><p><strong>Next:</strong> {row.nextAction}</p><button type="button" aria-expanded={expanded === row.attemptId} onClick={() => setExpanded(expanded === row.attemptId ? '' : row.attemptId)}>{expanded === row.attemptId ? 'Hide checkpoints' : 'View checkpoints'}</button><button type="button" disabled={!row.editable || saving} onClick={() => openEditor(row)}>Edit business info</button></div>:null}
        {row.attemptId === focused ? <SignupControlRoom row={row} apiBase={apiBase} /> : null}
        {row.attemptId===focused&&expanded === row.attemptId ? <div className="signup-tracker-checkpoints"><ol>{row.steps.map(step => <li key={step.key} className={'is-' + step.status}><span>{step.status === 'done' ? '✓' : step.status === 'current' ? '→' : '·'}</span>{step.label}<small>{step.status === 'done' ? 'Verified' : step.status === 'current' ? 'Next incomplete' : 'Pending'}</small></li>)}</ol><p>Recorded state: {row.status}{row.blockerCode ? ` · ${row.blockerCode}` : ''}. Checkpoints reflect saved evidence, not a live test or a promise that the phone is ready.</p><FormObservationReport observation={row.formObservation} /></div> : null}
      </article>)}
      {!rows.length ? <div className="signup-tracker-empty">{data ? 'No signups match this view.' : 'Loading saved signup progress…'}</div> : null}
    </div>
    {data?.formObservations ? <details className="signup-form-observations"><summary>All browser field observations</summary><section aria-label="Unlinked signup observations"><header><div><span className="signup-tracker-eyebrow">Browser progress</span><h3>Unlinked visitors · identity unknown</h3></div><span>{draftRows.length} observed drafts</span></header><p>These interacted-with records have no confirmed link to a submitted signup. A missing link is not proof that signup failed or was never submitted. Blank and invalid fields are observations—not guesses about why somebody stopped. Progress records expire after 24 hours.</p>
      {data.formObservations.coverage?.unavailable ? <p className="signup-tracker-error">Field observation coverage is unavailable; do not assume there are no stuck visitors.</p> : null}
      {data.formObservations.coverage?.hasMore ? <p>Only the {data.formObservations.coverage.limit} most recently updated records are shown. Additional draft coverage is not displayed.</p> : null}
      {draftRows.map(row => <article key={row.id} className={'signup-form-observation-card ' + (row.stalled ? 'is-stalled' : '')}><div><strong>{draftLabel(row)} · unsubmitted draft · {row.id.slice(-8)}</strong><span>{row.currentStepLabel} · observation {row.observedAgeMs == null ? 'age unknown' : `${Math.floor(row.observedAgeMs / 60000)} min old`}</span></div><p>{row.blockerLabels.length ? `Observed required issues: ${row.blockerLabels.join('; ')}` : 'No required field failure was observed on the current step. Unknown/untouched fields are not passes.'}</p><button type="button" aria-expanded={draftExpanded === row.id} onClick={() => setDraftExpanded(draftExpanded === row.id ? '' : row.id)}>{draftExpanded === row.id ? 'Hide field status' : 'View field status'}</button>{draftExpanded === row.id ? <FormObservationReport observation={row} /> : null}</article>)}
      {!draftRows.length && !data.formObservations.coverage?.unavailable ? <p>No engaged unlinked drafts match this view. Unobserved visitors are not counted.</p> : null}
    </section></details> : null}
    {editor ? <section ref={editorSection} tabIndex={-1} className="signup-tracker-editor" aria-label="Edit saved business information"><header><div><span className="signup-tracker-eyebrow">Saved business information</span><h3>{editor.businessName}</h3></div><button type="button" disabled={saving} onClick={() => setEditor(null)}>Close editor</button></header><p className="signup-tracker-editor-notice"><strong>Admin record only — not published to the receptionist.</strong> These changes update this signup’s saved business information. Phone/email, identity-linked business name, routing and billing are protected. Publishing new receptionist answers is a separate reviewed action.</p><form onSubmit={save}><fieldset disabled={saving}>{Object.entries(FIELDS).map(([key, [label, limit]]) => <label key={key}>{label}{['serviceSummary', 'specializationNotes'].includes(key) ? <textarea maxLength={limit} rows={key === 'specializationNotes' ? 4 : 3} value={editor.details[key]} onChange={e => setEditor(current => ({ ...current, details: { ...current.details, [key]: e.target.value } }))} /> : <input type={key === 'businessWebsite' ? 'url' : 'text'} maxLength={limit} value={editor.details[key]} onChange={e => setEditor(current => ({ ...current, details: { ...current.details, [key]: e.target.value } }))} />}</label>)}</fieldset>{saveError ? <p role="alert" className="signup-tracker-error">{saveError}</p> : null}<div className="signup-tracker-editor-actions"><button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save business information'}</button><button type="button" disabled={saving} onClick={() => { const fresh = data?.rows.find(row => row.attemptId === editor.attemptId); if (fresh) openEditor(fresh); }}>Discard draft and load last checked info</button></div></form></section> : null}
    <ProviderMaintenance apiBase={apiBase}/>
    <SignupBugHistory apiBase={apiBase} signupNames={Object.fromEntries((data?.rows||[]).map(row=>[row.attemptId,row.businessName]))} onInspectSignup={data?inspectSignup:undefined}/>
    <footer className="signup-tracker-footer">Checks saved signup progress about every five seconds while this page is visible; errors slow the read cadence. Background alerts do not require this page to stay open. No call, text, payment or provisioning action runs automatically from this tracker.</footer>
  </section>;
}
