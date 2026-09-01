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
  if (name === "roller") return <svg {...common}><path d="M4 5h11a2 2 0 0 1 2 2v2H4V5Z" /><path d="M17 7h2v5h-7v3" /><path d="M10 15h4v7h-4z" /></svg>;
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
          <a className="trade-header-demo" href="tel:+12495033301">
            <span>Call the live demo</span>
            <strong>(249) 503-3301</strong>
          </a>
          <a className="trade-header-cta" href="#/signup">Start Your Free Trial</a>
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
          <p className="trade-kicker">AI telephone answering built for the trades</p>
          <h1>Never send another good customer to voicemail.<br /><span>Choose your trade.</span></h1>
          <p className="trade-hub-lead">
            Your callers get a real conversation, the right questions for the job, and a clear next step. You get the details by text so you can call back prepared.
          </p>
          <div className="trade-hub-actions">
            <a className="trade-primary-button" href="#/signup">Start Your Free Trial</a>
            <a className="trade-secondary-button" href="tel:+12495033301">Call the Live Demo</a>
          </div>
          <div className="trade-trial-proof" aria-label="Trial details"><span>✓ 14-Day Free Trial</span><span>✓ No Credit Card</span><span>✓ Cancel Anytime</span></div>
        </div>
      </section>

      <section className="trade-hub-list">
        <div className="trade-shell">
          <SectionHeading
            eyebrow="Built around your calls"
            title="See what My AI PA can do for your business."
            body="Pick your trade to see the calls it handles, the questions it asks, and the text summary you receive."
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
            eyebrow="How it works"
            title="One call. Four simple steps. No mystery voicemail."
            body="The conversation changes to fit your trade, but the result stays simple: the caller feels heard and you get the job details."
          />
          <CallFlow />
        </div>
      </section>
      <TradeFooter />
    </main>
  );
}

function TradeFlyer({ trade }) {
  const callTypes = trade.callerNeeds.slice(0, 4);

  return (
    <article className="trade-flyer" aria-label={`${trade.label} My AI PA flyer`}>
      <div className="trade-flyer-brand-row">
        <Brand />
        <span className="trade-flyer-audience"><TradeIcon name={trade.icon} /> Built for {trade.plural}</span>
      </div>

      <div className="trade-flyer-grid">
        <div className="trade-flyer-copy">
          <p className="trade-kicker">{trade.eyebrow}</p>
          <h1>{trade.headline}</h1>
          <p className="trade-flyer-pain">Missed calls = missed jobs.</p>
          <p className="trade-flyer-lead">{trade.intro}</p>

          <div className="trade-flyer-benefits" aria-label="What My AI PA does">
            <p><span>1</span><strong>Answers after three rings</strong><small>when you cannot get to the phone</small></p>
            <p><span>2</span><strong>Collects the job details</strong><small>with questions built for {trade.plural}</small></p>
            <p><span>3</span><strong>Texts you a clear lead</strong><small>so you can call back prepared</small></p>
          </div>

          <div className="trade-flyer-actions">
            <a className="trade-primary-button" href="#/signup">Start Your Free Trial</a>
            <a className="trade-secondary-button" href="tel:+12495033301">Call (249) 503-3301</a>
          </div>
          <div className="trade-trial-proof" aria-label="Trial details"><span>✓ 14-Day Free Trial</span><span>✓ No Credit Card</span><span>✓ Cancel Anytime</span></div>
        </div>

        <div className="trade-flyer-proof">
          <div className="trade-flyer-call-types">
            <p className="trade-kicker">Calls it can handle</p>
            {callTypes.map(([title]) => <span key={title}><b>✓</b>{title}</span>)}
          </div>
          <HeroVisual trade={trade} />
        </div>
      </div>

      <div className="trade-flyer-bottom">
        <p><strong>Caller talks</strong><span>→</span><strong>My AI PA collects</strong><span>→</span><strong>You get the text</strong><span>→</span><strong>You call back</strong></p>
        <small>Helpful intake. Owner-approved answers. No unconfirmed dispatch promises.</small>
      </div>
    </article>
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
    <main className="trade-site trade-flyer-site" style={pageStyle}>
      <TradeHeader />
      <section className="trade-flyer-page">
        <div className="trade-shell">
          <TradeSwitcher active={slug} />
          <TradeFlyer trade={trade} />
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
