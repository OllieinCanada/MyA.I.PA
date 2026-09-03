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

const tradeFlyerCopy = {
  electricians: {
    name: "Electricians",
    eyebrow: "AI phone answering for Canadian electricians",
    headlineTop: "YOU'RE ON THE JOB.",
    headlineBottom: "WE'LL GET THE PHONE.",
    intro: "You should not stop electrical work for every ring. My AI PA catches electrical inquiries, gathers the job details and sends you a callback-ready lead.",
    missed: "MISSED ELECTRICAL CALLS = LOST JOBS",
    lead: [["SERVICE", "Partial power + breaker trips"], ["CALLER", "Jordan Lee"], ["LOCATION", "Hamilton, ON"], ["CALLBACK", "Priority callback"], ["INTENT", "Repair request"]],
    calls: ["POWER PROBLEMS", "EV CHARGERS", "NEW WIRING", "SERVICE UPGRADES"],
    why: ["Answers while you're on the tools or moving between jobs", "Collects the job, location, timing and callback details", "Keep your same business number", "Test privately and cancel anytime"],
  },
  plumbers: {
    name: "Plumbers",
    eyebrow: "AI phone answering for Canadian plumbers",
    headlineTop: "YOU'RE UNDER THE SINK.",
    headlineBottom: "WE'LL GET THE PHONE.",
    intro: "You should not stop a plumbing job for every ring. My AI PA catches plumbing inquiries, gathers the problem details and sends you a callback-ready lead.",
    missed: "MISSED PLUMBING CALLS = LOST JOBS",
    lead: [["SERVICE", "Active ceiling leak"], ["CALLER", "Alex Morgan"], ["LOCATION", "Grimsby, ON"], ["CALLBACK", "Priority callback"], ["INTENT", "Repair request"]],
    calls: ["ACTIVE LEAKS", "DRAIN BACKUPS", "NO HOT WATER", "INSTALLATIONS"],
    why: ["Answers while you're under a sink or on another call", "Collects the issue, location, urgency and callback details", "Keep your same business number", "Test privately and cancel anytime"],
  },
  hvac: {
    name: "HVAC Pros",
    eyebrow: "AI phone answering for Canadian HVAC companies",
    headlineTop: "YOU'RE ON A SERVICE CALL.",
    headlineBottom: "WE'LL GET THE PHONE.",
    intro: "You should not leave equipment mid-service for every ring. My AI PA catches heating and cooling inquiries, gathers the details and sends you a callback-ready lead.",
    missed: "MISSED HVAC CALLS = LOST JOBS",
    lead: [["SERVICE", "No heat"], ["CALLER", "Taylor Smith"], ["LOCATION", "St. Catharines, ON"], ["CALLBACK", "Priority callback"], ["INTENT", "Repair request"]],
    calls: ["NO HEAT", "NO COOLING", "MAINTENANCE", "REPLACEMENTS"],
    why: ["Answers while you're servicing equipment or driving", "Collects the system, issue, location and callback details", "Keep your same business number", "Test privately and cancel anytime"],
  },
  "general-contractors": {
    name: "Contractors",
    eyebrow: "AI phone answering for Canadian contractors",
    headlineTop: "YOU'RE RUNNING THE JOB.",
    headlineBottom: "WE'LL GET THE PHONE.",
    intro: "You should not stop a project for every ring. My AI PA catches construction inquiries, gathers the project details and sends you a callback-ready lead.",
    missed: "MISSED PROJECT CALLS = LOST JOBS",
    lead: [["SERVICE", "Basement renovation"], ["CALLER", "Morgan Taylor"], ["LOCATION", "Hamilton, ON"], ["CALLBACK", "After 5 p.m."], ["INTENT", "Estimate request"]],
    calls: ["RENOVATIONS", "ADDITIONS", "RESTORATION", "COMMERCIAL WORK"],
    why: ["Answers while you're managing crews or materials", "Collects the scope, location, timing and callback details", "Keep your same business number", "Test privately and cancel anytime"],
  },
  roofers: {
    name: "Roofers",
    eyebrow: "AI phone answering for Canadian roofers",
    headlineTop: "YOU'RE ON THE ROOF.",
    headlineBottom: "WE'LL GET THE PHONE.",
    intro: "You should not climb down for every ring. My AI PA catches roofing inquiries, gathers the property details and sends you a callback-ready lead.",
    missed: "MISSED ROOFING CALLS = LOST JOBS",
    lead: [["SERVICE", "Wind damage + active leak"], ["CALLER", "Emily Carter"], ["LOCATION", "Grimsby, ON"], ["CALLBACK", "Urgent callback"], ["INTENT", "Repair request"]],
    calls: ["ROOF LEAKS", "STORM DAMAGE", "RE-ROOFS", "INSPECTIONS"],
    why: ["Answers while you're on the roof or moving materials", "Collects the job, location, timing and callback details", "Keep your same business number", "Test privately and cancel anytime"],
  },
  painters: {
    name: "Painters",
    eyebrow: "AI phone answering for Canadian painters",
    headlineTop: "YOU'RE ON THE LADDER.",
    headlineBottom: "WE'LL GET THE PHONE.",
    intro: "You should not stop painting for every ring. My AI PA catches quote requests, gathers the project details and sends you a callback-ready lead.",
    missed: "MISSED PAINTING CALLS = LOST JOBS",
    lead: [["SERVICE", "Kitchen cabinet painting"], ["CALLER", "Jamie Wilson"], ["LOCATION", "Burlington, ON"], ["CALLBACK", "After 4 p.m."], ["INTENT", "Quote request"]],
    calls: ["INTERIORS", "EXTERIORS", "CABINETS", "COMMERCIAL WORK"],
    why: ["Answers while you're painting or preparing surfaces", "Collects the scope, location, timing and callback details", "Keep your same business number", "Test privately and cancel anytime"],
  },
};

