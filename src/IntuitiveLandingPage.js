import React, { useEffect, useRef, useState } from "react";
import { TimsElectricalLiveDemo } from "./TimsElectricalDemo";
import heroTranscriptTimings from "./timsElectricalHeroTranscriptTimings.json";
import "./IntuitiveLandingPage.css";

const coreBenefits = [
  ["phone", "All calls answered professionally after 3 rings."],
  ["chat", "Natural dialogue with customers to create a connection."],
  ["question", "FAQ questions answered."],
  ["clipboard", "Job details and callback information texted to you."],
  ["person", "Complete customer information collected."],
  ["message", "A thank-you text/reminder sent to the customer."],
];

const handoffCards = [
  ["Callback information", "Caller name, callback number, and the best time to reach them."],
  ["Job and location", "Reason for the call, requested work, service address, and city."],
  ["Timing and urgency", "Preferred start date, availability, and any urgent non-emergency concern."],
  ["Two clear handoffs", "An owner summary plus a concise confirmation for the caller."],
];

const workflowCards = [
  ["Keep your business number", "Forward only the calls you want My AI PA to answer."],
  ["Start with overflow", "Use it after hours or when your team cannot pick up."],
  ["Control the answers", "Your services, service area and common answers shape the receptionist."],
  ["Review what happened", "See the call details and follow-up texts, then improve the answers whenever needed."],
];

const faqs = [
  ["Do I have to change my business number?", "No. Keep your current number and forward calls to your My AI PA number."],
  ["What if someone calls after hours?", "Your AI assistant can answer after hours, collect the job details, and flag an urgent request for a fast callback. It does not diagnose the problem or promise an arrival time."],
  ["Can I control what it says?", "Yes. You provide the greeting and answers about your hours, service area, estimates, emergency availability, warranties, and other common questions. You also choose the callback wording and timeframe callers hear."],
  ["What if it does not know an answer?", "It should not guess. It collects the caller's details, explains that the team will follow up, and puts the unanswered question in your summary."],
  ["Will this replace my staff?", "No. My AI PA is designed to cover missed, busy, overflow, or after-hours calls. Your team can remain the first choice whenever you want."],
  ["Can I turn it off?", "Yes. You control call forwarding and can stop or change the coverage whenever you need."],
  ["How do I know it will sound right?", "Test the receptionist privately, listen to the sample call, and review the words and call summary before forwarding a single customer call."],
  ["How hard is setup?", "Add your business details and common answers, test the receptionist privately, then choose when unanswered calls should be forwarded."],
];

