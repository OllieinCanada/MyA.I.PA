import React from 'react';
import './SavedEvidenceStatus.css';
const messages = {
  auth: 'Sign-in is required. Automatic reads are paused; reload this page to sign in again.',
  rate_limit: 'The server is limiting reads. Waiting before checking again.',
  server: 'The server could not complete the read. Safe reads will retry automatically.',
  timeout: 'The read timed out. Safe reads will retry automatically.',
  network: 'The connection failed. Safe reads will retry automatically.',
  invalid: 'The server response was not usable. Safe reads will retry automatically.',
  offline: 'The connection is returning. Saved information stays stale until a read succeeds.',
};
export default function SavedEvidenceStatus({ state, label = 'Signup updates', intervalMs = 5000, historical = false }) {
  const failed = Boolean(state.reason) || ['retrying', 'auth_required', 'offline'].includes(state.phase);
  return <div className={'saved-evidence-status is-' + state.phase} role={failed ? 'alert' : 'status'}>
    <strong>{failed ? `${label} are unavailable.` : state.phase === 'connected' ? `${label}: connected` : state.phase === 'paused' ? `${label}: paused` : `${label}: checking…`}</strong>
    <span>{state.phase === 'offline' ? 'You are offline. Reads resume when the connection returns.'
      : failed ? messages[state.reason?.code] || messages.network
      : historical ? 'Historical page. Automatic refresh is paused; refresh latest to return.'
      : `Saved progress is checked every ${intervalMs / 1000} seconds while this tab is visible. Not an instant event stream.`}</span>
    {state.reason?.status ? <span>HTTP {state.reason.status}.</span> : null}
    <small>Last successful read: {state.lastSuccessAt ? new Date(state.lastSuccessAt).toLocaleTimeString('en-CA', { timeZone: 'America/Toronto', hour: 'numeric', minute: '2-digit', second: '2-digit' }) + ' Toronto' : 'Not yet loaded'}.
      {failed ? ' Displayed information is last-known—not a fresh check.' : ''} No setup action is retried.</small>
  </div>;
}
