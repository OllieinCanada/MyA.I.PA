import { useMemo, useState } from "react";
import { Container } from "./styles";
import ScrollAnimation from "react-animate-on-scroll";

const FORMESTER_URL = "https://nhwalozc.formester.com/f/9aDCM10Mw";

export function Project() {
  const [plan, setPlan] = useState<null | "tier1" | "tier2">(null);

  const iframeSrc = useMemo(() => {
    if (!plan) return null;
    const qs = new URLSearchParams({ plan });
    return `${FORMESTER_URL}?${qs.toString()}`;
  }, [plan]);

  return (
    <Container id="signup">
      <section className="panel">
        <ScrollAnimation animateIn="fadeInUp" animateOnce>
          <h1 className="trial-title">14 DAY FREE TRIAL!</h1>
          <p className="trial-sub large">No obligation - No CREDIT CARD</p>
          <p className="trial-sub large">SIGN UP TODAY!</p>

          {!plan ? (
            <>
              <div className="tier-grid">
                {/* Tier 1 */}
                <article className="tier-card">
                  <h2 className="tier-name">Light version</h2>
                  <div className="tier-price">$79/mo</div>
                  <ul className="bullets">
                    <li>24/7 Telephone Answering</li>
                    <li>Friendly, professional greeting</li>
                    <li>Collects caller's information and job details</li>
                    <li>Text summary of call sent to owner</li>
                    <li>Thank-you text / reminder summary sent to caller</li>
                  </ul>
                  <button
                    className="cta-stripe"
                    onClick={() => setPlan("tier1")}
                  >
                    Select Tier 1
                    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden>
                      <path
                        fill="currentColor"
                        d="M13 5l7 7-7 7v-4H4v-6h9V5z"
                      />
                    </svg>
                  </button>
                </article>

                {/* Tier 2 */}
                <article className="tier-card">
                  <h2 className="tier-name">Premium</h2>
                  <div className="tier-price">$129/mo</div>
                  <ul className="bullets">
                    <li>Everything in Tier 1</li>
                    <li>Calendar sync (Google / Outlook)</li>
                    <li>Auto-scheduling appointments and reminders</li>
                    <li>Personalized voice and assistant behavior</li>
                  </ul>
                  <button
                    className="cta-stripe"
                    onClick={() => setPlan("tier2")}
                  >
                    Select Tier 2
                    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden>
                      <path
                        fill="currentColor"
                        d="M13 5l7 7-7 7v-4H4v-6h9V5z"
                      />
                    </svg>
                  </button>
                </article>
              </div>

              <div className="after-signup-box">
                <h2 className="after-title">After sign up:</h2>
                <p className="after-desc">
                  <strong>15 minute consultation</strong> and you're on your way
                  to a stress-free relationship with your business phone!!
                </p>
              </div>

              <p className="contact-note">
                For questions and inquiry, contact{" "}
                <a href="mailto:oliver@myaipa.ca">oliver@myaipa.ca</a>
              </p>
            </>
          ) : (
            <>
              <h2 style={{ marginTop: "2rem" }}>
                Selected Plan:{" "}
                {plan === "tier1"
                  ? "Tier 1 — SMS Chatbot"
                  : "Tier 2 — Calendar & Appointments"}
              </h2>

              <iframe
                key={plan}
                src={iframeSrc!}
                width="100%"
                height={840}
                style={{
                  border: "none",
                  borderRadius: 16,
                  marginTop: 24,
                  boxShadow: "0 0 40px rgba(0,255,157,0.25)",
                }}
                title="My AI PA Signup Form"
              />

              <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
                <button
                  className="cta-stripe"
                  style={{ marginTop: 24 }}
                  onClick={() => setPlan(null)}
                >
                  ← Change Plan
                </button>
              </div>
            </>
          )}

          <div className="microcopy" style={{ marginTop: 24 }}>
            Your selected plan is automatically sent to the signup form.
          </div>
        </ScrollAnimation>
      </section>
    </Container>
  );
}