function Icon({ name }) {
  const paths = {
    phone: <path d="M6.6 3.8 9 3.2l2 4.7-1.7 1.4c1.1 2.3 2.9 4.1 5.2 5.2l1.4-1.7 4.7 2-.6 2.4c-.3 1.2-1.4 2-2.6 2C10.4 19.2 4.8 13.6 4.8 6.6c0-1.2.7-2.3 1.8-2.8Z" />,
    chat: <><path d="M5 5.5h14v10H9l-4 3v-13Z" /><path d="M8 9h8M8 12h5" /></>,
    question: <><circle cx="12" cy="12" r="8" /><path d="M9.8 9.3a2.3 2.3 0 1 1 3.3 2.1c-.8.4-1.1.9-1.1 1.6M12 16.3h.01" /></>,
    clipboard: <><path d="M8 5h8v3H8z" /><path d="M7 6H5v14h14V6h-2M8 13l2.2 2.2L16 10" /></>,
    person: <><circle cx="12" cy="8" r="3" /><path d="M6.5 19c.7-3.3 2.5-5 5.5-5s4.8 1.7 5.5 5" /></>,
    message: <><path d="M4 5h16v11H9l-5 3V5Z" /><path d="M8 9h8M8 12h6" /></>,
    arrow: <><path d="M5 12h14" /><path d="m14 7 5 5-5 5" /></>,
    check: <path d="m5 12 4 4L19 6" />,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{paths[name] || paths.check}</svg>;
}

function Brand() {
  return (
    <a className="simple-brand" href="#top" aria-label="My AI PA home">
      <svg className="simple-brand-mark" viewBox="0 0 72 72" fill="none" aria-hidden="true">
        <path d="M14 40v-6C14 21.8 23.8 12 36 12s22 9.8 22 22v6" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
        <path d="M14 37h7v18h-7a5 5 0 0 1-5-5v-8a5 5 0 0 1 5-5Zm44 0h-7v18h7a5 5 0 0 0 5-5v-8a5 5 0 0 0-5-5Z" fill="currentColor" />
        <path d="M52 54c0 6.2-5.7 10-13.2 10M36 64h-5.5" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
        {[21, 26, 31, 36, 41, 46, 51].map((x, index) => {
          const heights = [15, 22, 28, 32, 28, 22, 15];
          const height = heights[index];
          return <rect key={x} x={x} y={36 - height / 2} width="3.6" height={height} rx="1.8" fill="#ff7a00" />;
        })}
      </svg>
      <span>My <strong>AI PA</strong></span>
    </a>
  );
}

function StartButton({ children = "Start Your Free Trial", className = "" }) {
  return <button type="button" className={`simple-primary ${className}`} onClick={() => { window.location.hash = "/signup"; }}>{children}</button>;
}

function SectionHeading({ number, eyebrow, title, body }) {
  return (
    <div className="simple-section-heading">
      <span>{number} · {eyebrow}</span>
      <h2>{title}</h2>
      {body ? <p>{body}</p> : null}
    </div>
  );
}

const heroAudioSource = `${process.env.PUBLIC_URL || ""}${heroTranscriptTimings.src}?v=20260814-receptionist-first`;

function AnimatedHeroProof({ onSampleCall, onStartTrial }) {
  const audioRef = useRef(null);
  const [activeSlide, setActiveSlide] = useState(0);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [audioProgress, setAudioProgress] = useState(0);
  const [manualChange, setManualChange] = useState(0);

  useEffect(() => {
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    if (reduceMotion) return undefined;
    const timer = window.setTimeout(() => setActiveSlide((current) => (current + 1) % 3), 7000);
    return () => window.clearTimeout(timer);
  }, [activeSlide, manualChange]);

  const chooseSlide = (next) => {
    setActiveSlide((next + 3) % 3);
    setManualChange((value) => value + 1);
  };

  const toggleAudio = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.paused) {
      audio.pause();
      setAudioPlaying(false);
      return;
    }
    try {
      await audio.play();
      setAudioPlaying(true);
      setActiveSlide(0);
    } catch (_error) {
      setAudioPlaying(false);
    }
  };

  const slides = [
    {
      label: "The call",
      title: "A real conversation—not voicemail",
      content: (
        <div className="simple-call-conversation">
          <div className="assistant"><span>My AI PA</span><p>“Hello, are you looking for a new installation, repair or maintenance today?”</p></div>
          <div className="caller"><span>Caller</span><p>“I need someone to wire up my hot tub as a new installation.”</p></div>
          <div className="assistant"><span>My AI PA</span><p>“Absolutely. Can I get your name and the address where the work is needed?”</p></div>
        </div>
      ),
    },
    {
      label: "The follow-up",
      title: "Both sides get a clear text",
      content: (
        <div className="simple-phone-pair">
          <article className="simple-message-phone owner">
            <div className="simple-phone-status"><b>9:41</b><i /><b>5G</b></div>
            <header><span>PA</span><div><strong>Owner's cellphone</strong><small>My AI PA · now</small></div></header>
            <p>New installation · Brian Smith · Hot tub wiring · 23 Robb St., Hamilton · Best callback: After 5 PM</p>
          </article>
          <article className="simple-message-phone customer">
            <div className="simple-phone-status"><b>9:41</b><i /><b>5G</b></div>
            <header><span>TE</span><div><strong>Customer's cellphone</strong><small>Tim's Electrical · now</small></div></header>
            <p>Thanks for calling Tim's Electrical. We received your hot tub wiring request. The team will follow up to discuss the details and next steps.</p>
          </article>
        </div>
      ),
    },
    {
      label: "What you get",
      title: "Coverage for about a cup of coffee a day",
      content: (
        <div className="simple-carousel-benefits">
          <figure className="simple-coffee-cup">
            <span className="simple-coffee-steam" aria-hidden="true"><i /><i /><i /></span>
            <img src="/illustrations/tim-hortons-canadian-cup.png" alt="A hand-drawn Tim Hortons cup with Canadian nature-inspired artwork" />
          </figure>
          <ul>
            <li><Icon name="phone" />Professional answers after three rings</li>
            <li><Icon name="chat" />Natural conversation and FAQ answers</li>
            <li><Icon name="clipboard" />Job and callback details collected</li>
            <li><Icon name="message" />Owner and customer follow-up texts</li>
          </ul>
        </div>
      ),
    },
  ];

  return (
    <aside className="simple-hero-proof simple-proof-carousel" aria-label={`Three-part missed-call demonstration. Slide ${activeSlide + 1} of 3.`}>
      <div className="simple-carousel-header">
        <div><span className="simple-live-dot" /><strong>See the missed call become a lead</strong></div>
        <button type="button" className={audioPlaying ? "playing" : ""} onClick={toggleAudio} aria-pressed={audioPlaying}>
          <span aria-hidden="true">{audioPlaying ? "Ⅱ" : "▶"}</span>{audioPlaying ? "Pause Call" : "Hear Live Call"}
        </button>
      </div>
      <div className={`simple-carousel-stage${activeSlide === 1 ? " showing-phones" : ""}${activeSlide === 2 ? " showing-coffee" : ""}`}>
        {slides.map((slide, index) => (
          <section key={slide.label} className={index === activeSlide ? "active" : ""} aria-hidden={index !== activeSlide}>
            <p>{slide.label} · {index + 1} of 3</p>
            <h2>{slide.title}</h2>
            {slide.content}
          </section>
        ))}
      </div>
      <div className="simple-carousel-audio-progress" aria-hidden={!audioPlaying}>
        <span style={{ width: `${audioProgress}%` }} />
      </div>
      <div className="simple-carousel-controls">
        <button type="button" onClick={() => chooseSlide(activeSlide - 1)} aria-label="Previous demonstration slide">←</button>
        <div role="group" aria-label="Choose a demonstration slide">
          {slides.map((slide, index) => <button type="button" key={slide.label} className={index === activeSlide ? "active" : ""} onClick={() => chooseSlide(index)} aria-label={`Show ${slide.label}`} aria-pressed={index === activeSlide} />)}
        </div>
        <button type="button" onClick={() => chooseSlide(activeSlide + 1)} aria-label="Next demonstration slide">→</button>
      </div>
      <div className="simple-carousel-actions">
        <button type="button" className="simple-secondary" onClick={onSampleCall}>See the Full Demo</button>
        <button type="button" className="simple-primary" onClick={onStartTrial}>Start Your Free Trial</button>
      </div>
      <audio
        ref={audioRef}
        src={heroAudioSource}
        preload="metadata"
        onPause={() => setAudioPlaying(false)}
        onPlay={() => setAudioPlaying(true)}
        onEnded={() => { setAudioPlaying(false); setAudioProgress(0); }}
        onTimeUpdate={(event) => {
          const duration = Number(event.currentTarget.duration || heroTranscriptTimings.durationSeconds);
          const current = Number(event.currentTarget.currentTime || 0);
          setAudioProgress(duration > 0 ? Math.min(100, (current / duration) * 100) : 0);
        }}
      />
    </aside>
  );
}

