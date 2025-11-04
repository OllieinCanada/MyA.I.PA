// File: src/components/Hero/Hero.tsx
import { useEffect, useState } from "react";
import { Container } from "./styles";
import ScrollAnimation from "react-animate-on-scroll";
import NiceGirl from "../../assets/Nice_girl.png";

export function Hero() {
  const [firstVisit, setFirstVisit] = useState(false);
  const [ctaClicked, setCtaClicked] = useState(false);

  useEffect(() => {
    const seen = sessionStorage.getItem("hero_seen");
    if (!seen) {
      setFirstVisit(true);
      sessionStorage.setItem("hero_seen", "1");
    }
    window.scrollTo(5, 0);
  }, []);

  const scrollToAbout = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    setCtaClicked(true);
    const el = document.querySelector("#about");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

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

          <div className="circle">
            <img src={NiceGirl} alt="Assistant representative" />
          </div>

          <div className="tagline-block">
            <h2 className="tagline">NEVER MISS A CUSTOMER AGAIN!</h2>
            <ul className="bullets">
              <li>HANDLE MORE CALLS</li>
              <li>INCREASE SALES</li>
              <li>PRODUCE MORE PROFIT</li>
              <li>ENGAGE WITH CUSTOMERS 24/7</li>
            </ul>
          </div>

          <p className="bottom-line">ALL WHILE YOU'RE AWAY!</p>
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
    </Container>
  );
}

export default Hero;
