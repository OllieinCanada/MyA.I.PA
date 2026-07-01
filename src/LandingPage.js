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

const demoCallAudioSrc = `${process.env.PUBLIC_URL || ""}/tims-electrical-2.wav?v=20260614-trim`;

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
    code: "PHONE",
    eyebrow: "Catch every call",
    accent: "from-blue-600 to-blue-500",
    glow: "shadow-[0_18px_40px_-30px_rgba(56,189,248,0.42)]",
    title: "Never miss another opportunity.",
    body: "Each inquiry is answered while you are on-site or on the ladder.",
  },
  {
    code: "CLIPBOARD",
    eyebrow: "Stay organized",
    accent: "from-blue-400 to-blue-500",
    glow: "shadow-[0_18px_40px_-30px_rgba(96,165,250,0.42)]",
    title: "All details get collected.",
    body: "Job notes, caller info, and timing arrive by text after the call.",
  },
  {
    code: "TOOLS",
    eyebrow: "Work-life balance",
    accent: "from-emerald-500 to-emerald-400",
    glow: "shadow-[0_18px_40px_-30px_rgba(52,211,153,0.42)]",
    title: "Handle calls after hours.",
    body: "Let the agent answer without breaking focus or family time.",
  },
  {
    code: "CHART",
    eyebrow: "Grow your business",
    accent: "from-orange-500 to-orange-400",
    glow: "shadow-[0_18px_40px_-30px_rgba(250,204,21,0.34)]",
    title: "More calls answered means more booked jobs.",
    body: "Better reviews, cleaner follow-up, and higher revenue.",
  },
];

const transcriptMoments = [
  { start: 0, end: 12, speaker: "Live caption", text: "AI: Hello, thank you for contacting Tim's Electrical. We handle residential and commercial work. How are you today? Caller: I'm okay. How about yourself?" },
  { start: 12, end: 24, speaker: "Live caption", text: "AI: I'm doing well, thank you. Are you looking for a new installation, repairs, or maintenance today? Caller: I was just wondering about your hours of operation." },
  { start: 24, end: 40, speaker: "Live caption", text: "AI: We are open from 8:00 a.m. to 5:00 p.m., Monday to Friday. What can we help you with? Caller: I'm looking for assistance for a new installation." },
  { start: 40, end: 52, speaker: "Live caption", text: "AI: A new installation. Okay, what type of installation are you looking for? Caller: I need someone to wire up my hot tub on my back deck." },
  { start: 52, end: 60, speaker: "Live caption", text: "AI: You need someone to wire your hot tub on your back deck. Got it. Can I get your first name? Caller: Brian." },
  { start: 60, end: 72, speaker: "Live caption", text: "AI: Thanks, Brian. What's the address where the work needs to be completed? Caller: 63 York Street. AI: 63 York Street, and which city is this in?" },
  { start: 72, end: 84, speaker: "Live caption", text: "Caller: St. Catharines. AI: What is the best phone number to reach you at? Caller: 905-123-4567." },
  { start: 84, end: 96, speaker: "Live caption", text: "AI: Repeating that back, 905-123-4567. Is that correct? Caller: Yes." },
  { start: 96, end: 108, speaker: "Live caption", text: "AI: Thank you. What's the best time to reach you in case we miss you on the callback? Caller: Around 7:00 p.m. AI: To confirm, that's 63 York Street." },
  { start: 108, end: 120, speaker: "Live caption", text: "AI: Our service manager will get right back to you to go over the job details and our rates. Perfect, I have forwarded this call to him and sent you a text outlining the key points of this call." },
  { start: 120, end: 132, speaker: "Live caption", text: "AI: Feel free to visit our website at timselectrical.com. Thanks for calling. Caller: Great, I got the text. You too." },
  { start: 132, end: 133, speaker: "Live caption", text: "AI: Have a great day." },
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
    price: "$79",
    suffix: "/month",
    eyebrow: "Current live plan",
    featured: true,
    accent: "from-[#2db4ff] via-[#2563eb] to-[#ff8b1f]",
    tint: "bg-[linear-gradient(145deg,#ffffff_0%,#f7fbff_58%,#fff6eb_100%)]",
    minuteNote: "Includes 60 AI call minutes. Extra minutes are $0.25/min.",
    points: ["24/7 AI answering", "60 AI call minutes included", "Extra minutes billed at $0.25/min", "Text summaries for both sides"],
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
    case "PHONE":
      return <HeroIcon type="phone" className="h-7 w-7" />;
    case "CLIPBOARD":
      return <HeroIcon type="clipboard" className="h-7 w-7" />;
    case "TOOLS":
      return (
        <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2.1" aria-hidden="true">
          <path d="m14.7 5.2 4.1 4.1M16.2 3.7l4.1 4.1-8.8 8.8-4.1-4.1 8.8-8.8Z" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M6.5 13.5 3.8 16.2a2.4 2.4 0 0 0 3.4 3.4l2.7-2.7" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M5 5.2 8.8 9" strokeLinecap="round" />
        </svg>
      );
    case "CHART":
      return (
        <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2.1" aria-hidden="true">
          <path d="M4 19.5h16" strokeLinecap="round" />
          <path d="M6.5 16v-4M12 16V7M17.5 16V4.5" strokeLinecap="round" />
          <path d="m6.5 9.5 4.2-3.2 3.1 2.1 4.2-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
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
  if (type === "clipboard") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
        <rect x="5" y="5" width="14" height="16" rx="2" />
        <path d="M9 5V3h6v2M9 12l2 2 4-5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (type === "dollar") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 6v12M15.2 8.4c-.8-.8-2.1-1.2-3.4-1.1-1.7.1-2.9 1-2.9 2.3 0 3.5 6.4 1.7 6.4 5.3 0 1.4-1.3 2.4-3.1 2.5-1.4.1-2.8-.3-3.8-1.2" strokeLinecap="round" />
      </svg>
    );
  }
  if (type === "shield") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
        <path d="M12 3 20 6v6.1c0 4.3-3.1 7.5-8 9-4.9-1.5-8-4.7-8-9V6l8-3Z" strokeLinejoin="round" />
        <path d="m8.5 12 2.2 2.2 4.9-5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (type === "lock") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
        <rect x="5" y="10" width="14" height="10" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" strokeLinecap="round" />
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
    <span className={(compact ? "h-8 w-8" : "h-9 w-9") + " grid shrink-0 place-items-center rounded-full border border-white/55 bg-[linear-gradient(145deg,#eef6ff,#ffffff)] text-[#12324f] shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_8px_18px_-16px_rgba(105,140,180,0.9)]"}>
      <svg viewBox="0 0 28 28" className={compact ? "h-7 w-7" : "h-8 w-8"} fill="none" aria-hidden="true">
        <circle cx="14" cy="10.6" r="4.4" fill="currentColor" />
        <path d="M6.2 23.4c.95-4.95 3.6-7.55 7.8-7.55s6.85 2.6 7.8 7.55" fill="currentColor" />
      </svg>
    </span>
  );
}

function AiAssistantAvatar({ compact = false }) {
  return (
    <span className={(compact ? "h-12 w-12" : "h-12 w-12") + " grid shrink-0 place-items-center rounded-full border-2 border-white bg-white text-[#063a83] shadow-[inset_0_1px_0_rgba(255,255,255,1),0_0_22px_-8px_rgba(57,255,106,0.92)]"}>
      <svg viewBox="0 0 48 48" className="h-11 w-11" fill="none" aria-hidden="true">
        <circle cx="24" cy="24" r="20" fill="#e9f8ff" />
        <path d="M11.5 24v-3.1C11.5 14 17 8.8 24 8.8S36.5 14 36.5 20.9V24" stroke="#063a83" strokeWidth="4.2" strokeLinecap="round" />
        <rect x="8.8" y="20" width="7" height="12" rx="3.5" fill="#063a83" />
        <rect x="32.2" y="20" width="7" height="12" rx="3.5" fill="#063a83" />
        <rect x="18" y="18" width="3.2" height="14" rx="1.6" fill="#ff7a00" />
        <rect x="23" y="14" width="3.2" height="22" rx="1.6" fill="#ff7a00" />
        <rect x="28" y="18" width="3.2" height="14" rx="1.6" fill="#ff7a00" />
        <path d="M35.8 30.8c-1.2 4.4-5.3 6.8-10.9 6.8" stroke="#063a83" strokeWidth="3.4" strokeLinecap="round" />
        <path d="M24.2 37.6h-4.5" stroke="#39ff6a" strokeWidth="4" strokeLinecap="round" />
      </svg>
    </span>
  );
}

