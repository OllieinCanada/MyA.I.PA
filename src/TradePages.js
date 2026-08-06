import React, { useEffect, useState } from "react";
import { sharedCallFlow, tradePageOrder, tradePages } from "./tradePageData";
import { propertyManagementAudience } from "./firstClassRentalsData";
import "./TradePages.css";

function TradeIcon({ name, className = "" }) {
  const common = {
    viewBox: "0 0 24 24",
    className,
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.9",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": "true",
  };
  if (name === "bolt") return <svg {...common}><path d="M13.5 2 5 13h6l-.5 9L19 10h-6l.5-8Z" /></svg>;
  if (name === "drop") return <svg {...common}><path d="M12 2.7S5.8 9.1 5.8 14.2a6.2 6.2 0 0 0 12.4 0C18.2 9.1 12 2.7 12 2.7Z" /><path d="M9 15.2a3.2 3.2 0 0 0 3.2 2.7" /></svg>;
  if (name === "air") return <svg {...common}><path d="M3 8h10.5a2.5 2.5 0 1 0-2.2-3.7" /><path d="M3 12h15a2 2 0 1 1-1.7 3" /><path d="M3 16h7.5a2.5 2.5 0 1 1-2.2 3.7" /></svg>;
  if (name === "roof") return <svg {...common}><path d="m3 11 9-7 9 7" /><path d="M5.5 10v10h13V10" /><path d="M9 20v-6h6v6" /></svg>;
  return <svg {...common}><path d="m14.2 5.1 4.7 4.7" /><path d="m12.8 6.5 3.3-3.3 4.7 4.7-3.3 3.3" /><path d="m14.7 8.6-9.8 9.8a1.8 1.8 0 0 0 2.6 2.6l9.8-9.8" /></svg>;
}

function Brand() {
  return (
    <a className="trade-brand" href="#/" aria-label="My AI PA home">
      <span className="trade-brand-mark" aria-hidden="true">
        <span />
        <i />
        <b />
      </span>
      <span>
        <strong>My <em>AI PA</em></strong>
        <small>AI telephone answering assistant</small>
      </span>
    </a>
  );
}

function TradeHeader() {
  return (
    <header className="trade-header">
      <div className="trade-shell trade-header-inner">
        <Brand />
        <nav aria-label="Trade page navigation">
          <a href="#/trades">All trades</a>
          <a href="#/try-demo">Try the voice</a>
          <a className="trade-header-cta" href="#/signup">Start free trial</a>
        </nav>
      </div>
    </header>
  );
}

function TradeFooter() {
  return (
    <footer className="trade-footer">
      <div className="trade-shell trade-footer-grid">
        <div>
          <Brand />
          <p>Built in Ontario for busy trade and service businesses.</p>
        </div>
        <div className="trade-footer-links">
          <a href="#/trades">Trade pages</a>
          <a href="#/try-demo">Voice demo</a>
          <a href="/privacy.html">Privacy</a>
          <a href="/terms.html">Terms</a>
        </div>
      </div>
    </footer>
  );
}

function TradeSwitcher({ active }) {
  const navRef = React.useRef(null);

  useEffect(() => {
    const nav = navRef.current;
    const selected = nav?.querySelector(".is-active");
    if (!nav || !selected) return;
    nav.scrollLeft = Math.max(0, selected.offsetLeft - (nav.clientWidth - selected.clientWidth) / 2);
  }, [active]);

  return (
    <nav ref={navRef} className="trade-switcher" aria-label="Choose a trade">
      {tradePageOrder.map((slug) => {
        const item = tradePages[slug];
        return (
          <a
            key={slug}
            className={slug === active ? "is-active" : ""}
            href={`#/trades/${slug}`}
            aria-current={slug === active ? "page" : undefined}
          >
            <TradeIcon name={item.icon} className="trade-switcher-icon" />
            {item.label}
          </a>
        );
      })}
    </nav>
  );
}

