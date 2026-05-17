import React from "react";

const sections = [
  {
    title: "1. Who We Are",
    body: [
      "My AI PA provides AI-powered phone answering, call intake, caller follow-up, and business notification tools for trades and service businesses. In this Privacy Policy, “My AI PA,” “we,” “us,” and “our” refer to the operator of the My AI PA website and services.",
      "This Policy explains how we collect, use, disclose, retain, and protect personal information when someone visits our website, signs up for our services, contacts us, or interacts with an AI phone assistant configured for a customer’s business.",
    ],
  },
  {
    title: "2. Information We Collect",
    body: [
      "We may collect account and business information such as names, business names, email addresses, phone numbers, billing details, service preferences, greeting scripts, FAQs, operating hours, and other setup information provided by a customer.",
      "When the service answers calls or sends follow-up messages, we may process caller information such as caller names, phone numbers, call audio, transcripts, call summaries, requested services, job details, addresses, preferred callback times, and text-message content.",
      "We may collect technical information such as IP address, device information, browser type, pages viewed, referring pages, date and time of visits, and general usage data to operate, secure, and improve the website and services.",
    ],
  },
  {
    title: "3. How We Use Information",
    body: [
      "We use information to provide and improve the service, configure AI phone agents, answer and summarize calls, send owner alerts and caller confirmations, support accounts, process payments, prevent abuse, troubleshoot issues, and communicate with customers about their service.",
      "We may use de-identified or aggregated information to improve service reliability, quality, product design, analytics, and performance. We do not use caller information to advertise to callers on behalf of unrelated third parties.",
    ],
  },
  {
    title: "4. Call Audio, Transcripts, and AI Processing",
    body: [
      "The service may record, transcribe, summarize, analyze, and route calls so that customer businesses can receive accurate job details and follow-up information. Customers are responsible for configuring their use of the service in a way that complies with applicable call recording, consent, privacy, consumer protection, and communications laws.",
      "AI-generated responses, summaries, and classifications may not always be perfect. Customers should review important call details before relying on them for scheduling, quoting, dispatching, billing, safety, legal, medical, or emergency decisions.",
    ],
  },
  {
    title: "5. Sharing Information",
    body: [
      "We may share information with service providers that help us operate the service, including hosting, analytics, customer support, telephony, AI processing, transcription, messaging, email delivery, payment processing, security, and database providers.",
      "We may disclose information when required by law, legal process, regulatory request, fraud prevention, security investigation, enforcement of our terms, protection of rights and safety, or as part of a business transaction such as a merger, financing, reorganization, or sale of assets.",
    ],
  },
  {
    title: "6. Payments",
    body: [
      "Payments may be processed by third-party payment providers. We do not intend to store full payment card numbers on our own systems. Payment providers may collect and process payment information under their own terms and privacy policies.",
    ],
  },
  {
    title: "7. Marketing and Electronic Messages",
    body: [
      "Where required, we seek consent before sending commercial electronic messages. Marketing emails or texts may include identification information and a way to unsubscribe, unless an exemption applies. Service-related messages, account notices, transactional confirmations, and security notices may still be sent where permitted by law.",
      "Caller confirmation texts and owner alerts are intended as service-related messages. Where opt-out rules apply, recipients may be able to stop future non-essential texts using the opt-out instructions provided in the message or by contacting the business responsible for the communication.",
    ],
  },
  {
    title: "8. Retention",
    body: [
      "We retain personal information only as long as reasonably necessary for the purposes described in this Policy, including providing the service, maintaining business records, resolving disputes, enforcing agreements, meeting legal obligations, and improving security.",
      "Retention periods may vary depending on account settings, service configuration, customer instructions, legal requirements, backup cycles, and operational needs.",
    ],
  },
  {
    title: "9. Safeguards",
    body: [
      "We use reasonable administrative, technical, and physical safeguards designed to protect personal information against unauthorized access, use, disclosure, loss, or alteration. No system can be guaranteed completely secure, and customers should use strong passwords, limit access, and promptly tell us about suspected security issues.",
    ],
  },
  {
    title: "10. Cross-Border Processing",
    body: [
      "Some service providers may process or store information outside your province, state, or country. Where information is processed in another jurisdiction, it may be accessible to courts, law enforcement, or regulators in that jurisdiction.",
    ],
  },
  {
    title: "11. Access, Correction, and Choices",
    body: [
      "Individuals may request access to or correction of their personal information, subject to legal limits. Customers may also request account updates, deletion, or export of certain information where available and appropriate.",
      "To make a privacy request, contact us using the contact details available on the My AI PA website. We may need to verify identity and authority before responding.",
    ],
  },
  {
    title: "12. Children",
    body: [
      "The service is intended for businesses and is not directed to children. Customers should not knowingly configure the service to collect personal information from children except where lawful and appropriate for their business context.",
    ],
  },
  {
    title: "13. Changes to This Policy",
    body: [
      "We may update this Privacy Policy from time to time. The updated version will be posted with a new effective date. Continued use of the website or services after an update means the updated Policy applies going forward.",
    ],
  },
];

function Privacy() {
  return (
    <main className="min-h-screen bg-[#07142a] text-white">
      <section className="border-b border-white/10 bg-[radial-gradient(circle_at_20%_0%,rgba(37,99,235,0.24),transparent_34%),linear-gradient(180deg,#081832,#07142a)]">
        <div className="mx-auto w-full max-w-5xl px-4 py-9 sm:px-8 lg:py-14">
          <a href="#/" className="text-base font-black uppercase tracking-[0.16em] text-[#8ec5ff] transition hover:text-white">My AI PA</a>
          <h1 className="mt-6 text-[clamp(2rem,9vw,4.5rem)] font-black leading-tight tracking-[-0.05em]">Privacy Policy</h1>
          <p className="mt-4 max-w-3xl text-lg font-medium leading-8 text-[#d8e7f7] sm:text-xl">Effective date: May 11, 2026</p>
          <p className="mt-4 max-w-3xl text-base font-medium leading-7 text-[#c8d7ea] sm:text-lg sm:leading-8">
            This policy is written for a business phone-answering service that may process calls, texts, transcripts, summaries, and job details.
          </p>
        </div>
      </section>

      <section className="mx-auto w-full max-w-5xl px-4 py-9 sm:px-8 lg:py-14">
        <div className="space-y-5">
          {sections.map((section) => (
            <article key={section.title} className="rounded-[24px] border border-white/12 bg-white/[0.045] p-5 shadow-[0_22px_60px_-46px_rgba(0,0,0,0.9)] sm:p-6">
              <h2 className="text-[1.25rem] font-black tracking-[-0.02em] text-white sm:text-[1.4rem]">{section.title}</h2>
              <div className="mt-3 space-y-3">
                {section.body.map((paragraph) => (
                  <p key={paragraph} className="text-base font-medium leading-7 text-[#d8e7f7] sm:text-lg sm:leading-8">{paragraph}</p>
                ))}
              </div>
            </article>
          ))}
        </div>

        <div className="mt-8 rounded-[24px] border border-[#2b74d8]/50 bg-[#0b2144] p-5 text-base font-medium leading-7 text-[#d8e7f7]">
          This page is provided for business transparency and should be reviewed by qualified legal counsel before public launch or commercial reliance.
        </div>
      </section>
    </main>
  );
}

export default Privacy;
