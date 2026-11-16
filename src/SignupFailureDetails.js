import React from 'react';
import './SignupFailureDetails.css';
const stamp = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('en-CA', { timeZone:'America/Toronto' }) : 'No timestamp recorded';
export default function SignupFailureDetails({evidence, busy, onRefresh, stale=false}) {
  const e = evidence?.version === 1 && evidence.readOnly === true ? evidence : null;
  return <section className="signup-failure-details" aria-label="Number purchase failure details">
    <h6>Failure details</h6>
    <dl><div><dt>Provider</dt><dd>{e?.provider || 'Not established'}</dd></div>
      <div><dt>Recorded error</dt><dd>{e?.recordedError || 'Not recorded'}{e?.httpStatus ? ` · HTTP ${e.httpStatus}` : ''}</dd></div>
      <div><dt>Saved receipt</dt><dd>{e?.receiptStatus || 'Unknown'}</dd></div></dl>
    <p>{e?.explanation || 'Read the saved setup evidence. Missing information is not a successful check.'}</p>
    <div className="purchase-outcome" role="note"><strong>{e?.outcomeLabel || 'Purchase outcome unconfirmed'}</strong>
      <p>A failed request does not prove that no number was purchased.</p></div>
    <h6>Linked resources</h6><dl><div><dt>Phone number</dt><dd>{e?.number || 'Not verified'}</dd></div>
      <div><dt>Assistant</dt><dd>{e?.assistant || 'Not verified'}</dd></div></dl>
    <h6>Evidence</h6><p>{e?.source || 'Receipt evidence not read'} · {stamp(e?.evidenceAt)}</p>
    <p className="purchase-proof-limit">Live provider check: not performed{stale ? ' · Last-known evidence; refresh failed.' : ''}</p>
    <div className="purchase-next-step"><h6>Recommended next step</h6><p>{e?.nextAction || 'Verify the existing purchase before any retry.'}</p>
      <button type="button" onClick={onRefresh} disabled={busy}>{busy ? 'Reading saved receipts…' : 'Refresh saved receipts'}</button>
      <button type="button" disabled>Resume setup unavailable</button>
      <small>Read-only saved evidence. No number is bought, setup retried or message sent. Live provider verification and recovery approval are still required.</small></div>
  </section>;
}
