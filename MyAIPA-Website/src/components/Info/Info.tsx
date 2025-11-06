// File: src/components/Info/Info.tsx
import { useEffect, useState } from "react";
import { Container } from "./styles";
import ScrollAnimation from "react-animate-on-scroll";

import PhoneIcon from "../../assets/phone.png";
import AIAgentIcon from "../../assets/ai_agent.png";
import ClientIcon from "../../assets/client.png";
import TextIcon from "../../assets/text_followup.png";

export function CallFlow() {
  const [firstVisit, setFirstVisit] = useState(false);

  useEffect(() => {
    const seen = sessionStorage.getItem("callflow_seen");
    if (!seen) {
      setFirstVisit(true);
      sessionStorage.setItem("callflow_seen", "1");
    }
  }, []);

  return (
    <Container id="callflow" className={`callflow ${firstVisit ? "first-visit" : ""}`}>
      <ScrollAnimation animateIn="fadeInUp" delay={40} animateOnce>
        {/* Intro */}
        <section className="intro" aria-labelledby="intro-title">
          <h2 id="intro-title" className="intro__title">
            What Is An Artificial Intelligence Personal Assistant?
          </h2>
          <p className="intro__body">
            <strong>My AI PA</strong> uses cutting-edge <strong>artificial intelligence (AI)</strong>, powered by <strong>Google</strong>, to create custom chatbots that
            <strong> answer your business calls when you’re unavailable</strong>, preventing missed opportunities and delivering a great customer experience.
            It then <strong>texts you the call details  and customer's contact information</strong> for easy follow-up.
            <strong> 85% of callers don’t call back if their call isn’t answered the first time.</strong>
            <strong> My AI PA makes sure your business is always there to respond.</strong>
          </p>
          <p className="intro__body2">
            All For The Price Of A Cup Of Coffee A Day!
          </p>
        </section>

        <h3 className="title" id="how-it-works">How It Works</h3>

        {/* ONE STRAIGHT ROW */}
        <div className="flow-row" aria-labelledby="how-it-works">
          <div className="step">
            <span className="badge">1</span>
            <img src={PhoneIcon} alt="" className="icon" />
            <h4>User Calls</h4>
            <p>The customer phones your business, but no one is available to take their call. After three rings, the call is forwarded to your AI assistant.</p>
          </div>

          <div className="arrow" aria-hidden>➜</div>

          <div className="step">
            <span className="badge">2</span>
            <img src={AIAgentIcon} alt="" className="icon" />
            <h4>AI Assistant Answers</h4>
            <p>Greets the customer and engages them in light conversation while answering FAQs. The caller is then given the opportunity to state their reason for calling.</p>
          </div>

          <div className="arrow" aria-hidden>➜</div>

          <div className="step">
            <span className="badge">3</span>
            <img src={ClientIcon} alt="" className="icon" />
            <h4>Client Feels Heard</h4>
            <p>Instead of a cold voicemail, the caller gets their needs met and provides contact information while having a natural conversation with the assistant.</p>
          </div>

          <div className="arrow" aria-hidden>➜</div>

          <div className="step">
            <span className="badge">4</span>
            <img src={TextIcon} alt="" className="icon" />
            <h4>Acknowledgement Texts Sent</h4>
            <p>A summary of the phone call is sent to both the client and the owner by text for a convenient follow-up.</p>
          </div>
        </div>
      </ScrollAnimation>
    </Container>
  );
}

export default CallFlow;
