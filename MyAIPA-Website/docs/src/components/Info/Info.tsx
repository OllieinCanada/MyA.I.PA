// File: src/components/About/About.tsx
import { Container } from "./styles";
import ScrollAnimation from "react-animate-on-scroll";

export function About() {
  return (
    <Container id="about">
      <div className="about-text">
        <ScrollAnimation animateIn="fadeInLeft">
          <h2>The Telephone - Your Business' Lifeline</h2>
        </ScrollAnimation>

        <div className="two-col">
          <ScrollAnimation animateIn="fadeInLeft" delay={60}>
            <section className="col">
              <h3 className="section-title">DID YOU KNOW?</h3>
              <ul className="hook-list">
                <li>62% of customers prefer to contact businesses by phone.</li>
                <li>
                  85% of callers don't call back if their call is not answered the first time.
                </li>
              </ul>

              {/* Bottom-left box directly below */}
              <div className="cta">
                <span>Slide below to see a live demo!</span>
              </div>
            </section>
          </ScrollAnimation>

          <ScrollAnimation animateIn="fadeInRight" delay={120}>
            <section className="col">
              <h3 className="section-title">HOW MY AI PA CAN HELP</h3>
              <ul className="value-list">
                <li>Always Answers The call 24/7.</li>
                <li>Engages customers in conversation.</li>
                <li>provides accurate business information.</li>
                <li>Forwards a summary text for convenient call back.</li>
                <li>Sends "thank you" text to caller.</li>
              </ul>
            </section>
          </ScrollAnimation>
        </div>
      </div>
    </Container>
  );
}
