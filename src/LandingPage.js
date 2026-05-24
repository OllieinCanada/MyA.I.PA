import React, { useEffect, useRef, useState } from "react";
const proofFeatureCards = [
  {
    eyebrow: "Fast onboarding",
    title: "Easy 5-minute setup",
    body: "Fast onboarding. No technical hassle.",
    icon: "clock",
  },
  {
    eyebrow: "Keep your number",
    title: "Keep your existing business number",
    body: "No need to change the number your customers already know.",
    icon: "phone",
  },
];

const heroCallTranscript = [
  {
    time: "6:42 PM",
    speaker: "Caller",
    accent: "bg-[#9fb4cf]",
    text: "Hi, I need someone to wire up my hot tub. I didn't expect anyone to pick up since I'm calling after hours.",
  },
  {
    time: "6:42 PM",
    speaker: "My AI PA",
    accent: "bg-[#66e7b4]",
    text: "At Tim's Electrical we're always here to help. Got it. I'll forward the details to our service team.",
  },
];

const demoCallAudioSrc = `${process.env.PUBLIC_URL || ""}/tims-electrical-2.wav`;

const problemMoments = [
  {
    body: "A caller has a problem and is looking for solutions.",
    bodyLines: ["A caller has a problem", "and is looking for solutions."],
    art: "problem",
  },
  {
    body: "Your professional AI agent engages the customer and collects details for easy follow-up.",
    bodyLines: [
      "Your professional AI agent",
      "engages the customer",
      "and collects details that are",
      "sent by text to your phone",
    ],
    art: "agent",
  },
  {
    body: "With a clear plan, the customer feels heard and is more open to a future callback.",
    bodyLines: [
      "With a clear plan, the customer",
      "feels heard and is now open",
      "to a future callback.",
    ],
    art: "callback",
    artClassName: "h-[94px] w-[146px]",
  },
];

const benefitCards = [
  {
    code: "EL",
    eyebrow: "Electrical",
    accent: "from-blue-600 to-blue-500",
    glow: "shadow-[0_18px_40px_-30px_rgba(56,189,248,0.42)]",
    title: "Catch repair and estimate calls while you are on-site.",
    body: "Panel upgrades, hot tub wiring, breaker issues, and quote requests still get answered while your hands are full, with job details texted to you for follow-up.",
  },
  {
    code: "PL",
    eyebrow: "Plumbing",
    accent: "from-blue-400 to-blue-500",
    glow: "shadow-[0_18px_40px_-30px_rgba(96,165,250,0.42)]",
    title: "Keep urgent plumbing calls from going to voicemail.",
    body: "Burst pipes, drain calls, fixture installs, and emergency-service requests stay moving after hours or while you are on another job.",
  },
  {
    code: "HV",
    eyebrow: "HVAC",
    accent: "from-emerald-500 to-emerald-400",
    glow: "shadow-[0_18px_40px_-30px_rgba(52,211,153,0.42)]",
    title: "Handle HVAC repair calls after hours and in peak season.",
    body: "Furnace, AC, and maintenance callers get a real response, leave the right job details, and stay with you instead of calling the next company.",
  },
  {
    code: "GC",
    eyebrow: "General Contractors",
    accent: "from-orange-500 to-orange-400",
    glow: "shadow-[0_18px_40px_-30px_rgba(250,204,21,0.34)]",
    title: "Keep larger project and estimate calls organized.",
    body: "Renovations, additions, repairs, and site-visit requests get answered while you are managing crews, with project details sent cleanly to your phone.",
  },
];

const transcriptMoments = [
  { start: 0, end: 12, speaker: "AI assistant", text: "Thanks for calling Tim's Electrical. We help with residential and commercial electrical work. How can I help today?" },
  { start: 12, end: 27, speaker: "Caller", text: "Hi, I need someone to wire up my hot tub. I didn't expect anyone to pick up since I'm calling after hours." },
  { start: 27, end: 45, speaker: "AI assistant", text: "No problem. I can collect the details and send them to the team. Is this for a new hot tub installation or a repair?" },
  { start: 45, end: 61, speaker: "Caller", text: "It's a new install. The tub is already delivered, but I need the electrical run from the panel to the backyard." },
  { start: 61, end: 82, speaker: "AI assistant", text: "Got it. Do you know if the hot tub needs a dedicated GFCI breaker, and what address should the electrician use for the estimate?" },
  { start: 82, end: 101, speaker: "Caller", text: "Yes, it needs a dedicated breaker. The address is 63 York Street, and mornings are usually best for a callback." },
  { start: 101, end: 119, speaker: "AI assistant", text: "Thanks. I have the hot tub setup, dedicated breaker, 63 York Street, and morning callback preference. What is the best phone number to reach you?" },
  { start: 119, end: 135.14, speaker: "AI assistant", text: "Perfect. I have sent the job summary to Tim's Electrical and texted you a confirmation so the team can follow up." },
];

const waveformBars = [
  0.12, 0.18, 0.24, 0.36, 0.22, 0.4, 0.52, 0.34, 0.21, 0.18, 0.28, 0.42,
  0.31, 0.16, 0.1, 0.22, 0.48, 0.58, 0.46, 0.24, 0.18, 0.2, 0.39, 0.54,
  0.32, 0.18, 0.14, 0.26, 0.44, 0.5, 0.28, 0.16, 0.12, 0.34, 0.56, 0.62,
  0.48, 0.27, 0.18, 0.14, 0.22, 0.4, 0.55, 0.37, 0.19, 0.12, 0.2, 0.35,
];

const pricingCards = [
  {
    name: "Essential",
    price: "$49",
    suffix: "/month",
    eyebrow: "Current live plan",
    featured: true,
    accent: "from-[#2db4ff] via-[#2563eb] to-[#ff8b1f]",
    tint: "bg-[linear-gradient(145deg,#ffffff_0%,#f7fbff_58%,#fff6eb_100%)]",
    minuteNote: "Includes 60 AI call minutes. Extra minutes billed clearly as usage.",
    points: ["24/7 AI answering", "60 minutes included", "Text summaries for both sides"],
  },
  {
    name: "Growth",
    price: "$99",
    suffix: "/month",
    eyebrow: "Preview",
    featured: false,
    comingSoon: true,
    accent: "from-[#38d8d0] via-[#2db4ff] to-[#2563eb]",
    tint: "bg-[linear-gradient(145deg,#f7fcff_0%,#eaf7ff_58%,#eefcf9_100%)]",
    minuteNote: "Planned: 200 AI call minutes for busier service teams.",
    points: ["200 minutes included", "Urgency tagging", "Expanded FAQ controls"],
  },
  {
    name: "Pro",
    price: "$199",
    suffix: "/month",
    eyebrow: "Preview",
    featured: false,
    comingSoon: true,
    accent: "from-[#ff8b1f] via-[#2db4ff] to-[#38d8d0]",
    tint: "bg-[linear-gradient(145deg,#f8fcff_0%,#eaf6ff_56%,#fff7ed_100%)]",
    minuteNote: "Planned: 500 AI call minutes for higher call volume.",
    points: ["500 minutes included", "Advanced call routing", "Team notifications"],
  },
];

const setupSteps = [
  "Click Start Free Trial, add your business info, then set your greeting and common questions.",
  "Run a test call, listen back, and turn it on when you are comfortable.",
  "Keep your current business number and forward calls to My AI PA.",
];

const testimonialCards = [
  {
    quote: "I am usually on a job and not in a position to answer every call. Now people get a proper response and I get the details by text instead of chasing voicemails later.",
    name: "Mark S.",
    role: "Carpentry contractor",
  },
  {
    quote: "Evening rental inquiries used to sit until morning. Now callers get an immediate response and our team wakes up to clean lead details instead of a pile of missed calls.",
    name: "David A.",
    role: "Property manager, St. Catharines",
  },
  {
    quote: "Roof repair calls used to interrupt me while I was on ladders or meeting homeowners. Now the caller gets helped and I get the job details by text.",
    name: "Lisa S.",
    role: "Roofing contractor",
  },
  {
    quote: "Service calls come in while we are driving between plumbing jobs. My AI PA keeps the lead warm, answers basics, and sends us the follow-up details.",
    name: "Anthony R.",
    role: "Plumbing contractor",
  },
];

const faqs = [
  { q: "Will callers know they are speaking with an AI assistant?", a: "Yes. The goal is to sound clear, professional, and helpful while answering questions and collecting the right job details." },
  { q: "Do I have to change my business number?", a: "No. Keep your current number and forward calls to your My AI PA number." },
  { q: "What if someone calls after hours?", a: "Your AI assistant can still answer, help the caller, and send both sides a text follow-up." },
  { q: "Can I control what it says?", a: "Yes. You set the custom greeting and common questions so it fits your business." },
  { q: "How hard is setup?", a: "It is meant to be simple: fill in your business info, test a call, then go live with no downtime." },
];

const trustCards = [
  {
    title: "Transparent AI calls",
    body: "Callers can be told they are speaking with an AI assistant, and the service focuses on answering questions and collecting job details.",
  },
  {
    title: "Privacy and terms published",
    body: "The Privacy Policy and Terms explain call audio, transcripts, summaries, text messages, service providers, retention, and AI limitations.",
  },
  {
    title: "Consent-aware messaging",
    body: "Owner alerts and caller confirmations are treated as service messages, with SMS consent and opt-out expectations covered before launch.",
  },
];