function CallFlow() {
  return (
    <div className="trade-flow" aria-label="Visual explanation of the call flow">
      {sharedCallFlow.map(([number, title, body], index) => (
        <React.Fragment key={number}>
          <article className="trade-flow-step">
            <span>{number}</span>
            <h3>{title}</h3>
            <p>{body}</p>
          </article>
          {index < sharedCallFlow.length - 1 ? <div className="trade-flow-arrow" aria-hidden="true">→</div> : null}
        </React.Fragment>
      ))}
    </div>
  );
}

function HeroVisual({ trade }) {
  return (
    <div className="trade-hero-visual" aria-label={`Example ${trade.singular} call summary`}>
      <div className="trade-live-call">
        <span className="trade-live-dot" />
        AI answering now
        <strong>00:42</strong>
      </div>
      <div className="trade-call-bubble is-caller">
        <small>CALLER</small>
        <p>{trade.scenario.caller}</p>
      </div>
      <div className="trade-call-bubble is-assistant">
        <small>MY AI PA</small>
        <p>{trade.scenario.assistant}</p>
      </div>
      <div className="trade-owner-text">
        <div>
          <span className="trade-message-icon">✓</span>
          <strong>Owner text</strong>
          <small>now</small>
        </div>
        <p>{trade.scenario.owner}</p>
      </div>
    </div>
  );
}

function SectionHeading({ eyebrow, title, body }) {
  return (
    <div className="trade-section-heading">
      <p className="trade-kicker">{eyebrow}</p>
      <h2>{title}</h2>
      {body ? <p className="trade-section-intro">{body}</p> : null}
    </div>
  );
}

