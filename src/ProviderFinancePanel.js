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
  if (item.kind === 'date') return new Date(item.value).toLocaleDateString(undefined, { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' });
  if (item.unit === 'credits') return `${Number(item.value).toLocaleString()} credits`;
  return `${item.currency} ${Number(item.value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}
const localDateTime = () => {
  const date = new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

export default function ProviderFinancePanel({ apiBase }) {
  const [data, setData] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false), [saving, setSaving] = useState(false), [saved, setSaved] = useState('');
  const [form, setForm] = useState({ provider: 'vapi', field: 'balance', value: '', currency: 'USD', observedAt: localDateTime() });
  const request = useRef(null), saveRequest = useRef(null);
  const load = useCallback(async () => {
    if (request.current || document.visibilityState === 'hidden') return;
    const controller = new AbortController(); request.current = controller; setBusy(true);
    const timeout = setTimeout(() => controller.abort(), 6000);
    try {
      const response = await fetch(`${apiBase}/api/admin/finances`, { credentials: 'include', signal: controller.signal });
      const body = await response.json();
      if (!response.ok || !body.finances) throw new Error('unavailable');
      if (!controller.signal.aborted) { setData(body.finances); setError(''); }
    } catch (_) {
      if (!controller.signal.aborted || request.current) setError('Finance updates are unavailable. Any displayed amounts are last-known values, not a new confirmation.');
    } finally { clearTimeout(timeout); if (request.current === controller) { request.current = null; setBusy(false); } }
  }, [apiBase]);
  useEffect(() => {
    load();
    const timer = setInterval(load, 60000);
    const visible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', visible);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', visible); request.current?.abort(); request.current = null; saveRequest.current?.abort(); };
  }, [load]);
  useEffect(() => {
    if (!data?.refreshing) return undefined;
    const timer = setTimeout(load, 5000);
    return () => clearTimeout(timer);
  }, [data, load]);
  async function save(event) {
    event.preventDefault(); if (saveRequest.current) return;
    setSaving(true); setSaved('');
    const controller = new AbortController(); saveRequest.current = controller;
    const timeout = setTimeout(() => controller.abort(), 6000);
    try {
      const body = { ...form, observedAt: new Date(form.observedAt).toISOString(),
        value: form.field === 'nextBillAt' ? `${form.value}T12:00:00Z` : Number(form.value) };
      if (form.field === 'nextBillAt') delete body.currency;
      const response = await fetch(`${apiBase}/api/admin/finances/verified`, { method: 'POST', credentials: 'include', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'X-MyAIPA-Finance': '1' }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error('not_saved');
      if (controller.signal.aborted || !saveRequest.current) return;
      setSaved('Verified fact saved. No provider settings or payments were changed.'); setEditing(false); load();
    } catch (_) { if (saveRequest.current) setSaved('Save not confirmed. Refresh and check the recorded fact before submitting again.'); }
    finally { clearTimeout(timeout); if (saveRequest.current === controller) { saveRequest.current = null; setSaving(false); } }
  }
  const fields = data?.manualFields?.[form.provider] || [];
  return <section className="finance-panel" aria-label="Provider finance meter">
    <div className="finance-heading"><div><span className="finance-eyebrow">Funding & costs</span><h2>Your provider finance meter</h2>
      <p>One place to check Twilio, Vapi, Make and Render. Credit top-ups are funding—not another usage expense.</p></div>
      <button type="button" disabled={busy} onClick={load}>{busy ? 'Checking…' : 'Refresh finances'}</button></div>
    <p className="finance-note">Page checks every minute while visible; provider reads are cached for 5 minutes. Read-only provider access. No automatic purchases, billing changes or call shut-offs.</p>
    {!data && !error ? <p role="status">Loading financial information…</p> : null}
    {error ? <p className="finance-warning" role="alert">{error}</p> : null}
    {data?.persistenceWarning ? <p className="finance-warning" role="alert">{data.persistenceWarning}</p> : null}
    {data?.refreshing ? <p role="status">Refreshing provider snapshots; missing amounts remain unknown.</p> : null}
    <div className="finance-providers">{data?.providers?.map(provider => <article className="finance-provider" key={provider.id} aria-label={`${provider.name} finances`}>
      <h3>{provider.name}</h3>
      {!Object.keys(provider.metrics).length ? <p>Not confirmed yet. No amount is assumed to be zero.</p> : null}
      <dl>{Object.entries(provider.metrics).map(([field, item]) => <div className="finance-metric" key={field}>
        <dt>{FINANCE_FIELDS[field] || field}{item.period ? ` · ${item.period}` : ''}</dt>
        <dd><strong>{financeValue(item)}</strong><span className={`finance-badge ${item.stale || error ? 'is-old' : ''}`}>
          {item.source === 'dashboard_verified' ? 'Manually verified' : item.estimated ? 'Estimate from saved calls / plan' : 'Provider reported'}
          {item.stale || error ? ' · Stale / recheck' : ''}{item.previousPeriod ? ' · Previous period' : ''}</span>
          <small>As of: {item.observedAt ? new Date(item.observedAt).toLocaleString() : 'Not confirmed'}</small>
          {item.savedCalls != null ? <small>Priced: {item.pricedCalls ?? 'unknown'} / {item.savedCalls} saved calls. Imported calls may be incomplete.</small> : null}
        </dd></div>)}</dl>
      <ul className="finance-warnings">{provider.warnings.map(text => <li key={text}>{text}</li>)}</ul>
    </article>)}</div>
    <p className="finance-note">No combined total is claimed until all bills and overlapping provider charges are reconciled. Currencies stay separate; no unverified USD/CAD conversion. Usage days are UTC; Make’s rolling credits follow its organization timezone. Estimates below are not Stripe cash collected.</p>
    <button type="button" disabled={!data || saving} aria-expanded={editing} onClick={() => { setEditing(!editing); setSaved(''); }}>Record a dashboard-verified fact</button>
    {editing ? <form className="finance-editor" onSubmit={save}>
      <p>For values the provider API cannot confirm. Check the correct account first. These entries only update this admin page; they never change auto-reload or pay a bill.</p>
      <label>Provider<select aria-label="Provider" value={form.provider} onChange={e => setForm({ ...form, provider: e.target.value, field: data.manualFields[e.target.value][0], value: '' })}>
        {data.providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label>Fact<select aria-label="Fact" value={form.field} onChange={e => setForm({ ...form, field: e.target.value, value: '' })}>{fields.map(f => <option key={f} value={f}>{FINANCE_FIELDS[f]}</option>)}</select></label>
      <label>{form.field === 'nextBillAt' ? 'Billing date' : 'Amount'}<input aria-label={form.field === 'nextBillAt' ? 'Billing date' : 'Amount'} required type={form.field === 'nextBillAt' ? 'date' : 'number'} min={form.field === 'nextBillAt' ? undefined : '0'} max={form.field === 'nextBillAt' ? undefined : '1000000'} step="any" value={form.value} onChange={e => setForm({ ...form, value: e.target.value })} /></label>
      {form.field !== 'nextBillAt' ? <label>Currency<select aria-label="Currency" value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })}>{['USD', 'CAD', 'EUR', 'GBP'].map(c => <option key={c}>{c}</option>)}</select></label> : null}
      <label>Actually checked at (your local time)<input aria-label="Actually checked at (your local time)" required type="datetime-local" value={form.observedAt} onChange={e => setForm({ ...form, observedAt: e.target.value })} /></label>
      <button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save verified fact'}</button>
    </form> : null}
    {saved ? <p role="status">{saved}</p> : null}
  </section>;
}
