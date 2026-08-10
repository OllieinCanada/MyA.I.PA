import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  approvedKnowledge,
  blockedClaims,
  complaintCategories,
  demoScenarios,
  firstClassRentalsCompany,
  listingKnowledge,
} from "./firstClassRentalsData";
import {
  buildComplaintRequest,
  getScenarioProgress,
} from "./firstClassRentalsLogic";
import "./FirstClassRentalsDemo.css";

function Icon({ name, size = 22 }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.9,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
  };
  if (name === "phone") return <svg {...common}><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.4 19.4 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.2-1.2a2 2 0 0 1 2.1-.5c.9.3 1.9.6 2.9.7a2 2 0 0 1 1.7 2Z" /></svg>;
  if (name === "home") return <svg {...common}><path d="m3 11 9-8 9 8" /><path d="M5 10v11h14V10" /><path d="M9 21v-7h6v7" /></svg>;
  if (name === "document") return <svg {...common}><path d="M6 2h9l4 4v16H6z" /><path d="M14 2v5h5M9 12h6M9 16h6" /></svg>;
  if (name === "wrench") return <svg {...common}><path d="M14.7 6.3a4 4 0 0 0-5-5L12 3.6 8.4 7.2 6.1 4.9a4 4 0 0 0 5 5L4 17a2.1 2.1 0 1 0 3 3l7.1-7.1a4 4 0 0 0 5-5L16.8 10 13.2 6.4z" /></svg>;
  if (name === "message") return <svg {...common}><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" /></svg>;
  if (name === "check") return <svg {...common}><path d="m5 12 4 4L19 6" /></svg>;
  if (name === "arrow") return <svg {...common}><path d="M5 12h14M13 6l6 6-6 6" /></svg>;
  if (name === "shield") return <svg {...common}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /><path d="m9 12 2 2 4-4" /></svg>;
  if (name === "copy") return <svg {...common}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>;
  if (name === "play") return <svg {...common}><path d="m8 5 11 7-11 7z" /></svg>;
  return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 8v4M12 16h.01" /></svg>;
}

const flowCards = [
  { icon: "home", title: "Rental inquiries", text: "Capture move-in preferences and viewing availability without promising that a unit is available." },
  { icon: "document", title: "Application help", text: "Explain the approved process while keeping SIN, identification, banking, and credit details off the call." },
  { icon: "wrench", title: "Tenant maintenance", text: "Organize the property, issue, impact, access notes, and preferred callback time for Dave." },
  { icon: "message", title: "Complaints for Dave", text: "Give existing tenants a calm, private path to document a concern and request a conversation with Dave." },
];

function scrollToDemoSection(event, id) {
  event.preventDefault();
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function Brand() {
  return (
    <a className="fcr-brand" href="#/" aria-label="My AI PA homepage">
      <span className="fcr-brand-mark"><Icon name="phone" size={24} /></span>
      <span><strong>My AI PA</strong><small>Private demonstration studio</small></span>
    </a>
  );
}

function DemoPhone({ scenario, visibleLines, running }) {
  const transcriptRef = useRef(null);
  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: "smooth" });
  }, [visibleLines]);

  return (
    <div className="fcr-phone-shell">
      <div className="fcr-phone-top"><span>9:41</span><span className="fcr-phone-notch" /><span>5G&nbsp; ▰</span></div>
      <div className="fcr-phone-call">
        <div className="fcr-avatar"><Icon name="home" size={25} /></div>
        <div><strong>First Class Rentals</strong><small>{running ? "Virtual receptionist active" : "Ready for a simulated call"}</small></div>
        <span className={`fcr-live-dot ${running ? "is-live" : ""}`} />
      </div>
      <div className="fcr-phone-transcript" ref={transcriptRef} aria-live="polite">
        {visibleLines === 0 ? (
          <div className="fcr-phone-empty"><Icon name="phone" size={30} /><strong>Choose a situation and start the demo</strong><span>No real call or message will be sent.</span></div>
        ) : scenario.transcript.slice(0, visibleLines).map((line, index) => (
          <div className={`fcr-bubble ${line.speaker}`} key={`${scenario.id}-${index}`}>
            <small>{line.speaker === "assistant" ? "VIRTUAL RECEPTIONIST" : "CALLER"}</small>
            <p>{line.text}</p>
          </div>
        ))}
      </div>
      <div className="fcr-phone-footer"><span /><button type="button" aria-label="Muted demonstration control"><Icon name="phone" size={20} /></button><span /></div>
    </div>
  );
}

