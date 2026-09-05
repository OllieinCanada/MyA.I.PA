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
      <svg className="trade-home-brand-mark" viewBox="0 0 72 72" fill="none" aria-hidden="true">
        <path d="M14 40v-6C14 21.8 23.8 12 36 12s22 9.8 22 22v6" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
        <path d="M14 37h7v18h-7a5 5 0 0 1-5-5v-8a5 5 0 0 1 5-5Zm44 0h-7v18h7a5 5 0 0 0 5-5v-8a5 5 0 0 0-5-5Z" fill="currentColor" />
        <path d="M52 54c0 6.2-5.7 10-13.2 10M36 64h-5.5" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
        {[21, 26, 31, 36, 41, 46, 51].map((x, index) => {
          const heights = [15, 22, 28, 32, 28, 22, 15];
          const height = heights[index];
          return <rect key={x} x={x} y={36 - height / 2} width="3.6" height={height} rx="1.8" fill="#ff7a00" />;
        })}
      </svg>
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

const tradeLandingPromise = (jobType) =>
  `You can't answer the phone all the time. You shouldn't miss out on ${jobType} jobs because you're busy. My AI PA answers when you can't. Turn voicemail hang-ups into job opportunities—24/7.`;

const tradeFlyerCopy = {
  electricians: {
    name: "Electricians",
    eyebrow: "AI phone answering for Canadian electricians",
    headlineTop: "YOU'RE ON THE JOB.",
    headlineBottom: "WE'LL GET THE PHONE.",
    intro: tradeLandingPromise("electrical"),
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
    intro: tradeLandingPromise("plumbing"),
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
    intro: tradeLandingPromise("heating and cooling"),
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
    intro: tradeLandingPromise("contracting"),
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
    intro: tradeLandingPromise("roofing"),
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
    intro: tradeLandingPromise("painting"),
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
    interior: <><path d="M4 20V7l8-4 8 4v13" /><path d="M8 20v-7h8v7M3 20h18" /></>,
    exterior: <><path d="m3 11 9-7 9 7" /><path d="M5 10v10h14V10M9 20v-6h6v6" /><path d="M18 5h2v5" /></>,
    cabinet: <><rect x="4" y="3" width="16" height="18" rx="1" /><path d="M12 3v18M4 12h16" /><circle cx="9" cy="8" r=".7" /><circle cx="15" cy="8" r=".7" /><circle cx="9" cy="16" r=".7" /><circle cx="15" cy="16" r=".7" /></>,
    building: <><path d="M4 21V5h10v16M14 9h6v12M2 21h20" /><path d="M7 8h2m2 0h1M7 12h2m2 0h1M7 16h2m2 0h1M17 12h1m-1 4h1" /></>,
    leak: <><path d="M4 7h16l-2-3H6L4 7Z" /><path d="M6 7v4m12-4v4" /><path d="M12 10s-4 4.4-4 7a4 4 0 0 0 8 0c0-2.6-4-7-4-7Z" /></>,
    storm: <><path d="M6 17h11a4 4 0 0 0 .5-8A6 6 0 0 0 6.3 7.3 4.8 4.8 0 0 0 6 17Z" /><path d="m10 15-2 4h3l-1 3 5-6h-3l1-3" /></>,
    reroof: <><path d="m3 12 9-8 9 8M6 10v10h12V10" /><path d="M8 13h8M8 16h8" /></>,
    inspect: <><circle cx="10" cy="10" r="6" /><path d="m15 15 6 6M7 10l2 2 4-5" /></>,
    outlet: <><rect x="5" y="3" width="14" height="18" rx="3" /><path d="M9 8v3m6-3v3M9 16h6" /></>,
    charger: <><rect x="5" y="3" width="11" height="18" rx="2" /><path d="M8 7h5M16 8h2a2 2 0 0 1 2 2v6a2 2 0 0 0 2 2" /><path d="m9 17 3-5h-2l3-5" /></>,
    wiring: <><path d="M5 4v6a4 4 0 0 0 4 4h6a4 4 0 0 1 4 4v2" /><circle cx="5" cy="3" r="2" /><circle cx="19" cy="21" r="2" /><path d="M9 10h6" /></>,
    panel: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 7h8M8 11h3m2 0h3M8 15h3m2 0h3" /></>,
    drain: <><path d="M3 7h18M6 7v4a6 6 0 0 0 12 0V7" /><path d="M9 11h6M10 15h4M12 18v3" /></>,
    water: <><path d="M12 3s-6 7-6 12a6 6 0 1 0 12 0c0-5-6-12-6-12Z" /><path d="M9 16a3 3 0 0 0 3 2" /></>,
    wrench: <><path d="M14 6a5 5 0 0 0-6.5 6.5L3 17l4 4 4.5-4.5A5 5 0 0 0 18 10l-3 2-3-3 2-3Z" /></>,
    flame: <><path d="M13 2c1 5-3 6-3 10 0 2 1 3 2 4-3 0-5-2-5-5-3 3-2 11 5 11 5 0 8-3 8-8 0-5-4-8-7-12Z" /></>,
    snow: <><path d="M12 2v20M4 6l16 12M20 6 4 18M8 4l4 3 4-3M8 20l4-3 4 3M3 10l4 2-4 2M21 10l-4 2 4 2" /></>,
    maintenance: <><circle cx="12" cy="12" r="8" /><path d="M12 7v5l3 2M12 2v3M12 19v3M2 12h3m14 0h3" /></>,
    replace: <><path d="M7 7h11l-3-3m3 3-3 3M17 17H6l3 3m-3-3 3-3" /></>,
    renovation: <><path d="m3 20 7-7M7 17l-3-3 8-8 3 3-8 8Z" /><path d="m13 5 2-2 6 6-2 2" /></>,
    addition: <><path d="M4 21V9l7-5 7 5v12M2 21h20" /><path d="M17 4v6M14 7h6M8 21v-6h6v6" /></>,
    restoration: <><path d="M4 12a8 8 0 1 0 3-6" /><path d="M4 4v8h8" /><path d="M9 16l6-8" /></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name] || paths.note}</svg>;
}

