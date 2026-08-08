import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  deanAllisonApprovedKnowledge,
  deanAllisonBlockedBehaviours,
  deanAllisonComplaintCategories,
  deanAllisonDemoOffice,
  deanAllisonDemoScenarios,
} from "./deanAllisonDemoData";
import { buildConstituentComplaint, getDeanDemoProgress } from "./deanAllisonDemoLogic";
import "./FirstClassRentalsDemo.css";
import "./DeanAllisonDemo.css";

function Icon({ name, size = 22 }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true };
  if (name === "phone") return <svg {...common}><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.4 19.4 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.2-1.2a2 2 0 0 1 2.1-.5c.9.3 1.9.6 2.9.7a2 2 0 0 1 1.7 2Z" /></svg>;
  if (name === "shield") return <svg {...common}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /><path d="m9 12 2 2 4-4" /></svg>;
  if (name === "building") return <svg {...common}><path d="M3 21h18M5 21V8l7-5 7 5v13M9 10h1M14 10h1M9 14h1M14 14h1M10 21v-3h4v3" /></svg>;
  if (name === "message") return <svg {...common}><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" /></svg>;
  if (name === "document") return <svg {...common}><path d="M6 2h9l4 4v16H6z" /><path d="M14 2v5h5M9 12h6M9 16h6" /></svg>;
  if (name === "check") return <svg {...common}><path d="m5 12 4 4L19 6" /></svg>;
  if (name === "play") return <svg {...common}><path d="m8 5 11 7-11 7z" /></svg>;
  if (name === "arrow") return <svg {...common}><path d="M5 12h14M13 6l6 6-6 6" /></svg>;
  return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 8v4M12 16h.01" /></svg>;
}

function Brand() {
  return <a className="fcr-brand" href="#/" aria-label="My AI PA homepage"><span className="fcr-brand-mark"><Icon name="phone" size={24} /></span><span><strong>My AI PA</strong><small>Private demonstration studio</small></span></a>;
}

function scrollToSection(event, id) {
  event.preventDefault();
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function DemoPhone({ scenario, visibleLines, running }) {
  const transcriptRef = useRef(null);
  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: "smooth" });
  }, [visibleLines]);

  return (
    <div className="fcr-phone-shell daa-phone-shell">
      <div className="fcr-phone-top"><span>9:41</span><span className="fcr-phone-notch" /><span>5G&nbsp; ▰</span></div>
      <div className="fcr-phone-call"><div className="fcr-avatar"><Icon name="building" size={25} /></div><div><strong>Unofficial constituency demo</strong><small>{running ? "Virtual receptionist active" : "Simulation ready"}</small></div><span className={`fcr-live-dot ${running ? "is-live" : ""}`} /></div>
      <div className="fcr-phone-transcript" ref={transcriptRef} aria-live="polite">
        {visibleLines === 0 ? <div className="fcr-phone-empty"><Icon name="phone" size={30} /><strong>Choose a complaint scenario</strong><span>No real call or message will be sent.</span></div> : scenario.transcript.slice(0, visibleLines).map((line, index) => <div className={`fcr-bubble ${line.speaker}`} key={`${scenario.id}-${index}`}><small>{line.speaker === "assistant" ? "VIRTUAL RECEPTIONIST" : "CALLER"}</small><p>{line.text}</p></div>)}
      </div>
      <div className="fcr-phone-footer"><span /><button type="button" aria-label="Simulated hang-up control"><Icon name="phone" size={20} /></button><span /></div>
    </div>
  );
}

