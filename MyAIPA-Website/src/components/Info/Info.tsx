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
            What Is My Artificial Intelligence Personal Assistant?
          </h2>
          <p className="intro__body">
            My AI PA uses cutting-edge AI (powered by Google) to create custom chatbots that answer your business calls
            when you’re unavailable. Preventing missed opportunities and delivering a great customer
            experience. It then instantly texts you the caller’s details for easy follow-up. 85% of callers don't call back if their call is not answered the first time. My AI PA solves this issue for your business

           </p>
           <p className="intro__body2">
            All For The Price Of A Cup Of Coffee A Day!
          </p>
        </section>

        <h3 className="title" id="how-it-works">How It Works</h3>

        {/* ONE STRAIGHT ROW */}
        <div className="flow-row" aria-labelledby="how-it-works">
          <div className="step">
            <img src={PhoneIcon} alt="" className="icon" />
            <h4>User Calls</h4>
            <p>The customer reaches out by phone but the business is unavailable. The call is then forwarded to our AI office.</p>
          </div>

          <div className="arrow" aria-hidden>➜</div>

          <div className="step">
            <img src={AIAgentIcon} alt="" className="icon" />
            <h4>AI Assistant Immediately Takes The Call</h4>
            <p>Answers on behalf of the unavailable business. Handles FAQs, bookings, and service requests.</p>
          </div>

          <div className="arrow" aria-hidden>➜</div>

          <div className="step">
            <img src={ClientIcon} alt="" className="icon" />
            <h4>Client Feels Heard</h4>
            <p>Instead of a cold voicemail, every caller is greeted with clear, helpful assistance. Instantaneously!</p>
          </div>

          <div className="arrow" aria-hidden>➜</div>

          <div className="step">
            <img src={TextIcon} alt="" className="icon" />
            <h4>Follow-up Texts Sent</h4>
            <p>Client and owner get acknowledgment texts with summary for convenient follow-up.</p>
          </div>
        </div>
      </ScrollAnimation>
    </Container>
  );
}

export default CallFlow;
