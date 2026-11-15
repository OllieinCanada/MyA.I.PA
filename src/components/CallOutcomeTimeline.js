import React from 'react';
import {buildCallOutcomeTimeline} from '../features/calls/callOutcomeTimeline';
import './CallOutcomeTimeline.css';
export default function CallOutcomeTimeline({call}) {
  return <section className="call-outcome-evidence" aria-label="Call outcome evidence">
    <h3>What actually completed</h3>
    <p>Evidence checkpoints—not assumed event times. A finished call does not prove a text was delivered.</p>
    <ol>{buildCallOutcomeTimeline(call).map(row=><li key={row.id} data-state={row.state}>
      <div><strong>{row.title}</strong><span>{row.state.replace(/_/g,' ')}</span></div><p>{row.detail}</p>
      {row.at?<time dateTime={row.at}>{new Date(row.at).toLocaleString()}</time>:null}
    </li>)}</ol>
    <small>Caller approval, correct recipients and exactly-once delivery still require their own evidence. This view cannot send or retry anything.</small>
  </section>;
}