function Summary({ scenario, complete }) {
  return (
    <section className={`fcr-summary-card ${complete ? "is-ready" : ""}`} aria-live="polite">
      <div className="fcr-summary-heading"><div><span className="fcr-kicker">Neutral constituent handoff</span><h3>{complete ? "Private demo summary ready" : "Summary builds during the call"}</h3></div><span className={`fcr-status-pill ${complete ? "ready" : ""}`}>{complete ? "PREVIEW" : "LISTENING"}</span></div>
      <div className="fcr-summary-grid"><div><small>Intent</small><strong>{scenario.intent}</strong></div><div><small>Priority</small><strong>{scenario.priority}</strong></div><div><small>Route</small><strong>{scenario.route}</strong></div></div>
      <p className="fcr-summary-copy">{complete ? scenario.summary : "Only the caller’s observable request is organized. No political profiling or hidden reasoning is shown."}</p>
      <div className="fcr-detail-columns"><div><small>Collected</small><ul>{scenario.collected.map((item) => <li key={item}><Icon name="check" size={14} />{item}</li>)}</ul></div><div><small>Still needed</small>{scenario.missing.length ? <ul className="missing">{scenario.missing.map((item) => <li key={item}>{item}</li>)}</ul> : <p className="fcr-none">Ordinary intake stopped for safety.</p>}</div></div>
      <p className="daa-not-sent"><Icon name="shield" size={15} /> Simulation only — not sent to Dean Allison or his office.</p>
    </section>
  );
}

const emptyForm = {
  name: "",
  city: "",
  callback: "",
  category: deanAllisonComplaintCategories[0],
  department: "",
  description: "",
  requestedAction: "",
  callbackTime: "",
  textConsent: false,
};

function ComplaintBuilder() {
  const [form, setForm] = useState(emptyForm);
  const [result, setResult] = useState(null);
  const update = (event) => {
    const { name, value, type, checked } = event.target;
    setForm((current) => ({ ...current, [name]: type === "checkbox" ? checked : value }));
  };
  const submit = (event) => {
    event.preventDefault();
    setResult(buildConstituentComplaint(form));
  };

  return (
    <section className="fcr-section fcr-complaint-section daa-builder" id="complaint-builder">
      <div className="fcr-shell">
        <div className="fcr-section-heading narrow"><span className="fcr-kicker">Complaint and constituent-intake preview</span><h2>Let the caller explain the concern. Give the office a useful, neutral summary.</h2><p>This simulation minimizes personal information and never promises intervention, a government decision, or a response time.</p></div>
        <div className="fcr-complaint-layout">
          <form className="fcr-complaint-form" onSubmit={submit} noValidate>
            <div className="fcr-form-intro"><Icon name="message" /><div><strong>Prepare a constituent concern</strong><span>Private demonstration · nothing is transmitted</span></div></div>
            <div className="fcr-form-grid">
              <label htmlFor="dean-demo-name"><span>Caller name</span><input id="dean-demo-name" name="name" value={form.name} onChange={update} placeholder="Full name" /></label>
              <label htmlFor="dean-demo-city"><span>City or community</span><input id="dean-demo-city" name="city" value={form.city} onChange={update} placeholder="For example: Grimsby" /></label>
              <label htmlFor="dean-demo-callback"><span>Callback number</span><input id="dean-demo-callback" name="callback" value={form.callback} onChange={update} inputMode="tel" placeholder="905-555-0123" /></label>
              <label htmlFor="dean-demo-category"><span>Concern category</span><select id="dean-demo-category" name="category" value={form.category} onChange={update}>{deanAllisonComplaintCategories.map((category) => <option key={category}>{category}</option>)}</select></label>
              <label htmlFor="dean-demo-department"><span>Federal department or program</span><input id="dean-demo-department" name="department" value={form.department} onChange={update} placeholder="General name only — no account number" /></label>
              <label htmlFor="dean-demo-callback-time"><span>Preferred callback time</span><input id="dean-demo-callback-time" name="callbackTime" value={form.callbackTime} onChange={update} placeholder="For example: weekday afternoon" /></label>
            </div>
            <label className="full" htmlFor="dean-demo-description"><span>What happened?</span><textarea id="dean-demo-description" name="description" value={form.description} onChange={update} rows="4" placeholder="Describe the concern without SIN, passport, tax, immigration-file, banking, or identity-document numbers." /></label>
            <label className="full" htmlFor="dean-demo-action"><span>What would you like the office to consider doing?</span><textarea id="dean-demo-action" name="requestedAction" value={form.requestedAction} onChange={update} rows="3" placeholder="For example: call me and explain whether the office can request a status update." /></label>
            <div className="fcr-checkbox-row"><label><input type="checkbox" name="textConsent" checked={form.textConsent} onChange={update} /><span>I would consent to a confirmation text in an authorized live service</span></label></div>
            <button className="fcr-primary-button" type="submit">Prepare private demo summary <Icon name="arrow" size={17} /></button>
          </form>
          <aside className="fcr-complaint-preview" aria-live="polite">
            <span className="fcr-kicker">What an authorized office could receive</span>
            {!result && <div className="fcr-preview-empty"><Icon name="document" size={32} /><strong>Neutral, concise, privacy-conscious</strong><p>Complete the demonstration form to preview a structured callback request.</p></div>}
            {result && !result.ok && result.safety.level === "emergency_redirect" && <div className="fcr-emergency-result"><Icon name="shield" /><strong>Ordinary intake stops here</strong><p>{result.safety.instruction}</p></div>}
            {result && !result.ok && result.safety.level !== "emergency_redirect" && <div className="fcr-form-errors"><strong>Before preparing the preview:</strong>{result.privacyWarning ? <p>{result.privacyWarning}</p> : <ul>{result.missing.map((item) => <li key={item}>{item}</li>)}</ul>}</div>}
            {result?.ok && <div className="fcr-prepared-request"><div className="fcr-request-top"><span>CONSTITUENT CALLBACK REQUEST</span><strong>{result.safety.label}</strong></div><h3>Unofficial private preview</h3><dl><div><dt>Caller</dt><dd>{result.request.caller}</dd></div><div><dt>Community</dt><dd>{result.request.community}</dd></div><div><dt>Callback</dt><dd>{result.request.callback}</dd></div><div><dt>Category</dt><dd>{result.request.category}</dd></div><div><dt>Program</dt><dd>{result.request.department}</dd></div><div><dt>Concern</dt><dd>{result.request.concern}</dd></div><div><dt>Requested next step</dt><dd>{result.request.requestedAction}</dd></div><div><dt>Preferred time</dt><dd>{result.request.callbackTime}</dd></div></dl><p className="fcr-demo-stamp">{result.request.deliveryStatus}</p></div>}
          </aside>
        </div>
      </div>
    </section>
  );
}

