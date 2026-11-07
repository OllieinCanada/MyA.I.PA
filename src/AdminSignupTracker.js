import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './AdminSignupTracker.css';

const FIELDS = { serviceSummary: ['Services', 400], serviceArea: ['Service area', 160], businessWebsite: ['Business website', 300], businessAddress: ['Business address', 400], specializationNotes: ['Business notes', 2000] };
const time = value => value && Number.isFinite(new Date(value).getTime()) ? new Date(value).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Toronto', timeZoneName: 'short' }) : 'Not recorded';
export const elapsedLabel = value => value == null ? 'Not timed yet' : value < 60000 ? 'Less than a minute' : `${Math.floor(value / 60000)} min without progress`;
const modeLabel = row => row.stalled ? 'Needs attention · 10+ min' : ({ working: 'In progress', waiting_customer: 'Waiting for customer', ready: 'Ready', paused: 'Paused · no alerts', closed: 'Closed · no alerts', inactive: 'Not onboarding' }[row.mode] || 'Unknown');
export function FormObservationReport({ observation }) {
  if (!observation) return <p>Field-level coverage: not observed. Missing observations are not assumed to be blank fields.</p>;
  return <section className="signup-form-field-report" aria-label="Observed form field status"><p><strong>Browser-reported metadata only.</strong> Last observed {time(observation.lastObservedAt)} ({observation.observedAgeMs == null ? 'age unknown' : `${Math.floor(observation.observedAgeMs / 60000)} min old`}). Current observed step: {observation.currentStepLabel}. No typed values were collected; a person’s reason for stopping is unknown.</p>
    <ul>{observation.fields.map(field => <li key={field.id}><strong>{field.label}</strong><span>{field.visibleAtObservation === 'hidden' ? 'Hidden at last observation — not a blocker' : field.presence === 'unknown' ? 'Not observed — not known to be blank' : field.presence === 'blank' ? field.required === false ? 'Optional blank — not a blocker' : `Visible blank${field.interacted ? ` · ${field.reasonLabel}` : ' · untouched; reason unknown'}` : field.validation === 'invalid' ? `Invalid · ${field.reasonLabel}` : field.validation === 'valid' ? 'Present · validation passed' : 'Present · validation not observed'}{field.observedAt && !field.currentStepVisible ? ' · earlier step, not currently visible' : ''}</span></li>)}</ul>
    <small>{observation.coverage.observedFields} / {observation.coverage.totalFields} instrumented fields observed. Coverage: {observation.coverage.instrumentedSteps.join(', ').replaceAll('_', ' ')}. Optional/hidden fields are not treated as required blockers. Human verification here is browser-reported completion only—not backend acceptance. Verification codes and card/payment fields are never recorded.</small></section>;
}