function formatClock(totalSeconds) {
  const safe = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const minutes = Math.floor(safe / 60);
  const seconds = String(safe % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function ProblemMomentArt({ scene }) {
  const shell =
    "h-[88px] w-[132px] overflow-hidden rounded-[20px] border border-white/12 bg-[linear-gradient(180deg,rgba(18,31,52,0.98),rgba(12,22,38,0.96))] shadow-[0_18px_38px_-26px_rgba(7,13,24,0.82)]";

  const iconTone =
    scene === "missed" ? "text-rose-300 border-rose-300/30 bg-rose-300/10" :
    scene === "answer" ? "text-cyan-200 border-cyan-200/30 bg-cyan-200/10" :
    scene === "captured" ? "text-emerald-200 border-emerald-200/30 bg-emerald-200/10" :
    "text-sky-200 border-sky-200/30 bg-sky-200/10";

  const renderIcon = () => {
    switch (scene) {
      case "missed":
        return (
          <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" aria-hidden="true">
            <circle cx="8.1" cy="12.2" r="3.2" stroke="currentColor" strokeWidth="1.8" />
            <circle cx="15.9" cy="12.2" r="3.2" stroke="currentColor" strokeWidth="1.8" />
            <path d="M11.3 12.2h1.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            <path d="M18.9 7.9l1.8-1.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            <circle cx="20.8" cy="6.1" r="1.2" fill="currentColor" opacity="0.9" />
          </svg>
        );
      case "answer":
        return (
          <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" aria-hidden="true">
            <path d="M6.2 7.8h8.8a2.3 2.3 0 0 1 2.3 2.3v4.1a2.3 2.3 0 0 1-2.3 2.3h-3.3l-2.6 2.1v-2.1H6.2a2.3 2.3 0 0 1-2.3-2.3v-4.1a2.3 2.3 0 0 1 2.3-2.3Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
            <path d="M7.8 11h5.2M7.8 13.5h3.6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            <path d="M5.3 18.7 18.8 5.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
        );
      case "captured":
        return (
          <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" aria-hidden="true">
            <path d="M4.8 12.1c0-3.4 2.4-6.1 5.4-6.1s5.4 2.7 5.4 6.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            <rect x="4.8" y="12" width="1.3" height="3.3" rx=".65" fill="currentColor" />
            <rect x="14.3" y="12" width="1.3" height="3.3" rx=".65" fill="currentColor" />
            <circle cx="10.2" cy="13.1" r="3.4" stroke="currentColor" strokeWidth="1.6" />
            <path d="M8.9 12.4h.01M11.5 12.4h.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            <path d="M9 14.6c.7.7 1.9.7 2.6 0" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            <path d="M17.1 8.3h2.8M17.1 11.2h2.8M17.1 14.1h2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        );
      case "notified":
        return (
          <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" aria-hidden="true">
            <rect x="5" y="5.3" width="11.4" height="13.8" rx="2.2" stroke="currentColor" strokeWidth="1.7" />
            <path d="M8.2 9.2h5.1M8.2 12.1h5.6M8.2 15h4.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            <path d="m14.8 16.7 2.4 2.3 3.8-4.4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        );
      default:
        return null;
    }
  };

  const renderMiniContent = () => {
    switch (scene) {
      case "missed":
        return (
          <div className="flex flex-1 items-center justify-end">
            <svg viewBox="0 0 30 30" className="h-8 w-8" fill="none" aria-hidden="true">
              <path d="M8 15c0-3.7 3-6.7 6.7-6.7" stroke="rgba(251,191,36,0.86)" strokeWidth="2" strokeLinecap="round" />
              <path d="M14.7 8.3h5.4v5.4" stroke="rgba(251,191,36,0.86)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M14.9 15.1 20.1 9.9" stroke="rgba(254,240,138,0.94)" strokeWidth="2.1" strokeLinecap="round" />
              <circle cx="22.9" cy="8.1" r="2.3" fill="rgba(251,113,133,0.95)" />
            </svg>
          </div>
        );
      case "answer":
        return (
          <div className="flex flex-1 items-center justify-end">
            <svg viewBox="0 0 36 30" className="h-8 w-9" fill="none" aria-hidden="true">
              <path d="M8.4 9.4h10.4a2.2 2.2 0 0 1 2.2 2.2v3.2a2.2 2.2 0 0 1-2.2 2.2h-2.5l-2.4 2v-2H8.4a2.2 2.2 0 0 1-2.2-2.2v-3.2a2.2 2.2 0 0 1 2.2-2.2Z" stroke="rgba(125,211,252,0.8)" strokeWidth="1.6" strokeLinejoin="round" />
              <path d="M10.6 12.8h5.6M10.6 15h3.8" stroke="rgba(186,230,253,0.95)" strokeWidth="1.7" strokeLinecap="round" />
              <path d="M22.8 10.1 29 16.3" stroke="rgba(248,113,113,0.84)" strokeWidth="1.8" strokeLinecap="round" />
              <path d="M29 10.1 22.8 16.3" stroke="rgba(248,113,113,0.84)" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </div>
        );
      case "captured":
        return (
          <div className="flex flex-1 items-center justify-end">
            <svg viewBox="0 0 34 30" className="h-8 w-9" fill="none" aria-hidden="true">
              <path d="M7.2 15c0-3.1 2.3-5.6 5.2-5.6s5.2 2.5 5.2 5.6" stroke="rgba(125,211,252,0.55)" strokeWidth="1.8" strokeLinecap="round" />
              <rect x="7.2" y="14.8" width="1.4" height="3.1" rx=".7" fill="rgba(125,211,252,0.88)" />
              <rect x="16.2" y="14.8" width="1.4" height="3.1" rx=".7" fill="rgba(125,211,252,0.88)" />
              <path d="M21.4 11.1h5.2M21.4 14.6h5.2M21.4 18.1h3.8" stroke="rgba(110,231,183,0.9)" strokeWidth="2.1" strokeLinecap="round" />
            </svg>
          </div>
        );
      case "notified":
        return (
          <div className="flex flex-1 items-center justify-end">
            <svg viewBox="0 0 34 30" className="h-8 w-9" fill="none" aria-hidden="true">
              <rect x="5.8" y="6.8" width="12.8" height="15.4" rx="2.4" stroke="rgba(186,230,253,0.92)" strokeWidth="1.7" />
              <path d="M9.2 10.8h5.6M9.2 14.1h6.2M9.2 17.4h4.3" stroke="rgba(186,230,253,0.94)" strokeWidth="1.8" strokeLinecap="round" />
              <path d="m23 16.2 2.3 2.2 3.8-4.3" stroke="rgba(110,231,183,0.95)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        );
      default:
        return (
          <div className="flex flex-1 items-center justify-end">
            <span className="h-3 w-3 rounded-full bg-white/20" />
          </div>
        );
    }
  };

  return (
    <div className={shell}>
      <div className="flex h-full flex-col justify-between p-3.5">
        <div className="flex items-center justify-between">
          <span className="h-2 w-2 rounded-full bg-white/30" />
          <span className="h-2 w-2 rounded-full bg-white/12" />
        </div>
        <div className="flex items-center gap-3">
          <div className={"grid h-12 w-12 place-items-center rounded-2xl border " + iconTone}>
            {renderIcon()}
          </div>
          {renderMiniContent()}
        </div>
      </div>
    </div>
  );
}

function StoryMiniArt({ kind, className = "" }) {
  const artMap = {
    problem: {
      src: "/illustrations/phone-call.svg",
      className: "scale-[1.06]",
    },
    agent: {
      src: "/illustrations/active-support.svg",
      className: "scale-[1.08]",
    },
    callback: {
      src: "/illustrations/events-calendar.svg",
      className: "scale-[1.08]",
    },
  };

  const art = artMap[kind];

  return (
    <div className={`flex h-[108px] w-[164px] items-center justify-center overflow-hidden rounded-[24px] border border-white/12 bg-[radial-gradient(circle_at_top_left,rgba(111,161,255,0.16),transparent_42%),linear-gradient(180deg,rgba(245,249,255,0.98),rgba(235,243,255,0.98))] shadow-[0_18px_38px_-26px_rgba(7,13,24,0.82)] ${className}`}>
      {art ? (
        <img
          src={art.src}
          alt=""
          aria-hidden="true"
          className={`h-full w-full object-contain p-2.5 ${art.className}`}
          loading="lazy"
        />
      ) : null}
    </div>
  );
}

function ProofFeatureIcon({ kind }) {
  switch (kind) {
    case "clock":
      return (
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="8.2" stroke="currentColor" strokeWidth="1.8" />
          <path d="M12 7.8v4.6l3 1.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "phone":
      return (
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" aria-hidden="true">
          <path d="M7.2 4.8h2.1c.5 0 1 .3 1.2.8l1 2.3c.2.5.1 1.1-.3 1.5l-1.3 1.3c1 2 2.7 3.7 4.7 4.7l1.3-1.3c.4-.4 1-.5 1.5-.3l2.3 1c.5.2.8.7.8 1.2v2.1c0 .9-.7 1.6-1.6 1.6C9.7 20 4 14.3 4 7.2c0-.9.7-1.6 1.6-1.6h1.6Z" fill="currentColor" />
        </svg>
      );
    default:
      return null;
  }
}

function ProofFeatureCard({ eyebrow, title, icon }) {
  return (
    <article className="group relative flex h-[76px] overflow-hidden rounded-[30px] border border-[#8b5cff]/55 bg-[radial-gradient(circle_at_top_left,rgba(139,92,246,0.24),transparent_38%),radial-gradient(circle_at_bottom_right,rgba(75,55,170,0.20),transparent_42%),linear-gradient(180deg,rgba(12,8,25,0.96),rgba(5,4,12,0.98))] px-3.5 py-1.5 shadow-[0_0_0_1px_rgba(255,255,255,0.04)_inset,0_18px_44px_-30px_rgba(139,92,246,0.44)] transition-all duration-300 hover:-translate-y-1 hover:border-[#a78bfa]/80 hover:bg-[radial-gradient(circle_at_top_left,rgba(167,139,250,0.28),transparent_38%),radial-gradient(circle_at_bottom_right,rgba(83,63,190,0.22),transparent_42%),linear-gradient(180deg,rgba(14,9,30,0.98),rgba(5,4,12,0.98))] hover:shadow-[0_0_0_1px_rgba(167,139,250,0.18)_inset,0_24px_60px_-26px_rgba(139,92,246,0.58)] focus-within:-translate-y-1 focus-within:border-[#a78bfa]/80 focus-within:shadow-[0_0_0_1px_rgba(167,139,250,0.18)_inset,0_24px_60px_-26px_rgba(139,92,246,0.58)] sm:h-[82px] sm:px-4 sm:py-2">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.10),transparent_40%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(139,92,246,0.18),transparent_40%,rgba(40,23,92,0.22)_100%)] opacity-90" />
      <div className="pointer-events-none absolute inset-0 bg-[#8b5cff]/10 opacity-70 blur-2xl transition-opacity duration-300 group-hover:opacity-100" />
      <div className="relative flex h-full w-full items-center gap-2.5">
        <div className="mt-0 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-[#a78bfa]/45 bg-[#120b28]/78 text-[#e9ddff] shadow-[0_0_18px_rgba(139,92,246,0.22),inset_0_1px_0_rgba(255,255,255,0.08)] transition duration-300 group-hover:border-[#c4b5fd]/75 group-hover:bg-[#201044] group-hover:text-white sm:h-10 sm:w-10">
          <ProofFeatureIcon kind={icon} />
        </div>
        <div className="min-w-0">
          <p className="text-[0.62rem] font-bold uppercase tracking-[0.24em] text-[#c4b5fd]">{eyebrow}</p>
          <h3 className="mt-1 max-w-[15ch] text-[1.06rem] font-black leading-[0.96] tracking-[-0.04em] text-white sm:text-[1.18rem]">
            {title}
          </h3>
        </div>
      </div>
    </article>
  );
}

function BenefitSymbol({ code }) {
  switch (code) {
    case "EL":
      return (
        <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" aria-hidden="true">
          <path d="M13.2 2.8 6.8 13h4.2L10 21.2 17.2 11h-4.4z" fill="currentColor" />
        </svg>
      );
    case "PL":
      return (
        <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" aria-hidden="true">
          <path d="M5 7.5h8.2a3.3 3.3 0 0 1 3.3 3.3v5.7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M8.2 4.8v5.4M13 16.5h7" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M3.8 5.2h4.4v4.6H3.8zM15.6 14.2h4.6v4.6h-4.6z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        </svg>
      );
    case "HV":
      return (
        <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" aria-hidden="true">
          <path d="M12 2.8v4.1M12 17.1v4.1M4.6 12h4.1M15.3 12h4.1M6.8 6.8l2.9 2.9M14.3 14.3l2.9 2.9M17.2 6.8l-2.9 2.9M9.7 14.3l-2.9 2.9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="12" cy="12" r="2.7" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      );
    case "GC":
      return (
        <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" aria-hidden="true">
          <path d="M4.5 18.4h15" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
          <path d="M7 18.2v-7.1l5-3.7 5 3.7v7.1" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M10.1 18.2v-4.6h3.8v4.6" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M6.3 9.8h11.4M8.2 7.2l2-2.7h3.6l2 2.7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M16.7 5.2h2.1l.9 1.7-1.5 1.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    default:
      return null;
  }
}

function SectionHeader({ eyebrow, title, body, dark = false, align = "left" }) {
  const textAlign = align === "center" ? "text-center" : "text-left";
  const maxWidth = align === "center" ? "mx-auto max-w-3xl" : "max-w-3xl";

  return (
    <div className={`${textAlign} ${maxWidth}`}>
      {eyebrow ? <p className={"text-xs font-black uppercase tracking-[0.18em] " + (dark ? "text-[#eef6f1]" : "text-[#e2f0fa]")}>{eyebrow}</p> : null}
      <h2 className={"mt-3 text-3xl font-black leading-tight tracking-[-0.04em] sm:text-4xl " + (dark ? "text-white" : "text-[#f7fbff]")}>{title}</h2>
      {body ? <p className={"mt-4 text-base font-medium leading-7 sm:text-lg " + (dark ? "text-[#eef6f1]" : "text-[#eef6ff]")}>{body}</p> : null}
    </div>
  );
}

function PrimaryButton({ children, onClick, className = "" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "inline-flex items-center justify-center rounded-full bg-[#1d7df2] px-6 py-3.5 text-sm font-black uppercase tracking-[0.14em] text-white shadow-[0_18px_40px_-24px_rgba(29,125,242,0.75)] transition hover:-translate-y-0.5 hover:bg-[#146fdf] sm:text-[0.95rem] " +
        className
      }
    >
      {children}
    </button>
  );
}

function SecondaryButton({ children, onClick, dark = false, className = "" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "inline-flex items-center justify-center rounded-full border px-6 py-3.5 text-sm font-black uppercase tracking-[0.14em] transition sm:text-[0.95rem] " +
        (dark ? "border-white/45 bg-[#1a2942] text-white hover:bg-[#233755]" : "border-white/40 bg-[#1a2942] text-white hover:bg-[#233755]") +
        " " +
        className
      }
    >
      {children}
    </button>
  );
}

function HeroLogoMark() {
  return (
    <div className="flex items-center gap-3">
      <div className="relative grid h-[52px] w-[52px] place-items-center text-[#07142a] xl:h-14 xl:w-14">
        <svg viewBox="0 0 72 72" className="h-full w-full" fill="none" aria-hidden="true">
          <g transform="translate(2 0)">
            <path d="M14 40v-6C14 21.8 23.8 12 36 12s22 9.8 22 22v6" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M14 37h7v18h-7a5 5 0 0 1-5-5v-8a5 5 0 0 1 5-5Z" fill="currentColor" />
            <path d="M58 37h-7v18h7a5 5 0 0 0 5-5v-8a5 5 0 0 0-5-5Z" fill="currentColor" />
            <path d="M52 54c0 6.2-5.7 10-13.2 10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
            <path d="M36 64h-5.5" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
          </g>
          {[21, 26, 31, 36, 41, 46, 51].map((x, index) => {
            const heights = [15, 22, 28, 32, 28, 22, 15];
            const height = heights[index];
            return (
              <rect key={x} x={x} y={36 - height / 2} width="3.6" height={height} rx="1.8" fill="#ff7a00" />
            );
          })}
        </svg>
      </div>
      <div className="text-[2.1rem] font-black leading-none tracking-[-0.045em] text-[#07142a] sm:text-[2.45rem] xl:text-[2.65rem]">
        My <span className="bg-[linear-gradient(90deg,#2563eb,#8fbfff)] bg-clip-text text-transparent">AI PA</span>
      </div>
    </div>
  );
}

function HeroIcon({ type, className = "h-6 w-6" }) {
  if (type === "phone") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
        <path d="M22 16.9v2.5a2 2 0 0 1-2.2 2 19.5 19.5 0 0 1-8.5-3 19 19 0 0 1-5.8-5.8 19.5 19.5 0 0 1-3-8.5A2 2 0 0 1 4.5 2h2.6a2 2 0 0 1 2 1.7c.1.9.3 1.7.6 2.5a2 2 0 0 1-.5 2.1l-1.1 1.1a15.5 15.5 0 0 0 5.7 5.7l1.1-1.1a2 2 0 0 1 2.1-.5c.8.3 1.6.5 2.5.6a2 2 0 0 1 1.7 1.8Z" />
      </svg>
    );
  }
  if (type === "people") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
        <circle cx="8" cy="9" r="3" />
        <circle cx="16" cy="9" r="3" />
        <path d="M3 20c.6-3.2 2.4-5 5-5s4.4 1.8 5 5" />
        <path d="M11 20c.6-3.2 2.4-5 5-5s4.4 1.8 5 5" />
      </svg>
    );
  }
  if (type === "chat") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
        <path d="M5 17.6 4 21l3.6-1A8.8 8.8 0 1 0 5 17.6Z" />
        <path d="M8 12h.01M12 12h.01M16 12h.01" strokeLinecap="round" />
      </svg>
    );
  }
  if (type === "user") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
        <circle cx="12" cy="7.4" r="4.2" />
        <path d="M4.5 21c.9-4.2 3.5-6.4 7.5-6.4s6.6 2.2 7.5 6.4H4.5Z" />
      </svg>
    );
  }
  if (type === "briefcase") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
        <rect x="4" y="7" width="16" height="13" rx="2" />
        <path d="M9 7V5h6v2M9 13h6" />
      </svg>
    );
  }
  if (type === "pin") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
        <path d="M12 22s7-6.1 7-13a7 7 0 1 0-14 0c0 6.9 7 13 7 13Z" />
        <circle cx="12" cy="9" r="2.4" fill="#f8fbff" />
      </svg>
    );
  }
  if (type === "clock") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (type === "check") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
        <path d="m5 12 4.5 4.5L20 6.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (type === "bolt") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.1" aria-hidden="true">
        <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" strokeLinejoin="round" />
      </svg>
    );
  }
  if (type === "faucet") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.1" aria-hidden="true">
        <path d="M5 10h9a4 4 0 0 1 4 4v1" />
        <path d="M6 6h7v4H6zM9 6V3h5" />
        <path d="M18 15c-1.8 1.8-1.8 3.8 0 5.5 1.8-1.7 1.8-3.7 0-5.5Z" />
      </svg>
    );
  }
  if (type === "fan") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.1" aria-hidden="true">
        <circle cx="12" cy="12" r="2.2" />
        <path d="M12 9.8C9.2 4.6 12.8 2 16 4.2c2.7 1.9.4 5.6-4 5.6ZM14.1 13.1c5.8.2 6.4 4.6 2.8 6.2-3 1.4-5-2.6-2.8-6.2ZM9.8 13.1c-3 5-7 3.7-7.1-.2-.1-3.3 4.5-3.6 7.1.2Z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.1" aria-hidden="true">
      <path d="M4 19V9l8-6 8 6v10" />
      <path d="M9 19v-6h6v6" />
    </svg>
  );
}

function HeroWave({ small = false }) {
  const bars = small ? [4, 7, 10, 6, 13, 18, 9, 24, 13, 8, 16, 10] : [12, 18, 26, 16, 34, 48, 22, 60, 34, 20, 44, 26, 14, 30, 18, 10, 24, 38, 18, 12];
  return (
    <div className={(small ? "h-7" : "h-12") + " flex items-center justify-center gap-1"}>
      {bars.map((height, index) => (
        <span key={`hero-wave-${index}`} className={(small ? "w-[2px]" : "w-[3px]") + " rounded-full bg-[#9edaff]"} style={{ height }} />
      ))}
    </div>
  );
}

function CustomerAvatar({ compact = false }) {
  return (
    <span className={(compact ? "h-8 w-8" : "h-9 w-9") + " grid shrink-0 place-items-center rounded-full bg-[linear-gradient(145deg,#ffe8c7,#ffffff)] text-[#12324f] shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_8px_18px_-16px_rgba(255,184,90,0.95)]"}>
      <svg viewBox="0 0 28 28" className={compact ? "h-8 w-8" : "h-[34px] w-[34px]"} fill="none" aria-hidden="true">
        <path d="M5.6 23.5c1.25-5 4.1-7.45 8.4-7.45s7.15 2.45 8.4 7.45" fill="#12324f" />
        <circle cx="14" cy="10.35" r="5.15" fill="#12324f" />
        <path d="M6.6 9.15c2.35-5.1 10.35-6.5 14.75-.75-3.9-.95-6.75-.55-8.75.85-1.8 1.25-3.5 1.3-6 .0Z" fill="#ff9a22" />
        <circle cx="16.7" cy="8.6" r="1.4" fill="#ffffff" opacity="0.9" />
      </svg>
    </span>
  );
}

function AiAssistantAvatar({ compact = false }) {
  return (
    <span className={(compact ? "h-8 w-8" : "h-9 w-9") + " grid shrink-0 place-items-center rounded-full bg-[linear-gradient(145deg,#dff8ff,#ffffff)] text-[#063a83] shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_0_18px_-10px_rgba(72,255,123,0.95)]"}>
      <svg viewBox="0 0 28 28" className={compact ? "h-8 w-8" : "h-[34px] w-[34px]"} fill="none" aria-hidden="true">
        <rect x="6" y="8.2" width="16" height="13" rx="4.7" fill="#063a83" />
        <path d="M9.1 8.2V5.5a4.9 4.9 0 0 1 9.8 0v2.7" stroke="#063a83" strokeWidth="2.4" strokeLinecap="round" />
        <circle cx="11.4" cy="14.5" r="1.45" fill="#dff8ff" />
        <circle cx="16.6" cy="14.5" r="1.45" fill="#dff8ff" />
        <path d="M11.7 17.6c1.45 1.1 3.15 1.1 4.6 0" stroke="#dff8ff" strokeWidth="1.9" strokeLinecap="round" />
        <path d="M22.3 11.6h2.1M22.3 17.1h2.1M3.6 11.6h2.1M3.6 17.1h2.1" stroke="#39ff6a" strokeWidth="2.2" strokeLinecap="round" />
        <circle cx="22.5" cy="6.2" r="2.55" fill="#39ff6a" />
      </svg>
    </span>
  );
}