function TradeHub() {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const visibleTrades = tradePageOrder.filter((slug) => {
    if (!normalizedQuery) return true;
    const trade = tradePages[slug];
    const searchableText = [
      trade.label,
      trade.singular,
      trade.plural,
      trade.ownerValue,
      ...trade.callerNeeds.map(([title]) => title),
    ].join(" ").toLowerCase();
    return searchableText.includes(normalizedQuery);
  });
  const propertySearchText = [
    propertyManagementAudience.label,
    propertyManagementAudience.singular,
    propertyManagementAudience.ownerValue,
    ...propertyManagementAudience.handledCalls,
    "rental tenant leasing landlord maintenance application complaint",
  ].join(" ").toLowerCase();
  const propertyAudienceVisible = !normalizedQuery || propertySearchText.includes(normalizedQuery);

  useEffect(() => {
    document.title = "AI Answering for Trades | My AI PA";
    window.scrollTo?.(0, 0);
  }, []);

  return (
    <main className="trade-site">
      <TradeHeader />
      <section className="trade-hub-hero">
        <div className="trade-shell">
          <p className="trade-kicker">Built around the calls your business actually receives</p>
          <h1>One answering service.<br /><span>A different playbook for every audience.</span></h1>
          <p className="trade-hub-lead">
            An electrician should not get a plumbing script—and a property manager needs a completely different leasing and tenant workflow.
            Choose an audience to see its caller questions, urgency boundaries, handoff details, and example text.
          </p>
          <div className="trade-hub-actions">
            <a className="trade-primary-button" href="#/signup">Build my assistant</a>
            <a className="trade-secondary-button" href="#/try-demo">Hear a live example</a>
          </div>
        </div>
      </section>

      <section className="trade-hub-list">
        <div className="trade-shell">
          <SectionHeading
            eyebrow="Choose your audience"
            title="Start with your audience. Then configure the business."
            body="Every page below explains what My AI PA can collect, what it must never invent, and how the owner receives a useful follow-up."
          />
          <label className="trade-search">
            <span className="trade-search-icon" aria-hidden="true">⌕</span>
            <span className="trade-search-label">Find your audience</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Try electrician, roofing, property management..."
              aria-label="Search audience pages"
            />
          </label>
          <div className="trade-hub-grid">
            {visibleTrades.map((slug) => {
              const trade = tradePages[slug];
              const index = tradePageOrder.indexOf(slug);
              return (
                <a
                  className="trade-hub-card"
                  href={`#/trades/${slug}`}
                  key={slug}
                  style={{ "--trade-accent": trade.accent, "--trade-soft": trade.accentSoft }}
                >
                  <div className="trade-hub-card-top">
                    <span className="trade-hub-icon"><TradeIcon name={trade.icon} className="trade-icon" /></span>
                    <small>0{index + 1}</small>
                  </div>
                  <h2>{trade.label}</h2>
                  <p>{trade.ownerValue}</p>
                  <span className="trade-card-link">See the {trade.singular} page <b>→</b></span>
                </a>
              );
            })}
          </div>
          {propertyAudienceVisible ? (
            <div className="trade-property-audience">
              <p className="trade-kicker">Property management</p>
              <a
                className="trade-hub-card trade-hub-property-card"
                href={propertyManagementAudience.pageHref}
                style={{ "--trade-accent": propertyManagementAudience.accent, "--trade-soft": propertyManagementAudience.accentSoft }}
              >
                <div className="trade-hub-card-top">
                  <span className="trade-hub-icon"><TradeIcon name="home" className="trade-icon" /></span>
                  <small>SEPARATE AUDIENCE</small>
                </div>
                <h2>{propertyManagementAudience.label}</h2>
                <p>{propertyManagementAudience.ownerValue}</p>
                <span className="trade-card-link">See the property-management demo <b>→</b></span>
              </a>
            </div>
          ) : null}
          {visibleTrades.length === 0 && !propertyAudienceVisible ? (
            <div className="trade-search-empty">
              <strong>That trade page is not listed yet.</strong>
              <span>Start the free trial and choose “Other” so we can configure the right call workflow for your business.</span>
              <a className="trade-primary-button" href="#/signup">Build my assistant</a>
            </div>
          ) : null}
        </div>
      </section>

      <section className="trade-shared-flow">
        <div className="trade-shell">
          <SectionHeading
            eyebrow="The shared foundation"
            title="The workflow stays simple. The questions change by trade."
            body="This is the same four-part journey every caller follows, with intake and safety rules tailored to the selected business."
          />
          <CallFlow />
        </div>
      </section>
      <TradeFooter />
    </main>
  );
}

