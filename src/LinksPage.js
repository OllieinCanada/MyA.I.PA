import React from "react";
import "./LinksPage.css";

const publicAsset = (name) => `${process.env.PUBLIC_URL || ""}/${name}`;

function LinkIcon({ name }) {
  const common = {
    width: 24,
    height: 24,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.9,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
  };

  if (name === "play") return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="m10 8 6 4-6 4Z" /></svg>;
  if (name === "trial") return <svg {...common}><path d="M12 3v18M7 7.5 12 3l5 4.5" /><path d="M5 13h14a2 2 0 0 1 2 2v4H3v-4a2 2 0 0 1 2-2Z" /></svg>;
  if (name === "pricing") return <svg {...common}><path d="M20 12V6a2 2 0 0 0-2-2H8L3 9l10 10 7-7Z" /><circle cx="15.5" cy="8.5" r="1" /></svg>;
  if (name === "site") return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" /></svg>;
  if (name === "phone") return <svg {...common}><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3.1-8.6A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.6a2 2 0 0 1-.4 2.1L8 9.7a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.7.5 2.6.6a2 2 0 0 1 2 2.3Z" /></svg>;
  return <svg {...common}><rect x="3" y="5" width="18" height="14" rx="3" /><path d="m4 7 8 6 8-6" /></svg>;
}

function LinkCard({ href, icon, eyebrow, title, description, featured = false }) {
  return (
    <a className={"links-card " + (featured ? "is-featured" : "")} href={href}>
      <span className={"links-card-icon is-" + icon}><LinkIcon name={icon} /></span>
      <span className="links-card-copy">
        <small>{eyebrow}</small>
        <strong>{title}</strong>
        <span>{description}</span>
      </span>
      <span className="links-card-arrow" aria-hidden="true">›</span>
    </a>
  );
}

export default function LinksPage() {
  return (
    <main className="links-page">
      <div className="links-page-glow links-page-glow-one" />
      <div className="links-page-glow links-page-glow-two" />

      <section className="links-shell" aria-labelledby="links-title">
        <header className="links-profile">
          <a href="./#/" className="links-logo" aria-label="My AI PA home">
            <span className="links-logo-mark"><span /></span>
            <span className="links-logo-type">MY <strong>AI PA</strong></span>
          </a>
          <div className="links-canada"><span aria-hidden="true">🍁</span> Designed in Canada for busy trades businesses</div>
          <h1 id="links-title">Never miss a call again.</h1>
          <p>Hear My AI PA in action, see the simple pricing, or start your free trial.</p>
        </header>

        <div className="links-demo">
          <div className="links-demo-head">
            <span className="links-demo-icon"><LinkIcon name="play" /></span>
            <div>
              <small>Real call example</small>
              <strong>Hear the AI assistant answer a trades call</strong>
            </div>
          </div>
          <audio controls preload="metadata" src={publicAsset("tims-electrical-2.wav?v=20260614-trim")}>
            Your browser does not support the audio demo.
          </audio>
          <p>Listen to how the assistant answers questions and collects the job details.</p>
        </div>

        <nav className="links-list" aria-label="My AI PA links">
          <LinkCard
            href="./#/try-demo?source=qr"
            icon="play"
            eyebrow="30-second personalized call"
            title="Try the live demo"
            description="Answer three quick questions, then talk to an AI assistant set up for your business."
            featured
          />
          <LinkCard
            href="./#/signup"
            icon="trial"
            eyebrow="No setup fee · Cancel anytime"
            title="Start your free 14-day trial"
            description="Tell us about your business and hear your assistant before going live."
          />
          <LinkCard
            href="./?section=pricing#/"
            icon="pricing"
            eyebrow="Simple monthly plan"
            title="See pricing"
            description="$79 per month includes 60 AI call minutes."
          />
          <LinkCard
            href="./#/"
            icon="site"
            eyebrow="See the complete service"
            title="Visit the My AI PA website"
            description="See how missed calls become job details ready for your callback."
          />
          <LinkCard
            href="/proof/"
            icon="site"
            eyebrow="For employers and collaborators"
            title="See the engineering proof"
            description="Review the customer workflow, recorded demonstration, troubleshooting approach and test evidence."
          />
        </nav>

        <div className="links-contact">
          <a href="tel:+12495033301"><LinkIcon name="phone" /><span><small>Call us</small><strong>(249) 503-3301</strong></span></a>
          <a href="mailto:hello@myaipa.com"><LinkIcon name="email" /><span><small>Email us</small><strong>hello@myaipa.com</strong></span></a>
        </div>

        <footer>
          <span className="links-status-dot" />
          Built for contractors who cannot stop working to answer every call.
        </footer>
      </section>
    </main>
  );
}