export default function DeanAllisonDemo() {
  const [scenarioId, setScenarioId] = useState(deanAllisonDemoScenarios[0].id);
  const [visibleLines, setVisibleLines] = useState(0);
  const [running, setRunning] = useState(false);
  const scenario = useMemo(() => deanAllisonDemoScenarios.find((item) => item.id === scenarioId) || deanAllisonDemoScenarios[0], [scenarioId]);
  const progress = getDeanDemoProgress(scenario, visibleLines);
  const complete = visibleLines >= scenario.transcript.length;

  useEffect(() => {
    if (!running) return undefined;
    if (visibleLines >= scenario.transcript.length) {
      setRunning(false);
      return undefined;
    }
    const timer = window.setTimeout(() => setVisibleLines((value) => value + 1), 760);
    return () => window.clearTimeout(timer);
  }, [running, visibleLines, scenario]);

  const chooseScenario = (id) => {
    setScenarioId(id);
    setVisibleLines(0);
    setRunning(false);
  };

  return (
    <main className="fcr-demo daa-demo">
      <div className="fcr-private-banner"><Icon name="shield" size={16} />{deanAllisonDemoOffice.privateNotice}</div>
      <header className="fcr-header"><div className="fcr-shell fcr-header-inner"><Brand /><nav aria-label="Private demo navigation"><a href={`tel:+1${deanAllisonDemoOffice.privateDemoPhone.replace(/\D/g, "")}`}>Call private test line</a><a href="#/demo/dean-allison" onClick={(event) => scrollToSection(event, "call-demo")}>Call simulation</a><a href="#/demo/dean-allison" onClick={(event) => scrollToSection(event, "complaint-builder")}>Complaint preview</a><span className="daa-header-status">PRIVATE TEST LINE LIVE</span></nav><a className="fcr-header-button" href="#/">Return to My AI PA</a></div></header>

      <section className="fcr-hero daa-hero"><div className="fcr-hero-glow one" /><div className="fcr-hero-glow two" /><div className="fcr-shell fcr-hero-grid"><div className="fcr-hero-copy"><span className="fcr-eyebrow">Unofficial private concept · My AI PA</span><h1>Constituent concerns heard. Federal-service complaints <em>organized clearly.</em></h1><p className="fcr-hero-pain">A respectful first response when an office cannot answer immediately.</p><p>This concept shows how a virtual receptionist could capture a caller’s federal concern, protect sensitive identifiers, and prepare a neutral summary for authorized staff review.</p><div className="daa-live-number"><span>CALL THE PRIVATE TEST LINE</span><a href={`tel:+1${deanAllisonDemoOffice.privateDemoPhone.replace(/\D/g, "")}`}>{deanAllisonDemoOffice.privateDemoPhone}</a><small>My AI PA test routing only · never connected to Dean Allison or his office</small></div><div className="fcr-hero-actions"><a className="fcr-primary-button" href={`tel:+1${deanAllisonDemoOffice.privateDemoPhone.replace(/\D/g, "")}`}><Icon name="phone" size={17} /> Call the live demo</a><a className="fcr-secondary-button" href="#/demo/dean-allison" onClick={(event) => scrollToSection(event, "call-demo")}>Watch a simulation</a></div><div className="fcr-hero-proof"><span><Icon name="check" size={16} /> No official affiliation claimed</span><span><Icon name="check" size={16} /> No sensitive case numbers</span><span><Icon name="check" size={16} /> No political persuasion</span></div></div><div className="daa-civic-visual" aria-label="Illustration of an organized constituent concern"><div className="daa-building"><span /><span /><span /><span /><i /></div><div className="fcr-inquiry-card"><span className="fcr-kicker">CONSTITUENT CONCERN</span><strong>Federal-service delay</strong><p>Grimsby · callback requested</p><div><Icon name="check" size={15} /> Neutral summary prepared</div></div><div className="fcr-callback-card"><Icon name="shield" /><div><strong>Privacy guard active</strong><span>No SIN or case number collected</span></div></div></div></div></section>

      <section className="fcr-section"><div className="fcr-shell"><div className="fcr-section-heading"><span className="fcr-kicker">A focused front door for federal concerns</span><h2>Listen first. Collect less. Make the next conversation easier.</h2><p>The assistant identifies the general federal topic, captures the constituent’s own words and requested next step, then stops before sensitive case information.</p></div><div className="fcr-flow-grid"><article><span className="fcr-flow-number">01</span><span className="fcr-flow-icon"><Icon name="message" /></span><h3>Hear the complaint</h3><p>Let the caller explain the issue without forcing them through a phone menu.</p></article><article><span className="fcr-flow-number">02</span><span className="fcr-flow-icon"><Icon name="document" /></span><h3>Identify the federal matter</h3><p>Record the department, general timeline, impact, and requested response.</p></article><article><span className="fcr-flow-number">03</span><span className="fcr-flow-icon"><Icon name="shield" /></span><h3>Protect sensitive details</h3><p>Refuse SIN, passport, tax, immigration-file, banking, and identity-document numbers.</p></article><article><span className="fcr-flow-number">04</span><span className="fcr-flow-icon"><Icon name="building" /></span><h3>Prepare—not promise</h3><p>Create a neutral staff summary without promising intervention, timing, or an outcome.</p></article></div></div></section>

      <section className="fcr-section fcr-live-section" id="call-demo"><div className="fcr-shell"><div className="fcr-section-heading light"><span className="fcr-kicker">Simulated complaint call</span><h2>Watch a constituent’s concern become an organized handoff.</h2><p>These are fictional scenarios. Nothing is sent to Dean Allison, Parliament, a government department, or any other person.</p></div><div className="fcr-scenario-tabs" role="tablist" aria-label="Constituency demonstration scenarios">{deanAllisonDemoScenarios.map((item) => <button type="button" role="tab" aria-selected={scenario.id === item.id} className={scenario.id === item.id ? "active" : ""} key={item.id} onClick={() => chooseScenario(item.id)}>{item.shortLabel}</button>)}</div><div className="fcr-live-grid"><DemoPhone scenario={scenario} visibleLines={visibleLines} running={running} /><div className="fcr-call-console"><div className="fcr-console-top"><div><span className="fcr-kicker">Current situation</span><h3>{scenario.title}</h3></div><button className="fcr-start-button" type="button" onClick={() => { if (complete) setVisibleLines(0); setRunning(true); }} disabled={running}><Icon name="play" size={17} />{running ? "Call in progress" : complete ? "Replay demo" : "Start simulation"}</button></div><div className="fcr-progress"><div><span>Call progress</span><strong>{progress}%</strong></div><div className="fcr-progress-track"><span style={{ width: `${progress}%` }} /></div></div><div className="fcr-stage-row">{scenario.stages.map((stage, index) => { const done = progress >= ((index + 1) / scenario.stages.length) * 100; return <div className={done ? "done" : ""} key={stage}><span>{done ? <Icon name="check" size={14} /> : index + 1}</span>{stage}</div>; })}</div><Summary scenario={scenario} complete={complete} /></div></div></div></section>

      <ComplaintBuilder />

      <section className="fcr-section fcr-knowledge-section"><div className="fcr-shell fcr-knowledge-grid"><div><span className="fcr-kicker">Public facts, visibly sourced</span><h2>Useful context without pretending to speak for the office.</h2><p>Every enabled fact records where it came from and when it was checked. Anything else requires approval from the real constituency office.</p><div className="fcr-source-list">{deanAllisonApprovedKnowledge.map((item) => <div key={item.id}><Icon name="check" size={16} /><span><strong>{item.label}</strong>{item.value}<small>Verified {item.verifiedOn}</small></span></div>)}</div></div><div className="daa-office-card"><span className="fcr-kicker">Verified public contact</span><h3>{deanAllisonDemoOffice.role}</h3><dl><div><dt>Constituency office</dt><dd>{deanAllisonDemoOffice.constituencyOffice}</dd></div><div><dt>Published phone</dt><dd>{deanAllisonDemoOffice.publicConstituencyPhone}</dd></div><div><dt>Toll free</dt><dd>{deanAllisonDemoOffice.publicTollFreePhone}</dd></div><div><dt>Email</dt><dd>{deanAllisonDemoOffice.publicEmail}</dd></div></dl><p>Displayed as public reference only. This demo does not call, text, email, or forward to these contacts.</p></div></div></section>

      <section className="fcr-boundary-section" id="safeguards"><div className="fcr-shell"><div className="fcr-boundary-card"><div><span className="fcr-kicker">Non-negotiable safeguards</span><h2>A constituent-intake tool—not a political campaign bot.</h2></div><ul>{deanAllisonBlockedBehaviours.map((claim) => <li key={claim}><Icon name="check" size={16} />{claim}</li>)}</ul></div></div></section>

      <footer className="fcr-footer"><div className="fcr-shell"><Brand /><p>{deanAllisonDemoOffice.privateNotice} The private test line routes only to My AI PA testing; official-office forwarding, notifications, and signup remain disabled.</p><a href="#/">Return to My AI PA</a></div></footer>
    </main>
  );
}
