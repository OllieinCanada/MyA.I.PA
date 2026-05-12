import React from "react";

const sections = [
  {
    title: "1. Agreement to These Terms",
    body: [
      "These Terms of Service govern access to and use of the My AI PA website, signup flow, AI phone answering service, call handling tools, text notifications, integrations, and related services. By using the services, creating an account, starting a trial, or authorizing service setup, you agree to these Terms.",
      "If you use the services on behalf of a business, you represent that you have authority to bind that business to these Terms.",
    ],
  },
  {
    title: "2. The Service",
    body: [
      "My AI PA provides AI-assisted phone answering, call intake, caller question handling, call summaries, owner notifications, caller confirmations, and related workflow tools for trades and service businesses.",
      "The service may depend on third-party providers for telephony, messaging, AI processing, hosting, payments, analytics, and other infrastructure. Availability, features, and performance may vary based on those providers, customer configuration, network conditions, and usage.",
    ],
  },
  {
    title: "3. Customer Responsibilities",
    body: [
      "You are responsible for providing accurate business information, scripts, FAQs, service areas, hours, routing instructions, and notification details. You are responsible for reviewing outputs and making final business decisions.",
      "You must have all rights, permissions, and authority needed to connect phone numbers, route calls, receive messages, process caller information, record or transcribe calls where applicable, and use the service for your business.",
      "You are responsible for complying with laws that apply to your business and communications, including privacy, call recording, consumer protection, telemarketing, spam, employment, accessibility, licensing, and industry-specific rules.",
    ],
  },
  {
    title: "4. AI Limitations",
    body: [
      "AI-generated responses, call summaries, classifications, and recommendations may be incomplete, inaccurate, delayed, or misunderstood. The service is not a replacement for professional judgment, emergency dispatch, legal advice, medical advice, safety review, or human supervision.",
      "You should not rely solely on AI outputs for urgent, hazardous, regulated, high-value, or legally sensitive decisions. You must verify important details before acting on them.",
    ],
  },
  {
    title: "5. Acceptable Use",
    body: [
      "You may not use the service to break the law, deceive callers, impersonate others, send unlawful spam, harass people, collect information without proper authority, violate privacy rights, transmit malware, interfere with the service, reverse engineer systems, or attempt unauthorized access.",
      "You may not configure the service to provide emergency services, regulated professional advice, discriminatory services, unlawful telemarketing, or misleading claims about pricing, warranties, licensing, availability, or response times.",
    ],
  },
  {
    title: "6. Text Messages, Calls, and Consent",
    body: [
      "The service may send text messages or other electronic messages to business owners, staff, callers, or customers. You are responsible for ensuring that message recipients have provided any required consent and that messages include required identification, contact, opt-out, and other compliance information where applicable.",
      "You are responsible for call recording and disclosure requirements. If your jurisdiction or use case requires notice or consent before recording, transcribing, or analyzing calls, you must configure your greetings, workflows, and business practices accordingly.",
    ],
  },
  {
    title: "7. Trials, Fees, Billing, and Cancellation",
    body: [
      "Trials, subscriptions, setup fees, usage fees, and plan limits may be described during signup or in a separate order, invoice, or checkout flow. Taxes, telecom charges, overages, and third-party fees may apply where stated.",
      "Unless otherwise agreed, paid services may renew automatically until cancelled. You are responsible for cancelling before renewal if you do not want charges to continue. Fees already incurred may be non-refundable except where required by law or expressly stated in writing.",
    ],
  },
  {
    title: "8. Customer Content and Data",
    body: [
      "You retain ownership of business content and caller information you provide or collect through the service, subject to the rights needed for us and our providers to operate, secure, support, improve, and deliver the service.",
      "You grant us a limited right to host, process, transmit, display, reproduce, and use customer content and caller information as reasonably necessary to provide the services and as described in the Privacy Policy.",
    ],
  },
  {
    title: "9. Confidentiality",
    body: [
      "Each party may receive non-public business, technical, financial, operational, or customer information from the other. Each party will use reasonable care to protect confidential information and use it only for purposes related to the services, except where disclosure is required by law or authorized in writing.",
    ],
  },
  {
    title: "10. Service Changes and Suspension",
    body: [
      "We may update, modify, suspend, or discontinue features from time to time. We may suspend or restrict access if we believe there is non-payment, security risk, unlawful activity, abuse, excessive usage, violation of these Terms, or risk to the service or other users.",
    ],
  },
  {
    title: "11. Disclaimers",
    body: [
      "The services are provided on an “as is” and “as available” basis to the fullest extent permitted by law. We do not guarantee that calls will always be answered, messages will always be delivered, AI outputs will always be accurate, or the service will be uninterrupted or error-free.",
      "We disclaim implied warranties of merchantability, fitness for a particular purpose, title, non-infringement, and any warranties arising from course of dealing or usage of trade, to the extent permitted by law.",
    ],
  },
  {
    title: "12. Limitation of Liability",
    body: [
      "To the fullest extent permitted by law, My AI PA will not be liable for indirect, incidental, special, consequential, exemplary, or punitive damages, or for lost profits, lost revenue, lost business, lost goodwill, lost data, missed calls, missed leads, or service interruptions.",
      "To the fullest extent permitted by law, our total liability for any claim related to the services will not exceed the amount paid by you to My AI PA for the services giving rise to the claim during the three months before the event giving rise to liability.",
    ],
  },
  {
    title: "13. Indemnity",
    body: [
      "You agree to defend, indemnify, and hold harmless My AI PA from claims, damages, losses, liabilities, costs, and expenses arising from your business, your content, your configuration of the service, your communications with callers, your violation of these Terms, or your violation of law or third-party rights.",
    ],
  },
  {
    title: "14. Governing Law",
    body: [
      "These Terms are governed by the laws of Ontario and the federal laws of Canada applicable in Ontario, without regard to conflict of law principles. Courts located in Ontario will have jurisdiction unless applicable law requires otherwise.",
    ],
  },
  {
    title: "15. Changes to These Terms",
    body: [
      "We may update these Terms from time to time. The updated version will be posted with a new effective date. Continued use of the services after changes take effect means you accept the updated Terms.",
    ],
  },
];

