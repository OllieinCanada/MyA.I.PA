import React, { useEffect, useRef, useState } from 'react';
import './NotificationDraftsPanel.css';

export default function NotificationDraftsPanel({ api }) {
  const [data, setData] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [reviewed, setReviewed] = useState({});
  const inFlight = useRef(false);
  const load = async () => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setReviewed({});
    try { setData(await api('/api/admin/notification-drafts')); setError(''); }
    catch (_) { setData(null); setError('Drafts could not be loaded. Reload before taking any action.'); }
    finally { inFlight.current = false; setBusy(false); }
  };
  // This view never polls or automatically submits a mutation.
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const change = async (draft, action) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(''); setReviewed({});
    try {
      await api(`/api/admin/notification-drafts/${draft.id}/${action}`, { method: 'POST',
        headers: { 'X-MyAIPA-Notification-Review': '1' },
        body: { expectedRevision: draft.revision, expectedHash: draft.contextHash }, timeoutMs: 30000 });
      setData(null);
    } catch (_) {
      // A timeout is not proof of a failed send. Reload, never resend blindly.
      setData(null); setError('The action could not be confirmed. Reload to inspect its saved status. Do not resend an uncertain text.');
    } finally { inFlight.current = false; setBusy(false); }
    // Read back after the write; no automatic retry of the action.
    if (!inFlight.current) {
      inFlight.current = true;
      try { setData(await api('/api/admin/notification-drafts')); } catch (_) { setData(null); }
      finally { inFlight.current = false; }
    }
  };
  return <section className="notification-drafts" aria-label="Text approval queue">
    <header><div><h1>Text approvals</h1><p>Calls prepare drafts. Review each recipient and the complete text before approving.</p></div>
      <button type="button" disabled={busy} onClick={load}>Reload drafts</button></header>
    <p>Approval is your decision to send this exact text. It does not prove the caller’s latest spoken consent. Cancellation works only before send admission; a submitted text cannot be recalled.</p>
    {data && !data.dispatchEnabled && <p role="status">Live sending is disabled. You can review, approve or cancel drafts; no texts will be sent.</p>}
    {error && <p role="alert">{error}</p>}
    {busy && <p role="status">Updating…</p>}
    {data?.drafts?.length === 0 && <p>No current drafts await review.</p>}
    {data?.drafts?.map(draft => <article key={draft.id}>
      <h2>{draft.leg === 'owner' ? 'Team text' : 'Caller text'} · {draft.state}</h2>
      <dl><dt>To</dt><dd>{draft.to}</dd><dt>From</dt><dd>{draft.from}</dd><dt>Call</dt><dd>{draft.callId}</dd></dl>
      <pre aria-label="Complete message text">{draft.body}</pre>
      <p>Version {draft.revision} · Review before {new Date(draft.expiresAt).toLocaleString()}</p>
      {draft.result && <p>Provider result: {draft.result.status}. {draft.result.sent ? 'Accepted; delivery is not confirmed here.' : 'Not confirmed as accepted. Do not automatically retry.'}</p>}
      {['claimed', 'held'].includes(draft.state) && <p>Submission is admitted or uncertain. It is held against retries; inspect provider evidence before any recovery.</p>}
      {!draft.expired && ['pending', 'approved'].includes(draft.state) && <>
        <label><input type="checkbox" disabled={busy} checked={reviewed[draft.id] === draft.contextHash}
          onChange={event => setReviewed({ ...reviewed, [draft.id]: event.target.checked ? draft.contextHash : '' })} /> I have reviewed the recipient and complete text.</label>
        <div className="notification-draft-actions">
          {draft.state === 'pending' && <button type="button" disabled={busy || reviewed[draft.id] !== draft.contextHash} onClick={() => change(draft, 'approve')}>Approve this text</button>}
          {draft.state === 'approved' && <button type="button" disabled={busy || !data.dispatchEnabled || reviewed[draft.id] !== draft.contextHash} onClick={() => change(draft, 'send')}>Send this approved text</button>}
          <button type="button" disabled={busy} onClick={() => change(draft, 'cancel')}>Cancel this draft</button>
        </div>
      </>}
    </article>)}
  </section>;
}