function FlyerIcon({ name }) {
  const paths = {
    phone: <><path d="M6 3h4l2 5-3 2c1.8 3.8 4.2 6.2 8 8l2-3 5 2v4c0 1.1-.9 2-2 2C11.5 23 3 14.5 3 4a2 2 0 0 1 2-2Z" /></>,
    back: <><path d="m15 5-7 7 7 7" /><path d="M8 12h12" /></>,
    check: <><path d="m5 12 4 4L19 6" /></>,
    bolt: <><path d="M13.5 2 5 13h6l-.5 9L19 10h-6l.5-8Z" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v6l4 2" /></>,
    pin: <><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2" /></>,
    shield: <><path d="m12 3 8 3v6c0 5-3.4 8.4-8 10-4.6-1.6-8-5-8-10V6l8-3Z" /><path d="m8 12 2.5 2.5L16 9" /></>,
    user: <><circle cx="12" cy="8" r="3" /><path d="M6 21c0-4 2.7-7 6-7s6 3 6 7" /></>,
    note: <><rect x="4" y="5" width="16" height="14" rx="2" /><path d="M8 9h8M8 13h6" /></>,
    cup: <><path d="M4 8h13v7a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V8Z" /><path d="M17 10h2a3 3 0 0 1 0 6h-2M7 4v2m4-2v2" /></>,
    globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" /></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name] || paths.note}</svg>;
}

function FlyerPanel({ title, children, className = "" }) {
  return <section className={`flyer-panel ${className}`}><h2>{title}</h2><div>{children}</div></section>;
}

function TradeFlyer({ slug, trade }) {
  const copy = tradeFlyerCopy[slug];
  const howItWorks = [["Customer calls", "Your normal business number rings."], ["My AI PA answers", "It picks up after three rings."], ["You get the lead", "Job details arrive by text."]];
  const signup = ["Go to MYAIPA.CA", "Start the 14-day free trial", "Add your services, service area and business details", "Make private test calls", "Forward missed or after-hours calls when ready"];
  const leadIcons = ["bolt", "user", "pin", "clock", "note"];

  return (
    <article className="flyer-one-to-one" aria-label={`${copy.name} My AI PA landing page`}>
      <section className="flyer-hero-copy">
        <Brand />
        <p className="flyer-eyebrow">{copy.eyebrow}</p>
        <h1><span>{copy.headlineTop}</span><strong>{copy.headlineBottom}</strong></h1>
        <p className="flyer-intro">{copy.intro}</p>
        <div className="flyer-missed"><FlyerIcon name="phone" /><strong>{copy.missed}</strong></div>
        <div className="flyer-top-actions"><a href="#/signup">START 14-DAY TRIAL</a><a href="tel:+12495033301">CALL LIVE DEMO</a></div>
        <div className="flyer-proof"><span><FlyerIcon name="check" />No credit card</span><span><FlyerIcon name="check" />Keep your number</span><span><FlyerIcon name="check" />Cancel anytime</span></div>
      </section>

      <section className={`flyer-photo flyer-photo-${slug}`}>
        <img
          className="flyer-photo-image"
          src={`/trade-heroes/${slug}-864.jpg`}
          srcSet={`/trade-heroes/${slug}-480.jpg 480w, /trade-heroes/${slug}-864.jpg 864w`}
          sizes="(max-width: 620px) 100vw, 1120px"
          loading="lazy"
          decoding="async"
          alt=""
        />
        <div className="flyer-burst">14-DAY<br />FREE<br />TRIAL</div>
        <div className="flyer-phone">
          <div className="flyer-phone-status"><span>9:41</span><i /><span>5G</span></div>
          <p>MY AI PA</p><h2>New Lead Summary</h2>
          <div className="flyer-phone-lead">
            {copy.lead.map(([label, value], index) => <div key={label}><FlyerIcon name={leadIcons[index]} /><span><small>{label}</small><strong>{value}</strong></span></div>)}
          </div>
          <div className="flyer-ready"><FlyerIcon name="check" /><strong>Ready to call back</strong></div>
        </div>
      </section>

      <section className="flyer-coffee"><div className="flyer-coffee-copy"><span><FlyerIcon name="cup" /></span><p><strong>ABOUT THE PRICE OF A CUP OF COFFEE A DAY.</strong><small>$79 per month works out to roughly $2.60 per day before tax.</small></p></div><div className="flyer-daily"><strong>$2.60</strong>/day</div></section>

      <section className="flyer-calls"><h2><small>COMMON CALLS</small> MY AI PA CAN CAPTURE</h2><div>{copy.calls.map((call) => <article key={call}>{call}</article>)}</div></section>

      <div className="flyer-panels">
        <FlyerPanel title="HOW IT WORKS">{howItWorks.map(([title, body], index) => <div className="flyer-number-row" key={title}><span>{index + 1}</span><p><strong>{title}</strong><small>{body}</small></p></div>)}</FlyerPanel>
        <FlyerPanel title="HOW TO SIGN UP">{signup.map((step, index) => <div className="flyer-number-row" key={step}><span>{index + 1}</span><p><strong>{step}</strong></p></div>)}</FlyerPanel>
        <FlyerPanel title={`WHY ${copy.name.toUpperCase()} USE IT`}>{copy.why.map((reason, index) => <div className="flyer-icon-row" key={reason}><FlyerIcon name={["clock", "phone", "note", "shield"][index]} /><strong>{reason}</strong></div>)}</FlyerPanel>

        <section className="flyer-price"><h2>SIMPLE PRICING</h2><div><p>14-DAY<br />FREE TRIAL</p><strong><b>$79</b>/mo</strong><small>Plus applicable taxes</small><ul><li><FlyerIcon name="check" />60 AI call minutes included</li><li><FlyerIcon name="check" />$0.25/min after 60 minutes</li><li><FlyerIcon name="check" />No setup fee</li></ul></div></section>

        <div className="flyer-final-actions"><a className="is-orange" href="#/signup"><span><FlyerIcon name="globe" /></span><p><small>Start your free trial at</small><strong>MYAIPA.CA</strong></p></a><a className="is-black" href="tel:+12495033301"><span><FlyerIcon name="phone" /></span><p><small>Call the live demo</small><strong>(249) 503-3301</strong></p></a></div>
        <p className="flyer-private"><FlyerIcon name="shield" /> Test it privately before forwarding real customer calls.</p>
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
      <header className="flyer-mobile-header"><a href="#/trades" aria-label="Back to all trades"><FlyerIcon name="back" /></a><span>My AI PA for {tradeFlyerCopy[slug].name}</span></header>
      <TradeFlyer slug={slug} trade={trade} />
    </main>
  );
}

export default function TradePages({ slug = "" }) {
  const normalized = String(slug || "").trim().toLowerCase();
  const trade = tradePages[normalized];
  return trade ? <TradeDetail slug={normalized} trade={trade} /> : <TradeHub />;
}