function CallSummary({ scenario, complete, onAction }) {
  return (
    <section className={`fcr-summary-card ${complete ? "is-ready" : ""}`} aria-live="polite">
      <div className="fcr-summary-heading">
        <div><span className="fcr-kicker">Instant structured handoff</span><h3>{complete ? "Summary ready for Dave" : "Summary builds during the call"}</h3></div>
        <span className={`fcr-status-pill ${complete ? "ready" : ""}`}>{complete ? "READY" : "LISTENING"}</span>
      </div>
      <div className="fcr-summary-grid">
        <div><small>Intent</small><strong>{scenario.intent}</strong></div>
        <div><small>Priority</small><strong>{scenario.priority}</strong></div>
        <div><small>Route</small><strong>{scenario.route}</strong></div>
      </div>
      <p className="fcr-summary-copy">{complete ? scenario.summary : "The receptionist is organizing only observable caller details—never hidden reasoning."}</p>
      <div className="fcr-detail-columns">
        <div><small>Collected</small><ul>{scenario.collected.map((item) => <li key={item}><Icon name="check" size={14} />{item}</li>)}</ul></div>
        <div><small>Still useful</small>{scenario.missing.length ? <ul className="missing">{scenario.missing.map((item) => <li key={item}>{item}</li>)}</ul> : <p className="fcr-none">Ordinary intake stopped for safety.</p>}</div>
      </div>
      <div className="fcr-summary-actions">
        <button type="button" onClick={() => onAction("Copied the demonstration summary.")}><Icon name="copy" size={16} /> Copy</button>
        <button type="button" onClick={() => onAction("Email is ready once Dave approves a recipient address.")}>Email</button>
        <button type="button" onClick={() => onAction("SMS is ready once Dave approves a notification number.")}>SMS</button>
        <button type="button" onClick={() => onAction("Callback task prepared in demonstration mode.")}>Create task</button>
      </div>
    </section>
  );
}

const emptyComplaint = {
  name: "",
  address: "",
  callback: "",
  category: complaintCategories[0],
  occurred: "",
  description: "",
  resolution: "",
  callbackTime: "",
  ongoing: false,
  urgentMatter: false,
  textConsent: false,
};

