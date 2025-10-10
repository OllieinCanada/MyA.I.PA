// src/components/Project/index.tsx
import { Container } from "./styles";
import ScrollAnimation from "react-animate-on-scroll";
import { useState } from "react";

type FormData = {
  name: string;
  phone: string;
  email: string;
  business: string;
};

const API_URL = "https://ai-website-169594110784.northamerica-northeast2.run.app" // ← replace with your deployed URL

export function Project() {
  const [data, setData] = useState<FormData>({
    name: "",
    phone: "",
    email: "",
    business: "",
  });
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onChange =
    (field: keyof FormData) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setData((d) => ({ ...d, [field]: e.target.value }));

  const isValidEmail = (v: string) => /\S+@\S+\.\S+/.test(v);
  const isValidPhone = (v: string) => v.replace(/[^\d]/g, "").length >= 10;

  const canSubmit =
    data.name.trim().length > 1 &&
    isValidPhone(data.phone) &&
    isValidEmail(data.email) &&
    data.business.trim().length > 1;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || sending) return;

    try {
      setSending(true);
      setError(null);

      // Send raw JSON (your hello_http supports this)
      const res = await fetch(API_URL, {
        method: "POST",
        mode: "cors",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.name,
          phone: data.phone,
          email: data.email,
          business: data.business,
        }),
      });

      if (!res.ok) {
        const msg = await res.text().catch(() => "");
        throw new Error(msg || `Request failed (${res.status})`);
      }

      setSent(true);
    } catch (err: any) {
      setError(err?.message || "Something went wrong. Please try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <Container id="pricing">
      <section className="panel">
        <ScrollAnimation animateIn="fadeInUp" animateOnce>
          <article className="trial-card">
            <h1 className="trial-title">Start Your Free Trial</h1>
            <p className="trial-sub">
              Enter your contact details and we’ll activate your free trial.
            </p>

            <div className="badge">No risk • Cancel anytime</div>

            {!sent ? (
              <form className="contact-form" onSubmit={onSubmit} noValidate>
                <div className="grid">
                  <div className="field">
                    <label htmlFor="name">Full name</label>
                    <input
                      id="name"
                      type="text"
                      placeholder="Jane Doe"
                      value={data.name}
                      onChange={onChange("name")}
                      required
                    />
                  </div>

                  <div className="field">
                    <label htmlFor="phone">Phone</label>
                    <input
                      id="phone"
                      type="tel"
                      placeholder="(905) 555-1234"
                      value={data.phone}
                      onChange={onChange("phone")}
                      required
                    />
                  </div>

                  <div className="field">
                    <label htmlFor="email">Email</label>
                    <input
                      id="email"
                      type="email"
                      placeholder="you@business.com"
                      value={data.email}
                      onChange={onChange("email")}
                      required
                    />
                  </div>

                  <div className="field">
                    <label htmlFor="business">Business name</label>
                    <input
                      id="business"
                      type="text"
                      placeholder="Acme Plumbing"
                      value={data.business}
                      onChange={onChange("business")}
                      required
                    />
                  </div>
                </div>

                {error && <div className="error">{error}</div>}

                <button
                  className="cta-submit"
                  type="submit"
                  disabled={!canSubmit || sending}
                >
                  {sending ? "Sending..." : "Request Free Trial"}
                  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
                    <path fill="currentColor" d="M13 5l7 7-7 7v-4H4v-6h9V5z" />
                  </svg>
                </button>

                <p className="microcopy">
                  We’ll contact you to confirm setup. No charges until you choose
                  a plan.
                </p>
              </form>
            ) : (
              <div className="success">
                ✅ Thanks, {data.name.split(" ")[0] || "there"}! We’ve received your
                info. We’ll text/email you shortly to activate your trial.
              </div>
            )}
          </article>
        </ScrollAnimation>
      </section>
    </Container>
  );
}
