import React, { useEffect, useState } from "react";
import "./ProofPage.css";

const publicAsset = (name) => `/${name}`;
const proofUrl = "https://www.myaipa.ca/proof/";

const proofMetrics = [
  { value: "155", label: "backend tests", note: "Repeatable release evidence" },
  { value: "20", label: "safety scenarios", note: "Conversation and escalation checks" },
  { value: "5 yrs", label: "customer service", note: "Calm, high-volume communication" },
];

const ownership = [
  {
    number: "01",
    title: "Understand the customer problem",
    body: "Translate a missed or interrupted service call into the few details a business actually needs for a useful callback.",
    tag: "Discovery",
  },
  {
    number: "02",
    title: "Design the complete workflow",
    body: "Shape the conversation, structured intake, risk boundaries, confirmation, owner notification and human handoff as one experience.",
    tag: "Implementation",
  },
  {
    number: "03",
    title: "Trace problems across the system",
    body: "Use logs, request and response data, tool behaviour and stored state to isolate where a customer-impacting failure began.",
    tag: "Technical support",
  },
  {
    number: "04",
    title: "Turn failures into prevention",
    body: "Document the resolution, add a regression check and make the next investigation faster for both technical and non-technical people.",
    tag: "Product quality",
  },
];

const safetyAreas = [
  ["Consent and disclosure", "Checks that the assistant identifies its role and handles recording or messaging expectations clearly."],
  ["Routing and escalation", "Verifies that urgent or unsupported requests move toward the correct human or emergency path."],
  ["Sensitive information", "Tests redaction and refusal paths when a caller starts sharing information the workflow should not collect."],
  ["Provider failures", "Exercises timeouts, rejected deliveries and unavailable dependencies without inventing a successful outcome."],
  ["Unsupported claims", "Prevents the assistant from guessing prices, availability, credentials or business promises."],
  ["Recovery", "Confirms that a partial failure leaves useful evidence and a clear next action instead of a silent dead end."],
];

const roleMatches = [
  {
    title: "Customer Experience Engineering",
    body: "Connect customer friction to technical evidence, reproduce issues and explain the resolution without unnecessary jargon.",
  },
  {
    title: "Product and Technical Support",
    body: "Own a problem through investigation, documentation, escalation and confirmation that the workflow behaves as intended.",
  },
  {
    title: "Implementation and Onboarding",
    body: "Turn business requirements into a configured workflow, test realistic scenarios and teach non-technical users what happens next.",
  },
  {
    title: "AI Workflow Operations",
    body: "Evaluate conversations, tool behaviour, safeguards, integrations and human handoffs as one operational system.",
  },
];

function Icon({ name, size = 20 }) {
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

  if (name === "arrow") return <svg {...common}><path d="M5 12h14M14 7l5 5-5 5" /></svg>;
  if (name === "play") return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="m10 8 6 4-6 4Z" /></svg>;
  if (name === "check") return <svg {...common}><path d="m5 12 4 4L19 6" /></svg>;
  if (name === "copy") return <svg {...common}><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></svg>;
  if (name === "mail") return <svg {...common}><rect x="3" y="5" width="18" height="14" rx="3" /><path d="m4 7 8 6 8-6" /></svg>;
  if (name === "shield") return <svg {...common}><path d="M12 3 5 6v5c0 4.5 2.9 8.1 7 10 4.1-1.9 7-5.5 7-10V6l-7-3Z" /><path d="m9 12 2 2 4-5" /></svg>;
  if (name === "person") return <svg {...common}><circle cx="12" cy="8" r="3" /><path d="M5 21a7 7 0 0 1 14 0" /></svg>;
  return <svg {...common}><path d="M4 5h16v14H4z" /><path d="M8 9h8M8 13h5" /></svg>;
}

function Brand() {
  return (
    <a className="proof-brand" href="/#/" aria-label="My AI PA home">
      <span className="proof-brand-mark"><span /></span>
      <span className="proof-brand-copy"><strong>MY AI PA</strong><small>Engineering proof</small></span>
    </a>
  );
}

function SectionHeading({ eyebrow, title, body, light = false }) {
  return (
    <div className={`proof-section-heading${light ? " is-light" : ""}`}>
      <span>{eyebrow}</span>
      <h2>{title}</h2>
      {body ? <p>{body}</p> : null}
    </div>
  );
}

