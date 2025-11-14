// File: src/components/Hero/Hero.tsx
import { useEffect, useState } from "react";
import { Container } from "./styles";
import ScrollAnimation from "react-animate-on-scroll";
import NiceGirl from "../../assets/Nice_girl.png";

export function Hero() {
  const [firstVisit, setFirstVisit] = useState(false);
  const [ctaClicked, setCtaClicked] = useState(false);
  const [showPromo, setShowPromo] = useState(false);

  useEffect(() => {
    const seen = sessionStorage.getItem("hero_seen");
    if (!seen) {
      setFirstVisit(true);
      sessionStorage.setItem("hero_seen", "1");
    }
    window.scrollTo(5, 0);

    const t = window.setTimeout(() => setShowPromo(true), 5000);
    return () => window.clearTimeout(t);
  }, []);

  const scrollToAbout = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    setCtaClicked(true);
    document.querySelector("#about")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const goToSignup = () =>
    document.querySelector("#signup")?.scrollIntoView({ behavior: "smooth", block: "start" });

  const ctaLabel = ctaClicked
    ? "CLICK HERE FOR LIVE DEMO"
    : "CLICK HERE TO FIND OUT HOW TO SAVE TIME AND MONEY!";

  return (
    <Container id="home" className={firstVisit ? "first-visit" : ""}>
      <div className="poster">
        <ScrollAnimation animateIn="fadeInUp" delay={40} animateOnce>
          <h1 className="brand">
            MY <span className="ai">A</span>.<span className="ai">I</span>. PA
          </h1>
          <h1 className="brand2">AI TELEPHONE ANSWERING ASSISTANT</h1>
          <p className="trade-line">Professional. Reliable. Built For Small Businesses.</p>

          <div className="hero-inline">
            <div className="circle">
              <img src={NiceGirl} alt="Assistant representative" />
            </div>

            <div className="hero-inline-text">
              <p>
                Our AI telephone assistant answers calls when you can't, collects the call details and sets you up for an easy call back.
                <span className="break-line">
                  <span className="day">day☀️</span> or <span className="night">night.🌙</span>
                </span>
              </p>

              <h3 className="why-title">Why Choose Our AI Assistant?</h3>
            </div>
          </div>

          <div className="tagline-block">
            <h2 className="tagline">NEVER MISS A CALL AGAIN!</h2>
            <ul className="bullets two-col">
              <li>Always Answers 24/7</li>
              <li>Handles Multiple Callers</li>
              <li>Automates New Bookings</li>
              <li>Answers Caller's Questions</li>
              <li>Texts You The Call Details</li>
              <li>Filters Out Timewasters</li>
              <li>Sets You Up For Callbacks</li>
              <li>Creates A Professional Image</li>
            </ul>
          </div>
        </ScrollAnimation>

        <a
          href="#about"
          className="down-arrow"
          aria-label={ctaLabel}
          title={ctaLabel}
          role="button"
          onClick={scrollToAbout}
        >
          <svg width="40" height="40" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 3a1 1 0 0 1 1 1v12.586l4.293-4.293a1 1 0 0 1 1.414 1.414l-6.007 6.007a1 1 0 0 1-1.414 0L5.279 13.707a1 1 0 1 1 1.414-1.414L11 16.586V4a1 1 0 0 1 1-1z" />
          </svg>
          <span className="down-arrow__label" aria-hidden="true">
            {ctaLabel}
          </span>
        </a>
      </div>

      {/* Bottom-left promo card */}
      <div
        className="promo-card"
        data-show={showPromo}
        role="dialog"
        aria-labelledby="promo-title"
        aria-describedby="promo-desc"
      >
        <button
          className="promo-x"
          aria-label="Dismiss"
          type="button"
          onClick={() => setShowPromo(false)}
        >
          ×
        </button>

        <div className="promo-chip">Limited-time</div>

        <h3 id="promo-title" className="promo-title">Free Interactive Demo</h3>
        <p id="promo-desc" className="promo-sub">
          See how My AI PA answers calls and captures leads—live.
        </p>

        <button className="promo-cta" onClick={goToSignup} type="button">
          Start Your Free Demo
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M5 12h12m0 0-5-5m5 5-5 5"
              stroke="currentColor"
              strokeWidth="2"
              fill="none"
              strokeLinecap="round"
            />
          </svg>
        </button>

        <div className="promo-footer">No credit card • 2-minute setup</div>
      </div>
    </Container>
  );
}

export default Hero;