function BenefitGrid() {
  return (
    <div className="simple-benefits" aria-label="What My AI PA provides">
      {coreBenefits.map(([icon, text]) => <div key={text}><span><Icon name={icon} /></span><strong>{text}</strong></div>)}
    </div>
  );
}

function FAQList() {
  const [open, setOpen] = useState(0);
  return (
    <div className="simple-faqs">
      {faqs.map(([question, answer], index) => (
        <article key={question} className={open === index ? "open" : ""}>
          <button type="button" aria-expanded={open === index} onClick={() => setOpen(open === index ? -1 : index)}>
            <span>{question}</span><span aria-hidden="true">{open === index ? "−" : "+"}</span>
          </button>
          {open === index ? <p>{answer}</p> : null}
        </article>
      ))}
    </div>
  );
}

export default function IntuitiveLandingPage() {
  useEffect(() => {
    document.title = "My AI PA | AI Phone Answering for Trades";
    if (!window.location.hash || window.location.hash === "#/") window.scrollTo?.(0, 0);
  }, []);

  const scrollToDemo = () => document.getElementById("see-it-work")?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <main className="simple-site" id="top">
      <header className="simple-header">
        <div className="simple-shell simple-header-inner">
          <Brand />
          <nav aria-label="Page sections">
            <a href="#why-it-matters">Why it matters</a>
            <a href="#how-it-works">How it works</a>
            <a href="#see-it-work">See it work</a>
            <a href="#pricing">Pricing</a>
          </nav>
          <div className="simple-header-actions">
            <a className="simple-call-link" href="tel:+12495033301"><span>Call the live demo</span><strong>(249) 503-3301</strong></a>
            <StartButton />
          </div>
        </div>
      </header>

      <section className="simple-hero">
        <div className="simple-shell simple-hero-grid">
          <div className="simple-hero-copy">
            <div className="simple-contractor-burst" aria-label="Attention contractors!">
              <span>Attention</span>
              <strong>Contractors!</strong>
            </div>
            <p className="simple-intro"><span>Introducing</span><strong>My AI PA:</strong> AI Telephone Answering Assistant</p>
            <h1>Never miss a call again!</h1>
            <p className="simple-loss">Missed Calls = Lost Jobs $$</p>
            <p className="simple-hero-body">When you cannot get to the phone, the telephone assistant answers calls, talks with your customer, collects the job details, and texts both the business owner and caller for an easy follow-up.</p>
            <p className="simple-number-promise">Keep your existing business number.</p>
            <div className="simple-hero-actions">
              <StartButton />
              <button type="button" className="simple-secondary" onClick={scrollToDemo}>See a Sample Call</button>
            </div>
            <div className="simple-trust" aria-label="Trial details"><span>✓ 14-Day Free Trial</span><span>✓ No Credit Card</span><span>✓ Cancel Anytime</span></div>
          </div>
          <AnimatedHeroProof onSampleCall={scrollToDemo} onStartTrial={() => { window.location.hash = "/signup"; }} />
        </div>
      </section>

      <nav className="simple-jump-nav" aria-label="Quick page navigation">
        <div className="simple-shell">
          <a href="#why-it-matters"><span>1</span>Why it matters</a>
          <a href="#how-it-works"><span>2</span>How it works</a>
          <a href="#see-it-work"><span>3</span>See it work</a>
          <a href="#pricing"><span>4</span>Pricing</a>
        </div>
      </nav>

      <section className="simple-control-strip" aria-label="How My AI PA fits your current phone workflow">
        <div className="simple-shell">
          <div><span>1</span><strong>Your staff answers first</strong></div>
          <Icon name="arrow" />
          <div><span>2</span><strong>My AI PA catches the calls they miss</strong></div>
          <Icon name="arrow" />
          <div><span>3</span><strong>You receive a callback-ready text</strong></div>
        </div>
      </section>

      <section className="simple-section simple-problem" id="why-it-matters">
        <div className="simple-shell">
          <SectionHeading number="01" eyebrow="Why it matters" title="The caller needs help now—not after you finish the job." body="When a ready-to-hire customer reaches voicemail, the next contractor is only another call away. My AI PA answers while you keep working, so the opportunity does not disappear without a conversation." />
          <div className="simple-compare">
            <article className="without"><span>Without help</span><h3>Phone rings unanswered</h3><p>Three rings. No answer. The caller has no reason to wait.</p><div className="simple-outcome">The next contractor gets a chance</div></article>
            <div className="simple-compare-arrow"><Icon name="arrow" /></div>
            <article className="with"><span>With My AI PA</span><h3>Assistant answers live</h3><p>The caller explains the job, gets common questions answered, and knows the team has the request.</p><div className="simple-outcome"><Icon name="check" /> You receive a callback-ready lead</div></article>
          </div>
        </div>
      </section>

      <section className="simple-section simple-how" id="how-it-works">
        <div className="simple-shell">
          <SectionHeading number="02" eyebrow="How it works" title="Three simple steps." body="Keep your same business number!" />
          <div className="simple-how-grid">
            <article><div className="simple-how-number"><Icon name="phone" /></div><span>Step 1</span><h3>My AI PA answers</h3><p>Your customer gets a professional greeting after three rings.</p></article>
            <article className="simple-how-details"><div className="simple-how-number"><Icon name="clipboard" /></div><span>Step 2</span><h3>The right details are collected</h3><ul><li>The reason for the call</li><li>Job details</li><li>Service amount</li><li>Customer name</li><li>Call urgent</li><li>And call back # are all collected</li></ul></article>
            <article><div className="simple-how-number"><Icon name="message" /></div><span>Step 3</span><h3>Both sides receive a text</h3><p>Caller and owner both get a text to their cellphone summarizing the details of the call.</p></article>
          </div>
          <div className="simple-coffee">
            <div><strong>We've got you covered 24/7.</strong><p>For about the <u>price of a cup of coffee per day</u> you get:</p></div>
            <BenefitGrid />
          </div>
        </div>
      </section>

      <div id="see-it-work" className="simple-demo-wrap">
        <TimsElectricalLiveDemo embedded onSignup={() => { window.location.hash = "/signup"; }} />
      </div>

      <section className="simple-section simple-receive">
        <div className="simple-shell">
          <SectionHeading number="04" eyebrow="What you receive" title="The details your team needs—already organized." />
          <div className="simple-card-grid">{handoffCards.map(([title, body]) => <article key={title}><span><Icon name="check" /></span><h3>{title}</h3><p>{body}</p></article>)}</div>
        </div>
      </section>

      <section className="simple-section simple-workflow">
        <div className="simple-shell simple-workflow-layout">
          <SectionHeading number="05" eyebrow="You stay in control" title="Extra coverage without replacing the way you work." body="Choose when it answers, what it says, and which calls still go to your staff first." />
          <div className="simple-workflow-list">{workflowCards.map(([title, body]) => <article key={title}><span><Icon name="check" /></span><div><h3>{title}</h3><p>{body}</p></div></article>)}</div>
        </div>
      </section>

      <section className="simple-section simple-trial-plan">
        <div className="simple-shell">
          <SectionHeading number="06" eyebrow="A low-risk field test" title="Trust it privately before a customer ever hears it." body="The 14-day trial is not a blind switch. Set it up, test it, and forward real missed calls only when you are comfortable." />
          <div className="simple-trial-grid">
            <article><span>1</span><div><p>First</p><h3>Build and test privately</h3><small>Add your services and common answers. Hear the receptionist and correct anything you do not like.</small></div></article>
            <article><span>2</span><div><p>When ready</p><h3>Choose the calls it covers</h3><small>Start with after-hours, busy, or unanswered calls. Your existing number and staff stay in place.</small></div></article>
            <article><span>3</span><div><p>Before deciding</p><h3>Review the actual handoffs</h3><small>See what was collected, read the summaries, and decide whether the coverage earned its place.</small></div></article>
          </div>
          <div className="simple-honest-proof"><span><Icon name="check" /></span><div><strong>No fake promises. Hear it, test it, and decide from the calls.</strong><p>No credit card. No setup fee. Cancel anytime.</p></div><StartButton /></div>
        </div>
      </section>

      <section className="simple-section simple-pricing" id="pricing">
        <div className="simple-shell simple-pricing-layout">
          <SectionHeading number="07" eyebrow="Trial and pricing" title="One plan. Clear minutes. No long contract." body="Know the monthly price, included minutes, and overage cost before you start." />
          <article className="simple-price-card">
            <div><span>Essential</span><p>Simple monthly plan</p></div>
            <p className="simple-price"><strong>$79</strong>/month</p>
            <ul><li><Icon name="check" />60 AI call minutes included</li><li><Icon name="check" />$0.25 per minute after 60 minutes</li><li><Icon name="check" />+ applicable taxes</li></ul>
            <p>14-day free trial · No setup fee · Cancel anytime</p>
            <p className="simple-price-control">Forward real calls only when your private test sounds right.</p>
            <StartButton />
          </article>
        </div>
      </section>

      <section className="simple-section simple-setup">
        <div className="simple-shell">
          <SectionHeading number="08" eyebrow="Setup and common questions" title="Straight answers before you trust it with a call." />
          <div className="simple-setup-grid">
            <div className="simple-setup-steps"><article><span>1</span><p>Add your business and common answers</p></article><article><span>2</span><p>Hear a test call in your browser</p></article><article><span>3</span><p>Forward unanswered calls when you are ready</p></article></div>
            <div><p className="simple-quick">Quick answers</p><FAQList /></div>
          </div>
        </div>
      </section>

      <section className="simple-final">
        <div className="simple-shell">
          <span>09 · Your decision</span>
          <h2>The next ready-to-hire caller should reach your business—not your voicemail.</h2>
          <p>Test My AI PA privately for 14 days. No credit card. Keep your current business number.</p>
          <div><StartButton /><button type="button" className="simple-secondary light" onClick={scrollToDemo}>See a Sample Call</button></div>
        </div>
      </section>

      <footer className="simple-footer"><div className="simple-shell"><Brand /><p>Built in Ontario for busy Canadian service businesses across Hamilton, Grimsby, and the surrounding area.</p><nav><a href="/privacy.html">Privacy</a><a href="/terms.html">Terms</a><a href="mailto:hello@myaipa.com">Contact</a></nav></div></footer>
    </main>
  );
}