export default function AdminSignupTracker({ apiBase = '' }) {
  const [data, setData] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('active'), [search, setSearch] = useState(''), [expanded, setExpanded] = useState(''), [draftExpanded, setDraftExpanded] = useState('');
  const [editor, setEditor] = useState(null), [saving, setSaving] = useState(false), [saveError, setSaveError] = useState(''), [message, setMessage] = useState('');
  const reading = useRef(null), writing = useRef(null), editorSection = useRef(null), readGeneration = useRef(0);
  const load = useCallback(async () => {
    if (reading.current || writing.current || document.visibilityState === 'hidden') return;
    const generation = readGeneration.current;
    const controller = new AbortController(); reading.current = controller; setBusy(true);
    const timeout = setTimeout(() => controller.abort(), 6500);
    try {
      const response = await fetch(apiBase + '/api/admin/signup-tracker', { credentials: 'include', signal: controller.signal });
      const body = await response.json();
      if (!response.ok || !Array.isArray(body.rows)) throw new Error('unavailable');
      if (!controller.signal.aborted && generation === readGeneration.current) { setData(body); setError(''); }
    } catch (_) { if (generation === readGeneration.current && reading.current === controller) setError('Signup updates are unavailable. Displayed rows are last-known information, not a fresh check.'); }
    finally { clearTimeout(timeout); if (reading.current === controller) { reading.current = null; setBusy(false); } }
  }, [apiBase]);
  useEffect(() => {
    load(); const timer = setInterval(load, 60000);
    const visible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', visible);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', visible); reading.current?.abort(); writing.current?.abort(); };
  }, [load]);
  const rows = useMemo(() => (data?.rows || []).filter(row => {
    const matches = filter === 'all' || (filter === 'active' ? row.active : filter === 'stalled' ? row.stalled : row.mode === filter);
    return matches && `${row.businessName} ${row.ownerName} ${row.currentStep} ${row.status} ${row.attemptId}`.toLowerCase().includes(search.trim().toLowerCase());
  }), [data, filter, search]);
  const draftRows = (data?.formObservations?.rows || []).filter(row => !row.linkedAttemptId && row.engaged && (!search.trim() || row.id.toLowerCase().includes(search.trim().toLowerCase())));
  const openEditor = row => { setEditor({ attemptId: row.attemptId, businessName: row.businessName, expectedRevision: row.infoRevision, details: { ...row.info } }); setSaveError(''); setMessage(''); };
  useEffect(() => { if (editor?.attemptId) { editorSection.current?.focus({ preventScroll: true }); editorSection.current?.scrollIntoView({ block: 'start' }); } }, [editor?.attemptId]);
  const save = async event => {
    event.preventDefault(); if (writing.current || !editor) return;
    readGeneration.current++; reading.current?.abort();
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
    finally { clearTimeout(timeout); writing.current = null; setSaving(false); }
  };
  return <section className="signup-tracker" aria-label="Signup progress tracker" aria-busy={busy}>
    <header className="signup-tracker-header">
      <div><span className="signup-tracker-eyebrow">From signup to ready</span><h2>Every signup. One clear view.</h2><p>See the next unfinished step, spot a delay, and update saved business information.</p></div>
      <div className="signup-tracker-refresh"><button type="button" disabled={busy} onClick={load}>{busy ? 'Checking…' : 'Refresh signups'}</button><small>Last checked {time(data?.generatedAt)}</small></div>
    </header>
    {error ? <p role="alert" className="signup-tracker-error">{error}</p> : null}
    {message ? <p role="status" className="signup-tracker-saved">{message}</p> : null}
    <div className="signup-tracker-kpis">
      {[['Active setup', data?.summary?.active, 'People still onboarding'], ['Needs attention', data?.summary?.stalled, '10+ minutes with no progress'], ['Waiting on customer', data?.summary?.waitingCustomer, 'Verification still needed'], ['Setup ready', data?.summary?.ready, 'No stuck-signup alerts']].map(([label, value, note]) => <div key={label}><span>{label}</span><strong>{value ?? '—'}</strong><small>{note}</small></div>)}
    </div>
    <div className="signup-tracker-policy"><strong>A 10-minute heads-up, not an automatic retry.</strong><span>Admin + Telegram alerts once per stalled setup episode. Paused, closed and ready accounts are excluded. Waiting for customer verification is not proof of a technical failure.</span><span>Submitted verification, trial and setup checkpoints use saved backend evidence. A checkout return URL is not payment proof; external checkout is not observed by this form tracker. This form has no separate terms-agreement checkbox, and showing a notice is not proof of agreement.</span></div>
    <div className="signup-tracker-toolbar"><label>Search signups<input type="search" value={search} placeholder="Business, owner or setup step" onChange={e => setSearch(e.target.value)} /></label><label>Show<select aria-label="Show signups" value={filter} onChange={e => setFilter(e.target.value)}><option value="active">Active setup</option><option value="stalled">Needs attention</option><option value="waiting_customer">Waiting for customer</option><option value="ready">Ready</option><option value="paused">Paused</option><option value="all">All records</option></select></label><span>{rows.length} {rows.length === 1 ? 'signup' : 'signups'}</span></div>
    <div className="signup-tracker-rows">
      {rows.map(row => <article key={row.attemptId || row.businessName} className={'signup-tracker-row ' + (row.stalled ? 'is-stalled' : '')}>
        <div className="signup-tracker-row-main">
          <div className="signup-tracker-business"><span className={'signup-tracker-badge is-' + (row.stalled ? 'stalled' : row.mode)}>{modeLabel(row)}</span><h3>{row.businessName}</h3><p>{row.ownerName || 'Owner not recorded'} · Started {time(row.signedUpAt)}</p></div>
          <div className="signup-tracker-step"><span>Current step</span><strong>{row.currentStep}</strong><div className="signup-tracker-progress" aria-label={`${row.completedSteps} of ${row.totalSteps} setup checkpoints complete`}>{row.steps.map(step => <span key={step.key} className={'is-' + step.status} title={`${step.label}: ${step.status}`} />)}</div><small>{row.completedSteps} / {row.totalSteps} checkpoints verified</small></div>
          <div className="signup-tracker-time"><strong>{elapsedLabel(row.elapsedMs)}</strong><small>{row.timeBasis === 'tracking_started' ? 'Timed from tracking start; earlier progress time unknown' : `Last observed progress ${time(row.lastProgressAt)}`}</small>{row.alertQueuedAt ? <span>Telegram alert queued {time(row.alertQueuedAt)}</span> : row.stalled ? <span>Alert awaits the background check</span> : null}</div>
        </div>
        <div className="signup-tracker-row-actions"><p><strong>Next:</strong> {row.nextAction}</p><button type="button" aria-expanded={expanded === row.attemptId} onClick={() => setExpanded(expanded === row.attemptId ? '' : row.attemptId)}>{expanded === row.attemptId ? 'Hide checkpoints' : 'View checkpoints'}</button><button type="button" disabled={!row.editable || saving} onClick={() => openEditor(row)}>Edit business info</button></div>
        {expanded === row.attemptId ? <div className="signup-tracker-checkpoints"><ol>{row.steps.map(step => <li key={step.key} className={'is-' + step.status}><span>{step.status === 'done' ? '✓' : step.status === 'current' ? '→' : '·'}</span>{step.label}<small>{step.status === 'done' ? 'Verified' : step.status === 'current' ? 'Next incomplete' : 'Pending'}</small></li>)}</ol><p>Recorded state: {row.status}{row.blockerCode ? ` · ${row.blockerCode}` : ''}. Checkpoints reflect saved evidence, not a live test or a promise that the phone is ready.</p><FormObservationReport observation={row.formObservation} /></div> : null}
      </article>)}
      {!rows.length ? <div className="signup-tracker-empty">{data ? 'No signups match this view.' : 'Loading saved signup progress…'}</div> : null}
    </div>
    {data?.formObservations ? <section className="signup-form-observations" aria-label="Unsubmitted signup observations"><header><div><span className="signup-tracker-eyebrow">Before submission</span><h3>Unsubmitted visitors · identity unknown</h3></div><span>{draftRows.length} observed drafts</span></header><p>These are genuinely interacted-with drafts, not identified customers. Blank and invalid fields below are observations—not guesses about why somebody stopped. Unsubmitted records expire after 24 hours.</p>
      {data.formObservations.coverage?.unavailable ? <p className="signup-tracker-error">Field observation coverage is unavailable; do not assume there are no stuck visitors.</p> : null}
      {data.formObservations.coverage?.hasMore ? <p>Only the {data.formObservations.coverage.limit} most recently updated records are shown. Additional draft coverage is not displayed.</p> : null}
      {draftRows.map(row => <article key={row.id} className={'signup-form-observation-card ' + (row.stalled ? 'is-stalled' : '')}><div><strong>Unknown visitor · {row.id.slice(-8)}</strong><span>{row.currentStepLabel} · observation {row.observedAgeMs == null ? 'age unknown' : `${Math.floor(row.observedAgeMs / 60000)} min old`}</span></div><p>{row.blockerLabels.length ? `Observed required issues: ${row.blockerLabels.join('; ')}` : 'No required field failure was observed on the current step. Unknown/untouched fields are not passes.'}</p><button type="button" aria-expanded={draftExpanded === row.id} onClick={() => setDraftExpanded(draftExpanded === row.id ? '' : row.id)}>{draftExpanded === row.id ? 'Hide field status' : 'View field status'}</button>{draftExpanded === row.id ? <FormObservationReport observation={row} /> : null}</article>)}
      {!draftRows.length && !data.formObservations.coverage?.unavailable ? <p>No engaged unsubmitted drafts match this view. Unobserved visitors are not counted.</p> : null}
    </section> : null}
    {editor ? <section ref={editorSection} tabIndex={-1} className="signup-tracker-editor" aria-label="Edit saved business information"><header><div><span className="signup-tracker-eyebrow">Saved business information</span><h3>{editor.businessName}</h3></div><button type="button" disabled={saving} onClick={() => setEditor(null)}>Close editor</button></header><p className="signup-tracker-editor-notice"><strong>Admin record only — not published to the receptionist.</strong> These changes update this signup’s saved business information. Phone/email, identity-linked business name, routing and billing are protected. Publishing new receptionist answers is a separate reviewed action.</p><form onSubmit={save}><fieldset disabled={saving}>{Object.entries(FIELDS).map(([key, [label, limit]]) => <label key={key}>{label}{['serviceSummary', 'specializationNotes'].includes(key) ? <textarea maxLength={limit} rows={key === 'specializationNotes' ? 4 : 3} value={editor.details[key]} onChange={e => setEditor(current => ({ ...current, details: { ...current.details, [key]: e.target.value } }))} /> : <input type={key === 'businessWebsite' ? 'url' : 'text'} maxLength={limit} value={editor.details[key]} onChange={e => setEditor(current => ({ ...current, details: { ...current.details, [key]: e.target.value } }))} />}</label>)}</fieldset>{saveError ? <p role="alert" className="signup-tracker-error">{saveError}</p> : null}<div className="signup-tracker-editor-actions"><button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save business information'}</button><button type="button" disabled={saving} onClick={() => { const fresh = data?.rows.find(row => row.attemptId === editor.attemptId); if (fresh) openEditor(fresh); }}>Discard draft and load last checked info</button></div></form></section> : null}
    <footer className="signup-tracker-footer">Checks once a minute while this page is visible. Background alerts do not require this page to stay open. No call, text, payment or provisioning action runs from this tracker.</footer>
  </section>;
}