export default function ProofPage() {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    document.title = "Oliver Slapinski | Customer Engineering Proof";
    const description = "A concise engineering case study showing how Oliver Slapinski designed, tested, troubleshot and documented the My AI PA customer workflow.";
    let meta = document.querySelector('meta[name="description"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", "description");
      document.head.appendChild(meta);
    }
    meta.setAttribute("content", description);
  }, []);

  const copyProofLink = async () => {
    try {
      await navigator.clipboard.writeText(proofUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch (_) {
      window.prompt("Copy this proof link", proofUrl);
    }
  };

  const scrollToSection = (id) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <main className="proof-page">
      <header className="proof-header">
        <div className="proof-shell proof-header-inner">
          <Brand />
          <nav aria-label="Proof page navigation">
            <button type="button" onClick={() => scrollToSection("demonstration")}>Demo</button>
            <button type="button" onClick={() => scrollToSection("evidence")}>Evidence</button>
            <button type="button" onClick={() => scrollToSection("role-fit")}>Role fit</button>
          </nav>
          <button className="proof-copy-button" type="button" onClick={copyProofLink}>
            <Icon name={copied ? "check" : "copy"} size={17} />
            {copied ? "Link copied" : "Copy proof link"}
          </button>
        </div>
      </header>

      <section className="proof-hero">
        <div className="proof-hero-glow proof-hero-glow-one" />
        <div className="proof-hero-glow proof-hero-glow-two" />
        <div className="proof-shell proof-hero-grid">
          <div className="proof-hero-copy">
            <span className="proof-kicker">Oliver Slapinski · Customer experience engineering</span>
            <h1>I build customer-facing systems—and the evidence needed to trust them.</h1>
            <p className="proof-hero-lede">
              My AI PA is a working phone and intake prototype that turns an unstructured service call into an organized human follow-up. I designed the customer journey, connected the workflow, tested its failure paths and documented how it should behave when something goes wrong.
            </p>
            <div className="proof-hero-actions">
              <button className="proof-button is-primary" type="button" onClick={() => scrollToSection("demonstration")}><Icon name="play" size={18} /> Hear the recorded demo</button>
              <a className="proof-button is-secondary" href="mailto:hello@myaipa.com?subject=Customer%20engineering%20conversation%20with%20Oliver"><Icon name="mail" size={18} /> Discuss a role</a>
            </div>
            <p className="proof-honesty"><Icon name="shield" size={17} /> Working prototype · demonstration data · human-controlled handoffs</p>
          </div>

          <div className="proof-flow-card" aria-label="My AI PA workflow overview">
            <div className="proof-flow-top">
              <span>LIVE WORKFLOW VIEW</span>
              <strong><i /> Ready for review</strong>
            </div>
            <div className="proof-caller-row">
              <span className="proof-avatar"><Icon name="person" /></span>
              <div><small>Incoming request</small><strong>“I need help wiring a hot tub.”</strong></div>
              <time>6:42 PM</time>
            </div>
            <div className="proof-flow-line"><span /></div>
            <div className="proof-flow-stages">
              {["Understand", "Structure", "Check risk", "Hand off"].map((item, index) => (
                <div key={item} className="proof-flow-stage">
                  <span><Icon name="check" size={14} /></span>
                  <div><small>0{index + 1}</small><strong>{item}</strong></div>
                </div>
              ))}
            </div>
            <div className="proof-output-card">
              <span className="proof-output-icon"><Icon name="document" /></span>
              <div><small>Structured callback brief</small><strong>Installation · St. Catharines · evening callback</strong></div>
              <span className="proof-output-status">READY</span>
            </div>
          </div>
        </div>
      </section>

      <section className="proof-metrics" aria-label="Project evidence">
        <div className="proof-shell proof-metrics-grid">
          {proofMetrics.map((metric) => (
            <div key={metric.label} className="proof-metric">
              <strong>{metric.value}</strong>
              <div><span>{metric.label}</span><small>{metric.note}</small></div>
            </div>
          ))}
        </div>
      </section>

      <section className="proof-section proof-problem-section">
        <div className="proof-shell">
          <SectionHeading
            eyebrow="The problem I chose"
            title="The call is only the beginning of the support workflow."
            body="A useful system must understand the request, preserve the right details, set accurate expectations and leave the next person with enough context to act."
          />
          <div className="proof-problem-grid">
            <article><span>01</span><h3>Customers call at inconvenient moments.</h3><p>The business owner may be driving, using tools or already helping someone. The caller still needs a clear first response.</p></article>
            <article><span>02</span><h3>Unstructured messages create more work.</h3><p>A vague voicemail forces another round of questions. Structured intake makes the callback more useful from the first minute.</p></article>
            <article><span>03</span><h3>Automation must communicate its limits.</h3><p>The assistant should never fabricate availability, dispatch, prices or expertise. Risk and uncertainty need explicit paths.</p></article>
          </div>
        </div>
      </section>

      <section className="proof-section proof-ownership-section">
        <div className="proof-shell proof-ownership-layout">
          <SectionHeading
            eyebrow="What I owned"
            title="From customer friction to a supportable system."
            body="The project required more than making an agent speak. It required connecting customer communication, technical troubleshooting, implementation and quality assurance."
            light
          />
          <div className="proof-ownership-list">
            {ownership.map((item) => (
              <article key={item.number}>
                <span className="proof-step-number">{item.number}</span>
                <div><small>{item.tag}</small><h3>{item.title}</h3><p>{item.body}</p></div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="proof-section proof-demo-section" id="demonstration">
        <div className="proof-shell">
          <SectionHeading
            eyebrow="Recorded demonstration"
            title="Hear a service call become a useful handoff."
            body="This two-minute test call uses fictional contact details. Listen for expectation-setting, clarification, confirmation and a clean next step."
          />
          <div className="proof-demo-grid">
            <div className="proof-audio-card">
              <div className="proof-audio-heading">
                <span className="proof-play-icon"><Icon name="play" size={25} /></span>
                <div><small>Test call · electrical installation</small><h3>From “Do you wire hot tubs?” to a structured callback request</h3></div>
              </div>
              <audio controls preload="metadata" src={publicAsset("tims-electrical-2.wav?v=20260614-trim")}>
                Your browser does not support the recorded demonstration.
              </audio>
              <div className="proof-listen-for">
                <span>Listen for</span>
                <ul>
                  <li><Icon name="check" size={15} /> Clear service and hours response</li>
                  <li><Icon name="check" size={15} /> Job, location and callback details</li>
                  <li><Icon name="check" size={15} /> Read-back confirmation</li>
                  <li><Icon name="check" size={15} /> Human follow-up without a false promise</li>
                </ul>
              </div>
            </div>
            <aside className="proof-handoff-card">
              <span className="proof-card-label">Handoff preview</span>
              <div className="proof-handoff-title"><span><Icon name="document" /></span><div><small>NEW INSTALLATION</small><strong>Callback brief prepared</strong></div></div>
              <dl>
                <div><dt>Request</dt><dd>Hot-tub electrical installation</dd></div>
                <div><dt>Location</dt><dd>St. Catharines</dd></div>
                <div><dt>Contact</dt><dd>Number confirmed by caller</dd></div>
                <div><dt>Timing</dt><dd>Evening callback preferred</dd></div>
                <div><dt>Next step</dt><dd>Qualified human reviews and responds</dd></div>
              </dl>
              <a href="/#/trades/electricians">Explore the interactive workflow <Icon name="arrow" size={16} /></a>
            </aside>
          </div>
        </div>
      </section>

      <section className="proof-section proof-evidence-section" id="evidence">
        <div className="proof-shell">
          <SectionHeading
            eyebrow="Quality evidence"
            title="A good demo is not the same as a dependable system."
            body="The backend quality gate and conversational evaluation turn important behaviours into repeatable checks before a change is treated as ready."
            light
          />
          <div className="proof-evidence-top">
            <article><strong>155</strong><span>Automated backend checks</span><p>Coverage across authentication, routing, stored state, connected workflows and failure recovery.</p></article>
            <article><strong>20</strong><span>Conversational safety scenarios</span><p>Realistic prompts that test boundaries, escalation, redaction, unsupported claims and difficult handoffs.</p></article>
            <div className="proof-evidence-quote"><Icon name="shield" size={28} /><p>When a failure appears, the goal is not to hide it. The goal is to preserve the evidence, contain the impact and turn the lesson into a repeatable check.</p></div>
          </div>
          <div className="proof-safety-grid">
            {safetyAreas.map(([title, body]) => (
              <article key={title}><span><Icon name="check" size={15} /></span><div><h3>{title}</h3><p>{body}</p></div></article>
            ))}
          </div>
        </div>
      </section>

      <section className="proof-section proof-role-section" id="role-fit">
        <div className="proof-shell">
          <SectionHeading
            eyebrow="What this demonstrates"
            title="Technical depth that stays connected to the customer."
            body="My strongest work sits where product behaviour, customer communication and implementation meet."
          />
          <div className="proof-role-grid">
            {roleMatches.map((role) => <article key={role.title}><span><Icon name="arrow" size={17} /></span><h3>{role.title}</h3><p>{role.body}</p></article>)}
          </div>
          <div className="proof-cta">
            <div><span>Looking for this combination?</span><h2>Let’s talk about the customer problem behind the role.</h2><p>Oliver Slapinski · Grimsby, Ontario · Authorized to work in Canada</p></div>
            <div className="proof-cta-actions">
              <a className="proof-button is-primary" href="mailto:hello@myaipa.com?subject=Customer%20engineering%20conversation%20with%20Oliver"><Icon name="mail" size={18} /> Email Oliver</a>
              <a className="proof-button is-secondary" href="https://www.linkedin.com/in/oliver-slapinski-431110234" target="_blank" rel="noreferrer">LinkedIn <Icon name="arrow" size={17} /></a>
            </div>
          </div>
        </div>
      </section>

      <footer className="proof-footer">
        <div className="proof-shell"><Brand /><p>My AI PA is presented here as a working prototype and engineering case study.</p><button type="button" onClick={copyProofLink}>{copied ? "Proof link copied" : proofUrl}</button></div>
      </footer>
    </main>
  );
}