function ComplaintSection() {
  const [form, setForm] = useState(emptyComplaint);
  const [result, setResult] = useState(null);
  const update = (event) => {
    const { name, value, type, checked } = event.target;
    setForm((current) => ({ ...current, [name]: type === "checkbox" ? checked : value }));
  };
  const submit = (event) => {
    event.preventDefault();
    setResult(buildComplaintRequest(form));
  };

  return (
    <section className="fcr-section fcr-complaint-section" id="tenant-concerns">
      <div className="fcr-shell">
        <div className="fcr-section-heading narrow">
          <span className="fcr-kicker">Already a tenant?</span>
          <h2>A clear way to request a conversation with Dave.</h2>
          <p>The receptionist records the tenant’s own account, checks for immediate danger, and prepares a private callback request without promising an outcome.</p>
        </div>
        <div className="fcr-complaint-layout">
          <form className="fcr-complaint-form" onSubmit={submit} noValidate>
            <div className="fcr-form-intro"><Icon name="message" /><div><strong>Tenant complaint or concern</strong><span>Private demonstration · nothing is transmitted</span></div></div>
            <div className="fcr-form-grid">
              <label><span>Your name</span><input name="name" value={form.name} onChange={update} placeholder="Tenant name" /></label>
              <label><span>Address and unit</span><input name="address" value={form.address} onChange={update} placeholder="Property address and unit" /></label>
              <label><span>Callback number</span><input name="callback" value={form.callback} onChange={update} inputMode="tel" placeholder="905-555-0123" /></label>
              <label><span>Concern category</span><select name="category" value={form.category} onChange={update}>{complaintCategories.map((item) => <option key={item}>{item}</option>)}</select></label>
              <label><span>When did it happen?</span><input name="occurred" value={form.occurred} onChange={update} placeholder="For example: last Thursday" /></label>
              <label><span>Best time for Dave to call</span><input name="callbackTime" value={form.callbackTime} onChange={update} placeholder="For example: after 5 p.m." /></label>
            </div>
            <label className="full"><span>What happened?</span><textarea name="description" value={form.description} onChange={update} rows="4" placeholder="Describe the concern in your own words." /></label>
            <label className="full"><span>What would you like Dave to do next?</span><textarea name="resolution" value={form.resolution} onChange={update} rows="2" placeholder="For example: call me and provide an update." /></label>
            <div className="fcr-checkbox-row">
              <label><input type="checkbox" name="ongoing" checked={form.ongoing} onChange={update} /><span>The concern is ongoing</span></label>
              <label className="fcr-urgent-control"><input type="checkbox" name="urgentMatter" checked={form.urgentMatter} onChange={update} /><span>Mark this as an urgent matter</span></label>
              <label><input type="checkbox" name="textConsent" checked={form.textConsent} onChange={update} /><span>I agree to receive a confirmation text</span></label>
            </div>
            <button className="fcr-primary-button" type="submit">Prepare request for Dave <Icon name="arrow" size={17} /></button>
          </form>

          <aside className="fcr-complaint-preview" aria-live="polite">
            <span className="fcr-kicker">What Dave would receive</span>
            {!result && <div className="fcr-preview-empty"><Icon name="document" size={32} /><strong>Structured, respectful, actionable</strong><p>Complete the example form to preview the private callback request.</p></div>}
            {result && !result.ok && result.safety.level === "emergency_redirect" && (
              <div className="fcr-emergency-result"><Icon name="shield" /><strong>Ordinary complaint intake stops here</strong><p>{result.safety.instruction}</p></div>
            )}
            {result && !result.ok && result.safety.level !== "emergency_redirect" && (
              <div className="fcr-form-errors"><strong>Before preparing the request:</strong>{result.privacyWarning ? <p>{result.privacyWarning}</p> : <ul>{result.missing.map((item) => <li key={item}>{item}</li>)}</ul>}</div>
            )}
            {result?.ok && result.safety.level === "emergency_redirect" && (
              <div className="fcr-emergency-result"><Icon name="shield" /><strong>Ordinary complaint intake stops here</strong><p>{result.safety.instruction}</p></div>
            )}
            {result?.ok && result.safety.level !== "emergency_redirect" && (
              <div className={`fcr-prepared-request ${result.request.urgentMatter ? "is-urgent" : ""}`}>
                <div className="fcr-request-top"><span>CALLBACK REQUEST</span><strong>{result.safety.label}</strong></div>
                <h3>For Dave · private review</h3>
                <dl>
                  <div><dt>Tenant</dt><dd>{result.request.tenant}</dd></div>
                  <div><dt>Property</dt><dd>{result.request.address}</dd></div>
                  <div><dt>Callback</dt><dd>{result.request.callback}</dd></div>
                  <div><dt>Category</dt><dd>{result.request.category}</dd></div>
                  <div><dt>Urgency</dt><dd>{result.request.urgency}</dd></div>
                  <div><dt>Concern</dt><dd>{result.request.concern}</dd></div>
                  <div><dt>Requested next step</dt><dd>{result.request.requestedResolution}</dd></div>
                  <div><dt>Best time</dt><dd>{result.request.callbackTime}</dd></div>
                </dl>
                <p className="fcr-demo-stamp">{result.request.deliveryStatus}</p>
              </div>
            )}
          </aside>
        </div>
      </div>
    </section>
  );
}

