import React, { useCallback, useEffect, useRef, useState } from 'react';
import './ProviderFinancePanel.css';

export const FINANCE_FIELDS = {
  balance: 'Credit balance', spendToday: 'Today’s usage (UTC)', spendMonth: 'Month-to-date usage (UTC)',
  rollingCredits: 'Credits used — rolling 30 days', planPrice: 'Plan price (before tax)',
  monthlyEstimate: 'Monthly cost estimate', nextBillAt: 'Next billing date', budgetMonth: 'Monthly warning budget',
  reserve: 'Reserve warning', reloadThreshold: 'Recorded reload trigger', reloadAmount: 'Recorded reload amount',
};
export function financeValue(item) {
  if (item?.value == null) return 'Not confirmed';
  if (item.kind === 'date') return new Date(item.value).toLocaleDateString('en-CA', { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' });
  if (item.unit === 'credits') return Number(item.value).toLocaleString() + ' credits';
  return (item.currency || 'Currency unknown') + ' ' + Number(item.value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}
const checkedTime = value => value && Number.isFinite(Date.parse(value))
  ? new Date(value).toLocaleString('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }) + ' (Toronto)' : 'Not confirmed';
const localDateTime = () => {
  const date = new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const torontoDay = () => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type).value).join('-');
};
const quality = (item, failed) => !item || item.value == null ? 'Unknown' : failed || item.stale ? 'Outdated / recheck'
  : item.qualityLabel || (item.estimated ? 'Estimated' : item.source === 'dashboard_verified' ? 'Manually checked' : 'Provider reported');

function Metric({ field, item, failed }) {
  return <div className="finance-metric"><dt>{FINANCE_FIELDS[field] || field}</dt><dd>
    <strong>{financeValue(item)}</strong><span className={'finance-badge ' + (failed || item?.stale ? 'is-old' : '')}>{quality(item, failed)}{item?.previousPeriod ? ' · Previous period' : ''}</span>
    {item ? <><small>{item.sourceLabel || (item.source === 'dashboard_verified' ? 'Provider dashboard check' : item.source === 'saved_call_costs' ? 'Imported Vapi calls' : 'Provider API')} · Checked {checkedTime(item.observedAt)}</small>
      {item.periodLabel || item.billingMonth || item.periodStart || item.period ? <small>Period: {item.periodLabel || item.billingMonth || (item.periodStart ? item.periodStart + ' to ' + item.periodEnd + ' (UTC)' : item.period)}</small> : null}
      {item.retrievedAt ? <small>Downloaded {checkedTime(item.retrievedAt)}; this does not reset the source check time.</small> : null}
      {item.savedCalls != null ? <small>Priced: {item.pricedCalls ?? 'unknown'} / {item.savedCalls} saved calls. Imported calls may be incomplete.</small> : null}</> : null}
  </dd></div>;
}

export default function ProviderFinancePanel({ apiBase, phoneBilling }) {
  const [data, setData] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false), [saving, setSaving] = useState(false), [saved, setSaved] = useState('');
  const [form, setForm] = useState({ provider: 'vapi', field: 'balance', value: '', currency: 'USD', observedAt: localDateTime(), billingMonth: torontoDay().slice(0, 7) });
  const [history, setHistory] = useState(null), [historyError, setHistoryError] = useState(''), [historyBusy, setHistoryBusy] = useState(false);
  const [horizon, setHorizon] = useState(30);
  const request = useRef(null), saveRequest = useRef(null), historyRequest = useRef(null), editor = useRef(null);
  const load = useCallback(async () => {
    if (request.current || document.visibilityState === 'hidden') return;
    const controller = new AbortController(); request.current = controller; setBusy(true);
    const timeout = setTimeout(() => controller.abort(), 6000);
    try {
      const response = await fetch(apiBase + '/api/admin/finances', { credentials: 'include', signal: controller.signal });
      const body = await response.json();
      if (!response.ok || !body.finances) throw new Error('unavailable');
      if (!controller.signal.aborted) { setData(body.finances); setError(''); }
    } catch (_) {
      if (request.current === controller) setError('Finance updates are unavailable. Any displayed amounts are last-known values, not a new confirmation.');
    } finally { clearTimeout(timeout); if (request.current === controller) { request.current = null; setBusy(false); } }
  }, [apiBase]);
  useEffect(() => {
    load();
    const timer = setInterval(load, 60000);
    const visible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', visible);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', visible); request.current?.abort(); request.current = null;
      saveRequest.current?.abort(); saveRequest.current = null; historyRequest.current?.abort(); historyRequest.current = null; };
  }, [load]);
  useEffect(() => {
    if (!data?.refreshing) return undefined;
    const timer = setTimeout(load, 5000);
    return () => clearTimeout(timer);
  }, [data, load]);
  function edit(provider = form.provider, field = form.field) {
    const allowed = data?.manualFields?.[provider] || [];
    setForm(previous => ({ ...previous, provider, field: allowed.includes(field) ? field : allowed[0], value: '', observedAt: localDateTime() }));
    setEditing(true); setSaved('');
    setTimeout(() => editor.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' }), 0);
  }
  async function readHistory(provider) {
    if (historyRequest.current) return;
    const controller = new AbortController(); historyRequest.current = controller;
    const timeout = setTimeout(() => controller.abort(), 6000);
    setHistoryBusy(true); setHistoryError(''); setHistory({ provider, rows: [] });
    try {
      const response = await fetch(apiBase + '/api/admin/finances/history?provider=' + encodeURIComponent(provider), { credentials: 'include', signal: controller.signal });
      const body = await response.json();
      if (!response.ok || !Array.isArray(body.history)) throw new Error('unavailable');
      if (!controller.signal.aborted) setHistory({ provider, rows: body.history });
    } catch (_) { if (historyRequest.current === controller) setHistoryError('History could not be confirmed. No missing record is assumed to be zero.'); }
    finally { clearTimeout(timeout); if (historyRequest.current === controller) { historyRequest.current = null; setHistoryBusy(false); } }
  }
  async function save(event) {
    event.preventDefault(); if (saveRequest.current) return;
    setSaving(true); setSaved('');
    const controller = new AbortController(); saveRequest.current = controller;
    const timeout = setTimeout(() => controller.abort(), 6000);
    try {
      const body = { provider: form.provider, field: form.field, observedAt: new Date(form.observedAt).toISOString(),
        value: form.field === 'nextBillAt' ? form.value + 'T12:00:00Z' : Number(form.value) };
      if (form.field !== 'nextBillAt') body.currency = form.currency;
      if (form.field === 'monthlyEstimate') body.billingMonth = form.billingMonth;
      const response = await fetch(apiBase + '/api/admin/finances/verified', { method: 'POST', credentials: 'include', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'X-MyAIPA-Finance': '1' }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok || !result.entry || result.entry.provider !== body.provider || result.entry.field !== body.field) throw new Error('not_saved');
      if (controller.signal.aborted || !saveRequest.current) return;
      setSaved('Saved ' + FINANCE_FIELDS[result.entry.field] + ': ' + financeValue(result.entry) + (result.entry.billingMonth ? ' for ' + result.entry.billingMonth : '') +
        '. Actually checked ' + checkedTime(result.entry.observedAt) + '. Previous values remain in history. No provider settings or payments were changed.');
      setEditing(false); setHistory(null); load();
    } catch (_) { if (saveRequest.current) setSaved('Save not confirmed. Refresh and check the recorded fact and history before submitting again.'); }
    finally { clearTimeout(timeout); if (saveRequest.current === controller) { saveRequest.current = null; setSaving(false); } }
  }
  const providers = data?.providers || [], overview = data?.overview;
  const actions = overview?.actions || [];
  const knownPlans = !error ? overview?.planTotals || [] : [];
  const today = torontoDay();
  const rentalDates = (phoneBilling?.records || []).filter(row => row.nextEstimatedRenewalAt && Number.isFinite(Date.parse(row.nextEstimatedRenewalAt))).map(row => ({
    id: 'rental:' + (row.sid || row.phoneNumber), name: 'Twilio number ' + (row.phoneNumber || ''), at: row.nextEstimatedRenewalAt,
    days: Math.round((Date.parse(row.nextEstimatedRenewalAt.slice(0, 10)) - Date.parse(today)) / 86400000), estimated: true, customer: row.customer,
  }));
  const dates = [...(overview?.renewals || []), ...rentalDates].filter(row => row.days >= 0 && row.days <= horizon).sort((a, b) => a.at.localeCompare(b.at));
  const fields = data?.manualFields?.[form.provider] || [];
  const preview = { value: form.value === '' ? null : form.field === 'nextBillAt' ? form.value + 'T12:00:00Z' : Number(form.value), currency: form.currency, kind: form.field === 'nextBillAt' ? 'date' : undefined };
  return <section className="finance-panel" aria-label="Provider finance meter">
    <div className="finance-heading"><div><span className="finance-eyebrow">Funding & costs</span><h2>Your finances, at a glance</h2>
      <p>What needs attention, what is funded, and what is coming next.</p></div>
      <button type="button" disabled={busy} onClick={load}>{busy ? 'Checking…' : 'Refresh finances'}</button></div>
    <p className="finance-note">Page checks every minute while visible; provider reads are cached for 5 minutes. Read-only provider access. No automatic purchases, billing changes or call shut-offs.</p>
    {!data && !error ? <p role="status">Loading financial information…</p> : null}
    {error ? <p className="finance-warning" role="alert">{error}</p> : null}
    {data?.persistenceWarning ? <p className="finance-warning" role="alert">{data.persistenceWarning}</p> : null}
    {data?.refreshing ? <p role="status">Refreshing provider snapshots; missing amounts remain unknown.</p> : null}
    {data ? <>
      <div className="finance-summary" aria-label="Finance overview">
        <article><span className="finance-eyebrow">Needs attention</span><strong>{error || !overview ? 'Check data' : actions.length + (actions.length === 1 ? ' item' : ' items')}</strong><p>{error ? 'Updates failed. Recheck before relying on these figures.' : actions.length ? 'See the action list below. Unknown does not mean unpaid.' : overview ? 'No warning in the available data—not a billing guarantee.' : 'The updated overview is not available yet.'}</p></article>
        <article><span className="finance-eyebrow">Available funding</span>{['twilio', 'vapi'].map(id => { const provider = providers.find(p => p.id === id), item = provider?.metrics?.balance; return <div className="finance-funding" key={id}><b>{provider?.name || id}</b><strong>{!error && item && !item.stale ? financeValue(item) : 'Not confirmed'}</strong><small>{quality(item, Boolean(error))}</small></div>; })}<p>Separate wallets. Top-ups are funding, not another usage expense.</p></article>
        <article><span className="finance-eyebrow">Known monthly plans</span><strong>{knownPlans.length ? knownPlans.map(item => <span className="finance-plan-total" key={item.currency}>{financeValue(item)}</span>) : 'Not confirmed'}</strong><p>{overview?.planCoverage || 'Coverage not confirmed'}. Make + Render only; before tax. Separate currency subtotals—not total operating cost.</p></article>
        <article><span className="finance-eyebrow">Next 7 days</span><strong>{error || !overview ? 'Recheck dates' : [...(overview.renewals || []), ...rentalDates].filter(row => row.days >= 0 && row.days <= 7).length + ' dated events'}</strong><p>Includes estimated number renewals. Dates are not proof that a charge or payment occurred.</p></article>
      </div>
      <section className="finance-actions" aria-label="Finance actions"><h3>What needs attention</h3>
        {actions.length ? <ul>{actions.map(action => <li key={action.id}><div><b>{action.title}</b><p>{action.detail}</p></div>{action.provider && (data.manualFields?.[action.provider] || []).includes(action.field) ? <button type="button" disabled={saving} onClick={() => edit(action.provider, action.field)}>Record a check</button> : null}</li>)}</ul> : <p>{overview ? 'No listed warnings. Missing provider data must still be checked.' : 'Refresh after the updated backend is available; no health status is assumed.'}</p>}
      </section>
      <section className="finance-timeline" aria-label="Upcoming billing timeline"><div className="finance-heading"><h3>Upcoming dates</h3><label>Show next <select aria-label="Billing timeline range" value={horizon} onChange={e => setHorizon(Number(e.target.value))}><option value={7}>7 days</option><option value={30}>30 days</option></select></label></div>
        {dates.length ? <ol>{dates.map(row => <li key={row.id}><div><b>{financeValue({ kind: 'date', value: row.at })}</b><span>{row.days === 0 ? 'Today' : 'In ' + row.days + (row.days === 1 ? ' day' : ' days')}</span></div><div><b>{row.name}</b>{row.customer ? <span>{row.customer}</span> : null}<span className={'finance-badge ' + (row.metric?.stale || error ? 'is-old' : '')}>{row.estimated ? 'Estimated renewal · amount unknown' : quality(row.metric, Boolean(error)) + ' · billing date'}</span>{!row.estimated ? <small>Source checked {checkedTime(row.metric?.observedAt)}. Charge amount not confirmed.</small> : <small>Based on the number’s acquisition date—not a confirmed invoice.</small>}</div></li>)}</ol> : <p>No recorded dates in this range. This does not mean there are no upcoming charges.</p>}
        <p className="finance-note">Calendar dates are displayed as recorded; countdowns and source check times use Toronto time. A past date is not proof of a failed payment.</p>
      </section>
    </> : null}
    <div className="finance-providers">{providers.map(provider => {
      const main = { twilio: ['balance', 'spendMonth'], vapi: ['balance', 'spendMonth'], make: ['planPrice', 'rollingCredits'], render: ['monthlyEstimate'] }[provider.id] || [];
      return <article className="finance-provider" key={provider.id} aria-label={provider.name + ' finances'}>
        <h3>{provider.name}</h3><p className="finance-account">{provider.accountLabel || 'Account identity not confirmed'}</p>
        <dl>{main.map(field => <Metric key={field} field={field} item={provider.metrics[field]} failed={Boolean(error)} />)}</dl>
        <details><summary>Sources, dates & warning settings</summary><dl>{Object.entries(provider.metrics).filter(([field]) => !main.includes(field)).map(([field, item]) => <Metric key={field} field={field} item={item} failed={Boolean(error)} />)}</dl>
          <ul className="finance-warnings">{provider.warnings.map(text => <li key={text}>{text}</li>)}</ul></details>
        <button type="button" className="finance-history-button" disabled={historyBusy} onClick={() => readHistory(provider.id)}>View {provider.name} history</button>
      </article>;
    })}</div>
    {history ? <section className="finance-history" aria-label="Finance history"><div className="finance-heading"><h3>{providers.find(p => p.id === history.provider)?.name} history</h3><button type="button" onClick={() => { historyRequest.current?.abort(); historyRequest.current = null; setHistoryBusy(false); setHistory(null); }}>Close history</button></div>
      <p className="finance-note">Latest 50 records for this provider connection only. Snapshots are sampled at most once per UTC hour while this page is used—not a continuous audit. Manual corrections preserve earlier values.</p>
      {historyBusy ? <p role="status">Loading history…</p> : historyError ? <p role="alert">{historyError}</p> : history.rows.length ? <ol>{history.rows.map((row, index) => <li key={index}><b>{row.type === 'verification' ? 'Dashboard check / correction' : row.type === 'baseline' ? 'Imported baseline' : 'Provider snapshot'} · {checkedTime(row.recordedAt)}</b>
        {row.warnings?.length ? <p className="finance-warning">Snapshot includes failed reads; displayed figures were last-known values. {row.warnings.join(' ')}</p> : null}
        {row.field ? <><p>{FINANCE_FIELDS[row.field]}: {financeValue(row.value)}{row.value?.billingMonth ? ' · ' + row.value.billingMonth : ''}. Source checked {checkedTime(row.value?.observedAt)}.</p>{row.previous ? <p>Previous: {financeValue(row.previous)}. Checked {checkedTime(row.previous.observedAt)}.</p> : null}</> : <dl>{Object.entries(row.metrics || {}).map(([field, item]) => <Metric key={field} field={field} item={item} failed={Boolean(row.warnings?.length)} />)}</dl>}
        {row.note ? <p>{row.note}</p> : null}</li>)}</ol> : <p>No history recorded yet. This is not proof of zero spending.</p>}
    </section> : null}
    <p className="finance-note">Usage and plan estimates stay separate. No combined total until bills and overlapping charges are reconciled. Currencies are never converted or mixed. Usage days are UTC; Make’s rolling credits follow its organization timezone. Estimates are not Stripe cash collected.</p>
    <button type="button" disabled={!data || saving} aria-expanded={editing} onClick={() => editing ? setEditing(false) : edit()}>Record a dashboard-verified fact</button>
    {editing ? <form ref={editor} className="finance-editor" onSubmit={save}>
      <p>Check the correct provider account first. This only records what you saw; it never changes auto-reload or pays a bill. Provider-reported billing dates take precedence over manual dates.</p>
      <label>Provider<select aria-label="Provider" value={form.provider} onChange={e => setForm({ ...form, provider: e.target.value, field: data.manualFields[e.target.value][0], value: '' })}>
        {providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label>Fact<select aria-label="Fact" value={form.field} onChange={e => setForm({ ...form, field: e.target.value, value: '' })}>{fields.map(f => <option key={f} value={f}>{FINANCE_FIELDS[f]}</option>)}</select></label>
      <label>{form.field === 'nextBillAt' ? 'Billing date' : 'Amount'}<input aria-label={form.field === 'nextBillAt' ? 'Billing date' : 'Amount'} required type={form.field === 'nextBillAt' ? 'date' : 'number'} min={form.field === 'nextBillAt' ? undefined : '0'} max={form.field === 'nextBillAt' ? undefined : '1000000'} step="any" value={form.value} onChange={e => setForm({ ...form, value: e.target.value })} /></label>
      {form.field !== 'nextBillAt' ? <label>Currency<select aria-label="Currency" value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })}>{['USD', 'CAD', 'EUR', 'GBP'].map(c => <option key={c}>{c}</option>)}</select></label> : null}
      {form.field === 'monthlyEstimate' ? <label>Estimate covers month<input aria-label="Estimate covers month" type="month" required value={form.billingMonth} onChange={e => setForm({ ...form, billingMonth: e.target.value })} /></label> : null}
      <label>Actually checked at (your local time)<input aria-label="Actually checked at (your local time)" required type="datetime-local" value={form.observedAt} onChange={e => setForm({ ...form, observedAt: e.target.value })} /></label>
      <button type="button" onClick={() => setForm({ ...form, observedAt: localDateTime() })}>Checked just now</button>
      <p className="finance-save-preview" aria-live="polite">You are recording: <b>{providers.find(p => p.id === form.provider)?.name} · {FINANCE_FIELDS[form.field]} · {financeValue(preview)}{form.field === 'monthlyEstimate' ? ' for ' + form.billingMonth : ''}</b><br />Actually checked {checkedTime(form.observedAt)}. Monthly estimates need a new check when their month ends.</p>
      <button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save verified fact'}</button>
    </form> : null}
    {saved ? <p role="status" className="finance-save-result">{saved}</p> : null}
  </section>;
}
