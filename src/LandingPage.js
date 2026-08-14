import React, { useEffect, useRef, useState } from "react";
import { tradePageOrder, tradePages } from "./tradePageData";
import { propertyManagementAudience } from "./firstClassRentalsData";
import { TimsElectricalLiveDemo } from "./TimsElectricalDemo";
import heroTranscriptTimings from "./timsElectricalHeroTranscriptTimings.json";

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
    ...heroTranscriptTimings.turns[0],
    time: "6:42 PM",
    speaker: "My AI PA",
    role: "assistant",
    initials: "AI",
    text: "Hello are you looking for a new installation, repair or maintenance today?",
  },
  {
    ...heroTranscriptTimings.turns[1],
    time: "6:42 PM",
    speaker: "Caller",
    role: "caller",
    initials: "BR",
    text: "I need someone to wire up my hot tub as a new installation.",
  },
  {
    ...heroTranscriptTimings.turns[2],
    time: "6:43 PM",
    speaker: "My AI PA",
    role: "assistant",
    initials: "AI",
    text: "Can I get your first name?",
  },
  {
    ...heroTranscriptTimings.turns[3],
    time: "6:43 PM",
    speaker: "Caller",
    role: "caller",
    initials: "BR",
    text: "Brian Smith.",
  },
  {
    ...heroTranscriptTimings.turns[4],
    time: "6:43 PM",
    speaker: "My AI PA",
    role: "assistant",
    initials: "AI",
    text: "What's the address where the work needs to be completed?",
  },
  {
    ...heroTranscriptTimings.turns[5],
    time: "6:44 PM",
    speaker: "Caller",
    role: "caller",
    initials: "BR",
    text: "23 Robb Street in Hamilton.",
  },
  {
    ...heroTranscriptTimings.turns[6],
    time: "6:44 PM",
    speaker: "My AI PA",
    role: "assistant",
    initials: "AI",
    text: "What is the best phone number to reach you at?",
  },
  {
    ...heroTranscriptTimings.turns[7],
    time: "6:44 PM",
    speaker: "Caller",
    role: "caller",
    initials: "BR",
    text: "Nine oh five, five five five, one two three four.",
  },
  {
    ...heroTranscriptTimings.turns[8],
    time: "6:44 PM",
    speaker: "My AI PA",
    role: "assistant",
    initials: "AI",
    text: "Repeating that back, nine oh five, five five five, one two three four. Is that correct?",
  },
  {
    ...heroTranscriptTimings.turns[9],
    time: "6:45 PM",
    speaker: "Caller",
    role: "caller",
    initials: "BR",
    text: "Yes.",
  },
  {
    ...heroTranscriptTimings.turns[10],
    time: "6:45 PM",
    speaker: "My AI PA",
    role: "assistant",
    initials: "AI",
    text: "What's the best time to reach you in case we miss you on the callback?",
  },
  {
    ...heroTranscriptTimings.turns[11],
    time: "6:45 PM",
    speaker: "Caller",
    role: "caller",
    initials: "BR",
    text: "After five PM is best.",
  },
  {
    ...heroTranscriptTimings.turns[12],
    time: "6:45 PM",
    speaker: "My AI PA",
    role: "assistant",
    initials: "AI",
    text: "To confirm, that's 23 Robb Street in Hamilton for hot tub wiring, and after five PM is your best callback time. I have the details ready for the team. Thanks for calling.",
  },
];

const demoCallAudioSrc = `${process.env.PUBLIC_URL || ""}${heroTranscriptTimings.src}?v=20260814-receptionist-first`;

export function getTypedHeroCallTurns(audioTime) {
  const currentTime = Number(audioTime);
  if (!Number.isFinite(currentTime) || currentTime <= 0) return [];

  return heroCallTranscript.flatMap((turn) => {
    if (currentTime < turn.start) return [];
    const duration = Math.max(0.01, turn.end - turn.start);
    const progress = Math.max(0, Math.min(1, (currentTime - turn.start) / duration));
    const characterCount = progress >= 1
      ? turn.text.length
      : Math.max(1, Math.floor(turn.text.length * progress));
    return [{
      ...turn,
      displayText: turn.text.slice(0, characterCount),
      isTyping: progress < 1,
    }];
  });
}

const problemMoments = [
  {
    body: "A caller has a problem and is looking for solutions.",
    bodyLines: ["A caller has a problem", "and is looking for solutions."],
    art: "problem",
  },
  {
    body: "Your AI assistant talks with the customer and collects the job details you need for a callback.",
    bodyLines: [
      "Your AI assistant",
      "talks with the customer",
      "and collects job details that are",
      "sent by text to your phone",
    ],
    art: "agent",
  },
  {
    body: "The customer gets a clear confirmation and knows what happens next while waiting for your callback.",
    bodyLines: [
      "The customer gets confirmation,",
      "knows what happens next,",
      "and waits for your callback.",
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
    title: "Answer while the work keeps moving.",
    body: "Service calls are answered while you are on a job, driving, or with family.",
  },
  {
    code: "CLIPBOARD",
    eyebrow: "Stay organized",
    accent: "from-blue-400 to-blue-500",
    glow: "shadow-[0_18px_40px_-30px_rgba(96,165,250,0.42)]",
    title: "The quote details get collected.",
    body: "Get the problem, service address, urgency, preferred timing, and callback number.",
  },
  {
    code: "TOOLS",
    eyebrow: "Work-life balance",
    accent: "from-emerald-500 to-emerald-400",
    glow: "shadow-[0_18px_40px_-30px_rgba(52,211,153,0.42)]",
    title: "Handle after-hours and urgent calls.",
    body: "Urgent requests are flagged for a fast callback without diagnosing or promising an arrival time.",
  },
  {
    code: "CHART",
    eyebrow: "Grow your business",
    accent: "from-orange-500 to-orange-400",
    glow: "shadow-[0_18px_40px_-30px_rgba(250,204,21,0.34)]",
    title: "Quote and schedule faster.",
    body: "Know what the customer needs before you return the call.",
  },
];

const transcriptMoments = heroCallTranscript.map((turn) => ({
  start: turn.start,
  end: turn.end,
  speaker: turn.speaker,
  text: turn.text,
}));

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
    minuteNote: "Includes 60 AI call minutes.",
    points: ["24/7 AI answering", "60 AI call minutes included", "Text summaries for both sides"],
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
    name: "Carpentry example",
    role: "Common contractor workflow",
  },
  {
    quote: "Evening rental service calls used to sit until morning. Now callers get an immediate response and our team wakes up to job details ready for follow-up instead of a pile of missed calls.",
    name: "Property management example",
    role: "After-hours service-call workflow",
  },
  {
    quote: "Roof repair calls used to interrupt me while I was on ladders or meeting homeowners. Now the caller gets helped and I get the job details by text.",
    name: "Roofing example",
    role: "On-site service workflow",
  },
  {
    quote: "Service calls come in while we are driving between plumbing jobs. My AI PA talks with the customer, answers basic questions, and sends us the job details.",
    name: "Plumbing example",
    role: "In-transit service workflow",
  },
];

const faqs = [
  { q: "Will callers know they are speaking with an AI assistant?", a: "Yes. The goal is to sound clear, professional, and helpful while answering questions and collecting the right job details." },
  { q: "Do I have to change my business number?", a: "No. Keep your current number and forward calls to your My AI PA number." },
  { q: "What if someone calls after hours?", a: "Your AI assistant can answer after hours, collect the job details, and flag an urgent request for a fast callback. It does not diagnose the problem or promise an arrival time." },
  { q: "Can I control what it says?", a: "Yes. You provide the greeting and answers about your hours, service area, estimates, emergency availability, warranties, and other common questions. You also choose the callback wording and timeframe callers hear." },
  { q: "What job details does it collect?", a: "It can collect the customer's problem, service address, urgency, preferred timing, and best callback number so you can quote and schedule faster." },
  { q: "How hard is setup?", a: "Easy to set-up. Scroll below for details" },
];

const forwardingProviderDetails = {
  BELL: {
    title: "BELL MOBILITY",
    subtitle: "FORWARD CALLS YOU DON'T ANSWER",
    steps: [
      "Open Call Settings.",
      "Select Call Forwarding.",
      "Choose calls you don't answer.",
      "Enter your My AI PA number and activate.",
    ],
    offText: "Turn off in Call Settings.",
    sourceText: "Based on Bell Support instructions",
  },
  ROGERS: {
    title: "ROGERS MOBILE",
    subtitle: "FORWARD CALLS YOU DON'T ANSWER",
    code: "*61*2895550148#",
    steps: ["Open the Phone app.", "Dial the ready-to-use code.", "Tap Call/Send.", "Wait for the confirmation message."],
    offText: "Turn off anytime: dial ##61#",
    sourceText: "Based on Rogers Support instructions",
  },
  TELUS: {
    title: "TELUS MOBILE",
    subtitle: "FORWARD CALLS YOU DON'T ANSWER",
    code: "*61*2895550148#",
    steps: ["Open the Phone app.", "Dial the ready-to-use code.", "Tap Call/Send.", "Wait for the confirmation message."],
    offText: "Turn off anytime: dial #61#",
    sourceText: "Based on TELUS Support instructions",
  },
  OTHER: {
    title: "OTHER PROVIDER",
    subtitle: "WE'LL HELP YOU FIND THE RIGHT METHOD",
    steps: [
      "Contact your phone provider.",
      "Ask for unanswered-call forwarding.",
      "Give them your My AI PA number.",
      "Let a test call ring unanswered.",
    ],
    offText: "Your provider can also help you turn it off.",
    sourceText: "Provider instructions can vary",
  },
};

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
  if (type === "headset") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.1" aria-hidden="true">
        <path d="M4 13v-1a8 8 0 0 1 16 0v5" strokeLinecap="round" />
        <rect x="3" y="12" width="4" height="7" rx="2" />
        <rect x="17" y="12" width="4" height="7" rx="2" />
        <path d="M17 19c0 1.1-.9 2-2 2h-3" strokeLinecap="round" />
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
  if (type === "faq") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.1" aria-hidden="true">
        <path d="M4.5 15.2 3.5 19l3.9-1.2A7.5 7.5 0 1 0 4.5 15.2Z" strokeLinejoin="round" />
        <path d="M9.2 9.2a2.8 2.8 0 0 1 5.3 1.2c0 1.9-2.5 2-2.5 3.5" strokeLinecap="round" />
        <path d="M12 16.6h.01" strokeLinecap="round" />
      </svg>
    );
  }
  if (type === "sms") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.1" aria-hidden="true">
        <path d="M4 5.5h16v11H9l-5 3v-14Z" strokeLinejoin="round" />
        <path d="M8 9h8M8 12.5h5" strokeLinecap="round" />
        <path d="m15.5 16.5 1.7 1.7 3.3-3.5" strokeLinecap="round" strokeLinejoin="round" />
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
  if (type === "outlet") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.1" aria-hidden="true">
        <rect x="6" y="3" width="12" height="18" rx="5" />
        <path d="M10 8.4v3M14 8.4v3M10 16h4" strokeLinecap="round" />
      </svg>
    );
  }
  if (type === "electricVan") {
    return (
      <svg viewBox="6 20 50 29" className={className} aria-hidden="true">
        <path fill="#f8fbff" d="M8 31.5c0-4.2 3.4-7.5 7.5-7.5H38c2.7 0 5.2 1.3 6.7 3.5L53 40H8v-8.5Z" />
        <path fill="#d7ecff" d="M40.5 27.5c1.2 0 2.3.6 3 1.6l4.3 6.3H39V27.5h1.5Z" />
        <rect x="15" y="27" width="17" height="8.5" rx="2.2" fill="#0b4d94" opacity="0.9" />
        <path fill="#ff9b16" d="M35.5 24.5 29.5 35h4.6l-1.4 8.5 8.7-12h-4.8l3.1-7h-4.2Z" />
        <path fill="#0b3b7a" d="M13 38h22v4H13z" opacity="0.18" />
        <text x="17.2" y="38" fill="#0b3b7a" fontFamily="Arial, sans-serif" fontSize="8.4" fontWeight="900">TE</text>
        <circle cx="18" cy="42.5" r="5.2" fill="#07142a" />
        <circle cx="18" cy="42.5" r="2.3" fill="#9edaff" />
        <circle cx="45" cy="42.5" r="5.2" fill="#07142a" />
        <circle cx="45" cy="42.5" r="2.3" fill="#9edaff" />
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
          <p className="mt-1 text-[1.2rem] font-black tracking-[-0.03em] text-white">Sample Call</p>
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
              Thanks for calling Tim&apos;s Electrical. We received your request. The team will follow up to discuss the details and next steps. Have a great day!
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

export function HeroCallDashboard({
  ownerCardRef,
  onRevealDemo,
  onToggleAudio,
  audioPlaying,
  audioTime,
  audioDuration,
  demoRevealed = false,
}) {
  const visibleTranscriptTurns = getTypedHeroCallTurns(audioTime);

  return (
    <div className="landing-call-dashboard landing-call-dashboard-redesign relative mx-auto w-full max-w-[690px]">
      <div className="landing-call-dashboard-surface relative overflow-hidden rounded-[32px] border border-[#1d2a3c] bg-[#050913] text-white shadow-[0_22px_60px_-42px_rgba(0,0,0,0.76),inset_0_1px_0_rgba(255,255,255,0.045)]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_34%,rgba(36,99,235,0.17),transparent_28%),radial-gradient(circle_at_74%_82%,rgba(37,99,235,0.19),transparent_30%),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:auto,auto,1px_100%]" />

        {!demoRevealed ? (
          <section
            className="landing-call-preview-cover absolute inset-0 z-30 flex flex-col overflow-hidden bg-[radial-gradient(circle_at_18%_22%,rgba(18,122,209,0.3),transparent_31%),linear-gradient(145deg,#123455_0%,#0b233f_56%,#07182d_100%)] px-8 py-7 text-white"
            aria-label="Tim's Electrical sample call preview"
          >
            <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full border border-[#39cfff]/15 bg-[#39cfff]/5 blur-[1px]" />
            <header className="relative flex items-center justify-between gap-4 text-[0.92rem] font-black">
              <span className="inline-flex items-center gap-2.5 text-white/90">
                <span className="h-3 w-3 rounded-full bg-[#18d17b] shadow-[0_0_14px_rgba(24,209,123,0.7)]" />
                Sample call preview
              </span>
              <span className="rounded-full border border-white/12 bg-white/7 px-3 py-1.5 text-[0.75rem] tracking-[0.08em] text-white/72">{formatClock(audioDuration)}</span>
            </header>

            <div className="relative mt-7 flex items-center gap-5">
              <div className="landing-call-preview-avatar grid h-28 w-28 shrink-0 place-items-center overflow-hidden rounded-full border-4 border-[#39cfff] bg-[#052a4a] shadow-[0_0_0_8px_rgba(57,207,255,0.1),0_20px_42px_-20px_rgba(57,207,255,0.75)]">
                <img
                  src={`${process.env.PUBLIC_URL || ""}/call-secretary-avatar-ai.png`}
                  alt="My AI PA virtual receptionist wearing a headset"
                  className="h-full w-full scale-[1.5] object-cover object-center"
                />
              </div>
              <div className="min-w-0">
                <p className="text-[0.68rem] font-black uppercase tracking-[0.16em] text-[#70d8ff]">What a caller hears</p>
                <h3 className="mt-1 text-[2rem] font-black tracking-[-0.04em]">My AI PA Agent</h3>
                <p className="mt-1 text-[1rem] font-bold text-[#b7cee6]">Answering for <strong className="text-white">your business</strong></p>
                <div className="landing-call-preview-wave mt-4 flex h-7 items-center gap-1" aria-hidden="true">
                  {[12, 20, 28, 18, 30, 22, 15, 24, 13].map((height, index) => (
                    <i key={`${height}-${index}`} className="w-1 rounded-full bg-[#39cfff]" style={{ height }} />
                  ))}
                </div>
              </div>
            </div>

            <div className="relative mt-7 grid gap-3">
              <article className="rounded-[18px] border border-white/10 bg-white/10 px-5 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.07)]">
                <strong className="block text-[0.66rem] font-black uppercase tracking-[0.12em] text-[#70d8ff]">My AI PA</strong>
                <p className="mt-1.5 text-[1.05rem] font-black leading-[1.3]">“Hello are you looking for a new installation, repair or maintenance today?”</p>
              </article>
              <article className="ml-4 rounded-[18px] border border-[#3ba5ff]/35 bg-[#1188f5] px-5 py-4 shadow-[0_16px_32px_-22px_rgba(17,136,245,0.9)]">
                <strong className="block text-[0.66rem] font-black uppercase tracking-[0.12em] text-white/80">Caller</strong>
                <p className="mt-1.5 text-[1.05rem] font-black leading-[1.3]">“I&apos;m putting in a hot tub and need it wired.”</p>
              </article>
            </div>

            <div className="relative mt-auto flex items-end justify-between gap-5 border-t border-white/10 pt-5">
              <div>
                <strong className="block text-[0.9rem] font-black">Interested in what happens next?</strong>
                <span className="mt-1 block text-[0.72rem] font-bold text-white/58">The recording starts only when you press the button.</span>
              </div>
              <button
                type="button"
                onClick={onRevealDemo}
                className="landing-call-preview-cta inline-flex shrink-0 items-center gap-2.5 rounded-full bg-[#ff6a00] px-5 py-3 text-[0.82rem] font-black text-white shadow-[0_16px_32px_-18px_rgba(255,106,0,0.92)] transition hover:-translate-y-0.5 hover:bg-[#ff7c22] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#72dfff]"
              >
                <span className="grid h-7 w-7 place-items-center rounded-full bg-white text-[#0b6edc]" aria-hidden="true">▶</span>
                See &amp; hear the full call
              </button>
            </div>
          </section>
        ) : null}

        <div
          className={`landing-call-dashboard-layout relative grid h-full ${demoRevealed ? "" : "pointer-events-none select-none"}`}
          style={{ gridTemplateColumns: "minmax(0, 1fr)", gridTemplateRows: "minmax(0, 1fr) auto" }}
          aria-hidden={!demoRevealed}
        >
          <div
            className="landing-call-dashboard-main grid min-h-0"
            style={{ gridTemplateColumns: "minmax(12.5rem, 0.58fr) minmax(0, 1.42fr)" }}
          >
          <section className="landing-call-panel landing-call-panel-redesign relative flex min-h-0 flex-col border-r border-[#1b2638] px-7 py-6 2xl:px-8">
            <div className="landing-call-status flex items-center justify-between text-[1.04rem] font-black">
              <span className="inline-flex items-center gap-3">
                <span className="landing-call-live-dot h-3.5 w-3.5 rounded-full bg-[#00d66f] shadow-[0_0_14px_rgba(0,214,111,0.68)]" />
                Sample Call
              </span>
              <span>{formatClock(audioDuration)}</span>
            </div>

            <div className="landing-caller-card landing-caller-card-redesign mt-8">
              <div className="landing-caller-avatar grid h-24 w-24 place-items-center overflow-hidden rounded-full bg-[radial-gradient(circle_at_30%_24%,#ffe27a,#ff8a13_48%,#7a3b00_78%)] text-white shadow-[0_20px_50px_-30px_rgba(255,138,19,1)] ring-2 ring-white/15">
                <img
                  src={`${process.env.PUBLIC_URL || ""}/call-secretary-avatar-ai.png`}
                  alt="AI call secretary wearing a futuristic headset"
                  className="h-full w-full scale-[1.58] object-cover object-center"
                />
              </div>
              <h3 className="landing-caller-name mt-5 text-[2rem] font-black leading-none tracking-[-0.045em]">Tim&apos;s Electrical AI</h3>
              <p className="landing-caller-phone mt-3 text-[1.42rem] font-bold tracking-[-0.035em] text-white/82">905-555-2345</p>
              <span className="landing-caller-tag mt-4 inline-flex max-w-[13.5rem] rounded-full bg-white/10 px-5 py-2.5 text-center text-[1rem] font-black leading-[1.12] text-white/92 shadow-[inset_0_1px_0_rgba(255,255,255,0.07)]">
                AI assistant picked up after 3 rings.
              </span>
            </div>

            <div className="landing-call-capture-list mt-5 grid gap-2.5" aria-label="Call results">
              {[
                ["Answered", "Professional greeting after three rings"],
                ["Captured", "Job, address and callback preference"],
                ["Prepared", "Clear follow-up for both sides"],
              ].map(([label, detail]) => (
                <div className="landing-call-capture-row flex items-start gap-2.5" key={label}>
                  <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#0fbf72] text-[0.66rem] font-black text-[#03271a]">✓</span>
                  <span>
                    <strong className="block text-[0.68rem] font-black uppercase tracking-[0.08em] text-[#8decc4]">{label}</strong>
                    <small className="mt-0.5 block text-[0.63rem] font-bold leading-[1.18] text-white/62">{detail}</small>
                  </span>
                </div>
              ))}
            </div>

            <div className="landing-call-controls landing-call-controls-redesign mt-auto">
              <HeroWave />
              <div className="mt-4 flex items-center justify-between">
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

          <section className="landing-conversation-column landing-conversation-column-redesign relative flex min-h-0 flex-col px-8 py-7 2xl:px-9">
            <div className="landing-conversation-header flex items-center justify-between">
              <div>
                <p className="text-[0.66rem] font-black uppercase tracking-[0.14em] text-[#72c8ff]">Recorded call transcript</p>
                <h3 className="landing-conversation-title mt-1 text-[1.38rem] font-black tracking-[-0.025em] 2xl:text-[1.55rem]">A real conversation—not a text thread</h3>
              </div>
              <button
                type="button"
                onClick={onToggleAudio}
                className="landing-call-audio-button inline-flex shrink-0 items-center gap-2 rounded-full border border-[#72c8ff]/55 bg-[#0b376d] px-3 py-2 text-[0.72rem] font-black text-white shadow-[0_12px_26px_-18px_rgba(57,207,255,0.85)] transition hover:bg-[#124b8d]"
                aria-label={audioPlaying ? "Pause recorded Tim's Electrical demo call" : "Play recorded Tim's Electrical demo call"}
              >
                <span className="grid h-6 w-6 place-items-center rounded-full bg-[#39cfff] text-[#032345]" aria-hidden="true">
                  {audioPlaying ? "Ⅱ" : "▶"}
                </span>
                <span>{audioPlaying ? "Pause call" : "Hear call"}</span>
              </button>
            </div>

            <div className="landing-conversation-panel landing-call-transcript mt-4 rounded-[20px] border border-white/10 bg-[#07111f]/92 px-4 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
              <div className="landing-call-transcript-intro flex items-center justify-between gap-3 border-b border-white/10 pb-2">
                <span className="landing-service-badge shrink-0 whitespace-nowrap rounded-full border border-[#78b7ff]/60 bg-[#082c5a] px-2.5 py-1 text-[0.62rem] font-black uppercase tracking-[0.06em] text-[#b9dcff]">New installation</span>
                <span className="text-[0.62rem] font-bold text-white/48">Speaker-labelled call transcript</span>
              </div>
              <div
                className="landing-call-transcript-list divide-y divide-white/8"
                aria-label="Call transcript appears as the recording plays"
                aria-live="polite"
                aria-busy={audioPlaying}
              >
                {visibleTranscriptTurns.map((turn) => (
                  <article className={`landing-call-transcript-turn ${turn.role}`} key={`${turn.start}-${turn.speaker}`}>
                    <span className="landing-call-transcript-avatar" aria-hidden="true">{turn.initials}</span>
                    <div className="min-w-0 flex-1">
                      <div className="landing-call-transcript-meta">
                        <strong>{turn.speaker}</strong>
                        <time>{turn.time}</time>
                      </div>
                      <p>
                        {turn.displayText}
                        {turn.isTyping ? <span className="landing-call-transcript-caret" aria-hidden="true" /> : null}
                      </p>
                    </div>
                  </article>
                ))}
              </div>
              <div className="landing-call-audio-progress mt-1.5 flex items-center gap-2 border-t border-white/10 pt-2 text-[0.62rem] font-bold text-white/58">
                <span>{formatClock(audioTime)}</span>
                <span className="h-1 flex-1 overflow-hidden rounded-full bg-white/12"><i className="block h-full rounded-full bg-[#39cfff]" style={{ width: `${Math.max(0, Math.min(100, (audioTime / Math.max(audioDuration, 1)) * 100))}%` }} /></span>
                <span>{formatClock(audioDuration)}</span>
              </div>
            </div>
          </section>
          </div>

          <section className="landing-followup-tray relative border-t border-[#263750] bg-[linear-gradient(180deg,rgba(13,29,51,0.96),rgba(6,16,31,0.98))] px-5 pb-4 pt-3.5">
            <div className="landing-followup-heading flex items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#13c778] text-sm font-black text-[#03271a] shadow-[0_0_22px_-8px_rgba(19,199,120,0.95)]">✓</span>
                <span className="min-w-0">
                  <strong className="block text-[0.78rem] font-black uppercase tracking-[0.12em] text-[#8decc4]">Instant follow-up</strong>
                  <span className="mt-0.5 block text-[0.68rem] font-bold text-white/62">One organized lead summary for you. One clear confirmation for your caller.</span>
                </span>
              </div>
              <span className="shrink-0 rounded-full border border-[#38d78d]/35 bg-[#0b4b35] px-3 py-1.5 text-[0.58rem] font-black uppercase tracking-[0.12em] text-[#b5f8d8]">Call complete</span>
            </div>

            <div className="landing-followup-grid mt-3 grid grid-cols-2 gap-3">
              <article ref={ownerCardRef} className="landing-call-owner-card landing-followup-card landing-followup-owner overflow-hidden rounded-[16px] border border-[#9bc8ff] bg-white text-[#10233f] shadow-[0_14px_38px_-28px_rgba(51,145,255,0.9)]">
                <header className="flex items-center justify-between gap-3 border-b border-[#dceafd] bg-[#edf6ff] px-3 py-2">
                  <span className="flex items-center gap-2">
                    <span className="grid h-7 w-7 place-items-center rounded-full bg-[#0b6edc] text-[0.58rem] font-black text-white">PA</span>
                    <span>
                      <strong className="block text-[0.7rem] font-black leading-none">Owner lead summary</strong>
                      <small className="mt-1 block text-[0.5rem] font-bold text-[#637a94]">My AI PA · now</small>
                    </span>
                  </span>
                  <span className="rounded-full bg-[#d8ebff] px-2 py-1 text-[0.5rem] font-black uppercase tracking-[0.08em] text-[#0754ad]">New lead</span>
                </header>
                <div className="landing-followup-owner-body grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 px-3 py-2.5 text-[0.62rem] leading-[1.18]">
                  <span className="font-black text-[#67809a]">Caller</span><strong>Brian Smith · 905-555-1234</strong>
                  <span className="font-black text-[#67809a]">Job</span><strong>Hot tub wiring · New installation</strong>
                  <span className="font-black text-[#67809a]">Address</span><strong>23 Robb St., Hamilton</strong>
                  <span className="font-black text-[#67809a]">Callback</span><strong>Next week · After 5 PM</strong>
                </div>
              </article>

              <article className="landing-customer-text-card landing-followup-card landing-followup-customer overflow-hidden rounded-[16px] border border-[#b9dfc9] bg-white text-[#10233f] shadow-[0_14px_38px_-28px_rgba(22,163,74,0.72)]">
                <header className="flex items-center justify-between gap-3 border-b border-[#dceee2] bg-[#f0fbf4] px-3 py-2">
                  <span className="flex items-center gap-2">
                    <span className="grid h-7 w-7 place-items-center rounded-full bg-[#16a34a] text-[0.58rem] font-black text-white">TE</span>
                    <span>
                      <strong className="block text-[0.7rem] font-black leading-none">Caller confirmation</strong>
                      <small className="mt-1 block text-[0.5rem] font-bold text-[#637a94]">Tim&apos;s Electrical · now</small>
                    </span>
                  </span>
                  <span className="rounded-full bg-[#dcfce7] px-2 py-1 text-[0.5rem] font-black uppercase tracking-[0.08em] text-[#13743a]">Delivered</span>
                </header>
                <div className="landing-followup-customer-body px-3 py-2.5 text-[0.62rem] font-bold leading-[1.28] text-[#1b344f]">
                  Thanks for calling Tim&apos;s Electrical. We received your hot tub wiring request. The team will follow up to discuss the details and next steps. Have a great day!
                </div>
              </article>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export function HeroLiveCallButton({ audioPlaying = false, onClick, className = "" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`landing-responsive-live-call-button inline-flex min-h-[3rem] items-center justify-center gap-2.5 rounded-full border border-[#4a9be0] bg-[#0c4e8e] px-5 text-[0.78rem] font-black text-white shadow-[0_14px_30px_-20px_rgba(12,78,142,0.95)] transition hover:-translate-y-0.5 hover:bg-[#0d5ca8] focus:outline-none focus-visible:ring-4 focus-visible:ring-[#68c8ff]/45 ${className}`}
      aria-label={audioPlaying ? "Pause the recorded Tim's Electrical live-call demonstration" : "Hear the recorded Tim's Electrical live-call demonstration"}
      aria-pressed={audioPlaying}
    >
      <span className="grid h-7 w-7 place-items-center rounded-full bg-[#2bbdf4] text-[0.68rem] text-white" aria-hidden="true">{audioPlaying ? "Ⅱ" : "▶"}</span>
      {audioPlaying ? "Pause Live Call" : "Hear Live Call"}
    </button>
  );
}

const HERO_ACTION_STEPS = Object.freeze([
  { icon: "phone", label: "Answers after 3 rings" },
  { icon: "clipboard", label: "Captures important call details" },
  { icon: "sms", label: "Sends text summary and", finalWord: "follow-up" },
]);

export function HeroActionFlow({ className = "" }) {
  return (
    <section className={`landing-action-flow ${className}`.trim()} aria-label="How My AI PA handles a missed call">
      <div className="landing-action-flow-heading">
        <strong>MY AI PA:</strong>
        <svg viewBox="0 0 38 34" aria-hidden="true">
          <path d="M5 5c10 1 20 7 24 18" />
          <path d="m22 20 8 6 3-10" />
        </svg>
      </div>
      <ol className="landing-action-flow-steps">
        {HERO_ACTION_STEPS.map((step, index) => (
          <React.Fragment key={`${step.label}-${step.finalWord || ""}`}>
            <li className="landing-action-flow-step">
              <span className="landing-action-flow-icon" aria-hidden="true">
                <HeroIcon type={step.icon} className="h-full w-full" />
              </span>
              <span>
                {step.label}
                {step.finalWord ? <> <span className="landing-action-flow-nowrap">{step.finalWord}</span></> : null}
              </span>
            </li>
            {index < HERO_ACTION_STEPS.length - 1 ? (
              <li className="landing-action-flow-arrow" aria-hidden="true">
                <svg viewBox="0 0 58 24">
                  <path d="M3 12h47" />
                  <path d="m42 4 9 8-9 8" />
                </svg>
              </li>
            ) : null}
          </React.Fragment>
        ))}
      </ol>
    </section>
  );
}

function ResponsiveProofHero({ goToSignup, playDemo, onHearLiveCall, audioPlaying }) {
  return (
    <div className="landing-tablet-hero">
      <section className="landing-tablet-copy">
        <p className="landing-tablet-eyebrow">Stop losing jobs to missed calls</p>
        <h1 className="landing-tablet-title landing-stripe-headline">Never miss a call again!</h1>
        <p className="landing-tablet-pain landing-chalk-pain">Missed Calls = Missed Jobs</p>
        <HeroActionFlow className="landing-action-flow-tablet" />
        <p className="landing-tablet-coverage">Keep your existing business number.</p>

        <div className="landing-tablet-trust" aria-label="Trial details">
          {['14-Day Free Trial', 'No Credit Card', 'Cancel Anytime'].map((label) => <span key={label}><b aria-hidden="true">✓</b>{label}</span>)}
        </div>
      </section>

      <div className="landing-tablet-card-wrap">
        <div className="mb-3 flex justify-center sm:justify-end">
          <HeroLiveCallButton audioPlaying={audioPlaying} onClick={onHearLiveCall} />
        </div>
        <MobileHeroCallProof
          className="landing-tablet-call-proof"
          onSampleCall={playDemo}
          onStartTrial={goToSignup}
        />
        <p className="landing-tablet-flip-hint">The card rotates through three sides. Tap left or right to move between them.</p>
      </div>
    </div>
  );
}

const HERO_FACE_DURATION_MS = 7000;
const HERO_PAUSE_HOLD_MS = 14000;
const HERO_DIALOGUE_TIMELINE_MS = Object.freeze({
  callerRequest: 900,
  assistantDetailRequest: 2200,
  callerDetails: 3600,
  countdownThree: 4400,
  countdownTwo: 5200,
  countdownOne: 6000,
  faceAdvance: HERO_FACE_DURATION_MS,
});

function PhoneReadingHand({ side }) {
  return (
    <span className={`landing-reading-hand landing-reading-hand-${side}`} aria-hidden="true">
      <svg viewBox="0 0 132 132" role="presentation">
        <ellipse className="landing-reading-hand-grip-shadow" cx="56" cy="120" rx="42" ry="8" />
        {/* One continuous silhouette keeps the palm, curled fingers and thumb
            physically connected while the hand supports the phone. */}
        <path
          className="landing-reading-hand-shape"
          d="M23 126C13 117 9 104 14 91c3-8 9-14 17-17l-12-2C9 70 5 62 9 55c4-7 13-8 23-3l8 4-15-9c-10-6-12-15-6-21 6-7 15-5 25 2l10 8-11-11c-8-8-7-17 1-21 8-4 15 2 22 11l14 21c8 12 9 24 3 36 6-6 12-11 20-14 10-4 19 0 20 8 1 8-6 14-16 16l-8 1c-10 2-15 10-17 23l-2 15c-13 11-39 14-57 5Z"
        />
        <path className="landing-reading-hand-nails" d="M12 58c5-3 11-2 16 1M21 30c5-2 10 0 14 3M45 8c5 0 9 4 12 8M100 63c7-2 13 1 14 6 0 5-5 8-12 9" />
        <path className="landing-reading-hand-detail" d="M29 78c10 3 17 10 20 20M48 66c9 3 15 10 18 18M42 116c12-7 24-9 36-7" />
      </svg>
    </span>
  );
}

function CoffeePriceEmphasis() {
  return (
    <span className="landing-coffee-mark">
      <span className="landing-coffee-steam" aria-hidden="true">
        <svg viewBox="0 0 76 30" role="presentation">
          <path d="M15 27c-7-7 7-10 0-18" />
          <path d="M38 27c-8-8 8-11 0-22" />
          <path d="M60 27c-7-7 7-10 1-18" />
        </svg>
      </span>
      <span>price of a cup of coffee per day</span>
      <svg className="landing-coffee-underline" viewBox="0 0 260 18" preserveAspectRatio="none" aria-hidden="true">
        <path d="M4 13C70 17 185 16 256 4" />
        <path d="M18 15C88 17 190 14 244 6" />
      </svg>
    </span>
  );
}

export function MobileHeroCallProof({ className = "", onSampleCall, onStartTrial }) {
  const stageRef = useRef(null);
  const swipeStartXRef = useRef(null);
  const swipeHandledRef = useRef(false);
  const pauseTimerRef = useRef(null);
  const [activeFace, setActiveFace] = useState(0);
  const [dialogueStep, setDialogueStep] = useState(1);
  const [textsCountdown, setTextsCountdown] = useState(null);
  const [stageIsVisible, setStageIsVisible] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [showTurnHint, setShowTurnHint] = useState(false);
  const [rotationPaused, setRotationPaused] = useState(false);

  const holdCurrentScreen = () => {
    if (pauseTimerRef.current) window.clearTimeout(pauseTimerRef.current);
    setRotationPaused(true);
    pauseTimerRef.current = window.setTimeout(() => {
      setRotationPaused(false);
      pauseTimerRef.current = null;
    }, HERO_PAUSE_HOLD_MS);
  };

  const turnCard = (direction) => {
    setActiveFace((current) => (current + direction + 3) % 3);
    setTextsCountdown(null);
  };

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotionPreference = () => setPrefersReducedMotion(reducedMotion.matches);
    updateMotionPreference();
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.some((entry) => entry.isIntersecting && entry.intersectionRatio >= 0.6);
      setStageIsVisible(visible);
    }, { threshold: [0.6] });

    reducedMotion.addEventListener?.("change", updateMotionPreference);
    observer.observe(stage);
    return () => {
      observer.disconnect();
      reducedMotion.removeEventListener?.("change", updateMotionPreference);
    };
  }, []);

  useEffect(() => {
    if (!stageIsVisible || prefersReducedMotion) {
      setShowTurnHint(false);
      return undefined;
    }

    const revealHint = window.setTimeout(() => setShowTurnHint(true), 500);
    const hideHint = window.setTimeout(() => setShowTurnHint(false), 1900);
    return () => {
      window.clearTimeout(revealHint);
      window.clearTimeout(hideHint);
    };
  }, [stageIsVisible, prefersReducedMotion]);

  useEffect(() => {
    return () => {
      if (pauseTimerRef.current) window.clearTimeout(pauseTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const timers = [];
    const schedule = (callback, delay) => timers.push(window.setTimeout(callback, delay));

    if (!stageIsVisible || rotationPaused) return undefined;
    if (prefersReducedMotion) {
      if (activeFace === 0) setDialogueStep(4);
      setTextsCountdown(null);
      return undefined;
    }

    if (activeFace === 0) {
      setDialogueStep(1);
      setTextsCountdown(null);
      schedule(() => setDialogueStep(2), HERO_DIALOGUE_TIMELINE_MS.callerRequest);
      schedule(() => setDialogueStep(3), HERO_DIALOGUE_TIMELINE_MS.assistantDetailRequest);
      schedule(() => setDialogueStep(4), HERO_DIALOGUE_TIMELINE_MS.callerDetails);
      schedule(() => setTextsCountdown(3), HERO_DIALOGUE_TIMELINE_MS.countdownThree);
      schedule(() => setTextsCountdown(2), HERO_DIALOGUE_TIMELINE_MS.countdownTwo);
      schedule(() => setTextsCountdown(1), HERO_DIALOGUE_TIMELINE_MS.countdownOne);
      schedule(() => {
        setTextsCountdown(0);
        setActiveFace(1);
      }, HERO_DIALOGUE_TIMELINE_MS.faceAdvance);
    } else {
      setTextsCountdown(null);
      schedule(() => setActiveFace((face) => (face + 1) % 3), HERO_FACE_DURATION_MS);
    }

    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [activeFace, prefersReducedMotion, rotationPaused, stageIsVisible]);

  return (
    <section
      ref={stageRef}
      className={`landing-mobile-call-proof relative h-[29rem] overflow-visible ${className}`}
      style={{ perspective: "1400px", touchAction: "pan-y" }}
      data-active-face={activeFace}
      data-dialogue-step={dialogueStep}
      aria-label={`Three-sided My AI PA demo card. Side ${activeFace + 1} of 3. It switches every 7 seconds. The Pause button holds the screen for 14 seconds. Tap the left side for the previous side or the right side for the next side.`}
      role="region"
      tabIndex={0}
      onClick={(event) => {
        if (swipeHandledRef.current) {
          swipeHandledRef.current = false;
          return;
        }
        const bounds = event.currentTarget.getBoundingClientRect();
        const tappedLeftSide = event.clientX < bounds.left + (bounds.width / 2);
        turnCard(tappedLeftSide ? -1 : 1);
      }}
      onPointerDown={(event) => {
        if (event.target.closest("button")) return;
        swipeStartXRef.current = event.clientX;
      }}
      onPointerUp={(event) => {
        if (swipeStartXRef.current === null || event.target.closest("button")) return;
        const distance = event.clientX - swipeStartXRef.current;
        swipeStartXRef.current = null;
        if (Math.abs(distance) < 48) return;
        swipeHandledRef.current = true;
        turnCard(distance > 0 ? -1 : 1);
      }}
      onPointerCancel={() => {
        swipeStartXRef.current = null;
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          turnCard(event.key === "ArrowLeft" ? -1 : 1);
          return;
        }
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          turnCard(1);
        }
      }}
    >
      <div
        className="landing-mobile-call-prism relative h-[22.75rem] w-full"
        style={{
          "--landing-prism-depth": "clamp(6rem, 27vw, 7rem)",
          transform: `translateZ(calc(-1 * var(--landing-prism-depth))) rotateY(${-activeFace * 120}deg)`,
          transformStyle: "preserve-3d",
          transition: "transform 760ms cubic-bezier(.2,.72,.2,1)",
        }}
      >
        <div
          className="landing-timed-call-face landing-timed-call-front absolute inset-0 overflow-hidden rounded-[1.65rem] border border-[#2b547d] bg-[linear-gradient(155deg,#133053,#071931)] p-4 text-white shadow-[0_30px_60px_-34px_rgba(0,0,0,0.9)]"
          style={{ transform: "rotateY(0deg) translateZ(var(--landing-prism-depth))", backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden" }}
          aria-hidden={activeFace !== 0}
        >
          <div className="landing-timed-call-status flex items-center justify-between text-[0.68rem] font-extrabold text-[#d9e8f7]">
            <span className="inline-flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-full bg-[#15d56b] shadow-[0_0_0_5px_rgba(21,213,107,0.1),0_0_18px_rgba(21,213,107,0.65)]" />Call in progress</span>
            <span>Recorded demo</span>
          </div>
          <div className="landing-timed-call-agent-row mt-3 flex items-center gap-3">
            <div className="landing-timed-call-avatar-wrap grid h-[4.35rem] w-[4.35rem] shrink-0 place-items-center rounded-full border-2 border-[#27c2ff]/40 shadow-[0_0_0_6px_rgba(39,194,255,0.055),0_0_32px_rgba(39,194,255,0.22)]">
              <img
                src={`${process.env.PUBLIC_URL || ""}/NiceGirl.png`}
                alt="My AI PA telephone assistant wearing a headset"
                className="landing-timed-call-avatar h-[3.85rem] w-[3.85rem] rounded-full border-[3px] border-[#2abdf0] object-cover"
              />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="landing-timed-call-agent text-[1.35rem] font-black leading-none tracking-[-0.035em]">My AI PA Agent</h2>
              <p className="landing-timed-call-subtitle mt-1.5 text-[0.72rem] font-semibold text-[#a9bfd6]">Answering for <strong className="font-extrabold text-white">your business</strong></p>
              <div className="landing-mobile-call-wave mt-2 flex h-6 items-center gap-1" aria-hidden="true">
                {[7, 13, 20, 15, 22, 15, 20, 13, 7].map((height, index) => (
                  <i key={`${height}-${index}`} className="w-[3px] rounded-full bg-[linear-gradient(180deg,#5fe2ff,#157de2)] shadow-[0_0_10px_rgba(63,197,255,0.38)]" style={{ height }} />
                ))}
              </div>
            </div>
          </div>

          <div className="landing-timed-conversation mt-2 space-y-1">
            <div className="landing-timed-conversation-turn landing-timed-conversation-ai mr-3 rounded-[1rem_1rem_1rem_0.35rem] border border-white/10 bg-white/[0.08] px-3 py-1.5">
              <span className="block text-[0.55rem] font-black uppercase tracking-[0.09em] text-[#63d9ff]">My AI PA</span>
              <p className="mt-0.5 text-[0.72rem] font-extrabold leading-[1.18] text-white">“Hello are you looking for a new installation, repair or maintenance today?”</p>
            </div>
            {dialogueStep >= 2 && (
              <div className="landing-dialogue-reveal landing-timed-conversation-turn landing-timed-conversation-caller ml-3 rounded-[1rem_1rem_0.35rem_1rem] bg-[#0a84ff] px-3 py-1.5">
                <span className="block text-[0.55rem] font-black uppercase tracking-[0.09em] text-[#d9efff]">Caller</span>
                <p className="mt-0.5 text-[0.76rem] font-extrabold leading-[1.2] text-white">“I need someone to wire up my hot tub as a new installation.”</p>
              </div>
            )}
            {dialogueStep >= 3 && (
              <div className="landing-dialogue-reveal landing-timed-conversation-turn landing-timed-conversation-ai mr-2 rounded-[1rem_1rem_1rem_0.35rem] border border-white/10 bg-white/[0.08] px-3 py-1.5">
                <span className="block text-[0.55rem] font-black uppercase tracking-[0.09em] text-[#63d9ff]">My AI PA</span>
                <p className="mt-0.5 text-[0.76rem] font-extrabold leading-[1.2] text-white">“Can I get your first name?”</p>
              </div>
            )}
            {dialogueStep >= 4 && (
              <div className="landing-dialogue-reveal landing-timed-conversation-turn landing-timed-conversation-caller ml-3 rounded-[1rem_1rem_0.35rem_1rem] bg-[#0a84ff] px-3 py-1.5">
                <span className="block text-[0.55rem] font-black uppercase tracking-[0.09em] text-[#d9efff]">Caller</span>
                <p className="mt-0.5 text-[0.76rem] font-extrabold leading-[1.2] text-white">“Brian Smith.”</p>
              </div>
            )}
            {textsCountdown !== null && (
              <p className="landing-dialogue-reveal landing-timed-conversation-result flex items-center justify-center gap-1.5 pt-0.5 text-[0.58rem] font-black uppercase tracking-[0.06em] text-[#b9f6cd]" aria-label={`Texts will be sent in ${textsCountdown} seconds`}>
                <span className="grid h-4 w-4 place-items-center rounded-full bg-[#16a05d] text-[0.55rem] text-white" aria-hidden="true">↻</span>
                Texts will be sent in <strong className="tabular-nums text-white">0:{String(textsCountdown).padStart(2, "0")}</strong>
              </p>
            )}
          </div>
        </div>

        <div
          className="landing-timed-call-face landing-timed-call-back absolute inset-0 flex flex-col overflow-hidden rounded-[1.65rem] border border-[#2b547d] bg-[linear-gradient(155deg,#133053,#071931)] p-3 text-white shadow-[0_30px_60px_-34px_rgba(0,0,0,0.9)]"
          style={{ transform: "rotateY(120deg) translateZ(var(--landing-prism-depth))", backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden" }}
          aria-hidden={activeFace !== 1}
        >
          <div className="landing-timed-call-status flex items-center justify-between text-[0.68rem] font-extrabold text-[#d9e8f7]">
            <span className="inline-flex items-center gap-2"><i className="h-2.5 w-2.5 rounded-full bg-[#15d56b] shadow-[0_0_0_5px_rgba(21,213,107,0.1),0_0_18px_rgba(21,213,107,0.65)]" />Call complete</span>
            <span>now</span>
          </div>
          <h2 className="landing-timed-call-back-title mt-2 text-center text-[1.35rem] font-black leading-none tracking-[-0.035em]">Both sides get a text</h2>
          <p className="landing-timed-call-back-intro mt-1 text-center text-[0.68rem] font-bold text-[#9dbbd6]">The job details are ready before you call back.</p>

          <div className="landing-text-phone-grid mt-2.5 grid grid-cols-2 gap-2">
            <div className="landing-text-phone-holder">
              <PhoneReadingHand side="left" />
              <div className="landing-text-phone rounded-[1.5rem] border-[4px] border-[#101827] bg-white p-1.5 text-[#111827] shadow-[0_18px_36px_-24px_rgba(0,0,0,0.7)]">
                <div className="flex items-center justify-between px-1 text-[0.43rem] font-black text-[#475569]"><span>9:41</span><span className="h-1.5 w-9 rounded-full bg-[#101827]" /><span>5G</span></div>
                <div className="mt-1 flex items-center gap-1.5 border-b border-[#e5e7eb] px-1 pb-1.5">
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-[#2587f5] text-[0.48rem] font-black text-white">PA</span>
                  <span className="min-w-0"><strong className="block text-[0.56rem] font-black leading-tight">Owners cell phone</strong><small className="block text-[0.42rem] font-bold text-[#8e8e93]">My AI PA · now</small></span>
                </div>
                <div className="landing-text-bubble mt-1.5 rounded-[0.75rem_0.75rem_0.75rem_0.25rem] bg-[#e9e9eb] px-2 py-1.5 text-[0.53rem] font-bold leading-[1.22] text-[#111]">New installation · Hot tub wiring · Brian Smith · 23 Robb St. · Hamilton · 905-555-1234 · Preferred start date: Next week · Call back: ASAP · Best call back time: After 7</div>
              </div>
            </div>

            <div className="landing-text-phone-holder">
              <PhoneReadingHand side="right" />
              <div className="landing-text-phone rounded-[1.5rem] border-[4px] border-[#101827] bg-white p-1.5 text-[#111827] shadow-[0_18px_36px_-24px_rgba(0,0,0,0.7)]">
                <div className="flex items-center justify-between px-1 text-[0.43rem] font-black text-[#475569]"><span>9:41</span><span className="h-1.5 w-9 rounded-full bg-[#101827]" /><span>5G</span></div>
                <div className="mt-1 flex items-center gap-1.5 border-b border-[#e5e7eb] px-1 pb-1.5">
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-[#0a84ff] text-[0.48rem] font-black text-white">TE</span>
                  <span className="min-w-0"><strong className="block text-[0.56rem] font-black leading-tight">Customer&apos;s cell phone</strong><small className="block text-[0.42rem] font-bold text-[#8e8e93]">Tim&apos;s Electrical · now</small></span>
                </div>
                <div className="landing-text-bubble landing-text-bubble-customer ml-2 mt-1.5 rounded-[0.75rem_0.75rem_0.25rem_0.75rem] bg-[#0a84ff] px-2 py-1.5 text-[0.53rem] font-bold leading-[1.22] text-white">TIM&apos;S ELECTRICAL. Hi. Your installation request has been forwarded to team. We&apos;ll get back to you shortly to discuss job details and arrange a site visit. THANKS FOR CALLING TIM&apos;S ELECTRICAL. HAVE A GREAT DAY!</div>
              </div>
            </div>
          </div>

          <div className="landing-timed-call-delivered mt-auto flex items-center justify-center gap-2 pb-0.5 pt-2 text-[0.74rem] font-black uppercase tracking-[0.055em] text-[#c9ffda]">
            <span className="grid h-6 w-6 place-items-center rounded-full bg-[#16a05d] text-[0.8rem] text-white shadow-[0_0_14px_rgba(22,160,93,0.45)]" aria-hidden="true">✓</span>
            Job captured and delivered
          </div>
        </div>

        <div
          className="landing-timed-call-face landing-timed-call-benefits absolute inset-0 overflow-hidden rounded-[1.65rem] border border-[#8fc2ee] bg-[linear-gradient(160deg,#ffffff,#edf7ff)] p-4 text-[#07142a] shadow-[0_30px_60px_-34px_rgba(0,0,0,0.9)]"
          style={{ transform: "rotateY(240deg) translateZ(var(--landing-prism-depth))", backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden" }}
          aria-hidden={activeFace !== 2}
        >
          <div className="landing-timed-benefits-meta flex items-center justify-between text-[0.66rem] font-black uppercase tracking-[0.1em] text-[#0c5fc3]">
            <span>What you get</span>
            <span>3 of 3</span>
          </div>
          <h2 className="landing-timed-benefits-title landing-coffee-line mt-3 text-center text-[1.12rem] font-black leading-[1.18] tracking-[-0.025em] text-[#18324f]">
            For about the <CoffeePriceEmphasis /> you get:
          </h2>
          <div className="landing-timed-benefits-list mt-3 overflow-hidden rounded-[1.05rem] border border-[#c7daec] bg-white/90 shadow-[0_18px_38px_-32px_rgba(15,23,42,0.5)]">
            {[
              ["phone", "Every call answered professionally after 3 rings — no more hangups"],
              ["faq", "Connects with customers with a natural dialogue, answers FAQs and projects a professional image."],
              ["clipboard", "Collects the job description, caller’s information for easy follow-up call."],
              ["sms", "Texts you the call details and sends the customer a thank-you reminder."],
            ].map(([icon, label], index) => (
              <div key={label} className={`landing-timed-benefits-row grid grid-cols-[2.35rem_minmax(0,1fr)] items-center gap-2.5 px-3 py-2.5 ${index ? "border-t border-[#d8e5f1]" : ""}`}>
                <span className="landing-timed-benefits-icon grid h-9 w-9 place-items-center rounded-xl bg-[#1687dc] text-white" aria-hidden="true">
                  <HeroIcon type={icon} className="h-[1.05rem] w-[1.05rem]" />
                </span>
                <span className="landing-timed-benefits-copy text-[0.69rem] font-black leading-[1.22] text-[#172b43]">{label}</span>
              </div>
            ))}
          </div>
          <p className="landing-timed-benefits-footer mt-2 text-center text-[0.6rem] font-black uppercase tracking-[0.08em] text-[#4f6b87]">Tap to see the live call</p>
        </div>
      </div>
      <span className={`landing-card-turn-hint ${showTurnHint ? "landing-card-turn-hint-visible" : ""} pointer-events-none absolute inset-x-0 bottom-24 z-20 mx-auto w-fit rounded-full border border-white/25 bg-[#061a31]/88 px-3 py-1.5 text-[0.66rem] font-black uppercase tracking-[0.08em] text-white shadow-lg backdrop-blur-sm`} aria-hidden="true">
        Tap either side to turn
      </span>
      <div className="landing-carousel-controls absolute inset-x-0 bottom-0 z-30">
        <div className="landing-carousel-timing mb-2 flex items-center justify-center gap-2 text-center text-[0.58rem] font-black uppercase tracking-[0.055em] text-[#31577a]">
          <span>Switches every 7 seconds</span>
          <button
            type="button"
            className="rounded-full border border-[#5f9fd9] bg-white px-3 py-1 text-[#0c5fc3] shadow-sm"
            aria-pressed={rotationPaused}
            onClick={(event) => {
              event.stopPropagation();
              holdCurrentScreen();
            }}
          >
            {rotationPaused ? "Holding" : "Pause"}
          </button>
          <span>Pause button holds screen for 14 seconds</span>
        </div>
        <div className="landing-carousel-actions grid grid-cols-2 gap-2">
          <button
            type="button"
            className="landing-carousel-secondary inline-flex items-center justify-center rounded-xl border border-[#5f9fd9] bg-white font-black text-[#0c5fc3] shadow-[0_10px_24px_-18px_rgba(12,95,195,0.8)]"
            onClick={(event) => {
              event.stopPropagation();
              onSampleCall?.();
            }}
          >
            See a Sample Call
          </button>
          <button
            type="button"
            className="landing-carousel-primary inline-flex items-center justify-center rounded-xl bg-[#ff6a00] font-black text-white shadow-[0_14px_28px_-20px_rgba(255,106,0,0.9)]"
            onClick={(event) => {
              event.stopPropagation();
              onStartTrial?.();
            }}
          >
            Start Your Free Trial
          </button>
        </div>
      </div>
    </section>
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

function BuiltForYourTrade({ playDemo }) {
  const [audienceType, setAudienceType] = useState("trades");
  const [activeSlug, setActiveSlug] = useState(tradePageOrder[0]);
  const activeTrade = tradePages[activeSlug] || tradePages[tradePageOrder[0]];
  const isPropertyManagement = audienceType === "property-management";
  const activeAudience = isPropertyManagement ? propertyManagementAudience : activeTrade;
  const handledCalls = isPropertyManagement
    ? propertyManagementAudience.handledCalls
    : activeTrade.callerNeeds.slice(0, 4).map(([title]) => title);

  return (
    <section id="built-for-your-trade" className="hidden border-y border-[#cfe2f5] bg-[linear-gradient(180deg,#f8fbff_0%,#edf6ff_100%)] sm:block">
      <div className="mx-auto w-full max-w-[1280px] px-4 py-10 sm:px-6 sm:py-14 lg:px-8 lg:py-16">
        <div className="mx-auto max-w-[820px] text-center">
          <p className="text-[0.72rem] font-black uppercase tracking-[0.18em] text-[#f06a00]">Built for Canadian service businesses</p>
          <h2 className="mt-3 text-[clamp(2rem,5vw,4rem)] font-black leading-[0.98] tracking-[-0.055em] text-[#07142a]">Choose your audience. See the calls we handle.</h2>
          <p className="mx-auto mt-4 max-w-[700px] text-[0.98rem] font-semibold leading-7 text-[#48627d] sm:text-[1.08rem]">
            The workflow stays simple, but the questions and details change to match the people calling your business.
          </p>
        </div>

        <div className="mx-auto mt-7 grid max-w-[720px] grid-cols-2 gap-2 rounded-[18px] border border-[#bfd8f1] bg-white p-1.5 shadow-[0_14px_34px_-28px_rgba(14,68,130,0.7)]" aria-label="Choose your audience">
          <button
            type="button"
            onClick={() => setAudienceType("trades")}
            aria-pressed={!isPropertyManagement}
            className={`min-h-[52px] rounded-[13px] px-3 text-[0.82rem] font-black transition sm:text-[0.92rem] ${!isPropertyManagement ? "bg-[#176bff] text-white shadow-[0_12px_26px_-18px_rgba(23,107,255,0.95)]" : "text-[#17395f] hover:bg-[#f1f7ff]"}`}
          >
            Trades
          </button>
          <button
            type="button"
            onClick={() => setAudienceType("property-management")}
            aria-pressed={isPropertyManagement}
            className={`min-h-[52px] rounded-[13px] px-2 text-[0.76rem] font-black leading-tight transition sm:text-[0.9rem] ${isPropertyManagement ? "bg-[#6d4ce8] text-white shadow-[0_12px_26px_-18px_rgba(109,76,232,0.95)]" : "text-[#17395f] hover:bg-[#f7f4ff]"}`}
          >
            Property Managers &amp; Landlords
          </button>
        </div>

        {!isPropertyManagement ? <div className="-mx-4 mt-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0" aria-label="Choose your trade">
          <div className="flex min-w-max gap-2 sm:min-w-0 sm:flex-wrap sm:justify-center">
            {tradePageOrder.map((slug) => {
              const trade = tradePages[slug];
              const isActive = slug === activeSlug;
              return (
                <button
                  key={slug}
                  type="button"
                  onClick={() => setActiveSlug(slug)}
                  aria-pressed={isActive}
                  className={`inline-flex min-h-[48px] items-center gap-2.5 rounded-full border px-4 text-[0.8rem] font-black transition sm:text-[0.88rem] ${isActive ? "border-[#176bff] bg-[#176bff] text-white shadow-[0_14px_34px_-22px_rgba(23,107,255,0.9)]" : "border-[#bfd8f1] bg-white text-[#17395f] hover:border-[#176bff] hover:text-[#0c5fc3]"}`}
                >
                  <span className={`grid h-7 w-7 place-items-center rounded-full ${isActive ? "bg-white/16" : "bg-[#edf6ff] text-[#176bff]"}`}>
                    <HeroIcon type={trade.icon} className="h-4 w-4" />
                  </span>
                  {trade.label}
                </button>
              );
            })}
          </div>
        </div> : null}

        <div className="mt-6 overflow-hidden rounded-[24px] border border-[#bfd8f1] bg-white shadow-[0_30px_75px_-52px_rgba(14,68,130,0.58)] lg:grid lg:grid-cols-[0.9fr_1.1fr]">
          <div className="p-5 sm:p-7 lg:p-9">
            <div className="flex items-center gap-3">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-[14px] text-white shadow-[0_14px_34px_-23px_rgba(15,23,42,0.7)]" style={{ background: activeAudience.accent }}>
                <HeroIcon type={activeAudience.icon} className="h-6 w-6" />
              </span>
              <div>
                <p className="text-[0.7rem] font-black uppercase tracking-[0.14em] text-[#64748b]">Calls we handle</p>
                <h3 className="mt-1 text-[1.45rem] font-black leading-tight tracking-[-0.035em] text-[#07142a]">{activeAudience.label}</h3>
              </div>
            </div>

            <p className="mt-5 text-[1rem] font-semibold leading-7 text-[#425b76]">{activeAudience.ownerValue}</p>
            <div className="mt-5 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              {handledCalls.map((title) => (
                <div key={title} className="flex items-center gap-2.5 rounded-xl border border-[#d7e6f5] bg-[#f7fbff] px-3 py-3 text-[0.82rem] font-black leading-tight text-[#17395f]">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#dff7e7] text-[0.75rem] text-[#139448]" aria-hidden="true">✓</span>
                  {title}
                </div>
              ))}
            </div>

            <div className="mt-6 grid gap-2.5 sm:grid-cols-2">
              {isPropertyManagement ? (
                <a href={propertyManagementAudience.pageHref} className="inline-flex min-h-[50px] items-center justify-center rounded-xl bg-[linear-gradient(180deg,#7c5cf0,#6541dc)] px-5 text-center text-[0.88rem] font-black text-white shadow-[0_16px_34px_-22px_rgba(109,76,232,0.9)] transition hover:-translate-y-0.5 hover:brightness-110">
                  See the rental answering demo
                </a>
              ) : (
                <button type="button" onClick={playDemo} className="inline-flex min-h-[50px] items-center justify-center rounded-xl bg-[linear-gradient(180deg,#ff7a00,#ff6500)] px-5 text-[0.88rem] font-black text-white shadow-[0_16px_34px_-22px_rgba(255,106,0,0.9)] transition hover:-translate-y-0.5 hover:brightness-110">
                  Hear the {activeTrade.singular} demo
                </button>
              )}
              <a href={isPropertyManagement ? "#/signup" : `#/trades/${activeSlug}`} className="inline-flex min-h-[50px] items-center justify-center rounded-xl border-2 border-[#8eb9e2] bg-white px-5 text-center text-[0.88rem] font-black text-[#0c5fc3] transition hover:-translate-y-0.5 hover:border-[#176bff] hover:bg-[#f6fbff]">
                {isPropertyManagement ? "Build my property assistant" : `Explore the ${activeTrade.singular} page`}
              </a>
            </div>
          </div>

          <div className="border-t border-[#cfe2f5] bg-[#071a32] p-5 text-white sm:p-7 lg:border-l lg:border-t-0 lg:p-9">
            <div className="flex items-center justify-between text-[0.68rem] font-black uppercase tracking-[0.12em] text-[#a9c6e2]">
              <span>Example missed call</span>
              <span className="inline-flex items-center gap-1.5 text-[#83f0aa]"><i className="h-2 w-2 rounded-full bg-[#19d66f]" />Handled</span>
            </div>

            <div className="mt-5 space-y-3">
              <article className="ml-5 rounded-[16px_16px_5px_16px] bg-[#1679e8] px-4 py-3.5">
                <p className="text-[0.64rem] font-black uppercase tracking-[0.11em] text-[#d9efff]">Caller</p>
                <p className="mt-1.5 text-[0.9rem] font-bold leading-6">{activeAudience.scenario.caller}</p>
              </article>
              <article className="mr-5 rounded-[16px_16px_16px_5px] border border-white/12 bg-white/[0.08] px-4 py-3.5">
                <p className="text-[0.64rem] font-black uppercase tracking-[0.11em] text-[#8bdcff]">My AI PA</p>
                <p className="mt-1.5 text-[0.9rem] font-bold leading-6 text-[#eef7ff]">{activeAudience.scenario.assistant}</p>
              </article>
            </div>

            <div className="mt-4 rounded-[18px] bg-white p-4 text-[#101827] shadow-[0_18px_46px_-34px_rgba(0,0,0,0.9)]">
              <div className="flex items-center gap-2.5">
                <span className="grid h-8 w-8 place-items-center rounded-full bg-[#2587f5] text-[0.62rem] font-black text-white">PA</span>
                <span><strong className="block text-[0.78rem] font-black">Owner receives this text</strong><small className="mt-0.5 block text-[0.58rem] font-bold text-[#8e8e93]">My AI PA · now</small></span>
              </div>
              <p className="mt-3 rounded-[13px_13px_13px_5px] bg-[#e9e9eb] px-3 py-3 text-[0.76rem] font-bold leading-5 text-[#111]">{activeAudience.scenario.owner}</p>
            </div>
          </div>
        </div>

        <div className="mt-6 text-center">
          <a href="#/trades" className="inline-flex min-h-[46px] items-center justify-center gap-2 rounded-full border border-[#bfd8f1] bg-white px-5 text-[0.82rem] font-black text-[#0c5fc3] shadow-[0_12px_30px_-25px_rgba(12,95,195,0.72)] transition hover:-translate-y-0.5 hover:border-[#176bff]">
            Browse every trade page <span aria-hidden="true">→</span>
          </a>
        </div>
      </div>
    </section>
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
    ["Talks with customers,", "answers questions,", "collects job details."],
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
      <div className="mx-auto w-full max-w-[720px] px-4 py-8 sm:hidden">
        <p className="text-[0.7rem] font-black uppercase tracking-[0.16em] text-[#176bff]">What happens after a missed call</p>
        <h2 className="mt-2 text-[1.8rem] font-black leading-none tracking-[-0.045em] text-[#07142a]">Three steps. No voicemail chase.</h2>
        <div className="mt-5 grid gap-3">
          {[
            ["1", "My AI PA answers", "Your customer gets a professional answer after three rings."],
            ["2", "The right details are collected", "Problem, address, urgency, timing, and callback number."],
            ["3", "Both sides receive a text", "You get the job details. The customer gets confirmation."],
          ].map(([number, title, body]) => (
            <article key={number} className="grid grid-cols-[2.5rem_1fr] items-center gap-3 rounded-[14px] border border-[#cfe1f6] bg-white p-4 shadow-[0_18px_44px_-38px_rgba(15,23,42,0.28)]">
              <span className="grid h-10 w-10 place-items-center rounded-full bg-[#176bff] text-base font-black text-white">{number}</span>
              <div>
                <h3 className="text-[1rem] font-black leading-tight text-[#07142a]">{title}</h3>
                <p className="mt-1 text-[0.88rem] font-medium leading-5 text-[#475569]">{body}</p>
              </div>
            </article>
          ))}
        </div>
      </div>

      <div className="mx-auto hidden w-full max-w-[1720px] px-5 py-7 sm:block sm:px-8 lg:px-10 lg:py-9">
        <div className="mx-auto flex items-center justify-center gap-4">
          <HeroLogoMark />
        </div>

        <div className="mt-4 text-center">
          <p className="inline-flex rounded-full border border-[#d7e7fb] bg-[#eef6ff] px-6 py-2 text-[0.86rem] font-black uppercase tracking-[0.22em] text-[#1d65bd] shadow-[0_18px_44px_-36px_rgba(37,99,235,0.72)]">
            AI phone answering assistant for the trades
          </p>
          <h2 className="mx-auto mt-4 max-w-[1420px] text-[clamp(3rem,5.25vw,5rem)] font-black leading-[0.95] tracking-[-0.058em] text-[#07142a]">
            Voicemail loses jobs. <span className="text-[#1d7df2]">My AI PA</span>
            <span className="block">catches them.</span>
          </h2>
          <p className="mx-auto mt-4 max-w-[960px] text-[clamp(1.18rem,1.65vw,1.55rem)] font-medium leading-8 text-[#405476]">
            When you cannot get to the phone, the telephone assistant answers calls, talks with your customer, collects the job details, and texts both the business owner and caller for an easy follow-up.
          </p>
        </div>

        <div id="voicemail-comparison-cards" className="relative mt-6 grid gap-9 pt-5 lg:grid-cols-3 lg:gap-7">
          <article className="relative flex min-h-[410px] flex-col rounded-lg border border-[#ff5b5b] bg-white p-5 shadow-[0_30px_80px_-58px_rgba(239,68,68,0.7)]">
            <div className="absolute left-1/2 top-0 z-10 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border-2 border-[#ff5b5b] bg-white px-5 py-2 text-sm font-black uppercase tracking-[0.12em] text-[#cc0f1f] shadow-[0_12px_28px_-18px_rgba(204,15,31,0.8)]">
              Old way
            </div>
            <div className="flex items-center gap-4">
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-[linear-gradient(180deg,#ff4545,#e11d48)] text-3xl font-black text-white shadow-[0_18px_34px_-24px_rgba(225,29,72,1)]">1</span>
              <p className="text-[clamp(1.42rem,1.75vw,1.8rem)] font-black leading-tight tracking-[-0.04em] text-[#ef232e]">Phone rings unanswered</p>
            </div>
            <h3 className="mt-3 text-[clamp(1.16rem,1.35vw,1.42rem)] font-black leading-tight text-[#07142a]">
              Three rings. No answer. The customer moves on.
            </h3>

            <div className="mt-4 grid gap-3">
              <div className="rounded-lg border border-[#cbd5e1] border-l-4 border-l-[#cc0f1f] bg-[linear-gradient(135deg,#ffffff,#f8fafc)] px-5 py-4 shadow-[0_16px_34px_-28px_rgba(15,23,42,0.7)]">
                <div className="space-y-1 text-[clamp(0.96rem,1.18vw,1.12rem)] font-black uppercase leading-[1.18] tracking-[-0.015em] text-[#07142a]">
                  <p className="text-[#cc0f1f]">Answering machine:</p>
                  <p>Cold / Impersonal</p>
                  <p>Customer wants action</p>
                  <p>Hangs up. Customer moves on</p>
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
                  <p className="text-sm font-black uppercase tracking-[0.1em] text-[#cc0f1f]">Customer calls competitor</p>
                  <p className="mt-1 text-sm font-bold leading-5 text-[#07142a]">The opportunity left.</p>
                </div>
              </div>
            </div>

            <div className="mt-auto pt-4">
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
            </div>
          </article>

          <article className="relative min-h-[410px] rounded-lg border border-[#60a5fa] bg-white p-5 shadow-[0_30px_80px_-58px_rgba(37,99,235,0.7)]">
            <div className="absolute left-1/2 top-0 z-10 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border-2 border-[#60a5fa] bg-white px-5 py-2 text-sm font-black uppercase tracking-[0.12em] text-[#1d65bd] shadow-[0_12px_28px_-18px_rgba(29,101,189,0.8)]">
              New way
            </div>
            <div className="flex items-center gap-4">
              <span className="grid h-14 w-14 place-items-center rounded-full bg-[linear-gradient(180deg,#3185ff,#1d4ed8)] text-3xl font-black text-white shadow-[0_18px_34px_-24px_rgba(29,78,216,1)]">2</span>
              <p className="text-[clamp(1.55rem,2vw,2rem)] font-black leading-tight tracking-[-0.04em] text-[#1d7df2]">Assistant answers live</p>
            </div>
            <h3 className="mt-3 max-w-[360px] text-[clamp(1.22rem,1.45vw,1.52rem)] font-black leading-tight text-[#07142a]">Instantly connects with customer</h3>
            <p className="mt-2 max-w-[360px] text-[clamp(1rem,1.12vw,1.16rem)] font-bold leading-snug text-[#405476]">Asks why they called and answers FAQ questions.</p>

            <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_150px]">
              <div className="min-w-0">
                <p className="mb-3 inline-flex rounded-full bg-[#e8f2ff] px-4 py-1 text-xs font-black uppercase tracking-[0.12em] text-[#1d7df2]">
                  AI speaking now
                </p>
                <div className="space-y-3">
                  {[
                    ["My AI PA", "Hi! Thanks for calling. What can I help you with today?", "6:10 PM"],
                    ["Caller", "I need a hot tub electrical setup at my home.", "6:10 PM"],
                    ["My AI PA", "Sure, we can help. I can also answer common questions before I collect the details.", "6:10 PM"],
                  ].map(([speaker, text, time], index) => (
                    <div key={speaker + index} className="rounded-lg border border-[#d7e7fb] bg-[linear-gradient(180deg,#ffffff,#eef6ff)] px-3 py-2 shadow-[0_14px_32px_-30px_rgba(37,99,235,0.8)]">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-black text-[#07142a]">{speaker}</p>
                        <p className="text-xs font-bold text-[#64748b]">{time}</p>
                      </div>
                      <p className="mt-1 text-sm font-semibold leading-5 text-[#334155]">{text}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid content-center gap-3">
                {[
                  ["Name", "Brian Smith"],
                  ["Phone", "905-555-1234"],
                  ["Reason for call", "Hot tub electrical setup"],
                  ["Address", "23 Robb St, Hamilton"],
                  ["Preferred start date", "Right away"],
                  ["Best callback time", "Afternoons or after 5 PM"],
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
                  <p className="text-[clamp(1.4rem,1.75vw,1.8rem)] font-black leading-tight tracking-[-0.04em] text-[#13833c]">Job description texted to your phone</p>
                </div>
                <h3 className="mt-3 text-[clamp(1.08rem,1.25vw,1.34rem)] font-black leading-tight text-[#07142a]">
                  Owner and caller both get clear follow-up texts for an easy callback.
                </h3>
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
                      <p className="min-w-0 flex-1 text-sm font-black leading-5 text-[#07142a] min-[1500px]:text-base">{text}</p>
                      <span className="grid h-6 w-6 shrink-0 place-items-center text-[#16a34a]" aria-label="Completed">
                        <HeroIcon type="check" className="h-6 w-6" />
                      </span>
                    </div>
                  ))}
                </div>

                <div className="mx-auto h-[300px] w-full max-w-[190px] overflow-hidden rounded-[24px] border-[4px] border-[#07142a] bg-white p-2 shadow-[0_22px_48px_-34px_rgba(15,23,42,0.95)] xl:h-[316px] min-[1500px]:h-[330px] min-[1500px]:w-[170px] min-[1500px]:rounded-[28px] min-[1500px]:border-[5px]">
                  <div className="mx-auto h-2 w-14 rounded-full bg-[#07142a] min-[1500px]:w-16" />
                  <div className="px-1 pt-3 text-center min-[1500px]:px-2 min-[1500px]:pt-4">
                    <p className="text-[0.66rem] font-black text-[#07142a] min-[1500px]:text-[0.76rem]">My AI PA</p>
                    <p className="mt-2 text-[0.58rem] font-semibold text-[#94a3b8] min-[1500px]:text-[0.68rem]">Today 10:16 AM</p>
                  </div>
                  <div className="mt-3 space-y-2 pb-2">
                    <div className="rounded-lg bg-[#ecfdf5] p-2.5">
                      <p className="text-[0.62rem] font-black uppercase tracking-[0.08em] text-[#16a34a]">Job description to owner</p>
                      <div className="mt-1 space-y-0.5 text-[0.53rem] font-bold leading-3 text-[#07142a] xl:text-[0.58rem] min-[1500px]:text-[0.68rem] min-[1500px]:leading-4">
                        <p>Brian Smith</p>
                        <p>905-555-1234</p>
                        <p>Hot tub wiring</p>
                        <p>23 Robb St, Hamilton</p>
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
              <p className="rounded-lg bg-[#ecfdf5] px-4 py-3 text-sm font-bold leading-5 text-[#27543a]">
                The business owner instantly receives the job details for an easy callback once they are safely down from the ladder or finished dinner with their family.
              </p>
            </div>
          </article>

          <div className="pointer-events-none absolute left-1/3 top-[46%] hidden h-10 w-10 -translate-x-1/2 place-items-center rounded-full border-2 border-[#1d7df2] bg-white text-[#1d7df2] shadow-[0_16px_38px_-24px_rgba(37,99,235,0.85)] lg:grid">
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2.8" aria-hidden="true">
              <path d="M4 12h15M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="pointer-events-none absolute left-2/3 top-[46%] hidden h-10 w-10 -translate-x-1/2 place-items-center rounded-full border-2 border-[#1d7df2] bg-white text-[#1d7df2] shadow-[0_16px_38px_-24px_rgba(37,99,235,0.85)] lg:grid">
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2.8" aria-hidden="true">
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

function ForwardingSetupWizard() {
  const [provider, setProvider] = useState("ROGERS");
  const [copiedField, setCopiedField] = useState("");
  const [testComplete, setTestComplete] = useState(false);
  const providerDetails = forwardingProviderDetails[provider];
  const displayNumber = "(289) 555-0148";
  const copyNumber = "2895550148";

  const copyToClipboard = async (value, field) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      window.setTimeout(() => setCopiedField(""), 1800);
    } catch (_err) {
      setCopiedField("");
    }
  };

  return (
    <div className="rounded-[18px] border border-[#cfe1f6] bg-white px-4 py-5 shadow-[0_28px_82px_-58px_rgba(18,32,51,0.34)] sm:px-6 lg:px-8 lg:py-8">
      <div>
        <p className="text-[0.74rem] font-black uppercase tracking-[0.18em] text-[#176bff]">Easy phone setup</p>
        <h3 className="mt-2 text-[clamp(1.4rem,2vw,1.85rem)] font-black leading-tight tracking-[-0.035em] text-[#07142a]">
          Send calls you don&apos;t answer to My AI PA
        </h3>
        <p className="mt-2 text-[0.94rem] font-medium leading-6 text-[#475569]">
          Pick your phone company. We&apos;ll show you exactly what to press, step by step.
        </p>

        <div className="mt-5 grid grid-cols-[auto_1fr_auto_1fr_auto] items-center gap-2 text-[0.68rem] font-black uppercase tracking-[0.14em] text-[#94a3b8] sm:gap-3 sm:text-[0.74rem]">
          <span className="inline-flex items-center gap-2 text-[#176bff]">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-[#176bff] text-white">1</span>
            <span className="hidden sm:inline">Provider</span>
          </span>
          <span className="h-px bg-[#94a3b8]" />
          <span className="inline-flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-[#94a3b8] text-white">2</span>
            <span className="hidden sm:inline">Connect</span>
          </span>
          <span className="h-px bg-[#94a3b8]" />
          <span className="inline-flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-[#94a3b8] text-white">3</span>
            <span className="hidden sm:inline">Test</span>
          </span>
        </div>

        <div className="mt-4 grid grid-cols-2 overflow-hidden rounded-t-[10px] border border-[#cfe1f6] bg-[#f8fbff] sm:grid-cols-4">
          {Object.keys(forwardingProviderDetails).map((providerName) => {
            const selected = provider === providerName;
            return (
              <button
                key={providerName}
                type="button"
                onClick={() => {
                  setProvider(providerName);
                  setCopiedField("");
                  setTestComplete(false);
                }}
                className={
                  "min-h-[46px] border-[#cfe1f6] px-3 py-3 text-[0.8rem] font-black uppercase tracking-[0.12em] transition first:border-l-0 sm:border-l " +
                  (selected ? "bg-[#176bff] text-white shadow-[0_12px_28px_-20px_rgba(23,107,255,0.95)]" : "bg-white text-[#475569] hover:bg-[#eef6ff] hover:text-[#176bff]")
                }
                aria-pressed={selected}
              >
                {providerName}
              </button>
            );
          })}
        </div>

        <div className="grid gap-3 border-x border-b border-[#cfe1f6] bg-[#fbfdff] p-3 lg:grid-cols-[0.84fr_1.22fr_1fr]">
          <section className="rounded-[10px] border border-[#cfe1f6] bg-white p-4 shadow-[0_18px_40px_-34px_rgba(15,23,42,0.28)]">
            <p className="text-[0.66rem] font-black uppercase tracking-[0.14em] text-[#176bff]">Your My AI PA number</p>
            <div className="mt-4 flex items-center gap-3">
              <span className="text-[#176bff]">
                <HeroIcon type="phone" className="h-7 w-7" />
              </span>
              <p className="whitespace-nowrap text-[clamp(1.05rem,1.55vw,1.28rem)] font-black tracking-[-0.035em] text-[#07142a]">{displayNumber}</p>
            </div>
            <button
              type="button"
              onClick={() => copyToClipboard(copyNumber, "number")}
              className="mt-4 inline-flex min-h-[42px] w-full items-center justify-center gap-2 rounded-[8px] border-2 border-[#176bff] bg-white px-3 text-[0.75rem] font-black uppercase tracking-[0.1em] text-[#176bff] transition hover:bg-[#eef6ff]"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <rect x="8" y="8" width="11" height="12" rx="2" />
                <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h2" />
              </svg>
              {copiedField === "number" ? "Copied" : "Copy number"}
            </button>
            <p className="mt-4 text-[0.78rem] font-medium leading-5 text-[#475569]">
              We insert this number into your forwarding code automatically.
            </p>
          </section>

          <section className="rounded-[10px] border border-[#cfe1f6] bg-white p-4 shadow-[0_18px_40px_-34px_rgba(15,23,42,0.28)]">
            <p className="text-[0.86rem] font-black uppercase tracking-[0.08em] text-[#176bff]">{providerDetails.title}</p>
            <p className="mt-1 text-[0.66rem] font-black uppercase tracking-[0.1em] text-[#176bff]">{providerDetails.subtitle}</p>
            <ol className="mt-4 space-y-2 text-[0.82rem] font-medium leading-5 text-[#172033]">
              {providerDetails.steps.map((step, stepIndex) => (
                <li key={step} className="grid grid-cols-[20px_1fr] gap-2">
                  <span className="font-black">{stepIndex + 1}.</span>
                  {providerDetails.code && stepIndex === 1 ? (
                    <span className="flex min-w-0 items-center gap-2">
                      <span>Dial</span>
                      <code className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap rounded-[6px] border border-[#9fc5ff] bg-[#f8fbff] px-2 py-1 text-[0.75rem] font-black text-[#07142a]">
                        {providerDetails.code}
                      </code>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(providerDetails.code, "code")}
                        className="shrink-0 text-[#176bff] transition hover:text-[#0b4fc8]"
                        aria-label="Copy ready-to-dial forwarding code"
                      >
                        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                          <rect x="8" y="8" width="11" height="12" rx="2" />
                          <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h2" />
                        </svg>
                      </button>
                    </span>
                  ) : (
                    <span>{step}</span>
                  )}
                </li>
              ))}
            </ol>
            {providerDetails.code ? (
              <button
                type="button"
                onClick={() => copyToClipboard(providerDetails.code, "code")}
                className="mt-4 inline-flex min-h-[42px] w-full items-center justify-center gap-2 rounded-[8px] border-2 border-[#176bff] bg-white px-3 text-[0.7rem] font-black uppercase tracking-[0.08em] text-[#176bff] transition hover:bg-[#eef6ff]"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <rect x="8" y="8" width="11" height="12" rx="2" />
                  <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h2" />
                </svg>
                {copiedField === "code" ? "Code copied" : "Copy ready-to-dial code"}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => copyToClipboard(copyNumber, "number")}
                className="mt-4 inline-flex min-h-[42px] w-full items-center justify-center rounded-[8px] border-2 border-[#176bff] bg-white px-3 text-[0.7rem] font-black uppercase tracking-[0.08em] text-[#176bff] transition hover:bg-[#eef6ff]"
              >
                {copiedField === "number" ? "Number copied" : "Copy My AI PA number"}
              </button>
            )}
          </section>

          <section className="flex flex-col rounded-[10px] border border-[#cfe1f6] bg-white p-4 shadow-[0_18px_40px_-34px_rgba(15,23,42,0.28)]">
            <p className="text-center text-[0.82rem] font-black uppercase tracking-[0.1em] text-[#15803d]">Final check</p>
            <span className="mx-auto mt-3 grid h-10 w-10 place-items-center rounded-full border-2 border-[#16a34a] text-[#16a34a]">
              <HeroIcon type="check" className="h-6 w-6" />
            </span>
            <p className="mt-4 flex-1 text-[0.84rem] font-medium leading-5 text-[#172033]">
              Call your business number and let it ring unanswered. My AI PA should answer.
            </p>
            <p className="mt-3 text-center text-[0.78rem] font-black leading-5 text-[#176bff]">
              Problems? Call our customer support at <a href="tel:+12495033301" className="whitespace-nowrap underline decoration-2 underline-offset-2">(249) 503-3301</a>
            </p>
            <button
              type="button"
              onClick={() => setTestComplete((complete) => !complete)}
              className={
                "mt-4 inline-flex min-h-[46px] w-full items-center justify-center rounded-[8px] px-3 text-[0.72rem] font-black uppercase tracking-[0.08em] text-white shadow-[0_16px_34px_-24px_rgba(255,106,0,0.92)] transition hover:-translate-y-0.5 " +
                (testComplete ? "bg-[#15803d]" : "bg-[linear-gradient(180deg,#ff8b1f,#ff6b00)]")
              }
            >
              {testComplete ? "Test completed" : "I completed the test"}
            </button>
          </section>
        </div>

        <div className="grid gap-2 rounded-b-[10px] border-x border-b border-[#cfe1f6] bg-white px-3 py-3 text-[0.73rem] font-semibold leading-5 text-[#475569] sm:grid-cols-3 sm:divide-x sm:divide-[#d8e7fb]">
          <p className="flex items-center gap-2 sm:px-3">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#e8f9ef] text-[#15803d]">
              <HeroIcon type="shield" className="h-4 w-4" />
            </span>
            {providerDetails.offText}
          </p>
          <p className="flex items-center gap-2 sm:px-3">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#eef6ff] font-black text-[#176bff]">i</span>
            {providerDetails.sourceText}
          </p>
        </div>
      </div>
    </div>
  );
}

function MobileSideMenu({ open, onClose, onSignup }) {
  const scrollToSection = (sectionId) => {
    onClose();
    window.setTimeout(() => {
      document.getElementById(sectionId)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  };

  const productLinks = [
    ["How it works", "mobile-how-it-works", "phone"],
    ["Pricing", "mobile-pricing", "dollar"],
    ["Easy setup", "mobile-easy-setup", "check"],
    ["Common questions", "mobile-common-questions", "faq"],
  ];
  const audienceLinks = [
    ["Electricians", "#/trades/electricians", "bolt"],
    ["Plumbing", "#/trades/plumbers", "faucet"],
    ["Heating & cooling", "#/trades/hvac", "fan"],
    ["Roofing", "#/trades/roofers", "home"],
    ["General contractors", "#/trades/general-contractors", "briefcase"],
    ["Property managers & landlords", "#/demo/first-class-rentals", "property"],
  ];

  return (
    <div className={`fixed inset-0 z-[100] sm:hidden ${open ? "pointer-events-auto" : "pointer-events-none"}`} aria-hidden={!open}>
      <style>{`
        @keyframes mobileMenuSignalTravel {
          0% { left: 8%; opacity: 0; }
          12% { opacity: 1; }
          88% { opacity: 1; }
          100% { left: 88%; opacity: 0; }
        }
        @keyframes mobileMenuLivePulse {
          0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(35, 211, 107, 0.5); }
          50% { transform: scale(1.08); box-shadow: 0 0 0 6px rgba(35, 211, 107, 0); }
        }
        .mobile-menu-signal-dot { animation: mobileMenuSignalTravel 2.8s ease-in-out infinite; }
        .mobile-menu-live-dot { animation: mobileMenuLivePulse 1.8s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .mobile-menu-signal-dot, .mobile-menu-live-dot { animation: none !important; }
          .mobile-menu-signal-dot { left: 50%; opacity: 1; }
        }
      `}</style>
      <button
        type="button"
        aria-label="Close navigation"
        onClick={onClose}
        className={`absolute inset-0 bg-[#06101f]/60 backdrop-blur-[2px] transition-opacity duration-300 ${open ? "opacity-100" : "opacity-0"}`}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Mobile navigation"
        className={`absolute inset-y-0 right-0 flex w-[min(92vw,390px)] flex-col overflow-hidden border-l border-white/10 bg-[#07182d] text-white shadow-[-28px_0_70px_-35px_rgba(0,0,0,0.8)] transition-transform duration-300 ease-out ${open ? "translate-x-0" : "translate-x-full"}`}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-5 py-4">
          <div className="rounded-xl bg-white px-3 py-2 shadow-sm"><HeroLogoMark /></div>
          <button type="button" onClick={onClose} aria-label="Close menu" className="grid h-11 w-11 place-items-center rounded-full border border-white/15 bg-white/[0.07] text-2xl font-light text-white transition hover:bg-white/[0.12]">×</button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-36 pt-4">
          <div className="overflow-hidden rounded-[20px] border border-[#2a6fb2]/55 bg-[radial-gradient(circle_at_82%_18%,rgba(33,135,255,0.28),transparent_34%),linear-gradient(145deg,#0b2a4d,#091d36)] shadow-[0_20px_46px_-30px_rgba(42,148,255,0.9)]">
            <div className="flex items-center justify-between px-4 pt-3.5">
              <span className="inline-flex items-center gap-2 text-[0.62rem] font-black uppercase tracking-[0.15em] text-[#a8d5ff]"><i className="mobile-menu-live-dot h-2 w-2 rounded-full bg-[#23d36b]" />24/7 call rescue</span>
              <span className="rounded-full border border-[#ff8a22]/40 bg-[#ff7a00]/15 px-2 py-1 text-[0.56rem] font-black uppercase tracking-[0.12em] text-[#ffad63]">Live</span>
            </div>
            <div className="px-4 pt-2">
              <strong className="block text-[1.12rem] font-black tracking-[-0.035em] text-white">Your calls. Answered.</strong>
              <span className="mt-0.5 block text-[0.7rem] font-semibold text-[#9bb9d5]">Watch one missed call become an owner-ready lead.</span>
            </div>
            <div className="relative mx-4 mt-3 grid grid-cols-3 items-center gap-2">
              <div className="absolute left-[12%] right-[12%] top-4 h-px bg-[linear-gradient(90deg,#217ff0,#55c7ff,#ff8a22)] opacity-60" />
              <i className="mobile-menu-signal-dot absolute top-[0.8rem] z-10 h-2 w-2 rounded-full bg-white shadow-[0_0_14px_4px_rgba(86,199,255,0.8)]" />
              {[
                ["phone", "Caller"],
                ["headset", "My AI PA"],
                ["sms", "Owner text"],
              ].map(([icon, label], index) => (
                <span key={label} className="relative z-20 flex flex-col items-center gap-1.5 text-center">
                  <b className={`grid h-8 w-8 place-items-center rounded-full border text-white ${index === 1 ? "border-[#5bc9ff] bg-[#176bff] shadow-[0_0_20px_-5px_rgba(64,180,255,1)]" : index === 2 ? "border-[#ff9c46] bg-[#d95b00]" : "border-white/20 bg-[#123a64]"}`}><HeroIcon type={icon} className="h-4 w-4" /></b>
                  <small className="text-[0.56rem] font-black uppercase tracking-[0.08em] text-[#b9d4ec]">{label}</small>
                </span>
              ))}
            </div>
            <a href="tel:+12495033301" className="mx-3 mb-3 mt-3 flex min-h-[48px] items-center justify-between rounded-xl bg-white px-3.5 text-[#07182d] shadow-sm">
              <span className="flex items-center gap-2.5"><b className="grid h-8 w-8 place-items-center rounded-lg bg-[#176bff] text-white"><HeroIcon type="phone" className="h-4 w-4" /></b><span><small className="block text-[0.54rem] font-black uppercase tracking-[0.12em] text-[#61758a]">Try it live</small><strong className="block text-[0.9rem] tracking-[-0.02em]">(249) 503-3301</strong></span></span>
              <span className="text-lg font-black text-[#ff6a00]">→</span>
            </a>
          </div>

          <section className="mt-7">
            <h2 className="px-2 text-[0.68rem] font-black uppercase tracking-[0.18em] text-[#7898b7]">Product</h2>
            <div className="mt-2 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035]">
              {productLinks.map(([label, sectionId, icon], index) => (
                <button key={label} type="button" onClick={() => scrollToSection(sectionId)} className={`flex min-h-[54px] w-full items-center gap-3 px-4 text-left text-[0.9rem] font-bold text-[#eaf4ff] transition hover:bg-white/[0.06] ${index ? "border-t border-white/[0.07]" : ""}`}>
                  <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#123a64] text-[#63b7ff]"><HeroIcon type={icon} className="h-4 w-4" /></span>
                  <span className="flex-1">{label}</span><span className="text-lg text-[#6f8daa]">›</span>
                </button>
              ))}
            </div>
          </section>

          <section className="mt-7">
            <div className="flex items-end justify-between px-2">
              <h2 className="text-[0.68rem] font-black uppercase tracking-[0.18em] text-[#7898b7]">Audiences</h2>
              <a href="#/trades" onClick={onClose} className="text-[0.7rem] font-black text-[#66b7ff]">View all</a>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {audienceLinks.map(([label, href, icon]) => (
                <a key={label} href={href} onClick={onClose} className={`flex min-h-[58px] items-center gap-2.5 rounded-xl border px-3 py-2.5 text-[0.76rem] font-black leading-tight transition ${label.startsWith("Property") ? "col-span-2 border-[#7458d8]/55 bg-[#291f57]/70 text-[#e8e1ff]" : "border-white/10 bg-white/[0.035] text-[#eaf4ff] hover:bg-white/[0.07]"}`}>
                  <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${label.startsWith("Property") ? "bg-[#6d4ce8] text-white" : "bg-[#123a64] text-[#63b7ff]"}`}><HeroIcon type={icon} className="h-4 w-4" /></span>
                  {label}
                </a>
              ))}
            </div>
          </section>

          <section className="mt-7">
            <h2 className="px-2 text-[0.68rem] font-black uppercase tracking-[0.18em] text-[#7898b7]">Resources</h2>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <a href="#/try-demo" onClick={onClose} className="flex min-h-[54px] items-center justify-center rounded-xl border border-white/10 bg-white/[0.035] px-3 text-center text-[0.8rem] font-black text-[#eaf4ff]">Try the demo</a>
              <button type="button" onClick={() => scrollToSection("customer-proof")} className="min-h-[54px] rounded-xl border border-white/10 bg-white/[0.035] px-3 text-[0.8rem] font-black text-[#eaf4ff]">Customer proof</button>
            </div>
          </section>
        </div>

        <div className="absolute inset-x-0 bottom-0 border-t border-white/10 bg-[#07182d]/95 p-4 backdrop-blur-xl">
          <div className="grid gap-2">
            <a href="#/dashboard" onClick={onClose} className="inline-flex min-h-[48px] items-center justify-center rounded-xl border border-white/15 bg-white/[0.04] text-[0.86rem] font-black text-white">Owner sign in</a>
            <button type="button" onClick={() => { onClose(); onSignup(); }} className="inline-flex min-h-[52px] items-center justify-center rounded-xl bg-[linear-gradient(180deg,#ff7a00,#ff6500)] px-4 text-[0.92rem] font-black text-white shadow-[0_14px_34px_-20px_rgba(255,106,0,0.85)]">Start your 14-day free trial</button>
          </div>
        </div>
      </aside>
    </div>
  );
}

function MobileScrollCallStory({ onHearDemo, audioPlaying }) {
  const storyRef = useRef(null);
  const [revealedSteps, setRevealedSteps] = useState(() => new Set([0]));
  const [audienceType, setAudienceType] = useState("trades");
  const [activeTradeSlug, setActiveTradeSlug] = useState(tradePageOrder[0]);
  const [activePropertyCallId, setActivePropertyCallId] = useState("maintenance");

  const propertyCallOptions = [
    {
      id: "maintenance",
      label: "Maintenance",
      icon: "property",
      accent: "#6d4ce8",
      caller: propertyManagementAudience.scenario.caller,
      assistant: propertyManagementAudience.scenario.assistant,
      owner: propertyManagementAudience.scenario.owner,
      customer: "Thanks. Your maintenance request has been recorded for the property manager to review.",
    },
    {
      id: "rental",
      label: "Rental inquiry",
      icon: "home",
      accent: "#7c5cf0",
      caller: "I'm looking for a room near Fairview Mall for September.",
      assistant: "I can take your details so the property manager can confirm what is available. May I have your name, callback number, move-in date, and preferred viewing time?",
      owner: "RENTAL INQUIRY · Room near Fairview Mall · September move-in · Weekday-afternoon viewing preferred · Callback details captured",
      customer: "Thanks. Your rental request has been recorded and the property manager will confirm availability.",
    },
    {
      id: "application",
      label: "Application help",
      icon: "clipboard",
      accent: "#6241d8",
      caller: "I need the application link for the Geneva Street room.",
      assistant: "I can help with the next step. I'll record the property you are applying for without collecting sensitive identification by phone.",
      owner: "APPLICATION REQUEST · Geneva Street room · Secure application link requested · No sensitive information collected",
      customer: "Thanks. Your application-link request has been recorded for follow-up.",
    },
  ];

  const activeTrade = tradePages[activeTradeSlug] || tradePages[tradePageOrder[0]];
  const activePropertyCall =
    propertyCallOptions.find((option) => option.id === activePropertyCallId) || propertyCallOptions[0];
  const isPropertyManagement = audienceType === "property-management";
  const activeCall = isPropertyManagement
    ? activePropertyCall
    : {
        id: activeTradeSlug,
        label: activeTrade.label,
        icon: activeTrade.icon,
        accent: activeTrade.accent,
        caller: activeTrade.scenario.caller,
        assistant: activeTrade.scenario.assistant,
        owner: activeTrade.scenario.owner,
        customer: "Thanks. Your service request has been recorded and the business will follow up shortly.",
      };

  const storySteps = [
    {
      label: "Caller",
      tone: "caller",
      title: "Customer calls",
      text: activeCall.caller,
    },
    {
      label: "My AI PA",
      tone: "assistant",
      title: "My AI PA answers",
      text: activeCall.assistant,
    },
    {
      label: "Ready for follow-up",
      tone: "delivered",
      title: "Job details delivered",
      owner: activeCall.owner,
      customer: activeCall.customer,
    },
  ];

  useEffect(() => {
    const root = storyRef.current;
    if (!root || typeof IntersectionObserver === "undefined") return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const index = Number(entry.target.getAttribute("data-story-step"));
          setRevealedSteps((current) => {
            if (current.has(index)) return current;
            const next = new Set(current);
            for (let stepIndex = 0; stepIndex <= index; stepIndex += 1) next.add(stepIndex);
            return next;
          });
        });
      },
      { threshold: 0.22, rootMargin: "0px 0px -10% 0px" }
    );

    root.querySelectorAll("[data-story-step]").forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, []);

  const furthestStep = Math.max(...Array.from(revealedSteps));
  const progress = storySteps.length > 1 ? (furthestStep / (storySteps.length - 1)) * 100 : 100;

  return (
    <div ref={storyRef} className="mobile-scroll-story">
      <div className="rounded-[28px] border border-[#c5dcf2] bg-white px-4 py-6 shadow-[0_28px_70px_-48px_rgba(14,68,130,0.62)] sm:px-7 sm:py-9 lg:px-10">
        <div className="px-1 text-center">
          <p className="text-[0.68rem] font-black uppercase tracking-[0.17em] text-[#f06a00] sm:text-[0.78rem]">02 · Built for Canadian service businesses</p>
          <h2 className="mx-auto mt-2.5 max-w-[350px] text-[2.15rem] font-black leading-[0.96] tracking-[-0.055em] text-[#07142a] sm:max-w-[760px] sm:text-[3rem] lg:text-[3.65rem]">Choose the call you want to see.</h2>
          <p className="mx-auto mt-3 max-w-[340px] text-[0.92rem] font-semibold leading-6 text-[#526277] sm:max-w-[680px] sm:text-[1.08rem] sm:leading-8">Pick your audience, then watch one real-world request move from first ring to ready follow-up.</p>
        </div>

        <div className="mx-auto mt-5 grid max-w-[760px] grid-cols-2 gap-1.5 rounded-[16px] border border-[#c4daf0] bg-[#f4f8fc] p-1.5" aria-label="Choose your audience">
          <button
            type="button"
            onClick={() => setAudienceType("trades")}
            aria-pressed={!isPropertyManagement}
            className={"min-h-[48px] rounded-[12px] px-3 text-[0.78rem] font-black transition " + (!isPropertyManagement ? "bg-[#176bff] text-white shadow-[0_12px_24px_-18px_rgba(23,107,255,0.95)]" : "text-[#17395f]")}
          >
            Trades
          </button>
          <button
            type="button"
            onClick={() => setAudienceType("property-management")}
            aria-pressed={isPropertyManagement}
            className={"min-h-[48px] rounded-[12px] px-2 text-[0.7rem] font-black leading-tight transition " + (isPropertyManagement ? "bg-[#6d4ce8] text-white shadow-[0_12px_24px_-18px_rgba(109,76,232,0.95)]" : "text-[#17395f]")}
          >
            Property Managers &amp; Landlords
          </button>
        </div>

        <p className="mt-5 text-[0.64rem] font-black uppercase tracking-[0.15em] text-[#5b7189] sm:text-center">Choose a call</p>
        <div className="-mx-1 mt-2 overflow-x-auto px-1 pb-2" aria-label="Choose the call example">
          <div className="flex min-w-max gap-2">
            {(isPropertyManagement
              ? propertyCallOptions
              : tradePageOrder.map((slug) => ({
                  id: slug,
                  label: tradePages[slug].label,
                  icon: tradePages[slug].icon,
                  accent: tradePages[slug].accent,
                }))
            ).map((option) => {
              const selected = isPropertyManagement
                ? option.id === activePropertyCallId
                : option.id === activeTradeSlug;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => {
                    if (isPropertyManagement) setActivePropertyCallId(option.id);
                    else setActiveTradeSlug(option.id);
                  }}
                  aria-pressed={selected}
                  className={"inline-flex min-h-[48px] items-center gap-2 rounded-full border px-3.5 text-[0.76rem] font-black transition " + (selected ? "border-[#176bff] bg-[#eaf4ff] text-[#0c5fc3] shadow-[0_12px_26px_-22px_rgba(23,107,255,0.8)]" : "border-[#cfdfef] bg-white text-[#405a74]")}
                >
                  <span
                    className="grid h-7 w-7 place-items-center rounded-full text-white"
                    style={{ background: option.accent }}
                    aria-hidden="true"
                  >
                    <HeroIcon type={option.icon} className="h-3.5 w-3.5" />
                  </span>
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mx-auto mt-7 max-w-[920px] px-1 text-center sm:mt-10">
        <p className="text-[0.68rem] font-black uppercase tracking-[0.17em] text-[#176bff]">From missed call to ready opportunity</p>
        <h3 className="mx-auto mt-2 max-w-[350px] text-[1.75rem] font-black leading-[1] tracking-[-0.045em] text-[#07142a]">
          Watch one {activeCall.label.toLowerCase()} call from start to finish.
        </h3>
      </div>

      <div className="relative mx-auto mt-6 max-w-[920px] sm:mt-8">
        <div className="absolute bottom-24 left-[17px] top-12 w-[3px] overflow-hidden rounded-full bg-[#d6e8fb]" aria-hidden="true">
          <span
            className="block w-full rounded-full bg-[linear-gradient(180deg,#1d8cff,#19b878)] transition-[height] duration-700 ease-out"
            style={{ height: `${progress}%` }}
          />
        </div>

        <div className="space-y-5" aria-live="polite">
          {storySteps.map((step, index) => {
            const visible = revealedSteps.has(index);
            const isCaller = step.tone === "caller";
            const isDelivered = step.tone === "delivered";
            return (
              <article
                id={`how-it-works-step-${index + 1}`}
                key={`${step.label}-${step.title}`}
                data-story-step={index}
                className="relative scroll-mt-24 pl-10"
              >
                <span
                  className={
                    "absolute left-[7px] top-6 z-10 grid h-[23px] w-[23px] place-items-center rounded-full border-[3px] border-[#edf6ff] shadow-[0_6px_18px_-8px_rgba(15,23,42,0.65)] transition duration-500 " +
                    (visible ? "scale-100 bg-[#1689ef]" : "scale-75 bg-[#b9cde3]")
                  }
                  aria-hidden="true"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-white" />
                </span>

                <div
                  className={
                    "transition-all duration-700 ease-out " +
                    (visible ? "translate-y-0 opacity-100" : "translate-y-8 opacity-25")
                  }
                >
                  <p className="mb-2 text-[0.68rem] font-black uppercase tracking-[0.15em] text-[#4d627c]">{String(index + 1).padStart(2, "0")} · {step.title}</p>
                  <div
                    className={
                      "overflow-hidden rounded-[22px] border px-4 py-4 shadow-[0_22px_50px_-34px_rgba(7,20,42,0.58)] " +
                      (isDelivered
                        ? "border-[#bfe1cb] bg-[#f7fffa]"
                        : isCaller
                          ? "ml-7 border-[#167fe8] bg-[#1689ef] text-white"
                          : "mr-4 border-[#254666] bg-[#0b2949] text-white")
                    }
                  >
                    {isDelivered ? (
                      <>
                        <div className="flex items-center gap-2.5">
                          <span className="grid h-9 w-9 place-items-center rounded-full bg-[#2587f5] text-[0.64rem] font-black text-white">PA</span>
                          <div>
                            <p className="text-[0.86rem] font-black text-[#07142a]">Owner receives the details</p>
                            <p className="text-[0.66rem] font-bold text-[#7a8798]">My AI PA · now</p>
                          </div>
                        </div>
                        <p className="mt-3 rounded-[16px_16px_16px_5px] bg-[#e9e9eb] px-3.5 py-3 text-[0.8rem] font-bold leading-5 text-[#111]">{step.owner}</p>
                        <div className="my-3 h-px bg-[#dce9e1]" />
                        <p className="text-[0.64rem] font-black uppercase tracking-[0.13em] text-[#198c4d]">Customer confirmation</p>
                        <p className="ml-6 mt-2 rounded-[16px_16px_5px_16px] bg-[#1689ef] px-3.5 py-3 text-[0.8rem] font-bold leading-5 text-white">{step.customer}</p>
                      </>
                    ) : (
                      <>
                        <p className={"text-[0.66rem] font-black uppercase tracking-[0.15em] " + (isCaller ? "text-[#dff1ff]" : "text-[#72d7ff]")}>{step.label}</p>
                        <p className="mt-2 text-[0.94rem] font-black leading-[1.45]">{step.text}</p>
                      </>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </div>

      <div id="how-it-works-complete" className="relative z-10 mx-auto mt-5 max-w-[920px] scroll-mt-24 rounded-[24px] border border-[#bfe7ce] bg-[#effcf4] px-5 py-6 text-center shadow-[0_22px_50px_-34px_rgba(21,128,61,0.4)] sm:px-8 sm:py-8">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[#19a45b] text-white">
          <HeroIcon type="check" className="h-6 w-6" />
        </span>
        <p className="mt-3 text-[1.3rem] font-black tracking-[-0.03em] text-[#0c6d3a]">One call. Ready for follow-up.</p>
        <p className="mt-2 text-[0.9rem] font-semibold leading-6 text-[#3d6550]">You receive the problem, contact details, location, and timing without chasing voicemail.</p>
        <div className="mt-5 grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={onHearDemo}
            className="inline-flex min-h-[52px] items-center justify-center rounded-[14px] border-2 border-[#176bff] bg-white px-3 text-[0.83rem] font-black text-[#176bff]"
          >
            {audioPlaying ? "Pause real call" : "Hear real call"}
          </button>
          <a
            href="#/signup"
            className="inline-flex min-h-[52px] items-center justify-center rounded-[14px] bg-[linear-gradient(180deg,#ff7a00,#ff6500)] px-3 text-center text-[0.83rem] font-black text-white shadow-[0_14px_28px_-20px_rgba(255,106,0,0.88)]"
          >
            Start free trial
          </a>
        </div>
      </div>
    </div>
  );
}

export function LandingStoryIntroduction() {
  const howItWorks = [
    {
      icon: "phone",
      title: "My AI PA answers",
      text: "Your customer gets a professional greeting after three rings.",
      details: ["They are engaged in conversation and their FAQ's answered with custom answers supplied by you."],
    },
    {
      icon: "chat",
      title: "The right details are collected",
      text: "The right details are collected.",
      details: ["The reason for the call", "Job details", "Service amount", "Customer name", "Call urgent", "And call back # are all collected"],
    },
    {
      icon: "sms",
      title: "Both sides receive a text",
      text: "Caller and owner both get a text to their cellphone summarizing the details of the call.",
      details: ["Owners cell phone", "Customer's cell phone"],
    },
  ];

  return (
    <div id="landing-story-introduction">
      <section id="mobile-problem" className="scroll-mt-[88px] border-t border-[#cfe2f5] bg-white">
        <div className="mx-auto w-full max-w-[1180px] px-4 py-10 sm:px-6 sm:py-14 lg:px-8 lg:py-20">
          <p className="text-center text-[0.68rem] font-black uppercase tracking-[0.17em] text-[#d83a2f] sm:text-[0.78rem]">01 · Why it matters</p>
          <h2 className="mx-auto mt-3 max-w-[360px] text-center text-[1.95rem] font-black leading-[1.02] tracking-[-0.045em] text-[#07142a] sm:max-w-[780px] sm:text-[2.8rem] lg:text-[3.45rem]">
            Voicemail loses jobs. <span className="text-[#1d7df2]">My AI PA</span> catches them.
          </h2>
          <p className="mx-auto mt-4 max-w-[960px] text-center text-[0.94rem] font-semibold leading-6 text-[#526277] sm:text-[1.05rem] sm:leading-8">
            When you cannot get to the phone, the telephone assistant answers calls, talks with your customer, collects the job details, and texts both the business owner and caller for an easy follow-up.
          </p>

          <div className="mx-auto mt-7 grid max-w-[980px] gap-3 min-[520px]:grid-cols-2 sm:mt-9 sm:gap-5">
            <article className="rounded-[22px] border border-[#f2b8b2] bg-[#fff8f7] p-5 shadow-[0_22px_54px_-44px_rgba(184,42,32,0.5)] sm:p-6">
              <div className="flex items-center justify-between gap-3">
                <span className="rounded-full bg-[#ffe5e2] px-3 py-1 text-[0.65rem] font-black uppercase tracking-[0.13em] text-[#b82920]">Without help</span>
                <span className="grid h-10 w-10 place-items-center rounded-full bg-[#c92a20] text-white" aria-hidden="true"><HeroIcon type="phone" className="h-5 w-5 rotate-[135deg]" /></span>
              </div>
              <h3 className="mt-4 text-[1.18rem] font-black text-[#07142a]">Phone rings unanswered</h3>
              <p className="mt-2 text-[0.9rem] font-semibold leading-6 text-[#5d6572]">Three rings. No answer. The customer moves on.</p>
            </article>

            <article className="rounded-[22px] border border-[#9ed7bd] bg-[#f4fff8] p-5 shadow-[0_22px_54px_-44px_rgba(19,118,60,0.45)] sm:p-6">
              <div className="flex items-center justify-between gap-3">
                <span className="rounded-full bg-[#dcf8e7] px-3 py-1 text-[0.65rem] font-black uppercase tracking-[0.13em] text-[#13763c]">With My AI PA</span>
                <span className="grid h-10 w-10 place-items-center rounded-full bg-[#168349] text-white" aria-hidden="true"><HeroIcon type="check" className="h-5 w-5" /></span>
              </div>
              <h3 className="mt-4 text-[1.18rem] font-black text-[#07142a]">Assistant answers live</h3>
              <p className="mt-2 text-[0.9rem] font-semibold leading-6 text-[#496455]">Instantly connects with customer. Asks why they called and answers FAQ questions.</p>
            </article>
          </div>
        </div>
      </section>

      <section id="mobile-how-it-works" className="scroll-mt-[76px] border-t border-[#cfe2f5] bg-[linear-gradient(180deg,#f4f9ff_0%,#eaf4ff_100%)]">
        <div className="mx-auto w-full max-w-[1180px] px-4 py-10 sm:px-6 sm:py-14 lg:px-8 lg:py-20">
          <p className="text-center text-[0.68rem] font-black uppercase tracking-[0.17em] text-[#176bff] sm:text-[0.78rem]">02 · How it works</p>
          <h2 className="mx-auto mt-3 max-w-[355px] text-center text-[1.95rem] font-black leading-[1.02] tracking-[-0.045em] text-[#07142a] sm:max-w-[760px] sm:text-[2.8rem] lg:text-[3.4rem]">
            Three simple steps.
          </h2>
          <p className="mx-auto mt-4 flex w-fit items-center justify-center gap-2 rounded-full border border-[#9bc9ef] bg-white px-4 py-2 text-center text-[0.76rem] font-black uppercase text-[#0c5fc3] shadow-[0_12px_28px_-22px_rgba(12,95,195,0.65)] sm:text-[0.88rem]">
            <HeroIcon type="phone" className="h-4 w-4" /> Keep your same business number!
          </p>
          <div className="relative mx-auto mt-7 grid max-w-[1040px] gap-3 sm:mt-9 sm:grid-cols-3 sm:gap-5">
            {howItWorks.map((item, index) => (
              <article key={item.title} className="relative grid grid-cols-[48px_minmax(0,1fr)] gap-3 rounded-[20px] border border-[#bfd8ef] bg-white p-4 shadow-[0_22px_52px_-42px_rgba(12,77,160,0.45)] sm:block sm:min-h-[300px] sm:p-6">
                <span className="grid h-12 w-12 place-items-center rounded-[14px] bg-[#0c5fc3] text-white shadow-[0_14px_28px_-18px_rgba(12,95,195,0.85)]" aria-hidden="true"><HeroIcon type={item.icon} className="h-6 w-6" /></span>
                <div>
                  <p className="text-[0.62rem] font-black uppercase tracking-[0.14em] text-[#176bff] sm:mt-7">Step {index + 1}</p>
                  <h3 className="mt-1 text-[1rem] font-black leading-5 text-[#07142a] sm:text-[1.14rem]">{item.title}</h3>
                  <p className="mt-1.5 text-[0.84rem] font-semibold leading-5 text-[#526277] sm:mt-2 sm:text-[0.9rem] sm:leading-6">{item.text}</p>
                  <ul className="mt-3 flex flex-wrap gap-1.5" aria-label={`${item.title} includes`}>
                    {item.details.map((detail) => (
                      <li key={detail} className="rounded-full border border-[#c4ddf2] bg-[#eff7ff] px-2.5 py-1 text-[0.64rem] font-black leading-4 text-[#17466f]">{detail}</li>
                    ))}
                  </ul>
                </div>
              </article>
            ))}
          </div>
          <div className="mx-auto mt-7 max-w-[1040px] rounded-[22px] border border-[#9bc9ef] bg-[#0b2646] p-4 text-white shadow-[0_28px_68px_-46px_rgba(7,35,70,0.85)] sm:p-6">
            <p className="mx-auto max-w-[800px] text-center text-[0.78rem] font-black uppercase leading-5 tracking-[0.07em] text-[#8edfff] sm:text-[0.96rem]">
              Caller and owner both get a text to their cellphone summarizing the details of the call
            </p>
            <div className="mt-5 grid gap-5 sm:grid-cols-2 sm:gap-6">
              <article className="landing-how-phone mx-auto w-full max-w-[420px] rounded-[2.2rem] border-[7px] border-[#07111f] bg-white p-4 text-[#111827] shadow-[0_20px_44px_-28px_rgba(0,0,0,0.85)] sm:p-5">
                <div className="flex items-center justify-between text-[0.62rem] font-black text-[#475569]"><span>9:41</span><span className="h-2 w-16 rounded-full bg-[#101827]" /><span>5G</span></div>
                <div className="mt-3 border-b border-[#d8dee7] pb-3">
                  <strong className="block text-[1rem] font-black text-[#0b315a]">Owners cell phone</strong>
                  <small className="font-bold text-[#718096]">My AI PA · now</small>
                </div>
                <div className="mt-4 rounded-[1rem_1rem_1rem_0.35rem] bg-[#e9e9eb] p-4 text-[0.82rem] font-bold leading-6 sm:text-[0.9rem]">
                  <p className="font-black">New installation</p>
                  <p>Hot tub wiring</p>
                  <p>Brian Smith</p>
                  <p>23 Robb St., Hamilton</p>
                  <p>905-555-1234</p>
                  <p><strong>Preferred start date:</strong> Next week</p>
                  <p><strong>Call back:</strong> ASAP</p>
                  <p><strong>Best call back time:</strong> After 7</p>
                </div>
              </article>

              <article className="landing-how-phone mx-auto w-full max-w-[420px] rounded-[2.2rem] border-[7px] border-[#07111f] bg-white p-4 text-[#111827] shadow-[0_20px_44px_-28px_rgba(0,0,0,0.85)] sm:p-5">
                <div className="flex items-center justify-between text-[0.62rem] font-black text-[#475569]"><span>9:41</span><span className="h-2 w-16 rounded-full bg-[#101827]" /><span>5G</span></div>
                <div className="mt-3 border-b border-[#d8dee7] pb-3">
                  <strong className="block text-[1rem] font-black text-[#0b315a]">Customer&apos;s cell phone</strong>
                  <small className="font-bold text-[#718096]">Tim&apos;s Electrical · now</small>
                </div>
                <div className="ml-auto mt-4 rounded-[1rem_1rem_0.35rem_1rem] bg-[#0a84ff] p-4 text-[0.82rem] font-bold leading-6 text-white sm:text-[0.9rem]">
                  <p className="font-black">TIM&apos;S ELECTRICAL</p>
                  <p className="mt-2">Hi.</p>
                  <p className="mt-2">Your installation request has been forwarded to team. We&apos;ll get back to you shortly to discuss job details and arrange a site visit.</p>
                  <p className="mt-3 font-black">THANKS FOR CALLING TIM&apos;S ELECTRICAL. HAVE A GREAT DAY!</p>
                </div>
              </article>
            </div>
          </div>
          <div className="mx-auto mt-5 grid max-w-[1040px] gap-2 rounded-[16px] border border-[#f4c58d] bg-[#fff9f1] px-4 py-4 text-[#704116] shadow-[0_18px_38px_-34px_rgba(180,83,9,0.45)] sm:grid-cols-[auto_1fr] sm:items-center sm:gap-4 sm:px-5">
            <strong className="text-[0.72rem] font-black uppercase tracking-[0.1em] text-[#b35a08]">Optional qualification</strong>
            <span className="text-[0.82rem] font-bold leading-5">Rates for service work can be added here followed by the question “Would you like to continue” eliminating time wasters. <small className="block pt-1 font-semibold text-[#8a5a2b]">Configured rates only. My AI PA never invents pricing.</small></span>
          </div>
          <p className="mx-auto mt-5 max-w-[760px] rounded-[14px] border border-[#b8d9f6] bg-white/80 px-4 py-3 text-center text-[0.82rem] font-black leading-5 text-[#17466f]">
            Start with unanswered or after-hours calls. Your staff and existing phone workflow stay in place.
          </p>
        </div>
      </section>
    </div>
  );
}

function LandingChapters({
  goToSignup,
  playDemo,
  openFaq,
  setOpenFaq,
}) {
  const mobileBenefits = [
    {
      icon: "phone",
      title: "Callback information",
      text: "Caller name, callback number, and the best time to reach them.",
    },
    {
      icon: "clipboard",
      title: "Job and location",
      text: "Reason for the call, requested work, service address, and city.",
    },
    {
      icon: "chat",
      title: "Timing and urgency",
      text: "Preferred start date, availability, and any urgent non-emergency concern.",
    },
    {
      icon: "sms",
      title: "Two clear handoffs",
      text: "An owner summary plus a concise confirmation for the caller.",
    },
  ];
  const mobileFaqIndexes = [1, 2, 3, 5];

  return (
    <div id="landing-chapters">
      <section id="mobile-value" className="scroll-mt-[88px] border-t border-[#cfe2f5] bg-white">
        <div className="mx-auto w-full max-w-[1180px] px-4 py-10 sm:px-6 sm:py-14 lg:px-8 lg:py-20">
          <p className="text-center text-[0.68rem] font-black uppercase tracking-[0.17em] text-[#f06a00] sm:text-[0.78rem]">04 · What you receive</p>
          <h2 className="mx-auto mt-3 max-w-[355px] text-center text-[1.8rem] font-black leading-[1.02] tracking-[-0.045em] text-[#07142a] sm:max-w-[780px] sm:text-[2.7rem] lg:text-[3.35rem]">
            The details your team needs—already organized.
          </h2>
          <div className="mt-6 grid gap-3 sm:mt-9 sm:grid-cols-2">
            {mobileBenefits.map((item) => (
              <article key={item.title} className="grid grid-cols-[46px_minmax(0,1fr)] items-center gap-3.5 rounded-[20px] border border-[#c7ddef] bg-[#f8fbff] px-4 py-4 shadow-[0_20px_48px_-42px_rgba(12,77,160,0.5)] sm:min-h-[132px] sm:grid-cols-[56px_minmax(0,1fr)] sm:gap-5 sm:px-6 sm:py-5">
                <span className="grid h-[46px] w-[46px] place-items-center rounded-[14px] bg-[linear-gradient(145deg,#27a6f3,#176bdf)] text-white shadow-[0_14px_26px_-18px_rgba(23,107,223,0.88)]" aria-hidden="true">
                  <HeroIcon type={item.icon} className="h-6 w-6" />
                </span>
                <div>
                  <h3 className="text-[0.98rem] font-black leading-5 text-[#10233e] sm:text-[1.06rem]">{item.title}</h3>
                  <p className="mt-1 text-[0.78rem] font-semibold leading-5 text-[#526277] sm:text-[0.84rem]">{item.text}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="mobile-safeguards" className="scroll-mt-[88px] border-t border-[#cfe2f5] bg-[linear-gradient(180deg,#eef7ff_0%,#e7f3ff_100%)]">
        <div className="mx-auto w-full max-w-[1180px] px-4 py-10 sm:px-6 sm:py-14 lg:px-8 lg:py-20">
          <p className="text-center text-[0.68rem] font-black uppercase tracking-[0.17em] text-[#176bff] sm:text-[0.78rem]">05 · Built around your business</p>
          <h2 className="mx-auto mt-3 max-w-[355px] text-center text-[1.9rem] font-black leading-[1.02] tracking-[-0.045em] text-[#07142a] sm:max-w-[780px] sm:text-[2.8rem] lg:text-[3.4rem]">Extra coverage without replacing the way you work.</h2>
          <div className="mt-7 grid gap-3 min-[480px]:grid-cols-2 sm:mt-9 lg:grid-cols-4">
            {[
              ["phone", "Keep your business number", "Forward only the calls you want My AI PA to answer."],
              ["check", "Start with overflow", "Use it after hours or when your team cannot pick up."],
              ["chat", "Control the answers", "Your services, service area and common answers shape the receptionist."],
              ["clipboard", "Clear, service-focused texts", "Owner summaries and customer confirmations support a proper follow-up."],
            ].map(([icon, title, body]) => (
              <article key={title} className="rounded-[18px] border border-[#c3dcef] bg-white p-5 shadow-[0_20px_48px_-40px_rgba(12,77,160,0.5)]">
                <span className="grid h-11 w-11 place-items-center rounded-[13px] bg-[#e8f3ff] text-[#0c5fc3]" aria-hidden="true"><HeroIcon type={icon} className="h-5 w-5" /></span>
                <h3 className="mt-4 text-[1rem] font-black leading-5 text-[#07142a]">{title}</h3>
                <p className="mt-2 text-[0.84rem] font-semibold leading-6 text-[#526277]">{body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="mobile-pricing" className="scroll-mt-[88px] border-t border-[#cfe2f5] bg-white">
        <div className="mx-auto w-full max-w-[1180px] px-4 py-10 sm:px-6 sm:py-14 lg:px-8 lg:py-20">
          <p className="text-center text-[0.68rem] font-black uppercase tracking-[0.17em] text-[#f06a00] sm:text-[0.78rem]">06 · Trial and pricing</p>
          <h2 className="mx-auto mt-3 max-w-[345px] text-center text-[1.9rem] font-black leading-[1.02] tracking-[-0.045em] text-[#07142a] sm:max-w-[760px] sm:text-[2.8rem] lg:text-[3.4rem]">One plan. Clear minutes. No long contract.</h2>
          <article className="mx-auto mt-6 max-w-[820px] overflow-hidden rounded-[26px] border border-[#bfd9f2] bg-[linear-gradient(145deg,#ffffff_0%,#f4f9ff_58%,#fff5e8_100%)] shadow-[0_28px_64px_-44px_rgba(12,77,160,0.55)] sm:mt-9">
            <div className="flex items-end justify-between gap-4 border-b border-[#d6e4f1] px-5 py-5">
              <div>
                <p className="text-[0.64rem] font-black uppercase tracking-[0.16em] text-[#176bff]">Essential</p>
                <p className="mt-1 text-[0.82rem] font-bold text-[#64748b]">Simple monthly plan</p>
              </div>
              <p className="text-right text-[2.75rem] font-black leading-none tracking-[-0.055em] text-[#07142a]">$79<span className="ml-1 text-[0.8rem] tracking-normal text-[#475569]">/month</span></p>
            </div>
            <div className="grid gap-3 px-5 py-5">
              {["60 AI call minutes included", "$0.25 per minute after 60 minutes", "+ applicable taxes"].map((item) => (
                <p key={item} className="flex items-center gap-3 text-[0.94rem] font-black leading-5 text-[#19324f]">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#e5f8ec] text-[#168349]" aria-hidden="true">✓</span>
                  {item}
                </p>
              ))}
            </div>
            <div className="border-t border-[#d6e4f1] bg-[#edf9f1] px-5 py-4">
              <p className="text-center text-[1rem] font-black text-[#13763c]">14-day free trial · No setup fee · Cancel anytime</p>
            </div>
            <div className="px-5 pb-5 pt-4">
              <button type="button" onClick={goToSignup} className="inline-flex min-h-[56px] w-full items-center justify-center rounded-[15px] bg-[linear-gradient(180deg,#ff7a00,#ff6500)] px-5 text-[1rem] font-black text-white shadow-[0_16px_32px_-20px_rgba(255,106,0,0.9)]">
                Start Your Free Trial
              </button>
            </div>
          </article>
        </div>
      </section>

      <section id="mobile-setup-questions" className="scroll-mt-[88px] border-t border-[#cfe2f5] bg-[linear-gradient(180deg,#f6fbff_0%,#edf6ff_100%)]">
        <div className="mx-auto w-full max-w-[1180px] px-4 py-10 sm:px-6 sm:py-14 lg:px-8 lg:py-20">
          <p className="text-center text-[0.68rem] font-black uppercase tracking-[0.17em] text-[#176bff] sm:text-[0.78rem]">07 · Setup and common questions</p>
          <h2 className="mx-auto mt-3 max-w-[350px] text-center text-[1.9rem] font-black leading-[1.02] tracking-[-0.045em] text-[#07142a] sm:max-w-[800px] sm:text-[2.8rem] lg:text-[3.4rem]">Try it before a single customer call is forwarded.</h2>
          <div id="mobile-easy-setup" className="mt-6 grid scroll-mt-[88px] gap-3 sm:mt-9 sm:grid-cols-3">
            {["Add your business and common answers", "Hear a test call in your browser", "Forward unanswered calls when you are ready"].map((item, index) => (
              <article key={item} className="grid grid-cols-[42px_minmax(0,1fr)] items-center gap-3 rounded-[16px] border border-[#cce0f4] bg-white px-4 py-4 shadow-[0_16px_38px_-34px_rgba(15,23,42,0.35)]">
                <span className="grid h-[42px] w-[42px] place-items-center rounded-full bg-[#176bff] text-[0.92rem] font-black text-white">{index + 1}</span>
                <p className="text-[0.95rem] font-black leading-5 text-[#10233e]">{item}</p>
              </article>
            ))}
          </div>

          <details className="mt-4 overflow-hidden rounded-[16px] border border-[#bcd9f4] bg-white sm:mt-5">
            <summary className="cursor-pointer list-none px-4 py-4 text-[0.94rem] font-black text-[#0c5fc3]">How unanswered-call forwarding works</summary>
            <div className="border-t border-[#d8e8f6] bg-[#f8fbff] px-4 py-4 text-[0.88rem] font-semibold leading-6 text-[#42566f]">
              Keep your business number. Choose your provider, follow the prepared steps, and send only calls you do not answer to My AI PA. You can turn it off whenever you want.
            </div>
          </details>

          <div id="mobile-common-questions" className="mt-7 scroll-mt-[88px]">
            <p className="text-[0.68rem] font-black uppercase tracking-[0.15em] text-[#64748b]">Quick answers</p>
            <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
              {mobileFaqIndexes.map((faqIndex) => {
                const item = faqs[faqIndex];
                const isOpen = openFaq === faqIndex;
                return (
                  <article key={item.q} className="overflow-hidden rounded-[14px] border border-[#cfe1f4] bg-white">
                    <button
                      type="button"
                      id={`mobile-faq-button-${faqIndex}`}
                      aria-expanded={isOpen}
                      aria-controls={`mobile-faq-panel-${faqIndex}`}
                      onClick={() => setOpenFaq(isOpen ? -1 : faqIndex)}
                      className="grid w-full grid-cols-[1fr_32px] items-center gap-3 px-4 py-4 text-left"
                    >
                      <span className="text-[0.92rem] font-black leading-5 text-[#10233e]">{item.q}</span>
                      <span className="grid h-8 w-8 place-items-center rounded-full bg-[#edf5ff] text-[1.2rem] font-black text-[#176bff]">{isOpen ? "−" : "+"}</span>
                    </button>
                    {isOpen ? <p id={`mobile-faq-panel-${faqIndex}`} role="region" aria-labelledby={`mobile-faq-button-${faqIndex}`} className="border-t border-[#d8e8f6] bg-[#f8fbff] px-4 py-4 text-[0.88rem] font-semibold leading-6 text-[#42566f]">{item.a}</p> : null}
                  </article>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <section id="mobile-final-decision" className="scroll-mt-[88px] border-t border-[#18365d] bg-[#07142a]">
        <div className="mx-auto w-full max-w-[1180px] px-4 py-11 text-white sm:px-6 sm:py-16 lg:px-8 lg:py-20">
          <p className="text-center text-[0.68rem] font-black uppercase tracking-[0.17em] text-[#81d8ff] sm:text-[0.78rem]">08 · Your decision</p>
          <h2 className="mx-auto mt-3 max-w-[355px] text-center text-[2rem] font-black leading-[1.02] tracking-[-0.045em] sm:max-w-[840px] sm:text-[3rem] lg:text-[3.65rem]">Stop letting missed calls decide where the next job goes.</h2>
          <div className="mt-6 grid gap-2.5 sm:mt-9 sm:grid-cols-3">
            {[
              ["Transparent AI calls", "Callers can be told they are speaking with an AI assistant."],
              ["Privacy and terms published", "See how calls, transcripts, and texts are handled."],
              ["Consent-aware messaging", "Owner alerts and customer confirmations stay service-focused."],
            ].map(([title, body]) => (
              <article key={title} className="grid grid-cols-[34px_minmax(0,1fr)] gap-3 rounded-[14px] border border-white/12 bg-white/[0.07] px-4 py-4">
                <span className="grid h-[34px] w-[34px] place-items-center rounded-full bg-[#168349] text-sm font-black">✓</span>
                <div>
                  <p className="text-[0.94rem] font-black">{title}</p>
                  <p className="mt-1 text-[0.78rem] font-semibold leading-5 text-[#cbdcf0]">{body}</p>
                </div>
              </article>
            ))}
          </div>
          <div className="mx-auto mt-6 grid max-w-[760px] gap-3 sm:grid-cols-2">
            <button type="button" onClick={goToSignup} className="inline-flex min-h-[58px] items-center justify-center rounded-[15px] bg-[linear-gradient(180deg,#ff7a00,#ff6500)] px-5 text-[1rem] font-black text-white shadow-[0_18px_36px_-22px_rgba(255,106,0,0.95)]">Start Your Free Trial</button>
            <button type="button" onClick={playDemo} className="inline-flex min-h-[54px] items-center justify-center rounded-[15px] border border-[#6cb8ff] bg-[#0d3159] px-5 text-[0.96rem] font-black text-white">See a Sample Call</button>
          </div>
          <div className="mt-5 flex items-center justify-center gap-5 text-[0.75rem] font-bold text-[#b9cee5]">
            <a href="/privacy.html" className="underline decoration-white/35 underline-offset-4">Privacy</a>
            <a href="/terms.html" className="underline decoration-white/35 underline-offset-4">Terms</a>
            <a href="mailto:hello@myaipa.com" className="underline decoration-white/35 underline-offset-4">Contact</a>
          </div>
          <p className="mx-auto mt-6 max-w-[760px] text-center text-[0.72rem] font-semibold leading-5 text-[#8fa8c1]">Built in Ontario for busy Canadian service businesses across Hamilton, Grimsby, and the surrounding area.</p>
        </div>
      </section>
    </div>
  );
}

function LandingPage() {
  const demoRef = useRef(null);
  const landingDemoRef = useRef(null);
  const pricingRef = useRef(null);
  const faqRef = useRef(null);
  const audioRef = useRef(null);
  const heroOwnerCardRef = useRef(null);

  const [audioPlaying, setAudioPlaying] = useState(false);
  const [audioTime, setAudioTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(heroTranscriptTimings.durationSeconds);
  const [audioError, setAudioError] = useState("");
  const [heroDemoRevealed, setHeroDemoRevealed] = useState(false);
  const [heroDemoHasTransitioned, setHeroDemoHasTransitioned] = useState(false);
  const [openFaq, setOpenFaq] = useState(-1);
  const [showHeader, setShowHeader] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    document.title = "My AI PA | AI Telephone Answering Assistant";
  }, []);

  useEffect(() => {
    if (!mobileMenuOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event) => {
      if (event.key === "Escape") setMobileMenuOpen(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [mobileMenuOpen]);

  useEffect(() => {
    const section = new URLSearchParams(window.location.search).get("section");
    if (!section) return undefined;
    const timer = window.setTimeout(() => {
      document.getElementById(section)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 250);
    return () => window.clearTimeout(timer);
  }, []);

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
    audio?.pause();
    setAudioPlaying(false);
    setAudioError("");
    scrollToRef(landingDemoRef);
  };

  const toggleAudio = async () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (audio.paused) {
      try {
        setAudioError("");
        if (audio.ended || audio.currentTime >= Math.max(0, audio.duration - 0.05)) {
          audio.currentTime = 0;
          setAudioTime(0);
        }
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

  const revealHeroDemo = async () => {
    const audio = audioRef.current;
    setHeroDemoHasTransitioned(true);
    setHeroDemoRevealed(true);
    setAudioError("");
    if (!audio) return;

    try {
      audio.currentTime = 0;
      setAudioTime(0);
      await audio.play();
      setAudioPlaying(true);
    } catch (_err) {
      setAudioPlaying(false);
      setAudioError("The demo audio could not start. Please press Hear call to try again.");
    }
  };

  const returnToHeroSlides = () => {
    const audio = audioRef.current;
    audio?.pause();
    if (audio) audio.currentTime = 0;
    setAudioPlaying(false);
    setAudioTime(0);
    setAudioError("");
    setHeroDemoHasTransitioned(true);
    setHeroDemoRevealed(false);
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
    if (!audioPlaying) return undefined;
    let animationFrame = 0;
    const syncAudioTime = () => {
      setAudioTime(audioRef.current?.currentTime || 0);
      animationFrame = window.requestAnimationFrame(syncAudioTime);
    };
    animationFrame = window.requestAnimationFrame(syncAudioTime);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [audioPlaying]);

  useEffect(() => {
    const onScroll = () => {
      setShowHeader(window.scrollY > 4);
    };

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <main className="landing-page-main min-h-screen bg-[linear-gradient(180deg,#ffffff_0%,#f7fbff_7%,#eaf6ff_22%,#dff1ff_100%)] text-[#07142a]">
      <button
        type="button"
        onClick={() => setMobileMenuOpen(true)}
        aria-label="Open navigation menu"
        aria-expanded={mobileMenuOpen}
        className="fixed right-3 top-3 z-[90] grid h-12 w-12 place-items-center rounded-full border border-[#b8d4ee] bg-white/95 text-[#07142a] shadow-[0_12px_32px_-18px_rgba(7,20,42,0.72)] backdrop-blur sm:hidden"
      >
        <span className="grid gap-1" aria-hidden="true"><i className="block h-0.5 w-5 rounded-full bg-current" /><i className="block h-0.5 w-5 rounded-full bg-current" /><i className="block h-0.5 w-5 rounded-full bg-current" /></span>
      </button>
      <MobileSideMenu open={mobileMenuOpen} onClose={() => setMobileMenuOpen(false)} onSignup={goToSignup} />
      <header
        style={{ backgroundColor: "#ffffff" }}
        className={
          "fixed inset-x-0 top-0 z-40 hidden border-b border-[#c9ddf2] shadow-[0_12px_32px_-26px_rgba(7,20,42,0.62)] transition-all duration-300 sm:block " +
          (showHeader ? "translate-y-0 opacity-100" : "pointer-events-none -translate-y-full opacity-0")
        }
      >
        <div className="mx-auto grid w-full max-w-[1660px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-5 py-3 sm:px-8 lg:px-10 xl:gap-5">
          <HeroLogoMark />

          <div className="min-w-0 justify-self-center">
            <div className="hidden text-center lg:block min-[1180px]:hidden">
              <p className="text-xs font-black uppercase tracking-[0.14em] text-[#334155]">Hear the agent live:</p>
              <a href="tel:+12495033301" className="mt-0.5 block text-lg font-black tracking-[-0.02em] text-[#f47a00] transition hover:text-[#ff9a22]">
                (249) 503-3301
              </a>
            </div>
            <nav className="hidden items-center justify-center gap-1 min-[1180px]:flex" aria-label="Page sections">
              {[
                ["Why it matters", "#mobile-problem"],
                ["How it works", "#mobile-how-it-works"],
                ["See it work", "#mobile-scroll-call-story"],
                ["Pricing", "#mobile-pricing"],
              ].map(([label, href]) => (
                <a key={href} href={href} className="rounded-lg px-2.5 py-2 text-[0.7rem] font-black uppercase tracking-[0.055em] text-[#294967] transition hover:bg-[#edf6ff] hover:text-[#0c5fc3] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#176bff] xl:px-3 xl:text-[0.74rem]">
                  {label}
                </a>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-2.5 xl:gap-3">
            <a href="tel:+12495033301" aria-label="Call the live demo at 249-503-3301" className="hidden h-11 items-center gap-2 rounded-xl border border-[#b8d4ee] bg-[#f7fbff] px-3 text-[#0c5fc3] transition hover:border-[#6da8df] hover:bg-white min-[1180px]:inline-flex">
              <HeroIcon type="phone" className="h-5 w-5" />
              <span className="hidden whitespace-nowrap text-[0.78rem] font-black min-[1360px]:inline">249-503-3301</span>
            </a>
            <button
              type="button"
              onClick={goToSignup}
              className="whitespace-nowrap rounded-xl bg-[linear-gradient(180deg,#ff7a00,#ff6500)] px-4 py-3 text-sm font-black text-white shadow-[0_18px_42px_-24px_rgba(255,106,0,0.95)] transition hover:-translate-y-0.5 hover:brightness-110 sm:px-5 xl:text-[0.95rem] 2xl:px-6"
            >
              Start Free Trial
            </button>
          </div>
        </div>
      </header>

      <section id="homepage-hero" className="relative overflow-hidden bg-transparent">
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
          .landing-call-dashboard > div {
            height: 660px;
          }
          .landing-call-panel {
            min-height: 0;
          }
          .landing-conversation-column {
            min-height: 0;
          }
          .landing-conversation-panel {
            flex: 0 0 15.9rem;
            min-height: 0;
          }
          .landing-dashboard-bottom {
            display: flex;
            flex: 1;
            min-height: 0;
          }
          .landing-lead-stack {
            width: 100%;
            height: 100%;
            grid-template-rows: auto minmax(8.15rem, 0.74fr) minmax(9.75rem, 1.26fr);
            align-content: stretch;
          }
          .landing-lead-card,
          .landing-customer-text-card {
            display: flex;
            min-height: 0;
            flex-direction: column;
            justify-content: flex-start;
          }
          .landing-owner-text-title,
          .landing-customer-text-title {
            font-size: 1.34rem !important;
            line-height: 1.05 !important;
          }
          .landing-owner-text-body,
          .landing-customer-text-body {
            font-size: 0.88rem !important;
            line-height: 1.06 !important;
          }
          .landing-owner-text-body {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            column-gap: 1rem;
            row-gap: 0.18rem;
          }
          .landing-owner-text-body > p {
            margin-top: 0 !important;
          }
          .landing-owner-text-body > p:first-child,
          .landing-owner-text-body > p:last-child {
            grid-column: 1 / -1;
          }
          .landing-customer-text-body {
            margin-top: 0.55rem !important;
            font-size: 0.56rem !important;
            line-height: 1.08 !important;
            text-wrap: pretty;
          }
          .landing-customer-text-card {
            container-type: normal;
          }
          .landing-message-icon {
            width: 2.25rem !important;
            height: 2.25rem !important;
          }
          .landing-call-checklist-title {
            font-size: 1.04rem !important;
            line-height: 1.05 !important;
          }
          .landing-call-checklist-list {
            font-size: 1.12rem !important;
            line-height: 1.1 !important;
          }
          .landing-call-checklist-row {
            gap: 0.7rem !important;
          }
          .landing-call-checklist-icon {
            width: 1.95rem !important;
            height: 1.95rem !important;
          }
          .landing-call-checklist-check {
            width: 1.2rem !important;
            height: 1.2rem !important;
          }
          @media (min-width: 1024px) and (max-width: 1100px) {
            .pricing-plan-grid {
              grid-template-columns: minmax(0, 1.38fr) minmax(0, 0.92fr) !important;
              max-width: 100%;
            }
            .pricing-plan-grid > * {
              min-width: 0;
              max-width: 100%;
            }
            .pricing-side-column {
              grid-template-columns: minmax(0, 1fr);
            }
            .pricing-side-column > * {
              min-width: 0;
              max-width: 100%;
            }
          }
          @media (max-width: 767px) {
            .landing-hero-shell {
              padding-left: 1rem !important;
              padding-right: 1rem !important;
            }
            .landing-hero-grid {
              gap: 1.35rem !important;
            }
            .landing-hero-grid > div:first-child {
              max-width: none !important;
              width: 100% !important;
            }
            .landing-hero-footnote {
              display: block;
              width: 100%;
              font-size: clamp(0.72rem, 2.55vw, 0.88rem) !important;
              letter-spacing: -0.055em !important;
              white-space: nowrap;
            }
            .landing-call-dashboard {
              max-width: min(100%, 360px);
            }
            .landing-call-dashboard > div {
              height: auto !important;
              min-height: 0;
              border-radius: 26px;
              overflow: hidden;
            }
            .landing-call-dashboard > div > div {
              display: block !important;
              height: auto !important;
              grid-template-columns: minmax(0, 1fr);
            }
            .landing-call-panel {
              height: auto !important;
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
              max-width: 12.9rem;
              padding: 0.56rem 1rem;
              font-size: 0.92rem;
              line-height: 1.08;
              text-align: center;
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
              height: auto !important;
              min-height: 0;
              padding: 1.25rem;
              overflow: visible;
            }
            .landing-conversation-header {
              align-items: flex-start;
              gap: 0.65rem;
            }
            .landing-conversation-header h3 {
              font-size: 1.08rem;
              line-height: 1.08;
            }
            .landing-conversation-header span {
              flex-shrink: 0;
              font-size: 0.58rem;
              padding: 0.34rem 0.6rem;
            }
            .landing-conversation-panel {
              flex: none;
              margin-top: 0.8rem;
              border-radius: 20px;
              padding: 0.78rem;
            }
            .landing-conversation-panel > p {
              font-size: 0.62rem;
              line-height: 1;
            }
            .landing-conversation-panel div {
              max-width: 92%;
              padding: 0.58rem 0.78rem;
              font-size: 0.72rem;
              line-height: 1.12;
            }
            .landing-dashboard-bottom {
              display: block;
              flex: none;
              height: auto !important;
              margin-top: 0.95rem;
              min-height: 0;
              overflow: visible;
            }
            .landing-lead-stack {
              display: flex;
              height: auto !important;
              flex-direction: column;
              gap: 0.82rem;
              min-height: 0;
              overflow: visible;
            }
            .landing-lead-note {
              justify-content: flex-start;
              align-items: center;
              font-size: 0.78rem;
              line-height: 1.08;
              text-align: left;
            }
            .landing-lead-note svg {
              height: 1.35rem;
              width: 1.9rem;
            }
            .landing-lead-card,
            .landing-customer-text-card {
              flex: none;
              min-height: 0;
              height: auto;
              border-radius: 18px;
              padding: 0.85rem;
              justify-content: flex-start;
            }
            .landing-owner-text-title,
            .landing-customer-text-title {
              font-size: 1.04rem !important;
              line-height: 1.05 !important;
            }
            .landing-owner-text-body {
              display: block;
              margin-top: 0.6rem !important;
              font-size: 0.78rem !important;
              line-height: 1.08 !important;
            }
            .landing-owner-text-body > p {
              margin-top: 0.16rem !important;
            }
            .landing-customer-text-body {
              margin-top: 0.55rem !important;
              font-size: 0.74rem !important;
              line-height: 1.1 !important;
            }
            .landing-customer-text-card {
              container-type: normal;
              contain: none;
              padding-bottom: 0.95rem;
            }
            .landing-message-icon {
              width: 1.9rem !important;
              height: 1.9rem !important;
            }
          }
          @media (min-width: 1024px) and (max-height: 900px) {
            .landing-hero-shell {
              padding-top: 1rem;
              padding-bottom: 1rem;
            }
            .landing-hero-grid {
              gap: 3rem;
              padding-top: 0.5rem;
              padding-bottom: 1rem;
            }
            .landing-hero-visual {
              margin-top: 0.45rem;
            }
            .landing-hero-title {
              font-size: clamp(3.1rem, 3.47vw, 3.94rem);
              line-height: 1.03;
            }
            .landing-hero-kicker {
              margin-top: 0.62rem;
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
              font-weight: 750;
              line-height: 1.18;
              letter-spacing: -0.025em;
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
              height: clamp(660px, calc(100vh - 86px), 720px);
            }
            .landing-conversation-panel {
              margin-top: 0.45rem;
              padding: 0.52rem 0.85rem;
            }
            .landing-conversation-panel > p {
              margin-top: 0.22rem;
              font-size: 0.56rem;
              line-height: 1;
            }
            .landing-conversation-panel > div {
              margin-top: 0.28rem;
              padding-top: 0.34rem;
              padding-bottom: 0.34rem;
              font-size: 0.76rem;
              line-height: 1.08;
            }
            .landing-conversation-panel > div + p {
              margin-top: 0.14rem;
            }
            .landing-lead-stack {
              gap: 0.65rem;
            }
            .landing-lead-note {
              font-size: 0.76rem;
              line-height: 1.08;
            }
            .landing-lead-note svg {
              height: 1.2rem;
              width: 1.8rem;
            }
            .landing-lead-card,
            .landing-customer-text-card {
              border-radius: 18px;
              padding: 1.05rem 1.2rem;
            }
            .landing-lead-card span,
            .landing-customer-text-card span {
              font-size: 1.42rem;
            }
            .landing-lead-card span span,
            .landing-customer-text-card span span {
              width: 2.2rem;
              height: 2.2rem;
              border-radius: 0.65rem;
            }
            .landing-lead-card > div + div,
            .landing-customer-text-card p {
              margin-top: 0.75rem;
              font-size: 1.34rem;
              line-height: 1.16;
            }
          .landing-call-checklist-card {
            margin-top: 1.15rem;
            padding: 0.8rem;
            margin-bottom: 0.9rem;
          }
            .landing-call-checklist-card p {
              font-size: 0.66rem;
            }
            .landing-call-checklist-card > div {
              gap: 0.3rem;
              font-size: 0.76rem;
            }
          }
          @media (min-width: 1024px) and (max-height: 760px) {
            .landing-hero-shell {
              padding-top: 0.75rem;
              padding-bottom: 0.75rem;
              padding-left: 1.25rem;
              padding-right: 1.25rem;
            }
            .landing-hero-grid {
              padding-top: 0;
              padding-bottom: 0;
              grid-template-columns: minmax(360px, 0.64fr) minmax(650px, 1.36fr);
              gap: 2.25rem;
            }
            .landing-hero-title {
              font-size: clamp(2.82rem, 3.18vw, 3.38rem);
              line-height: 1.02;
            }
            .landing-hero-kicker {
              margin-top: 0.52rem;
              font-size: 1.8rem;
              line-height: 1;
            }
            .landing-hero-copy {
              margin-top: 0.75rem;
              font-size: 1.06rem;
              line-height: 1.4;
            }
            .landing-hero-points {
              margin-top: 0.95rem;
            }
            .landing-hero-point {
              font-size: 1.06rem;
            }
            .landing-hero-visual {
              margin-top: 0.25rem;
              margin-right: 0;
              transform: translateY(-0.55rem);
            }
            .landing-phone {
              height: 560px;
            }
            .landing-summary > div {
              height: 560px;
            }
            .landing-call-dashboard > div {
              height: clamp(520px, calc(100vh - 76px), 650px);
              border-radius: 28px;
            }
            .landing-call-dashboard {
              max-width: none;
              width: min(100%, 900px);
            }
            .landing-lead-stack {
              gap: 0.34rem;
              grid-template-rows: auto minmax(7.25rem, 1.2fr) minmax(6.35rem, 0.8fr);
            }
            .landing-lead-note {
              font-size: 1.08rem;
              line-height: 1.02;
            }
            .landing-lead-note svg {
              height: 1.7rem;
              width: 2.55rem;
            }
            .landing-lead-card,
            .landing-customer-text-card {
              border-radius: 16px;
              padding: 0.48rem 0.72rem;
              justify-content: flex-start;
            }
            .landing-lead-card span,
            .landing-customer-text-card span {
              font-size: 1.28rem;
            }
            .landing-lead-card span span,
            .landing-customer-text-card span span {
              width: 1.9rem;
              height: 1.9rem;
              border-radius: 0.55rem;
            }
            .landing-lead-card > div + div,
            .landing-customer-text-card p {
              margin-top: 0.28rem;
              font-size: 1.18rem;
              line-height: 1.12;
            }
            .landing-owner-text-title,
            .landing-customer-text-title {
              font-size: 1.14rem !important;
              line-height: 1.05 !important;
            }
            .landing-owner-text-body,
            .landing-customer-text-body {
              font-size: 0.82rem !important;
              line-height: 1.05 !important;
            }
            .landing-owner-text-body {
              column-gap: 0.9rem;
              row-gap: 0.1rem;
              font-size: 0.86rem !important;
              line-height: 1.02 !important;
            }
            .landing-customer-text-card {
              padding: 0.44rem 0.72rem 0.5rem;
            }
            .landing-customer-text-title {
              font-size: 1.12rem !important;
            }
            .landing-customer-text-body {
              margin-top: 0.24rem !important;
              font-size: 0.9rem !important;
              line-height: 1.02 !important;
            }
            .landing-message-icon {
              width: 1.85rem !important;
              height: 1.85rem !important;
            }
            .landing-call-checklist-card {
              margin-top: 0.64rem;
              padding: 0.74rem;
              border-radius: 16px;
            }
            .landing-call-checklist-title {
              font-size: 0.86rem !important;
            }
            .landing-call-checklist-list {
              margin-top: 0.34rem;
              gap: 0.16rem;
              font-size: 0.91rem !important;
              line-height: 1.05 !important;
            }
            .landing-call-checklist-icon {
              width: 1.52rem !important;
              height: 1.52rem !important;
            }
            .landing-call-checklist-check {
              width: 0.96rem !important;
              height: 0.96rem !important;
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
              max-width: 12.6rem;
              padding: 0.54rem 0.9rem;
              font-size: 0.9rem;
              line-height: 1.08;
              text-align: center;
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
              font-size: 1.16rem;
            }
            .landing-conversation-header span {
              font-size: 0.7rem;
              padding: 0.36rem 0.72rem;
            }
            .landing-conversation-panel {
              margin-top: 0.35rem;
              border-radius: 18px;
              padding: 0.36rem 0.62rem;
              display: flex;
              flex: 1 1 0;
              flex-direction: column;
              justify-content: space-around;
            }
            .landing-conversation-panel p {
              font-size: 0.74rem;
              margin-top: 0.18rem;
            }
            .landing-conversation-panel div {
              border-radius: 14px;
              margin-top: 0.18rem;
              padding: 0.48rem 0.82rem;
              font-size: 0.96rem;
              line-height: 1.14;
            }
            .landing-dashboard-bottom {
              margin-top: 0.5rem;
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
              gap: 0.38rem;
            }
            .landing-lead-note {
              justify-content: flex-start;
              font-size: 1rem;
              line-height: 1.02;
            }
            .landing-lead-note svg {
              width: 2.38rem;
              height: 1.6rem;
            }
            .landing-lead-card {
              border-radius: 18px;
              padding: 0.48rem 0.72rem;
              box-shadow: 0 0 0 4px rgba(37,99,235,0.18), 0 22px 52px -28px rgba(37,99,235,0.95);
            }
            .landing-lead-card span {
              font-size: 0.72rem;
            }
            .landing-lead-card span span {
              width: 1.45rem;
              height: 1.45rem;
            }
            .landing-lead-card > div + div {
              margin-top: 0.28rem;
              font-size: 0.64rem;
              line-height: 1.12;
            }
          }
          @media (min-width: 1024px) and (max-height: 660px) {
            .landing-hero-shell {
              padding-top: 0.45rem;
              padding-bottom: 0.35rem;
            }
            .landing-hero-title {
              margin-top: 0.7rem;
              font-size: clamp(2.35rem, 2.9vw, 2.86rem);
              line-height: 0.98;
            }
            .landing-hero-kicker {
              margin-top: 0.32rem;
              font-size: 1.46rem;
            }
            .landing-hero-copy {
              margin-top: 0.52rem;
              font-size: 0.96rem;
              line-height: 1.28;
            }
            .landing-hero-points {
              margin-top: 0.68rem;
            }
            .landing-hero-points > :not([hidden]) ~ :not([hidden]) {
              margin-top: 0.55rem;
            }
            .landing-hero-point {
              font-size: 0.98rem;
              gap: 0.72rem;
            }
            .landing-hero-point-icon {
              width: 2.35rem;
              height: 2.35rem;
            }
            .landing-hero-ctas {
              margin-top: 0.8rem;
              gap: 0.65rem;
            }
            .landing-hero-cta {
              min-height: 2.85rem;
              padding-left: 1.4rem;
              padding-right: 1.4rem;
              font-size: 1rem;
            }
            .landing-hero-footnote {
              margin-top: 0.62rem;
              font-size: 0.88rem;
              font-weight: 750;
              line-height: 1.15;
              letter-spacing: -0.025em;
            }
            .landing-call-dashboard > div {
              height: clamp(510px, calc(100vh - 86px), 590px);
            }
            .landing-conversation-panel {
              flex: 0 0 12.95rem;
            }
            .landing-dashboard-bottom {
              flex: 1 1 0;
              min-height: 0;
            }
            .landing-lead-stack {
              height: 100%;
              grid-template-rows: auto minmax(5.2rem, 0.72fr) minmax(7.45rem, 1.28fr);
              align-content: stretch;
            }
            .landing-lead-card,
            .landing-customer-text-card {
              height: auto;
              justify-content: flex-start;
            }
            .landing-lead-card {
              min-height: 0;
            }
            .landing-customer-text-card {
              min-height: 0;
            }
            .landing-owner-text-title,
            .landing-customer-text-title {
              font-size: 0.92rem !important;
            }
            .landing-owner-text-body,
            .landing-customer-text-body {
              font-size: 0.62rem !important;
              line-height: 1.02 !important;
            }
            .landing-customer-text-title {
              font-size: 0.82rem !important;
            }
            .landing-customer-text-body {
              margin-top: 0.18rem !important;
              font-size: clamp(0.42rem, 8cqh, 0.5rem) !important;
              line-height: 1.05 !important;
            }
            .landing-message-icon {
              width: 1.42rem !important;
              height: 1.42rem !important;
            }
            .landing-caller-card {
              margin-top: 0.9rem;
            }
            .landing-caller-avatar {
              width: 4.15rem;
              height: 4.15rem;
              font-size: 1.52rem;
            }
            .landing-caller-name {
              margin-top: 0.72rem;
              font-size: 1.38rem;
            }
            .landing-caller-phone {
              margin-top: 0.42rem;
              font-size: 0.96rem;
            }
            .landing-caller-tag {
              margin-top: 0.58rem;
              max-width: 11.2rem;
              padding: 0.45rem 0.7rem;
              font-size: 0.8rem;
              line-height: 1.06;
              text-align: center;
            }
            .landing-call-controls svg[viewBox="0 0 120 42"] {
              height: 2.7rem;
            }
            .landing-call-controls > div {
              margin-top: 0.52rem;
            }
            .landing-call-button {
              width: 2.5rem;
              height: 2.5rem;
            }
            .landing-hangup-button {
              width: 3.25rem;
              height: 3.25rem;
            }
          }
          @media (min-width: 1024px) and (max-height: 600px) {
            .landing-conversation-panel {
              flex: 0 0 13.4rem;
            }
            .landing-conversation-panel p {
              font-size: 0.66rem;
            }
            .landing-conversation-panel div {
              padding: 0.4rem 0.64rem;
              font-size: 0.78rem;
              line-height: 1.1;
            }
            .landing-dashboard-bottom {
              flex: 1 1 0;
              min-height: 0;
            }
            .landing-lead-stack {
              height: 100%;
              grid-template-rows: auto minmax(5.75rem, 1fr) minmax(4.85rem, 1fr);
              align-content: stretch;
            }
            .landing-lead-card,
            .landing-customer-text-card {
              height: auto;
            }
            .landing-lead-card {
              height: auto;
            }
            .landing-owner-text-title,
            .landing-customer-text-title {
              font-size: 0.8rem !important;
            }
            .landing-owner-text-body,
            .landing-customer-text-body {
              font-size: 0.58rem !important;
              line-height: 1.02 !important;
            }
            .landing-customer-text-title {
              font-size: 0.74rem !important;
            }
            .landing-customer-text-body {
              margin-top: 0.14rem !important;
              font-size: clamp(0.5rem, 13cqh, 0.62rem) !important;
              line-height: 1.03 !important;
            }
            .landing-message-icon {
              width: 1.32rem !important;
              height: 1.32rem !important;
            }
          }
          @media (min-width: 1024px) and (max-height: 820px) {
            .landing-hero-visual {
              transform: translateY(-4.25rem) !important;
            }
            .landing-call-dashboard > div {
              height: 640px !important;
            }
            .landing-call-panel,
            .landing-conversation-column {
              height: 100% !important;
              min-height: 0 !important;
              overflow: hidden;
              padding: 1.35rem 1.45rem !important;
            }
            .landing-call-status {
              font-size: 0.92rem !important;
            }
            .landing-caller-card {
              margin-top: 0.9rem !important;
            }
            .landing-caller-avatar {
              width: 4.35rem !important;
              height: 4.35rem !important;
            }
            .landing-caller-avatar svg {
              width: 3rem !important;
              height: 3rem !important;
            }
            .landing-caller-name {
              margin-top: 0.7rem !important;
              font-size: 1.42rem !important;
              line-height: 1.04 !important;
            }
            .landing-caller-phone {
              margin-top: 0.45rem !important;
              font-size: 0.94rem !important;
            }
            .landing-caller-tag {
              margin-top: 0.55rem !important;
              max-width: 11.4rem !important;
              padding: 0.48rem 0.8rem !important;
              font-size: 0.76rem !important;
              line-height: 1.1 !important;
            }
            .landing-call-checklist-card {
              margin-top: 0.75rem !important;
              margin-bottom: 0.65rem !important;
              border-radius: 18px !important;
              padding: 0.62rem !important;
            }
            .landing-call-checklist-title {
              font-size: 0.72rem !important;
              line-height: 1.04 !important;
            }
            .landing-call-checklist-list {
              margin-top: 0.42rem !important;
              gap: 0.28rem !important;
              font-size: 0.82rem !important;
              line-height: 1.05 !important;
            }
            .landing-call-checklist-row {
              gap: 0.48rem !important;
            }
            .landing-call-checklist-icon {
              width: 1.32rem !important;
              height: 1.32rem !important;
            }
            .landing-call-checklist-check {
              width: 0.84rem !important;
              height: 0.84rem !important;
            }
            .landing-call-controls svg[viewBox="0 0 120 42"] {
              height: 2.2rem !important;
            }
            .landing-call-controls > div {
              margin-top: 0.45rem !important;
            }
            .landing-call-controls {
              transform: translateY(0);
            }
            .landing-call-button {
              width: 2.35rem !important;
              height: 2.35rem !important;
            }
            .landing-call-button svg {
              width: 1.25rem !important;
              height: 1.25rem !important;
            }
            .landing-hangup-button {
              width: 3.1rem !important;
              height: 3.1rem !important;
            }
            .landing-hangup-button svg {
              width: 1.5rem !important;
              height: 1.5rem !important;
            }
            .landing-conversation-header {
              gap: 0.8rem !important;
            }
            .landing-conversation-header h3 {
              font-size: 1.18rem !important;
              line-height: 1.14 !important;
            }
            .landing-conversation-header span {
              flex-shrink: 0;
              font-size: 0.7rem !important;
              padding: 0.55rem 0.9rem !important;
            }
            .landing-conversation-panel {
              flex: 0 0 13.7rem !important;
              margin-top: 0.7rem !important;
              border-radius: 18px !important;
              padding: 0.65rem 0.75rem !important;
            }
            .landing-conversation-panel > p {
              margin-top: 0.18rem !important;
              font-size: 0.72rem !important;
              line-height: 1 !important;
            }
            .landing-conversation-panel > div {
              margin-top: 0.4rem !important;
              border-radius: 12px !important;
              padding: 0.52rem 0.75rem !important;
              font-size: 0.9rem !important;
              line-height: 1.12 !important;
            }
            .landing-conversation-panel .landing-conversation-long-bubble {
              max-width: 90% !important;
              font-size: 0.8rem !important;
              line-height: 1.08 !important;
            }
            .landing-conversation-panel > div + p {
              margin-top: 0.18rem !important;
            }
            .landing-dashboard-bottom {
              flex: 1 1 0 !important;
              min-height: 0 !important;
              margin-top: 0.55rem !important;
            }
            .landing-lead-stack {
              height: 100% !important;
              gap: 0.52rem !important;
              grid-template-rows: auto minmax(6.2rem, 0.74fr) minmax(8rem, 1.26fr) !important;
              align-content: stretch !important;
            }
            .landing-lead-note {
              justify-content: flex-start !important;
              font-size: 0.78rem !important;
              line-height: 1.05 !important;
            }
            .landing-lead-note svg {
              width: 2.05rem !important;
              height: 1.35rem !important;
            }
            .landing-lead-card,
            .landing-customer-text-card {
              min-height: 0 !important;
              height: auto !important;
              border-radius: 12px !important;
              padding: 0.82rem 1rem !important;
              justify-content: flex-start !important;
            }
            .landing-owner-text-title,
            .landing-customer-text-title {
              font-size: 1.22rem !important;
              line-height: 1.05 !important;
            }
            .landing-owner-text-body,
            .landing-customer-text-body {
              font-size: 0.9rem !important;
              line-height: 1.1 !important;
            }
            .landing-owner-text-body {
              margin-top: 0.72rem !important;
              column-gap: 1rem !important;
              row-gap: 0.12rem !important;
            }
            .landing-customer-text-body {
              margin-top: 0.38rem !important;
              font-size: 0.52rem !important;
              line-height: 1.08 !important;
            }
            .landing-message-icon {
              width: 2.08rem !important;
              height: 2.08rem !important;
            }
          }
          @media (min-width: 768px) {
            .landing-call-dashboard > div {
              height: auto !important;
              min-height: 660px;
            }
            .landing-conversation-column {
              min-height: 660px;
            }
            .landing-dashboard-bottom {
              display: block !important;
              flex: 0 0 auto !important;
              min-height: 0 !important;
            }
            .landing-lead-stack {
              height: auto !important;
              grid-template-rows: auto auto auto !important;
              align-content: start !important;
            }
            .landing-lead-card,
            .landing-customer-text-card {
              min-height: 0 !important;
              height: auto !important;
              justify-content: flex-start !important;
            }
            .landing-customer-text-card {
              container-type: normal !important;
              padding-bottom: 0.9rem !important;
            }
            .landing-customer-text-body {
              margin-top: 0.48rem !important;
              font-size: 0.58rem !important;
              line-height: 1.08 !important;
            }
          }
          @media (min-width: 1024px) and (max-width: 1200px) {
            .landing-owner-text-title,
            .landing-customer-text-title {
              font-size: 1.12rem !important;
            }
            .landing-owner-text-body {
              font-size: 0.72rem !important;
              line-height: 1.08 !important;
            }
            .landing-customer-text-body {
              font-size: 0.52rem !important;
              line-height: 1.06 !important;
            }
          }
          @media (min-width: 768px) {
            .landing-call-dashboard > div {
              min-height: 780px !important;
            }
            .landing-call-dashboard > div > div {
              min-height: 780px !important;
            }
            .landing-conversation-column {
              min-height: 780px !important;
            }
            .landing-dashboard-bottom {
              margin-top: 1rem !important;
            }
            .landing-lead-stack {
              gap: 0.72rem !important;
              grid-template-rows: auto auto auto !important;
            }
            .landing-lead-card,
            .landing-customer-text-card {
              padding: 1rem 1.25rem !important;
            }
            .landing-customer-text-card {
              min-height: 10.75rem !important;
              padding-bottom: 1.15rem !important;
            }
            .landing-customer-text-body {
              margin-top: 0.72rem !important;
              font-size: 0.78rem !important;
              line-height: 1.18 !important;
              letter-spacing: -0.015em !important;
            }
          }
          @media (min-width: 1024px) and (max-width: 1250px) {
            .landing-customer-text-card {
              min-height: 10.3rem !important;
            }
            .landing-customer-text-body {
              font-size: 0.72rem !important;
              line-height: 1.16 !important;
            }
          }
          @media (max-width: 767px) {
            .landing-customer-text-card {
              min-height: 14rem !important;
              padding: 1rem !important;
            }
            .landing-customer-text-title {
              font-size: 1.22rem !important;
            }
            .landing-customer-text-body {
              margin-top: 0.72rem !important;
              font-size: 0.84rem !important;
              line-height: 1.14 !important;
              letter-spacing: -0.015em !important;
            }
          }
          @media (min-width: 768px) and (max-width: 1023px) {
            .landing-call-dashboard > div {
              min-height: 1120px !important;
            }
            .landing-call-dashboard > div > div {
              min-height: 1120px !important;
            }
            .landing-conversation-column {
              min-height: 1120px !important;
            }
            .landing-conversation-panel {
              flex: 0 0 30rem !important;
              padding: 1rem !important;
            }
            .landing-conversation-panel > div {
              font-size: 0.88rem !important;
              line-height: 1.14 !important;
            }
            .landing-conversation-panel .landing-conversation-long-bubble {
              max-width: 90% !important;
              font-size: 0.78rem !important;
              line-height: 1.08 !important;
            }
            .landing-dashboard-bottom {
              margin-top: 1.35rem !important;
            }
            .landing-customer-text-card {
              min-height: 14.35rem !important;
              padding: 1rem 1.25rem 1.15rem !important;
            }
            .landing-customer-text-body {
              margin-top: 0.78rem !important;
              font-size: 0.9rem !important;
              line-height: 1.1 !important;
              letter-spacing: -0.015em !important;
            }
          }
          @media (min-width: 1024px) {
            .landing-hero-grid {
              align-items: start !important;
            }
            .landing-hero-visual {
              margin-top: 0.5rem !important;
              transform: translateY(0) !important;
            }
            .landing-call-dashboard > div {
              height: auto !important;
              min-height: 980px !important;
            }
            .landing-call-dashboard > div > div {
              min-height: 980px !important;
            }
            .landing-call-panel,
            .landing-conversation-column {
              height: auto !important;
              min-height: 980px !important;
              overflow: visible !important;
            }
            .landing-conversation-panel {
              display: block !important;
              flex: 0 0 30rem !important;
              margin-top: 1rem !important;
              padding: 1rem 1.05rem 2.25rem !important;
            }
            .landing-conversation-panel > p {
              margin-top: 0.42rem !important;
              font-size: 0.82rem !important;
              line-height: 1.05 !important;
            }
            .landing-conversation-panel > p:first-child {
              margin-top: 0 !important;
            }
            .landing-conversation-panel > div {
              margin-top: 0.5rem !important;
              padding: 0.65rem 0.92rem !important;
              font-size: 0.94rem !important;
              line-height: 1.15 !important;
            }
            .landing-conversation-panel .landing-conversation-long-bubble {
              max-width: 92% !important;
              font-size: 0.84rem !important;
              line-height: 1.12 !important;
            }
            .landing-conversation-panel .landing-conversation-caller-detail {
              max-width: 90% !important;
              font-size: 0.84rem !important;
              line-height: 1.12 !important;
            }
            .landing-conversation-panel > div + p {
              margin-top: 0.28rem !important;
            }
            .landing-dashboard-bottom {
              margin-top: 1.35rem !important;
            }
            .landing-call-owner-card {
              margin-top: 1rem !important;
              padding: 1rem 1.05rem !important;
            }
            .landing-call-owner-title {
              font-size: 1.16rem !important;
              line-height: 1.05 !important;
            }
            .landing-call-owner-icon {
              width: 2.2rem !important;
              height: 2.2rem !important;
            }
            .landing-call-owner-body {
              margin-top: 0.8rem !important;
              font-size: 0.82rem !important;
              line-height: 1.16 !important;
            }
            .landing-call-owner-body > p + p {
              margin-top: 0.18rem !important;
            }
          }
          @media (min-width: 1024px) and (max-height: 900px) {
            .landing-call-dashboard > div {
              height: min(760px, calc(100vh - 118px)) !important;
              min-height: 540px !important;
              max-height: 760px !important;
            }
            .landing-call-dashboard > div > div,
            .landing-call-panel,
            .landing-conversation-column {
              height: 100% !important;
              min-height: 0 !important;
            }
            .landing-call-panel {
              padding: 0.95rem !important;
              overflow: hidden !important;
            }
            .landing-call-status {
              font-size: 0.78rem !important;
            }
            .landing-caller-card {
              margin-top: 0.8rem !important;
            }
            .landing-caller-avatar {
              height: 4.25rem !important;
              width: 4.25rem !important;
            }
            .landing-caller-name {
              margin-top: 0.75rem !important;
              font-size: 1.18rem !important;
              line-height: 1.02 !important;
            }
            .landing-caller-phone {
              margin-top: 0.45rem !important;
              font-size: 0.86rem !important;
            }
            .landing-caller-tag {
              margin-top: 0.65rem !important;
              padding: 0.38rem 0.62rem !important;
              font-size: 0.68rem !important;
              line-height: 1.05 !important;
            }
            .landing-call-owner-card {
              margin-top: 0.7rem !important;
              padding: 0.58rem 0.68rem !important;
              border-radius: 13px !important;
            }
            .landing-call-owner-title {
              font-size: 0.76rem !important;
            }
            .landing-call-owner-icon {
              height: 1.55rem !important;
              width: 1.55rem !important;
            }
            .landing-call-owner-body {
              margin-top: 0.38rem !important;
              font-size: 0.56rem !important;
              line-height: 1.06 !important;
            }
            .landing-call-owner-body > p + p {
              margin-top: 0.08rem !important;
            }
            .landing-call-controls {
              margin-top: 0.6rem !important;
            }
            .landing-call-controls svg[viewBox="0 0 120 42"] {
              height: 2.1rem !important;
            }
            .landing-call-controls > div {
              margin-top: 0.45rem !important;
            }
            .landing-call-button {
              height: 2.35rem !important;
              width: 2.35rem !important;
            }
            .landing-call-button svg {
              height: 1.15rem !important;
              width: 1.15rem !important;
            }
            .landing-hangup-button {
              height: 3rem !important;
              width: 3rem !important;
            }
            .landing-hangup-button svg {
              height: 1.3rem !important;
              width: 1.3rem !important;
            }
            .landing-conversation-column {
              padding: 0.9rem !important;
              overflow: hidden !important;
            }
            .landing-conversation-header h3 {
              font-size: 0.9rem !important;
              line-height: 1.05 !important;
            }
            .landing-conversation-header span {
              padding: 0.32rem 0.58rem !important;
              font-size: 0.5rem !important;
            }
            .landing-conversation-panel {
              display: flex !important;
              flex: 1 1 auto !important;
              flex-direction: column !important;
              justify-content: space-between !important;
              margin-top: 0.38rem !important;
              padding: 0.42rem 0.54rem !important;
              overflow: hidden !important;
            }
            .landing-conversation-panel > p {
              margin-top: 0.12rem !important;
              font-size: 0.52rem !important;
              line-height: 1 !important;
            }
            .landing-conversation-panel > div {
              margin-top: 0.14rem !important;
              padding: 0.34rem 0.5rem !important;
              font-size: 0.62rem !important;
              line-height: 1.08 !important;
            }
            .landing-conversation-panel .landing-conversation-long-bubble,
            .landing-conversation-panel .landing-conversation-caller-detail {
              font-size: 0.58rem !important;
              line-height: 1.06 !important;
            }
            .landing-conversation-panel > div + p {
              margin-top: 0.1rem !important;
            }
            .landing-dashboard-bottom {
              margin-top: 0.42rem !important;
              flex: 0 0 auto !important;
            }
            .landing-lead-stack {
              gap: 0.34rem !important;
            }
            .landing-lead-note {
              justify-content: flex-start !important;
              font-size: 0.66rem !important;
              line-height: 1.05 !important;
            }
            .landing-lead-note svg {
              height: 1.05rem !important;
              width: 1.55rem !important;
            }
            .landing-customer-text-card {
              min-height: 0 !important;
              padding: 0.55rem 0.65rem !important;
              border-radius: 12px !important;
            }
            .landing-customer-text-title {
              font-size: 0.82rem !important;
            }
            .landing-message-icon {
              height: 1.5rem !important;
              width: 1.5rem !important;
            }
            .landing-customer-text-body {
              margin-top: 0.32rem !important;
              font-size: 0.46rem !important;
              line-height: 1.06 !important;
            }
          }
          @media (min-width: 1024px) and (max-height: 700px) {
            .landing-call-dashboard > div {
              height: calc(100vh - 100px) !important;
              min-height: 520px !important;
            }
            .landing-call-controls {
              display: none !important;
            }
            .landing-call-owner-body {
              font-size: 0.52rem !important;
            }
            .landing-customer-text-body {
              font-size: 0.42rem !important;
            }
          }
          .landing-hero-cta {
            white-space: nowrap;
          }
          .landing-call-owner-body,
          .landing-customer-text-body {
            text-wrap: pretty;
          }
          @media (min-width: 1024px) {
            .landing-hero-shell {
              min-height: 100vh !important;
              max-width: 1510px !important;
              padding: 0.85rem 2.65rem 1.35rem !important;
            }
            .landing-hero-shell nav {
              gap: 1.25rem !important;
            }
            .landing-hero-grid {
              align-items: center !important;
              grid-template-columns: minmax(470px, 0.58fr) minmax(790px, 1.42fr) !important;
              gap: clamp(2rem, 3.2vw, 3.75rem) !important;
              padding-top: 0.65rem !important;
              padding-bottom: 0 !important;
            }
            .landing-hero-grid > div:first-child {
              max-width: 510px !important;
              transform: none !important;
            }
            .landing-hero-title {
              margin-top: 0.75rem !important;
              font-size: clamp(3.05rem, 3.45vw, 3.55rem) !important;
              line-height: 1 !important;
            }
            .landing-hero-kicker {
              margin-top: 0.65rem !important;
              font-size: clamp(2.05rem, 2.45vw, 2.55rem) !important;
              line-height: 1 !important;
            }
            .landing-revenue-line {
              margin-top: 1.05rem !important;
            }
            .landing-hero-copy {
              margin-top: 1rem !important;
              font-size: 1.08rem !important;
              line-height: 1.45 !important;
            }
            .landing-hero-points {
              margin-top: 1.15rem !important;
            }
            .landing-hero-points > :not([hidden]) ~ :not([hidden]) {
              margin-top: 0.9rem !important;
            }
            .landing-hero-point {
              font-size: 1.05rem !important;
              line-height: 1.28 !important;
            }
            .landing-hero-point-icon {
              height: 2.55rem !important;
              width: 2.55rem !important;
            }
            .landing-hero-ctas {
              margin-top: 1.35rem !important;
              gap: 1rem !important;
            }
            .landing-hero-cta {
              min-width: 13.75rem !important;
              min-height: 3.35rem !important;
              padding-left: 1.5rem !important;
              padding-right: 1.5rem !important;
              font-size: 1.12rem !important;
            }
            .landing-hero-footnote {
              margin-top: 1.1rem !important;
              font-size: 0.88rem !important;
              line-height: 1.05 !important;
              letter-spacing: -0.02em !important;
              white-space: nowrap !important;
            }
            .landing-hero-visual {
              align-self: center !important;
              justify-content: flex-end !important;
              margin-top: 0 !important;
              transform: none !important;
            }
            .landing-call-dashboard {
              max-width: 910px !important;
              width: min(100%, 910px) !important;
            }
            .landing-call-dashboard > div {
              height: clamp(660px, calc(100vh - 112px), 704px) !important;
              min-height: 0 !important;
              max-height: 704px !important;
              border-radius: 28px !important;
            }
            .landing-call-dashboard > div > div,
            .landing-call-panel,
            .landing-conversation-column {
              height: 100% !important;
              min-height: 0 !important;
            }
            .landing-call-panel {
              padding: 1.25rem 1.35rem !important;
              overflow: hidden !important;
            }
            .landing-call-status {
              font-size: 0.95rem !important;
            }
            .landing-caller-card {
              margin-top: 1.25rem !important;
            }
            .landing-caller-avatar {
              height: 5.1rem !important;
              width: 5.1rem !important;
            }
            .landing-caller-avatar svg {
              height: 3.45rem !important;
              width: 3.45rem !important;
            }
            .landing-caller-name {
              margin-top: 1rem !important;
              font-size: 1.55rem !important;
              line-height: 1.04 !important;
            }
            .landing-caller-phone {
              margin-top: 0.55rem !important;
              font-size: 1.06rem !important;
            }
            .landing-caller-tag {
              margin-top: 0.75rem !important;
              max-width: 14rem !important;
              padding: 0.55rem 0.9rem !important;
              font-size: 0.84rem !important;
            }
            .landing-call-owner-card {
              margin-top: 1rem !important;
              border-radius: 15px !important;
              padding: 0.9rem 1rem !important;
            }
            .landing-call-owner-title {
              font-size: 1.02rem !important;
            }
            .landing-call-owner-icon {
              height: 2rem !important;
              width: 2rem !important;
            }
            .landing-call-owner-body {
              margin-top: 0.65rem !important;
              display: block !important;
              font-size: 0.74rem !important;
              line-height: 1.16 !important;
            }
            .landing-call-owner-body > p + p {
              margin-top: 0.16rem !important;
            }
            .landing-call-controls {
              margin-top: auto !important;
            }
            .landing-call-controls svg[viewBox="0 0 120 42"] {
              height: 3.05rem !important;
            }
            .landing-call-controls > div {
              margin-top: 0.9rem !important;
            }
            .landing-call-button {
              height: 2.95rem !important;
              width: 2.95rem !important;
            }
            .landing-hangup-button {
              height: 3.75rem !important;
              width: 3.75rem !important;
            }
            .landing-conversation-column {
              padding: 1.25rem 1.35rem !important;
              overflow: hidden !important;
            }
            .landing-conversation-header h3 {
              font-size: 1.22rem !important;
              line-height: 1.1 !important;
            }
            .landing-conversation-header span {
              padding: 0.45rem 0.75rem !important;
              font-size: 0.62rem !important;
            }
            .landing-conversation-panel {
              display: block !important;
              flex: 0 0 clamp(20.75rem, 43vh, 22rem) !important;
              margin-top: 0.65rem !important;
              border-radius: 20px !important;
              padding: 0.68rem 0.85rem !important;
              overflow: hidden !important;
            }
            .landing-conversation-panel > p {
              margin-top: 0.16rem !important;
              font-size: 0.66rem !important;
              line-height: 1.05 !important;
            }
            .landing-conversation-panel > p:first-child {
              margin-top: 0 !important;
            }
            .landing-conversation-panel > div {
              margin-top: 0.28rem !important;
              border-radius: 13px !important;
              padding: 0.46rem 0.68rem !important;
              font-size: 0.78rem !important;
              line-height: 1.12 !important;
            }
            .landing-conversation-panel .landing-conversation-long-bubble,
            .landing-conversation-panel .landing-conversation-caller-detail {
              max-width: 89% !important;
              font-size: 0.74rem !important;
              line-height: 1.1 !important;
            }
            .landing-conversation-panel > div + p {
              margin-top: 0.12rem !important;
            }
            .landing-dashboard-bottom {
              display: block !important;
              flex: 0 0 auto !important;
              min-height: 0 !important;
              margin-top: 0.55rem !important;
            }
            .landing-lead-stack {
              display: grid !important;
              width: 100% !important;
              height: auto !important;
              grid-template-rows: auto auto !important;
              gap: 0.45rem !important;
              align-content: start !important;
            }
            .landing-lead-note {
              justify-content: flex-start !important;
              font-size: 0.82rem !important;
              line-height: 1.05 !important;
              text-align: left !important;
            }
            .landing-lead-note svg {
              height: 1.35rem !important;
              width: 2.1rem !important;
            }
            .landing-customer-text-card {
              min-height: 0 !important;
              height: auto !important;
              align-self: start !important;
              border-radius: 13px !important;
              padding: 0.8rem 1rem !important;
              justify-content: flex-start !important;
            }
            .landing-customer-text-title {
              font-size: 1.12rem !important;
              line-height: 1.05 !important;
            }
            .landing-message-icon {
              height: 2rem !important;
              width: 2rem !important;
            }
            .landing-customer-text-body {
              margin-top: 0.55rem !important;
              font-size: 0.7rem !important;
              line-height: 1.18 !important;
              letter-spacing: -0.015em !important;
            }
          }
          @media (min-width: 1024px) and (max-height: 760px) {
            .landing-hero-shell {
              min-height: 100vh !important;
              padding-top: 0.55rem !important;
              padding-bottom: 0.9rem !important;
            }
            .landing-hero-grid {
              padding-top: 0.4rem !important;
              grid-template-columns: minmax(440px, 0.58fr) minmax(760px, 1.42fr) !important;
              gap: 1.9rem !important;
            }
            .landing-hero-title {
              margin-top: 0.55rem !important;
              font-size: clamp(2.7rem, 3.1vw, 3.05rem) !important;
            }
            .landing-hero-kicker {
              margin-top: 0.45rem !important;
              font-size: clamp(1.75rem, 2.05vw, 2.05rem) !important;
            }
            .landing-revenue-line {
              margin-top: 0.82rem !important;
              font-size: 1.18rem !important;
            }
            .landing-hero-copy {
              margin-top: 0.75rem !important;
              font-size: 1rem !important;
              line-height: 1.35 !important;
            }
            .landing-hero-points {
              margin-top: 0.85rem !important;
            }
            .landing-hero-points > :not([hidden]) ~ :not([hidden]) {
              margin-top: 0.62rem !important;
            }
            .landing-hero-point {
              font-size: 0.96rem !important;
            }
            .landing-hero-point-icon {
              height: 2.25rem !important;
              width: 2.25rem !important;
            }
            .landing-hero-ctas {
              margin-top: 0.95rem !important;
            }
            .landing-hero-cta {
              min-height: 3rem !important;
              min-width: 12.7rem !important;
              font-size: 1.02rem !important;
            }
            .landing-hero-footnote {
              margin-top: 0.72rem !important;
              font-size: 0.78rem !important;
            }
            .landing-call-dashboard {
              max-width: 890px !important;
            }
            .landing-call-dashboard > div {
              height: clamp(590px, calc(100vh - 104px), 650px) !important;
            }
            .landing-call-panel,
            .landing-conversation-column {
              padding: 1rem 1.12rem !important;
            }
            .landing-conversation-panel {
              flex-basis: clamp(19.2rem, 45vh, 20.5rem) !important;
              padding: 0.52rem 0.7rem !important;
            }
            .landing-conversation-panel > p {
              margin-top: 0.14rem !important;
              font-size: 0.62rem !important;
            }
            .landing-conversation-panel > div {
              margin-top: 0.22rem !important;
              padding: 0.42rem 0.62rem !important;
              font-size: 0.74rem !important;
              line-height: 1.1 !important;
            }
            .landing-conversation-panel .landing-conversation-long-bubble,
            .landing-conversation-panel .landing-conversation-caller-detail {
              font-size: 0.68rem !important;
              line-height: 1.08 !important;
            }
            .landing-conversation-panel > div + p {
              margin-top: 0.1rem !important;
            }
            .landing-customer-text-body {
              font-size: 0.8rem !important;
              line-height: 1.28 !important;
            }
          }
          @media (min-width: 1024px) {
            .landing-hero-label,
            .landing-hero-copy,
            .landing-hero-point {
              font-weight: 700 !important;
            }
            .landing-call-owner-body,
            .landing-conversation-panel,
            .landing-customer-text-body {
              font-weight: 700 !important;
            }
          }
          @media (min-width: 1024px) and (max-height: 820px) {
            .landing-hero-shell {
              min-height: 100vh !important;
            }
            .landing-hero-grid {
              align-items: start !important;
            }
            .landing-hero-grid > div:first-child {
              display: flex !important;
              min-height: clamp(580px, calc(100vh - 100px), 720px) !important;
              flex-direction: column !important;
              justify-content: space-between !important;
            }
            .landing-call-dashboard > div {
              height: clamp(560px, calc(100vh - 128px), 692px) !important;
              min-height: 560px !important;
              max-height: 692px !important;
            }
            .landing-call-owner-body {
              margin-top: 0.45rem !important;
              font-size: 0.82rem !important;
              line-height: 1.16 !important;
            }
            .landing-call-owner-card {
              margin-top: 0.75rem !important;
              padding: 0.68rem 0.9rem !important;
            }
            .landing-conversation-panel {
              position: relative !important;
              flex-basis: 22.55rem !important;
              padding: 0.68rem 0.85rem !important;
            }
            .landing-conversation-panel > p {
              font-size: 0.76rem !important;
              line-height: 1.15 !important;
            }
            .landing-conversation-panel > div,
            .landing-conversation-panel .landing-conversation-long-bubble,
            .landing-conversation-panel .landing-conversation-caller-detail {
              padding-top: 0.34rem !important;
              padding-bottom: 0.34rem !important;
              font-size: 0.78rem !important;
              line-height: 1.18 !important;
            }
            .landing-customer-text-card {
              padding: 0.58rem 1rem !important;
            }
            .landing-customer-text-body {
              font-size: 0.8rem !important;
              line-height: 1.2 !important;
            }
            .landing-dashboard-bottom {
              margin-top: 0.4rem !important;
            }
            .landing-lead-stack {
              gap: 0.28rem !important;
            }
            .landing-lead-note {
              gap: 0.7rem !important;
              font-size: 0.98rem !important;
              line-height: 1.12 !important;
            }
            .landing-lead-note svg {
              height: 1.75rem !important;
              width: 2.7rem !important;
              stroke-width: 4.5 !important;
            }
            .landing-call-controls {
              display: block !important;
              position: absolute !important;
              right: 1rem !important;
              bottom: 0.25rem !important;
              left: 1rem !important;
              margin-top: 0 !important;
              padding-bottom: 0 !important;
            }
            .landing-call-controls > svg[viewBox="0 0 120 42"] {
              display: none !important;
            }
            .landing-call-controls > div {
              margin-top: 0 !important;
            }
            .landing-call-controls > div:last-child {
              margin-top: 0.65rem !important;
            }
            .landing-hangup-button {
              height: 3.35rem !important;
              width: 3.35rem !important;
            }
            .landing-summary-ready-badge {
              padding: 0.5rem 0.75rem !important;
              font-size: 0.78rem !important;
              color: #d8f1ff !important;
            }
            .landing-conversation-time {
              font-size: 0.8rem !important;
              color: rgba(255, 255, 255, 0.7) !important;
            }
            .landing-conversation-panel > .landing-conversation-time:last-child {
              position: absolute;
              z-index: 2;
              right: 0.85rem;
              bottom: 0.5rem;
              margin: 0 !important;
              transform: none;
              padding: 0;
            }
            .landing-conversation-panel .landing-conversation-caller-detail {
              margin-bottom: 1.3rem !important;
            }
            .landing-call-owner-now,
            .landing-customer-text-now {
              font-size: 0.8rem !important;
              color: #526b5b !important;
            }
            .landing-hero-footnote {
              max-width: none !important;
              white-space: nowrap !important;
              font-size: 0.88rem !important;
              line-height: 1 !important;
              letter-spacing: -0.06em !important;
            }
          }
          .landing-hero-points {
            position: relative;
            display: grid;
            gap: 0.62rem;
            padding-left: 0.2rem;
          }
          .landing-hero-points::before {
            content: "";
            position: absolute;
            top: 1.45rem;
            bottom: 1.45rem;
            left: 1.62rem;
            width: 3px;
            border-radius: 999px;
            background: linear-gradient(180deg, #1d67c8, #0754a8);
            opacity: 0.95;
          }
          .landing-hero-points > :not([hidden]) ~ :not([hidden]) {
            margin-top: 0 !important;
          }
          .landing-hero-point {
            position: relative;
            min-height: 2.92rem;
            gap: 0 !important;
            border: 1px solid rgba(58, 135, 219, 0.34);
            border-radius: 0.95rem;
            background: linear-gradient(180deg, rgba(255,255,255,0.82), rgba(248,252,255,0.72));
            padding: 0.46rem 0.8rem 0.46rem 3.48rem;
            box-shadow: 0 8px 22px -23px rgba(12, 77, 160, 0.52), inset 0 1px 0 rgba(255,255,255,0.82);
          }
          .landing-hero-point-icon {
            position: absolute !important;
            z-index: 2;
            top: 50%;
            left: 0.08rem;
            height: 2.95rem !important;
            width: 2.95rem !important;
            transform: translateY(-50%);
            border: 2px solid rgba(255,255,255,0.92);
            background: radial-gradient(circle at 35% 22%, #398fe9, #155fae 55%, #0a498f 100%) !important;
            box-shadow: 0 7px 17px -13px rgba(5, 72, 156, 0.72), inset 0 1px 0 rgba(255,255,255,0.28) !important;
          }
          .landing-hero-point-icon svg {
            height: 1.42rem !important;
            width: 1.42rem !important;
            stroke-width: 2.25;
          }
          .landing-hero-point > span:last-child {
            position: relative;
            z-index: 1;
            line-height: 1.22;
          }
          @media (min-width: 1024px) and (max-height: 820px) {
            .landing-hero-points {
              gap: 0.48rem;
              margin-top: 1rem !important;
            }
            .landing-hero-point {
              min-height: 2.72rem;
              padding-top: 0.38rem;
              padding-bottom: 0.38rem;
              padding-left: 3.35rem;
              font-size: 0.94rem !important;
            }
            .landing-hero-point-icon {
              height: 2.8rem !important;
              width: 2.8rem !important;
            }
            .landing-hero-point-icon svg {
              height: 1.38rem !important;
              width: 1.38rem !important;
            }
            .landing-hero-points::before {
              left: 1.48rem;
            }
          }
          @media (min-width: 1024px) and (min-height: 701px) and (max-height: 820px) {
            .landing-conversation-panel {
              flex-basis: 26rem !important;
            }
          }
          @media (min-width: 1024px) and (max-height: 700px) {
            .landing-call-controls > div:first-child {
              display: none !important;
            }
            .landing-call-controls > div:last-child {
              margin-top: 0 !important;
            }
          }
          /* iPad landscape: preserve the desktop composition without horizontal clipping. */
          @media (min-width: 1024px) and (max-width: 1279px) and (orientation: landscape) {
            .landing-hero-shell {
              min-height: 100vh !important;
              max-width: none !important;
              padding: 0.65rem 1.25rem 0.8rem !important;
            }
            .landing-hero-shell nav {
              gap: 1rem !important;
            }
            .landing-hero-grid {
              grid-template-columns: minmax(340px, 0.7fr) minmax(0, 1.3fr) !important;
              gap: 1.25rem !important;
              padding-top: 0.35rem !important;
              padding-bottom: 0 !important;
            }
            .landing-hero-grid > div:first-child {
              display: block !important;
              width: 100% !important;
              max-width: none !important;
              min-height: 0 !important;
            }
            .landing-hero-title {
              margin-top: 0.55rem !important;
              font-size: clamp(2.45rem, 4vw, 2.85rem) !important;
              line-height: 0.98 !important;
            }
            .landing-hero-kicker {
              margin-top: 0.4rem !important;
              font-size: clamp(1.65rem, 2.7vw, 1.95rem) !important;
            }
            .landing-revenue-line {
              margin-top: 0.75rem !important;
              gap: 0.65rem !important;
              font-size: clamp(0.96rem, 1.65vw, 1.12rem) !important;
            }
            .landing-revenue-icon {
              height: 1.8rem !important;
              width: 2.25rem !important;
            }
            .landing-hero-copy {
              margin-top: 0.75rem !important;
              font-size: 0.94rem !important;
              line-height: 1.3 !important;
            }
            .landing-hero-points {
              margin-top: 0.8rem !important;
              gap: 0.42rem !important;
            }
            .landing-hero-point {
              min-height: 2.55rem !important;
              padding: 0.34rem 0.65rem 0.34rem 3.2rem !important;
              font-size: 0.88rem !important;
            }
            .landing-hero-point-icon {
              height: 2.65rem !important;
              width: 2.65rem !important;
            }
            .landing-hero-point-icon svg {
              height: 1.3rem !important;
              width: 1.3rem !important;
            }
            .landing-hero-points::before {
              left: 1.4rem !important;
            }
            .landing-hero-ctas {
              margin-top: 0.8rem !important;
              gap: 0.65rem !important;
            }
            .landing-hero-cta {
              min-width: 0 !important;
              min-height: 2.85rem !important;
              flex: 1 1 0 !important;
              padding: 0.55rem 0.8rem !important;
              font-size: 0.9rem !important;
            }
            .landing-hero-footnote {
              margin-top: 0.65rem !important;
              font-size: clamp(0.65rem, 1.05vw, 0.74rem) !important;
              letter-spacing: -0.055em !important;
            }
            .landing-hero-visual {
              width: 100% !important;
              min-width: 0 !important;
            }
            .landing-call-dashboard {
              width: 100% !important;
              max-width: none !important;
              min-width: 0 !important;
            }
            .landing-call-dashboard > div {
              width: 100% !important;
              height: calc(100vh - 100px) !important;
              min-height: 620px !important;
              max-height: 720px !important;
            }
            .landing-call-panel,
            .landing-conversation-column {
              padding: 0.85rem !important;
            }
            .landing-caller-name {
              font-size: 1.08rem !important;
            }
            .landing-call-owner-title,
            .landing-customer-text-title {
              font-size: 0.82rem !important;
            }
            .landing-call-owner-body {
              font-size: 0.62rem !important;
              line-height: 1.08 !important;
            }
            .landing-conversation-header h3 {
              font-size: 0.94rem !important;
            }
            .landing-conversation-panel {
              flex-basis: 23.5rem !important;
              padding: 0.58rem 0.7rem !important;
            }
            .landing-conversation-panel > div,
            .landing-conversation-panel .landing-conversation-long-bubble,
            .landing-conversation-panel .landing-conversation-caller-detail {
              font-size: 0.68rem !important;
              line-height: 1.08 !important;
            }
            .landing-customer-text-body {
              font-size: 0.62rem !important;
              line-height: 1.1 !important;
            }
          }
          /* iPad portrait: keep every block inside the viewport and reduce excess scrolling. */
          @media (min-width: 768px) and (max-width: 1023px) and (orientation: portrait) {
            .landing-hero-shell {
              max-width: none !important;
              padding: 1rem 1.5rem 1.5rem !important;
            }
            .landing-hero-shell nav {
              grid-template-columns: auto auto !important;
              align-items: center !important;
              justify-content: space-between !important;
              gap: 1rem !important;
            }
            .landing-hero-shell nav > div:last-child {
              justify-self: end !important;
            }
            .landing-hero-grid {
              gap: 1rem !important;
              padding-top: 1rem !important;
              padding-bottom: 0 !important;
            }
            .landing-hero-grid > div:first-child {
              width: 100% !important;
              max-width: none !important;
            }
            .landing-hero-title {
              font-size: 3rem !important;
            }
            .landing-hero-kicker {
              font-size: 2rem !important;
            }
            .landing-hero-points {
              grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
              gap: 0.65rem 0.8rem !important;
            }
            .landing-hero-points::before {
              display: none !important;
            }
            .landing-hero-point {
              min-height: 3rem !important;
              padding-left: 3.55rem !important;
              font-size: 0.95rem !important;
            }
            .landing-hero-ctas {
              margin-top: 1rem !important;
              flex-direction: row !important;
            }
            .landing-hero-cta {
              min-width: 0 !important;
              flex: 1 1 0 !important;
            }
            .landing-hero-footnote {
              text-align: center !important;
              font-size: 0.8rem !important;
            }
            .landing-hero-visual {
              width: 100% !important;
              max-width: 720px !important;
              margin: 1rem auto 0 !important;
              justify-content: center !important;
            }
            .landing-call-dashboard {
              width: 100% !important;
              max-width: 720px !important;
            }
            .landing-call-dashboard > div,
            .landing-call-dashboard > div > div,
            .landing-conversation-column {
              height: 700px !important;
              min-height: 700px !important;
              max-height: 700px !important;
            }
          }
          @media (min-width: 1024px) and (max-height: 820px) {
            .landing-conversation-panel .landing-conversation-long-bubble {
              margin-top: 0.35rem !important;
              padding-top: 0.42rem !important;
              padding-bottom: 0.42rem !important;
            }
            .landing-conversation-panel .landing-conversation-long-bubble ul {
              margin-top: 0.2rem !important;
              row-gap: 0 !important;
            }
            .landing-conversation-panel .landing-conversation-caller-detail {
              max-width: 94% !important;
              margin-top: 0.35rem !important;
              margin-bottom: 1.15rem !important;
              padding: 0.38rem 0.58rem !important;
              font-size: 0.7rem !important;
              line-height: 1.06 !important;
            }
          }
          @media (min-width: 1024px) and (max-width: 1279px) and (max-height: 820px) and (orientation: landscape) {
            .landing-conversation-panel .landing-conversation-caller-detail {
              font-size: 0.64rem !important;
              line-height: 1.05 !important;
            }
          }
          /* Keep the complete conversation visible instead of clipping the final caller response. */
          @media (min-width: 1024px) {
            .landing-conversation-panel {
              flex: 0 0 auto !important;
              overflow: visible !important;
            }
          }
          @media (min-width: 1024px) and (max-height: 660px) {
            .landing-hero-visual {
              transform: translateY(-0.35rem) !important;
            }
            .landing-call-dashboard > div {
              height: calc(100vh - 110px) !important;
              min-height: 0 !important;
            }
            .landing-conversation-panel {
              flex: 0 0 20rem !important;
              padding: 0.48rem 0.65rem !important;
            }
            .landing-conversation-panel > p {
              font-size: 0.58rem !important;
              line-height: 1 !important;
            }
            .landing-conversation-panel > div,
            .landing-conversation-panel .landing-conversation-long-bubble,
            .landing-conversation-panel .landing-conversation-caller-detail {
              margin-top: 0.16rem !important;
              padding: 0.26rem 0.48rem !important;
              font-size: 0.58rem !important;
              line-height: 1.04 !important;
            }
            .landing-conversation-panel .landing-conversation-long-bubble ul {
              margin-top: 0.08rem !important;
            }
            .landing-conversation-panel .landing-conversation-caller-detail {
              margin-bottom: 0.45rem !important;
            }
            .landing-customer-text-body {
              font-size: 0.68rem !important;
              line-height: 1.08 !important;
            }
          }
          /* Final laptop pass: protect the sales/demo gutter and keep both outcomes above the fold. */
          .landing-hero-conversion-block {
            border-radius: 1rem !important;
            border-color: rgba(217, 29, 18, 0.18) !important;
            border-left-color: #d91d12 !important;
            background: linear-gradient(135deg, rgba(255, 248, 247, 0.94), rgba(255, 255, 255, 0.76)) !important;
          }
          .landing-hero-proof-heading {
            color: #123b68 !important;
            font-weight: 900 !important;
            letter-spacing: 0.1em !important;
          }
          .landing-call-owner-card,
          .landing-customer-text-card {
            border-width: 2px !important;
            border-color: #78dc73 !important;
          }
          @media (min-width: 1024px) and (max-width: 1535px) {
            .landing-hero-shell {
              max-width: 1365px !important;
              min-height: 100vh !important;
              padding: 0.65rem 1.5rem 0.75rem !important;
            }
            .landing-hero-shell nav {
              gap: 1rem !important;
            }
            .landing-hero-grid {
              grid-template-columns: minmax(390px, 0.72fr) minmax(0, 1.28fr) !important;
              gap: clamp(2.5rem, 3.6vw, 3.1rem) !important;
              align-items: center !important;
              padding-top: 0.35rem !important;
              padding-bottom: 0 !important;
            }
            .landing-hero-grid > div:first-child {
              display: block !important;
              width: 100% !important;
              max-width: 470px !important;
              min-height: 0 !important;
            }
            .landing-hero-title {
              margin-top: 0.5rem !important;
              font-size: clamp(2.55rem, 3.55vw, 3rem) !important;
              line-height: 0.98 !important;
            }
            .landing-hero-conversion-block {
              margin-top: 0.45rem !important;
              padding: 0.48rem 0.68rem !important;
            }
            .landing-hero-kicker {
              font-size: clamp(1.62rem, 2.35vw, 1.95rem) !important;
            }
            .landing-revenue-line {
              margin-top: 0.45rem !important;
              font-size: clamp(0.78rem, 1.05vw, 0.9rem) !important;
            }
            .landing-hero-copy {
              margin-top: 0.5rem !important;
              font-size: 0.9rem !important;
              line-height: 1.25 !important;
            }
            .landing-hero-points {
              gap: 0.34rem !important;
              margin-top: 0.65rem !important;
            }
            .landing-hero-point {
              min-height: 2.25rem !important;
              border-radius: 0.72rem !important;
              padding: 0.26rem 0.55rem 0.26rem 2.8rem !important;
              font-size: 0.8rem !important;
            }
            .landing-hero-point-icon {
              left: 0.04rem !important;
              width: 2.35rem !important;
              height: 2.35rem !important;
            }
            .landing-hero-point-icon svg {
              width: 1.12rem !important;
              height: 1.12rem !important;
            }
            .landing-hero-points::before {
              left: 1.18rem !important;
              top: 1.2rem !important;
              bottom: 1.2rem !important;
            }
            .landing-hero-ctas {
              gap: 0.55rem !important;
              margin-top: 0.7rem !important;
            }
            .landing-hero-cta {
              min-width: 0 !important;
              min-height: 2.55rem !important;
              flex: 1 1 0 !important;
              padding: 0.42rem 0.55rem !important;
              font-size: 0.82rem !important;
            }
            .landing-hero-trial-secondary {
              background: rgba(255, 255, 255, 0.82) !important;
              box-shadow: none !important;
            }
            .landing-hero-footnote {
              gap: 0.65rem !important;
              margin-top: 0.55rem !important;
              font-size: 0.7rem !important;
            }
            .landing-hero-visual {
              width: 100% !important;
              min-width: 0 !important;
              margin-top: 0 !important;
            }
            .landing-hero-proof-heading {
              margin-bottom: 0.35rem !important;
              padding: 0 0.3rem !important;
              font-size: 0.7rem !important;
            }
            .landing-call-dashboard {
              width: 100% !important;
              max-width: 700px !important;
              min-width: 0 !important;
            }
            .landing-call-dashboard > div {
              width: 100% !important;
              height: min(580px, calc(100vh - 112px)) !important;
              min-height: 540px !important;
              max-height: 580px !important;
              border-radius: 24px !important;
            }
            .landing-call-dashboard > div > div {
              height: 100% !important;
              min-height: 0 !important;
              max-height: none !important;
              grid-template-columns: minmax(250px, 0.82fr) minmax(0, 1.18fr) !important;
            }
            .landing-call-panel {
              min-width: 0 !important;
              padding: 0.85rem !important;
            }
            .landing-call-status {
              font-size: 0.82rem !important;
            }
            .landing-caller-card {
              margin-top: 0.65rem !important;
            }
            .landing-caller-avatar {
              width: 3.7rem !important;
              height: 3.7rem !important;
            }
            .landing-caller-name {
              margin-top: 0.55rem !important;
              font-size: 1.18rem !important;
              line-height: 1.05 !important;
            }
            .landing-caller-phone {
              position: relative !important;
              z-index: 2 !important;
              margin-top: 0.35rem !important;
              font-size: 1.02rem !important;
              line-height: 1.1 !important;
              white-space: nowrap !important;
            }
            .landing-caller-tag {
              margin-top: 0.5rem !important;
              max-width: 100% !important;
              padding: 0.42rem 0.65rem !important;
              font-size: 0.72rem !important;
              line-height: 1.15 !important;
            }
            .landing-call-owner-card {
              width: calc(100% + 0.4rem) !important;
              margin-top: 0.7rem !important;
              margin-right: -0.2rem !important;
              margin-left: -0.2rem !important;
              border-radius: 14px !important;
              padding: 0.65rem 0.72rem !important;
            }
            .landing-call-owner-title {
              font-size: 0.92rem !important;
            }
            .landing-call-owner-icon {
              width: 1.7rem !important;
              height: 1.7rem !important;
            }
            .landing-call-owner-body {
              display: grid !important;
              gap: 0.12rem !important;
              margin-top: 0.42rem !important;
              font-size: 0.72rem !important;
              line-height: 1.2 !important;
            }
            .landing-call-controls {
              display: none !important;
            }
            .landing-conversation-column {
              min-width: 0 !important;
              padding: 0.85rem !important;
            }
            .landing-conversation-header {
              gap: 0.65rem !important;
            }
            .landing-conversation-title {
              font-size: 1rem !important;
              line-height: 1.08 !important;
            }
            .landing-summary-ready-badge {
              padding: 0.38rem 0.55rem !important;
              font-size: 0.62rem !important;
            }
            .landing-conversation-panel {
              position: relative !important;
              flex: 0 0 auto !important;
              margin-top: 0.45rem !important;
              border-radius: 17px !important;
              padding: 0.55rem 0.68rem !important;
              overflow: visible !important;
            }
            .landing-conversation-panel > p:not(.landing-conversation-time) {
              margin-top: 0.4rem !important;
              font-size: 0.68rem !important;
              line-height: 1.05 !important;
            }
            .landing-conversation-panel > p:first-child {
              margin-top: 0 !important;
            }
            .landing-conversation-opening-label,
            .landing-conversation-opening,
            .landing-conversation-opening-time {
              display: none !important;
            }
            .landing-conversation-panel > div,
            .landing-conversation-panel .landing-conversation-long-bubble,
            .landing-conversation-panel .landing-conversation-caller-detail {
              max-width: 94% !important;
              margin-top: 0.28rem !important;
              border-radius: 11px !important;
              padding: 0.38rem 0.52rem !important;
              font-size: 0.76rem !important;
              line-height: 1.14 !important;
            }
            .landing-conversation-panel .landing-service-message {
              max-width: 98% !important;
            }
            .landing-service-badge {
              padding: 0.2rem 0.35rem !important;
              font-size: 0.55rem !important;
            }
            .landing-conversation-panel .landing-conversation-long-bubble ul {
              margin-top: 0.18rem !important;
              row-gap: 0 !important;
            }
            .landing-conversation-panel .landing-conversation-caller-detail {
              margin-bottom: 0 !important;
            }
            .landing-conversation-time {
              position: static !important;
              margin: 0.16rem 0 0 !important;
              padding: 0 !important;
              transform: none !important;
              font-size: 0.66rem !important;
              line-height: 1 !important;
              color: rgba(255, 255, 255, 0.68) !important;
            }
            .landing-dashboard-bottom {
              margin-top: 0.42rem !important;
            }
            .landing-lead-stack {
              gap: 0.3rem !important;
            }
            .landing-lead-note {
              justify-content: flex-start !important;
              gap: 0.5rem !important;
              font-size: 0.76rem !important;
              line-height: 1.1 !important;
            }
            .landing-lead-note svg {
              width: 2rem !important;
              height: 1.25rem !important;
            }
            .landing-customer-text-card {
              border-radius: 14px !important;
              padding: 0.58rem 0.72rem !important;
            }
            .landing-customer-text-title {
              font-size: 0.9rem !important;
            }
            .landing-message-icon {
              width: 1.7rem !important;
              height: 1.7rem !important;
            }
            .landing-customer-text-body {
              margin-top: 0.4rem !important;
              font-size: 0.74rem !important;
              line-height: 1.2 !important;
            }
          }
          /* Mobile homepage: one clear action, compact proof points, and an earlier demo. */
          @media (max-width: 639px) {
            .landing-hero-shell {
              min-height: 0 !important;
              padding: 0.75rem 0.9rem 1.25rem !important;
            }
            .landing-hero-shell nav {
              grid-template-columns: minmax(0, 1fr) auto !important;
              align-items: center !important;
              gap: 0.65rem !important;
            }
            .landing-hero-shell nav > div:first-child {
              min-width: 0 !important;
              gap: 0.5rem !important;
            }
            .landing-hero-shell nav > div:first-child > div:first-child {
              width: 2.55rem !important;
              height: 2.55rem !important;
            }
            .landing-hero-shell nav > div:first-child > div:last-child {
              font-size: clamp(1.45rem, 7.2vw, 1.75rem) !important;
              white-space: nowrap !important;
            }
            .landing-hero-shell nav > div:last-child {
              justify-self: end !important;
            }
            .landing-hero-shell nav > div:last-child button {
              min-width: 0 !important;
              border-radius: 0.75rem !important;
              padding: 0.72rem 0.82rem !important;
              font-size: 0.72rem !important;
              line-height: 1.05 !important;
            }
            .landing-hero-grid {
              gap: 0 !important;
              padding-top: 0.9rem !important;
              padding-bottom: 0 !important;
            }
            .landing-hero-label {
              gap: 0.55rem !important;
              border-radius: 0.85rem !important;
              padding: 0.35rem 0.55rem !important;
            }
            .landing-hero-label > span:first-child {
              width: 2.15rem !important;
              height: 2.15rem !important;
              border-radius: 0.65rem !important;
            }
            .landing-hero-label > span:first-child svg {
              width: 1.55rem !important;
              height: 1.55rem !important;
            }
            .landing-hero-label > span:last-child > span:first-child {
              font-size: clamp(0.75rem, 3.55vw, 0.86rem) !important;
            }
            .landing-hero-label > span:last-child > span:last-child {
              margin-top: 0.28rem !important;
              font-size: 0.57rem !important;
              letter-spacing: 0.17em !important;
            }
            .landing-hero-title {
              margin-top: 0.7rem !important;
              font-size: clamp(2rem, 9.6vw, 2.35rem) !important;
              line-height: 0.98 !important;
              letter-spacing: -0.055em !important;
            }
            .landing-hero-title > span:first-child {
              white-space: nowrap !important;
            }
            .landing-hero-title > span:last-child {
              padding-bottom: 0.2rem !important;
            }
            .landing-hero-conversion-block {
              margin-top: 0.65rem !important;
              padding: 0.65rem 0.75rem !important;
            }
            .landing-hero-kicker {
              font-size: clamp(1.36rem, 6.15vw, 1.55rem) !important;
              line-height: 1.02 !important;
              letter-spacing: -0.045em !important;
              white-space: nowrap !important;
            }
            .landing-revenue-line {
              display: flex !important;
              flex-wrap: wrap !important;
              justify-content: center !important;
              gap: 0.24rem 0.35rem !important;
              margin-top: 0.55rem !important;
              white-space: normal !important;
              font-size: clamp(0.65rem, 3.1vw, 0.74rem) !important;
              line-height: 1.1 !important;
              letter-spacing: -0.015em !important;
              text-align: center !important;
            }
            .landing-revenue-line > span:first-child {
              flex-basis: 100% !important;
            }
            .landing-revenue-line > span:nth-child(2) {
              margin: 0 !important;
            }
            .landing-hero-copy {
              margin-top: 0.7rem !important;
              font-size: 0.86rem !important;
              line-height: 1.25 !important;
              text-align: center !important;
            }
            .landing-hero-points {
              display: grid !important;
              gap: 0 !important;
              margin-top: 0.8rem !important;
              padding: 0 !important;
              overflow: hidden !important;
              border: 1px solid rgba(58, 135, 219, 0.3) !important;
              border-radius: 0.95rem !important;
              background: rgba(255, 255, 255, 0.78) !important;
              box-shadow: 0 14px 32px -28px rgba(12, 77, 160, 0.58) !important;
            }
            .landing-hero-points::before {
              display: none !important;
            }
            .landing-hero-point {
              position: relative !important;
              min-height: 3.1rem !important;
              flex-direction: row !important;
              align-items: center !important;
              gap: 0.62rem !important;
              border: 0 !important;
              border-radius: 0 !important;
              background: transparent !important;
              padding: 0.55rem 0.68rem !important;
              box-shadow: none !important;
              font-size: 0.76rem !important;
              line-height: 1.18 !important;
            }
            .landing-hero-point:not(:last-child) {
              border-bottom: 1px solid rgba(58, 135, 219, 0.2) !important;
            }
            .landing-hero-point-icon {
              position: static !important;
              width: 2.2rem !important;
              height: 2.2rem !important;
              transform: none !important;
              border-width: 1px !important;
            }
            .landing-hero-point-icon svg {
              width: 1.05rem !important;
              height: 1.05rem !important;
            }
            .landing-hero-point > span:last-child {
              min-width: 0 !important;
              line-height: 1.18 !important;
            }
            .landing-hero-ctas {
              margin-top: 0.8rem !important;
              gap: 0 !important;
            }
            .landing-hero-trial-secondary {
              display: none !important;
            }
            .landing-hero-cta {
              width: 100% !important;
              min-width: 0 !important;
              min-height: 2.85rem !important;
              padding: 0.55rem 0.85rem !important;
              font-size: 0.86rem !important;
            }
            .landing-hero-footnote {
              display: grid !important;
              grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
              gap: 0.35rem !important;
              margin-top: 0.65rem !important;
              white-space: normal !important;
              font-size: 0.64rem !important;
              line-height: 1.1 !important;
              letter-spacing: -0.025em !important;
              text-align: center !important;
            }
            .landing-hero-footnote > span {
              justify-content: center !important;
              white-space: nowrap !important;
            }
            .landing-hero-visual {
              margin-top: 1rem !important;
              justify-content: center !important;
            }
            .landing-hero-proof-heading {
              margin-bottom: 0.55rem !important;
              font-size: 0.64rem !important;
              line-height: 1.15 !important;
              letter-spacing: 0.08em !important;
            }
            .landing-call-dashboard {
              width: 100% !important;
              max-width: 360px !important;
            }
            .landing-call-dashboard > div {
              border-radius: 1.25rem !important;
            }
            .landing-call-panel {
              min-height: 0 !important;
              padding: 0.9rem !important;
            }
            .landing-caller-card {
              margin-top: 0.75rem !important;
            }
            .landing-caller-avatar {
              width: 3.8rem !important;
              height: 3.8rem !important;
            }
            .landing-caller-name {
              margin-top: 0.65rem !important;
              font-size: 1.3rem !important;
            }
            .landing-caller-phone {
              margin-top: 0.35rem !important;
              font-size: 0.96rem !important;
            }
            .landing-caller-tag {
              margin-top: 0.55rem !important;
              padding: 0.45rem 0.7rem !important;
              font-size: 0.72rem !important;
            }
            .landing-call-owner-card {
              margin-top: 0.75rem !important;
              padding: 0.75rem !important;
            }
            .landing-call-owner-title {
              font-size: 0.86rem !important;
            }
            .landing-call-owner-body {
              margin-top: 0.4rem !important;
              font-size: 0.68rem !important;
              line-height: 1.18 !important;
            }
            .landing-call-controls {
              display: none !important;
            }
            .landing-conversation-column {
              padding: 0.9rem !important;
            }
            .landing-conversation-header h3 {
              font-size: 1rem !important;
            }
            .landing-conversation-panel {
              margin-top: 0.65rem !important;
              padding: 0.72rem !important;
            }
            .landing-conversation-panel div {
              font-size: 0.72rem !important;
              line-height: 1.16 !important;
            }
            .landing-customer-text-card {
              min-height: 0 !important;
              padding: 0.85rem !important;
            }
            .landing-customer-text-title {
              font-size: 1rem !important;
            }
            .landing-customer-text-body {
              margin-top: 0.55rem !important;
              font-size: 0.76rem !important;
              line-height: 1.18 !important;
            }
          }
          @keyframes landing-live-call-sequence {
            0%, 100% {
              transform: scale(1);
              box-shadow: 0 0 12px rgba(0, 214, 111, 0.58);
            }
            6% {
              transform: scale(1.32);
              box-shadow: 0 0 22px rgba(0, 214, 111, 0.9);
            }
            13% {
              transform: scale(1);
              box-shadow: 0 0 14px rgba(0, 214, 111, 0.68);
            }
          }
          @keyframes landing-owner-route-sequence {
            0%, 14% {
              stroke-dashoffset: 1;
              opacity: 0.16;
            }
            31%, 86% {
              stroke-dashoffset: 0;
              opacity: 1;
            }
            96%, 100% {
              stroke-dashoffset: 0;
              opacity: 0.38;
            }
          }
          @keyframes landing-route-origin-sequence {
            0%, 12%, 100% {
              transform: scale(0.78);
              opacity: 0.45;
            }
            18%, 28% {
              transform: scale(1.28);
              opacity: 1;
            }
            36%, 88% {
              transform: scale(1);
              opacity: 0.9;
            }
          }
          @keyframes landing-owner-card-sequence {
            0%, 27%, 100% {
              transform: translateY(0);
              box-shadow: 0 0 0 1px rgba(34,197,94,0.16), 0 16px 38px -29px rgba(34,197,94,0.72);
            }
            35%, 45% {
              transform: translateY(-2px);
              box-shadow: 0 0 0 3px rgba(57,207,255,0.18), 0 18px 42px -26px rgba(34,197,94,0.88);
            }
            54%, 84% {
              transform: translateY(0);
              box-shadow: 0 0 0 1px rgba(34,197,94,0.2), 0 16px 38px -29px rgba(34,197,94,0.72);
            }
          }
          @keyframes landing-customer-route-sequence {
            0%, 48%, 100% {
              transform: translate(-3px, -1px);
              opacity: 0.48;
            }
            58%, 82% {
              transform: translate(0, 0);
              opacity: 1;
            }
          }
          @keyframes landing-customer-card-sequence {
            0%, 57%, 100% {
              transform: translateY(0);
              box-shadow: 0 14px 34px -31px rgba(34,197,94,0.68);
            }
            66%, 78% {
              transform: translateY(-2px);
              box-shadow: 0 0 0 3px rgba(34,197,94,0.15), 0 18px 42px -28px rgba(34,197,94,0.82);
            }
            87% {
              transform: translateY(0);
              box-shadow: 0 14px 34px -31px rgba(34,197,94,0.68);
            }
          }
          @keyframes landing-dialogue-reveal {
            from {
              opacity: 0;
              transform: translateY(7px) scale(0.985);
            }
            to {
              opacity: 1;
              transform: translateY(0) scale(1);
            }
          }
          @keyframes landing-card-turn-hint {
            0%, 100% {
              opacity: 0;
              transform: translateY(0.4rem);
            }
            22%, 72% {
              opacity: 1;
              transform: translateY(0);
            }
          }
          @keyframes landing-coffee-steam {
            0%, 100% {
              opacity: 0.45;
              transform: translateX(-50%) translateY(0);
            }
            50% {
              opacity: 0.95;
              transform: translateX(-50%) translateY(-0.18rem);
            }
          }
          .landing-dialogue-reveal {
            animation: landing-dialogue-reveal 380ms cubic-bezier(.2,.72,.2,1) both;
          }
          .landing-timed-call-face[aria-hidden="true"] {
            pointer-events: none;
            opacity: 0;
            transition: opacity 180ms ease;
          }
          .landing-timed-call-face[aria-hidden="false"] {
            opacity: 1;
            transition: opacity 220ms ease 220ms;
          }
          .landing-card-turn-hint {
            opacity: 0;
          }
          .landing-card-turn-hint-visible {
            animation: landing-card-turn-hint 1.4s ease-in-out 1 both;
          }
          .landing-carousel-actions {
            min-height: 2.75rem;
          }
          .landing-carousel-controls {
            min-height: 5.8rem;
          }
          .landing-carousel-timing {
            min-height: 1.65rem;
          }
          .landing-carousel-primary,
          .landing-carousel-secondary {
            min-width: 0;
            min-height: 2.75rem;
            padding: 0.55rem 0.45rem;
            font-size: 0.72rem;
            line-height: 1.05;
          }
          .landing-text-phone-grid {
            flex: 1 1 auto;
            min-height: 0;
            align-items: stretch;
          }
          .landing-text-phone-holder {
            position: relative;
            min-width: 0;
            min-height: 0;
            isolation: isolate;
          }
          .landing-text-phone {
            position: relative;
            z-index: 2;
            height: 100%;
            min-height: 0;
            overflow: visible !important;
            padding: 0.48rem 0.48rem 3.35rem !important;
            border-width: 3px !important;
            border-radius: 1.35rem !important;
          }
          .landing-text-phone > div:first-child {
            font-size: 0.48rem !important;
          }
          .landing-text-phone > div:nth-child(2) {
            gap: 0.42rem !important;
            margin-top: 0.35rem !important;
            padding: 0 0.2rem 0.42rem !important;
          }
          .landing-text-phone > div:nth-child(2) > span:first-child {
            width: 1.75rem !important;
            height: 1.75rem !important;
            font-size: 0.56rem !important;
          }
          .landing-text-phone strong {
            font-size: 0.64rem !important;
          }
          .landing-text-phone small {
            font-size: 0.48rem !important;
          }
          .landing-text-bubble {
            position: relative;
            z-index: 2;
            margin-top: 0.5rem !important;
            padding: 0.55rem 0.58rem !important;
            font-size: 0.64rem !important;
            line-height: 1.25 !important;
          }
          .landing-text-bubble-customer {
            margin-left: 0.35rem !important;
          }
          .landing-reading-hand {
            position: absolute;
            z-index: 4;
            bottom: -1.72rem;
            display: block;
            width: 6.15rem;
            height: 6.15rem;
            pointer-events: none;
            filter: drop-shadow(0 6px 5px rgba(15, 23, 42, 0.28));
          }
          .landing-reading-hand-left {
            left: -0.8rem;
          }
          .landing-reading-hand-right {
            left: -0.8rem;
          }
          .landing-reading-hand svg {
            display: block;
            width: 100%;
            height: 100%;
            overflow: visible;
          }
          .landing-reading-hand-shape {
            fill: #f2b58a;
            stroke: #8b4b32;
            stroke-width: 2.2;
            stroke-linecap: round;
            stroke-linejoin: round;
          }
          .landing-reading-hand-cuff {
            fill: #123c6e;
            stroke: #071b36;
            stroke-width: 2;
          }
          .landing-reading-hand-detail {
            fill: none;
            stroke: rgba(139, 75, 50, 0.72);
            stroke-width: 1.8;
            stroke-linecap: round;
          }
          .landing-reading-hand-nails {
            fill: none;
            stroke: rgba(255, 231, 216, 0.88);
            stroke-width: 2.1;
            stroke-linecap: round;
          }
          .landing-reading-hand-grip-shadow {
            fill: rgba(3, 13, 29, 0.24);
          }
          .landing-desktop-call-proof {
            height: 38rem !important;
            margin-top: 0 !important;
          }
          .landing-desktop-call-proof .landing-mobile-call-prism {
            height: calc(100% - 6.3rem) !important;
          }
          .landing-desktop-call-proof .landing-timed-call-face {
            padding: 1.4rem !important;
            border-radius: 2rem !important;
          }
          .landing-desktop-call-proof .landing-timed-call-status {
            font-size: 0.82rem !important;
          }
          .landing-desktop-call-proof .landing-timed-call-agent-row {
            gap: 1rem !important;
            margin-top: 1rem !important;
          }
          .landing-desktop-call-proof .landing-timed-call-avatar-wrap {
            width: 6.4rem !important;
            height: 6.4rem !important;
          }
          .landing-desktop-call-proof .landing-timed-call-avatar {
            width: 5.8rem !important;
            height: 5.8rem !important;
          }
          .landing-desktop-call-proof .landing-timed-call-agent {
            font-size: 1.8rem !important;
          }
          .landing-desktop-call-proof .landing-timed-call-subtitle {
            font-size: 0.9rem !important;
          }
          .landing-desktop-call-proof .landing-timed-conversation {
            margin-top: 1rem !important;
          }
          .landing-desktop-call-proof .landing-timed-conversation-turn {
            padding: 0.72rem 0.9rem !important;
          }
          .landing-desktop-call-proof .landing-timed-conversation-turn > p {
            font-size: 0.86rem !important;
          }
          .landing-desktop-call-proof .landing-timed-call-back-title {
            margin-top: 0.9rem !important;
            font-size: 1.75rem !important;
          }
          .landing-desktop-call-proof .landing-timed-call-back-intro {
            font-size: 0.82rem !important;
          }
          .landing-desktop-call-proof .landing-text-phone-grid {
            flex: 0 0 14.5rem !important;
            height: 14.5rem !important;
            gap: 0.9rem !important;
            margin-top: 0.9rem !important;
          }
          .landing-desktop-call-proof .landing-text-phone {
            padding: 0.65rem 0.65rem 4rem !important;
            border-radius: 1.65rem !important;
          }
          .landing-desktop-call-proof .landing-text-phone strong {
            font-size: 0.74rem !important;
          }
          .landing-desktop-call-proof .landing-text-phone small {
            font-size: 0.56rem !important;
          }
          .landing-desktop-call-proof .landing-text-bubble {
            padding: 0.65rem 0.7rem !important;
            font-size: 0.72rem !important;
            line-height: 1.28 !important;
          }
          .landing-desktop-call-proof .landing-reading-hand {
            bottom: -1.85rem;
            width: 6.7rem;
            height: 6.35rem;
          }
          .landing-desktop-call-proof .landing-reading-hand-left,
          .landing-desktop-call-proof .landing-reading-hand-right {
            left: -0.95rem;
            right: auto;
          }
          .landing-desktop-call-proof .landing-timed-call-benefits {
            display: flex !important;
            flex-direction: column;
            justify-content: center;
            padding: 2rem !important;
          }
          .landing-desktop-call-proof .landing-timed-benefits-title {
            margin-top: 1rem !important;
            font-size: 1.5rem !important;
          }
          .landing-desktop-call-proof .landing-timed-benefits-list {
            margin-top: 1.2rem !important;
          }
          .landing-desktop-call-proof .landing-timed-benefits-row {
            min-height: 3.7rem;
            grid-template-columns: 3rem minmax(0, 1fr) !important;
            padding: 0.72rem 0.9rem !important;
          }
          .landing-desktop-call-proof .landing-timed-benefits-icon {
            width: 2.7rem !important;
            height: 2.7rem !important;
          }
          .landing-desktop-call-proof .landing-timed-benefits-copy {
            font-size: 0.86rem !important;
          }
          .landing-desktop-call-proof .landing-carousel-actions {
            min-height: 3.5rem;
            gap: 0.8rem;
          }
          .landing-desktop-call-proof .landing-carousel-timing {
            font-size: 0.69rem;
            letter-spacing: 0.06em;
          }
          .landing-desktop-call-proof .landing-carousel-primary,
          .landing-desktop-call-proof .landing-carousel-secondary {
            min-height: 3.5rem;
            font-size: 0.9rem;
          }
          .landing-coffee-line {
            overflow: visible !important;
          }
          .landing-coffee-mark {
            position: relative;
            display: inline-block;
            margin-inline: 0.06em;
            padding-top: 0.72em;
            white-space: nowrap;
          }
          .landing-coffee-underline {
            position: absolute;
            right: -0.1em;
            bottom: -0.22em;
            left: -0.1em;
            width: calc(100% + 0.2em);
            height: 0.7em;
            overflow: visible;
          }
          .landing-coffee-underline path {
            fill: none;
            stroke: #d3241d;
            stroke-width: 3.4;
            stroke-linecap: round;
            opacity: 0.9;
          }
          .landing-coffee-underline path + path {
            stroke-width: 1.5;
            opacity: 0.46;
          }
          .landing-coffee-steam {
            position: absolute;
            bottom: calc(100% - 0.7em);
            left: 50%;
            width: 4.3em;
            height: 1.7em;
            color: #d3241d;
            pointer-events: none;
            animation: landing-coffee-steam 2.4s ease-in-out infinite;
          }
          .landing-coffee-steam svg {
            display: block;
            width: 100%;
            height: 100%;
            overflow: visible;
          }
          .landing-coffee-steam path {
            fill: none;
            stroke: currentColor;
            stroke-width: 3.2;
            stroke-linecap: round;
          }
          .landing-stripe-headline {
            position: relative;
            z-index: 0;
            isolation: isolate;
            display: block;
            padding: 0.2em 0.13em 0.27em;
            -webkit-text-stroke: 0.7px rgba(87, 205, 255, 0.78);
            text-shadow:
              0 2px 0 rgba(7, 20, 42, 0.28),
              0 8px 15px rgba(7, 20, 42, 0.26),
              0 0 10px rgba(72, 191, 244, 0.48),
              0 0 24px rgba(72, 191, 244, 0.25);
          }
          .landing-stripe-headline::before,
          .landing-stripe-headline::after {
            content: "";
            position: absolute;
            inset: 0.08em -0.22em 0.02em;
            pointer-events: none;
            clip-path: polygon(2% 22%, 98% 0, 94% 80%, 5% 100%);
          }
          .landing-stripe-headline::before {
            z-index: -2;
            background:
              radial-gradient(circle at 8% 35%, rgba(47, 128, 237, 0.24), transparent 36%),
              radial-gradient(circle at 48% 68%, rgba(42, 201, 214, 0.18), transparent 44%),
              radial-gradient(circle at 88% 30%, rgba(87, 134, 255, 0.2), transparent 38%),
              rgba(248, 252, 255, 0.92);
            border-block: 1px solid rgba(81, 151, 214, 0.22);
            box-shadow:
              0 12px 28px -26px rgba(7, 54, 104, 0.42),
              inset 0 0 22px rgba(255, 255, 255, 0.5);
            opacity: 0.94;
          }
          .landing-stripe-headline::after {
            z-index: -1;
            background: linear-gradient(
              100deg,
              rgba(255, 255, 255, 0.42),
              transparent 36% 68%,
              rgba(255, 255, 255, 0.28)
            );
            opacity: 0.38;
          }
          .landing-chalk-pain {
            width: fit-content;
            margin-inline: auto;
            color: #c8241d !important;
            background: linear-gradient(180deg, #ed493c 0%, #ca251e 54%, #981712 100%);
            background-clip: text;
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            font-family: "Arial Narrow", "Segoe UI Variable Display", "Segoe UI", sans-serif;
            font-weight: 900 !important;
            font-stretch: condensed;
            letter-spacing: -0.035em !important;
            -webkit-text-stroke: 0.4px rgba(119, 18, 14, 0.46);
            text-shadow:
              0 1px 0 rgba(255, 176, 164, 0.68),
              0 2px 0 rgba(118, 19, 15, 0.2),
              0 7px 15px rgba(126, 25, 20, 0.16);
          }
          .landing-call-live-dot {
            transform-origin: center;
            animation: landing-live-call-sequence 7.2s ease-in-out infinite;
          }
          .landing-hero-owner-arrow-path {
            stroke-dasharray: 1;
            stroke-dashoffset: 1;
            animation: landing-owner-route-sequence 7.2s ease-in-out infinite;
          }
          .landing-hero-owner-arrow-origin {
            transform-box: fill-box;
            transform-origin: center;
            animation: landing-route-origin-sequence 7.2s ease-in-out infinite;
          }
          .landing-call-owner-card {
            will-change: transform, box-shadow;
            animation: landing-owner-card-sequence 7.2s ease-in-out infinite;
          }
          .landing-lead-note svg {
            will-change: transform, opacity;
            animation: landing-customer-route-sequence 7.2s ease-in-out infinite;
          }
          .landing-customer-text-card {
            will-change: transform, box-shadow;
            animation: landing-customer-card-sequence 7.2s ease-in-out infinite;
          }
          @media (prefers-reduced-motion: reduce) {
            .landing-mobile-call-prism {
              transition: none !important;
            }
            .landing-card-turn-hint {
              animation: none !important;
              opacity: 0 !important;
            }
            .landing-dialogue-reveal {
              animation: none !important;
            }
            .landing-reading-hand,
            .landing-coffee-steam {
              animation: none !important;
            }
            .landing-call-live-dot,
            .landing-hero-owner-arrow-path,
            .landing-hero-owner-arrow-origin,
            .landing-call-owner-card,
            .landing-lead-note svg,
            .landing-customer-text-card {
              animation: none !important;
              transform: none !important;
              opacity: 1 !important;
            }
            .landing-hero-owner-arrow-path {
              stroke-dashoffset: 0 !important;
            }
          }

          /* Approved homepage hierarchy: retain the live diagram, simplify the sales copy, and make both texts read like familiar message bubbles. */
          .landing-hero-points-clean {
            gap: 0.72rem !important;
            padding-left: 0 !important;
          }
          .landing-hero-points-clean::before {
            display: none !important;
          }
          .landing-hero-points-clean .landing-hero-point-clean {
            display: grid !important;
            grid-template-columns: 2rem minmax(0, 1fr) !important;
            column-gap: 0.75rem !important;
            min-height: 0 !important;
            border: 0 !important;
            border-radius: 0 !important;
            padding: 0 !important;
            background: transparent !important;
            box-shadow: none !important;
          }
          .landing-hero-points-clean .landing-hero-point-check {
            position: static !important;
            top: auto !important;
            left: auto !important;
            width: 2rem !important;
            height: 2rem !important;
            transform: none !important;
          }
          .landing-hero-points-clean .landing-hero-point-clean > span:last-child {
            line-height: 1.25 !important;
          }
          .landing-imessage-card {
            overflow: hidden !important;
            border-width: 1px !important;
            border-color: #d1d1d6 !important;
            padding: 0 !important;
            color: #111111 !important;
            background: #ffffff !important;
            box-shadow: 0 10px 26px -18px rgba(0, 0, 0, 0.55) !important;
            font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif;
          }
          .landing-imessage-preview-title {
            color: #111111 !important;
            font-size: 0.68rem !important;
            line-height: 1.05 !important;
          }
          .landing-imessage-contact {
            width: 1.75rem !important;
            height: 1.75rem !important;
            font-size: 0.58rem !important;
            line-height: 1 !important;
          }
          .landing-imessage-preview-meta {
            font-size: 0.5rem !important;
            line-height: 1 !important;
          }
          .landing-imessage-bubble {
            width: fit-content;
            max-width: 96%;
            font-size: 0.62rem !important;
            line-height: 1.18 !important;
          }
          .landing-imessage-bubble-sent {
            margin-left: auto !important;
          }
          .landing-imessage-delivered {
            font-size: 0.43rem !important;
            line-height: 1 !important;
          }
          @media (min-width: 1024px) {
            .landing-hero-copy-column {
              margin-left: 0.625rem;
            }
          }
          /* Preserve the desktop hero on full-width iPads, including Safari viewports
             that report slightly less than Tailwind's 1024px desktop breakpoint. */
          @media (min-width: 900px) and (max-width: 1279px) and (orientation: landscape) {
            .landing-hero-shell {
              min-height: 100vh !important;
              max-width: none !important;
              padding: 0.65rem 1.25rem 0.8rem !important;
            }
            .landing-hero-shell nav {
              grid-template-columns: auto 1fr auto !important;
              align-items: center !important;
              gap: 1rem !important;
            }
            .landing-hero-shell nav > div:nth-child(2) {
              display: block !important;
              justify-self: center !important;
            }
            .landing-hero-shell nav > div:last-child {
              justify-self: end !important;
            }
            .landing-hero-grid {
              display: grid !important;
              grid-template-columns: minmax(330px, 0.72fr) minmax(0, 1.28fr) !important;
              align-items: center !important;
              gap: clamp(1rem, 2.2vw, 1.75rem) !important;
              padding-top: 0.35rem !important;
              padding-bottom: 0 !important;
            }
            .landing-hero-grid > div:first-child {
              display: block !important;
              width: 100% !important;
              max-width: 430px !important;
              min-height: 0 !important;
            }
            .landing-hero-copy-column {
              margin-left: 0 !important;
              transform: none !important;
            }
            .landing-hero-title {
              margin-top: 0 !important;
              font-size: clamp(2.35rem, 4.25vw, 3rem) !important;
              line-height: 0.98 !important;
            }
            .landing-hero-coverage {
              margin-top: 0.75rem !important;
            }
            .landing-hero-points-clean {
              margin-top: 0.85rem !important;
              gap: 0.52rem !important;
            }
            .landing-hero-points-clean .landing-hero-point-clean {
              grid-template-columns: 1.8rem minmax(0, 1fr) !important;
              column-gap: 0.6rem !important;
              font-size: 0.8rem !important;
            }
            .landing-hero-points-clean .landing-hero-point-check {
              width: 1.8rem !important;
              height: 1.8rem !important;
            }
            .landing-hero-actions {
              margin-top: 0.85rem !important;
            }
            .landing-hero-trust {
              margin-top: 0.55rem !important;
              gap: 0.35rem 0.65rem !important;
              font-size: 0.65rem !important;
            }
            .landing-hero-visual,
            .landing-hero-proof-wrap,
            .landing-call-dashboard {
              display: flex !important;
              width: 100% !important;
              min-width: 0 !important;
              max-width: none !important;
              visibility: visible !important;
              opacity: 1 !important;
            }
            .landing-hero-visual {
              margin-top: 0 !important;
              transform: none !important;
            }
            .landing-hero-proof-wrap {
              flex-direction: column !important;
            }
            .landing-call-dashboard > div {
              display: block !important;
              width: 100% !important;
              height: min(580px, calc(100vh - 112px)) !important;
              min-height: 540px !important;
              max-height: 580px !important;
              visibility: visible !important;
              opacity: 1 !important;
            }
            .landing-call-dashboard > div > div {
              display: grid !important;
              height: 100% !important;
              min-height: 0 !important;
              max-height: none !important;
              grid-template-columns: minmax(235px, 0.82fr) minmax(0, 1.18fr) !important;
            }
            .landing-call-panel,
            .landing-conversation-column {
              display: flex !important;
              height: 100% !important;
              min-height: 0 !important;
              visibility: visible !important;
            }
            .landing-caller-card,
            .landing-caller-avatar,
            .landing-caller-avatar img {
              display: block !important;
              visibility: visible !important;
              opacity: 1 !important;
            }
            .landing-caller-avatar {
              width: 4.1rem !important;
              height: 4.1rem !important;
            }
            .landing-call-controls {
              display: none !important;
            }
          }
          @media (min-width: 900px) and (max-width: 1023px) and (orientation: landscape) {
            .landing-hero-grid {
              grid-template-columns: minmax(285px, 0.65fr) minmax(0, 1.35fr) !important;
            }
            .landing-call-dashboard > div > div {
              grid-template-columns: minmax(205px, 0.72fr) minmax(0, 1.28fr) !important;
            }
            .landing-call-panel,
            .landing-conversation-column {
              padding: 0.72rem !important;
            }
            .landing-call-status {
              font-size: 0.76rem !important;
            }
            .landing-caller-card {
              margin-top: 0.5rem !important;
            }
            .landing-caller-avatar {
              width: 3.25rem !important;
              height: 3.25rem !important;
            }
            .landing-caller-name {
              margin-top: 0.45rem !important;
              font-size: 1rem !important;
              line-height: 1.02 !important;
            }
            .landing-caller-phone {
              margin-top: 0.3rem !important;
              font-size: 0.88rem !important;
              line-height: 1 !important;
              white-space: nowrap !important;
            }
            .landing-caller-tag {
              margin-top: 0.42rem !important;
              max-width: 100% !important;
              padding: 0.36rem 0.48rem !important;
              font-size: 0.62rem !important;
              line-height: 1.08 !important;
            }
            .landing-call-owner-card {
              width: 100% !important;
              margin: 0.58rem 0 0 !important;
              border-radius: 13px !important;
            }
            .landing-imessage-preview {
              padding: 0.55rem !important;
            }
            .landing-imessage-preview-title {
              font-size: 0.6rem !important;
            }
            .landing-imessage-preview-meta {
              font-size: 0.46rem !important;
            }
            .landing-imessage-bubble {
              max-width: 100% !important;
              padding: 0.46rem 0.52rem !important;
              font-size: 0.52rem !important;
              line-height: 1.12 !important;
            }
            .landing-conversation-header {
              gap: 0.45rem !important;
            }
            .landing-conversation-title {
              font-size: 0.9rem !important;
              line-height: 1.04 !important;
            }
            .landing-summary-ready-badge {
              padding: 0.32rem 0.45rem !important;
              font-size: 0.55rem !important;
            }
            .landing-conversation-panel {
              position: relative !important;
              flex: 0 0 auto !important;
              margin-top: 0.38rem !important;
              border-radius: 15px !important;
              padding: 0.48rem 0.56rem !important;
              overflow: visible !important;
            }
            .landing-conversation-opening-label,
            .landing-conversation-opening,
            .landing-conversation-opening-time {
              display: none !important;
            }
            .landing-conversation-panel > p:not(.landing-conversation-time) {
              margin-top: 0.28rem !important;
              font-size: 0.6rem !important;
              line-height: 1.02 !important;
            }
            .landing-conversation-panel > p:first-child {
              margin-top: 0 !important;
            }
            .landing-conversation-panel > div,
            .landing-conversation-panel .landing-conversation-long-bubble,
            .landing-conversation-panel .landing-conversation-caller-detail {
              max-width: 96% !important;
              margin-top: 0.24rem !important;
              border-radius: 10px !important;
              padding: 0.34rem 0.44rem !important;
              font-size: 0.64rem !important;
              line-height: 1.08 !important;
            }
            .landing-conversation-panel .landing-service-message {
              max-width: 100% !important;
            }
            .landing-service-badge {
              padding: 0.16rem 0.28rem !important;
              font-size: 0.48rem !important;
            }
            .landing-conversation-panel .landing-conversation-long-bubble ul {
              margin-top: 0.12rem !important;
              row-gap: 0 !important;
            }
            .landing-conversation-panel .landing-conversation-caller-detail {
              margin-bottom: 0 !important;
            }
            .landing-conversation-time {
              position: static !important;
              margin: 0.12rem 0 0 !important;
              padding: 0 !important;
              transform: none !important;
              font-size: 0.56rem !important;
              line-height: 1 !important;
            }
            .landing-dashboard-bottom {
              margin-top: 0.34rem !important;
              flex: 0 0 auto !important;
            }
            .landing-lead-stack {
              height: auto !important;
              grid-template-rows: auto auto !important;
              align-content: start !important;
            }
            .landing-lead-note {
              gap: 0.36rem !important;
              font-size: 0.64rem !important;
              line-height: 1.05 !important;
            }
            .landing-lead-note svg {
              width: 1.7rem !important;
              height: 1.05rem !important;
            }
            .landing-customer-text-card {
              flex: 0 0 auto !important;
              height: auto !important;
              border-radius: 13px !important;
              padding: 0.5rem 0.58rem !important;
            }
            .landing-customer-text-title {
              font-size: 0.72rem !important;
            }
            .landing-customer-text-body {
              margin-top: 0.3rem !important;
              font-size: 0.6rem !important;
              line-height: 1.1 !important;
            }
          }
          /* The 1024px-wide iPad portrait viewport must not inherit the tall,
             vertically-centred desktop canvas. Keep the same two-column hero and
             full right-side visual, but place it directly below the navigation. */
          @media (min-width: 1024px) and (max-width: 1100px) and (orientation: portrait) {
            .landing-hero-shell {
              min-height: 0 !important;
              max-width: none !important;
              padding: 0.75rem 1.5rem 1.5rem !important;
            }
            .landing-hero-grid {
              flex: 0 0 auto !important;
              grid-template-columns: minmax(360px, 0.72fr) minmax(0, 1.28fr) !important;
              align-items: start !important;
              gap: 1.35rem !important;
              padding-top: 2.25rem !important;
              padding-bottom: 0 !important;
            }
            .landing-hero-grid > div:first-child {
              width: 100% !important;
              max-width: 390px !important;
              min-height: 0 !important;
            }
            .landing-hero-copy-column {
              margin-left: 0 !important;
              transform: none !important;
            }
            .landing-hero-title {
              margin-top: 1.15rem !important;
              font-size: 2.7rem !important;
              line-height: 0.98 !important;
            }
            .landing-hero-visual {
              align-self: start !important;
              margin-top: 0 !important;
              transform: none !important;
            }
            .landing-hero-proof-wrap,
            .landing-call-dashboard {
              display: block !important;
              width: 100% !important;
              max-width: none !important;
              visibility: visible !important;
              opacity: 1 !important;
            }
            .landing-call-dashboard > div {
              height: 580px !important;
              min-height: 580px !important;
              max-height: 580px !important;
            }
            .landing-caller-card,
            .landing-caller-avatar,
            .landing-caller-avatar img {
              display: block !important;
              visibility: visible !important;
              opacity: 1 !important;
            }
          }
          /* Standard iPad portrait widths (810px, 820px and 834px): retain the
             desktop side-by-side story instead of switching to the old stacked artboard. */
          @media (min-width: 768px) and (max-width: 1023px) and (orientation: portrait) {
            .landing-hero-shell {
              min-height: 0 !important;
              max-width: none !important;
              padding: 0.75rem 1.25rem 1.35rem !important;
            }
            .landing-hero-shell nav {
              grid-template-columns: auto 1fr auto !important;
              align-items: center !important;
              gap: 0.7rem !important;
            }
            .landing-hero-shell nav > div:nth-child(2) {
              display: block !important;
              justify-self: center !important;
            }
            .landing-hero-shell nav > div:nth-child(2) a {
              gap: 0.5rem !important;
              padding: 0.45rem 0.6rem !important;
            }
            .landing-hero-shell nav > div:nth-child(2) a > span:first-child {
              width: 2rem !important;
              height: 2rem !important;
            }
            .landing-hero-shell nav > div:nth-child(2) a > span:last-child > span:first-child {
              font-size: 0.52rem !important;
            }
            .landing-hero-shell nav > div:nth-child(2) a > span:last-child > span:last-child {
              font-size: 0.76rem !important;
            }
            .landing-hero-shell nav > div:last-child {
              justify-self: end !important;
            }
            .landing-hero-shell nav > div:last-child button {
              min-width: 0 !important;
              padding: 0.72rem 0.85rem !important;
              font-size: 0.72rem !important;
            }
            .landing-hero-grid {
              display: grid !important;
              flex: 0 0 auto !important;
              grid-template-columns: minmax(255px, 0.64fr) minmax(0, 1.36fr) !important;
              align-items: start !important;
              gap: 0.85rem !important;
              padding-top: 1.25rem !important;
              padding-bottom: 0 !important;
            }
            .landing-hero-grid > div:first-child {
              display: block !important;
              width: 100% !important;
              max-width: none !important;
              min-height: 0 !important;
            }
            .landing-hero-copy-column {
              margin-left: 0 !important;
              transform: none !important;
            }
            .landing-hero-title {
              margin-top: 0.8rem !important;
              font-size: clamp(2rem, 4.8vw, 2.45rem) !important;
              line-height: 0.98 !important;
            }
            .landing-hero-title > span:nth-child(2) {
              margin-top: 0.75rem !important;
              font-size: 0.5em !important;
            }
            .landing-hero-coverage {
              margin-top: 0.75rem !important;
              padding: 0.48rem 0.6rem !important;
              font-size: 0.78rem !important;
            }
            .landing-hero-points-clean {
              grid-template-columns: minmax(0, 1fr) !important;
              margin-top: 0.8rem !important;
              gap: 0.42rem !important;
            }
            .landing-hero-points-clean .landing-hero-point-clean {
              grid-template-columns: 1.55rem minmax(0, 1fr) !important;
              column-gap: 0.48rem !important;
              min-height: 0 !important;
              padding: 0 !important;
              font-size: 0.67rem !important;
              line-height: 1.16 !important;
            }
            .landing-hero-points-clean .landing-hero-point-check {
              width: 1.55rem !important;
              height: 1.55rem !important;
              font-size: 0.7rem !important;
            }
            .landing-hero-actions {
              margin-top: 0.8rem !important;
            }
            .landing-hero-actions > div:first-child {
              flex-direction: row !important;
              gap: 0.45rem !important;
            }
            .landing-hero-cta {
              min-width: 0 !important;
              min-height: 2.5rem !important;
              flex: 1 1 0 !important;
              padding: 0.4rem 0.45rem !important;
              font-size: 0.68rem !important;
            }
            .landing-hero-trust {
              justify-content: flex-start !important;
              gap: 0.3rem 0.55rem !important;
              margin-top: 0.48rem !important;
              font-size: 0.55rem !important;
              line-height: 1.1 !important;
            }
            .landing-hero-visual {
              display: flex !important;
              align-self: start !important;
              width: 100% !important;
              min-width: 0 !important;
              max-width: none !important;
              margin: 0 !important;
              transform: none !important;
              visibility: visible !important;
              opacity: 1 !important;
            }
            .landing-hero-proof-wrap,
            .landing-call-dashboard {
              display: flex !important;
              width: 100% !important;
              min-width: 0 !important;
              max-width: none !important;
              visibility: visible !important;
              opacity: 1 !important;
            }
            .landing-hero-proof-wrap {
              flex-direction: column !important;
            }
            .landing-hero-proof-heading {
              margin-bottom: 0.3rem !important;
              font-size: 0.54rem !important;
              line-height: 1.1 !important;
            }
            .landing-call-dashboard > div {
              display: block !important;
              width: 100% !important;
              height: 390px !important;
              min-height: 390px !important;
              max-height: 390px !important;
              border-radius: 20px !important;
              visibility: visible !important;
              opacity: 1 !important;
            }
            .landing-call-dashboard > div > div {
              display: grid !important;
              height: 100% !important;
              min-height: 0 !important;
              max-height: none !important;
              grid-template-columns: minmax(150px, 0.7fr) minmax(0, 1.3fr) !important;
            }
            .landing-call-panel,
            .landing-conversation-column {
              display: flex !important;
              height: 100% !important;
              min-height: 0 !important;
              padding: 0.58rem !important;
              visibility: visible !important;
            }
            .landing-call-status {
              font-size: 0.62rem !important;
            }
            .landing-call-live-dot {
              width: 0.62rem !important;
              height: 0.62rem !important;
            }
            .landing-caller-card {
              display: block !important;
              margin-top: 0.42rem !important;
              visibility: visible !important;
              opacity: 1 !important;
            }
            .landing-caller-avatar,
            .landing-caller-avatar img {
              display: block !important;
              visibility: visible !important;
              opacity: 1 !important;
            }
            .landing-caller-avatar {
              width: 2.8rem !important;
              height: 2.8rem !important;
            }
            .landing-caller-name {
              margin-top: 0.4rem !important;
              font-size: 0.82rem !important;
              line-height: 1.02 !important;
            }
            .landing-caller-phone {
              margin-top: 0.25rem !important;
              font-size: 0.7rem !important;
              line-height: 1 !important;
              white-space: nowrap !important;
            }
            .landing-caller-tag {
              margin-top: 0.34rem !important;
              max-width: 100% !important;
              padding: 0.3rem 0.36rem !important;
              font-size: 0.5rem !important;
              line-height: 1.06 !important;
            }
            .landing-call-owner-card {
              width: 100% !important;
              margin: 0.48rem 0 0 !important;
              border-radius: 11px !important;
            }
            .landing-imessage-preview {
              padding: 0.46rem !important;
            }
            .landing-imessage-contact {
              width: 1.35rem !important;
              height: 1.35rem !important;
              font-size: 0.42rem !important;
            }
            .landing-imessage-preview-title {
              font-size: 0.5rem !important;
            }
            .landing-imessage-preview-meta {
              font-size: 0.39rem !important;
            }
            .landing-imessage-bubble {
              max-width: 100% !important;
              padding: 0.38rem 0.4rem !important;
              font-size: 0.43rem !important;
              line-height: 1.08 !important;
            }
            .landing-call-controls {
              display: none !important;
            }
            .landing-conversation-header {
              gap: 0.35rem !important;
            }
            .landing-conversation-title {
              font-size: 0.72rem !important;
              line-height: 1.02 !important;
            }
            .landing-summary-ready-badge {
              padding: 0.25rem 0.34rem !important;
              font-size: 0.43rem !important;
            }
            .landing-conversation-panel {
              position: relative !important;
              flex: 0 0 auto !important;
              margin-top: 0.3rem !important;
              border-radius: 12px !important;
              padding: 0.38rem 0.42rem !important;
              overflow: visible !important;
            }
            .landing-conversation-opening-label,
            .landing-conversation-opening,
            .landing-conversation-opening-time {
              display: none !important;
            }
            .landing-conversation-panel > p:not(.landing-conversation-time) {
              margin-top: 0.2rem !important;
              font-size: 0.48rem !important;
              line-height: 1 !important;
            }
            .landing-conversation-panel > p:first-child {
              margin-top: 0 !important;
            }
            .landing-conversation-panel > div,
            .landing-conversation-panel .landing-conversation-long-bubble,
            .landing-conversation-panel .landing-conversation-caller-detail {
              max-width: 97% !important;
              margin-top: 0.18rem !important;
              border-radius: 8px !important;
              padding: 0.26rem 0.32rem !important;
              font-size: 0.51rem !important;
              line-height: 1.04 !important;
            }
            .landing-conversation-panel .landing-service-message {
              max-width: 100% !important;
            }
            .landing-service-badge {
              padding: 0.12rem 0.2rem !important;
              font-size: 0.38rem !important;
            }
            .landing-conversation-panel .landing-conversation-long-bubble ul {
              margin-top: 0.08rem !important;
              row-gap: 0 !important;
            }
            .landing-conversation-panel .landing-conversation-caller-detail {
              margin-bottom: 0 !important;
            }
            .landing-conversation-time {
              position: static !important;
              margin: 0.08rem 0 0 !important;
              padding: 0 !important;
              transform: none !important;
              font-size: 0.42rem !important;
              line-height: 1 !important;
            }
            .landing-dashboard-bottom {
              flex: 0 0 auto !important;
              margin-top: 0.25rem !important;
            }
            .landing-lead-stack {
              height: auto !important;
              grid-template-rows: auto auto !important;
              align-content: start !important;
              gap: 0.2rem !important;
            }
            .landing-lead-note {
              justify-content: flex-start !important;
              gap: 0.3rem !important;
              font-size: 0.5rem !important;
              line-height: 1.02 !important;
            }
            .landing-lead-note svg {
              width: 1.35rem !important;
              height: 0.85rem !important;
            }
            .landing-customer-text-card {
              flex: 0 0 auto !important;
              height: auto !important;
              min-height: 0 !important;
              border-radius: 11px !important;
              padding: 0 !important;
            }
            .landing-customer-text-title {
              font-size: 0.58rem !important;
            }
            .landing-customer-text-body {
              margin-top: 0.22rem !important;
              font-size: 0.47rem !important;
              line-height: 1.06 !important;
            }
          }
          .landing-action-flow {
            width: min(100%, 44rem);
            margin: 1rem auto 0;
          }
          .landing-action-flow-heading {
            display: flex;
            min-height: 2.25rem;
            align-items: center;
            justify-content: center;
            gap: 0.45rem;
            color: #0c5fc3;
          }
          .landing-action-flow-heading strong {
            font-size: 0.78rem;
            font-weight: 950;
            letter-spacing: 0.14em;
          }
          .landing-action-flow-heading svg {
            width: 2.1rem;
            height: 1.8rem;
            overflow: visible;
            color: #e04439;
            transform: translateY(0.28rem) rotate(2deg);
          }
          .landing-action-flow-heading path,
          .landing-action-flow-arrow path {
            fill: none;
            stroke: currentColor;
            stroke-width: 3;
            stroke-linecap: round;
            stroke-linejoin: round;
          }
          .landing-action-flow-steps {
            display: grid;
            grid-template-columns: minmax(0, 1fr) minmax(1.7rem, 0.28fr) minmax(0, 1fr) minmax(1.7rem, 0.28fr) minmax(0, 1fr);
            align-items: center;
            gap: 0.3rem;
            margin: 0;
            padding: 0.72rem 0.8rem;
            border: 1px solid rgba(58, 143, 209, 0.28);
            border-radius: 1rem;
            background: rgba(228, 244, 255, 0.82);
            color: #103d69;
            list-style: none;
            box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.82);
          }
          .landing-action-flow-step {
            display: grid;
            min-width: 0;
            grid-template-columns: 2.15rem minmax(0, 1fr);
            align-items: center;
            gap: 0.48rem;
            color: #092f58;
            font-size: 0.76rem;
            font-weight: 950;
            line-height: 1.12;
          }
          .landing-action-flow-icon {
            display: grid;
            width: 2.15rem;
            height: 2.15rem;
            padding: 0.48rem;
            place-items: center;
            border-radius: 0.72rem;
            background: linear-gradient(180deg, #1989dc, #0e68ba);
            color: white;
            box-shadow: 0 10px 18px -13px rgba(14, 104, 186, 0.95);
          }
          .landing-action-flow-nowrap {
            white-space: nowrap;
          }
          .landing-action-flow-arrow {
            color: #22a9e2;
          }
          .landing-action-flow-arrow svg {
            display: block;
            width: 100%;
            min-width: 1.7rem;
            height: 1.5rem;
            overflow: visible;
          }
          .landing-action-flow-arrow path {
            stroke-width: 3.5;
          }
          @media (max-width: 639px) {
            .landing-action-flow {
              width: min(100%, 24rem);
              margin-top: 0.72rem;
            }
            .landing-action-flow-heading {
              min-height: 1.9rem;
            }
            .landing-action-flow-heading strong {
              font-size: 0.7rem;
            }
            .landing-action-flow-heading svg {
              width: 1.85rem;
              height: 1.55rem;
            }
            .landing-action-flow-steps {
              grid-template-columns: minmax(0, 1fr) 1.15rem minmax(0, 1fr) 1.15rem minmax(0, 1fr);
              gap: 0.12rem;
              padding: 0.58rem 0.46rem;
              border-radius: 0.9rem;
            }
            .landing-action-flow-step {
              grid-template-columns: 1fr;
              justify-items: center;
              gap: 0.34rem;
              text-align: center;
              font-size: clamp(0.62rem, 2.8vw, 0.7rem);
              line-height: 1.14;
            }
            .landing-action-flow-icon {
              width: 1.9rem;
              height: 1.9rem;
              padding: 0.42rem;
              border-radius: 0.62rem;
            }
            .landing-action-flow-arrow svg {
              min-width: 1.15rem;
              height: 1.25rem;
            }
            .landing-action-flow-arrow path {
              stroke-width: 4;
            }
            .landing-hero-coverage {
              margin-top: 0.9rem !important;
              font-size: 0.92rem !important;
            }
            .landing-hero-points-clean {
              margin-top: 1rem !important;
              gap: 0.65rem !important;
            }
            .landing-hero-points-clean .landing-hero-point-clean {
              grid-template-columns: 1.85rem minmax(0, 1fr) !important;
              column-gap: 0.65rem !important;
              font-size: 0.86rem !important;
            }
            .landing-hero-points-clean .landing-hero-point-check {
              width: 1.85rem !important;
              height: 1.85rem !important;
            }
            .landing-hero-actions {
              margin-top: 1.1rem !important;
            }
            .landing-hero-trust {
              justify-content: center;
              gap: 0.45rem 0.9rem !important;
            }
            .landing-imessage-preview {
              padding: 0.7rem !important;
            }
            .landing-imessage-preview-title {
              font-size: 0.78rem !important;
            }
            .landing-imessage-preview-meta {
              font-size: 0.58rem !important;
            }
            .landing-imessage-bubble {
              max-width: 100% !important;
              font-size: 0.7rem !important;
              line-height: 1.2 !important;
            }
          }

          /* The former long-form sections remain in source for reference, but the
             approved seven-chapter landing story replaces them at every size. */
          #homepage-hero-details,
          #built-for-your-trade,
          #voicemail-vs-ai,
          #contractor-proof,
          #pricing,
          #setup,
          #customer-proof,
          #faq,
          #guided-call-forwarding,
          #trust,
          #final-cta {
            display: none !important;
          }

          /* Mobile-first landing-page hierarchy approved in the visual review. */
          @media (max-width: 639px) {
            .landing-page-main {
              display: flex;
              flex-direction: column;
            }
            #homepage-hero { order: 0; }
            #mobile-scroll-call-story { order: 1; }
            #landing-chapters { order: 2; }
            #voicemail-vs-ai,
            #contractor-proof,
            #pricing,
            #setup,
            #customer-proof,
            #faq,
            #trust,
            #final-cta {
              display: none !important;
            }

            .landing-hero-shell {
              padding: 0.8rem 0.95rem 1.1rem !important;
            }
            .landing-hero-shell nav {
              display: block !important;
            }
            .landing-desktop-brand {
              display: none !important;
            }
            .landing-mobile-contractor-label {
              display: block !important;
              width: 100% !important;
              color: #e66500 !important;
              text-align: center !important;
              font-size: 1rem !important;
              font-weight: 950 !important;
              line-height: 1 !important;
              letter-spacing: 0.18em !important;
              text-transform: uppercase !important;
            }
            .landing-hero-shell nav > div:last-child {
              display: none !important;
            }
            .landing-hero-grid {
              gap: 0 !important;
              padding-top: 1rem !important;
            }
            .landing-hero-copy-column {
              min-height: calc(100svh - 9rem) !important;
            }
            .landing-hero-title {
              margin-top: 0 !important;
              text-align: center !important;
              font-size: 2.35rem !important;
              line-height: 0.98 !important;
              letter-spacing: -0.05em !important;
            }
            .landing-hero-title > span:nth-child(2) {
              margin-top: 0.75rem !important;
              font-size: 0.54em !important;
            }
            .landing-hero-coverage {
              margin-top: 1rem !important;
              display: block !important;
              width: 100% !important;
              box-sizing: border-box !important;
              padding: 0.82rem 0.9rem !important;
              border: 1px solid #9ee0b2 !important;
              border-radius: 0.8rem !important;
              text-align: center !important;
              font-size: 1.2rem !important;
              line-height: 1.12 !important;
              box-shadow: 0 12px 28px -24px rgba(21, 128, 61, 0.65) !important;
            }
            .landing-hero-points-clean {
              margin-top: 1rem !important;
              gap: 0 !important;
              padding: 0.35rem 0.8rem !important;
              border: 1px solid #bfd8f1 !important;
              border-radius: 1rem !important;
              background: rgba(255, 255, 255, 0.72) !important;
            }
            .landing-hero-points-clean .landing-hero-point-clean {
              min-height: 3.35rem !important;
              grid-template-columns: 2rem minmax(0, 1fr) !important;
              column-gap: 0.72rem !important;
              padding: 0.56rem 0 !important;
              font-size: 0.9rem !important;
              font-weight: 700 !important;
              line-height: 1.22 !important;
            }
            .landing-hero-points-clean .landing-hero-point-clean + .landing-hero-point-clean {
              border-top: 1px solid rgba(148, 180, 214, 0.34) !important;
            }
            .landing-hero-points-clean .landing-hero-point-check {
              width: 2rem !important;
              height: 2rem !important;
              font-size: 0.9rem !important;
            }
            .landing-hero-actions {
              margin-top: 1rem !important;
            }
            .landing-hero-actions > div:first-child {
              display: grid !important;
              grid-template-columns: minmax(0, 1.18fr) minmax(0, 0.82fr) !important;
              gap: 0.55rem !important;
            }
            .landing-hero-actions button {
              width: 100% !important;
              min-width: 0 !important;
              min-height: 3.45rem !important;
              padding: 0.65rem 0.6rem !important;
              font-size: 0.86rem !important;
            }
            .landing-hero-trust {
              display: grid !important;
              width: 100% !important;
              grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
              gap: 0.25rem !important;
              margin-top: 0.75rem !important;
              padding: 0.7rem 0.42rem !important;
              box-sizing: border-box !important;
              border: 1px solid #9ee0b2 !important;
              border-radius: 0.7rem !important;
              background: #eafaf0 !important;
              color: #137a36 !important;
              text-align: center !important;
            }
            .landing-hero-trust > span {
              display: inline-flex !important;
              align-items: center !important;
              justify-content: center !important;
              color: #137a36 !important;
              font-size: clamp(0.62rem, 2.55vw, 0.76rem) !important;
              font-weight: 900 !important;
              line-height: 1.15 !important;
              white-space: nowrap !important;
            }
            .landing-hero-trust > span:first-child {
              grid-column: auto !important;
              padding-bottom: 0 !important;
              border-bottom: 0 !important;
              font-size: clamp(0.62rem, 2.55vw, 0.76rem) !important;
            }
            .landing-hero-trust > span:last-child {
              grid-column: auto !important;
            }
            .landing-hero-visual {
              margin-top: 0.25rem !important;
            }
            .landing-hero-proof-heading {
              margin-bottom: 0.45rem !important;
              padding-inline: 0.2rem !important;
              font-size: 0.92rem !important;
              line-height: 1.12 !important;
              letter-spacing: 0.075em !important;
            }
            .landing-owner-text-arrow {
              display: none !important;
            }
            .landing-owner-flow {
              display: flex !important;
            }
            .landing-call-owner-card {
              margin-top: 0.15rem !important;
            }

            /* Clean mobile revamp selected from the visual concepts. */
            .landing-hero-shell {
              padding: 0.9rem 1.15rem 1.3rem !important;
            }
            .landing-mobile-contractor-label {
              display: flex !important;
              width: 100% !important;
              min-height: 6.7rem !important;
              align-items: center !important;
              justify-content: center !important;
              margin-inline: auto !important;
              padding: 1rem 1.35rem !important;
              border: 0 !important;
              border-radius: 0 !important;
              background:
                radial-gradient(circle, rgba(7, 20, 42, 0.18) 0 1px, transparent 1.4px) 0 0 / 9px 9px,
                #ffdd24 !important;
              clip-path: polygon(50% 0%, 59% 15%, 75% 5%, 79% 23%, 97% 20%, 89% 39%, 100% 50%, 88% 60%, 97% 80%, 77% 78%, 73% 96%, 58% 85%, 50% 100%, 40% 85%, 25% 96%, 21% 77%, 2% 80%, 11% 60%, 0% 49%, 12% 39%, 3% 20%, 23% 23%, 27% 5%, 42% 15%);
              color: #ef2b32 !important;
              font-size: clamp(1.78rem, 8vw, 2rem) !important;
              line-height: 0.86 !important;
              letter-spacing: 0.065em !important;
              text-shadow: 1.8px 1.8px 0 #fff, 3.2px 3.2px 0 #07142a !important;
              filter: drop-shadow(0 6px 0 #07142a) drop-shadow(0 15px 15px rgba(7, 20, 42, 0.2));
              transform: rotate(-1.2deg);
            }
            .landing-hero-grid {
              padding-top: 1rem !important;
              padding-bottom: 0 !important;
            }
            .landing-hero-copy-column {
              width: 100% !important;
              max-width: none !important;
              min-height: 0 !important;
              margin-inline: auto !important;
            }
            .landing-mobile-proof-first {
              width: 100%;
              margin-inline: auto;
            }
            .landing-mobile-proof-title {
              max-width: 21.5rem;
              margin-inline: auto;
              color: #06142b !important;
              text-align: center;
              font-size: clamp(2.42rem, 10.6vw, 2.68rem);
              font-weight: 1000 !important;
              line-height: 0.97;
              letter-spacing: -0.048em !important;
              text-wrap: balance;
              -webkit-text-stroke: 0.8px #48bff4;
              paint-order: stroke fill;
              text-shadow:
                0 0 1px #e8fbff,
                0 0 13px rgba(54, 190, 255, 0.24),
                0 8px 18px rgba(7, 20, 42, 0.18);
            }
            .landing-mobile-proof-title.landing-stripe-headline::before,
            .landing-mobile-proof-title.landing-stripe-headline::after {
              inset-block: 0.02em;
              right: auto;
              left: 50%;
              width: 100vw;
              clip-path: none;
              transform: translateX(-50%);
            }
            .landing-mobile-proof-title > span:last-child {
              margin-top: 0.08em;
            }
            .landing-mobile-proof-pain {
              margin-top: 0.9rem;
              text-align: center;
              font-size: clamp(1.08rem, 4.8vw, 1.22rem);
              line-height: 1.15;
              letter-spacing: -0.025em;
            }
            .landing-mobile-proof-pain.landing-chalk-pain {
              max-width: none;
              font-size: clamp(1.22rem, 6.2vw, 1.6rem);
              line-height: 1;
              white-space: nowrap;
            }
            .landing-mobile-coverage-card {
              display: grid;
              width: fit-content;
              min-height: 3.1rem;
              margin: 0.65rem auto 0;
              padding-inline: 1.25rem;
              place-items: center;
              border: 1px solid #b7e1c4;
              border-radius: 999px;
              background: rgba(234, 248, 239, 0.92);
              text-align: center;
              color: #0b7834;
              font-size: clamp(0.98rem, 4.35vw, 1.1rem);
              font-weight: 850;
              line-height: 1.1;
              letter-spacing: -0.02em;
            }
            .landing-mobile-coffee {
              margin: 0.85rem auto 0;
              text-align: center;
              color: #334155;
              font-size: clamp(0.9rem, 4vw, 1rem);
              font-weight: 750;
              line-height: 1.3;
            }
            .landing-mobile-benefit-list {
              overflow: hidden;
              margin-top: 1.1rem;
              border: 1px solid #d4e2ed;
              border-radius: 1.25rem;
              background: rgba(255, 255, 255, 0.86);
              box-shadow: 0 16px 36px rgba(17, 54, 87, 0.075);
            }
            .landing-mobile-benefit-row {
              display: grid;
              min-height: 3.9rem;
              grid-template-columns: 2.4rem minmax(0, 1fr);
              align-items: center;
              gap: 0.8rem;
              margin-inline: 0.9rem;
              padding-block: 0.72rem;
              color: #152a43;
              font-size: clamp(0.88rem, 3.85vw, 0.97rem);
              font-weight: 750;
              line-height: 1.28;
              letter-spacing: -0.015em;
            }
            .landing-mobile-benefit-row + .landing-mobile-benefit-row {
              border-top: 1px solid #dce7f0;
            }
            .landing-mobile-benefit-symbol {
              display: grid;
              width: 2.38rem;
              height: 2.38rem;
              place-items: center;
              border-radius: 0.75rem;
              background: #147fd8;
              color: white;
              box-shadow: 0 7px 16px rgba(20, 127, 216, 0.18);
            }
            .landing-mobile-proof-actions {
              display: grid;
              grid-template-columns: minmax(0, 1fr) minmax(0, 1.65fr);
              gap: 0.65rem;
              margin-top: 0.6rem;
            }
            .landing-mobile-proof-primary {
              min-height: 3.65rem;
              font-size: clamp(0.86rem, 3.75vw, 0.97rem);
            }
            .landing-mobile-proof-secondary {
              min-height: 3.65rem;
              font-size: clamp(0.86rem, 3.75vw, 0.97rem);
            }
            .landing-mobile-proof-trust {
              display: grid;
              min-height: 3.3rem;
              grid-template-columns: 1.1fr 1fr 0.95fr;
              align-items: center;
              margin-top: 0.5rem;
              border: 1px solid #bee4c8;
              border-radius: 0.95rem;
              background: rgba(248, 255, 250, 0.92);
              color: #24643c;
              font-size: clamp(0.62rem, 2.75vw, 0.72rem);
              font-weight: 800;
              line-height: 1.1;
            }
            .landing-mobile-proof-trust > span {
              display: flex;
              min-width: 0;
              align-items: center;
              justify-content: center;
              gap: 0.25rem;
              white-space: nowrap;
            }
            .landing-mobile-proof-trust > span + span {
              border-left: 1px solid #d9ecdf;
            }
            .landing-mobile-proof-trust b {
              color: #159447;
              font-size: 0.86rem;
            }
            .landing-hero-title {
              max-width: 22rem !important;
              margin-inline: auto !important;
              font-size: clamp(2.42rem, 10.7vw, 2.68rem) !important;
              line-height: 0.97 !important;
            }
            .landing-hero-title > span:first-child {
              white-space: normal !important;
              text-wrap: balance !important;
            }
            .landing-hero-title > span:nth-child(2) {
              margin-top: 0.85rem !important;
              font-size: 0.51em !important;
              line-height: 1.05 !important;
            }
            .landing-hero-coverage {
              width: auto !important;
              margin: 0.8rem auto 0 !important;
              padding: 0 !important;
              border: 0 !important;
              border-radius: 0 !important;
              background: transparent !important;
              box-shadow: none !important;
              text-align: center !important;
              font-size: 1.08rem !important;
            }
            .landing-hero-points-mobile {
              margin-top: 1.2rem !important;
              padding: 0 !important;
              border: 0 !important;
              border-top: 1px solid rgba(132, 171, 209, 0.42) !important;
              border-bottom: 1px solid rgba(132, 171, 209, 0.42) !important;
              border-radius: 0 !important;
              background: transparent !important;
            }
            .landing-hero-points-desktop {
              display: none !important;
            }
            .landing-hero-points-mobile .landing-hero-point-clean {
              min-height: 4.3rem !important;
              grid-template-columns: 2.65rem minmax(0, 1fr) !important;
              column-gap: 0.85rem !important;
              padding: 0.82rem 0.15rem !important;
              font-size: clamp(0.94rem, 4vw, 1.02rem) !important;
              font-weight: 800 !important;
              line-height: 1.28 !important;
            }
            .landing-hero-points-mobile .landing-hero-point-check {
              width: 2.65rem !important;
              height: 2.65rem !important;
              background: linear-gradient(145deg, #2b91ee, #0867c7) !important;
              font-size: 1.15rem !important;
              box-shadow: 0 9px 20px -12px rgba(12, 95, 195, 0.95) !important;
            }
            .landing-hero-actions {
              margin-top: 1.25rem !important;
            }
            .landing-hero-actions > div:first-child {
              grid-template-columns: minmax(0, 1.03fr) minmax(0, 0.97fr) !important;
              gap: 0.65rem !important;
            }
            .landing-hero-actions button {
              min-height: 3.5rem !important;
              font-size: 0.86rem !important;
            }
            .landing-hero-trust {
              margin-top: 0.8rem !important;
              padding: 0 !important;
              border: 0 !important;
              border-radius: 0 !important;
              background: transparent !important;
              gap: 0.25rem !important;
            }
            .landing-hero-trust > span,
            .landing-hero-trust > span:first-child {
              font-size: clamp(0.67rem, 3vw, 0.75rem) !important;
              letter-spacing: -0.02em !important;
            }
            .landing-mobile-call-proof {
              margin-top: 0.85rem !important;
            }
            .landing-mobile-call-proof .landing-timed-call-front {
              padding: 0.72rem !important;
            }
            .landing-mobile-call-proof .landing-timed-call-front .landing-timed-call-agent-row {
              gap: 0.65rem !important;
              margin-top: 0.55rem !important;
            }
            .landing-mobile-call-proof .landing-timed-call-front .landing-timed-call-avatar-wrap {
              width: 3.85rem !important;
              height: 3.85rem !important;
            }
            .landing-mobile-call-proof .landing-timed-call-front .landing-timed-call-avatar {
              width: 3.42rem !important;
              height: 3.42rem !important;
            }
            .landing-mobile-call-proof .landing-timed-call-front .landing-mobile-call-wave {
              height: 1.3rem !important;
              margin-top: 0.35rem !important;
            }
            .landing-mobile-call-proof .landing-timed-call-front .landing-timed-conversation {
              margin-top: 0.35rem !important;
            }
            .landing-mobile-call-proof .landing-timed-call-front .landing-timed-conversation-turn {
              padding: 0.3rem 0.65rem !important;
            }
            .landing-mobile-call-proof .landing-timed-call-front .landing-timed-conversation-turn > p {
              font-size: 0.74rem !important;
              line-height: 1.18 !important;
            }
            .landing-live-network {
              margin-top: 1.25rem !important;
            }
            .landing-hero-visual {
              display: none !important;
            }

            #contractor-proof > div {
              display: flex;
              flex-direction: column;
              padding-top: 2rem !important;
              padding-bottom: 2rem !important;
            }
            .contractor-proof-mobile-intro {
              order: -3;
            }
            .contractor-proof-demo {
              order: -2;
              margin-top: 1.25rem !important;
            }
            .contractor-proof-demo h3 {
              font-size: 1.45rem !important;
              line-height: 1.2 !important;
              letter-spacing: -0.035em !important;
            }
            .contractor-proof-transcript,
            .contractor-benefit-repeated {
              display: none !important;
            }
            #contractor-proof > div > .mx-auto {
              order: 0;
              margin-top: 2rem;
            }
            #contractor-proof > div > .mt-7 {
              order: 1;
            }
            #contractor-proof h2 {
              font-size: 1.75rem !important;
            }
            #pricing > div,
            #faq > div {
              padding-top: 2.5rem !important;
              padding-bottom: 2.5rem !important;
            }
          }

          .landing-tablet-hero,
          .landing-hero-grid > .landing-tablet-hero:first-child {
            display: none !important;
          }
          @media (min-width: 640px) and (max-width: 1024px),
                 (min-width: 1025px) and (max-width: 1366px) and (pointer: coarse),
                 (min-width: 1025px) and (pointer: fine) {
            .landing-hero-shell {
              max-width: 74rem !important;
              min-height: 100svh !important;
              padding: 1.65rem 2.35rem 2.5rem !important;
            }
            .landing-hero-shell > nav {
              display: none !important;
            }
            .landing-hero-grid {
              display: block !important;
              padding: 0 !important;
            }
            .landing-hero-grid > .landing-hero-copy-column,
            .landing-hero-grid > .landing-hero-visual {
              display: none !important;
            }
            .landing-tablet-hero,
            .landing-hero-grid > .landing-tablet-hero:first-child {
              display: grid !important;
              width: 100%;
              gap: 2.15rem;
              align-items: center;
            }
            .landing-tablet-copy {
              width: min(100%, 44.375rem);
              margin-inline: auto;
            }
            .landing-tablet-eyebrow {
              display: grid;
              width: min(100%, 31rem);
              min-height: 8rem;
              place-items: center;
              margin: 0 auto;
              padding: 1.2rem 3.5rem;
              border: 0;
              border-radius: 0;
              background:
                radial-gradient(circle, rgba(7, 20, 42, 0.18) 0 1.1px, transparent 1.55px) 0 0 / 10px 10px,
                #ffdd24;
              clip-path: polygon(50% 0%, 59% 15%, 75% 5%, 79% 23%, 97% 20%, 89% 39%, 100% 50%, 88% 60%, 97% 80%, 77% 78%, 73% 96%, 58% 85%, 50% 100%, 40% 85%, 25% 96%, 21% 77%, 2% 80%, 11% 60%, 0% 49%, 12% 39%, 3% 20%, 23% 23%, 27% 5%, 42% 15%);
              color: #ef2b32;
              text-align: center;
              font-size: 2.45rem;
              font-weight: 900;
              line-height: 0.87;
              letter-spacing: 0.075em;
              text-shadow: 2px 2px 0 #fff, 3.6px 3.6px 0 #07142a;
              text-transform: uppercase;
              filter: drop-shadow(0 5px 0 #07142a) drop-shadow(0 14px 16px rgba(7, 20, 42, 0.18));
              transform: rotate(-1deg);
            }
            .landing-tablet-title {
              margin: 1.7rem 0 0;
              color: #06142b;
              text-align: center;
              font-size: clamp(3.4rem, 7vw, 4.9rem);
              font-weight: 1000;
              line-height: 0.94;
              letter-spacing: -0.06em;
              -webkit-text-stroke: 1.1px #48bff4;
              paint-order: stroke fill;
              text-shadow:
                0 0 1px #e8fbff,
                0 0 16px rgba(54, 190, 255, 0.24),
                0 10px 22px rgba(7, 20, 42, 0.18);
            }
            .landing-tablet-pain {
              margin: 1.1rem 0 0;
              color: #d91d12;
              text-align: center;
              font-size: clamp(1.55rem, 3.2vw, 2.25rem);
              font-weight: 900;
              line-height: 1;
              letter-spacing: -0.035em;
            }
            .landing-tablet-coverage {
              width: fit-content;
              margin: 0.85rem auto 0;
              padding: 0.82rem 1.5rem;
              border: 1px solid #b7e1c4;
              border-radius: 999px;
              background: rgba(234, 248, 239, 0.94);
              color: #0b7834;
              font-size: 1.38rem;
              font-weight: 900;
              line-height: 1.1;
            }
            .landing-tablet-coffee {
              margin: 0.9rem auto 0;
              color: #334155;
              text-align: center;
              font-size: 1.05rem;
              font-weight: 750;
              line-height: 1.35;
            }
            .landing-tablet-benefits {
              display: grid;
              overflow: hidden;
              grid-template-columns: 1fr 1fr;
              margin-top: 1.35rem;
              border: 1px solid #cee0ef;
              border-radius: 1.4rem;
              background: rgba(255, 255, 255, 0.88);
              box-shadow: 0 20px 40px -34px #123f6e;
            }
            .landing-tablet-benefit {
              display: grid;
              min-height: 3.7rem;
              grid-template-columns: 2.5rem minmax(0, 1fr);
              align-items: center;
              gap: 0.75rem;
              margin-inline: 1rem;
              padding-block: 0.7rem;
              color: #111827;
              font-size: 0.98rem;
              font-weight: 780;
              line-height: 1.22;
            }
            .landing-tablet-benefit:nth-child(n + 3) {
              border-top: 1px solid #dce7f0;
            }
            .landing-tablet-benefit:nth-child(even) {
              margin-left: 0;
              padding-left: 1rem;
              border-left: 1px solid #dce7f0;
            }
            .landing-tablet-benefit-icon {
              display: grid;
              width: 2.4rem;
              height: 2.4rem;
              place-items: center;
              border-radius: 0.78rem;
              background: #147fd8;
              color: white;
              box-shadow: 0 8px 18px -12px #147fd8;
            }
            .landing-tablet-actions {
              display: grid;
              grid-template-columns: 1.45fr 1fr;
              gap: 0.75rem;
              margin-top: 1.25rem;
            }
            .landing-tablet-primary,
            .landing-tablet-secondary {
              display: grid;
              min-height: 3.65rem;
              place-items: center;
              border-radius: 1.05rem;
              font-size: 1.05rem;
              font-weight: 900;
            }
            .landing-tablet-primary {
              border: 0;
              background: linear-gradient(180deg, #ff7a00, #ff6500);
              color: white;
              box-shadow: 0 18px 34px -25px #ff6a00;
            }
            .landing-tablet-secondary {
              border: 1px solid #6fa9df;
              background: rgba(255, 255, 255, 0.9);
              color: #0c5fc3;
            }
            .landing-tablet-trust {
              display: grid;
              grid-template-columns: repeat(3, minmax(0, 1fr));
              margin-top: 0.75rem;
              padding: 0.82rem 0.5rem;
              border: 1px solid #bee4c8;
              border-radius: 0.95rem;
              background: rgba(248, 255, 250, 0.94);
              color: #21723b;
              text-align: center;
              font-size: 0.82rem;
              font-weight: 850;
            }
            .landing-tablet-trust span + span {
              border-left: 1px solid #d9ecdf;
            }
            .landing-tablet-trust b {
              margin-right: 0.3rem;
              color: #159447;
            }
            .landing-tablet-card-wrap {
              width: min(100%, 44.375rem);
              margin-inline: auto;
            }
            .landing-tablet-call-proof {
              height: 33.25rem !important;
              margin-top: 0 !important;
            }
            .landing-tablet-call-proof .landing-mobile-call-prism {
              height: calc(100% - 6.25rem) !important;
            }
            .landing-tablet-call-proof .landing-carousel-actions {
              min-height: 3.25rem;
              gap: 0.8rem;
            }
            .landing-tablet-call-proof .landing-carousel-primary,
            .landing-tablet-call-proof .landing-carousel-secondary {
              min-height: 3.25rem;
              padding-inline: 0.9rem;
              font-size: 0.9rem;
            }
            .landing-tablet-call-proof .landing-timed-call-face {
              padding: 1.38rem !important;
              border-radius: 1.9rem !important;
            }
            .landing-tablet-call-proof .landing-timed-call-status {
              font-size: 0.82rem !important;
            }
            .landing-tablet-call-proof .landing-timed-call-agent-row {
              gap: 1rem !important;
              margin-top: 1.2rem !important;
            }
            .landing-tablet-call-proof .landing-timed-call-avatar-wrap {
              width: 7rem !important;
              height: 7rem !important;
              margin-top: 0 !important;
            }
            .landing-tablet-call-proof .landing-timed-call-avatar {
              width: 6.35rem !important;
              height: 6.35rem !important;
              border-width: 4px !important;
            }
            .landing-tablet-call-proof .landing-timed-call-agent {
              margin-top: 0 !important;
              font-size: 1.9rem !important;
            }
            .landing-tablet-call-proof .landing-timed-call-subtitle {
              margin-top: 0.55rem !important;
              font-size: 0.94rem !important;
            }
            .landing-tablet-call-proof .landing-mobile-call-wave {
              height: 2.5rem !important;
              margin-top: 0.55rem !important;
            }
            .landing-tablet-call-proof .landing-timed-conversation {
              margin-top: 1.2rem !important;
            }
            .landing-tablet-call-proof .landing-timed-conversation-turn {
              padding: 0.82rem 1rem !important;
            }
            .landing-tablet-call-proof .landing-timed-conversation-turn > span {
              font-size: 0.64rem !important;
            }
            .landing-tablet-call-proof .landing-timed-conversation-turn > p {
              font-size: 0.92rem !important;
              line-height: 1.28 !important;
            }
            .landing-tablet-call-proof .landing-timed-call-back-title {
              margin-top: 1.1rem !important;
              font-size: 1.9rem !important;
            }
            .landing-tablet-call-proof .landing-timed-call-back-intro {
              font-size: 0.88rem !important;
            }
            .landing-tablet-call-proof .landing-text-phone-grid {
              gap: 0.9rem !important;
              margin-top: 1rem !important;
            }
            .landing-tablet-call-proof .landing-text-phone {
              padding: 0.68rem 0.68rem 4.25rem !important;
              border-width: 4px !important;
              border-radius: 1.7rem !important;
            }
            .landing-tablet-call-proof .landing-text-phone > div:first-child {
              font-size: 0.58rem !important;
            }
            .landing-tablet-call-proof .landing-text-phone > div:nth-child(2) > span:first-child {
              width: 2.1rem !important;
              height: 2.1rem !important;
              font-size: 0.66rem !important;
            }
            .landing-tablet-call-proof .landing-text-phone strong {
              font-size: 0.76rem !important;
            }
            .landing-tablet-call-proof .landing-text-phone small {
              font-size: 0.57rem !important;
            }
            .landing-tablet-call-proof .landing-text-bubble {
              padding: 0.68rem 0.75rem !important;
              font-size: 0.74rem !important;
              line-height: 1.3 !important;
            }
            .landing-tablet-call-proof .landing-reading-hand {
              bottom: -1.9rem;
              width: 6.85rem;
              height: 6.5rem;
            }
            .landing-tablet-call-proof .landing-reading-hand-left {
              left: -1rem;
            }
            .landing-tablet-call-proof .landing-reading-hand-right {
              left: -1rem;
              right: auto;
            }
            .landing-tablet-call-proof .landing-timed-call-message {
              margin-top: 1.1rem !important;
              padding: 0.95rem !important;
              border-radius: 1.25rem !important;
            }
            .landing-tablet-call-proof .landing-timed-call-message > div:first-child {
              grid-template-columns: 2.65rem minmax(0, 1fr) !important;
            }
            .landing-tablet-call-proof .landing-timed-call-message > div:first-child > span:first-child {
              width: 2.65rem !important;
              height: 2.65rem !important;
              font-size: 0.72rem !important;
            }
            .landing-tablet-call-proof .landing-timed-call-message strong {
              font-size: 0.88rem !important;
            }
            .landing-tablet-call-proof .landing-timed-call-message small {
              font-size: 0.62rem !important;
            }
            .landing-tablet-call-proof .landing-timed-call-message > div:last-child {
              padding: 0.82rem 0.9rem !important;
              font-size: 0.86rem !important;
            }
            .landing-tablet-call-proof .landing-timed-call-delivered {
              margin-top: 1.1rem !important;
              font-size: 0.75rem !important;
            }
            .landing-tablet-call-proof .landing-timed-call-benefits {
              display: flex !important;
              flex-direction: column;
              justify-content: center;
              padding: 2rem !important;
            }
            .landing-tablet-call-proof .landing-timed-benefits-meta {
              font-size: 0.78rem !important;
            }
            .landing-tablet-call-proof .landing-timed-benefits-title {
              margin-top: 1rem !important;
              font-size: 1.42rem !important;
            }
            .landing-tablet-call-proof .landing-timed-benefits-list {
              margin-top: 1.25rem !important;
            }
            .landing-tablet-call-proof .landing-timed-benefits-row {
              grid-template-columns: 3rem minmax(0, 1fr) !important;
              gap: 0.9rem !important;
              padding: 0.8rem 0.95rem !important;
            }
            .landing-tablet-call-proof .landing-timed-benefits-icon {
              width: 2.75rem !important;
              height: 2.75rem !important;
            }
            .landing-tablet-call-proof .landing-timed-benefits-copy {
              font-size: 0.8rem !important;
              line-height: 1.3 !important;
            }
            .landing-tablet-call-proof .landing-timed-benefits-footer {
              margin-top: 0.85rem !important;
              font-size: 0.69rem !important;
            }
            .landing-tablet-flip-hint {
              margin-top: 0.65rem;
              color: #63809c;
              text-align: center;
              font-size: 0.7rem;
              font-weight: 750;
            }
          }
          @media (min-width: 900px) and (max-width: 1024px) and (min-aspect-ratio: 4/3),
                 (min-width: 1025px) and (max-width: 1366px) and (min-aspect-ratio: 4/3) and (pointer: coarse),
                 (min-width: 1025px) and (pointer: fine) {
            .landing-hero-shell {
              display: grid !important;
              align-content: center !important;
              padding: 1.4rem 1.9rem !important;
            }
            .landing-tablet-hero,
            .landing-hero-grid > .landing-tablet-hero:first-child {
              display: grid !important;
              grid-template-columns: minmax(22.5rem, 0.8fr) minmax(32.5rem, 1.2fr);
              gap: 2.5rem;
            }
            .landing-tablet-copy,
            .landing-tablet-card-wrap {
              width: 100%;
            }
            .landing-tablet-eyebrow {
              margin-left: 0;
              width: min(100%, 23rem);
              min-height: 6.5rem;
              padding-inline: 2.5rem;
              font-size: 2.08rem;
            }
            .landing-tablet-title {
              margin-top: 1.35rem;
              text-align: left;
              font-size: clamp(3.4rem, 6.2vw, 4.7rem);
            }
            .landing-tablet-pain {
              text-align: left;
              font-size: clamp(1.55rem, 2.75vw, 2.05rem);
            }
            .landing-tablet-coverage {
              margin-left: 0;
              font-size: 1.18rem;
            }
            .landing-tablet-coffee {
              margin-left: 0;
              text-align: left;
            }
            .landing-tablet-benefits {
              display: block;
              margin-top: 1.1rem;
            }
            .landing-tablet-benefit {
              min-height: 3.25rem;
              margin-inline: 0.9rem;
              font-size: 0.86rem;
            }
            .landing-tablet-benefit:nth-child(n + 2),
            .landing-tablet-benefit:nth-child(even) {
              border-top: 1px solid #dce7f0;
              border-left: 0;
            }
            .landing-tablet-benefit:nth-child(even) {
              margin-left: 0.9rem;
              padding-left: 0;
            }
            .landing-tablet-call-proof {
              height: 35.625rem !important;
            }
          }
          @media (min-width: 1025px) and (pointer: fine) {
            .landing-hero-shell {
              width: min(100%, 85rem) !important;
              max-width: 85rem !important;
              min-height: calc(100vh - 76px) !important;
              padding: 1rem 2.5rem 1.35rem !important;
            }
            .landing-hero-shell > nav {
              display: grid !important;
              grid-template-columns: auto 1fr !important;
            }
            .landing-hero-shell > nav > div:nth-child(3) {
              justify-self: end !important;
            }
            .landing-hero-shell > nav > div:last-child {
              display: none !important;
            }
            .landing-hero-grid {
              display: grid !important;
              align-items: center !important;
              padding: 0.75rem 0 0 !important;
            }
            .landing-tablet-hero,
            .landing-hero-grid > .landing-tablet-hero:first-child {
              grid-template-columns: minmax(22rem, 0.76fr) minmax(32rem, 1.24fr) !important;
              gap: clamp(2rem, 4vw, 4.5rem) !important;
            }
            .landing-tablet-copy {
              align-self: center;
            }
            .landing-tablet-eyebrow {
              width: min(100%, 21rem);
              min-height: 5.8rem;
              padding: 0.95rem 2.25rem;
              font-size: clamp(1.65rem, 2vw, 2rem);
            }
            .landing-tablet-title {
              font-size: clamp(3.45rem, 5vw, 4.8rem);
            }
            .landing-tablet-pain {
              font-size: clamp(1.55rem, 2.3vw, 2rem);
            }
            .landing-tablet-actions {
              margin-top: 1.45rem;
            }
            .landing-tablet-call-proof {
              height: clamp(31rem, calc(100vh - 180px), 35.625rem) !important;
            }
            .landing-tablet-flip-hint {
              margin-top: 0.55rem;
              font-size: 0.72rem;
            }
          }
          @media (max-width: 370px) {
            .landing-mobile-proof-title {
              font-size: 2.3rem !important;
            }
          }
          /* Short desktop browser windows: keep the complete live-call card and
             hang-up control visible without changing the standard laptop layout. */
          @media (min-width: 1367px) and (max-height: 660px) and (pointer: fine) {
            .landing-hero-shell {
              min-height: 100vh !important;
              padding-top: 0.55rem !important;
              padding-bottom: 0.55rem !important;
            }
            .landing-hero-grid {
              padding-top: 0.25rem !important;
              padding-bottom: 0 !important;
            }
            .landing-call-dashboard > div {
              height: calc(100vh - 118px) !important;
              min-height: 0 !important;
              max-height: calc(100vh - 118px) !important;
            }
            .landing-call-controls {
              transform: translateY(-0.65rem) !important;
            }
          }

          /* Purpose-built desktop layout. Width determines structure; pointer
             type is reserved for interaction styling so laptops, desktops and
             touch-enabled monitors keep the same balanced composition. */
          @media (min-width: 1200px) {
            .landing-page-main {
              --landing-desktop-max: 90rem;
              --landing-chapter-max: 90rem;
              --landing-desktop-gutter: clamp(2rem, 3.6vw, 4rem);
            }
            .landing-page-main > header > div {
              max-width: var(--landing-desktop-max) !important;
              padding-inline: var(--landing-desktop-gutter) !important;
            }
            .landing-hero-shell {
              width: min(100%, var(--landing-desktop-max)) !important;
              max-width: var(--landing-desktop-max) !important;
              min-height: auto !important;
              padding: 1rem var(--landing-desktop-gutter) clamp(3rem, 5vw, 4.75rem) !important;
            }
            .landing-hero-shell > nav {
              display: grid !important;
              grid-template-columns: auto 1fr auto !important;
            }
            .landing-hero-shell > nav > div:nth-child(3) {
              justify-self: end !important;
            }
            .landing-hero-shell > nav > div:last-child {
              display: flex !important;
            }
            .landing-tablet-hero,
            .landing-hero-grid > .landing-tablet-hero:first-child {
              display: none !important;
            }
            .landing-hero-grid {
              display: grid !important;
              min-height: 0 !important;
              grid-template-columns: minmax(27rem, 5fr) minmax(38rem, 7fr) !important;
              align-items: center !important;
              gap: clamp(2.5rem, 4vw, 4.75rem) !important;
              padding: clamp(2.25rem, 4.5vw, 4.25rem) 0 0 !important;
            }
            .landing-hero-grid > .landing-hero-copy-column {
              display: block !important;
              width: 100% !important;
              max-width: 34rem !important;
              transform: none !important;
            }
            .landing-hero-grid > .landing-hero-visual {
              display: flex !important;
              align-self: center !important;
              justify-content: flex-end !important;
              margin-top: 0 !important;
            }
            .landing-hero-proof-wrap {
              width: 100% !important;
              max-width: 53rem !important;
              margin-left: auto !important;
            }
            .landing-call-dashboard > div {
              height: clamp(34rem, calc(100svh - 10rem), 42rem) !important;
              min-height: 0 !important;
              max-height: 42rem !important;
            }
            .landing-call-controls {
              display: block !important;
            }
            #mobile-problem > div,
            #mobile-how-it-works > div,
            #mobile-value > div,
            #mobile-safeguards > div,
            #mobile-pricing > div,
            #mobile-setup-questions > div,
            #mobile-final-decision > div {
              max-width: var(--landing-chapter-max) !important;
              padding-inline: var(--landing-desktop-gutter) !important;
              padding-top: 4rem !important;
              padding-bottom: 4rem !important;
            }
            #mobile-problem h2,
            #mobile-how-it-works h2,
            #mobile-value h2,
            #mobile-safeguards h2,
            #mobile-pricing h2,
            #mobile-setup-questions h2,
            #mobile-final-decision h2 {
              text-wrap: balance;
            }
          }
          @media (min-width: 1600px) {
            .landing-page-main {
              --landing-desktop-max: 95rem;
              --landing-chapter-max: 95rem;
              --landing-desktop-gutter: 4rem;
            }
            .landing-hero-grid {
              grid-template-columns: minmax(31rem, 5fr) minmax(0, 7fr) !important;
              gap: 5rem !important;
            }
            .landing-hero-copy-column {
              max-width: 36rem !important;
            }
          }
          @media (min-width: 1200px) and (max-height: 760px) {
            .landing-hero-shell {
              padding-top: 0.75rem !important;
              padding-bottom: 2rem !important;
            }
            .landing-hero-grid {
              padding-top: 1.25rem !important;
            }
            .landing-call-dashboard > div {
              height: clamp(30rem, calc(100svh - 9rem), 38rem) !important;
              max-height: 38rem !important;
            }
          }
          /* The hero is a phone-call transcript, not a messaging thread. These
             rules intentionally override older generic bubble sizing rules. */
          .landing-call-transcript {
            min-height: 0 !important;
            overflow: hidden !important;
          }
          .landing-call-transcript-intro {
            min-height: 1.75rem;
          }
          .landing-call-transcript-list {
            display: block !important;
            min-height: 12.75rem;
          }
          .landing-call-transcript-turn {
            display: grid !important;
            grid-template-columns: 1.9rem minmax(0, 1fr) !important;
            align-items: start !important;
            gap: 0.65rem !important;
            width: 100% !important;
            max-width: none !important;
            margin: 0 !important;
            padding: 0.5rem 0 !important;
            border-radius: 0 !important;
            background: transparent !important;
            box-shadow: none !important;
            color: rgba(255,255,255,0.94) !important;
            animation: landingTranscriptTurnIn 220ms ease-out both;
          }
          .landing-call-transcript-avatar {
            display: grid;
            width: 1.9rem;
            height: 1.9rem;
            place-items: center;
            border-radius: 999px;
            border: 1px solid rgba(255,255,255,0.18);
            background: #15314f;
            color: #d9ecff;
            font-size: 0.58rem;
            font-weight: 900;
            letter-spacing: 0.04em;
          }
          .landing-call-transcript-turn.assistant .landing-call-transcript-avatar {
            background: #075f3d;
            color: #c6ffe1;
          }
          .landing-call-transcript-meta {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 0.75rem;
            line-height: 1;
          }
          .landing-call-transcript-meta strong {
            color: #91ccff;
            font-size: 0.68rem;
            font-weight: 900;
            letter-spacing: 0.055em;
            text-transform: uppercase;
          }
          .landing-call-transcript-turn.assistant .landing-call-transcript-meta strong {
            color: #7df0ba;
          }
          .landing-call-transcript-meta time {
            color: rgba(255,255,255,0.38);
            font-size: 0.58rem;
            font-weight: 800;
          }
          .landing-call-transcript-turn p {
            margin-top: 0.28rem !important;
            color: rgba(255,255,255,0.9) !important;
            font-size: 0.78rem !important;
            font-weight: 700 !important;
            line-height: 1.26 !important;
          }
          .landing-call-transcript-caret {
            display: inline-block;
            width: 0.12em;
            height: 0.95em;
            margin-left: 0.12em;
            vertical-align: -0.08em;
            border-radius: 999px;
            background: #7dd3fc;
            animation: landingTranscriptCaret 700ms steps(1, end) infinite;
          }
          @keyframes landingTranscriptTurnIn {
            from { opacity: 0; transform: translateY(5px); }
            to { opacity: 1; transform: translateY(0); }
          }
          @keyframes landingTranscriptCaret {
            0%, 45% { opacity: 1; }
            46%, 100% { opacity: 0; }
          }
          @media (prefers-reduced-motion: reduce) {
            .landing-call-transcript-turn,
            .landing-call-transcript-caret {
              animation: none !important;
            }
          }
          @media (min-width: 1500px) {
            .landing-call-transcript-turn {
              padding-block: 0.62rem !important;
            }
            .landing-call-transcript-turn p {
              font-size: 0.86rem !important;
              line-height: 1.32 !important;
            }
          }
          @media (min-width: 1200px) and (max-height: 760px) {
            .landing-conversation-header > div > p {
              display: none;
            }
            .landing-conversation-title {
              margin-top: 0 !important;
            }
            .landing-call-transcript-turn {
              padding-block: 0.32rem !important;
            }
            .landing-call-transcript-turn p {
              font-size: 0.71rem !important;
              line-height: 1.18 !important;
            }
            .landing-call-audio-button {
              padding: 0.34rem 0.55rem !important;
            }
          }

          /* Desktop call-story redesign: keep the conversation together, then
             present both follow-up outcomes in one calm, readable tray. */
          @media (min-width: 1024px) {
            .landing-call-dashboard-redesign {
              max-width: 690px !important;
            }
            .landing-call-dashboard-redesign > .landing-call-dashboard-surface {
              height: clamp(610px, calc(100svh - 132px), 690px) !important;
              min-height: 610px !important;
              max-height: 690px !important;
              border-radius: 28px !important;
            }
            .landing-call-dashboard-redesign .landing-call-dashboard-layout {
              display: grid !important;
              grid-template-columns: minmax(0, 1fr) !important;
              grid-template-rows: minmax(0, 1fr) auto !important;
              height: 100% !important;
              width: 100% !important;
              min-height: 0 !important;
            }
            .landing-call-dashboard-main {
              display: grid !important;
              grid-template-columns: minmax(12.5rem, 0.58fr) minmax(0, 1.42fr) !important;
              min-height: 0 !important;
            }
            .landing-call-panel-redesign {
              min-height: 0 !important;
              overflow: hidden !important;
              padding: 0.9rem 0.85rem 0.8rem !important;
            }
            .landing-call-dashboard-redesign .landing-call-status {
              font-size: 0.72rem !important;
            }
            .landing-caller-card-redesign {
              margin-top: 0.78rem !important;
            }
            .landing-call-dashboard-redesign .landing-caller-avatar {
              width: 3.4rem !important;
              height: 3.4rem !important;
            }
            .landing-call-dashboard-redesign .landing-caller-name {
              margin-top: 0.6rem !important;
              font-size: 1.02rem !important;
              line-height: 1.02 !important;
            }
            .landing-call-dashboard-redesign .landing-caller-phone {
              margin-top: 0.3rem !important;
              font-size: 0.8rem !important;
            }
            .landing-call-dashboard-redesign .landing-caller-tag {
              margin-top: 0.48rem !important;
              max-width: 100% !important;
              padding: 0.34rem 0.48rem !important;
              font-size: 0.58rem !important;
              line-height: 1.12 !important;
            }
            .landing-call-capture-list {
              margin-top: 0.85rem !important;
              gap: 0.48rem !important;
              padding-top: 0.7rem;
              border-top: 1px solid rgba(255,255,255,0.1);
            }
            .landing-call-capture-row > span:first-child {
              width: 1.1rem !important;
              height: 1.1rem !important;
              font-size: 0.54rem !important;
            }
            .landing-call-capture-row strong {
              font-size: 0.56rem !important;
            }
            .landing-call-capture-row small {
              font-size: 0.52rem !important;
              line-height: 1.12 !important;
            }
            .landing-call-controls-redesign {
              display: block !important;
              margin-top: auto !important;
              padding-top: 0.65rem !important;
            }
            .landing-call-controls-redesign svg[viewBox="0 0 120 42"] {
              height: 2rem !important;
            }
            .landing-call-controls-redesign > div {
              margin-top: 0.35rem !important;
            }
            .landing-call-controls-redesign .landing-call-button {
              width: 2rem !important;
              height: 2rem !important;
            }
            .landing-call-controls-redesign .landing-call-button svg {
              width: 1rem !important;
              height: 1rem !important;
            }
            .landing-call-controls-redesign .landing-hangup-button {
              width: 2.65rem !important;
              height: 2.65rem !important;
            }
            .landing-call-controls-redesign .landing-hangup-button svg {
              width: 1.25rem !important;
              height: 1.25rem !important;
            }
            .landing-conversation-column-redesign {
              min-height: 0 !important;
              overflow: hidden !important;
              padding: 0.9rem 1rem 0.8rem !important;
            }
            .landing-call-dashboard-redesign .landing-conversation-header {
              gap: 0.75rem !important;
            }
            .landing-call-dashboard-redesign .landing-conversation-header > div > p {
              font-size: 0.54rem !important;
            }
            .landing-call-dashboard-redesign .landing-conversation-title {
              margin-top: 0.2rem !important;
              font-size: 1rem !important;
              line-height: 1.08 !important;
            }
            .landing-call-dashboard-redesign .landing-call-audio-button {
              padding: 0.4rem 0.62rem !important;
              font-size: 0.58rem !important;
            }
            .landing-call-dashboard-redesign .landing-call-audio-button > span:first-child {
              width: 1.35rem !important;
              height: 1.35rem !important;
            }
            .landing-call-dashboard-redesign .landing-conversation-panel {
              flex: 1 1 auto !important;
              min-height: 0 !important;
              margin-top: 0.65rem !important;
              padding: 0.55rem 0.72rem !important;
              border-radius: 15px !important;
            }
            .landing-call-dashboard-redesign .landing-call-transcript-turn {
              grid-template-columns: 1.6rem minmax(0,1fr) !important;
              gap: 0.52rem !important;
              padding-block: 0.35rem !important;
            }
            .landing-call-dashboard-redesign .landing-call-transcript-avatar {
              width: 1.6rem !important;
              height: 1.6rem !important;
              font-size: 0.5rem !important;
            }
            .landing-call-dashboard-redesign .landing-call-transcript-turn p {
              margin-top: 0.2rem !important;
              font-size: 0.67rem !important;
              line-height: 1.2 !important;
            }
            .landing-call-dashboard-redesign .landing-call-transcript-meta strong {
              font-size: 0.57rem !important;
            }
            .landing-call-dashboard-redesign .landing-call-transcript-meta time {
              font-size: 0.5rem !important;
            }
            .landing-followup-tray {
              padding: 0.72rem 0.9rem 0.85rem !important;
              box-shadow: inset 0 1px 0 rgba(255,255,255,0.035);
            }
            .landing-followup-heading > div > span:last-child strong {
              font-size: 0.65rem !important;
            }
            .landing-followup-heading > div > span:last-child > span {
              font-size: 0.57rem !important;
            }
            .landing-followup-grid {
              margin-top: 0.58rem !important;
              gap: 0.6rem !important;
            }
            .landing-call-dashboard-redesign .landing-followup-card {
              width: auto !important;
              min-width: 0 !important;
              margin: 0 !important;
              padding: 0 !important;
              border-width: 1px !important;
              border-radius: 13px !important;
              animation: none !important;
              transform: none !important;
            }
            .landing-followup-card header {
              padding: 0.42rem 0.55rem !important;
            }
            .landing-followup-card header > span:first-child > span:first-child {
              width: 1.35rem !important;
              height: 1.35rem !important;
              font-size: 0.44rem !important;
            }
            .landing-followup-card header strong {
              font-size: 0.58rem !important;
            }
            .landing-followup-card header small,
            .landing-followup-card header > span:last-child {
              font-size: 0.42rem !important;
            }
            .landing-followup-owner-body {
              gap: 0.18rem 0.55rem !important;
              padding: 0.5rem 0.58rem !important;
              font-size: 0.51rem !important;
              line-height: 1.15 !important;
            }
            .landing-followup-customer-body {
              padding: 0.55rem 0.62rem !important;
              font-size: 0.54rem !important;
              line-height: 1.25 !important;
            }
          }
          @media (min-width: 1500px) and (min-height: 840px) {
            .landing-call-dashboard-redesign .landing-call-transcript-turn p {
              font-size: 0.72rem !important;
            }
            .landing-followup-owner-body,
            .landing-followup-customer-body {
              font-size: 0.58rem !important;
            }
          }
          @media (min-width: 1200px) and (max-height: 760px) {
            .landing-call-dashboard-redesign > .landing-call-dashboard-surface {
              height: clamp(560px, calc(100svh - 104px), 610px) !important;
              min-height: 560px !important;
            }
            .landing-call-capture-row:nth-child(2) {
              display: none !important;
            }
            .landing-call-dashboard-redesign .landing-call-controls-redesign svg[viewBox="0 0 120 42"] {
              display: none !important;
            }
            .landing-call-dashboard-redesign .landing-call-controls-redesign {
              padding-top: 0.25rem !important;
            }
            .landing-call-dashboard-redesign .landing-conversation-column-redesign {
              padding-top: 0.72rem !important;
              padding-bottom: 0.58rem !important;
            }
            .landing-call-dashboard-redesign .landing-conversation-title {
              font-size: 0.9rem !important;
            }
            .landing-call-dashboard-redesign .landing-conversation-panel {
              margin-top: 0.45rem !important;
              padding: 0.4rem 0.6rem !important;
            }
            .landing-call-dashboard-redesign .landing-call-transcript-intro {
              min-height: 1.35rem !important;
              padding-bottom: 0.3rem !important;
            }
            .landing-call-dashboard-redesign .landing-call-transcript-intro > span:last-child {
              display: none !important;
            }
            .landing-call-dashboard-redesign .landing-call-transcript-turn {
              grid-template-columns: 1.35rem minmax(0,1fr) !important;
              gap: 0.42rem !important;
              padding-block: 0.2rem !important;
            }
            .landing-call-dashboard-redesign .landing-call-transcript-avatar {
              width: 1.35rem !important;
              height: 1.35rem !important;
              font-size: 0.42rem !important;
            }
            .landing-call-dashboard-redesign .landing-call-transcript-turn p {
              margin-top: 0.12rem !important;
              font-size: 0.59rem !important;
              line-height: 1.12 !important;
            }
            .landing-call-dashboard-redesign .landing-call-transcript-meta strong {
              font-size: 0.5rem !important;
            }
            .landing-call-dashboard-redesign .landing-call-transcript-meta time {
              font-size: 0.44rem !important;
            }
            .landing-call-dashboard-redesign .landing-call-audio-progress {
              padding-top: 0.3rem !important;
              font-size: 0.48rem !important;
            }
          }
          /* The carousel preview and the revealed recorded call occupy one
             identical desktop stage so the hero never jumps or changes size. */
          @media (min-width: 1024px) {
            .landing-hero-demo-stage {
              position: relative;
              width: 100%;
              height: 36rem;
              perspective: 1700px;
              perspective-origin: 50% 46%;
            }
            .landing-hero-demo-view {
              width: 100%;
              height: 100%;
              transform-style: preserve-3d;
              backface-visibility: hidden;
              will-change: transform, opacity, filter;
            }
            .landing-hero-demo-view-animated.landing-hero-demo-view-call {
              animation: landing-hero-demo-spin-from-slides 820ms cubic-bezier(.17,.79,.2,1) both;
            }
            .landing-hero-demo-view-animated.landing-hero-demo-view-slides {
              animation: landing-hero-demo-spin-from-call 820ms cubic-bezier(.17,.79,.2,1) both;
            }
            .landing-hero-proof-wrap .landing-call-dashboard-redesign {
              width: 100% !important;
              max-width: none !important;
              height: 36rem !important;
            }
            .landing-hero-proof-wrap .landing-call-dashboard-redesign > .landing-call-dashboard-surface {
              width: 100% !important;
              height: 36rem !important;
              min-height: 36rem !important;
              max-height: 36rem !important;
            }
          }
          @media (min-width: 1280px) {
            .landing-hero-visual {
              transform: translateY(1.5rem) !important;
            }
          }
          @keyframes landing-hero-demo-spin-from-slides {
            0% {
              opacity: 0;
              transform: rotateY(-104deg) scale(0.9);
              filter: brightness(0.62) blur(3px);
            }
            56% {
              opacity: 1;
              transform: rotateY(8deg) scale(1.015);
              filter: brightness(1.08) blur(0);
            }
            78% {
              transform: rotateY(-2.5deg) scale(0.998);
            }
            100% {
              opacity: 1;
              transform: rotateY(0deg) scale(1);
              filter: none;
            }
          }
          @keyframes landing-hero-demo-spin-from-call {
            0% {
              opacity: 0;
              transform: rotateY(104deg) scale(0.9);
              filter: brightness(0.62) blur(3px);
            }
            56% {
              opacity: 1;
              transform: rotateY(-8deg) scale(1.015);
              filter: brightness(1.08) blur(0);
            }
            78% {
              transform: rotateY(2.5deg) scale(0.998);
            }
            100% {
              opacity: 1;
              transform: rotateY(0deg) scale(1);
              filter: none;
            }
          }
          /* Desktop hero story: turn the existing copy into one guided
             problem -> solution -> outcome sequence instead of loose blocks. */
          @media (min-width: 640px) {
            .landing-hero-story-stack {
              position: relative;
              width: 100%;
              max-width: 34rem;
            }
            .landing-hero-story-eyebrow {
              display: inline-flex;
              align-items: center;
              gap: 0.55rem;
              margin: 0 0 0.8rem;
              padding: 0.28rem 0.72rem 0.28rem 0.32rem;
              border: 1px solid rgba(203, 46, 37, 0.2);
              border-radius: 999px;
              background: rgba(255, 255, 255, 0.72);
              box-shadow: 0 10px 24px -21px rgba(129, 29, 23, 0.8);
              color: #b42318;
            }
            .landing-hero-story-index {
              display: grid;
              width: 1.45rem;
              height: 1.45rem;
              flex: 0 0 auto;
              place-items: center;
              border-radius: 50%;
              background: #d92d20;
              color: #fff;
              font-size: 0.55rem;
              letter-spacing: 0;
              box-shadow: 0 5px 12px -7px rgba(217, 45, 32, 0.9);
            }
            .landing-hero-story-stack .landing-hero-title {
              margin: 0 !important;
            }
            .landing-hero-problem-bridge {
              display: flex;
              align-items: center;
              gap: 0.45rem;
              margin: 0.85rem 0 0.4rem;
              padding-left: 0.75rem;
            }
            .landing-hero-problem-line {
              position: relative;
              z-index: 1;
              margin: 0 !important;
              font-size: clamp(1.35rem, 2.1vw, 1.9rem) !important;
              line-height: 1 !important;
              letter-spacing: -0.035em !important;
              white-space: nowrap;
            }
            .landing-hero-problem-line::after {
              content: "";
              position: absolute;
              z-index: -1;
              right: -0.25rem;
              bottom: -0.35rem;
              left: -0.2rem;
              height: 0.55rem;
              border-top: 3px solid rgba(222, 43, 36, 0.9);
              border-radius: 55% 45% 0 0;
              transform: rotate(-1deg);
            }
            .landing-hero-story-arrow {
              width: 3.15rem;
              height: 2.6rem;
              flex: 0 0 auto;
              overflow: visible;
              color: #e04439;
              transform: translateY(0.45rem) rotate(2deg);
            }
            .landing-hero-solution-card {
              position: relative;
              margin-top: 0.1rem;
              padding: 0.9rem 1rem 0.85rem 1.1rem;
              border: 1px solid rgba(86, 157, 216, 0.38);
              border-left: 4px solid #1685d1;
              border-radius: 0.45rem 1.15rem 1.15rem 1.15rem;
              background: linear-gradient(135deg, rgba(255, 255, 255, 0.94), rgba(234, 247, 255, 0.9));
              box-shadow: 0 18px 34px -31px rgba(11, 72, 128, 0.9);
            }
            .landing-hero-solution-card .landing-hero-coverage {
              margin: 0.68rem 0 0 !important;
              padding: 0.48rem 0.68rem !important;
              border-left-width: 3px !important;
              border-radius: 0 0.55rem 0.55rem 0;
              font-size: 0.88rem !important;
            }
            .landing-hero-story-stack + .landing-hero-actions {
              margin-top: 1rem !important;
            }
          }
          @media (prefers-reduced-motion: reduce) {
            .landing-hero-demo-view-animated {
              animation: landing-hero-demo-fade-in 180ms ease-out both !important;
            }
          }
          @keyframes landing-hero-demo-fade-in {
            from { opacity: 0; }
            to { opacity: 1; }
          }
        `}</style>
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_16%_18%,rgba(187,222,255,0.74),transparent_30%),radial-gradient(circle_at_78%_12%,rgba(213,235,255,0.70),transparent_32%),linear-gradient(180deg,#ffffff_0%,#f6fbff_28%,#e9f6ff_100%)]" />
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(37,99,235,0.06)_1px,transparent_1px),linear-gradient(rgba(37,99,235,0.045)_1px,transparent_1px)] bg-[size:76px_76px] opacity-[0.32]" />

        <div className="landing-hero-shell relative z-10 mx-auto flex w-full max-w-[1360px] flex-col px-5 py-5 sm:px-8 lg:min-h-[calc(100vh-76px)] lg:px-10 lg:py-5 2xl:px-10 2xl:py-5">
          <nav className="grid shrink-0 gap-5 lg:grid-cols-[auto_1fr_auto] lg:items-center">
            <div className="landing-desktop-brand">
              <HeroLogoMark />
            </div>
            <p className="landing-mobile-contractor-label hidden" aria-label="Attention contractors">
              Attention contractors!
            </p>
            <div className="hidden justify-self-center lg:block">
              <a href="tel:+12495033301" className="inline-flex items-center gap-3 rounded-xl border border-[#a9cbed] bg-white/72 px-3.5 py-2 text-left text-[#0b315f] shadow-[0_10px_24px_-22px_rgba(12,77,160,0.62)] transition hover:border-[#6da8df] hover:bg-white">
                <span className="grid h-9 w-9 place-items-center rounded-lg bg-[#0c5fc3] text-white">
                  <HeroIcon type="phone" className="h-5 w-5" />
                </span>
                <span>
                  <span className="block text-[0.68rem] font-black uppercase leading-none tracking-[0.14em] text-[#52677f]">Call the Live Demo</span>
                  <span className="mt-1 block text-[1.02rem] font-black leading-none tracking-[-0.02em] text-[#0c5fc3]">(249) 503-3301</span>
                </span>
              </a>
            </div>
            <div className="flex flex-wrap items-center gap-3 sm:gap-5 lg:justify-end">
              <button
                type="button"
                onClick={goToSignup}
                className="inline-flex min-w-[230px] items-center justify-center whitespace-nowrap rounded-xl bg-[linear-gradient(180deg,#ff7a00,#ff6500)] px-4 py-3 text-base font-black text-white shadow-[0_18px_42px_-24px_rgba(255,106,0,0.95)] transition hover:-translate-y-0.5 hover:brightness-110 sm:py-3.5 2xl:min-w-[250px] 2xl:px-6 2xl:py-4 2xl:text-lg"
              >
                Start Your Free Trial
              </button>
            </div>
          </nav>

          <div className="landing-hero-grid relative grid flex-1 gap-10 py-5 lg:grid-cols-[minmax(380px,0.7fr)_minmax(620px,1.3fr)] lg:items-center xl:grid-cols-[minmax(430px,0.72fr)_minmax(680px,1.28fr)] xl:gap-16 2xl:gap-16 2xl:py-5">
            <ResponsiveProofHero
              goToSignup={goToSignup}
              playDemo={playDemo}
              onHearLiveCall={toggleAudio}
              audioPlaying={audioPlaying}
            />
            <div className="landing-hero-copy-column relative z-10 min-w-0 max-w-[500px] xl:max-w-[520px] lg:-translate-y-1">
              <div className="landing-mobile-proof-first sm:hidden">
                <p className="mb-3 text-center text-[0.66rem] font-black uppercase tracking-[0.14em] text-[#c92a20]">Stop losing jobs to missed calls</p>
                <h1 className="landing-mobile-proof-title landing-stripe-headline font-black tracking-[-0.055em] text-[#07142a]">
                  <span className="block">Never miss a call</span>
                  <span className="block">again!</span>
                </h1>
                <p className="landing-mobile-proof-pain landing-chalk-pain font-black text-[#c92a20]">Missed Calls = Missed Jobs</p>
                <HeroActionFlow className="landing-action-flow-mobile" />
                <p className="landing-mobile-coverage-card">Keep your existing business number.</p>
                <div className="mb-3 mt-4 flex justify-center">
                  <HeroLiveCallButton audioPlaying={audioPlaying} onClick={toggleAudio} className="w-full max-w-[18rem]" />
                </div>
                <MobileHeroCallProof onSampleCall={playDemo} onStartTrial={goToSignup} />

                <div className="landing-mobile-proof-trust" aria-label="Trial details">
                  {["14-Day Free Trial", "No Credit Card", "Cancel Anytime"].map((label) => (
                    <span key={label}><b aria-hidden="true">✓</b>{label}</span>
                  ))}
                </div>

              </div>

              <div className="hidden sm:block">
              <div className="landing-hero-story-stack">
                <p className="landing-hero-story-eyebrow text-[0.68rem] font-black uppercase tracking-[0.14em]">
                  <span className="landing-hero-story-index" aria-hidden="true">01</span>
                  <span>Stop losing jobs to missed calls</span>
                </p>
                <h1 className="landing-hero-title text-[clamp(3rem,11vw,4.25rem)] font-black leading-[0.98] tracking-[-0.055em] text-[#07142a] 2xl:text-[4.5rem]">
                  <span className="landing-stripe-headline block drop-shadow-[0_3px_0_rgba(148,190,255,0.45)]">Never miss a call again!</span>
                </h1>

                <div className="landing-hero-problem-bridge" aria-label="Missed calls become missed jobs, and My AI PA provides the solution">
                  <p className="landing-hero-problem-line landing-chalk-pain font-black text-[#d91d12]">Missed Calls = Missed Jobs</p>
                  <svg className="landing-hero-story-arrow" viewBox="0 0 64 48" aria-hidden="true">
                    <path d="M4 7 C 28 5, 47 14, 51 34" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                    <path d="M42 30 L 52 38 L 59 27" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>

                <div className="landing-hero-solution-card">
                  <HeroActionFlow className="landing-action-flow-desktop" />
                  <p className="landing-hero-coverage inline-block border-l-4 border-[#17951f] bg-[#e1f8e5]/90 px-3 py-2 text-[1.05rem] font-black leading-tight text-[#147d1b]">
                    Keep your existing business number.
                  </p>
                </div>
              </div>

              <div className="landing-hero-actions mt-6">
                <div className="flex flex-col gap-2.5 sm:flex-row">
                  <button
                    type="button"
                    onClick={goToSignup}
                    className="inline-flex min-h-[46px] items-center justify-center rounded-xl bg-[linear-gradient(180deg,#ff7a00,#ff6500)] px-5 text-[0.86rem] font-black text-white shadow-[0_16px_32px_-22px_rgba(255,106,0,0.95)] transition hover:-translate-y-0.5 hover:brightness-110"
                  >
                    <span className="sm:hidden">Start Free Trial</span>
                    <span className="hidden sm:inline">Start Your Free Trial</span>
                  </button>
                  <button
                    type="button"
                    onClick={playDemo}
                    className="inline-flex min-h-[46px] items-center justify-center rounded-xl border border-[#79aee0] bg-white/80 px-5 text-[0.86rem] font-black text-[#0c5fc3] transition hover:-translate-y-0.5 hover:bg-white"
                  >
                    <span className="sm:hidden">See Example</span>
                    <span className="hidden sm:inline">See a Sample Call</span>
                  </button>
                </div>
                <div className="landing-hero-trust mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[0.68rem] font-black text-[#294967]">
                  {[
                    { desktop: "14-Day Free Trial", mobile: "14 days free" },
                    { desktop: "No Credit Card", mobile: "No card" },
                    { desktop: "Cancel Anytime", mobile: "Cancel anytime" },
                  ].map((label) => (
                    <span key={label.desktop} className="inline-flex items-center gap-1.5">
                      <span className="text-[#17951f]" aria-hidden="true">✓</span>
                      <span className="sm:hidden">{label.mobile}</span>
                      <span className="hidden sm:inline">{label.desktop}</span>
                    </span>
                  ))}
                </div>
              </div>

              </div>
            </div>

            <div className="landing-hero-visual relative z-0 mt-8 hidden justify-end sm:flex lg:mt-2 lg:self-center">
              <div className="landing-hero-proof-wrap w-full">
                <div className="landing-hero-proof-heading-row mb-2 flex min-h-[2.65rem] items-center gap-3">
                  <p className="landing-hero-proof-heading min-w-0 flex-1 text-center text-[0.72rem] font-black uppercase tracking-[0.1em] text-[#294967]">
                    {heroDemoRevealed ? "The complete recorded-call example." : "Swipe or click through all three parts of the missed-call story."}
                  </p>
                  <button
                    type="button"
                    onClick={heroDemoRevealed ? returnToHeroSlides : revealHeroDemo}
                    className="landing-hero-live-call-button inline-flex min-h-[2.65rem] shrink-0 items-center justify-center gap-2 rounded-full border border-[#4a9be0] bg-[#0c4e8e] px-4 text-[0.72rem] font-black text-white shadow-[0_12px_26px_-18px_rgba(12,78,142,0.95)] transition hover:-translate-y-0.5 hover:bg-[#0d5ca8] focus:outline-none focus-visible:ring-4 focus-visible:ring-[#68c8ff]/45"
                    aria-label={heroDemoRevealed ? "Return to the three-slide missed-call demonstration" : "Hear the complete recorded live-call demonstration"}
                  >
                    <span className="grid h-6 w-6 place-items-center rounded-full bg-[#2bbdf4] text-[0.65rem] text-white" aria-hidden="true">{heroDemoRevealed ? "↶" : "▶"}</span>
                    {heroDemoRevealed ? "Back to 3 Slides" : "Hear Live Call"}
                  </button>
                </div>
                <div className="landing-hero-demo-stage">
                  {heroDemoRevealed ? (
                    <div className={`landing-hero-demo-view landing-hero-demo-view-call ${heroDemoHasTransitioned ? "landing-hero-demo-view-animated" : ""}`}>
                      <HeroCallDashboard
                        ownerCardRef={heroOwnerCardRef}
                        onRevealDemo={revealHeroDemo}
                        onToggleAudio={toggleAudio}
                        audioPlaying={audioPlaying}
                        audioTime={audioTime}
                        audioDuration={audioDuration}
                        demoRevealed
                      />
                    </div>
                  ) : (
                    <div className={`landing-hero-demo-view landing-hero-demo-view-slides ${heroDemoHasTransitioned ? "landing-hero-demo-view-animated" : ""}`}>
                      <MobileHeroCallProof
                        className="landing-desktop-call-proof"
                        onSampleCall={revealHeroDemo}
                        onStartTrial={goToSignup}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

        </div>
      </section>

      <LandingStoryIntroduction />

      <section id="mobile-scroll-call-story" ref={landingDemoRef} className="fcr-demo tims-demo tims-demo-landing scroll-mt-[76px]">
        <TimsElectricalLiveDemo embedded onSignup={goToSignup} />
      </section>

      <LandingChapters
        goToSignup={goToSignup}
        playDemo={playDemo}
        openFaq={openFaq}
        setOpenFaq={setOpenFaq}
      />

      <section id="homepage-hero-details" className="hidden overflow-hidden border-y border-[#cfe2f5] bg-white sm:block sm:relative">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_14%_20%,rgba(191,219,254,0.42),transparent_32%),radial-gradient(circle_at_88%_82%,rgba(219,234,254,0.58),transparent_34%)]" />
        <div className="relative mx-auto grid w-full max-w-[1360px] gap-8 px-5 py-10 sm:px-8 sm:py-12 lg:grid-cols-[minmax(0,0.92fr)_minmax(440px,1.08fr)] lg:items-center lg:px-10 lg:py-14">
          <div>
            <div className="inline-flex max-w-full items-center gap-3 rounded-2xl border border-[#c9e2fb] bg-[#f4f9ff] px-3 py-2 text-[#0b315f] shadow-[0_12px_30px_-26px_rgba(12,77,160,0.62)] sm:px-4">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[linear-gradient(145deg,#166fcf,#0a4c99)] text-white">
                <HeroIcon type="phone" className="h-5 w-5" />
              </span>
              <span className="min-w-0">
                <span className="block text-[0.94rem] font-black uppercase leading-none tracking-[0.08em] sm:text-[1.04rem]">
                  <span className="text-[#1674df]">AI</span> Telephone Answering
                </span>
                <span className="mt-1.5 block text-[0.66rem] font-black uppercase leading-none tracking-[0.22em] text-[#426488] sm:text-[0.72rem]">
                  Built for the trades
                </span>
              </span>
            </div>

            <h2 className="mt-5 max-w-[650px] text-[clamp(2.35rem,6vw,4.35rem)] font-black leading-[0.98] tracking-[-0.055em] text-[#07142a]">
              Answers the phone <span className="text-[#1674df]">when you can&apos;t.</span>
            </h2>
            <p className="mt-5 text-[1.08rem] font-bold leading-7 text-[#294967] sm:text-[1.22rem]">
              24/7 Call Coverage.
            </p>
          </div>

          <div className="rounded-[28px] border border-[#c9dff3] bg-[linear-gradient(145deg,#f8fbff,#edf6ff)] p-5 shadow-[0_28px_70px_-48px_rgba(12,77,160,0.72)] sm:p-7">
            <p className="text-[clamp(1.2rem,3vw,1.7rem)] font-black uppercase leading-tight tracking-[-0.025em]">
              <span className="text-[#123b68]">Stop losing customers.</span>
              <span className="mx-2 text-[#64748b]" aria-hidden="true">→</span>
              <span className="text-[#17951f]">Start winning today!</span>
            </p>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={goToSignup}
                className="inline-flex min-h-[50px] flex-1 items-center justify-center rounded-xl bg-[#0c5fc3] px-7 text-[1rem] font-black text-white shadow-[0_16px_32px_-20px_rgba(12,95,195,0.9)] transition hover:-translate-y-0.5 hover:bg-[#084fA6]"
              >
                Start Your Free Trial
              </button>
              <button
                type="button"
                onClick={playDemo}
                className="inline-flex min-h-[50px] flex-1 items-center justify-center rounded-xl border-2 border-[#1d5ea8]/70 bg-white px-7 text-[1rem] font-black text-[#0b3b7a] transition hover:bg-[#f5faff]"
              >
                <svg viewBox="0 0 24 24" className="mr-2 h-5 w-5" fill="currentColor" aria-hidden="true">
                  <path d="M8.2 5.6v12.8L18 12 8.2 5.6Z" />
                </svg>
                Play Recorded Sample
              </button>
            </div>

            <div className="mt-5 grid grid-cols-3 gap-2 text-center text-[0.72rem] font-black text-[#294967] sm:text-[0.84rem]">
              {["14-Day Free Trial", "No Credit Card", "Cancel Anytime"].map((label) => (
                <span key={label} className="inline-flex items-center justify-center gap-1.5">
                  <span className="text-[#17951f]" aria-hidden="true">✓</span>
                  {label}
                </span>
              ))}
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

            <h2 className="mt-8 max-w-3xl text-[3rem] font-black uppercase leading-[0.9] tracking-[-0.06em] text-white sm:text-[4.25rem] sm:leading-[0.88] lg:text-[5rem]">
              <span className="block sm:whitespace-nowrap">Answers the phone</span>
              <span className="block bg-[linear-gradient(135deg,#8b5cff_0%,#6e7dff_46%,#39b9ff_100%)] bg-clip-text text-transparent">
                when you can&apos;t
              </span>
            </h2>

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
                    <span className="block whitespace-nowrap">Call!</span>
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
                      "Talks with callers and answers questions",
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
                How AI Turns <span className="text-[#ff9d22]">missed callers into customers</span>
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
                  text: "The customer gets a clear confirmation, knows what happens next, and waits for your callback.",
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
          <div className="hidden sm:block">
          <div className="contractor-proof-mobile-intro sm:hidden">
            <p className="text-[0.7rem] font-black uppercase tracking-[0.16em] text-[#176bff]">Proof before promises</p>
            <h2 className="mt-2 text-[1.8rem] font-black leading-none tracking-[-0.045em] text-[#07142a]">Hear a recorded call become usable job details.</h2>
            <p className="mt-3 text-[0.98rem] font-medium leading-6 text-[#475569]">Listen to the assistant answer, ask the right questions, and prepare the follow-up text.</p>
          </div>

          <div className="contractor-benefits-intro mx-auto max-w-[980px] text-center">
            <p className="text-[0.7rem] font-black uppercase tracking-[0.22em] text-[#1d7df2] sm:text-[0.78rem]">Designed for contractors</p>
            <h2 className="mx-auto mt-2 max-w-[860px] text-[clamp(2rem,4vw,3.2rem)] font-black leading-[0.98] tracking-[-0.052em] text-[#07142a]">
              Designed for contractors who cannot pause the job to answer every call.
            </h2>
            <p className="mx-auto mt-3 max-w-[780px] text-[0.98rem] font-medium leading-7 text-[#475569] sm:text-[1.08rem]">
              Electrical, plumbing, HVAC, and contractor teams get a practical assistant that answers service calls, collects quote details, and texts the crew while the work keeps moving.
            </p>
          </div>

          <div className="mt-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {benefitCards.map((item) => (
              <article
                key={item.title}
                className={
                  "contractor-benefit-card relative min-h-[132px] overflow-hidden rounded-[8px] border border-[#dbeafe] bg-white px-4 py-4 shadow-[0_18px_44px_-34px_rgba(15,23,42,0.32)] " +
                  (item.eyebrow === "Catch every call" ? "contractor-benefit-repeated " : "") +
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

          <div className="contractor-proof-demo mt-5 overflow-hidden rounded-[8px] border border-[#123253] bg-[#051d3b] shadow-[0_30px_80px_-48px_rgba(7,20,42,0.74)]">
            <div className="grid gap-5 p-4 sm:p-5 lg:grid-cols-[1.05fr_0.95fr] lg:p-7">
              <div className="min-w-0">
                <p className="text-[0.72rem] font-black uppercase tracking-[0.16em] text-[#64c9ff]">Proof in action</p>
                <h3 className="mt-2 max-w-[610px] text-[clamp(1.55rem,2.8vw,2.45rem)] font-black leading-[1.02] tracking-[-0.045em] text-white">
                  Hear a recorded example of the agent taking a service call.
                </h3>
                <p className="mt-3 max-w-[590px] text-[0.96rem] font-medium leading-7 text-[#cfe7ff]">
                  Hear a recorded service-call demonstration. The assistant answers common questions and gathers the problem, service address, preferred timing, and callback number.
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
                        <p className="text-[0.72rem] font-black uppercase tracking-[0.14em] text-[#7dd3fc]">Recorded demo call</p>
                        <p className="mt-1 text-[1.05rem] font-black leading-tight text-white sm:text-[1.22rem]">Electrical setup lead</p>
                        <p className="mt-1 max-w-[440px] text-[0.86rem] font-medium leading-6 text-[#cfe7ff]">
                          My AI PA captures the problem, service address, urgency, preferred timing, and best callback number.
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

                <div className="contractor-proof-transcript mt-3 rounded-[8px] border border-[#21476f] bg-[#092646] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="grid h-7 w-7 place-items-center rounded-full bg-[#0d3764] text-[#8bdcff]">
                        <HeroIcon type="chat" className="h-4 w-4" />
                      </span>
                      <p className="text-[0.72rem] font-black uppercase tracking-[0.14em] text-[#7dd3fc]">Synchronized transcript</p>
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
                    setAudioTime(audioRef.current?.duration || heroTranscriptTimings.durationSeconds);
                  }}
                  onTimeUpdate={(event) => setAudioTime(event.currentTarget.currentTime || 0)}
                  onLoadedMetadata={(event) => {
                    setAudioError("");
                    const duration = Number(event.currentTarget.duration || heroTranscriptTimings.durationSeconds);
                    setAudioDuration(Number.isFinite(duration) && duration > 0 ? duration : heroTranscriptTimings.durationSeconds);
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
                    Thanks for calling Tim&apos;s Electrical. We received your hot tub wiring request. The team will follow up to discuss the details and next steps. Have a great day!
                  </p>
                </div>

                <div className="grid gap-2 rounded-[8px] bg-white px-3 py-3 sm:grid-cols-2">
                  {[
                    ["shield", "Calls covered", "When call forwarding is active"],
                    ["clock", "Work keeps moving", "You never stop the job"],
                    ["chat", "Job details ready", "Texts both you and the caller"],
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
                ["shield", "Designed for contractors", "across Southern Ontario"],
                ["people", "Project a professional image", "for about the price of a cup of coffee per day"],
                ["lock", "No-card trial", "14 days to try it"],
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
        </div>
      </section>

      <section id="pricing" ref={pricingRef} className="scroll-mt-[96px] bg-[linear-gradient(180deg,#edf7ff_0%,#f8fcff_55%,#eef8ff_100%)]">
        <div className="mx-auto w-full max-w-[1320px] px-4 py-14 sm:px-6 lg:px-8 lg:py-20">
          <div className="mx-auto max-w-5xl text-center">
            <p className="inline-flex rounded-full border border-[#c7ddff] bg-white/86 px-5 py-2 text-[0.84rem] font-black uppercase tracking-[0.18em] text-[#2563eb] shadow-[0_16px_44px_-36px_rgba(37,99,235,0.58)]">SIMPLE MONTHLY PLAN - Cancel anytime</p>
            <h2 className="mx-auto mt-4 max-w-[980px] text-[clamp(2.1rem,4vw,3.35rem)] font-black leading-[1.04] tracking-[-0.052em] text-[#07142a]">
              Clear pricing for businesses that just want calls handled properly.
            </h2>
            <p className="mx-auto mt-3 max-w-[900px] text-[clamp(1rem,1.3vw,1.16rem)] font-medium leading-8 text-[#334155]">
              One simple plan for getting calls answered. Includes 60 AI call minutes.
            </p>
          </div>

          {pricingCards.map((plan) => (
            <div key={plan.name} className="pricing-plan-grid mt-8 grid min-w-0 items-start gap-6 lg:grid-cols-[1.38fr_0.92fr]">
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
                      <span>PRICE INCLUDES:</span>
                      <span>Price</span>
                    </div>

                    {[
                      ["phone", "60 AI call minutes per month", "CALLS OVER 60 min, BILLED AT $0.25 PER MINUTE.", "60 minutes included"],
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
                    <div className="flex items-center gap-4 border-b-2 border-[#73a6ef] pb-3">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="text-[1.25rem] leading-none text-[#176bff]" aria-hidden="true">+</span>
                        <span>APPLICABLE TAXES</span>
                      </span>
                    </div>
                  </div>

                  <div className="relative mx-auto mt-3 max-w-[620px] -rotate-[0.35deg] border border-[#c9b86d] bg-[linear-gradient(180deg,#fffce3,#fff8bf)] px-5 py-5 text-center shadow-[0_18px_42px_-30px_rgba(71,55,8,0.65)] sm:px-8">
                    <span className="absolute left-1/2 top-[-12px] h-6 w-28 -translate-x-1/2 rotate-[-1.5deg] bg-[#d9d2bc]/85 shadow-sm" aria-hidden="true" />
                    <div className="relative grid gap-1.5 font-black text-[#172033]">
                      <p className="text-[clamp(1rem,1.45vw,1.25rem)] leading-none tracking-[0.04em] text-[#dc2626]">OUR GUARANTEE</p>
                      <p className="text-[clamp(1.25rem,2vw,1.65rem)] leading-tight text-[#ef232e]">FREE 14-DAY TRIAL</p>
                      <p className="mx-auto max-w-[520px] text-[clamp(0.88rem,1.22vw,1.02rem)] leading-[1.45] tracking-normal normal-case">
                        If your assistant does not help you win extra jobs from missed calls, cancel within 14 days at no cost.
                      </p>
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
                      Start Your Free Trial
                      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
                        <path d="M5 12h13M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  </div>

                  <div className="mt-5 flex flex-wrap items-center gap-3 text-[1rem] font-black text-[#15803d]">
                    {["14-day free trial", "No setup fee", "Cancel anytime"].map((item) => (
                      <span key={item} className="inline-flex items-center gap-2 rounded-full border border-[#bbf7d0] bg-[#f0fdf4] px-3 py-2">
                        <span className="grid h-6 w-6 place-items-center rounded-full border-2 border-[#16a34a] text-[#16a34a]">
                          <HeroIcon type="check" className="h-4 w-4" />
                        </span>
                        {item}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              <div className="pricing-side-column grid min-w-0 gap-4">
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
                  <p className="text-center text-[0.82rem] font-black uppercase tracking-[0.15em] text-[#2563eb]">Pay only for chargeable minutes</p>
                  <div className="mt-4 grid items-center gap-3 text-center sm:grid-cols-[1fr_auto_1fr_auto_1fr]">
                    <div className="rounded-[8px] bg-[#eaf4ff] px-4 py-3 text-[#176bff]">
                      <p className="text-[0.9rem] font-black leading-tight text-[#334155]">USED MINUTES PER MONTH</p>
                    </div>
                    <span className="text-2xl font-black text-[#2563eb]">-</span>
                    <div className="rounded-[8px] bg-[#f8fbff] px-4 py-3 text-[#334155]">
                      <p className="text-[2rem] font-black leading-none text-[#176bff]">60</p>
                      <p className="text-[0.74rem] font-black leading-tight">FREE MINUTES</p>
                    </div>
                    <span className="text-2xl font-black text-[#2563eb]">=</span>
                    <div className="rounded-[8px] bg-[#e8f9ef] px-4 py-3 text-[#15803d]">
                      <p className="text-[0.9rem] font-black leading-tight">CHARGEABLE MINUTES.</p>
                      <p className="mt-1 text-[0.7rem] font-black leading-tight">BILLED AT $0.25 PER MINUTE</p>
                    </div>
                  </div>
                  <p className="mt-3 text-center text-[0.84rem] font-semibold text-[#64748b]">Billed in 1-minute increments. No surprises.</p>
                  <p className="mt-2 text-center text-[0.8rem] font-bold leading-5 text-[#334155]">
                    Each completed call adds its call time to your monthly usage. Call customer support anytime for your current monthly total.
                  </p>
                </div>

                <div className="rounded-[10px] border border-[#cfe1f6] bg-white p-5 shadow-[0_22px_58px_-46px_rgba(15,23,42,0.35)]">
                  <div className="flex items-center gap-5">
                    <span
                      className="grid h-20 w-16 shrink-0 place-items-center bg-[linear-gradient(180deg,#2f8cff,#176bff)] text-white shadow-[0_18px_34px_-22px_rgba(23,107,255,0.95)] [clip-path:polygon(50%_0%,92%_18%,85%_72%,50%_100%,15%_72%,8%_18%)]"
                      aria-hidden="true"
                    >
                      <HeroIcon type="check" className="h-8 w-8" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-[1.2rem] font-black uppercase leading-tight tracking-[0.04em] text-[#176bff]">NO SURPRISES.</p>
                      <p className="mt-2 text-[0.95rem] font-semibold leading-6 text-[#64748b]">
                        Your completed-call minutes are tracked throughout the month.
                      </p>
                      <span className="mt-3 inline-flex rounded-full bg-[#e8f9ef] px-4 py-2 text-[0.72rem] font-black uppercase tracking-[0.14em] text-[#15803d]">
                        EASY TO TRACK
                      </span>
                    </div>
                  </div>
                </div>

              </div>
            </div>
          ))}

        </div>
      </section>

      <section id="setup" className="scroll-mt-[96px] overflow-hidden bg-[linear-gradient(180deg,#eef8ff_0%,#dff1ff_100%)]">
        <div className="mx-auto w-full max-w-[720px] px-4 py-8 sm:hidden">
          <p className="text-[0.7rem] font-black uppercase tracking-[0.16em] text-[#176bff]">Simple setup</p>
          <h2 className="mt-2 text-[1.8rem] font-black leading-none tracking-[-0.045em] text-[#07142a]">Ready in three guided steps.</h2>
          <p className="mt-3 text-[0.98rem] font-medium leading-6 text-[#475569]">No phone-number change. Detailed carrier instructions appear only after you are ready to connect.</p>
          <div className="mt-5 grid gap-3">
            {[
              ["1", "Add your business", "Tell us what you do and how calls should be handled."],
              ["2", "Hear a test call", "Listen to your assistant before anything goes live."],
              ["3", "Forward missed calls", "Follow the guided steps when you are comfortable."],
            ].map(([number, title, body]) => (
              <article key={number} className="rounded-[14px] border border-[#cfe1f6] bg-white p-4 shadow-[0_18px_44px_-38px_rgba(15,23,42,0.28)]">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-[#176bff] text-base font-black text-white">{number}</span>
                <h3 className="mt-4 text-[1rem] font-black leading-tight text-[#07142a]">{title}</h3>
                <p className="mt-1 text-[0.88rem] font-medium leading-5 text-[#475569]">{body}</p>
              </article>
            ))}
          </div>
          <button
            type="button"
            onClick={goToSignup}
            className="mt-4 inline-flex min-h-[48px] items-center justify-center rounded-xl bg-[linear-gradient(180deg,#ff7a00,#ff6500)] px-5 text-[0.86rem] font-black text-white shadow-[0_16px_32px_-22px_rgba(255,106,0,0.95)]"
          >
            Start Your Free Trial
          </button>
        </div>

        <div className="mx-auto hidden w-full max-w-[1320px] px-4 py-14 sm:block sm:px-6 lg:px-8 lg:py-20">
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
                    ["My AI PA answers after 3 rings", "Questions handled and details collected", "headset"],
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
        <div className="mx-auto w-full max-w-[720px] px-4 py-8 sm:hidden">
          <p className="text-[0.7rem] font-black uppercase tracking-[0.16em] text-[#176bff]">Real trade workflows</p>
          <h2 className="mt-2 text-[1.8rem] font-black leading-none tracking-[-0.045em] text-[#07142a]">Built for calls that arrive while the work is happening.</h2>
          <div className="mt-5 grid gap-3">
            <article className="rounded-[14px] border border-[#18365d]/20 bg-[#07142a] p-5 text-white shadow-[0_26px_70px_-48px_rgba(7,20,42,0.82)]">
              <p className="text-[0.72rem] font-black uppercase tracking-[0.14em] text-[#8bdcff]">Contractor example</p>
              <p className="mt-4 text-[1rem] font-black leading-6">“I am usually on a job and not in a position to answer every call. Now people get a proper response and I get the details by text instead of chasing voicemails later.”</p>
              <p className="mt-4 border-t border-white/15 pt-3 text-[0.78rem] font-black text-[#22c55e]">Lead details delivered by text</p>
            </article>
            <article className="rounded-[14px] border border-[#d8e7fb] bg-white p-5 shadow-[0_18px_46px_-38px_rgba(15,23,42,0.28)]">
              <p className="text-[0.72rem] font-black uppercase tracking-[0.14em] text-[#176bff]">Plumbing example</p>
              <p className="mt-4 text-[1rem] font-black leading-6 text-[#334155]">“Service calls come in while we are driving between plumbing jobs. My AI PA talks with the customer, answers basic questions, and sends us the job details.”</p>
              <p className="mt-4 border-t border-[#e2e8f0] pt-3 text-[0.78rem] font-black text-[#16a34a]">Faster follow-up without stopping the job</p>
            </article>
          </div>
        </div>

        <div className="mx-auto hidden w-full max-w-[1320px] px-4 py-14 sm:block sm:px-6 lg:px-8 lg:py-20">
          <div className="grid gap-8 lg:grid-cols-[0.78fr_1.22fr] lg:items-start">
            <div className="lg:sticky lg:top-24">
              <p className="inline-flex rounded-full border border-[#b9d8ff] bg-white px-5 py-2 text-[0.84rem] font-black uppercase tracking-[0.18em] text-[#2563eb] shadow-[0_16px_44px_-34px_rgba(37,99,235,0.65)]">Field examples</p>
              <h2 className="mt-5 text-[clamp(2.25rem,4.4vw,3.9rem)] font-black leading-[1.04] tracking-[-0.052em] text-[#07142a]">What the workflow feels like when calls stop slipping through.</h2>
              <p className="mt-5 max-w-[560px] text-[1.08rem] font-medium leading-8 text-[#334155]">
                These examples focus on the real workflow: fewer voicemail chases, cleaner lead details, and faster response without stopping the job.
              </p>
              <div className="mt-6 grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
                <div className="rounded-[10px] border border-[#d8e7fb] bg-white px-4 py-3 shadow-[0_16px_38px_-34px_rgba(15,23,42,0.25)]">
                  <p className="text-[1.35rem] font-black leading-none text-[#176bff]">4</p>
                  <p className="mt-1 text-[0.78rem] font-black uppercase tracking-[0.12em] text-[#64748b]">missed-call moments</p>
                </div>
                <div className="flex items-center gap-4 rounded-[10px] border border-[#fecaca] bg-white px-4 py-4 shadow-[0_16px_38px_-34px_rgba(15,23,42,0.25)]">
                  <svg aria-hidden="true" viewBox="0 0 100 100" className="h-16 w-16 shrink-0 fill-[#ef232e]">
                    <path d="M50 3 56 24 68 15 65 34 83 27 76 46 94 43 82 58 91 64 60 70 62 83 54 79 55 98 45 98 46 79 38 83 40 70 9 64 18 58 6 43 24 46 17 27 35 34 32 15 44 24Z" />
                  </svg>
                  <div>
                    <p className="text-[1rem] font-black uppercase leading-tight tracking-[0.06em] text-[#ef232e]">PROUDLY DESIGNED IN CANADA</p>
                    <p className="mt-1 text-[0.74rem] font-black uppercase leading-snug tracking-[0.08em] text-[#475569]">BY CANADIANS FOR BUSY CANADIAN TRADES PEOPLE</p>
                  </div>
                </div>
                <div className="rounded-[10px] border border-[#d8e7fb] bg-white px-4 py-3 shadow-[0_16px_38px_-34px_rgba(15,23,42,0.25)]">
                  <p className="text-[1.35rem] font-black leading-none text-[#176bff]">Demo</p>
                  <p className="mt-1 text-[0.78rem] font-black uppercase tracking-[0.12em] text-[#64748b]">before hype</p>
                </div>
              </div>
            </div>

            <div className="grid gap-4">
              <article className="rounded-[14px] border border-[#d8e7fb] bg-[#07142a] p-5 text-white shadow-[0_30px_84px_-58px_rgba(15,23,42,0.58)] sm:p-7">
                <p className="text-[0.78rem] font-black uppercase tracking-[0.16em] text-[#8bdcff]">Featured field example</p>
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
                  ["Hamilton and Grimsby focused", "Built in Ontario for busy trades across Hamilton, Grimsby, and the surrounding area."],
                  ["Privacy-aware workflow", "Privacy and terms pages explain consent, safeguards, limited use, transcripts, and text messages."],
                  ["Concrete demos", "Demo audio, transcripts, and text follow-up examples keep the claims grounded."],
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
        <div className="mx-auto grid w-full max-w-[1320px] gap-7 px-4 py-14 sm:px-6 lg:grid-cols-[0.62fr_1.38fr] lg:px-8 lg:py-20">
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

      <section id="guided-call-forwarding" className="hidden scroll-mt-[96px] bg-[linear-gradient(180deg,#eaf6ff_0%,#dff1ff_100%)] sm:block">
        <div className="mx-auto w-full max-w-[1320px] px-4 py-14 sm:px-6 lg:px-8 lg:py-20">
          <ForwardingSetupWizard />
        </div>
      </section>

      <section id="trust" className="scroll-mt-[96px] bg-[#eaf6ff]">
        <div className="mx-auto w-full max-w-[720px] px-4 py-8 sm:hidden">
          <p className="text-[0.7rem] font-black uppercase tracking-[0.16em] text-[#176bff]">Trust and transparency</p>
          <h2 className="mt-2 text-[1.8rem] font-black leading-none tracking-[-0.045em] text-[#07142a]">Clear rules before your first call.</h2>
          <div className="mt-5 grid gap-3">
            {[
              ["Transparent AI calls", "Callers can be told they are speaking with an AI assistant."],
              ["Privacy and terms published", "Review how calls, transcripts, and texts are handled."],
              ["Consent-aware messaging", "Owner alerts and customer confirmations are treated as service messages."],
            ].map(([title, body]) => (
              <article key={title} className="grid grid-cols-[2.5rem_1fr] items-center gap-3 rounded-[14px] border border-[#cfe1f6] bg-white p-4">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-[#e8f9ef] text-lg font-black text-[#15803d]">✓</span>
                <div>
                  <h3 className="text-[1rem] font-black leading-tight text-[#07142a]">{title}</h3>
                  <p className="mt-1 text-[0.88rem] font-medium leading-5 text-[#475569]">{body}</p>
                </div>
              </article>
            ))}
          </div>
          <div className="mt-4 flex gap-2">
            <a href="/privacy.html" className="rounded-[10px] border border-[#9cc7ef] bg-white px-4 py-3 text-[0.72rem] font-black uppercase tracking-[0.08em] text-[#1557a0]">Privacy Policy</a>
            <a href="/terms.html" className="rounded-[10px] border border-[#9cc7ef] bg-white px-4 py-3 text-[0.72rem] font-black uppercase tracking-[0.08em] text-[#1557a0]">Terms</a>
          </div>
        </div>

        <div className="mx-auto hidden w-full max-w-[1180px] px-4 pb-14 sm:block sm:px-6 lg:px-8">
          <div className="grid overflow-hidden rounded-[16px] border border-[#d7e7fb] bg-white shadow-[0_28px_82px_-58px_rgba(18,32,51,0.34)] lg:grid-cols-[0.78fr_1.22fr]">
            <div className="bg-[#07142a] p-6 text-white sm:p-8">
              <p className="text-[0.84rem] font-black uppercase tracking-[0.18em] text-[#8bdcff]">Trust and transparency</p>
              <h2 className="mt-4 text-[clamp(2rem,3vw,3.05rem)] font-black leading-[1.06] tracking-[-0.045em]">Clear rules for calls, texts, and customer details.</h2>
              <div className="mt-6 flex flex-wrap gap-3">
                <a href="/privacy.html" className="rounded-[10px] border border-white/18 bg-white/10 px-4 py-3 text-sm font-black uppercase tracking-[0.12em] text-white transition hover:-translate-y-0.5">
                  Privacy Policy
                </a>
                <a href="/terms.html" className="rounded-[10px] border border-white/18 bg-white/10 px-4 py-3 text-sm font-black uppercase tracking-[0.12em] text-white transition hover:-translate-y-0.5">
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
                  Public privacy and terms pages, a no-credit-card trial, demo audio, transcripts, and text follow-up examples give customers proof they can inspect before launch.
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
                Try My AI PA free, hear how it sounds, and see how quickly missed calls can become job details ready for your callback.
              </p>
              <div className="mt-8 flex flex-col gap-4 sm:flex-row">
                <PrimaryButton onClick={goToSignup} className="text-lg">Start Your Free Trial</PrimaryButton>
                <SecondaryButton onClick={playDemo} dark className="text-lg">
                  <span className="sm:hidden">Hear Demo</span>
                  <span className="hidden sm:inline">Hear the Live Demo</span>
                </SecondaryButton>
              </div>
              <a
                href="tel:+12495033301"
                className="mt-4 flex flex-col items-start gap-1 rounded-[12px] border border-[#5aa9ff] bg-[#0d3764] px-4 py-3 text-white sm:hidden"
              >
                <span className="text-[0.72rem] font-black uppercase tracking-[0.1em]">Call the Live Demo</span>
                <strong className="text-[1.15rem] font-black text-[#8bdcff]">(249) 503-3301</strong>
              </a>
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
            <div>
              <p>Built in Ontario for busy trades across Hamilton, Grimsby, and the surrounding area. Made and loved in Canada.</p>
              <p className="mt-1 max-w-2xl text-sm font-medium text-[#64748b]">Optional Google and Microsoft calendar access is used only to check availability and manage appointments authorized by the business owner or staff member.</p>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <a href="#/trades" className="transition hover:text-[#2563eb]">
                Trade pages
              </a>
              <a href="mailto:hello@myaipa.com" className="transition hover:text-[#2563eb]">
                hello@myaipa.com
              </a>
              <a href="/privacy.html" className="transition hover:text-[#2563eb]">
                Privacy
              </a>
              <a href="/terms.html" className="transition hover:text-[#2563eb]">
                Terms
              </a>
              <a href="/calendar-data.html" className="transition hover:text-[#2563eb]">
                Calendar data
              </a>
            </div>
          </footer>
        </div>
      </section>
    </main>
  );
}

export default LandingPage;