export default function FirstClassRentalsDemo() {
  const [scenarioId, setScenarioId] = useState(demoScenarios[0].id);
  const [visibleLines, setVisibleLines] = useState(0);
  const [running, setRunning] = useState(false);
  const [actionMessage, setActionMessage] = useState("");
  const scenario = useMemo(() => demoScenarios.find((item) => item.id === scenarioId) || demoScenarios[0], [scenarioId]);
  const progress = getScenarioProgress(scenario, visibleLines);
  const complete = visibleLines >= scenario.transcript.length;

  useEffect(() => {
    document.title = "First Class Rentals Niagara Private Demo | My AI PA";
    window.scrollTo?.(0, 0);
  }, []);

  useEffect(() => {
    if (!running) return undefined;
    if (visibleLines >= scenario.transcript.length) {
      setRunning(false);
      return undefined;
    }
    const timer = window.setTimeout(() => setVisibleLines((value) => value + 1), 780);
    return () => window.clearTimeout(timer);
  }, [running, visibleLines, scenario]);

  const chooseScenario = (id) => {
    setScenarioId(id);
    setVisibleLines(0);
    setRunning(false);
    setActionMessage("");
  };
  const start = () => {
    if (complete) setVisibleLines(0);
    setRunning(true);
    setActionMessage("");
  };
  const handleAction = async (message) => {
    if (message.startsWith("Copied") && navigator.clipboard) {
      try { await navigator.clipboard.writeText(`${scenario.title}\n${scenario.summary}`); } catch (_) { /* Demo remains usable without clipboard permission. */ }
    }
    setActionMessage(message);
  };

  return (
    <main className="fcr-demo">
      <div className="fcr-private-banner"><Icon name="shield" size={16} />{firstClassRentalsCompany.privateNotice}</div>
      <header className="fcr-header">
        <div className="fcr-shell fcr-header-inner">
          <Brand />
          <nav aria-label="Private demo navigation">
            <a href="#/demo/first-class-rentals" onClick={(event) => scrollToDemoSection(event, "how-it-works")}>How it helps</a>
            <a href="#/demo/first-class-rentals" onClick={(event) => scrollToDemoSection(event, "tenant-concerns")}>Tenant concerns</a>
            <a className="fcr-header-live" href="tel:+12493154508"><span>Call the private rental demo</span><strong>(249) 315-4508</strong></a>
          </nav>
          <a className="fcr-header-button" href="#/signup">Start Your Free Trial</a>
        </div>
      </header>

      <section className="fcr-hero">
        <div className="fcr-hero-glow one" /><div className="fcr-hero-glow two" />
        <div className="fcr-shell fcr-hero-grid">
          <div className="fcr-hero-copy">
            <span className="fcr-eyebrow">Private case study · My AI PA × First Class Rentals Niagara</span>
            <h1>Rental calls answered. Tenant concerns organized. <em>Dave gets the details.</em></h1>
            <p className="fcr-hero-pain">Missed calls should not become missed renters.</p>
            <p>My AI PA talks with prospective renters, organizes tenant maintenance requests, and gives existing tenants a respectful way to ask Dave for a callback.</p>
            <div className="fcr-hero-actions">
              <a className="fcr-primary-button" href="tel:+12493154508"><Icon name="phone" size={17} /> Call 249-315-4508</a>
              <a className="fcr-secondary-button" href="#/demo/first-class-rentals" onClick={(event) => scrollToDemoSection(event, "live-demo")}>Watch the Call Demo</a>
            </div>
            <div className="fcr-hero-proof"><span><Icon name="check" size={16} /> No availability promises</span><span><Icon name="check" size={16} /> No sensitive application data</span><span><Icon name="check" size={16} /> Clear handoff to Dave</span></div>
          </div>
          <div className="fcr-property-visual" aria-label="Illustration of an organized rental inquiry">
            <div className="fcr-building"><span /><span /><span /><span /><span /><span /></div>
            <div className="fcr-inquiry-card"><span className="fcr-kicker">NEW RENTAL INQUIRY</span><strong>Wiley Street interest</strong><p>September move-in · weekday viewing</p><div><Icon name="check" size={15} /> Ready for Dave to review</div></div>
            <div className="fcr-callback-card"><Icon name="message" /><div><strong>Tenant callback request</strong><span>Concern documented privately</span></div></div>
          </div>
        </div>
      </section>

      <section className="fcr-section" id="how-it-works">
        <div className="fcr-shell">
          <div className="fcr-section-heading"><span className="fcr-kicker">What happens when Dave cannot answer</span><h2>The caller talks. My AI PA organizes the next step.</h2><p>The assistant knows what to collect, what Dave must confirm, and when an ordinary request must stop for safety.</p></div>
          <div className="fcr-flow-grid">{flowCards.map((flow, index) => <article key={flow.title}><span className="fcr-flow-number">0{index + 1}</span><span className="fcr-flow-icon"><Icon name={flow.icon} /></span><h3>{flow.title}</h3><p>{flow.text}</p></article>)}</div>
        </div>
      </section>

      <section className="fcr-section fcr-live-section" id="live-demo">
        <div className="fcr-shell">
          <div className="fcr-section-heading light"><span className="fcr-kicker">See the call, then see the text</span><h2>Watch a rental call become a useful summary.</h2><p>Choose a realistic situation. This private demo uses simulated information and does not contact a renter or Dave.</p></div>
          <div className="fcr-scenario-tabs" role="tablist" aria-label="Demonstration scenarios">{demoScenarios.map((item) => <button type="button" role="tab" aria-selected={scenario.id === item.id} className={scenario.id === item.id ? "active" : ""} key={item.id} onClick={() => chooseScenario(item.id)}>{item.shortLabel}</button>)}</div>
          <div className="fcr-live-grid">
            <DemoPhone scenario={scenario} visibleLines={visibleLines} running={running} />
            <div className="fcr-call-console">
              <div className="fcr-console-top"><div><span className="fcr-kicker">Current situation</span><h3>{scenario.title}</h3></div><button className="fcr-start-button" type="button" onClick={start} disabled={running}><Icon name="play" size={17} />{running ? "Call in progress" : complete ? "Replay demo" : "Start voice demo"}</button></div>
              <div className="fcr-progress"><div><span>Call progress</span><strong>{progress}%</strong></div><div className="fcr-progress-track"><span style={{ width: `${progress}%` }} /></div></div>
              <div className="fcr-stage-row">{scenario.stages.map((stage, index) => { const stageComplete = progress >= ((index + 1) / scenario.stages.length) * 100; return <div className={stageComplete ? "done" : ""} key={stage}><span>{stageComplete ? <Icon name="check" size={14} /> : index + 1}</span>{stage}</div>; })}</div>
              <CallSummary scenario={scenario} complete={complete} onAction={handleAction} />
              {actionMessage && <p className="fcr-action-message" role="status">{actionMessage}</p>}
            </div>
          </div>
        </div>
      </section>

      <ComplaintSection />

      <section className="fcr-section fcr-knowledge-section">
        <div className="fcr-shell fcr-knowledge-grid">
          <div><span className="fcr-kicker">Answers Dave approves</span><h2>Helpful information without making things up.</h2><p>When a price, property detail, or availability needs confirmation, the assistant collects the renter’s interest and leaves the final answer to Dave.</p><div className="fcr-source-list">{approvedKnowledge.map((item) => <div key={item.id}><Icon name="check" size={16} /><span><strong>{item.label}</strong>{item.value}</span></div>)}</div></div>
          <div className="fcr-confirm-card"><div className="fcr-confirm-heading"><Icon name="shield" /><div><strong>Requires confirmation</strong><span>Before a live receptionist may say it</span></div></div>{listingKnowledge.map((item) => <div className="fcr-listing-row" key={item.id}><span><strong>{item.label}</strong>{item.advertisedDetails}</span><b>VERIFY</b></div>)}</div>
        </div>
      </section>

      <section className="fcr-boundary-section"><div className="fcr-shell"><div className="fcr-boundary-card"><div><span className="fcr-kicker">Built-in protection</span><h2>Private data stays out of ordinary calls and texts.</h2></div><ul>{blockedClaims.slice(0, 5).map((claim) => <li key={claim}><Icon name="check" size={16} />{claim}</li>)}</ul></div></div></section>

      <footer className="fcr-footer"><div className="fcr-shell"><Brand /><p>Private demonstration prepared by My AI PA. The test line and protected test summaries are active; official operation, guaranteed response times, and emergency dispatch remain disabled.</p><a href="#/">Return to My AI PA</a></div></footer>
    </main>
  );
}