function HeroPhoneMockup() {
  return (
    <div className="landing-phone relative mx-auto -mt-12 h-[623px] w-full max-w-[375px] rounded-[38px] border-[5px] border-[#35373e] bg-[#050912] p-2 shadow-[0_30px_80px_-34px_rgba(0,0,0,1),0_0_0_1px_rgba(255,255,255,0.22)_inset] 2xl:-mt-14 2xl:h-[646px] 2xl:max-w-[385px]">
      <div className="absolute left-1/2 top-3 z-10 h-5 w-16 -translate-x-1/2 rounded-full bg-black" />
      <div className="flex h-full flex-col overflow-hidden rounded-[30px] bg-[radial-gradient(circle_at_50%_0%,rgba(8,90,158,0.34),transparent_36%),linear-gradient(180deg,#061b34_0%,#020814_100%)] px-5 pb-3 pt-4">
        <div className="flex items-center justify-between text-white">
          <span className="text-[0.96rem] font-black tracking-[-0.02em]">After-hours</span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-4 rounded-sm border border-white/80" />
            <span className="h-2.5 w-5 rounded-sm border border-white/80 bg-white/20" />
          </span>
        </div>
        <div className="mt-0.5 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-[#48ff7b]/60 bg-[#043d1c]/88 px-3 py-1 text-[0.74rem] font-black uppercase tracking-[0.14em] text-[#b9ffc9] shadow-[0_0_18px_-8px_rgba(72,255,123,0.9)]">
            <span className="h-2 w-2 rounded-full bg-[#39ff6a] shadow-[0_0_12px_rgba(57,255,106,0.95)]" />
            AI speaking now
          </div>
          <p className="mt-1 text-[1.35rem] font-black tracking-[-0.03em] text-white">Live Call</p>
          <p className="mt-1 text-[1.25rem] font-black text-[#ff7a00]">00:32</p>
          <HeroWave small />
        </div>

        <div className="mt-1.5 rounded-[20px] border border-white/14 bg-white/[0.08] px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
          <div className="flex gap-2.5">
            <CustomerAvatar />
            <div>
              <p className="text-[0.96rem] font-black leading-tight text-white">Customer</p>
              <p className="mt-0.5 text-[0.85rem] font-medium leading-[1.28] text-white">Hi, I need someone to wire up my hot tub this week.</p>
            </div>
          </div>
        </div>

        <div className="mt-1.5 rounded-[20px] border border-[#1d78ff]/45 bg-[linear-gradient(145deg,#063a83,#0050c9)] px-3 py-2 shadow-[0_18px_46px_-28px_rgba(0,80,201,0.95),inset_0_1px_0_rgba(255,255,255,0.12)]">
          <div className="flex gap-2.5">
            <AiAssistantAvatar />
            <div>
              <p className="text-[0.96rem] font-black leading-tight text-white">My AI PA</p>
              <p className="mt-0.5 text-[0.85rem] font-medium leading-[1.28] text-white">
                Yes. I can collect the details so the team can follow up.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-1.5 rounded-[20px] border border-white/14 bg-white/[0.08] px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
          <div className="flex gap-2.5">
            <CustomerAvatar />
            <div>
              <p className="text-[0.96rem] font-black leading-tight text-white">Customer</p>
              <p className="mt-0.5 text-[0.85rem] font-medium leading-[1.28] text-white">
                Brian, 905-123-4567, 63 York Street. Best time is 7:00 PM.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-1.5 rounded-[20px] border border-[#1d78ff]/45 bg-[linear-gradient(145deg,#063a83,#0050c9)] px-3 py-2 shadow-[0_18px_46px_-28px_rgba(0,80,201,0.95),inset_0_1px_0_rgba(255,255,255,0.12)]">
          <div className="flex gap-2">
            <AiAssistantAvatar compact />
            <div>
              <p className="text-[0.96rem] font-black leading-tight text-white">My AI PA</p>
              <p className="mt-0.5 text-[0.85rem] font-medium leading-[1.28] text-white">
                Got It! I&apos;ll forward the details of this call to our service team, and we will get back regarding pricing and scheduling.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-auto flex items-center justify-between px-10 pt-1">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-white/14 text-white">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
              <path d="M12 3v10" />
              <rect x="8" y="3" width="8" height="13" rx="4" />
              <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
            </svg>
          </span>
          <span className="grid h-9 w-9 place-items-center rounded-full bg-[#ff392e] text-white">
            <HeroIcon type="phone" className="h-5 w-5 rotate-[135deg]" />
          </span>
          <span className="grid h-8 w-8 place-items-center rounded-full bg-white/14 text-white">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
              <path d="M4 9v6h4l5 4V5L8 9H4Z" />
              <path d="M16.5 9.5a4 4 0 0 1 0 5M19 7a8 8 0 0 1 0 10" />
            </svg>
          </span>
        </div>
      </div>
    </div>
  );
}

function HeroSummaryStack() {
  const rows = [
    ["user", "Customer Name", "Brian"],
    ["phone", "Phone", "905-123-4567"],
    ["briefcase", "Job Type", "Hot tub setup"],
    ["pin", "Address", "63 York Street"],
    ["clock", "Best Call Back Time", "7:00 PM"],
  ];

  return (
    <div className="landing-summary mx-auto w-full max-w-[430px] space-y-1.5 md:grid md:max-w-[900px] md:grid-cols-2 md:gap-4 md:space-y-0 xl:block xl:max-w-none xl:space-y-1.5">
      <div className="rounded-[34px] border-[5px] border-[#27313f] bg-[#07111f] p-2 shadow-[0_30px_88px_-42px_rgba(7,17,31,0.9)]">
        <div className="relative overflow-hidden rounded-[26px] bg-[#f8fbff] px-4 pb-2 pt-8 text-[#081123]">
          <span className="absolute left-1/2 top-2 h-4 w-20 -translate-x-1/2 rounded-full bg-[#111827]" />
          <div className="flex items-center justify-between gap-3 border-b border-[#dbe6f3] pb-3">
            <div className="min-w-0 flex-1">
              <p className="text-[0.68rem] font-black uppercase tracking-[0.16em] text-[#2563eb]">Messages</p>
              <h3 className="whitespace-nowrap text-[0.86rem] font-black leading-tight tracking-[-0.045em] sm:text-[1.02rem]">My AI PA - TIM&apos;S ELECTRICAL</h3>
              <p className="mt-0.5 text-[0.78rem] font-black uppercase tracking-[0.12em] text-[#64748b]">Texted to owner</p>
            </div>
            <span className="shrink-0 rounded-full bg-[#00b84a] px-2.5 py-1 text-[0.68rem] font-black uppercase tracking-[0.12em] text-white shadow-[0_0_16px_-8px_rgba(0,184,74,0.95)] sm:px-3 sm:text-xs">Now</span>
          </div>
          <div className="mt-4 rounded-[22px] bg-[#dbeafe] px-4 py-3 shadow-[0_8px_20px_-18px_rgba(15,23,42,0.5)]">
            <p className="text-[0.92rem] font-black text-[#0b3b7a]">New service lead</p>
            <div className="mt-2 space-y-1.5 text-[0.98rem] font-semibold leading-6 text-[#10233f]">
              {rows.map(([, label, value]) => (
                <p key={label}><span className="font-black">{label}:</span> {value}</p>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-[30px] border-[4px] border-[#27313f] bg-[#07111f] p-2 shadow-[0_24px_78px_-42px_rgba(7,17,31,0.85)]">
        <div className="relative overflow-hidden rounded-[23px] bg-[#f8fbff] px-4 pb-2 pt-7 text-[#081123]">
          <span className="absolute left-1/2 top-2 h-3 w-16 -translate-x-1/2 rounded-full bg-[#111827]" />
          <div className="flex items-center justify-between gap-3 border-b border-[#dbe6f3] pb-3">
            <div className="min-w-0 flex-1">
              <p className="text-[0.68rem] font-black uppercase tracking-[0.16em] text-[#2563eb]">Messages</p>
              <h3 className="whitespace-nowrap text-[0.84rem] font-black leading-tight tracking-[-0.04em] sm:text-[0.98rem]">My AI PA - TIM&apos;S ELECTRICAL</h3>
              <p className="mt-0.5 text-[0.74rem] font-black uppercase tracking-[0.12em] text-[#64748b]">Texted to customer</p>
            </div>
            <span className="shrink-0 rounded-full bg-[#00b84a] px-2.5 py-1 text-[0.68rem] font-black uppercase tracking-[0.12em] text-white shadow-[0_0_16px_-8px_rgba(0,184,74,0.95)] sm:px-3 sm:text-xs">Now</span>
          </div>
          <div className="mt-4 max-w-[92%] rounded-[22px] bg-[#e5e7eb] px-4 py-3 text-[0.98rem] font-semibold leading-6 text-[#111827]">
            Thanks for calling Tim&apos;s Electrical. We got your request and will follow up shortly.
          </div>
        </div>
      </div>
    </div>
  );
}

function HeroTradeStrip() {
  const trades = [
    ["bolt", "Electricians"],
    ["faucet", "Plumbers"],
    ["fan", "HVAC"],
    ["contractor", "Contractors"],
  ];

  return (
    <div className="landing-trade-strip grid overflow-hidden rounded-[22px] border border-white/18 bg-white/[0.045] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] sm:grid-cols-2 lg:grid-cols-4">
      {trades.map(([icon, label], index) => (
        <div key={label} className={"trade-item flex items-center justify-center gap-4 px-5 py-3 " + (index ? "border-t border-white/12 sm:border-l sm:border-t-0" : "")}>
          <span className="grid h-12 w-12 place-items-center rounded-full border border-[#3d8fff]/55 bg-[#063170] text-white shadow-[0_0_32px_-16px_rgba(59,130,246,1)] 2xl:h-14 2xl:w-14">
            <HeroIcon type={icon} className="h-6 w-6 2xl:h-7 2xl:w-7" />
          </span>
          <span className="text-lg font-black text-white 2xl:text-xl">{label}</span>
        </div>
      ))}
    </div>
  );
}

function VoicemailLossesArtboard() {
  const voicemailProblems = [
    ["Customers want help", "right away"],
    ["If nobody answers,", "they may call someone else"],
    ["Missed calls become", "missed repair jobs"],
    ["Voicemail can't answer", "questions or collect details"],
  ];

  const assistantBenefits = [
    ["Always Responds", "After 3 Rings"],
    ["Always answers when", "you can't - 24/7"],
    ["Engages customers,", "answers questions,", "collects job details."],
  ];

  const processCards = [
    {
      number: "1",
      y: 145,
      lines: [
        "A customer needs help",
        "right away.",
        "If nobody answers,",
        "they may call the",
        "next contractor.",
      ],
      image: "/illustrations/phone-call.svg",
    },
    {
      number: "2",
      y: 380,
      lines: [
        "Your AI assistant answers",
        "after around 3 rings.",
        "It answers questions,",
        "engages the caller, and",
        "collects the job details.",
      ],
      image: "/illustrations/active-support.svg",
    },
    {
      number: "3",
      y: 630,
      lines: [
        "The owner and customer",
        "both get clear text",
        "messages on their",
        "cellphones for easy",
        "follow-up.",
      ],
      image: "/illustrations/events-calendar.svg",
    },
  ];

  return (
    <section className="overflow-hidden bg-transparent py-2">
      <div className="mx-auto w-full max-w-5xl px-4 py-8 lg:hidden">
        <div className="text-left">
          <h2 className="text-[clamp(2.25rem,9vw,4rem)] font-black leading-[1.05] tracking-[-0.05em] text-[#07142a]">
            Relax! Let your <span className="bg-[linear-gradient(180deg,#dffcf2,#38d8d0_55%,#2563eb)] bg-clip-text text-transparent">A.I</span>
            <span className="block bg-[linear-gradient(180deg,#2f8de6,#0b3b7a)] bg-clip-text text-transparent">Personal assistant</span>
            <span className="block">take the call.</span>
          </h2>
          <div className="mt-3 h-1.5 w-32 rounded-full bg-[#ff8a13]" />
        </div>

        <div className="mt-8 rounded-[28px] border border-[#c4d6eb] bg-[linear-gradient(180deg,#183962,#071a36)] p-4 shadow-[0_24px_70px_-45px_rgba(7,20,42,0.75)] sm:p-6">
          <div className="mx-auto max-w-md rounded-full border border-[#b7d9ff]/70 bg-[#12325e] px-5 py-3 text-center text-[1rem] font-black uppercase tracking-[0.16em] text-white">
            Why Voicemail Loses
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <div className="rounded-[24px] border border-rose-400/70 bg-[linear-gradient(180deg,#7d1c3b,#3b1027)] p-5 text-white">
              <p className="text-center text-[1.05rem] font-black uppercase tracking-[0.2em]">Voicemail</p>
              <h3 className="mx-auto mt-3 max-w-sm text-center text-[1.7rem] font-black leading-tight">Voicemail creates real problems</h3>
              <div className="mt-5 h-px bg-rose-300/70" />
              <div className="mt-5 space-y-4">
                {voicemailProblems.map((lines) => (
                  <div key={lines.join(" ")} className="flex gap-3">
                    <span className="mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-rose-400 text-white">
                      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                        <path d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5" strokeLinecap="round" />
                      </svg>
                    </span>
                    <p className="text-[1.12rem] font-medium leading-7">{lines.join(" ")}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[24px] border border-emerald-300/70 bg-[linear-gradient(180deg,#0f806f,#074337)] p-5 text-white">
              <p className="text-center text-[1.05rem] font-black uppercase tracking-[0.2em]">AI Assistant</p>
              <h3 className="mx-auto mt-3 max-w-sm text-center text-[1.7rem] font-black leading-tight">Let your agent take the call 24/7</h3>
              <div className="mt-5 h-px bg-emerald-300/70" />
              <div className="mt-5 space-y-4">
                {assistantBenefits.map((lines) => (
                  <div key={lines.join(" ")} className="flex gap-3">
                    <span className="mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-emerald-300 text-[#06352d]">
                      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                        <path d="m5 12 4 4 10-10" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                    <p className="text-[1.12rem] font-medium leading-7">{lines.join(" ")}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-6 rounded-[22px] border border-white/30 bg-[#071832]/80 px-4 py-4 text-center">
            <p className="text-[1.45rem] font-black leading-tight text-white">How AI Converts <span className="text-[#ff9d22]">missed callers into customers</span></p>
          </div>

          <div className="mt-4 grid gap-4">
            {processCards.map((item) => (
              <div key={item.number} className="grid gap-4 rounded-[24px] border border-white/28 bg-[linear-gradient(145deg,rgba(13,33,62,0.96),rgba(8,24,48,0.98))] p-4 text-white sm:grid-cols-[76px_1fr_170px] sm:items-center">
                <div className="grid h-16 w-16 place-items-center rounded-full border border-[#9edaff] bg-[linear-gradient(145deg,#73c7ff,#2563eb)] text-[2rem] font-black">
                  {item.number}
                </div>
                <p className="text-[1.18rem] font-black leading-8 tracking-[-0.02em]">{item.lines.join(" ")}</p>
                <div className="flex h-36 items-center justify-center rounded-[20px] bg-[linear-gradient(180deg,#f7fbff,#e7f1ff)] sm:h-32">
                  <img src={item.image} alt="" aria-hidden="true" className="h-full w-full object-contain p-4" loading="lazy" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mx-auto hidden w-[calc(100vw-1rem)] max-w-[min(1672px,calc(178.25svh-2rem))] lg:block">
        <svg viewBox="0 0 1672 938" className="block h-auto w-full" role="img" aria-label="AI assistant comparison showing why voicemail loses and how AI converts callers into customers">
          <defs>
            <linearGradient id="vmBlueText" x1="0" x2="0" y1="105" y2="175" gradientUnits="userSpaceOnUse">
              <stop stopColor="#2f8de6" />
              <stop offset="1" stopColor="#0b3b7a" />
            </linearGradient>
            <linearGradient id="vmAiArtifactText" x1="540" x2="720" y1="25" y2="112" gradientUnits="userSpaceOnUse">
              <stop stopColor="#dffcf2" />
              <stop offset="0.35" stopColor="#8deecf" />
              <stop offset="0.68" stopColor="#38d8d0" />
              <stop offset="1" stopColor="#7d75d8" />
            </linearGradient>
            <linearGradient id="vmCardBlue" x1="0" x2="0" y1="0" y2="1">
              <stop stopColor="#183962" stopOpacity="0.92" />
              <stop offset="1" stopColor="#071a36" stopOpacity="0.96" />
            </linearGradient>
            <linearGradient id="vmRose" x1="0" x2="0" y1="0" y2="1">
              <stop stopColor="#7d1c3b" />
              <stop offset="1" stopColor="#3b1027" />
            </linearGradient>
            <linearGradient id="vmGreen" x1="0" x2="0" y1="0" y2="1">
              <stop stopColor="#0f806f" />
              <stop offset="1" stopColor="#074337" />
            </linearGradient>
            <linearGradient id="vmNumber" x1="0" x2="1" y1="0" y2="1">
              <stop stopColor="#8be1ff" />
              <stop offset="1" stopColor="#2563eb" />
            </linearGradient>
            <filter id="vmShadow" x="-20%" y="-20%" width="140%" height="150%">
              <feDropShadow dx="0" dy="18" stdDeviation="24" floodColor="#000000" floodOpacity="0.38" />
            </filter>
            <filter id="vmTextShadow" x="-10%" y="-10%" width="120%" height="140%">
              <feDropShadow dx="0" dy="7" stdDeviation="0" floodColor="#22344f" floodOpacity="0.85" />
            </filter>
            <filter id="vmAiArtifactGlow" x="-45%" y="-80%" width="190%" height="260%">
              <feDropShadow dx="0" dy="0" stdDeviation="1.2" floodColor="#d8fff2" floodOpacity="0.45" />
              <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor="#4dffe7" floodOpacity="0.28" />
              <feDropShadow dx="0" dy="0" stdDeviation="9" floodColor="#1d65bd" floodOpacity="0.20" />
            </filter>
            <filter id="vmGlowRose" x="-40%" y="-40%" width="180%" height="180%">
              <feDropShadow dx="0" dy="22" stdDeviation="26" floodColor="#fb7185" floodOpacity="0.34" />
            </filter>
            <filter id="vmGlowGreen" x="-40%" y="-40%" width="180%" height="180%">
              <feDropShadow dx="0" dy="22" stdDeviation="26" floodColor="#2dd4bf" floodOpacity="0.34" />
            </filter>
          </defs>

          <rect width="1672" height="938" fill="transparent" />

          <g fontFamily="Arial, Helvetica, sans-serif">
            <text x="55" y="88" fill="#07142a" fontSize="72" fontWeight="900" letterSpacing="-3">
              Relax! Let your
            </text>
            <text x="622" y="88" fill="url(#vmAiArtifactText)" stroke="#0b3b7a" strokeOpacity="0.45" strokeWidth="0.55" fontSize="72" fontWeight="900" letterSpacing="3" filter="url(#vmAiArtifactGlow)">
              A.I
            </text>
            <text x="55" y="172" fill="url(#vmBlueText)" fontSize="72" fontWeight="900" letterSpacing="-3">
              Personal assistant
            </text>
            <text x="55" y="242" fill="#07142a" fontSize="66" fontWeight="900" letterSpacing="-3">
              take the call.
            </text>
          </g>
          <path d="M38 106C92 100 161 100 254 106" fill="none" stroke="#ff8a13" strokeWidth="5" strokeLinecap="round" />

          <rect x="28" y="280" width="800" height="626" rx="24" fill="url(#vmCardBlue)" stroke="#c4d6eb" strokeOpacity="0.55" strokeWidth="1.3" filter="url(#vmShadow)" />
          <rect x="242" y="250" width="430" height="64" rx="32" fill="#12325e" stroke="#b7d9ff" strokeOpacity="0.7" strokeWidth="1.2" />
          <text x="457" y="291" textAnchor="middle" fill="#ffffff" fontFamily="Arial, Helvetica, sans-serif" fontSize="23" fontWeight="900" letterSpacing="5">
            WHY VOICEMAIL LOSES
          </text>

          <g filter="url(#vmGlowRose)">
            <rect x="40" y="319" width="350" height="557" rx="28" fill="url(#vmRose)" stroke="#ff6977" strokeWidth="1.3" />
            <circle cx="221.5" cy="383" r="43" fill="#9e2943" fillOpacity="0.32" stroke="#ff6977" strokeOpacity="0.7" />
            <circle cx="211" cy="383" r="11" fill="none" stroke="#ffffff" strokeWidth="4.5" />
            <circle cx="233" cy="383" r="11" fill="none" stroke="#ffffff" strokeWidth="4.5" />
            <path d="M211 394h22" stroke="#ffffff" strokeWidth="4.5" strokeLinecap="round" />
            <text x="221.5" y="452" textAnchor="middle" fill="#ffffff" fontFamily="Arial, Helvetica, sans-serif" fontSize="21" fontWeight="900" letterSpacing="8">
              VOICEMAIL
            </text>
            <text x="221.5" y="498" textAnchor="middle" fill="#ffffff" fontFamily="Arial, Helvetica, sans-serif" fontSize="27" fontWeight="900">
              <tspan x="221.5">Voicemail creates</tspan>
              <tspan x="221.5" dy="35">real problems</tspan>
            </text>
            <line x1="96" y1="560" x2="334" y2="560" stroke="#ff6977" strokeWidth="1.5" />
            {voicemailProblems.map((lines, index) => {
              const y = 612 + index * 62;
              return (
                <g key={lines.join(" ")}>
                  <circle cx="112" cy={y + 4} r="14" fill="#ef5e62" />
                  <path d={`M107 ${y - 1}l10 10M117 ${y - 1}l-10 10`} stroke="#ffffff" strokeWidth="3" strokeLinecap="round" />
                  <text x="136" y={y + 1} fill="#ffffff" fontFamily="Arial, Helvetica, sans-serif" fontSize="19" fontWeight="600">
                    {lines.map((line, lineIndex) => (
                      <tspan key={line} x="136" dy={lineIndex ? 24 : 0}>
                        {line}
                      </tspan>
                    ))}
                  </text>
                </g>
              );
            })}
          </g>

          <g filter="url(#vmGlowGreen)">
            <rect x="455" y="319" width="357" height="557" rx="28" fill="url(#vmGreen)" stroke="#42dac4" strokeWidth="1.3" />
            <circle cx="623.5" cy="383" r="43" fill="#71e9d1" fillOpacity="0.14" stroke="#78ffe7" strokeOpacity="0.55" />
            <rect x="604" y="373" width="39" height="29" rx="10" fill="none" stroke="#ffffff" strokeWidth="5" />
            <path d="M614 373v-10M633 373v-10M623.5 363v-7" stroke="#ffffff" strokeWidth="4" strokeLinecap="round" />
            <circle cx="616" cy="387" r="2.8" fill="#ffffff" />
            <circle cx="631" cy="387" r="2.8" fill="#ffffff" />
            <path d="M617 395c4.5 3.6 9 3.6 13.5 0" stroke="#ffffff" strokeWidth="4" strokeLinecap="round" />
            <text x="623.5" y="452" textAnchor="middle" fill="#ffffff" fontFamily="Arial, Helvetica, sans-serif" fontSize="21" fontWeight="900" letterSpacing="5">
              AI ASSISTANT
            </text>
            <text x="623.5" y="486" textAnchor="middle" fill="#ffffff" fontFamily="Arial, Helvetica, sans-serif" fontSize="24" fontWeight="900">
              <tspan x="623.5">AI answers when</tspan>
              <tspan x="623.5" dy="30">you can&apos;t, 24/7.</tspan>
            </text>
            <line x1="491" y1="575" x2="756" y2="575" stroke="#55e6cf" strokeWidth="1.5" />
            {assistantBenefits.map((lines, index) => {
              const y = 625 + index * 78;
              return (
                <g key={lines.join(" ")}>
                  <circle cx="486" cy={y + 4} r="15" fill="#62e8c7" />
                  <path d={`M479 ${y + 3}l5 5 10-12`} fill="none" stroke="#064438" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                  <text x="524" y={y + 1} fill="#ffffff" fontFamily="Arial, Helvetica, sans-serif" fontSize="18" fontWeight="700">
                    {lines.map((line, lineIndex) => (
                      <tspan key={line} x="524" dy={lineIndex ? 23 : 0}>
                        {line}
                      </tspan>
                    ))}
                  </text>
                </g>
              );
            })}
          </g>

          <g filter="url(#vmShadow)">
            <circle cx="423" cy="587" r="34" fill="#09264b" stroke="#9edaff" strokeWidth="2.3" />
            <path d="M406 587h29M426 577l11 10-11 10" fill="none" stroke="#ffffff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
          </g>

          <rect x="940" y="41" width="720" height="83" rx="28" fill="#071832" fillOpacity="0.82" stroke="#ffffff" strokeOpacity="0.62" strokeWidth="1.2" />
          <text x="1300" y="94" textAnchor="middle" fill="#ffffff" fontFamily="Arial, Helvetica, sans-serif" fontSize="24" fontWeight="900">
            How AI Converts <tspan fill="#ff9d22">missed callers into customers</tspan>
          </text>

          {processCards.map((item) => (
            <g key={item.number}>
              <rect x="1015" y={item.y} width="627" height="215" rx="28" fill="url(#vmCardBlue)" stroke="#ffffff" strokeOpacity="0.42" strokeWidth="1.2" filter="url(#vmShadow)" />
              <circle cx="1066" cy={item.y + 80} r="30" fill="url(#vmNumber)" stroke="#9edaff" strokeWidth="1.4" />
              <text x="1066" y={item.y + 91} textAnchor="middle" fill="#ffffff" fontFamily="Arial, Helvetica, sans-serif" fontSize="36" fontWeight="900">
                {item.number}
              </text>
              <line x1="1110" y1={item.y + 47} x2="1110" y2={item.y + 140} stroke="#ffffff" strokeOpacity="0.28" strokeWidth="1.4" />
              <text x="1112" y={item.y + 58} fill="#ffffff" fontFamily="Arial, Helvetica, sans-serif" fontSize="18" fontWeight="900">
                {item.lines.map((line, index) => (
                  <tspan key={line} x="1112" dy={index ? 24 : 0}>
                    {line}
                  </tspan>
                ))}
              </text>
              <rect x="1432" y={item.y + 15} width="188" height="186" rx="20" fill="#f4f8ff" />
              <image href={item.image} x="1442" y={item.y + 30} width="168" height="156" preserveAspectRatio="xMidYMid meet" />
            </g>
          ))}
        </svg>
      </div>
    </section>
  );
}

function LandingPage() {
  const demoRef = useRef(null);
  const pricingRef = useRef(null);
  const faqRef = useRef(null);
  const audioRef = useRef(null);

  const [audioPlaying, setAudioPlaying] = useState(false);
  const [audioTime, setAudioTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(135.14);
  const [audioError, setAudioError] = useState("");
  const [openFaq, setOpenFaq] = useState(0);
  const [showHeader, setShowHeader] = useState(false);
  const headerHideTimerRef = useRef(null);

  const activeTranscript =
    transcriptMoments.find((item) => audioTime >= item.start && audioTime < item.end) || transcriptMoments[transcriptMoments.length - 1];

  const goToSignup = () => {
    window.location.hash = "/signup";
  };

  const scrollToRef = (ref) => {
    ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const playDemo = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    scrollToRef(demoRef);
    try {
      setAudioError("");
      await audio.play();
      setAudioPlaying(true);
    } catch (_err) {
      setAudioError("The demo audio could not start. Please tap play again or refresh the page.");
    }
  };

  const toggleAudio = async () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (audio.paused) {
      try {
        setAudioError("");
        await audio.play();
        setAudioPlaying(true);
      } catch (_err) {
        setAudioError("The demo audio could not start. Please tap play again or refresh the page.");
      }
      return;
    }

    audio.pause();
    setAudioPlaying(false);
  };

  const handleScrub = (event) => {
    const audio = audioRef.current;
    if (!audio) return;
    const nextTime = Number(event.target.value || 0);
    audio.currentTime = nextTime;
    setAudioTime(nextTime);
  };

  const playbackProgress = Math.max(0, Math.min(1, audioTime / Math.max(audioDuration, 1)));

  useEffect(() => {
    const hideAfterIdle = () => {
      if (headerHideTimerRef.current) {
        window.clearTimeout(headerHideTimerRef.current);
      }

      headerHideTimerRef.current = window.setTimeout(() => {
        setShowHeader(false);
      }, 1500);
    };

    const onScroll = () => {
      if (window.scrollY > 40) {
        setShowHeader(true);
        hideAfterIdle();
      } else {
        setShowHeader(false);
        if (headerHideTimerRef.current) {
          window.clearTimeout(headerHideTimerRef.current);
        }
      }
    };

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (headerHideTimerRef.current) {
        window.clearTimeout(headerHideTimerRef.current);
      }
    };
  }, []);

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#ffffff_0%,#f7fbff_7%,#eaf6ff_22%,#dff1ff_100%)] text-[#07142a]">
      <header
        className={
          "fixed inset-x-0 top-0 z-40 border-b border-[#d7e7fb] bg-white/92 backdrop-blur transition-all duration-300 " +
          (showHeader ? "translate-y-0 opacity-100" : "pointer-events-none -translate-y-full opacity-0")
        }
      >
        <div className="mx-auto grid w-full max-w-[1660px] grid-cols-[auto_1fr_auto] items-center gap-4 px-5 py-4 sm:px-8 lg:px-10">
          <HeroLogoMark />

          <div className="hidden justify-self-center text-center lg:block">
            <p className="text-sm font-black uppercase tracking-[0.14em] text-[#334155]">Hear the agent live right now:</p>
            <a href="tel:+19055550137" className="mt-1 block text-xl font-black tracking-[-0.02em] text-[#ff9a22] transition hover:text-[#ffb35c]">
              (905) 555-0137
            </a>
          </div>

          <div className="flex items-center gap-5">
            <button
              type="button"
              onClick={goToSignup}
              className="rounded-xl bg-[linear-gradient(180deg,#ff7a00,#ff6500)] px-5 py-3 text-sm font-black text-white shadow-[0_18px_42px_-24px_rgba(255,106,0,0.95)] transition hover:-translate-y-0.5 hover:brightness-110 sm:px-6 sm:text-base 2xl:px-7 2xl:py-4 2xl:text-xl"
            >
              Start Free Trial
            </button>
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden bg-transparent">
        <style>{`
          .marker-highlight {
            border-radius: 0.2em;
            box-decoration-break: clone;
            -webkit-box-decoration-break: clone;
            color: #07142a;
            font-weight: 900;
            padding: 0.08em 0.22em;
            background-image: linear-gradient(104deg, rgba(255, 240, 74, 0) 0%, #fff04a 10%, #fff04a 92%, rgba(255, 240, 74, 0) 100%);
            background-repeat: no-repeat;
            background-size: 0% 72%;
            background-position: 0 72%;
            animation: markerSwipe 0.95s cubic-bezier(0.2, 0.72, 0.18, 1) 1.2s forwards;
          }
          .marker-highlight--second {
            animation-delay: 1.55s;
          }
          @keyframes markerSwipe {
            from {
              background-size: 0% 72%;
            }
            to {
              background-size: 100% 72%;
            }
          }
          .pricing-card {
            position: relative;
            overflow: hidden;
            isolation: isolate;
            transition: transform 0.28s ease, box-shadow 0.28s ease, border-color 0.28s ease;
          }
          .pricing-card:hover {
            transform: translateY(-6px);
            box-shadow: 0 30px 85px -46px rgba(15, 23, 42, 0.42), 0 18px 48px -38px rgba(45, 180, 255, 0.72);
          }
          .pricing-card::after {
            content: "";
            pointer-events: none;
            position: absolute;
            inset: 1px;
            z-index: -1;
            border-radius: 29px;
            background:
              linear-gradient(118deg, rgba(255,255,255,0.92) 0%, rgba(255,255,255,0.22) 22%, rgba(255,255,255,0) 38%),
              radial-gradient(circle at 16% 0%, rgba(45,180,255,0.20), transparent 34%),
              radial-gradient(circle at 94% 10%, rgba(255,139,31,0.13), transparent 28%);
            opacity: 0.82;
            transition: opacity 0.28s ease, transform 0.28s ease;
          }
          .pricing-card:hover::after {
            opacity: 1;
            transform: scale(1.015);
          }
          .pricing-card::before {
            content: "";
            pointer-events: none;
            position: absolute;
            inset: 0;
            border-radius: 30px;
            padding: 3px;
            background:
              linear-gradient(90deg, #2db4ff 50%, transparent 0) 0 0 / 0% 3px no-repeat,
              linear-gradient(180deg, #2db4ff 50%, transparent 0) 100% 0 / 3px 0% no-repeat,
              linear-gradient(270deg, #ff8b1f 50%, transparent 0) 100% 100% / 0% 3px no-repeat,
              linear-gradient(0deg, #ff8b1f 50%, transparent 0) 0 100% / 3px 0% no-repeat;
            transition:
              background-size 0.16s cubic-bezier(0.35, 0, 0.2, 1) 0.33s,
              background-size 0.16s cubic-bezier(0.35, 0, 0.2, 1) 0.22s,
              background-size 0.16s cubic-bezier(0.35, 0, 0.2, 1) 0.11s,
              background-size 0.16s cubic-bezier(0.35, 0, 0.2, 1) 0s;
          }
          .pricing-card:hover::before {
            background-size: 100% 3px, 3px 100%, 100% 3px, 3px 100%;
            transition:
              background-size 0.16s cubic-bezier(0.35, 0, 0.2, 1) 0s,
              background-size 0.16s cubic-bezier(0.35, 0, 0.2, 1) 0.11s,
              background-size 0.16s cubic-bezier(0.35, 0, 0.2, 1) 0.22s,
              background-size 0.16s cubic-bezier(0.35, 0, 0.2, 1) 0.33s;
          }
          @media (min-width: 1024px) and (max-height: 900px) {
            .landing-hero-shell {
              padding-top: 1.25rem;
              padding-bottom: 1.5rem;
            }
            .landing-hero-grid {
              gap: 2rem;
              padding-top: 2.2rem;
              padding-bottom: 2.5rem;
            }
            .landing-hero-title {
              font-size: clamp(3.1rem, 3.47vw, 3.94rem);
              line-height: 1.03;
            }
            .landing-hero-kicker {
              margin-top: 0.85rem;
              font-size: 2.05rem;
            }
            .landing-hero-copy {
              margin-top: 0.9rem;
              max-width: 43rem;
              font-size: 1.22rem;
              line-height: 1.55;
            }
            .landing-hero-points {
              margin-top: 1.35rem;
              gap: 0.9rem;
            }
            .landing-hero-point {
              font-size: 1.24rem;
            }
            .landing-hero-point-icon {
              width: 2.55rem;
              height: 2.55rem;
            }
            .landing-hero-ctas {
              margin-top: 1.55rem;
            }
            .landing-hero-cta {
              min-height: 3.65rem;
              padding-left: 2rem;
              padding-right: 2rem;
              font-size: 1.18rem;
            }
            .landing-hero-footnote {
              margin-top: 1.15rem;
              font-size: 1.08rem;
            }
            .landing-phone {
              height: 603px;
              margin-top: -3rem;
              max-width: 360px;
            }
            .landing-summary {
              transform: none;
            }
          }
        `}</style>
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_16%_18%,rgba(187,222,255,0.74),transparent_30%),radial-gradient(circle_at_78%_12%,rgba(213,235,255,0.70),transparent_32%),linear-gradient(180deg,#ffffff_0%,#f6fbff_28%,#e9f6ff_100%)]" />
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(37,99,235,0.06)_1px,transparent_1px),linear-gradient(rgba(37,99,235,0.045)_1px,transparent_1px)] bg-[size:76px_76px] opacity-[0.32]" />

        <div className="landing-hero-shell relative z-10 mx-auto flex w-full max-w-[1660px] flex-col px-5 py-6 sm:px-8 lg:min-h-screen lg:px-10 lg:py-7 2xl:px-12 2xl:py-8">
          <nav className="grid shrink-0 gap-5 lg:grid-cols-[auto_1fr_auto] lg:items-center">
            <HeroLogoMark />
            <div className="hidden justify-self-center text-center lg:block">
              <p className="text-sm font-black uppercase tracking-[0.14em] text-[#334155]">Hear the agent live right now:</p>
              <a href="tel:+19055550137" className="mt-1 block text-xl font-black tracking-[-0.02em] text-[#ff9a22] transition hover:text-[#ffb35c]">
                (905) 555-0137
              </a>
            </div>
            <div className="flex flex-wrap items-center gap-3 sm:gap-5 lg:justify-end">
              <button
                type="button"
                onClick={goToSignup}
                className="rounded-xl bg-[linear-gradient(180deg,#ff7a00,#ff6500)] px-5 py-3 text-base font-black text-white shadow-[0_18px_42px_-24px_rgba(255,106,0,0.95)] transition hover:-translate-y-0.5 hover:brightness-110 sm:px-6 sm:py-3.5 sm:text-lg 2xl:px-7 2xl:py-4 2xl:text-xl"
              >
                Start Free Trial
              </button>
            </div>
          </nav>

          <div className="landing-hero-grid grid flex-1 gap-9 py-9 lg:grid-cols-[minmax(0,1fr)_375px] lg:items-center xl:grid-cols-[minmax(640px,1fr)_375px_340px] 2xl:grid-cols-[minmax(680px,1fr)_385px_360px] 2xl:gap-10 2xl:py-10">
            <div className="min-w-0 max-w-[800px] xl:max-w-none lg:-translate-y-6 2xl:-translate-y-8">
              <div className="mt-3 inline-flex rounded-full border border-[#b9d8ff] bg-white/72 px-4 py-2 text-lg font-semibold text-[#0b3b7a] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_18px_42px_-34px_rgba(37,99,235,0.7)] 2xl:px-5 2xl:text-xl">
                AI Phone Answering Assistant
              </div>

              <h1 className="landing-hero-title mt-5 text-[clamp(2.65rem,12vw,4.07rem)] font-black leading-[1.03] tracking-[-0.055em] text-[#07142a] 2xl:text-[4.32rem]">
                <span className="block xl:whitespace-nowrap drop-shadow-[0_3px_0_rgba(148,190,255,0.45)]">Answers the phone</span>
                <span className="block pb-2 bg-[linear-gradient(180deg,#ff9a22,#ff6b00)] bg-clip-text text-transparent drop-shadow-[0_4px_0_rgba(255,107,0,0.16)]">
                  when you can&apos;t.
                </span>
              </h1>

              <p className="landing-hero-kicker mt-3 text-[clamp(2.05rem,7vw,3.35rem)] font-black leading-[0.98] tracking-[-0.055em] text-[#e93621] drop-shadow-[0_4px_0_rgba(255,169,92,0.34)] 2xl:text-[3.55rem]">Never Miss A Call Again!</p>
              <p className="landing-hero-copy mt-3 max-w-[700px] text-[1.2rem] font-medium leading-8 text-[#243044] sm:text-[1.28rem] 2xl:text-[1.34rem] 2xl:leading-9">
                <span className="marker-highlight">24/7 AI call answering</span> for busy trades businesses.
                <br />
                Sends you an <span className="marker-highlight marker-highlight--second">instant text summary after every call.</span>
              </p>

              <div className="landing-hero-points mt-6 space-y-3.5">
                {[
                  ["phone", "Speaks with callers"],
                  ["people", "Eliminates voicemail hangups"],
                  ["chat", "Works with your current number and texts you the details"],
                ].map(([icon, label]) => (
                  <div key={label} className="landing-hero-point flex items-center gap-4 text-[1.28rem] font-medium text-[#16243a] 2xl:text-[1.36rem]">
                    <span className="landing-hero-point-icon grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#0c4da0] text-white shadow-[0_10px_28px_-16px_rgba(59,130,246,1)]">
                      <HeroIcon type={icon} className="h-5 w-5" />
                    </span>
                    <span>{label}</span>
                  </div>
                ))}
              </div>

              <div className="landing-hero-ctas mt-7 flex flex-col gap-4 sm:flex-row">
                <button
                  type="button"
                  onClick={goToSignup}
                  className="landing-hero-cta inline-flex min-h-[62px] items-center justify-center rounded-xl bg-[linear-gradient(180deg,#ff8a13,#ff6900)] px-10 text-[1.2rem] font-black text-white shadow-[0_22px_46px_-26px_rgba(255,106,0,1)] transition hover:-translate-y-0.5 hover:brightness-110 2xl:min-h-[66px] 2xl:text-[1.28rem]"
                >
                  Start Free Trial
                </button>
                <button
                  type="button"
                  onClick={playDemo}
                  className="landing-hero-cta inline-flex min-h-[62px] items-center justify-center rounded-xl border-2 border-[#1d5ea8]/70 bg-white/50 px-10 text-[1.2rem] font-black text-[#0b3b7a] transition hover:bg-white 2xl:min-h-[66px] 2xl:text-[1.28rem]"
                >
                  Hear Agent&apos;s Voice
                </button>
              </div>

              <p className="landing-hero-footnote mt-5 text-lg font-medium text-[#334155] 2xl:text-xl">PIPEDA Compliant&nbsp;&nbsp;&bull;&nbsp;&nbsp;14-day free trial&nbsp;&nbsp;&bull;&nbsp;&nbsp;No credit card / No obligation needed!</p>
            </div>

            <div className="relative lg:-translate-y-2 2xl:translate-y-0">
              <HeroPhoneMockup />
            </div>

            <div className="xl:hidden lg:col-span-2 lg:pt-1">
              <HeroSummaryStack />
            </div>

            <div className="hidden xl:block xl:self-start xl:-translate-y-3">
              <HeroSummaryStack />
            </div>
          </div>

        </div>
      </section>

      <section className="hidden">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_74%_20%,rgba(112,70,255,0.30),transparent_28%),radial-gradient(circle_at_58%_84%,rgba(93,76,255,0.42),transparent_22%),radial-gradient(circle_at_94%_70%,rgba(207,79,255,0.22),transparent_24%),linear-gradient(180deg,#030106_0%,#05040d_58%,#020106_100%)]" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-48 bg-[radial-gradient(ellipse_at_center,rgba(119,74,255,0.32),transparent_52%)]" />

        <div className="relative z-10 mx-auto grid w-full max-w-6xl gap-10 px-4 pb-12 pt-10 sm:px-6 sm:pb-14 sm:pt-12 lg:grid-cols-[0.92fr_1.08fr] lg:items-center lg:px-8 lg:pt-8">
          <div className="-translate-y-6 lg:-translate-x-16 lg:-translate-y-10 xl:-translate-x-28 xl:-translate-y-12 2xl:-translate-x-36">
            <div className="inline-flex max-w-full translate-y-7 flex-nowrap items-baseline gap-3 rounded-full border border-[#7d58ff]/70 bg-black/34 px-5 py-3 shadow-[0_0_30px_rgba(120,84,255,0.22)]">
              <p className="text-[1.32rem] font-bold leading-none tracking-[-0.04em] text-white sm:text-[1.52rem]">
                My <span className="bg-[linear-gradient(135deg,#58c9ff_0%,#4f7cff_100%)] bg-clip-text text-transparent">AI PA</span>
              </p>
              <p className="text-[0.82rem] font-bold uppercase tracking-[0.18em] text-[#f3f0ff] sm:text-[0.94rem]">
                - Telephone Answering Assistant
              </p>
            </div>

            <h1 className="mt-8 max-w-3xl text-[3rem] font-black uppercase leading-[0.9] tracking-[-0.06em] text-white sm:text-[4.25rem] sm:leading-[0.88] lg:text-[5rem]">
              <span className="block sm:whitespace-nowrap">Answers the phone</span>
              <span className="block bg-[linear-gradient(135deg,#8b5cff_0%,#6e7dff_46%,#39b9ff_100%)] bg-clip-text text-transparent">
                when you can&apos;t
              </span>
            </h1>

            <p className="mt-2 text-[2rem] font-black leading-tight tracking-[-0.04em] text-[#ff5757] sm:text-[2.35rem]">
              Never Miss A Call Again!
            </p>
            <div className="mt-6 space-y-3.5">
              <div className="flex items-start gap-3">
                <span className="mt-2.5 h-2.5 w-2.5 rounded-full bg-[#a78bfa] shadow-[0_0_16px_rgba(167,139,250,0.85)]" />
                <p className="text-[1.1rem] font-medium leading-8 text-[#e8e4ff] sm:text-[1.25rem]">Speaks with callers</p>
              </div>
              <div className="flex items-start gap-3">
                <span className="mt-2.5 h-2.5 w-2.5 rounded-full bg-[#a78bfa] shadow-[0_0_16px_rgba(167,139,250,0.85)]" />
                <p className="text-[1.1rem] font-medium leading-8 text-[#e8e4ff] sm:text-[1.25rem]">Eliminates voicemail hangups</p>
              </div>
              <div className="flex items-start gap-3">
                <span className="mt-2.5 h-2.5 w-2.5 rounded-full bg-[#a78bfa] shadow-[0_0_16px_rgba(167,139,250,0.85)]" />
                <p className="text-[1.1rem] font-medium leading-8 text-[#e8e4ff] sm:text-[1.25rem]">Sends you a text summary for easy follow-up</p>
              </div>
            </div>

            <div className="relative mt-9 sm:min-h-[146px] sm:max-w-[640px]">
              <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
                <button
                  type="button"
                  onClick={goToSignup}
                  className="inline-flex items-center justify-center rounded-[14px] bg-[linear-gradient(135deg,#7b6cff_0%,#6b29ff_100%)] px-7 py-4 text-[0.95rem] font-black uppercase tracking-[0.16em] text-white shadow-[0_18px_46px_-18px_rgba(118,87,255,0.95),0_0_0_1px_rgba(255,255,255,0.1)_inset] transition hover:-translate-y-0.5"
                >
                  Start Free Trial
                </button>
                <button
                  type="button"
                  onClick={playDemo}
                  className="inline-flex items-center justify-center rounded-full border border-[#966cff]/70 bg-black/35 px-7 py-3.5 text-[0.95rem] font-black uppercase tracking-[0.16em] text-white transition hover:bg-[#20113f]"
                >
                  Hear Agent&apos;s Voice
                </button>
              </div>

              <div className="mt-4 rounded-[22px] border border-[#c78c52]/45 bg-[rgba(199,140,82,0.14)] px-4 py-3 text-sm font-black uppercase leading-6 tracking-[0.08em] text-[#ffe1bb] shadow-[0_20px_40px_-28px_rgba(199,140,82,0.55)] sm:hidden">
                Free 14 day trial: No credit card and no obligations REQUIRED
              </div>

              <svg
                viewBox="0 0 340 140"
                className="pointer-events-none absolute left-0 top-[10px] hidden h-[140px] w-[340px] text-[#b895ff] opacity-80 sm:block"
                aria-hidden="true"
              >
                <defs>
                  <marker
                    id="hero-cta-arrowhead"
                    markerWidth="18"
                    markerHeight="18"
                    refX="13.5"
                    refY="8"
                    orient="auto"
                    markerUnits="userSpaceOnUse"
                  >
                    <path d="M0 0L14 8L0 16" fill="none" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
                  </marker>
                </defs>
                <path
                  d="M176 118C140 131 107 139 76 137C40 134 20 114 19 79C18 57 22 42 34 29"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="5"
                  strokeLinecap="round"
                  markerEnd="url(#hero-cta-arrowhead)"
                />
              </svg>

              <div className="hidden rounded-[18px] border border-[#8b5cff]/50 bg-[#10091e]/85 px-4 py-3 text-sm font-black uppercase leading-6 tracking-[0.08em] text-[#eadcff] shadow-[0_20px_50px_-24px_rgba(139,92,246,0.65)] sm:absolute sm:left-[182px] sm:top-[84px] sm:block sm:max-w-[360px]">
                  Free 14 day trial: No credit card and no obligations REQUIRED
              </div>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-2 sm:gap-4">
              {proofFeatureCards.map((item) => (
                <ProofFeatureCard
                  key={item.title}
                  eyebrow={item.eyebrow}
                  title={item.title}
                  icon={item.icon}
                />
              ))}
            </div>
          </div>

          <div className="relative z-10 lg:-translate-x-16 lg:-translate-y-10 xl:-translate-x-20 xl:-translate-y-12">
            <div className="flex justify-center lg:justify-start">
                  <div className="relative w-full max-w-[390px] translate-y-5 rotate-0 rounded-[42px] border border-white/25 bg-[linear-gradient(135deg,#2a2932,#05050a_22%,#0c0914_70%,#302944)] p-3 shadow-[0_36px_80px_-28px_rgba(0,0,0,0.95),0_0_56px_rgba(119,74,255,0.34)]">
                    <div className="absolute left-1/2 top-3 h-6 w-24 -translate-x-1/2 rounded-b-2xl bg-black" />
                    <div className="w-full rounded-[32px] border border-white/8 bg-[radial-gradient(circle_at_top,rgba(111,81,255,0.30),rgba(4,4,12,0.98)_44%),linear-gradient(180deg,#090812_0%,#030308_100%)] px-4 pb-5 pt-7">
                      <div className="mt-0.5 px-1">
                        <div className="mt-2 space-y-3">
                          {heroCallTranscript.map((item) => {
                            const isCaller = item.speaker === "Caller";
                            const bubbleStyles = isCaller
                              ? "border-[#d6dbe5] bg-[#eef1f6] text-[#0f172a] shadow-[0_1px_0_rgba(255,255,255,0.7)_inset,0_8px_18px_-18px_rgba(15,23,42,0.22)]"
                              : "border-[#875cff] bg-[linear-gradient(135deg,#6e55ff,#8a35ff)] text-white shadow-[0_0_28px_rgba(128,91,255,0.35)]";
                            const labelStyles = isCaller ? "text-[#53617a]" : "text-white/86";
                            const timeStyles = isCaller ? "text-[#6f7d95]" : "text-white/82";
                            const dotStyles = isCaller ? "bg-[#8ea0b8]" : "bg-white/88";
                            const tailColor = isCaller ? "#eef1f6" : "#7a48ff";
                            const tailBorder = isCaller ? "#d6dbe5" : "#875cff";

                            return (
                              <div
                                key={`${item.time}-${item.speaker}-${item.text}`}
                                className={"relative overflow-visible rounded-[28px] border px-4 py-3.5 " + bubbleStyles}
                              >
                                <div
                                  aria-hidden="true"
                                  className={
                                    "pointer-events-none absolute bottom-0 h-7 w-7 overflow-hidden " +
                                    (isCaller ? "-left-[10px]" : "-right-[10px]")
                                  }
                                >
                                  <div
                                    className={
                                      "absolute bottom-[-4px] h-8 w-8 rotate-[-45deg] rounded-bl-[18px] rounded-tr-[18px] border-l border-b " +
                                      (isCaller ? "left-[3px]" : "right-[3px] scale-x-[-1]")
                                    }
                                    style={{ backgroundColor: tailColor, borderColor: tailBorder }}
                                  />
                                </div>
                                <div className="relative z-10">
                                  <div className="flex items-center gap-2.5">
                                    <span className={`h-2.5 w-2.5 rounded-full ${dotStyles}`} />
                                    <p className={"text-[10px] font-black uppercase tracking-[0.16em] " + labelStyles}>{item.speaker}</p>
                                    <span className={"h-px flex-1 " + (isCaller ? "bg-[#cad3df]" : "bg-white/22")} />
                                    <p className={"text-[10px] font-black uppercase tracking-[0.14em] " + timeStyles}>{item.time}</p>
                                  </div>
                                  <p className={"mt-2 text-[0.94rem] font-semibold leading-6 " + (isCaller ? "text-[#101828]" : "text-white")}>{item.text}</p>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>

                    <div className="pointer-events-none absolute left-full top-1/2 hidden -translate-x-24 -translate-y-1/2 pl-5 lg:block xl:-translate-x-20">
                      <div className="flex items-center gap-2">
                        <svg viewBox="0 0 72 18" className="h-5 w-14 -rotate-6 text-[#c7e6ff] [filter:drop-shadow(0_0_3px_rgba(143,209,255,0.32))]" fill="none" aria-hidden="true">
                          <path d="M70 9H10" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="0 0" />
                          <path d="M10 9 18 4.5M10 9 18 13.5" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        <p className="inline-block max-w-[18rem] rounded-2xl border border-[#8b5cff]/70 bg-black/70 px-4 py-3 text-[0.9rem] font-black uppercase leading-tight tracking-[0.02em] text-white shadow-[0_0_28px_rgba(139,92,246,0.34)]">
                          <span className="block whitespace-nowrap">Example of one</span>
                          <span className="block whitespace-nowrap">of many natural</span>
                          <span className="block whitespace-nowrap">conversations!</span>
                        </p>
                      </div>
                    </div>
                  </div>
            </div>

            <div className="relative mt-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-[24px] border border-[#8b5cff]/70 bg-[linear-gradient(180deg,rgba(20,15,39,0.98),rgba(8,7,18,0.98))] px-3.5 py-3 shadow-[0_34px_80px_-22px_rgba(139,92,246,0.68)] ring-2 ring-[#8b5cff]/18">
                  <div className="flex justify-center">
                    <p className="text-center text-[0.98rem] font-black uppercase tracking-[0.22em] text-white sm:text-[1.08rem]">Caller text</p>
                  </div>
                  <div className="mt-1 rounded-2xl border border-[#7d65ff]/50 bg-[#151126] px-4 py-2.5 text-[0.98rem] font-medium leading-7 text-[#ffffff] shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_0_24px_rgba(139,92,246,0.16)]">
                    Thanks for calling Tim's Electrical, Brian! We received your hot tub setup request, and we'll get back to you shortly with pricing and scheduling.
                  </div>
                </div>

                <div className="rounded-[24px] border border-[#8b5cff]/70 bg-[linear-gradient(180deg,rgba(20,15,39,0.98),rgba(8,7,18,0.98))] px-3.5 py-3 shadow-[0_36px_84px_-22px_rgba(139,92,246,0.55)] ring-2 ring-[#8b5cff]/18">
                  <div className="flex justify-center">
                    <p className="whitespace-nowrap text-center text-[0.85rem] font-black uppercase tracking-[0.16em] text-white sm:text-[0.98rem]">Owner summary</p>
                  </div>
                  <div className="mt-2 rounded-2xl border border-[#7d65ff]/50 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.025))] px-3.5 py-3 space-y-2 text-[0.98rem] font-semibold leading-7 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_0_26px_rgba(139,92,246,0.16)]">
                    <p>Callers Name Is Brian</p>
                    <p>Phone: 905-123-4567</p>
                    <p>Job: Hot tub setup</p>
                    <p>Address: 63 York Street</p>
                    <p className="whitespace-nowrap text-[0.9rem] leading-6 tracking-[-0.01em] sm:text-[0.95rem]">
                      Best Call Back Time: 7PM
                    </p>
                  </div>
                </div>

              </div>

              <div className="pointer-events-none absolute right-[-1rem] top-[-2.2rem] hidden translate-x-16 -translate-y-8 lg:block xl:translate-x-20">
                <div className="flex items-start gap-3">
                  <svg viewBox="0 0 96 72" className="h-[5.8rem] w-[7.6rem] text-[#c7e6ff] [filter:drop-shadow(0_0_4px_rgba(143,209,255,0.34))]" fill="none" aria-hidden="true">
                    <path d="M88 10C79 13 71 19 63 25C55 32 48 39 39 45C32 50 23 54 12 56" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" />
                    <path d="M12 56L18 50.6M12 56L18.6 57.4" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <p className="inline-block max-w-[18rem] -translate-x-3 -translate-y-7 rounded-2xl border border-[#8b5cff]/70 bg-black/70 px-4 py-3 text-[0.9rem] font-black uppercase leading-tight tracking-[0.02em] text-white shadow-[0_0_28px_rgba(139,92,246,0.34)]">
                    <span className="block whitespace-nowrap">Instant text messages</span>
                    <span className="block whitespace-nowrap">sent after each</span>
                    <span className="block whitespace-nowrap">Interaction!</span>
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-1 inline-flex max-w-full rounded-full bg-[#8b5cff] p-[2px] shadow-[0_28px_70px_-30px_rgba(139,92,246,0.62)]">
              <div className="inline-flex max-w-full items-center justify-center rounded-full bg-white px-9 py-3.5">
                <p
                  className="whitespace-nowrap text-center text-[1.45rem] font-black uppercase leading-none tracking-[-0.05em] sm:text-[1.95rem]"
                  style={{ color: "#16a34a", textShadow: "0 0 12px rgba(74,222,128,0.42), 0 0 24px rgba(34,197,94,0.28)" }}
                >
                  MISSED CALLS = LOST REVENUE
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <VoicemailLossesArtboard />

      <section className="hidden overflow-hidden bg-[radial-gradient(circle_at_94%_92%,rgba(0,88,184,0.42),transparent_34%),linear-gradient(135deg,#06152a_0%,#071932_52%,#06152a_100%)]">
        <div className="mx-auto grid w-full max-w-[1672px] gap-8 px-5 py-8 sm:px-7 xl:grid-cols-[minmax(0,0.98fr)_minmax(0,0.9fr)] xl:items-start min-[1700px]:min-h-[940px] min-[1700px]:grid-cols-[800px_774px] min-[1700px]:gap-[42px] min-[1700px]:py-[30px]">
          <div>
            <h2 className="max-w-[790px] text-[clamp(3.25rem,5.15vw,5.25rem)] font-black leading-[0.86] tracking-[-0.055em] text-white drop-shadow-[0_4px_0_rgba(255,255,255,0.14)]">
              <span className="relative inline-block">
                Relax!
                <svg viewBox="0 0 270 20" className="absolute -bottom-3 left-[-12px] h-5 w-[270px] text-[#ff8a13]" fill="none" aria-hidden="true">
                  <path d="M5 12c54-9 105-12 161-6 28 3 58 6 99-1" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
                  <path d="M117 14c22 4 50 4 75-1" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
                </svg>
              </span>{" "}
              Let your
              <span className="block bg-[linear-gradient(180deg,#d9f0ff_0%,#58aaff_100%)] bg-clip-text text-transparent">professional assistant</span>
              <span className="block">take the call.</span>
            </h2>

            <div className="relative mt-10 rounded-[24px] border border-white/40 bg-[linear-gradient(145deg,rgba(14,36,66,0.78),rgba(6,20,40,0.86))] p-5 pt-10 shadow-[0_30px_90px_-50px_rgba(0,0,0,1),inset_0_1px_0_rgba(255,255,255,0.08)] min-[1700px]:mt-[48px] min-[1700px]:h-[628px] min-[1700px]:p-[30px] min-[1700px]:pt-[38px]">
              <div className="absolute left-1/2 top-[-24px] -translate-x-1/2 whitespace-nowrap rounded-full border border-[#b7d9ff]/70 bg-[#12325e] px-6 py-3 text-[clamp(1rem,1.35vw,1.45rem)] font-black uppercase tracking-[0.12em] text-white shadow-[0_18px_44px_-24px_rgba(37,99,235,0.85)] min-[1700px]:px-9">
                WHY VOICEMAIL LOSES
              </div>

              <div className="grid h-full items-center gap-5 lg:grid-cols-[minmax(0,1fr)_58px_minmax(0,1fr)] min-[1700px]:grid-cols-[323px_72px_338px] min-[1700px]:gap-[26px]">
                <div className="min-h-[500px] rounded-[28px] border border-rose-400/70 bg-[linear-gradient(180deg,rgba(115,28,48,0.9),rgba(49,11,26,0.92))] p-6 text-white shadow-[0_32px_80px_-44px_rgba(244,63,94,1),inset_0_1px_0_rgba(255,255,255,0.10)] min-[1700px]:h-[558px] min-[1700px]:p-9">
                  <div className="mx-auto grid h-[76px] w-[76px] place-items-center rounded-full border border-rose-300/70 bg-rose-300/10 text-white shadow-[0_0_40px_-18px_rgba(248,113,113,1)] min-[1700px]:h-[86px] min-[1700px]:w-[86px]">
                    <svg viewBox="0 0 48 48" className="h-10 w-10 min-[1700px]:h-12 min-[1700px]:w-12" fill="none" aria-hidden="true">
                      <path d="M11 24c0-5 4-9 9-9s9 4 9 9-4 9-9 9-9-4-9-9Zm9 9h8c5 0 9-4 9-9s-4-9-9-9h-8" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  <p className="mt-5 text-center text-lg font-black uppercase tracking-[0.18em] min-[1700px]:mt-6 min-[1700px]:text-xl">Voicemail</p>
                  <p className="mx-auto mt-4 max-w-[280px] text-center text-[clamp(1.45rem,1.9vw,2rem)] font-black leading-[1.12] tracking-[-0.035em]">Voicemail is a dead end for callers</p>
                  <div className="mx-auto mt-7 h-px max-w-[260px] bg-rose-300/70" />
                  <div className="mt-7 space-y-5 text-[clamp(1.05rem,1.3vw,1.36rem)] font-medium leading-7 text-[#fff1f4] min-[1700px]:mt-8 min-[1700px]:space-y-6 min-[1700px]:leading-8">
                    <div className="flex gap-5">
                      <span className="mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-rose-400 text-white">
                        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                          <path d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5" strokeLinecap="round" />
                        </svg>
                      </span>
                      <p>Customers want to talk to someone now</p>
                    </div>
                    <div className="flex gap-5">
                      <span className="mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-rose-400 text-white">
                        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                          <path d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5" strokeLinecap="round" />
                        </svg>
                      </span>
                      <p>If they can&apos;t reach you, they may call someone else</p>
                    </div>
                  </div>
                </div>

                <div className="flex justify-center">
                  <div className="grid h-14 w-14 place-items-center rounded-full border-2 border-[#9edaff]/80 bg-[#09264b] text-white shadow-[0_0_40px_-16px_rgba(125,211,252,0.85)] min-[1700px]:h-20 min-[1700px]:w-20">
                    <svg viewBox="0 0 42 20" className="h-6 w-9 min-[1700px]:h-8 min-[1700px]:w-12" fill="none" aria-hidden="true">
                      <path d="M3 10h28" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                      <path d="m24 3.5 7.5 6.5-7.5 6.5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                </div>

                <div className="min-h-[500px] rounded-[28px] border border-emerald-300/70 bg-[linear-gradient(180deg,rgba(10,113,102,0.9),rgba(8,55,45,0.96))] p-6 text-white shadow-[0_32px_80px_-44px_rgba(45,212,191,1),inset_0_1px_0_rgba(255,255,255,0.12)] min-[1700px]:h-[558px] min-[1700px]:p-9">
                  <div className="mx-auto grid h-[76px] w-[76px] place-items-center rounded-full border border-emerald-200/70 bg-emerald-200/12 text-white shadow-[0_0_40px_-18px_rgba(45,212,191,1)] min-[1700px]:h-[86px] min-[1700px]:w-[86px]">
                    <svg viewBox="0 0 48 48" className="h-10 w-10 min-[1700px]:h-12 min-[1700px]:w-12" fill="none" aria-hidden="true">
                      <rect x="10" y="16" width="28" height="20" rx="8" stroke="currentColor" strokeWidth="4" />
                      <path d="M18 16v-5M30 16v-5M17 26h.01M31 26h.01M20 31c2.5 2 5.5 2 8 0" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
                    </svg>
                  </div>
                  <p className="mt-5 text-center text-lg font-black uppercase tracking-[0.18em] min-[1700px]:mt-6 min-[1700px]:text-xl">AI Assistant</p>
                  <p className="mx-auto mt-4 max-w-[320px] text-center text-[clamp(1.45rem,1.9vw,2rem)] font-black leading-[1.12] tracking-[-0.035em]">Let your assistant take their call 24/7</p>
                  <div className="mx-auto mt-7 h-px max-w-[300px] bg-emerald-300/70" />
                  <div className="mt-7 space-y-4 text-[clamp(1rem,1.2vw,1.28rem)] font-medium leading-7 text-[#eafff9] min-[1700px]:leading-8">
                    {[
                      "Responds instantly",
                      "Engages callers and answers questions",
                      "Answers every call after 2 rings",
                      "Talks to customers naturally",
                      "Collects job details for easy follow-up",
                    ].map((item) => (
                      <div key={item} className="flex gap-4">
                        <span className="mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-emerald-300 text-[#06352d]">
                          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                            <path d="m5 12 4 4 10-10" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </span>
                        <p>{item}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="min-w-0 pt-0 min-[1700px]:pt-[10px]">
            <div className="min-h-[76px] rounded-[28px] border border-white/55 bg-[#071832]/80 px-5 py-5 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] min-[1700px]:h-[84px] min-[1700px]:px-12 min-[1700px]:py-6">
              <p className="text-[clamp(1.35rem,2vw,2rem)] font-black leading-tight tracking-[-0.04em] text-white">
                How AI Converts <span className="text-[#ff9d22]">cold callers into customers</span>
              </p>
            </div>

            <div className="mt-5 space-y-5">
              {[
                {
                  number: "1",
                  text: "A caller has a problem and needs help fast. By the 2nd ring, they start wondering if anyone will answer.",
                  image: "/illustrations/phone-call.svg",
                },
                {
                  number: "2",
                  text: "Your AI assistant answers on the 3rd ring, uses your business info, collects job details, and texts both sides.",
                  image: "/illustrations/active-support.svg",
                },
                {
                  number: "3",
                  text: "The customer gets a clear confirmation, feels heard, stops searching elsewhere, and expects your callback next.",
                  image: "/illustrations/events-calendar.svg",
                },
              ].map((item) => (
                <div key={item.number} className="grid min-h-[190px] items-center gap-5 rounded-[28px] border border-white/28 bg-[linear-gradient(145deg,rgba(13,33,62,0.96),rgba(8,24,48,0.98))] px-5 py-5 shadow-[0_24px_70px_-44px_rgba(0,0,0,0.95),inset_0_1px_0_rgba(255,255,255,0.06)] md:grid-cols-[72px_minmax(0,1fr)_220px] min-[1700px]:h-[216px] min-[1700px]:grid-cols-[112px_1fr_300px] min-[1700px]:gap-8 min-[1700px]:px-8 min-[1700px]:py-6">
                  <div className="grid h-16 w-16 place-items-center rounded-full border border-[#9edaff] bg-[linear-gradient(145deg,#73c7ff,#2563eb)] text-[2rem] font-black text-white shadow-[0_0_34px_-14px_rgba(96,165,250,1)] min-[1700px]:h-[70px] min-[1700px]:w-[70px] min-[1700px]:text-[2.4rem]">
                    {item.number}
                  </div>
                  <div className="border-l border-white/22 pl-5 min-[1700px]:pl-9">
                    <p className="max-w-[470px] text-[clamp(1.08rem,1.45vw,1.45rem)] font-black leading-[1.42] tracking-[-0.035em] text-white">{item.text}</p>
                  </div>
                  <div className="flex h-[128px] items-center justify-center overflow-hidden rounded-[22px] bg-[linear-gradient(180deg,#f7fbff,#e7f1ff)] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] min-[1700px]:h-[150px]">
                    <img src={item.image} alt="" aria-hidden="true" className="h-full w-full object-contain p-4" loading="lazy" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="bg-[#fbfaf9]">
        <div className="mx-auto w-full max-w-[1308px] px-5 py-16 sm:px-8 lg:py-20">
          <div className="mx-auto max-w-6xl text-center">
            <p className="text-[1.18rem] font-black uppercase tracking-[0.22em] text-[#7378e8]">Tomorrow&apos;s Technology</p>
            <h2 className="mx-auto mt-5 max-w-[1100px] text-[clamp(2.15rem,8vw,3.55rem)] font-black leading-[1.05] text-[#07142a] xl:whitespace-nowrap">Designed for Leading Edge Contractors</h2>
            <p className="mt-5 text-[clamp(1.2rem,1.55vw,1.55rem)] font-medium leading-8 text-[#7b8392]">Electrical, Plumbing, HVAC, General Contractors</p>
          </div>

          <div className="mt-12 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            {benefitCards.map((item) => (
              <div
                key={item.title}
                className={
                  "flex min-h-[500px] flex-col rounded-[22px] border border-[#e6e8ee] bg-white px-7 py-8 shadow-[0_24px_70px_-46px_rgba(15,23,42,0.22)] " +
                  item.glow
                }
              >
                <div className={`h-1.5 w-20 rounded-full bg-gradient-to-r ${item.accent}`} />
                <div className="mt-9 flex items-center gap-4">
                  <div className={`grid h-[78px] w-[78px] shrink-0 place-items-center rounded-[22px] bg-gradient-to-br ${item.accent} text-white opacity-90 shadow-[0_18px_42px_-34px_rgba(15,23,42,0.4)]`}>
                    <BenefitSymbol code={item.code} />
                  </div>
                  <p className={`min-w-0 break-words text-[clamp(0.86rem,0.92vw,1rem)] font-black uppercase leading-[1.35] tracking-[0.14em] bg-gradient-to-r ${item.accent} bg-clip-text text-transparent`}>{item.eyebrow}</p>
                </div>
                <h3 className="mt-8 flex min-h-[160px] items-start text-[clamp(1.55rem,1.72vw,1.88rem)] font-black leading-[1.2] text-[#07142a]">
                  {item.title}
                </h3>
                <p className="mt-3 text-[1.13rem] font-medium leading-8 text-[#243044]">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section ref={demoRef} className="bg-[#eef4fb]">
        <div className="mx-auto grid w-full max-w-[1220px] gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[0.9fr_1fr] lg:px-8">
          <div>
            <h2 className="max-w-[540px] text-[clamp(1.9rem,2.9vw,2.55rem)] font-black leading-[1.08] tracking-[-0.035em] text-[#07142a]">
              Hear a real example of one of our agent&apos;s taking a customer&apos;s inquiry
            </h2>
            <div className="mt-3 h-1 w-14 rounded-full bg-[#c9862f]" />
            <p className="mt-3 max-w-[560px] text-[1.16rem] font-medium leading-8 text-[#334155]">
              Hear a sample of a real-life conversation. The caller is engaged in meaningful dialogue, gets FAQs answered, and is prompted to provide job details along with an expected callback.
            </p>

            <div className="mt-5 rounded-[18px] border border-[#c3d4ea] bg-white p-4 shadow-[0_18px_50px_-38px_rgba(15,23,42,0.35)]">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex gap-3">
                  <span className="mt-1 grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[#a9c8ef] bg-[#eaf3ff] text-[#1d65bd]">
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path d="M4 13a8 8 0 0 1 16 0" strokeLinecap="round" />
                      <path d="M4 13v4a2 2 0 0 0 2 2h2v-6H6a2 2 0 0 0-2 2Zm16 0v4a2 2 0 0 1-2 2h-2v-6h2a2 2 0 0 1 2 2Z" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                  <div>
                    <p className="text-[0.92rem] font-black uppercase tracking-[0.14em] text-[#8a5a18]">Real call example</p>
                    <p className="mt-1 text-[1.42rem] font-black leading-tight tracking-[-0.025em] text-[#07142a]">Electrical Setup Lead</p>
                    <p className="mt-1 max-w-[410px] text-[1.08rem] font-medium leading-7 text-[#475569]">
                      A homeowner calls after hours about a hot tub setup. The assistant answers questions, collects the job details, and texts both the owner and customer.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={toggleAudio}
                  className="inline-flex min-h-[52px] items-center justify-center gap-3 rounded-lg border border-[#a66b23] bg-[#b9782c] px-7 text-base font-black uppercase tracking-[0.12em] text-white shadow-[0_12px_28px_-20px_rgba(120,72,20,0.7)] transition hover:-translate-y-0.5 hover:bg-[#a86b27]"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
                    <path d={audioPlaying ? "M7 5h3v14H7V5Zm7 0h3v14h-3V5Z" : "M8 5.8v12.4L18 12 8 5.8Z"} />
                  </svg>
                  {audioPlaying ? "Pause Call" : "Play Call"}
                </button>
              </div>

              <div className="mt-4 rounded-[14px] border border-[#c9d8e9] bg-[#f8fbff] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
                <div className="flex items-center gap-4">
                  <button
                    type="button"
                    onClick={toggleAudio}
                    className="grid h-14 w-14 shrink-0 place-items-center rounded-full border border-[#c9862f] bg-[#b9782c] text-white shadow-[0_10px_24px_-18px_rgba(120,72,20,0.85)]"
                    aria-label={audioPlaying ? "Pause demo audio" : "Play demo audio"}
                  >
                    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor" aria-hidden="true">
                      <path d={audioPlaying ? "M7 5h3v14H7V5Zm7 0h3v14h-3V5Z" : "M8 5.8v12.4L18 12 8 5.8Z"} />
                    </svg>
                  </button>
                  <div className="flex h-14 flex-1 items-center gap-1.5">
                    {waveformBars.map((bar, index) => {
                      const played = index / Math.max(waveformBars.length - 1, 1) <= playbackProgress;
                      return (
                        <span
                          key={`bar-${index}`}
                          className={"w-full rounded-full transition-all duration-300 " + (played ? "bg-[#b9782c]" : "bg-[#a8b7ca]")}
                          style={{ height: `${8 + bar * 38}px` }}
                        />
                      );
                    })}
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-3">
                  <span className="w-12 text-sm font-black text-[#334155]">{formatClock(audioTime)}</span>
                  <input
                    type="range"
                    min="0"
                    max={audioDuration}
                    step="0.1"
                    value={audioTime}
                    onChange={handleScrub}
                    className="h-1.5 flex-1 accent-[#b9782c]"
                    aria-label="Scrub demo audio"
                  />
                  <span className="w-12 text-right text-sm font-black text-[#334155]">{formatClock(audioDuration)}</span>
                </div>
                {audioError ? <p className="mt-3 text-sm font-bold text-rose-600">{audioError}</p> : null}
              </div>

              <div className="mt-3 rounded-[14px] border border-[#c9d8e9] bg-[#f8fbff] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="grid h-8 w-8 place-items-center rounded-full border border-[#a9c8ef] bg-[#eaf3ff] text-[#1d65bd]">
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                        <path d="M5 5h14v10H8l-3 3V5Z" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                    <p className="text-[0.92rem] font-black uppercase tracking-[0.14em] text-[#1d65bd]">Live transcript</p>
                  </div>
                  <span className="rounded-full border border-[#a9c8ef] bg-[#eaf3ff] px-3 py-1 text-xs font-black uppercase tracking-[0.12em] text-[#1d65bd]">
                    {activeTranscript.speaker}
                  </span>
                </div>
                <p className="mt-3 pl-11 text-[1.08rem] font-medium leading-7 text-[#1f2937]">{activeTranscript.text}</p>
              </div>
            </div>

            <audio
              ref={audioRef}
              src={demoCallAudioSrc}
              preload="auto"
              className="hidden"
              onPlay={() => setAudioPlaying(true)}
              onPause={() => setAudioPlaying(false)}
              onEnded={() => {
                setAudioPlaying(false);
                setAudioTime(0);
              }}
              onTimeUpdate={(event) => setAudioTime(event.currentTarget.currentTime || 0)}
              onLoadedMetadata={(event) => {
                setAudioError("");
                const duration = Number(event.currentTarget.duration || 135.14);
                setAudioDuration(Number.isFinite(duration) && duration > 0 ? duration : 135.14);
              }}
              onError={() => setAudioError("The demo audio file could not be loaded.")}
            />
          </div>

          <div className="space-y-4">
            <div className="overflow-hidden rounded-[18px] border border-[#d8bf8f] bg-white shadow-[0_18px_50px_-38px_rgba(15,23,42,0.35)]">
              <div className="flex items-center gap-3 bg-[linear-gradient(90deg,#fff3d8,#ffffff)] px-4 py-3">
                <span className="grid h-9 w-9 place-items-center rounded-full border border-[#d9b36d] bg-white text-[#9b661d] shadow-[0_10px_24px_-20px_rgba(120,72,20,0.8)]">
                  <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M20 21a8 8 0 0 0-16 0" strokeLinecap="round" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                </span>
                <p className="text-[0.95rem] font-black uppercase tracking-[0.14em] text-[#8a5a18]">Owner gets this text summary</p>
              </div>
              <div className="m-4 mx-auto max-w-[420px] rounded-[32px] border-[5px] border-[#263241] bg-[#07111f] p-2 shadow-[0_18px_46px_-32px_rgba(15,23,42,0.7)]">
                <div className="relative overflow-hidden rounded-[24px] bg-[#f7fbff] px-4 pb-5 pt-8 text-[#1f2937]">
                  <span className="absolute left-1/2 top-2 h-4 w-20 -translate-x-1/2 rounded-full bg-[#111827]" />
                  <div className="flex items-center justify-between border-b border-[#d9e5f3] pb-3">
                    <div>
                      <p className="text-[0.74rem] font-black uppercase tracking-[0.16em] text-[#8a5a18]">My AI PA</p>
                      <p className="text-[1.08rem] font-black text-[#07142a]">Service lead summary</p>
                    </div>
                    <span className="rounded-full bg-[#f0c56f] px-3 py-1 text-xs font-black uppercase tracking-[0.12em] text-[#4c320a]">Texted</span>
                  </div>
                  <div className="mt-4 rounded-[22px] bg-[#dbeafe] px-4 py-3 text-[1.03rem] font-medium leading-7 text-[#10233f]">
                    <p className="font-black text-[#07142a]">New service lead</p>
                    <p><span className="font-black">Name:</span> Brian</p>
                    <p><span className="font-black">Phone:</span> 905-123-4567</p>
                    <p><span className="font-black">Service:</span> Electrical maintenance</p>
                    <p><span className="font-black">Address:</span> 63 York Street</p>
                    <p><span className="font-black">Best callback:</span> Around 7 PM</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="overflow-hidden rounded-[18px] border border-[#b9d8d4] bg-white shadow-[0_18px_50px_-38px_rgba(15,23,42,0.35)]">
              <div className="flex items-center gap-3 bg-[linear-gradient(90deg,#dcfaf4,#ffffff)] px-4 py-3">
                <span className="grid h-9 w-9 place-items-center rounded-full border border-[#93cfc7] bg-white text-[#08776f] shadow-[0_10px_24px_-20px_rgba(8,119,111,0.7)]">
                  <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M5 5h14v14H5V5Z" />
                    <path d="m8 12 3 3 5-6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <p className="text-[0.95rem] font-black uppercase tracking-[0.14em] text-[#08776f]">Caller gets this confirmation</p>
              </div>
              <div className="m-4 mx-auto max-w-[420px] rounded-[32px] border-[5px] border-[#263241] bg-[#07111f] p-2 shadow-[0_18px_46px_-32px_rgba(15,23,42,0.7)]">
                <div className="relative overflow-hidden rounded-[24px] bg-[#f7fbff] px-4 pb-5 pt-8 text-[#12302d]">
                  <span className="absolute left-1/2 top-2 h-4 w-20 -translate-x-1/2 rounded-full bg-[#111827]" />
                  <div className="flex items-center justify-between border-b border-[#d9e5f3] pb-3">
                    <div>
                      <p className="text-[0.74rem] font-black uppercase tracking-[0.16em] text-[#08776f]">Tim&apos;s Electrical</p>
                      <p className="text-[1.08rem] font-black text-[#07142a]">Confirmation text</p>
                    </div>
                    <span className="rounded-full bg-[#a8e8db] px-3 py-1 text-xs font-black uppercase tracking-[0.12em] text-[#064c47]">Confirmed</span>
                  </div>
                  <p className="mt-4 max-w-[92%] rounded-[22px] bg-[#e5e7eb] px-4 py-3 text-[1.08rem] font-medium leading-7 text-[#12302d]">
                    Thanks for calling Tim&apos;s Electrical. Your maintenance request has been sent to the team and a callback will follow based on the details you provided.
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-[18px] border border-[#bad6c7] bg-white p-4 shadow-[0_18px_50px_-38px_rgba(15,23,42,0.35)]">
              <div className="flex items-center gap-3">
                <span className="grid h-8 w-8 place-items-center rounded-full border border-[#95c9aa] bg-[#eefaf3] text-[#1d7a47]">
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M12 3 19 6v5c0 4.4-2.8 7.6-7 9-4.2-1.4-7-4.6-7-9V6l7-3Z" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="m9 12 2 2 4-5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <p className="text-[0.95rem] font-black uppercase tracking-[0.14em] text-[#1d7a47]">Why trades teams trust it</p>
              </div>
              <div className="mt-3 flex items-center gap-4 rounded-[14px] border border-[#bad6c7] bg-[#f1fbf5] p-4">
                <p className="min-w-0 flex-1 text-[1.08rem] font-medium leading-7 text-[#173826]">
                  A contractor can hear the call experience, see the owner summary, and understand exactly what the customer receives next. It feels practical, real, and easy to picture on a busy job day.
                </p>
                <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full border border-[#95c9aa] bg-white text-[#1d7a47] shadow-[0_12px_28px_-22px_rgba(29,122,71,0.5)]">
                  <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                    <path d="M12 3 19 6v5c0 4.4-2.8 7.6-7 9-4.2-1.4-7-4.6-7-9V6l7-3Z" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="m8.8 12.2 2.2 2.2 4.7-5.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section ref={pricingRef} className="bg-transparent">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
          <div className="mx-auto max-w-4xl text-center">
            <h2 className="mt-3 text-[clamp(2.4rem,3.6vw,4rem)] font-black leading-[1.08] tracking-[-0.04em] text-[#07142a]">Clear pricing for businesses that just want calls handled properly.</h2>
            <p className="mx-auto mt-5 max-w-[900px] text-[1.32rem] font-medium leading-9 text-[#334155]">
              Plans include monthly AI call minutes so business owners can understand what they are paying for. Extra usage is handled clearly.
            </p>
          </div>

          <div className="mt-10 grid gap-5 lg:grid-cols-3">
            {pricingCards.map((plan) => (
              <div
                key={plan.name}
                className={
                  "pricing-card rounded-[30px] border p-6 shadow-[0_24px_70px_-46px_rgba(15,23,42,0.24)] " +
                  (plan.featured ? "border-[#a9c8ef] " : "border-[#d7e7fb] ") +
                  plan.tint
                }
              >
                <div className={`absolute inset-x-6 top-0 h-1.5 rounded-b-full bg-gradient-to-r ${plan.accent}`} aria-hidden="true" />
                <div className="pointer-events-none absolute right-5 top-5 h-24 w-24 rounded-full bg-white/34 blur-2xl" aria-hidden="true" />
                <div className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full bg-[#2db4ff]/12 blur-3xl" aria-hidden="true" />
                {plan.featured ? (
                  <span className="absolute right-6 top-6 z-10 inline-flex h-10 w-[178px] items-center justify-center whitespace-nowrap rounded-full border border-[#7dff9e]/70 bg-[#00b84a] text-[0.82rem] font-black uppercase tracking-[0.12em] text-white shadow-[0_0_18px_-8px_rgba(57,255,106,0.95)]">
                    Recommended
                  </span>
                ) : null}
                {plan.comingSoon ? (
                  <span className="absolute right-6 top-6 z-10 inline-flex h-10 w-[178px] items-center justify-center whitespace-nowrap rounded-full border border-[#7dff9e]/70 bg-[#00b84a] text-[0.82rem] font-black uppercase tracking-[0.12em] text-white shadow-[0_0_18px_-8px_rgba(57,255,106,0.95)]">
                    Coming soon
                  </span>
                ) : null}
                <div className="flex items-start justify-between gap-3 pr-[188px]">
                  <div className="min-w-0">
                    <p className="text-[1rem] font-black uppercase tracking-[0.16em] text-[#2563eb]">{plan.eyebrow}</p>
                    <h3 className="mt-3 text-[2.35rem] font-black tracking-[-0.04em] text-[#07142a]">{plan.name}</h3>
                  </div>
                </div>

                <div className="mt-6 flex items-end gap-2">
                  <span className="text-[clamp(3rem,10vw,3.85rem)] font-black tracking-[-0.05em] text-[#07142a]">{plan.price}</span>
                  <span className="pb-2 text-lg font-bold uppercase tracking-[0.14em] text-[#475569]">{plan.suffix}</span>
                </div>
                <p className="mt-3 rounded-[16px] border border-[#d7e7fb] bg-white/64 px-4 py-3 text-[1.05rem] font-black leading-7 text-[#0b3b7a] shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_16px_42px_-36px_rgba(37,99,235,0.55)] backdrop-blur">{plan.minuteNote}</p>

                <div className="mt-6 space-y-4">
                  {plan.points.map((point) => (
                    <div key={point} className="flex items-start gap-3">
                      <span className="mt-2.5 h-3 w-3 rounded-full bg-[#c78c52]" />
                      <p className="text-[1.08rem] font-medium leading-7 text-[#334155]">{point}</p>
                    </div>
                  ))}
                </div>

                {!plan.comingSoon ? (
                  <PrimaryButton onClick={goToSignup} className="mt-8 w-full text-lg">
                    Start Free Trial
                  </PrimaryButton>
                ) : (
                  <SecondaryButton onClick={() => scrollToRef(faqRef)} className="mt-8 w-full text-lg">
                    Ask Before You Upgrade
                  </SecondaryButton>
                )}
              </div>
            ))}
          </div>

          <div className="mt-6 rounded-[24px] border border-[#d7e7fb] bg-white/78 px-6 py-5 text-[1.13rem] font-semibold leading-8 text-[#334155]">
            The live plan is designed to make the buying decision simple: try it on one line, listen to real calls, and keep going only if it feels useful in the real world.
          </div>
        </div>
      </section>

      <section className="overflow-hidden bg-[radial-gradient(circle_at_82%_86%,rgba(255,164,92,0.18),transparent_26%),radial-gradient(circle_at_18%_14%,rgba(187,222,255,0.54),transparent_30%),linear-gradient(135deg,#eef8ff_0%,#dff1ff_100%)]">
        <div className="mx-auto grid w-full max-w-[1500px] gap-8 px-5 py-14 sm:px-8 lg:grid-cols-[0.96fr_1.04fr] lg:items-center lg:py-12 xl:gap-10">
          <div className="relative pt-3 pl-2 lg:-translate-x-4 xl:-translate-x-8">
            <h2 className="max-w-[880px] overflow-visible text-[clamp(2.05rem,7.35vw,4.55rem)] font-black leading-[1.04] tracking-[-0.055em] text-[#07142a] drop-shadow-[0_8px_0_rgba(148,190,255,0.38)]">
              <span className="block sm:whitespace-nowrap">You can <span className="inline-block pr-3 -mr-3 bg-[linear-gradient(180deg,#a9e8ff_0%,#2288ff_100%)] bg-clip-text text-transparent">GO LIVE</span></span>
              <span className="block sm:whitespace-nowrap">in under 5 minutes and</span>
              <span className="relative inline-block sm:whitespace-nowrap">
                never miss a call again!
                <svg viewBox="0 0 620 42" className="absolute -bottom-8 left-[-9%] h-9 w-[118%] text-[#ff8b1f]" fill="none" aria-hidden="true">
                  <path d="M12 25C154 10 400 8 608 24" stroke="rgba(148,190,255,0.48)" strokeWidth="9" strokeLinecap="round" />
                  <path d="M10 20C158 7 398 6 610 20" stroke="currentColor" strokeWidth="7" strokeLinecap="round" />
                </svg>
              </span>
            </h2>
            <p className="mt-12 max-w-[820px] text-[clamp(1.18rem,1.55vw,1.48rem)] font-medium leading-[1.58] text-[#334155]">
              Setup is simple, and your current business does not need to stop. Keep your existing number, forward calls to My AI PA, and test the experience before you turn it on.
            </p>

          </div>

          <div>
            <div className="relative space-y-5">
              <div className="absolute bottom-[70px] left-[60px] top-[70px] hidden w-px bg-[#2b7dff] shadow-[0_0_18px_rgba(55,142,255,0.95)] md:block" aria-hidden="true" />
              {setupSteps.map((step, index) => {
                const iconType = index === 0 ? "chat" : index === 1 ? "headset" : "phone";
                return (
                  <div key={step} className="relative grid items-center gap-4 rounded-[22px] border border-[#236dff]/65 bg-[linear-gradient(135deg,rgba(8,31,68,0.88),rgba(8,20,43,0.94))] px-5 py-4 shadow-[0_20px_60px_-46px_rgba(23,111,255,0.85),inset_0_1px_0_rgba(255,255,255,0.08)] md:grid-cols-[64px_88px_1px_minmax(0,1fr)] md:px-5 md:py-4 xl:grid-cols-[74px_100px_1px_minmax(0,1fr)] xl:px-6 xl:py-5">
                    <span className="relative z-10 grid h-16 w-16 place-items-center rounded-full border border-[#8be2ff] bg-[linear-gradient(180deg,#78e2ff,#176bff)] text-[2.1rem] font-black text-white shadow-[0_0_34px_-8px_rgba(59,165,255,1)]">
                      {index + 1}
                    </span>
                    <span className="hidden h-20 w-20 place-items-center rounded-full border border-[#5880c1]/60 bg-[#071a36]/80 text-[#58b7ff] md:grid xl:h-24 xl:w-24">
                      {iconType === "phone" ? (
                        <svg viewBox="0 0 24 24" className="h-10 w-10 xl:h-12 xl:w-12" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                          <path d="M22 16.92v2a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 3.2 2 2 0 0 1 4.11 1h2a2 2 0 0 1 2 1.72c.12.9.32 1.78.59 2.63a2 2 0 0 1-.45 2.11L7.4 8.31a16 16 0 0 0 6.29 6.29l.85-.85a2 2 0 0 1 2.11-.45c.85.27 1.73.47 2.63.59A2 2 0 0 1 22 16.92Z" strokeLinecap="round" strokeLinejoin="round" />
                          <path d="M15 5a5 5 0 0 1 4 4M15 1a9 9 0 0 1 8 8" strokeLinecap="round" />
                        </svg>
                      ) : iconType === "chat" ? (
                        <svg viewBox="0 0 24 24" className="h-10 w-10 xl:h-12 xl:w-12" fill="currentColor" aria-hidden="true">
                          <path d="M4 5.5A3.5 3.5 0 0 1 7.5 2h9A3.5 3.5 0 0 1 20 5.5v6A3.5 3.5 0 0 1 16.5 15H12l-5 5v-5A3.5 3.5 0 0 1 4 11.5v-6Zm4.5 4.25a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5Zm3.5 0a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5Zm3.5 0a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5Z" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" className="h-10 w-10 xl:h-12 xl:w-12" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                          <path d="M4 13a8 8 0 0 1 16 0" strokeLinecap="round" />
                          <path d="M4 13v4a2 2 0 0 0 2 2h2v-6H6a2 2 0 0 0-2 2Zm16 0v4a2 2 0 0 1-2 2h-2v-6h2a2 2 0 0 1 2 2Z" strokeLinecap="round" strokeLinejoin="round" />
                          <path d="M14 20h-2" strokeLinecap="round" />
                        </svg>
                      )}
                    </span>
                    <span className="hidden h-20 w-px bg-white/20 md:block xl:h-24" aria-hidden="true" />
                    <p className="max-w-[28rem] text-[clamp(1.08rem,1.26vw,1.36rem)] font-black leading-[1.25] tracking-[-0.02em] text-white xl:max-w-[31rem]">{step}</p>
                  </div>
                );
              })}
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <button
                type="button"
                onClick={goToSignup}
                className="inline-flex min-h-[60px] items-center justify-center gap-3 rounded-full border border-[#77d8ff]/90 bg-[linear-gradient(180deg,#2db4ff,#176bff)] px-6 text-[1rem] font-black uppercase tracking-[0.14em] text-white shadow-[0_0_36px_-8px_rgba(38,150,255,1),inset_0_1px_0_rgba(255,255,255,0.36)] transition hover:-translate-y-0.5 xl:min-h-[66px] xl:text-[1.08rem]"
              >
                Start Free Trial
                <svg viewBox="0 0 28 20" className="h-5 w-8" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
                  <path d="M2 10h22M17 3l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <button
                type="button"
                onClick={playDemo}
                className="inline-flex min-h-[60px] items-center justify-center gap-3 rounded-full border border-[#92caff]/80 bg-[#081b38]/75 px-6 text-[1rem] font-black uppercase tracking-[0.14em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_0_38px_-24px_rgba(255,126,44,0.95)] transition hover:-translate-y-0.5 hover:border-[#ff9955] xl:min-h-[66px] xl:text-[1.08rem]"
              >
                Hear Agent&apos;s Voice
                <svg viewBox="0 0 28 20" className="h-5 w-8" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
                  <path d="M2 10h22M17 3l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-[#fbfaf9]">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
          <div className="mx-auto max-w-4xl text-center">
            <h2 className="mt-3 text-[clamp(2.45rem,3.6vw,4rem)] font-black leading-[1.08] tracking-[-0.04em] text-[#07142a]">Read reviews from our current customers</h2>
            <p className="mx-auto mt-5 max-w-[900px] text-[1.32rem] font-medium leading-9 text-[#334155]">
              These business owners were more than happy to share their experiences with my AI PA and how it benefitted them.
            </p>
          </div>

          <div className="mt-10 grid items-start gap-5 lg:grid-cols-[1fr_1fr_0.92fr]">
            <div className="grid gap-5 md:grid-cols-2 lg:col-span-2">
            {testimonialCards.map((item) => (
              <div key={item.name} className="flex min-h-[330px] flex-col rounded-[30px] border border-white/18 bg-[rgba(19,33,56,0.94)] p-7">
                <p className="text-[1.28rem] font-medium leading-9 text-white">"{item.quote}"</p>
                <div className="mt-auto pt-7">
                  <p className="text-[1.08rem] font-black uppercase tracking-[0.14em] text-white">{item.name}</p>
                  <p className="mt-1 text-[1.05rem] font-semibold text-[#eef6ff]">{item.role}</p>
                </div>
              </div>
            ))}
            </div>

            <div className="rounded-[30px] border border-[#315148] bg-[#183329] p-7">
              <p className="text-[1rem] font-black uppercase tracking-[0.14em] text-white">Local-business credibility</p>
              <div className="mt-4 space-y-4">
                <div className="rounded-[22px] bg-[#21453f] px-5 py-5">
                  <p className="text-[1.04rem] font-black uppercase tracking-[0.12em] text-white">Ontario-first</p>
                  <p className="mt-3 text-[1.02rem] font-medium leading-7 text-[#eef6ff]">
                    We are founded in Ontario and are currently making a name within the local region with satisified customers.
                  </p>
                </div>
                <div className="rounded-[22px] bg-[#21453f] px-5 py-5">
                  <p className="text-[1.04rem] font-black uppercase tracking-[0.12em] text-white">Canada-ready privacy</p>
                  <p className="mt-3 text-[1.02rem] font-medium leading-7 text-[#eef6ff]">
                    Built around Canadian privacy expectations, including PIPEDA principles for consent, safeguards, limited use, and accountable handling of caller information.
                  </p>
                </div>
                <div className="rounded-[22px] bg-[#21453f] px-5 py-5">
                  <p className="text-[1.04rem] font-black uppercase tracking-[0.12em] text-white">Proof before hype</p>
                  <p className="mt-3 text-[1.02rem] font-medium leading-7 text-[#eef6ff]">
                    With live demo calls, recorded demo audio, transcript and pics of text follow-up. We do more work than abstract AI claims.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section ref={faqRef} className="bg-transparent">
        <div className="mx-auto w-full max-w-5xl px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
          <div className="mx-auto max-w-4xl text-center">
            <h2 className="mt-3 text-[clamp(2.45rem,3.6vw,4rem)] font-black leading-[1.08] tracking-[-0.04em] text-[#07142a]">Frequently Asked Questions</h2>
            <p className="mx-auto mt-5 max-w-[900px] text-[1.32rem] font-medium leading-9 text-[#334155]">
              Quick answers to the questions business owners usually ask before trying My AI PA.
            </p>
          </div>

          <div className="mt-10 space-y-4">
            {faqs.map((item, index) => {
              const isOpen = openFaq === index;
              return (
                <div key={item.q} className="rounded-[26px] border border-[#d7e7fb] bg-white/84 shadow-[0_16px_36px_-32px_rgba(18,32,51,0.18)]">
                  <button
                    type="button"
                    onClick={() => setOpenFaq(isOpen ? -1 : index)}
                    className="flex w-full items-center justify-between gap-5 px-7 py-5 text-left"
                  >
                    <span className="text-[1.25rem] font-black leading-8 text-[#07142a]">{item.q}</span>
                    <span className="text-[2rem] font-black leading-none text-[#2563eb]">{isOpen ? "-" : "+"}</span>
                  </button>
                  {isOpen ? (
                    <div className="border-t border-[#d7e7fb] px-7 py-5">
                      <p className="text-[1.18rem] font-medium leading-8 text-[#334155]">{item.a}</p>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="bg-transparent">
        <div className="mx-auto w-full max-w-6xl px-4 pb-14 sm:px-6 lg:px-8">
          <div className="rounded-[30px] border border-[#d7e7fb] bg-[linear-gradient(145deg,rgba(255,255,255,0.86),rgba(236,247,255,0.88))] px-6 py-8 shadow-[0_24px_70px_-50px_rgba(18,32,51,0.28)] sm:px-8">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-[0.95rem] font-black uppercase tracking-[0.18em] text-[#2563eb]">Trust and transparency</p>
                <h2 className="mt-3 max-w-3xl text-[clamp(2rem,3vw,3.1rem)] font-black leading-[1.08] tracking-[-0.04em] text-[#07142a]">Clear rules for calls, texts, and customer details.</h2>
              </div>
              <div className="flex flex-wrap gap-3">
                <a href="#/privacy" className="rounded-full border border-[#9ecaff] bg-white px-5 py-3 text-sm font-black uppercase tracking-[0.14em] text-[#0b3b7a] transition hover:-translate-y-0.5 hover:border-[#2563eb]">
                  Privacy Policy
                </a>
                <a href="#/terms" className="rounded-full border border-[#ffd1a6] bg-white px-5 py-3 text-sm font-black uppercase tracking-[0.14em] text-[#8a4b07] transition hover:-translate-y-0.5 hover:border-[#ff8b1f]">
                  Terms
                </a>
              </div>
            </div>

            <div className="mt-7 grid gap-4 md:grid-cols-3">
              {trustCards.map((item) => (
                <article key={item.title} className="rounded-[22px] border border-white/70 bg-white/78 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.86),0_18px_50px_-42px_rgba(37,99,235,0.42)]">
                  <div className="grid h-10 w-10 place-items-center rounded-full bg-[#00b84a] text-white shadow-[0_0_18px_-8px_rgba(57,255,106,0.95)]">
                    <HeroIcon type="check" className="h-5 w-5" />
                  </div>
                  <h3 className="mt-4 text-[1.18rem] font-black leading-tight tracking-[-0.02em] text-[#07142a]">{item.title}</h3>
                  <p className="mt-3 text-[1.02rem] font-medium leading-7 text-[#334155]">{item.body}</p>
                </article>
              ))}
            </div>

            <p className="mt-6 text-[0.98rem] font-semibold leading-7 text-[#475569]">
              External verification badges, Google ownership tokens, SMS sender registration, and payment-provider trust marks should only be added after those accounts issue real approvals or tokens.
            </p>
          </div>
        </div>
      </section>

      <section className="bg-transparent">
        <div className="mx-auto w-full max-w-6xl px-4 pb-16 sm:px-6 lg:px-8 lg:pb-20">
          <div className="rounded-[34px] border border-[#d7e7fb] bg-white/84 px-6 py-10 shadow-[0_28px_80px_-48px_rgba(18,32,51,0.28)] sm:px-8 sm:py-12 lg:px-10">
            <div className="max-w-4xl text-left">
              <h2 className="mt-3 text-[clamp(2.45rem,3.7vw,4.1rem)] font-black leading-[1.08] tracking-[-0.04em] text-[#07142a]">Stop letting missed calls decide where the next job goes.</h2>
              <p className="mt-5 max-w-[900px] text-[1.32rem] font-medium leading-9 text-[#334155]">
                Never miss a call again. Try My AI PA free, hear how it sounds, and see how quickly missed calls can turn into clean follow-up opportunities.
              </p>
            </div>

            <div className="mt-9 flex flex-col gap-4 sm:flex-row">
              <PrimaryButton onClick={goToSignup} className="text-lg">Start Free Trial</PrimaryButton>
              <SecondaryButton onClick={playDemo} dark className="text-lg">
                Hear Agent&apos;s Voice
              </SecondaryButton>
            </div>
          </div>

          <footer className="flex flex-col gap-4 px-1 pt-7 text-[1.05rem] font-semibold leading-7 text-[#334155] sm:flex-row sm:items-center sm:justify-between">
            <p className="inline-flex items-center gap-2">
              <span>My AI PA is positioned for Ontario first. Made and Loved in Canada</span>
              <span className="text-[1.35rem] leading-none" aria-hidden="true">🍁</span>
            </p>
            <div className="flex items-center gap-4">
              <a href="mailto:hello@myaipa.com" className="transition hover:text-[#2563eb]">
                hello@myaipa.com
              </a>
              <a href="#/privacy" className="transition hover:text-[#2563eb]">
                Privacy
              </a>
              <a href="#/terms" className="transition hover:text-[#2563eb]">
                Terms
              </a>
            </div>
          </footer>
        </div>
      </section>
    </main>
  );
}

export default LandingPage;
