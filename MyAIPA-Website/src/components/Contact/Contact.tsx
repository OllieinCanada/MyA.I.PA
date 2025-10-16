import { Container } from "./styles";
import ScrollAnimation from "react-animate-on-scroll";

const CHECKOUT_SIMPLE =
  (import.meta as any)?.env?.VITE_STRIPE_CHECKOUT_SIMPLE ||
  "https://buy.stripe.com/your-simple-checkout";
const CHECKOUT_PRO =
  (import.meta as any)?.env?.VITE_STRIPE_CHECKOUT_PRO ||
  "https://buy.stripe.com/your-pro-checkout";

export function Project() {
  const goToStripe = (url: string) => (window.location.href = url);

  return (
    <Container id="pricing">
      <section className="panel">
        <ScrollAnimation animateIn="fadeInUp" animateOnce>
          <h1 className="trial-title">Choose Your Plan</h1>
          <p className="trial-sub">
            Select the plan that fits your business best.
          </p>

          <div className="tier-grid">
            {/* Tier 1 */}
            <article className="tier-card">
              <h2 className="tier-name">Tier 1 — SMS Chatbot</h2>
              <div className="tier-price">$79/mo</div>
              <ul className="bullets">
                <li>14-day free trial</li>
                <li>SMS chatbot & replies</li>
                <li>Basic lead capture</li>
                <li>Includes onboarding</li>
                <li>24/7 AI phone answering</li>
              </ul>
              <button
                className="cta-stripe"
                onClick={() => goToStripe(CHECKOUT_SIMPLE)}
              >
                Start Tier 1 Free Trial
                <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden>
                  <path fill="currentColor" d="M13 5l7 7-7 7v-4H4v-6h9V5z" />
                </svg>
              </button>
            </article>

            {/* Tier 2 */}
            <article className="tier-card">
              <h2 className="tier-name">Tier 2 — Calendar & Appointments</h2>
              <div className="tier-price">$129/mo</div>
              <ul className="bullets">
                <li>14-day free trial</li>
                <li>Everything in Tier 1</li>
                <li>Calendar sync (Google/Outlook)</li>
                <li>Auto scheduling & reminders</li>
              </ul>
              <button
                className="cta-stripe"
                onClick={() => goToStripe(CHECKOUT_PRO)}
              >
                Start Tier 2 Free Trial
                <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden>
                  <path fill="currentColor" d="M13 5l7 7-7 7v-4H4v-6h9V5z" />
                </svg>
              </button>
            </article>
          </div>

          <div className="microcopy">
            You’ll be redirected to a secure Stripe page to enter payment
            details. Your trial begins immediately — no charges until it ends.
          </div>
        </ScrollAnimation>
      </section>
    </Container>
  );
}