function Terms() {
  return (
    <main className="min-h-screen bg-[#07142a] text-white">
      <section className="border-b border-white/10 bg-[radial-gradient(circle_at_20%_0%,rgba(255,106,0,0.22),transparent_32%),linear-gradient(180deg,#081832,#07142a)]">
        <div className="mx-auto w-full max-w-5xl px-4 py-9 sm:px-8 lg:py-14">
          <a href="#/" className="text-base font-black uppercase tracking-[0.16em] text-[#ffb36b] transition hover:text-white">My AI PA</a>
          <h1 className="mt-6 text-[clamp(2.3rem,10vw,4.5rem)] font-black leading-tight tracking-[-0.05em]">Terms of Service</h1>
          <p className="mt-4 max-w-3xl text-xl font-medium leading-8 text-[#d8e7f7]">Effective date: May 11, 2026</p>
          <p className="mt-4 max-w-3xl text-lg font-medium leading-8 text-[#c8d7ea]">
            These terms are designed for an AI phone answering service used by trades and local service businesses.
          </p>
        </div>
      </section>

      <section className="mx-auto w-full max-w-5xl px-4 py-9 sm:px-8 lg:py-14">
        <div className="space-y-5">
          {sections.map((section) => (
            <article key={section.title} className="rounded-[24px] border border-white/12 bg-white/[0.045] p-5 shadow-[0_22px_60px_-46px_rgba(0,0,0,0.9)] sm:p-6">
              <h2 className="text-[1.4rem] font-black tracking-[-0.02em] text-white">{section.title}</h2>
              <div className="mt-3 space-y-3">
                {section.body.map((paragraph) => (
                  <p key={paragraph} className="text-lg font-medium leading-8 text-[#d8e7f7]">{paragraph}</p>
                ))}
              </div>
            </article>
          ))}
        </div>

        <div className="mt-8 rounded-[24px] border border-[#ff8a22]/40 bg-[#2a190a] p-5 text-base font-medium leading-7 text-[#ffe5cc]">
          These terms are a strong starting point for launch, but they should be reviewed by qualified legal counsel for your exact company, province, customers, vendors, and operating model.
        </div>
      </section>
    </main>
  );
}

export default Terms;