function HeroPhoneMockup() {
  return (
    <div className="landing-phone relative mx-auto mt-0 h-[640px] w-full max-w-[360px] rounded-[48px] border-[4px] border-[#111827] bg-[#050912] p-2 shadow-[0_30px_80px_-34px_rgba(0,0,0,1),0_0_0_1px_rgba(255,255,255,0.22)_inset]">
      <span className="absolute -left-[7px] top-[98px] h-11 w-[3px] rounded-l-full bg-[#1f2937]" />
      <span className="absolute -right-[7px] top-[158px] h-16 w-[3px] rounded-r-full bg-[#1f2937]" />
      <div className="absolute left-1/2 top-3 z-10 h-5 w-[76px] -translate-x-1/2 rounded-full bg-black" />
      <div className="flex h-full flex-col overflow-hidden rounded-[39px] bg-[radial-gradient(circle_at_50%_0%,rgba(8,90,158,0.34),transparent_36%),linear-gradient(180deg,#061b34_0%,#020814_100%)] px-4 pb-6 pt-4">
        <div className="flex items-center justify-between text-white">
          <span className="text-[0.95rem] font-black tracking-[-0.02em]">After-hours</span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-4 rounded-sm border border-white/80" />
            <span className="h-2.5 w-5 rounded-sm border border-white/80 bg-white/20" />
          </span>
        </div>
        <div className="text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-[#48ff7b]/70 bg-[#043d1c]/88 px-4 py-1.5 text-[0.74rem] font-black uppercase tracking-[0.1em] text-[#b9ffc9] shadow-[0_0_18px_-8px_rgba(72,255,123,0.9)]">
            <span className="h-2.5 w-2.5 rounded-full bg-[#39ff6a] shadow-[0_0_12px_rgba(57,255,106,0.95)]" />
            AI speaking now
          </div>
          <p className="mt-1 text-[1.2rem] font-black tracking-[-0.03em] text-white">Live Call</p>
          <p className="mt-0.5 text-[1.08rem] font-black text-[#ff7a00]">00:32</p>
          <HeroWave small />
        </div>

        <div className="mt-2 rounded-[22px] border border-white/85 bg-[linear-gradient(145deg,#ffffff,#edf6ff)] px-3 py-3 text-[#07142a] shadow-[0_14px_30px_-24px_rgba(15,23,42,0.58)]">
          <div className="flex gap-2">
            <CustomerAvatar compact />
            <div>
              <p className="text-[1.14rem] font-black leading-tight">Customer</p>
              <p className="mt-0.5 text-[1.05rem] font-semibold leading-[1.2]">Need hot tub wiring this week.</p>
            </div>
          </div>
        </div>

        <div className="mt-2 rounded-[22px] border border-[#bfdbfe] bg-[linear-gradient(145deg,#ffffff,#dbeafe)] px-3 py-3 text-[#07142a] shadow-[0_18px_38px_-28px_rgba(37,99,235,0.72),inset_0_1px_0_rgba(255,255,255,0.9)]">
          <div className="flex gap-2">
            <AiAssistantAvatar compact />
            <div>
              <p className="text-[1.14rem] font-black leading-tight text-[#2563eb]">My AI PA</p>
              <p className="mt-0.5 text-[1.05rem] font-semibold leading-[1.2]">
                I&apos;ll collect the details and send a summary.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-2 rounded-[22px] border border-white/85 bg-[linear-gradient(145deg,#ffffff,#edf6ff)] px-3 py-3 text-[#07142a] shadow-[0_14px_30px_-24px_rgba(15,23,42,0.58)]">
          <div className="flex gap-2">
            <CustomerAvatar compact />
            <div>
              <p className="text-[1.14rem] font-black leading-tight">Customer</p>
              <p className="mt-0.5 text-[1.05rem] font-semibold leading-[1.2]">
                Brian. 905-123-4567. 63 York Street. 7:00 PM.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-2 rounded-[22px] border border-[#bfdbfe] bg-[linear-gradient(145deg,#ffffff,#dbeafe)] px-3 py-3 text-[#07142a] shadow-[0_18px_38px_-28px_rgba(37,99,235,0.72),inset_0_1px_0_rgba(255,255,255,0.9)]">
          <div className="flex gap-2">
            <AiAssistantAvatar compact />
            <div>
              <p className="text-[1.14rem] font-black leading-tight text-[#2563eb]">My AI PA</p>
              <p className="mt-0.5 text-[1.05rem] font-semibold leading-[1.2]">
                Done. Sent for pricing and scheduling.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-auto grid grid-cols-3 items-end gap-3 px-5 pt-1 text-center text-[0.72rem] font-bold text-white/88">
          <span className="grid gap-1 justify-items-center">
            <span className="grid h-11 w-11 place-items-center rounded-full border border-white/18 bg-white/14 text-white">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                <path d="M4 9v6h4l5 4V5L8 9H4Z" />
                <path d="M16.5 9.5a4 4 0 0 1 0 5" />
              </svg>
            </span>
          </span>
          <span className="grid gap-1 justify-items-center">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-[#ff392e] text-white shadow-[0_14px_26px_-18px_rgba(255,57,46,0.95)]">
              <HeroIcon type="phone" className="h-5 w-5 rotate-[135deg]" />
            </span>
          </span>
          <span className="grid gap-1 justify-items-center">
            <span className="grid h-11 w-11 place-items-center rounded-full border border-white/18 bg-white/14 text-white">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                <path d="M12 3v10" />
                <rect x="8" y="3" width="8" height="13" rx="4" />
                <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
                <path d="M4 20 20 4" />
              </svg>
            </span>
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
    <div className="landing-summary mx-auto w-full max-w-[360px] xl:max-w-[360px]">
      <div className="relative h-[640px] rounded-[48px] border-[4px] border-[#111827] bg-[#07111f] p-2 shadow-[0_30px_84px_-42px_rgba(7,17,31,0.92),inset_0_0_0_1px_rgba(255,255,255,0.18)] before:absolute before:-left-[7px] before:top-[98px] before:h-11 before:w-[3px] before:rounded-l-full before:bg-[#1f2937] after:absolute after:-right-[7px] after:top-[158px] after:h-16 after:w-[3px] after:rounded-r-full after:bg-[#1f2937]">
        <div className="relative flex h-full flex-col overflow-hidden rounded-[39px] bg-[#f8fbff] px-5 pb-6 pt-8 text-[#081123] ring-1 ring-white/70">
          <div className="absolute left-0 right-0 top-0 z-10 flex h-9 items-center justify-between px-8 text-[0.72rem] font-black text-[#111827]">
            <span>9:41</span>
            <span className="flex items-center gap-1">
              <span className="h-1.5 w-3 rounded-sm bg-[#111827]" />
              <span className="h-1.5 w-2 rounded-sm bg-[#111827]" />
              <span className="h-2 w-4 rounded-[3px] border border-[#111827] bg-[#111827]/10" />
            </span>
          </div>
          <span className="absolute left-1/2 top-3 z-20 h-6 w-[92px] -translate-x-1/2 rounded-full bg-[#111827] shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]" />
          <span className="absolute bottom-2 left-1/2 h-1 w-28 -translate-x-1/2 rounded-full bg-[#111827]/82" />

          <div className="flex items-center justify-between gap-2 border-b border-[#dbe6f3] pb-3">
            <div className="min-w-0 flex-1">
              <p className="text-[0.78rem] font-black uppercase tracking-[0.13em] text-[#2563eb]">Messages</p>
              <h3 className="whitespace-nowrap text-[0.9rem] font-black leading-tight tracking-[-0.035em]">My AI PA - TIM&apos;S ELECTRICAL</h3>
            </div>
            <span className="shrink-0 rounded-full bg-[#00b84a] px-2.5 py-1.5 text-[0.68rem] font-black uppercase tracking-[0.12em] text-white shadow-[0_0_16px_-8px_rgba(0,184,74,0.95)]">Now</span>
          </div>

          <section className="mt-3">
            <div className="rounded-[15px] border border-[#bfdbfe] bg-white/92 px-3 py-2 text-center shadow-[0_14px_34px_-30px_rgba(37,99,235,0.75)]">
              <p className="whitespace-nowrap text-[0.82rem] font-black uppercase tracking-[0.06em] text-[#2563eb]">Owner cell phone summary</p>
            </div>
            <div className="mt-3 rounded-[20px] bg-[#dbeafe] px-4 py-3 shadow-[0_8px_20px_-18px_rgba(15,23,42,0.5)]">
              <p className="text-[1.16rem] font-black text-[#0b3b7a]">New service lead</p>
              <div className="mt-3 space-y-1.5 text-[0.98rem] font-semibold leading-[1.18rem] text-[#10233f]">
                {rows.map(([icon, label, value]) => (
                  <div key={label} className="flex items-start gap-3">
                    <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#0b3b7a] text-white shadow-[0_10px_18px_-14px_rgba(11,59,122,0.95)]">
                      <HeroIcon type={icon} className="h-4 w-4" />
                    </span>
                    <p>
                      <span className="font-black">{label}:</span> {value}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="mt-3 border-t border-[#dbe6f3] pt-3">
            <div className="rounded-[15px] border border-[#ddd6fe] bg-white/92 px-3 py-2 text-center shadow-[0_14px_34px_-30px_rgba(124,58,237,0.7)]">
              <p className="whitespace-nowrap text-[0.82rem] font-black uppercase tracking-[0.06em] text-[#6d28d9]">Caller cell phone summary</p>
            </div>
            <div className="mt-3 max-w-[94%] rounded-[20px] bg-[#e5e7eb] px-4 py-2.5 text-[1rem] font-semibold leading-[1.32rem] text-[#111827]">
              Thanks for calling Tim&apos;s Electrical. We got your request and will follow up shortly.
            </div>
          </section>

          <span className="mt-auto mb-3 inline-flex items-center justify-center rounded-[18px] bg-[linear-gradient(135deg,#2563eb,#1d7df2)] px-4 py-2.5 text-[0.82rem] font-black uppercase tracking-[0.1em] text-white shadow-[0_20px_34px_-24px_rgba(37,99,235,0.95)]">
            View full conversation
          </span>
        </div>
      </div>
    </div>
  );
}

function HeroCallDashboard() {
  const checklist = ["Name collected", "Phone collected", "Address collected", "Issue collected"];

  return (
    <div className="landing-call-dashboard relative mx-auto w-full max-w-[780px]">
      <div className="relative h-[630px] overflow-hidden rounded-[32px] border border-[#142033] bg-[#050913] text-white shadow-[0_28px_78px_-42px_rgba(0,0,0,0.9),inset_0_1px_0_rgba(255,255,255,0.06)]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_34%,rgba(36,99,235,0.24),transparent_28%),radial-gradient(circle_at_74%_82%,rgba(37,99,235,0.28),transparent_30%),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[size:auto,auto,1px_100%]" />

        <div className="relative grid h-full grid-cols-[0.74fr_1.26fr]">
          <section className="landing-call-panel relative flex flex-col border-r border-[#1b2638] px-7 py-6">
            <div className="landing-call-status flex items-center justify-between text-[1.04rem] font-black">
              <span className="inline-flex items-center gap-3">
                <span className="h-3.5 w-3.5 rounded-full bg-[#00d66f] shadow-[0_0_22px_rgba(0,214,111,0.95)]" />
                Live Call
              </span>
              <span>02:37</span>
            </div>

            <div className="landing-caller-card mt-8">
              <div className="landing-caller-avatar grid h-24 w-24 place-items-center rounded-full bg-[radial-gradient(circle_at_30%_24%,#7545d8,#3b1b76_72%)] text-[2.15rem] font-black shadow-[0_20px_50px_-30px_rgba(126,87,255,1)]">
                JS
              </div>
              <h3 className="landing-caller-name mt-5 text-[2rem] font-black leading-none tracking-[-0.045em]">John Smith</h3>
              <p className="landing-caller-phone mt-3 text-[1.42rem] font-bold tracking-[-0.035em] text-white/82">905-555-1234</p>
              <span className="landing-caller-tag mt-4 inline-flex rounded-full bg-white/10 px-5 py-2 text-[1rem] font-black text-white/92 shadow-[inset_0_1px_0_rgba(255,255,255,0.07)]">
                HVAC Repair
              </span>
            </div>

            <div className="landing-call-controls mt-auto">
              <HeroWave />
              <div className="mt-7 flex items-center justify-between">
                <span className="landing-call-button grid h-14 w-14 place-items-center rounded-full bg-white/8 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
                  <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                    <path d="M12 3v10" />
                    <rect x="8" y="3" width="8" height="13" rx="4" />
                    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
                    <path d="M4 20 20 4" />
                  </svg>
                </span>
                <span className="landing-hangup-button grid h-[4.5rem] w-[4.5rem] place-items-center rounded-full bg-[#ff3b45] text-white shadow-[0_24px_52px_-25px_rgba(255,59,69,1)]">
                  <HeroIcon type="phone" className="h-8 w-8 rotate-[135deg]" />
                </span>
                <span className="landing-call-button grid h-14 w-14 place-items-center rounded-full bg-white/8 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
                  <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                    <path d="M4 9v6h4l5 4V5L8 9H4Z" />
                    <path d="M16.5 9.5a4 4 0 0 1 0 5M19 7a8 8 0 0 1 0 10" />
                  </svg>
                </span>
              </div>
            </div>
          </section>

          <section className="landing-conversation-column relative flex flex-col px-7 py-6">
            <div className="landing-conversation-header flex items-center justify-between">
              <h3 className="text-[1.5rem] font-black tracking-[-0.025em]">Conversation</h3>
              <span className="rounded-full bg-[#063a83]/80 px-3 py-1 text-[0.72rem] font-black uppercase tracking-[0.12em] text-[#9edaff]">Summary ready</span>
            </div>

            <div className="landing-conversation-panel mt-3 rounded-[24px] border border-white/8 bg-black/18 px-4 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
              <p className="text-sm font-black uppercase tracking-[0.06em] text-white/38">AI Assistant</p>
              <div className="mt-2 max-w-[74%] rounded-[18px] bg-white/10 px-4 py-2 text-[0.92rem] font-bold leading-[1.22] text-white/92">
                Thanks for calling Smith Heating &amp; Cooling. How can I help?
              </div>
              <p className="mt-0.5 text-right text-[0.68rem] font-bold text-white/35">10:32 AM</p>

              <div className="ml-auto mt-2.5 max-w-[74%] rounded-[18px] bg-[#0b376d] px-4 py-2 text-[0.92rem] font-bold leading-[1.22] text-white/96 shadow-[0_18px_42px_-30px_rgba(37,99,235,0.95)]">
                <p className="mb-0.5 text-[0.68rem] font-black text-white/45">Caller</p>
                Hi, my furnace stopped working.
              </div>
              <p className="mt-0.5 text-right text-[0.68rem] font-bold text-white/35">10:32 AM</p>

              <p className="mt-2.5 text-sm font-black uppercase tracking-[0.06em] text-white/38">AI Assistant</p>
              <div className="mt-2 max-w-[74%] rounded-[18px] bg-white/10 px-4 py-2 text-[0.92rem] font-bold leading-[1.22] text-white/92">
                Sorry to hear that. Can I get your name and address?
              </div>
              <p className="mt-0.5 text-right text-[0.68rem] font-bold text-white/35">10:32 AM</p>
            </div>

            <div className="landing-dashboard-bottom mt-3 grid grid-cols-[1fr_238px] gap-5">
              <div className="landing-checklist-card rounded-[22px] border border-white/8 bg-white/[0.04] p-3">
                <p className="text-[0.78rem] font-black uppercase tracking-[0.12em] text-white/45">Details captured</p>
                <div className="mt-2 grid gap-1 text-[0.86rem] font-black">
                  {checklist.map((item) => (
                    <div key={item} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 text-white/88">
                      <span className="grid h-6 w-6 place-items-center rounded-full bg-[#114416] text-[#66ff75] shadow-[0_0_22px_-10px_rgba(102,255,117,0.95)]">
                        <HeroIcon type="check" className="h-4 w-4" />
                      </span>
                      <span>{item}</span>
                      <HeroIcon type="check" className="h-5 w-5 text-white/60" />
                    </div>
                  ))}
                </div>
              </div>

              <div className="landing-lead-stack grid gap-2">
                <div className="landing-lead-note flex items-center justify-center gap-2 text-center text-[0.9rem] font-black italic leading-[1.05] text-[#6f8dff] drop-shadow-[0_0_14px_rgba(52,92,255,0.48)]">
                  <svg viewBox="0 0 42 28" className="h-6 w-9 shrink-0" fill="none" stroke="currentColor" strokeWidth="4" aria-hidden="true">
                    <path d="M3 6c12 2 22 8 29 17" strokeLinecap="round" />
                    <path d="m25 22 9 2 1-9" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span>Instantly sent to you</span>
                </div>

                <div className="landing-lead-card rounded-[22px] border border-[#b9d8ff] bg-white px-4 py-3 text-[#111827] shadow-[0_0_0_6px_rgba(37,99,235,0.2),0_28px_70px_-28px_rgba(37,99,235,1)]">
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-2.5 text-[0.98rem] font-black">
                      <span className="grid h-8 w-8 place-items-center rounded-xl bg-[#66e83f] text-white">
                        <HeroIcon type="chat" className="h-4 w-4" />
                      </span>
                      New Lead
                    </span>
                    <span className="text-[0.82rem] font-black text-gray-400">now</span>
                  </div>
                  <div className="mt-2 space-y-1 text-[0.84rem] font-semibold leading-[1.12] tracking-[-0.02em]">
                    <p>John Smith</p>
                    <p>905-555-1234</p>
                    <p>123 Main St, Hamilton</p>
                    <p>No heat upstairs. Furnace not working.</p>
                    <p>Requested: Tomorrow morning.</p>
                  </div>
                </div>
              </div>
            </div>
          </section>
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

function LegacyVoicemailLossesArtboard() {
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

function VoicemailLossesArtboard({ onStart, onPlayDemo }) {
  return (
    <section id="voicemail-vs-ai" className="scroll-mt-6 bg-[linear-gradient(135deg,#ffffff_0%,#f5fbff_58%,#eaf5ff_100%)]">
      <style>{`
        #voicemail-vs-ai .voicemail-ring-core {
          animation: voicemailRingCore 6s ease-in-out infinite;
        }
        #voicemail-vs-ai .voicemail-ring-pulse-one {
          animation: voicemailRingPulse 6s ease-out infinite;
        }
        #voicemail-vs-ai .voicemail-ring-pulse-two {
          animation: voicemailRingPulse 6s ease-out infinite;
          animation-delay: 0.45s;
        }
        #voicemail-vs-ai .voicemail-ring-badge {
          opacity: 0.72;
          transform: translateY(0) scale(1);
          animation: voicemailRingBadge 6s ease-in-out infinite;
        }
        #voicemail-vs-ai .voicemail-ring-badge-2 {
          animation-delay: 0.42s;
        }
        #voicemail-vs-ai .voicemail-ring-badge-3 {
          animation-delay: 0.84s;
        }
        #voicemail-vs-ai .voicemail-opportunity-line {
          position: relative;
          overflow: hidden;
        }
        #voicemail-vs-ai .voicemail-opportunity-line::after {
          content: "";
          position: absolute;
          inset: 0;
          border-radius: inherit;
          background: #16a34a;
          transform: translateX(-100%);
          animation: voicemailLineFill 6s ease-in-out infinite;
        }
        #voicemail-vs-ai .voicemail-no-answer {
          animation: voicemailNoAnswerPop 6s ease-in-out infinite;
        }
        #voicemail-vs-ai .voicemail-competitor-arrow span {
          transform-origin: left center;
          animation: voicemailArrowDraw 6s ease-in-out infinite;
        }
        #voicemail-vs-ai .voicemail-competitor-card {
          animation: voicemailCompetitorPulse 6s ease-in-out infinite;
        }
        @keyframes voicemailRingCore {
          0%, 54%, 100% { transform: scale(1); }
          8%, 22%, 36% { transform: scale(1.08); }
          14%, 28%, 42% { transform: scale(1); }
        }
        @keyframes voicemailRingPulse {
          0%, 3% { opacity: 0; transform: scale(0.72); }
          8% { opacity: 0.58; transform: scale(1); }
          24% { opacity: 0; transform: scale(1.3); }
          25%, 100% { opacity: 0; transform: scale(0.72); }
        }
        @keyframes voicemailRingBadge {
          0%, 6%, 100% { opacity: 0.72; transform: translateY(0) scale(1); }
          10%, 18% { opacity: 1; transform: translateY(-1px) scale(1.02); }
          24%, 100% { opacity: 0.82; transform: translateY(0) scale(1); }
        }
        @keyframes voicemailLineFill {
          0%, 8% { transform: translateX(-100%); }
          42% { transform: translateX(0); }
          52%, 100% { transform: translateX(0); }
        }
        @keyframes voicemailNoAnswerPop {
          0%, 45%, 100% { transform: translateY(0) scale(1); box-shadow: none; }
          53%, 63% { transform: translateY(-1px) scale(1.012); box-shadow: 0 18px 34px -24px rgba(204, 15, 31, 0.65); }
        }
        @keyframes voicemailArrowDraw {
          0%, 54% { transform: scaleX(0); opacity: 0.25; }
          64%, 100% { transform: scaleX(1); opacity: 1; }
        }
        @keyframes voicemailCompetitorPulse {
          0%, 60%, 100% { transform: scale(1); box-shadow: 0 16px 32px -28px rgba(220,38,38,0.75); }
          70%, 80% { transform: scale(1.01); box-shadow: 0 20px 38px -24px rgba(220,38,38,0.82), 0 0 0 2px rgba(239,35,46,0.1); }
        }
        @media (prefers-reduced-motion: reduce) {
          #voicemail-vs-ai .voicemail-ring-core,
          #voicemail-vs-ai .voicemail-ring-pulse-one,
          #voicemail-vs-ai .voicemail-ring-pulse-two,
          #voicemail-vs-ai .voicemail-ring-badge,
          #voicemail-vs-ai .voicemail-opportunity-line::after,
          #voicemail-vs-ai .voicemail-no-answer,
          #voicemail-vs-ai .voicemail-competitor-arrow span,
          #voicemail-vs-ai .voicemail-competitor-card {
            animation: none;
          }
        }
      `}</style>
      <div className="mx-auto w-full max-w-[1720px] px-5 py-7 sm:px-8 lg:px-10 lg:py-9">
        <div className="mx-auto flex items-center justify-center gap-4">
          <HeroLogoMark />
        </div>

        <div className="mt-4 text-center">
          <p className="inline-flex rounded-full border border-[#d7e7fb] bg-[#eef6ff] px-6 py-2 text-[0.86rem] font-black uppercase tracking-[0.22em] text-[#1d65bd] shadow-[0_18px_44px_-36px_rgba(37,99,235,0.72)]">
            AI phone answering assistant for trades businesses
          </p>
          <h2 className="mx-auto mt-4 max-w-[1420px] text-[clamp(3rem,5.25vw,5rem)] font-black leading-[0.95] tracking-[-0.058em] text-[#07142a]">
            Voicemail loses jobs. <span className="text-[#1d7df2]">My AI PA</span>
            <span className="block">catches them.</span>
          </h2>
          <p className="mx-auto mt-4 max-w-[960px] text-[clamp(1.18rem,1.65vw,1.55rem)] font-medium leading-8 text-[#405476]">
            When you cannot get to the phone, the telephone assistant answers, collects the job details, and texts both sides for easy follow-up.
          </p>
        </div>

        <div className="relative mt-6 grid gap-7 lg:grid-cols-3">
          <article className="relative min-h-[410px] overflow-hidden rounded-lg border border-[#ff5b5b] bg-white p-5 shadow-[0_30px_80px_-58px_rgba(239,68,68,0.7)]">
            <div className="absolute right-4 top-4 rounded-full bg-[#fff1f2] px-3 py-1 text-xs font-black uppercase tracking-[0.12em] text-[#cc0f1f]">
              Major issue
            </div>
            <div className="flex items-center gap-4 pr-28">
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-[linear-gradient(180deg,#ff4545,#e11d48)] text-3xl font-black text-white shadow-[0_18px_34px_-24px_rgba(225,29,72,1)]">1</span>
              <p className="text-[clamp(1.42rem,1.75vw,1.8rem)] font-black leading-tight tracking-[-0.04em] text-[#ef232e]">Phone rings unanswered</p>
            </div>
            <h3 className="mt-3 text-[clamp(1.16rem,1.35vw,1.42rem)] font-black leading-tight text-[#07142a]">
              Three rings. No answer. The customer moves on.
            </h3>

            <div className="mt-4 grid gap-3">
              <div className="relative overflow-hidden rounded-lg border border-[#bbf7d0] bg-white px-4 py-4 shadow-[0_14px_28px_-24px_rgba(22,163,74,0.8)]">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_48%,rgba(34,197,94,0.14),transparent_46%)]" />
                <div className="relative grid items-center gap-3 sm:grid-cols-[1fr_124px]">
                  <div>
                    <p className="text-sm font-black uppercase tracking-[0.12em] text-[#15803d]">Incoming opportunity</p>
                    <p className="mt-1 text-[1.02rem] font-black leading-tight text-[#07142a]">Three chances to answer.</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {["Ring 1", "Ring 2", "Ring 3"].map((ring, index) => (
                        <span key={ring} className={`voicemail-ring-badge voicemail-ring-badge-${index + 1} rounded-full bg-[#dcfce7] px-3 py-1 text-xs font-black text-[#15803d]`}>
                          {ring}
                        </span>
                      ))}
                    </div>
                    <div className="voicemail-opportunity-line mt-3 h-1 max-w-[240px] rounded-full bg-[#22c55e]/18" />
                  </div>
                  <div className="relative mx-auto grid h-[108px] w-[108px] place-items-center">
                    <span className="absolute h-24 w-24 rounded-full border-2 border-[#22c55e]/18" />
                    <span className="voicemail-ring-pulse-one absolute h-20 w-20 rounded-full border-2 border-[#22c55e]/32" />
                    <span className="voicemail-ring-pulse-two absolute h-28 w-28 rounded-full border border-[#22c55e]/22" />
                    <span className="voicemail-ring-core relative grid h-16 w-16 place-items-center rounded-full bg-[linear-gradient(180deg,#22c55e,#15803d)] text-white shadow-[0_18px_30px_-18px_rgba(21,128,61,0.95)]">
                      <HeroIcon type="phone" className="h-8 w-8" />
                    </span>
                  </div>
                </div>
              </div>

              <div className="grid items-center gap-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
                <div className="voicemail-no-answer flex items-center gap-3 rounded-lg bg-[#ffe4e6] px-4 py-3 text-[#7f1d1d]">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#cc0f1f] text-white">
                    <HeroIcon type="phone" className="h-5 w-5 rotate-[135deg]" />
                  </span>
                  <div>
                    <p className="text-base font-black leading-tight">No answer</p>
                    <p className="text-sm font-bold leading-5">The caller does not wait.</p>
                  </div>
                </div>
                <div className="voicemail-competitor-arrow hidden items-center text-[#ef232e] sm:flex">
                  <span className="h-0.5 w-8 bg-[#ef232e]" />
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.7" aria-hidden="true">
                    <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <div className="voicemail-competitor-card rounded-lg border border-[#fecaca] bg-white px-4 py-3 shadow-[0_16px_32px_-28px_rgba(220,38,38,0.75)]">
                  <p className="text-sm font-black uppercase tracking-[0.1em] text-[#cc0f1f]">Customer called competitor</p>
                  <p className="mt-1 text-sm font-bold leading-5 text-[#07142a]">The opportunity left.</p>
                </div>
              </div>
            </div>
          </article>

          <article className="relative min-h-[410px] rounded-lg border border-[#60a5fa] bg-white p-5 shadow-[0_30px_80px_-58px_rgba(37,99,235,0.7)]">
            <div className="flex items-center gap-4">
              <span className="grid h-14 w-14 place-items-center rounded-full bg-[linear-gradient(180deg,#3185ff,#1d4ed8)] text-3xl font-black text-white shadow-[0_18px_34px_-24px_rgba(29,78,216,1)]">2</span>
              <p className="text-[clamp(1.55rem,2vw,2rem)] font-black leading-tight tracking-[-0.04em] text-[#1d7df2]">Assistant answers live</p>
            </div>
            <h3 className="mt-3 max-w-[360px] text-[clamp(1.22rem,1.45vw,1.52rem)] font-black leading-tight text-[#07142a]">Asks why they called and answers FAQ questions</h3>

            <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_150px]">
              <div className="min-w-0">
                <p className="mb-3 inline-flex rounded-full bg-[#e8f2ff] px-4 py-1 text-xs font-black uppercase tracking-[0.12em] text-[#1d7df2]">
                  AI speaking now
                </p>
                <div className="space-y-3">
                  {[
                    ["My AI PA", "Hi! Thanks for calling. What can I help you with today?"],
                    ["Caller", "I need a hot tub electrical setup at my home."],
                    ["My AI PA", "Sure, I can help. I can also answer common questions before I collect the details."],
                  ].map(([speaker, text], index) => (
                    <div key={speaker + index} className="rounded-lg border border-[#d7e7fb] bg-[linear-gradient(180deg,#ffffff,#eef6ff)] px-3 py-2 shadow-[0_14px_32px_-30px_rgba(37,99,235,0.8)]">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-black text-[#07142a]">{speaker}</p>
                        <p className="text-xs font-bold text-[#64748b]">10:15 AM</p>
                      </div>
                      <p className="mt-1 text-sm font-semibold leading-5 text-[#334155]">{text}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid content-center gap-4">
                {[
                  ["Name", "Brian Smith"],
                  ["Phone", "905-123-4567"],
                  ["Reason", "Hot tub electrical setup"],
                  ["Address", "63 York Street, Bestville, ON"],
                ].map(([label, value]) => (
                  <div key={label} className="flex gap-3">
                    <span className="mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#1d7df2] text-white">
                      <HeroIcon type="check" className="h-4 w-4" />
                    </span>
                    <div>
                      <p className="text-sm font-black text-[#07142a]">{label}</p>
                      <p className="text-sm font-semibold leading-5 text-[#405476]">{value}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </article>

          <article className="relative min-h-[410px] rounded-lg border border-[#52b86f] bg-white p-5 shadow-[0_30px_80px_-58px_rgba(22,163,74,0.68)]">
            <div className="grid gap-4">
              <div>
                <div className="flex items-center gap-4">
                  <span className="grid h-14 w-14 place-items-center rounded-full bg-[linear-gradient(180deg,#22c55e,#15803d)] text-3xl font-black text-white shadow-[0_18px_34px_-24px_rgba(21,128,61,1)]">3</span>
                  <p className="text-[clamp(1.4rem,1.75vw,1.8rem)] font-black leading-tight tracking-[-0.04em] text-[#13833c]">Text summaries sent</p>
                </div>
                <h3 className="mt-3 text-[clamp(1.18rem,1.38vw,1.48rem)] font-black leading-tight text-[#07142a]">Owner and caller both get clean follow-up texts</h3>
              </div>

              <div className="grid items-center gap-4 lg:grid-cols-[minmax(0,1fr)_132px] xl:grid-cols-[minmax(0,1fr)_148px] min-[1500px]:grid-cols-[1fr_190px]">
                <div className="grid gap-3">
                  {[
                    ["chat", "Text sent to owner"],
                    ["phone", "Text sent to caller"],
                    ["clipboard", "Job details collected"],
                    ["check", "Customer feels heard"],
                  ].map(([icon, text]) => (
                    <div key={text} className="flex items-center gap-3 rounded-lg bg-[#f0fdf4] px-3 py-2">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#dcfce7] text-[#13833c]">
                        <HeroIcon type={icon} className="h-5 w-5" />
                      </span>
                      <p className="text-sm font-black leading-5 text-[#07142a] min-[1500px]:text-base">{text}</p>
                    </div>
                  ))}
                </div>

                <div className="mx-auto h-[270px] w-full max-w-[190px] rounded-[24px] border-[4px] border-[#07142a] bg-white p-2 shadow-[0_22px_48px_-34px_rgba(15,23,42,0.95)] xl:h-[286px] min-[1500px]:h-[300px] min-[1500px]:w-[170px] min-[1500px]:rounded-[28px] min-[1500px]:border-[5px]">
                  <div className="mx-auto h-2 w-14 rounded-full bg-[#07142a] min-[1500px]:w-16" />
                  <div className="px-1 pt-3 text-center min-[1500px]:px-2 min-[1500px]:pt-4">
                    <p className="text-[0.66rem] font-black text-[#07142a] min-[1500px]:text-[0.76rem]">My AI PA</p>
                    <p className="mt-2 text-[0.58rem] font-semibold text-[#94a3b8] min-[1500px]:text-[0.68rem]">Today 10:16 AM</p>
                  </div>
                  <div className="mt-3 space-y-2">
                    <div className="rounded-lg bg-[#ecfdf5] p-2.5">
                      <p className="text-[0.62rem] font-black uppercase tracking-[0.08em] text-[#16a34a]">Owner alert</p>
                      <div className="mt-1 space-y-0.5 text-[0.53rem] font-bold leading-3 text-[#07142a] xl:text-[0.58rem] min-[1500px]:text-[0.68rem] min-[1500px]:leading-4">
                        <p>Brian Smith</p>
                        <p>905-123-4567</p>
                        <p>Hot tub wiring</p>
                        <p>63 York Street</p>
                      </div>
                    </div>
                    <div className="rounded-lg bg-[#e8f2ff] p-2.5">
                      <p className="text-[0.62rem] font-black uppercase tracking-[0.08em] text-[#1d7df2]">Caller text</p>
                      <p className="mt-1 text-[0.53rem] font-bold leading-3 text-[#07142a] xl:text-[0.58rem] min-[1500px]:text-[0.68rem] min-[1500px]:leading-4">
                        Thanks Brian. Tim&apos;s Electrical received your details and will follow up.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </article>

          <div className="pointer-events-none absolute left-[31.7%] top-[46%] hidden h-14 w-14 -translate-x-1/2 place-items-center rounded-full border-2 border-[#1d7df2] bg-white text-[#1d7df2] shadow-[0_16px_38px_-24px_rgba(37,99,235,0.85)] lg:grid">
            <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="2.8" aria-hidden="true">
              <path d="M4 12h15M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="pointer-events-none absolute left-[65%] top-[46%] hidden h-14 w-14 -translate-x-1/2 place-items-center rounded-full border-2 border-[#1d7df2] bg-white text-[#1d7df2] shadow-[0_16px_38px_-24px_rgba(37,99,235,0.85)] lg:grid">
            <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="2.8" aria-hidden="true">
              <path d="M4 12h15M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>

        <div className="mx-auto mt-6 grid max-w-[760px] gap-5 sm:grid-cols-2">
          <button
            type="button"
            onClick={onPlayDemo}
            className="inline-flex min-h-[72px] items-center justify-center gap-4 rounded-lg border-2 border-[#1d7df2] bg-white px-8 py-4 text-[clamp(1rem,1.45vw,1.45rem)] font-black leading-tight tracking-[-0.02em] text-[#0b3b7a] shadow-[0_18px_46px_-34px_rgba(37,99,235,0.72)] transition hover:-translate-y-0.5 hover:bg-[#eef6ff]"
          >
            <svg viewBox="0 0 24 24" className="h-7 w-7 text-[#1d7df2]" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              <path d="M4 9v6h4l5 4V5L8 9H4Z" />
              <path d="M16.5 9.5a4 4 0 0 1 0 5M19 7a8 8 0 0 1 0 10" />
            </svg>
            Hear Agent&apos;s Voice
          </button>
          <button
            type="button"
            onClick={onStart}
            className="inline-flex min-h-[72px] items-center justify-center gap-5 rounded-lg bg-[linear-gradient(180deg,#ff9a17,#ff6a00)] px-8 py-4 text-[clamp(1rem,1.45vw,1.45rem)] font-black leading-tight tracking-[-0.02em] text-white shadow-[0_22px_54px_-34px_rgba(255,106,0,0.95)] transition hover:-translate-y-0.5"
          >
            Start Free Trial
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2.7" aria-hidden="true">
              <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>

        <div className="mx-auto mt-5 flex max-w-[660px] flex-wrap items-center justify-center gap-x-8 gap-y-3 text-[0.98rem] font-semibold text-[#173763]">
          {[
            ["check", "14-day free trial"],
            ["shield", "No credit card"],
            ["lock", "Cancel anytime"],
          ].map(([icon, text], index) => (
            <div key={text} className="flex items-center gap-3">
              {index ? <span className="hidden h-7 w-px bg-[#9db7d8] sm:block" /> : null}
              <span className="grid h-6 w-6 place-items-center rounded-full border border-[#1d7df2] text-[#1d7df2]">
                <HeroIcon type={icon} className="h-4 w-4" />
              </span>
              <span>{text}</span>
            </div>
          ))}
        </div>
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
  const [audioDuration, setAudioDuration] = useState(133);
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
            <a href="tel:+12495033301" className="mt-1 block text-xl font-black tracking-[-0.02em] text-[#ff9a22] transition hover:text-[#ffb35c]">
              (249) 503-3301
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
          @media (max-width: 767px) {
            .landing-call-dashboard {
              max-width: min(100%, 360px);
            }
            .landing-call-dashboard > div {
              height: auto;
              min-height: 0;
              border-radius: 26px;
            }
            .landing-call-dashboard > div > div {
              grid-template-columns: minmax(0, 1fr);
            }
            .landing-call-panel {
              min-height: 390px;
              border-right: 0;
              border-bottom: 1px solid #1b2638;
              padding: 1.25rem;
            }
            .landing-call-status {
              font-size: 0.9rem;
            }
            .landing-caller-card {
              margin-top: 1.45rem;
            }
            .landing-caller-avatar {
              height: 4.75rem;
              width: 4.75rem;
              font-size: 1.7rem;
            }
            .landing-caller-name {
              margin-top: 1rem;
              font-size: 1.55rem;
            }
            .landing-caller-phone {
              margin-top: 0.6rem;
              font-size: 1.1rem;
            }
            .landing-caller-tag {
              margin-top: 0.85rem;
              padding: 0.45rem 0.95rem;
              font-size: 0.82rem;
            }
            .landing-call-controls svg[viewBox="0 0 120 42"] {
              height: 3.5rem;
            }
            .landing-call-button {
              height: 3rem;
              width: 3rem;
            }
            .landing-hangup-button {
              height: 3.8rem;
              width: 3.8rem;
            }
            .landing-conversation-column {
              padding: 1.25rem;
            }
            .landing-conversation-header h3 {
              font-size: 1.25rem;
            }
            .landing-conversation-header span {
              font-size: 0.62rem;
              padding: 0.32rem 0.65rem;
            }
            .landing-conversation-panel {
              border-radius: 20px;
              padding: 0.9rem;
            }
            .landing-conversation-panel div {
              max-width: 88%;
              font-size: 0.75rem;
              line-height: 1.18;
            }
            .landing-dashboard-bottom {
              grid-template-columns: minmax(0, 1fr);
              gap: 0.8rem;
            }
            .landing-lead-note {
              justify-content: flex-start;
              font-size: 0.82rem;
            }
            .landing-lead-card {
              border-radius: 18px;
              padding: 0.9rem;
            }
          }
          @media (min-width: 1024px) and (max-height: 900px) {
            .landing-hero-shell {
              padding-top: 1rem;
              padding-bottom: 1rem;
            }
            .landing-hero-grid {
              gap: 1.5rem;
              padding-top: 0.5rem;
              padding-bottom: 1rem;
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
              position: relative;
              z-index: 2;
            }
            .landing-phone {
              height: clamp(560px, calc(100vh - 76px), 640px);
              margin-top: 0;
              max-width: 360px;
            }
            .landing-summary > div {
              height: clamp(560px, calc(100vh - 76px), 640px);
            }
            .landing-call-dashboard > div {
              height: min(630px, calc(100vh - 78px));
            }
          }
          @media (min-width: 1024px) and (max-height: 720px) {
            .landing-hero-shell {
              padding-top: 0.75rem;
              padding-bottom: 0.75rem;
            }
            .landing-hero-grid {
              padding-top: 0;
              padding-bottom: 0;
            }
            .landing-phone {
              height: 560px;
            }
            .landing-summary > div {
              height: 560px;
            }
            .landing-call-dashboard > div {
              height: min(540px, calc(100vh - 96px));
              border-radius: 28px;
            }
            .landing-call-panel,
            .landing-conversation-column {
              padding: 1.15rem 1.25rem;
            }
            .landing-call-status {
              font-size: 0.94rem;
            }
            .landing-caller-card {
              margin-top: 1.35rem;
            }
            .landing-caller-avatar {
              width: 4.85rem;
              height: 4.85rem;
              font-size: 1.75rem;
            }
            .landing-caller-name {
              margin-top: 1rem;
              font-size: 1.55rem;
            }
            .landing-caller-phone {
              margin-top: 0.6rem;
              font-size: 1.08rem;
            }
            .landing-caller-tag {
              margin-top: 0.8rem;
              padding: 0.42rem 0.9rem;
              font-size: 0.8rem;
            }
            .landing-call-controls svg[viewBox="0 0 120 42"] {
              height: 3.35rem;
            }
            .landing-call-controls > div {
              margin-top: 1.1rem;
            }
            .landing-call-button {
              width: 2.95rem;
              height: 2.95rem;
            }
            .landing-call-button svg {
              width: 1.45rem;
              height: 1.45rem;
            }
            .landing-hangup-button {
              width: 3.75rem;
              height: 3.75rem;
            }
            .landing-hangup-button svg {
              width: 1.55rem;
              height: 1.55rem;
            }
            .landing-conversation-header h3 {
              font-size: 1.28rem;
            }
            .landing-conversation-header span {
              font-size: 0.62rem;
              padding: 0.28rem 0.68rem;
            }
            .landing-conversation-panel {
              margin-top: 0.55rem;
              border-radius: 20px;
              padding: 0.72rem 0.82rem;
            }
            .landing-conversation-panel p {
              font-size: 0.68rem;
            }
            .landing-conversation-panel div {
              border-radius: 14px;
              padding: 0.5rem 0.78rem;
              font-size: 0.76rem;
              line-height: 1.15;
            }
            .landing-dashboard-bottom {
              margin-top: 0.7rem;
              grid-template-columns: minmax(0, 0.93fr) minmax(190px, 0.9fr);
              gap: 0.8rem;
            }
            .landing-checklist-card {
              border-radius: 18px;
              padding: 0.75rem;
            }
            .landing-checklist-card p {
              font-size: 0.62rem;
            }
            .landing-checklist-card > div {
              gap: 0.34rem;
              font-size: 0.74rem;
            }
            .landing-checklist-card > div > div {
              grid-template-columns: auto 1fr;
              gap: 0.48rem;
            }
            .landing-checklist-card > div > div > span:nth-child(2) {
              white-space: nowrap;
            }
            .landing-checklist-card > div > div > svg {
              display: none;
            }
            .landing-checklist-card span {
              width: 1.25rem;
              height: 1.25rem;
            }
            .landing-lead-stack {
              gap: 0.45rem;
            }
            .landing-lead-note {
              justify-content: flex-start;
              font-size: 0.72rem;
            }
            .landing-lead-note svg {
              width: 1.7rem;
              height: 1.15rem;
            }
            .landing-lead-card {
              border-radius: 18px;
              padding: 0.72rem 0.82rem;
              box-shadow: 0 0 0 4px rgba(37,99,235,0.18), 0 22px 52px -28px rgba(37,99,235,0.95);
            }
            .landing-lead-card span {
              font-size: 0.78rem;
            }
            .landing-lead-card span span {
              width: 1.45rem;
              height: 1.45rem;
            }
            .landing-lead-card > div + div {
              margin-top: 0.55rem;
              font-size: 0.69rem;
              line-height: 1.15;
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
              <a href="tel:+12495033301" className="mt-1 block text-xl font-black tracking-[-0.02em] text-[#ff9a22] transition hover:text-[#ffb35c]">
                (249) 503-3301
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

          <div className="landing-hero-grid grid flex-1 gap-8 py-9 lg:grid-cols-[minmax(0,1fr)_minmax(660px,800px)] lg:items-center 2xl:grid-cols-[minmax(500px,1fr)_800px] 2xl:gap-12 2xl:py-10">
            <div className="relative z-10 min-w-0 max-w-[800px] xl:max-w-none lg:-translate-y-3 2xl:-translate-y-4">
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
                  ["phone", "Talks to the customer naturally"],
                  ["people", "Provides more information than a voicemail"],
                  ["chat", "Easy setup: forward calls after 3 unanswered rings"],
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

              <p className="landing-hero-footnote mt-5 text-lg font-medium text-[#334155] 2xl:text-xl">PIPEDA Compliant&nbsp;&nbsp;&bull;&nbsp;&nbsp;14-day free trial&nbsp;&nbsp;&bull;&nbsp;&nbsp;No credit card</p>
            </div>

            <div className="relative z-0 mt-8 flex justify-center lg:mt-0 lg:self-start">
              <HeroCallDashboard />
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
                <p className="text-[1.1rem] font-medium leading-8 text-[#e8e4ff] sm:text-[1.25rem]">Talks to the customer naturally</p>
              </div>
              <div className="flex items-start gap-3">
                <span className="mt-2.5 h-2.5 w-2.5 rounded-full bg-[#a78bfa] shadow-[0_0_16px_rgba(167,139,250,0.85)]" />
                <p className="text-[1.1rem] font-medium leading-8 text-[#e8e4ff] sm:text-[1.25rem]">Provides more information than a voicemail</p>
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

      <VoicemailLossesArtboard onStart={goToSignup} onPlayDemo={playDemo} />

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

      <section id="contractor-proof" ref={demoRef} className="scroll-mt-[96px] bg-[linear-gradient(180deg,#f7fbff_0%,#edf6ff_100%)]">
        <div className="mx-auto w-full max-w-[1260px] px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
          <div className="mx-auto max-w-[980px] text-center">
            <p className="text-[0.7rem] font-black uppercase tracking-[0.22em] text-[#1d7df2] sm:text-[0.78rem]">Designed for contractors</p>
            <h2 className="mx-auto mt-2 max-w-[860px] text-[clamp(2rem,4vw,3.2rem)] font-black leading-[0.98] tracking-[-0.052em] text-[#07142a]">
              Designed for contractors who cannot pause the job to answer every call.
            </h2>
            <p className="mx-auto mt-3 max-w-[780px] text-[0.98rem] font-medium leading-7 text-[#475569] sm:text-[1.08rem]">
              Electrical, plumbing, HVAC, and contractor teams get a practical assistant that answers, collects details, and sends clean follow-up while the crew keeps moving.
            </p>
          </div>

          <div className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {benefitCards.map((item) => (
              <article
                key={item.title}
                className={
                  "relative min-h-[132px] overflow-hidden rounded-[8px] border border-[#dbeafe] bg-white px-4 py-4 shadow-[0_18px_44px_-34px_rgba(15,23,42,0.32)] " +
                  item.glow
                }
              >
                <div className="flex items-start gap-3">
                  <div className={`grid h-12 w-12 shrink-0 place-items-center rounded-[8px] bg-gradient-to-br ${item.accent} text-white shadow-[0_18px_36px_-28px_rgba(15,23,42,0.5)]`}>
                    <BenefitSymbol code={item.code} />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-[1rem] font-black leading-tight tracking-[-0.025em] text-[#07142a]">{item.eyebrow}</h3>
                    <p className="mt-1 text-[0.86rem] font-semibold leading-5 text-[#475569]">{item.title}</p>
                    <p className="mt-2 text-[0.78rem] font-medium leading-5 text-[#64748b]">{item.body}</p>
                  </div>
                </div>
              </article>
            ))}
          </div>

          <div className="mt-5 overflow-hidden rounded-[8px] border border-[#123253] bg-[#051d3b] shadow-[0_30px_80px_-48px_rgba(7,20,42,0.74)]">
            <div className="grid gap-5 p-4 sm:p-5 lg:grid-cols-[1.05fr_0.95fr] lg:p-7">
              <div className="min-w-0">
                <p className="text-[0.72rem] font-black uppercase tracking-[0.16em] text-[#64c9ff]">Proof in action</p>
                <h3 className="mt-2 max-w-[610px] text-[clamp(1.55rem,2.8vw,2.45rem)] font-black leading-[1.02] tracking-[-0.045em] text-white">
                  Hear a real example of the agent taking a customer inquiry.
                </h3>
                <p className="mt-3 max-w-[590px] text-[0.96rem] font-medium leading-7 text-[#cfe7ff]">
                  Hear a sample of a real-life conversation. The caller is engaged in meaningful dialogue, gets FAQs answered, and is prompted to provide job details along with an expected callback.
                </p>

                <div className="mt-4 rounded-[8px] border border-[#21476f] bg-[#092646] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 gap-3">
                      <button
                        type="button"
                        onClick={toggleAudio}
                        className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-[#1677e8] text-white shadow-[0_16px_34px_-22px_rgba(22,119,232,0.95)] transition hover:-translate-y-0.5 hover:brightness-110"
                        aria-label={audioPlaying ? "Pause demo audio" : "Play demo audio"}
                      >
                        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor" aria-hidden="true">
                          <path d={audioPlaying ? "M7 5h3v14H7V5Zm7 0h3v14h-3V5Z" : "M8 5.8v12.4L18 12 8 5.8Z"} />
                        </svg>
                      </button>
                      <div className="min-w-0">
                        <p className="text-[0.72rem] font-black uppercase tracking-[0.14em] text-[#7dd3fc]">Real call example</p>
                        <p className="mt-1 text-[1.05rem] font-black leading-tight text-white sm:text-[1.22rem]">Electrical setup lead</p>
                        <p className="mt-1 max-w-[440px] text-[0.86rem] font-medium leading-6 text-[#cfe7ff]">
                          My AI PA captures the caller&apos;s name, job details, address, and best callback time.
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={toggleAudio}
                      className="inline-flex min-h-[38px] shrink-0 items-center justify-center gap-2 rounded-[8px] bg-[#ff8b1f] px-4 text-[0.72rem] font-black uppercase tracking-[0.12em] text-white shadow-[0_16px_34px_-22px_rgba(255,139,31,0.95)] transition hover:-translate-y-0.5 hover:brightness-110"
                    >
                      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
                        <path d={audioPlaying ? "M7 5h3v14H7V5Zm7 0h3v14h-3V5Z" : "M8 5.8v12.4L18 12 8 5.8Z"} />
                      </svg>
                      {audioPlaying ? "Pause" : "Play"}
                    </button>
                  </div>

                  <div className="mt-4 flex h-12 min-w-0 items-center gap-1">
                    {waveformBars.map((bar, index) => {
                      const played = index / Math.max(waveformBars.length - 1, 1) <= playbackProgress;
                      return (
                        <span
                          key={`bar-${index}`}
                          className={"w-full rounded-full transition-all duration-300 " + (played ? "bg-[#ff8b1f]" : "bg-[#54708f]")}
                          style={{ height: `${7 + bar * 34}px` }}
                        />
                      );
                    })}
                  </div>
                  <div className="mt-3 flex items-center gap-3">
                    <span className="w-11 text-xs font-black text-[#dbeafe]">{formatClock(audioTime)}</span>
                    <input
                      type="range"
                      min="0"
                      max={audioDuration}
                      step="0.1"
                      value={audioTime}
                      onChange={handleScrub}
                      className="h-1.5 flex-1 accent-[#ff8b1f]"
                      aria-label="Scrub demo audio"
                    />
                    <span className="w-11 text-right text-xs font-black text-[#dbeafe]">{formatClock(audioDuration)}</span>
                  </div>
                  {audioError ? <p className="mt-3 text-sm font-bold text-rose-300">{audioError}</p> : null}
                </div>

                <div className="mt-3 rounded-[8px] border border-[#21476f] bg-[#092646] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="grid h-7 w-7 place-items-center rounded-full bg-[#0d3764] text-[#8bdcff]">
                        <HeroIcon type="chat" className="h-4 w-4" />
                      </span>
                      <p className="text-[0.72rem] font-black uppercase tracking-[0.14em] text-[#7dd3fc]">Live transcript</p>
                    </div>
                    <span className="rounded-full border border-[#7dd3fc]/40 bg-[#0d3764] px-2.5 py-1 text-[0.66rem] font-black uppercase tracking-[0.1em] text-[#a9e8ff]">
                      {activeTranscript.speaker}
                    </span>
                  </div>
                  <p className="mt-3 text-[0.95rem] font-medium leading-6 text-[#eef6ff]">{activeTranscript.text}</p>
                </div>

                <audio
                  key={demoCallAudioSrc}
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

              <div className="min-w-0 space-y-3">
                <div className="overflow-hidden rounded-[8px] border border-[#b9d8ff] bg-white shadow-[0_18px_42px_-34px_rgba(0,0,0,0.45)]">
                  <div className="flex items-center justify-between gap-3 border-b border-[#dbeafe] bg-[#f8fbff] px-4 py-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[7px] bg-[#eaf4ff] text-[#2563eb]">
                        <HeroIcon type="clipboard" className="h-4 w-4" />
                      </span>
                      <p className="truncate text-[0.68rem] font-black uppercase tracking-[0.14em] text-[#0f4d89]">Owner gets this text summary</p>
                    </div>
                    <span className="whitespace-nowrap rounded-full bg-[#dff7e9] px-2.5 py-1 text-[0.62rem] font-black uppercase tracking-[0.08em] text-[#15803d]">Sent</span>
                  </div>
                  <div className="px-4 py-3 text-[0.84rem] font-medium leading-5 text-[#1f2937]">
                    <p className="font-black text-[#07142a]">New job details</p>
                    <p><span className="font-black">Name:</span> Brian</p>
                    <p><span className="font-black">Phone:</span> 905-123-4567</p>
                    <p><span className="font-black">Service:</span> Hot tub electrical setup</p>
                    <p><span className="font-black">Address:</span> 63 York Street</p>
                    <p><span className="font-black">Callback:</span> Around 7 PM</p>
                  </div>
                </div>

                <div className="overflow-hidden rounded-[8px] border border-[#b9eadf] bg-white shadow-[0_18px_42px_-34px_rgba(0,0,0,0.45)]">
                  <div className="flex items-center justify-between gap-3 border-b border-[#d6f3ee] bg-[#f2fffb] px-4 py-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[7px] bg-[#dffaf2] text-[#0f766e]">
                        <HeroIcon type="check" className="h-4 w-4" />
                      </span>
                      <p className="truncate text-[0.68rem] font-black uppercase tracking-[0.14em] text-[#08776f]">Caller gets this confirmation</p>
                    </div>
                    <span className="whitespace-nowrap rounded-full bg-[#dff7e9] px-2.5 py-1 text-[0.62rem] font-black uppercase tracking-[0.08em] text-[#15803d]">Confirmed</span>
                  </div>
                  <p className="px-4 py-3 text-[0.88rem] font-medium leading-6 text-[#12302d]">
                    Thanks for calling Tim&apos;s Electrical. Your hot tub setup request has been sent to the team, and someone will follow up based on the details you provided.
                  </p>
                </div>

                <div className="grid gap-2 rounded-[8px] bg-white px-3 py-3 sm:grid-cols-2">
                  {[
                    ["shield", "No missed calls", "24/7 AI answering"],
                    ["clock", "Work keeps moving", "You never stop the job"],
                    ["chat", "Clean follow-up", "Texts both you and the caller"],
                    ["people", "Built for trades", "Contractor-focused conversations"],
                  ].map(([icon, title, body]) => (
                    <div key={title} className="flex items-start gap-2 rounded-[7px] border border-[#e2e8f0] bg-[#f8fbff] px-3 py-2">
                      <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white text-[#0f4d89] shadow-[0_8px_18px_-15px_rgba(15,23,42,0.6)]">
                        <HeroIcon type={icon} className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-[0.82rem] font-black leading-tight text-[#07142a]">{title}</p>
                        <p className="mt-1 text-[0.72rem] font-medium leading-4 text-[#64748b]">{body}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid gap-3 border-t border-white/12 px-4 py-3 text-[#dbeafe] sm:grid-cols-3 sm:px-5 lg:px-7">
              {[
                ["shield", "Trusted by contractors", "across North America"],
                ["people", "1,000+ contractors", "already using My AI PA"],
                ["lock", "100% risk-free", "14-day free trial"],
              ].map(([icon, title, body]) => (
                <div key={title} className="flex items-center gap-3 sm:justify-center">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/18 bg-white/8 text-[#a9e8ff]">
                    <HeroIcon type={icon} className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[0.78rem] font-black leading-tight text-white">{title}</p>
                    <p className="text-[0.7rem] font-semibold leading-tight text-[#b7d7f6]">{body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="pricing" ref={pricingRef} className="scroll-mt-[96px] bg-[linear-gradient(180deg,#edf7ff_0%,#f8fcff_55%,#eef8ff_100%)]">
        <div className="mx-auto w-full max-w-[1320px] px-4 py-14 sm:px-6 lg:px-8 lg:py-20">
          <div className="mx-auto max-w-5xl text-center">
            <p className="inline-flex rounded-full border border-[#c7ddff] bg-white/86 px-5 py-2 text-[0.84rem] font-black uppercase tracking-[0.18em] text-[#2563eb] shadow-[0_16px_44px_-36px_rgba(37,99,235,0.58)]">Simple monthly plan</p>
            <h2 className="mx-auto mt-4 max-w-[980px] text-[clamp(2.1rem,4vw,3.35rem)] font-black leading-[1.04] tracking-[-0.052em] text-[#07142a]">
              Clear pricing for businesses that just want calls handled properly.
            </h2>
            <p className="mx-auto mt-3 max-w-[900px] text-[clamp(1rem,1.3vw,1.16rem)] font-medium leading-8 text-[#334155]">
              One simple plan for getting calls answered. Includes 60 AI call minutes, with extra minutes billed clearly at $0.25/min.
            </p>
          </div>

          {pricingCards.map((plan) => (
            <div key={plan.name} className="mt-8 grid items-start gap-6 lg:grid-cols-[1.38fr_0.92fr]">
              <div className="relative min-w-0 overflow-hidden rounded-[10px] border border-[#d8e7fb] bg-white shadow-[0_30px_84px_-56px_rgba(15,23,42,0.38)]">
                <div className="absolute bottom-0 left-0 top-0 hidden w-[58px] border-r border-dashed border-[#d7e7fb] bg-[#fbfdff] sm:block" aria-hidden="true">
                  <div className="flex h-full flex-col items-center justify-around py-4">
                    {Array.from({ length: 11 }).map((_, index) => (
                      <span key={`ticket-hole-${index}`} className="h-5 w-5 rounded-full border border-[#dbeafe] bg-[#edf5ff] shadow-[inset_0_2px_6px_rgba(15,23,42,0.12)]" />
                    ))}
                  </div>
                </div>
                <div className="absolute inset-x-0 bottom-[-1px] h-3 bg-[linear-gradient(135deg,transparent_0_12px,#edf7ff_12px_18px,transparent_18px_30px)] bg-[length:30px_12px]" aria-hidden="true" />

                <div className="relative px-5 py-5 sm:pl-[88px] sm:pr-7 lg:px-8 lg:pl-[96px] lg:py-7">
                  <div className="flex flex-col gap-5 border-b-2 border-[#73a6ef] pb-5 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-3">
                        <p className="text-[0.84rem] font-black uppercase tracking-[0.18em] text-[#2563eb]">Plan Quote</p>
                        <span className="rounded-full bg-[#eef6ff] px-3 py-1 text-[0.68rem] font-black uppercase tracking-[0.12em] text-[#0f4d89]">Quote #AI-0600</span>
                      </div>
                      <h3 className="mt-4 text-[clamp(2.15rem,5vw,3.35rem)] font-black leading-none tracking-[-0.055em] text-[#07142a]">{plan.name}</h3>
                      <p className="mt-2 text-[1rem] font-semibold text-[#64748b]">Simple monthly plan</p>
                    </div>
                    <div className="rounded-[10px] bg-[linear-gradient(135deg,#eff7ff,#ffffff)] px-4 py-3 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.86)] sm:text-right">
                      <div className="flex items-end gap-2 sm:justify-end">
                        <span className="text-[clamp(3rem,8vw,4.4rem)] font-black leading-none tracking-[-0.065em] text-[#176bff]">{plan.price}</span>
                        <span className="pb-2 text-lg font-black text-[#475569]">/ month</span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-5">
                    <div className="grid grid-cols-[1fr_auto] gap-4 border-b border-[#e2e8f0] pb-2 text-[0.78rem] font-black uppercase tracking-[0.14em] text-[#64748b]">
                      <span>Description</span>
                      <span>Price</span>
                    </div>

                    {[
                      ["phone", "60 AI call minutes", "AI answers calls and handles inquiries", "Included"],
                      ["clock", "Extra minutes", "Billed clearly in 1-minute increments", "$0.25/min after that"],
                    ].map(([icon, title, body, price]) => (
                      <div key={title} className="grid grid-cols-[1fr_auto] items-center gap-4 border-b border-dashed border-[#d8e2ef] py-4">
                        <div className="flex min-w-0 items-center gap-3">
                          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[linear-gradient(180deg,#2f8cff,#176bff)] text-white shadow-[0_14px_28px_-20px_rgba(23,107,255,0.9)]">
                            <HeroIcon type={icon} className="h-5 w-5" />
                          </span>
                          <div className="min-w-0">
                            <p className="text-[1rem] font-black leading-tight text-[#07142a]">{title}</p>
                            <p className="mt-1 text-[0.84rem] font-medium leading-5 text-[#64748b]">{body}</p>
                          </div>
                        </div>
                        <p className="max-w-[150px] text-right text-[0.92rem] font-black leading-tight text-[#334155]">{price}</p>
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 space-y-2 text-[0.94rem] font-black text-[#475569]">
                    <div className="flex items-center justify-between gap-4">
                      <span>Subtotal</span>
                      <span>$79.00</span>
                    </div>
                    <div className="flex items-center justify-between gap-4 border-b-2 border-[#73a6ef] pb-3">
                      <span>Taxes</span>
                      <span>-</span>
                    </div>
                    <div className="flex items-center justify-between gap-4 pt-2">
                      <span className="text-[0.84rem] uppercase tracking-[0.14em] text-[#2563eb]">Total due today</span>
                      <span className="text-[clamp(1.55rem,3vw,2rem)] font-black tracking-[-0.04em] text-[#176bff]">$79.00 <span className="text-[1rem] text-[#475569]">/ month</span></span>
                    </div>
                  </div>

                  <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_0.92fr] lg:items-end">
                    <div className="inline-flex max-w-[340px] items-center gap-3 rounded-[8px] border border-[#d8e7fb] bg-[#f8fbff] px-4 py-3 text-[#334155] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#eaf4ff] text-[#176bff]">
                        <HeroIcon type="check" className="h-4 w-4" />
                      </span>
                      <p className="text-[0.92rem] font-black leading-5">
                        No long-term contracts. <span className="font-semibold text-[#64748b]">Just dependable call coverage.</span>
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={goToSignup}
                      className="inline-flex min-h-[54px] items-center justify-center gap-3 rounded-[8px] bg-[linear-gradient(180deg,#ff8b1f,#ff6b00)] px-7 text-[1rem] font-black text-white shadow-[0_18px_42px_-24px_rgba(255,106,0,0.95)] transition hover:-translate-y-0.5 hover:brightness-110"
                    >
                      Start Free Trial
                      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
                        <path d="M5 12h13M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  </div>

                  <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-[0.8rem] font-bold text-[#64748b]">
                    {["14-day free trial", "No setup fee", "Cancel anytime"].map((item) => (
                      <span key={item} className="inline-flex items-center gap-2">
                        <span className="grid h-5 w-5 place-items-center rounded-full border border-[#cbd5e1] text-[#64748b]">
                          <HeroIcon type="check" className="h-3 w-3" />
                        </span>
                        {item}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              <div className="grid min-w-0 gap-4">
                <div className="relative rounded-[10px] border-[5px] border-[#07142a] bg-white p-5 shadow-[0_24px_64px_-44px_rgba(7,20,42,0.52)]">
                  <div className="absolute left-1/2 top-[-20px] h-10 w-[112px] -translate-x-1/2 rounded-b-[18px] rounded-t-[8px] bg-[linear-gradient(180deg,#334155,#0f172a)] shadow-[0_14px_28px_-20px_rgba(7,20,42,0.72)]" aria-hidden="true">
                    <span className="absolute left-1/2 top-[-10px] h-5 w-10 -translate-x-1/2 rounded-t-full bg-[#cbd5e1]" />
                  </div>
                  <p className="mt-3 text-[0.82rem] font-black uppercase tracking-[0.16em] text-[#2563eb]">What&apos;s included</p>
                  <div className="mt-4 divide-y divide-dashed divide-[#d8e2ef]">
                    {[
                      ["phone", "AI answers every call", "Never miss another opportunity."],
                      ["chat", "Lead details by text", "Job notes, caller info, and timing delivered after the call."],
                      ["shield", "Caller confirmation", "We confirm details and make sure nothing slips through."],
                      ["CHART", "Usage tracking", "Know your minutes. Pay only for what you use."],
                    ].map(([icon, title, body]) => (
                      <div key={title} className="flex items-center gap-4 py-3">
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#00b84a] text-white">
                          <HeroIcon type="check" className="h-4 w-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-[1rem] font-black leading-tight text-[#07142a]">{title}</p>
                          <p className="mt-1 text-[0.82rem] font-medium leading-5 text-[#64748b]">{body}</p>
                        </div>
                        <span className="hidden h-10 w-10 shrink-0 place-items-center text-[#4e8fe8] sm:grid">
                          {icon === "CHART" ? <BenefitSymbol code="CHART" /> : <HeroIcon type={icon} className="h-7 w-7" />}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-[10px] border border-[#d8e7fb] bg-white p-4 shadow-[0_22px_58px_-46px_rgba(15,23,42,0.35)]">
                  <p className="text-center text-[0.82rem] font-black uppercase tracking-[0.15em] text-[#2563eb]">Pay only for extra minutes</p>
                  <div className="mt-4 grid items-center gap-3 text-center sm:grid-cols-[1fr_auto_1fr_auto_1fr]">
                    <div className="rounded-[8px] bg-[#eaf4ff] px-4 py-3 text-[#176bff]">
                      <p className="text-[2rem] font-black leading-none">60</p>
                      <p className="text-[0.74rem] font-black leading-tight text-[#334155]">included minutes</p>
                    </div>
                    <span className="text-2xl font-black text-[#2563eb]">-</span>
                    <div className="rounded-[8px] bg-[#f8fbff] px-4 py-3 text-[#334155]">
                      <p className="text-[0.9rem] font-black">minutes</p>
                      <p className="text-[0.74rem] font-black">used</p>
                    </div>
                    <span className="text-2xl font-black text-[#2563eb]">=</span>
                    <div className="rounded-[8px] bg-[#e8f9ef] px-4 py-3 text-[#15803d]">
                      <p className="text-[0.9rem] font-black">extra minutes</p>
                      <p className="text-[0.74rem] font-black">x $0.25/min</p>
                    </div>
                  </div>
                  <p className="mt-3 text-center text-[0.84rem] font-semibold text-[#64748b]">Billed in 1-minute increments. No surprises.</p>
                </div>
              </div>
            </div>
          ))}

          <div className="mt-7 grid gap-3 rounded-[10px] border border-[#d8e7fb] bg-white px-4 py-4 shadow-[0_22px_58px_-48px_rgba(15,23,42,0.35)] sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["shield", "No setup fee", "Start in minutes."],
              ["calendar", "14-day free trial", "Try risk-free."],
              ["refresh", "Cancel anytime", "No long-term contracts."],
              ["lock", "Secure & private", "Your data stays protected."],
            ].map(([icon, title, body]) => (
              <div key={title} className="flex items-center gap-3 px-3 py-2 lg:border-l lg:first:border-l-0 lg:border-[#e2e8f0]">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[linear-gradient(180deg,#2f8cff,#176bff)] text-white shadow-[0_16px_30px_-22px_rgba(23,107,255,0.95)]">
                  {icon === "calendar" ? (
                    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2.1" aria-hidden="true">
                      <rect x="4" y="5.5" width="16" height="14" rx="2" />
                      <path d="M8 3.5v4M16 3.5v4M4 10h16" strokeLinecap="round" />
                    </svg>
                  ) : icon === "refresh" ? (
                    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2.1" aria-hidden="true">
                      <path d="M20 7v5h-5" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M4 17v-5h5" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M18.2 9A7 7 0 0 0 6.3 6.8M5.8 15a7 7 0 0 0 11.9 2.2" strokeLinecap="round" />
                    </svg>
                  ) : (
                    <HeroIcon type={icon} className="h-6 w-6" />
                  )}
                </span>
                <div className="min-w-0">
                  <p className="text-[0.95rem] font-black leading-tight text-[#07142a]">{title}</p>
                  <p className="mt-1 text-[0.82rem] font-medium leading-5 text-[#64748b]">{body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="setup" className="scroll-mt-[96px] overflow-hidden bg-[linear-gradient(180deg,#eef8ff_0%,#dff1ff_100%)]">
        <div className="mx-auto w-full max-w-[1320px] px-4 py-14 sm:px-6 lg:px-8 lg:py-20">
          <div className="mx-auto max-w-5xl text-center">
            <p className="inline-flex rounded-full border border-[#b9d8ff] bg-white/86 px-5 py-2 text-[0.84rem] font-black uppercase tracking-[0.18em] text-[#2563eb] shadow-[0_16px_44px_-36px_rgba(37,99,235,0.58)]">5-minute activation route</p>
            <h2 className="mx-auto mt-5 max-w-[920px] text-[clamp(2.35rem,4.7vw,4.2rem)] font-black leading-[1.04] tracking-[-0.052em] text-[#07142a]">
              Turn missed calls into answered calls without changing your number.
            </h2>
            <p className="mx-auto mt-4 max-w-[820px] text-[clamp(1.04rem,1.28vw,1.18rem)] font-medium leading-8 text-[#334155]">
              Setup is simple: add your business info, test the agent, then forward your current number when you are ready.
            </p>
          </div>

          <div className="mt-8 rounded-[14px] border border-[#cfe1f6] bg-white p-4 shadow-[0_30px_84px_-58px_rgba(15,23,42,0.45)] sm:p-5 lg:p-6">
            <div className="grid gap-4 lg:grid-cols-[0.92fr_1.16fr] lg:items-stretch">
              <div className="rounded-[12px] bg-[linear-gradient(145deg,#07142a,#10325c)] p-5 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-[0.75rem] font-black uppercase tracking-[0.16em] text-[#8bdcff]">Forwarding preview</p>
                    <p className="mt-2 text-[1.55rem] font-black leading-tight tracking-[-0.035em]">Your number stays yours.</p>
                  </div>
                  <span className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full bg-[#063c24] px-3 py-2 text-[0.7rem] font-black uppercase tracking-[0.08em] text-[#a7f3d0]">
                    <span className="h-2.5 w-2.5 rounded-full bg-[#00b84a]" />
                    Ready
                  </span>
                </div>

                <div className="mt-6 grid gap-3">
                  {[
                    ["Current business number", "Keep what customers already know", "phone"],
                    ["My AI PA answers", "Questions handled and details collected", "headset"],
                    ["Text summary sent", "Owner and caller both get follow-up", "chat"],
                  ].map(([title, body, icon], index) => (
                    <div key={title} className="grid grid-cols-[44px_1fr] items-center gap-3 rounded-[10px] border border-white/12 bg-white/[0.07] px-3 py-3">
                      <span className="grid h-11 w-11 place-items-center rounded-full bg-white/10 text-[#8bdcff]">
                        {icon === "phone" ? (
                          <HeroIcon type="phone" className="h-5 w-5" />
                        ) : icon === "chat" ? (
                          <HeroIcon type="chat" className="h-5 w-5" />
                        ) : (
                          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                            <path d="M4 13a8 8 0 0 1 16 0" strokeLinecap="round" />
                            <path d="M4 13v4a2 2 0 0 0 2 2h2v-6H6a2 2 0 0 0-2 2Zm16 0v4a2 2 0 0 1-2 2h-2v-6h2a2 2 0 0 1 2 2Z" strokeLinecap="round" strokeLinejoin="round" />
                            <path d="M14 20h-2" strokeLinecap="round" />
                          </svg>
                        )}
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="shrink-0 whitespace-nowrap text-[0.72rem] font-black uppercase tracking-[0.06em] text-[#ffbd74]">0{index + 1}</span>
                          <p className="text-[1rem] font-black leading-tight">{title}</p>
                        </div>
                        <p className="mt-1 text-[0.86rem] font-medium leading-5 text-[#dbeafe]">{body}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid gap-4">
                <div className="grid gap-3 md:grid-cols-3">
                  {setupSteps.map((step, index) => {
                    const shortTitles = ["Add business info", "Run a test call", "Forward calls"];
                    const badges = ["2 min", "Listen back", "Go live"];
                    const iconType = index === 0 ? "clipboard" : index === 1 ? "headset" : "phone";
                    return (
                      <article key={step} className="relative overflow-hidden rounded-[12px] border border-[#d8e7fb] bg-[#f8fbff] p-4 shadow-[0_18px_44px_-38px_rgba(15,23,42,0.28)]">
                        <div className="flex items-center justify-between gap-3">
                          <span className="grid h-12 w-12 place-items-center rounded-full bg-[linear-gradient(180deg,#78e2ff,#176bff)] text-[1.45rem] font-black text-white shadow-[0_16px_30px_-22px_rgba(23,107,255,0.95)]">
                            {index + 1}
                          </span>
                          <span className="rounded-full bg-[#e8f9ef] px-3 py-1 text-[0.68rem] font-black uppercase tracking-[0.1em] text-[#15803d]">{badges[index]}</span>
                        </div>
                        <div className="mt-5 grid h-12 w-12 place-items-center rounded-[10px] border border-[#bfdbfe] bg-white text-[#176bff]">
                          {iconType === "phone" ? (
                            <HeroIcon type="phone" className="h-6 w-6" />
                          ) : iconType === "clipboard" ? (
                            <HeroIcon type="clipboard" className="h-6 w-6" />
                          ) : (
                            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                              <path d="M4 13a8 8 0 0 1 16 0" strokeLinecap="round" />
                              <path d="M4 13v4a2 2 0 0 0 2 2h2v-6H6a2 2 0 0 0-2 2Zm16 0v4a2 2 0 0 1-2 2h-2v-6h2a2 2 0 0 1 2 2Z" strokeLinecap="round" strokeLinejoin="round" />
                              <path d="M14 20h-2" strokeLinecap="round" />
                            </svg>
                          )}
                        </div>
                        <h3 className="mt-4 text-[1.12rem] font-black leading-tight tracking-[-0.025em] text-[#07142a]">{shortTitles[index]}</h3>
                        <p className="mt-2 text-[0.92rem] font-medium leading-6 text-[#475569]">{step}</p>
                      </article>
                    );
                  })}
                </div>

                <div className="grid gap-4 rounded-[12px] border border-[#d8e7fb] bg-white p-4 sm:grid-cols-[1fr_auto_auto] sm:items-center">
                  <div>
                    <p className="text-[0.76rem] font-black uppercase tracking-[0.16em] text-[#2563eb]">Next action</p>
                    <p className="mt-1 text-[1.1rem] font-black leading-tight text-[#07142a]">Try the setup flow, then hear the agent before forwarding calls.</p>
                  </div>
                  <button
                    type="button"
                    onClick={goToSignup}
                    className="inline-flex min-h-[52px] items-center justify-center gap-3 rounded-[10px] border border-[#77d8ff]/90 bg-[linear-gradient(180deg,#2db4ff,#176bff)] px-5 text-[0.9rem] font-black uppercase tracking-[0.12em] text-white shadow-[0_18px_40px_-24px_rgba(23,107,255,0.9),inset_0_1px_0_rgba(255,255,255,0.36)] transition hover:-translate-y-0.5"
                  >
                    Start Free Trial
                    <svg viewBox="0 0 28 20" className="h-4 w-7" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
                      <path d="M2 10h22M17 3l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={playDemo}
                    className="inline-flex min-h-[52px] items-center justify-center gap-3 rounded-[10px] border border-[#9cc7ef] bg-[#f8fbff] px-5 text-[0.9rem] font-black uppercase tracking-[0.12em] text-[#0f2b4f] transition hover:-translate-y-0.5 hover:border-[#ff9955]"
                  >
                    Hear Voice
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="customer-proof" className="scroll-mt-[96px] bg-[linear-gradient(180deg,#ffffff_0%,#f4faff_100%)]">
        <div className="mx-auto w-full max-w-[1320px] px-4 py-14 sm:px-6 lg:px-8 lg:py-20">
          <div className="grid gap-8 lg:grid-cols-[0.78fr_1.22fr] lg:items-start">
            <div className="lg:sticky lg:top-24">
              <p className="inline-flex rounded-full border border-[#b9d8ff] bg-white px-5 py-2 text-[0.84rem] font-black uppercase tracking-[0.18em] text-[#2563eb] shadow-[0_16px_44px_-34px_rgba(37,99,235,0.65)]">Customer proof</p>
              <h2 className="mt-5 text-[clamp(2.25rem,4.4vw,3.9rem)] font-black leading-[1.04] tracking-[-0.052em] text-[#07142a]">What business owners say after calls stop slipping through.</h2>
              <p className="mt-5 max-w-[560px] text-[1.08rem] font-medium leading-8 text-[#334155]">
                These notes focus on the real workflow: fewer voicemail chases, cleaner lead details, and faster response without stopping the job.
              </p>
              <div className="mt-6 grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
                {[
                  ["4", "owner stories"],
                  ["Ontario", "first market"],
                  ["Proof", "before hype"],
                ].map(([value, label]) => (
                  <div key={label} className="rounded-[10px] border border-[#d8e7fb] bg-white px-4 py-3 shadow-[0_16px_38px_-34px_rgba(15,23,42,0.25)]">
                    <p className="text-[1.35rem] font-black leading-none text-[#176bff]">{value}</p>
                    <p className="mt-1 text-[0.78rem] font-black uppercase tracking-[0.12em] text-[#64748b]">{label}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-4">
              <article className="rounded-[14px] border border-[#d8e7fb] bg-[#07142a] p-5 text-white shadow-[0_30px_84px_-58px_rgba(15,23,42,0.58)] sm:p-7">
                <p className="text-[0.78rem] font-black uppercase tracking-[0.16em] text-[#8bdcff]">Featured field note</p>
                <p className="mt-5 text-[clamp(1.45rem,2.5vw,2.15rem)] font-black leading-[1.18] tracking-[-0.035em]">"{testimonialCards[0].quote}"</p>
                <div className="mt-6 flex flex-col gap-2 border-t border-white/14 pt-5 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-[1rem] font-black uppercase tracking-[0.12em]">{testimonialCards[0].name}</p>
                    <p className="mt-1 text-[0.98rem] font-semibold text-[#dbeafe]">{testimonialCards[0].role}</p>
                  </div>
                  <span className="inline-flex w-fit items-center gap-2 rounded-full bg-[#063c24] px-4 py-2 text-[0.76rem] font-black uppercase tracking-[0.1em] text-[#a7f3d0]">
                    <span className="h-2.5 w-2.5 rounded-full bg-[#00b84a]" />
                    lead details by text
                  </span>
                </div>
              </article>

              <div className="grid gap-4 md:grid-cols-3">
                {testimonialCards.slice(1).map((item) => (
                  <article key={item.name} className="rounded-[12px] border border-[#d8e7fb] bg-white p-5 shadow-[0_18px_46px_-38px_rgba(15,23,42,0.28)]">
                    <p className="text-[1rem] font-semibold leading-7 text-[#334155]">"{item.quote}"</p>
                    <div className="mt-5 border-t border-[#e2e8f0] pt-4">
                      <p className="text-[0.9rem] font-black uppercase tracking-[0.12em] text-[#07142a]">{item.name}</p>
                      <p className="mt-1 text-[0.86rem] font-semibold leading-5 text-[#64748b]">{item.role}</p>
                    </div>
                  </article>
                ))}
              </div>

              <div className="grid gap-4 rounded-[14px] border border-[#b9e8d4] bg-[#f4fffa] p-4 md:grid-cols-3">
                {[
                  ["Ontario-first", "Founded in Ontario and built around local service-business expectations."],
                  ["Canada-ready privacy", "Aligned with Canadian privacy expectations around consent, safeguards, and limited use."],
                  ["Concrete demos", "Live calls, demo audio, transcripts, and text follow-up examples keep the claims grounded."],
                ].map(([title, body]) => (
                  <div key={title} className="rounded-[10px] bg-white px-4 py-4">
                    <p className="text-[0.92rem] font-black uppercase tracking-[0.12em] text-[#15803d]">{title}</p>
                    <p className="mt-2 text-[0.9rem] font-medium leading-6 text-[#334155]">{body}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="faq" ref={faqRef} className="scroll-mt-[96px] bg-[linear-gradient(180deg,#f4faff_0%,#eaf6ff_100%)]">
        <div className="mx-auto grid w-full max-w-[1180px] gap-7 px-4 py-14 sm:px-6 lg:grid-cols-[0.74fr_1.26fr] lg:px-8 lg:py-20">
          <div>
            <p className="inline-flex rounded-full border border-[#b9d8ff] bg-white px-5 py-2 text-[0.84rem] font-black uppercase tracking-[0.18em] text-[#2563eb] shadow-[0_16px_44px_-34px_rgba(37,99,235,0.65)]">Before you start</p>
            <h2 className="mt-5 text-[clamp(2.2rem,4vw,3.5rem)] font-black leading-[1.05] tracking-[-0.052em] text-[#07142a]">Quick answers before you try it.</h2>
            <p className="mt-5 max-w-[520px] text-[1.05rem] font-medium leading-8 text-[#334155]">
              The common setup, privacy, and control questions are grouped into a simple decision panel.
            </p>
            <div className="mt-6 rounded-[12px] border border-[#d8e7fb] bg-white p-4">
              <p className="text-[0.78rem] font-black uppercase tracking-[0.16em] text-[#2563eb]">Best first move</p>
              <p className="mt-2 text-[1.05rem] font-black leading-6 text-[#07142a]">Start the free trial, test the voice, and forward calls only when it feels right.</p>
            </div>
          </div>

          <div className="grid gap-3">
            {faqs.map((item, index) => {
              const isOpen = openFaq === index;
              return (
                <div key={item.q} className="overflow-hidden rounded-[12px] border border-[#d7e7fb] bg-white shadow-[0_18px_44px_-38px_rgba(15,23,42,0.22)]">
                  <button
                    type="button"
                    onClick={() => setOpenFaq(isOpen ? -1 : index)}
                    className="grid w-full grid-cols-[40px_1fr_auto] items-center gap-4 px-4 py-4 text-left sm:px-5"
                  >
                    <span className="grid h-10 w-10 place-items-center rounded-full bg-[#eef6ff] text-[0.8rem] font-black text-[#176bff]">{String(index + 1).padStart(2, "0")}</span>
                    <span className="text-[1.08rem] font-black leading-7 text-[#07142a]">{item.q}</span>
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#eaf3ff] text-[1.6rem] font-black leading-none text-[#2563eb]">{isOpen ? "-" : "+"}</span>
                  </button>
                  {isOpen ? (
                    <div className="border-t border-[#d7e7fb] bg-[#f8fbff] px-5 py-4 sm:pl-[76px]">
                      <p className="text-[1.04rem] font-medium leading-8 text-[#334155]">{item.a}</p>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section id="trust" className="scroll-mt-[96px] bg-[#eaf6ff]">
        <div className="mx-auto w-full max-w-[1180px] px-4 pb-14 sm:px-6 lg:px-8">
          <div className="grid overflow-hidden rounded-[16px] border border-[#d7e7fb] bg-white shadow-[0_28px_82px_-58px_rgba(18,32,51,0.34)] lg:grid-cols-[0.78fr_1.22fr]">
            <div className="bg-[#07142a] p-6 text-white sm:p-8">
              <p className="text-[0.84rem] font-black uppercase tracking-[0.18em] text-[#8bdcff]">Trust and transparency</p>
              <h2 className="mt-4 text-[clamp(2rem,3vw,3.05rem)] font-black leading-[1.06] tracking-[-0.045em]">Clear rules for calls, texts, and customer details.</h2>
              <div className="mt-6 flex flex-wrap gap-3">
                <a href="#/privacy" className="rounded-[10px] border border-white/18 bg-white/10 px-4 py-3 text-sm font-black uppercase tracking-[0.12em] text-white transition hover:-translate-y-0.5">
                  Privacy Policy
                </a>
                <a href="#/terms" className="rounded-[10px] border border-white/18 bg-white/10 px-4 py-3 text-sm font-black uppercase tracking-[0.12em] text-white transition hover:-translate-y-0.5">
                  Terms
                </a>
              </div>
            </div>

            <div className="grid gap-0 divide-y divide-[#e2e8f0]">
              {trustCards.map((item, index) => (
                <article key={item.title} className="grid gap-4 px-5 py-5 sm:grid-cols-[56px_1fr] sm:px-6">
                  <span className="grid h-12 w-12 place-items-center rounded-full bg-[#e8f9ef] text-[#15803d]">
                    <HeroIcon type={index === 0 ? "chat" : index === 1 ? "lock" : "check"} className="h-6 w-6" />
                  </span>
                  <div>
                    <h3 className="text-[1.18rem] font-black leading-tight tracking-[-0.02em] text-[#07142a]">{item.title}</h3>
                    <p className="mt-2 text-[1rem] font-medium leading-7 text-[#334155]">{item.body}</p>
                  </div>
                </article>
              ))}
              <div className="bg-[#f8fbff] px-5 py-4 sm:px-6">
                <p className="text-[0.92rem] font-semibold leading-7 text-[#475569]">
                  External verification badges, Google ownership tokens, SMS sender registration, and payment-provider trust marks should only be added after those accounts issue real approvals or tokens.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="final-cta" className="scroll-mt-[96px] bg-[linear-gradient(180deg,#eaf6ff_0%,#ffffff_100%)]">
        <div className="mx-auto w-full max-w-[1180px] px-4 pb-16 sm:px-6 lg:px-8 lg:pb-20">
          <div className="grid overflow-hidden rounded-[18px] border border-[#18365d]/16 bg-[#07142a] shadow-[0_34px_100px_-60px_rgba(18,32,51,0.64)] lg:grid-cols-[1.1fr_0.9fr]">
            <div className="p-6 text-white sm:p-8 lg:p-10">
              <p className="inline-flex rounded-full border border-white/16 bg-white/10 px-5 py-2 text-[0.84rem] font-black uppercase tracking-[0.18em] text-[#a9e8ff]">Ready when you are</p>
              <h2 className="mt-5 text-[clamp(2.25rem,4vw,3.85rem)] font-black leading-[1.06] tracking-[-0.05em]">Stop letting missed calls decide where the next job goes.</h2>
              <p className="mt-5 max-w-[720px] text-[1.12rem] font-medium leading-8 text-[#dbeafe]">
                Try My AI PA free, hear how it sounds, and see how quickly missed calls can turn into clean follow-up opportunities.
              </p>
              <div className="mt-8 flex flex-col gap-4 sm:flex-row">
                <PrimaryButton onClick={goToSignup} className="text-lg">Start Free Trial</PrimaryButton>
                <SecondaryButton onClick={playDemo} dark className="text-lg">
                  Hear Agent&apos;s Voice
                </SecondaryButton>
              </div>
            </div>

            <div className="grid content-between gap-4 border-t border-white/12 bg-white/[0.06] p-6 text-white lg:border-l lg:border-t-0 sm:p-8">
              <div className="rounded-[12px] border border-white/12 bg-white/10 p-5">
                <p className="text-[0.78rem] font-black uppercase tracking-[0.16em] text-[#a9e8ff]">What happens next</p>
                <div className="mt-4 space-y-3">
                  {["Build your greeting", "Test a call", "Forward when ready"].map((item, index) => (
                    <div key={item} className="flex items-center gap-3">
                      <span className="grid h-8 w-8 place-items-center rounded-full bg-[#176bff] text-sm font-black">{index + 1}</span>
                      <p className="font-black">{item}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-[12px] border border-white/12 bg-white/10 p-5">
                <p className="text-[0.78rem] font-black uppercase tracking-[0.16em] text-[#ffbd74]">Live demo line</p>
                <a href="tel:+12495033301" className="mt-2 block text-[1.75rem] font-black tracking-[-0.03em] text-white">(249) 503-3301</a>
              </div>
            </div>
          </div>

          <footer className="flex flex-col gap-4 px-1 pt-7 text-[1.05rem] font-semibold leading-7 text-[#334155] sm:flex-row sm:items-center sm:justify-between">
            <p>My AI PA is positioned for Ontario first. Made and Loved in Canada.</p>
            <div className="flex flex-wrap items-center gap-4">
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
