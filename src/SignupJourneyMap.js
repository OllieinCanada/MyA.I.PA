import React from 'react';
import { buildJourney } from './signupJourneyModel';
import './SignupJourneyMap.css';

const labels = { recorded: 'Recorded', observed: 'Browser checked', verified: 'Verified', pending: 'Pending', unknown: 'Not observed', blocked: 'Needs attention', optional: 'Not required', present: 'Not validated' };
const mark = state => ['observed', 'verified', 'recorded'].includes(state) ? '✓' : state === 'blocked' ? '!' : '−';

export default function SignupJourneyMap({ row, onSelect, selectedId }) {
  const nodes = buildJourney(row);
  return <section className="signup-journey" aria-label={`Signup journey for ${row.businessName}`}>
    <header className="signup-journey-heading"><div><span className="signup-tracker-eyebrow">Your signup, step by step</span><h4>From first click to trial.</h4></div><span className="signup-journey-readonly">Read-only journey</span></header>
    <div className="signup-journey-legend"><span><i className="is-observed">✓</i> Browser checked</span><span><i className="is-verified">✓</i> Backend verified</span><span><i className="is-blocked">!</i> Needs attention</span><span><i>−</i> Not observed / pending</span></div>
    <ol className="signup-journey-map">
      {nodes.map((node, index) => <li key={node.id} className={`journey-node journey-${node.id} is-${node.state}`}>
        <div className="journey-node-heading"><span className="journey-number">{String(index + 1).padStart(2, '0')}</span><span className="journey-state"><i aria-hidden="true">{mark(node.state)}</i>{labels[node.state]}</span></div>
        <h5>{onSelect ? <button className="journey-inspect" type="button" aria-label={`Inspect ${node.title}`} aria-pressed={selectedId === node.id || (node.id === 'trial' && ['number','assistant','texts','activation'].includes(selectedId))} onClick={() => onSelect(node.id)}>{node.title}</button> : node.title}</h5>
        {node.fields ? <ul className="journey-fields">{node.fields.map(field => <li key={field.id} className={`is-${field.state}`}><span className="journey-checkbox" aria-hidden="true">{mark(field.state)}</span><span><strong>{field.label}</strong><small>{field.detail}</small></span></li>)}</ul> : null}
        {node.note ? <p className="journey-node-note">{node.note}</p> : null}
        <small className="journey-source">{node.source}</small>
        <span className="journey-arrow" aria-hidden="true">→</span>
      </li>)}
    </ol>
    <p className="signup-journey-footnote">Checkboxes show recorded evidence, not guesses. Missing or expired browser observations stay unknown. These steps do not start a trial, retry signup, send texts or change the receptionist.</p>
  </section>;
}