export const tradeCallIcons = {
  electricians: ["outlet", "charger", "wiring", "panel"],
  plumbers: ["leak", "drain", "water", "wrench"],
  hvac: ["flame", "snow", "maintenance", "replace"],
  "general-contractors": ["renovation", "addition", "restoration", "building"],
  roofers: ["leak", "storm", "reroof", "inspect"],
  painters: ["interior", "exterior", "cabinet", "building"],
};

function TradeFlyer({ slug, trade }) {
  const copy = tradeFlyerCopy[slug];
  const howItWorks = [
    ["phone", "CUSTOMER CALLS", "Your phone rings normally. If you do not answer, My AI PA picks up."],
    ["note", "MY AI PA TALKS", "It asks the right questions, engages the caller and collects job details."],
    ["note", "YOU GET THE DETAILS", "You receive a clear text summary on your cellphone."],
    ["phone", "YOU CALL BACK", "You know who called, what they need and when to respond."],
  ];
  const coreBenefits = [
    ["phone", "NO MORE VOICEMAIL HANG-UPS"],
    ["user", "ENGAGES CALLERS & COLLECTS JOB DETAILS"],
    ["note", "SENDS YOU A TEXT SUMMARY"],
    ["clock", "AVAILABLE 24/7"],
  ];
  const trustItems = [
    ["shield", "BUILT FOR BUSY CONTRACTORS"],
    ["check", "TRADE-SPECIFIC QUESTIONS"],
    ["check", "EASY SETUP. NO TECH SKILLS."],
    ["shield", "YOUR BUSINESS. YOUR NUMBER."],
  ];
  const capabilityItems = [
    ["phone", "ANSWERS YOUR CALLS", "Professional greeting every time."],
    ["note", "COLLECTS JOB DETAILS", "Name, number, job type and location."],
    ["clock", "FLAGS URGENT CALLS", "Urgency is captured, not diagnosed."],
    ["note", "SENDS A SUMMARY", "A concise text arrives on your phone."],
    ["user", "USES YOUR QUESTIONS", "The call can fit your business."],
    ["clock", "AVAILABLE 24/7", "After hours, weekends and holidays."],
  ];
  const contractorOutcomes = [
    ["MORE ANSWERS.", "Callers reach a helpful next step instead of voicemail."],
    ["MORE USEFUL LEADS.", `The ${copy.name.toLowerCase()} details you need arrive together.`],
    ["MORE CONTROL.", "Test privately, then forward calls only when you are ready."],
  ];
  const faqs = [
    ["Will I keep my current phone number?", "Yes. Your normal business number stays in place; unanswered or after-hours calls can forward to My AI PA."],
    ["Will customers know they are talking to AI?", "Yes. The assistant uses a clear, professional AI disclosure."],
    ["What information does My AI PA collect?", `It can collect the caller's name, callback number, location, ${copy.calls.map((item) => item.toLowerCase()).join(", ")} and preferred timing.`],
    ["How will I receive the call details?", "A compact lead summary is sent by text so you can call back prepared."],
    ["Can I customize the questions?", "Yes. Your business details, services and call questions can be configured during setup."],
    ["Is there a long-term contract?", "No. The current plan can be cancelled anytime."],
    ["How does the 14-day trial work?", "Set it up, make private test calls, and put it online only when you are comfortable."],
    ["Does it book or promise work?", "Only when that capability is intentionally configured. By default it captures the request and sets an honest callback expectation."],
  ];
  return (
    <article className="contractor-flyer" aria-label={`${copy.name} My AI PA landing page`}>
      <section className="contractor-hero">
        <img className="contractor-hero-image" src="/trade-heroes/reference-contractor-hero-864.jpg" srcSet="/trade-heroes/reference-contractor-hero-480.jpg 480w, /trade-heroes/reference-contractor-hero-864.jpg 864w" sizes="(max-width: 720px) 100vw, 520px" decoding="async" fetchpriority="high" alt={`${copy.name} contractor working on site`} />
        <div className="contractor-hero-shade" />
        <div className="contractor-hero-main">
          <div className="contractor-wordmark"><span>My</span><b>AI</b><span>PA</span><small>AI PHONE ASSISTANT</small></div>
          <h1>STOP LOSING JOBS<br /><em>BECAUSE YOU<br />MISSED THE CALL</em></h1>
          <p>{copy.intro}</p>
          <div className="contractor-benefits">{coreBenefits.map(([icon, label]) => <div key={label}><FlyerIcon name={icon} /><strong>{label}</strong></div>)}</div>
          <div className="contractor-actions"><a href="#/signup"><FlyerIcon name="back" />START MY 14-DAY FREE TRIAL</a><a href="tel:+12495033301"><FlyerIcon name="phone" />HEAR DEMO</a></div>
          <div className="contractor-mini-proof"><span>● NO CREDIT CARD REQUIRED</span><span>● CANCEL ANYTIME</span></div>
        </div>
        <div className="contractor-never-miss"><FlyerIcon name="phone" /><strong>NEVER MISS<br />A CALL AGAIN</strong></div>
        <div className="contractor-live-phone">
          <div className="contractor-live-phone-status">Incoming Call</div>
          <h2>New Lead</h2><strong>(555) 667-5309</strong>
          <div className="contractor-caller-visual" aria-hidden="true">
            <span className="contractor-phone-wave">{[0, 1, 2, 3, 4].map((bar) => <i key={`left-${bar}`} />)}</span>
            <span className="contractor-caller-avatar" />
            <span className="contractor-phone-wave">{[0, 1, 2, 3, 4].map((bar) => <i key={`right-${bar}`} />)}</span>
          </div>
          <p><strong>MyAIPA is answering</strong><br /><span>and gathering details...</span></p>
          <span className="contractor-phone-answer"><FlyerIcon name="phone" /></span>
        </div>
      </section>

      <section className="contractor-trust-strip">{trustItems.map(([icon, label]) => <div key={label}><FlyerIcon name={icon} /><strong>{label}</strong></div>)}</section>

      <section className="contractor-white-section contractor-workflow-section">
        <h2 className="contractor-rule-heading"><span>HOW MY AI PA WORKS</span></h2>
        <div className="contractor-workflow">{howItWorks.map(([icon, title, body], index) => <article key={title}><b>{index + 1}</b><FlyerIcon name={icon} />{index < howItWorks.length - 1 ? <i>→</i> : null}<h3>{title}</h3><p>{body}</p></article>)}</div>
        <div className="contractor-middle-grid">
          <div className="contractor-outcomes-photo"><img src="/trade-heroes/reference-contractor-portrait-864.jpg" srcSet="/trade-heroes/reference-contractor-portrait-480.jpg 480w, /trade-heroes/reference-contractor-portrait-864.jpg 864w" sizes="(max-width: 560px) calc(100vw - 34px), 340px" alt="Smiling contractor ready for the next job" loading="lazy" decoding="async" /></div>
          <div className="contractor-outcomes"><h2>MORE ANSWERS.<br />MORE JOBS.<br /><em>MORE CONTROL.</em></h2>{contractorOutcomes.map(([title, body]) => <p key={title}><FlyerIcon name="check" /><span><strong>{title}</strong> {body}</span></p>)}</div>
          <div className="contractor-side-stack"><div className="contractor-built"><h3>BUILT FOR CONTRACTORS</h3>{tradePageOrder.map((item) => <span key={item}><FlyerIcon name="check" />{tradeFlyerCopy[item]?.name || tradePages[item].label}</span>)}<strong>ANY TRADE. ANY SIZE.<br /><em>ANYWHERE.</em></strong></div><div className="contractor-missed-value"><h3>WHAT IS ONE MISSED JOB WORTH?</h3>{copy.calls.map((call) => <span key={call}><FlyerIcon name="bolt" /><strong>{call}</strong><small>A callback opportunity</small></span>)}<p>Do not let it go to your competitor.<br />Make sure someone answers.</p></div></div>
        </div>
      </section>

      <section className="contractor-capabilities">
        <h2>MY AI PA HANDLES THE CALL. YOU HANDLE THE JOB.</h2>
        <div>{capabilityItems.map(([icon, title, body]) => <article key={title}><FlyerIcon name={icon} /><strong>{title}</strong><p>{body}</p></article>)}</div>
      </section>

      <section className="contractor-proof-section">
        <h2 className="contractor-rule-heading"><span>BUILT AROUND REAL CONTRACTOR PRESSURE</span></h2>
        <div className="contractor-proof-grid">{contractorOutcomes.map(([title, body], index) => <article key={title}><div className="contractor-stars">★★★★★</div><p>“{body}”</p><span>{["ON THE TOOLS", "WITH A CUSTOMER", "RUNNING THE JOB"][index]}</span></article>)}</div>
      </section>

      <section className="contractor-faq-section">
        <h2 className="contractor-rule-heading"><span>FREQUENTLY ASKED QUESTIONS</span></h2>
        <div className="contractor-faq-grid">{faqs.map(([question, answer]) => <details key={question}><summary><b>?</b>{question}<span>⌄</span></summary><p>{answer}</p></details>)}</div>
      </section>

      <section className="contractor-bottom-cta"><p>STOP LOSING JOBS.<br />START CAPTURING <em>EVERY OPPORTUNITY.</em></p><a href="#/signup"><FlyerIcon name="back" />START MY 14-DAY FREE TRIAL</a><div><span>⚡ QUICK SETUP</span><span>♢ 14 DAYS RISK-FREE</span><span>⊗ CANCEL ANYTIME</span></div></section>
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