function TradeDetail({ slug, trade }) {
  useEffect(() => {
    document.title = `AI Answering for ${trade.plural} | My AI PA`;
    window.scrollTo?.(0, 0);
  }, [trade]);

  const pageStyle = {
    "--trade-accent": trade.accent,
    "--trade-soft": trade.accentSoft,
    "--trade-dark": trade.accentDark,
  };

  return (
    <main className="trade-site" style={pageStyle}>
      <TradeHeader />
      <section className="trade-detail-hero">
        <div className="trade-shell">
          <TradeSwitcher active={slug} />
          <div className="trade-detail-hero-grid">
            <div className="trade-detail-copy">
              <p className="trade-kicker">{trade.eyebrow}</p>
              <h1>{trade.headline}</h1>
              <p className="trade-detail-lead">{trade.intro}</p>
              <div className="trade-hero-actions">
                <a className="trade-primary-button" href="#/signup">Build my {trade.singular} assistant</a>
                <a className="trade-secondary-button" href="#/try-demo">Try a 1-minute call</a>
              </div>
              <ul className="trade-hero-trust">
                <li><span>✓</span> Keep your current business number</li>
                <li><span>✓</span> Owner-approved answers only</li>
                <li><span>✓</span> No dispatch promises without confirmation</li>
              </ul>
            </div>
            <HeroVisual trade={trade} />
          </div>
        </div>
      </section>

      <section className="trade-use-cases">
        <div className="trade-shell">
          <SectionHeading
            eyebrow={`Calls a ${trade.singular} receives`}
            title="The assistant starts by understanding the type of work."
            body={trade.ownerValue}
          />
          <div className="trade-use-grid">
            {trade.callerNeeds.map(([title, body], index) => (
              <article className="trade-use-card" key={title}>
                <span>0{index + 1}</span>
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="trade-intake-section">
        <div className="trade-shell trade-intake-grid">
          <div>
            <SectionHeading
              eyebrow="Useful intake, not an interrogation"
              title="The details you need before calling back."
              body="The assistant asks one clear question at a time. It does not dump a checklist on the caller."
            />
            <div className="trade-intake-list">
              {trade.intake.map(([title, body], index) => (
                <article key={title}>
                  <span>{index + 1}</span>
                  <div><h3>{title}</h3><p>{body}</p></div>
                </article>
              ))}
            </div>
          </div>
          <div className="trade-intake-aside">
            <p className="trade-kicker">What the owner sees</p>
            <h3>A callback brief—not a mystery voicemail.</h3>
            <p>{trade.scenario.owner}</p>
            <div className="trade-summary-tags">
              <span>Request type</span><span>Location</span><span>Urgency</span>
              <span>Contact</span><span>Timing</span><span>Safety flags</span>
            </div>
          </div>
        </div>
      </section>

      <section className="trade-priority-section">
        <div className="trade-shell">
          <SectionHeading
            eyebrow="A safer call path"
            title="Routine, priority, and emergency are not treated the same."
            body="The assistant can flag important language while staying inside conservative boundaries. It is not a substitute for emergency services or a qualified tradesperson."
          />
          <div className="trade-priority-grid">
            {trade.priorities.map(([title, body], index) => (
              <article className={`trade-priority-card is-${index}`} key={title}>
                <span>{index === 0 ? "NORMAL" : index === 1 ? "CALL BACK" : "SAFETY FIRST"}</span>
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="trade-flow-section">
        <div className="trade-shell">
          <SectionHeading
            eyebrow="See the entire handoff"
            title="From incoming call to an informed callback."
            body="The caller understands what happens next, and the business receives the context needed to continue the conversation."
          />
          <CallFlow />
        </div>
      </section>

      <section className="trade-knowledge-section">
        <div className="trade-shell trade-knowledge-grid">
          <div>
            <SectionHeading
              eyebrow="Business knowledge"
              title="Questions the assistant can answer—when you approve the facts."
            />
            <div className="trade-question-list">
              {trade.questions.map((question) => <p key={question}><span>?</span>{question}</p>)}
            </div>
          </div>
          <div className="trade-boundary-card">
            <p className="trade-kicker">Clear boundaries</p>
            <h2>Helpful without pretending to be the tradesperson.</h2>
            <ul>
              {trade.boundaries.map((boundary) => <li key={boundary}><span>✓</span>{boundary}</li>)}
            </ul>
          </div>
        </div>
      </section>

      <section className="trade-final-cta">
        <div className="trade-shell trade-final-card">
          <div>
            <p className="trade-kicker">Make the next missed call useful</p>
            <h2>Build a phone assistant around your actual {trade.label.toLowerCase()} business.</h2>
            <p>Set the greeting, service area, hours, FAQs, intake questions, callback wording, and safety boundaries before forwarding a single live call.</p>
          </div>
          <div className="trade-final-actions">
            <a className="trade-primary-button" href="#/signup">Start free trial</a>
            <a className="trade-secondary-button" href="tel:+12495033301">Call (249) 503-3301</a>
          </div>
        </div>
      </section>
      <TradeFooter />
    </main>
  );
}

export default function TradePages({ slug = "" }) {
  const normalized = String(slug || "").trim().toLowerCase();
  const trade = tradePages[normalized];
  return trade ? <TradeDetail slug={normalized} trade={trade} /> : <TradeHub />;
}
