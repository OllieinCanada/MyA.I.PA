import React, { useEffect, useMemo, useRef, useState } from "react";

const DEFAULT_SIGNUP_WEBHOOK_URL = "https://hook.us2.make.com/bg30xcgcluakdcf3u2jtw1h9186gbq7m";
const RAW_API_BASE = process.env.REACT_APP_API_BASE_URL || DEFAULT_SIGNUP_WEBHOOK_URL;
const MAKE_SIGNUP_WEBHOOK_URL = process.env.REACT_APP_MAKE_SIGNUP_WEBHOOK_URL || "";
const MAKE_SIGNUP_WEBHOOK_API_KEY = process.env.REACT_APP_MAKE_SIGNUP_WEBHOOK_API_KEY || "";
const TURNSTILE_SITE_KEY = process.env.REACT_APP_TURNSTILE_SITE_KEY || "";
const SIGNUP_API_PATH = "/api/integrations/signup-complete";
const IS_MAKE_WEBHOOK = /^https:\/\/hook\.[^/]+\.make\.com\//.test(RAW_API_BASE);

const API_BASE =
  RAW_API_BASE ||
  (typeof window !== "undefined" && (window.location.protocol === "file:" || /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname))
    ? "http://localhost:8787"
    : "");
const SIGNUP_SUBMIT_URL = MAKE_SIGNUP_WEBHOOK_URL
  ? MAKE_SIGNUP_WEBHOOK_URL.replace(/\/+$/, "")
  : IS_MAKE_WEBHOOK
    ? RAW_API_BASE.replace(/\/+$/, "")
    : API_BASE
      ? `${API_BASE.replace(/\/+$/, "")}${SIGNUP_API_PATH}`
      : "";

const TRADE_OPTIONS = [
  {
    id: "electrician",
    label: "Electrician",
    businessType: "Electrical",
    accent: "from-blue-600 to-violet-500",
    icon: "bolt",
    services: "Panel upgrades\nBreaker issues\nLighting installs\nEV charger installs\nEmergency electrical service",
    faq: "Do you offer emergency electrical service?\nDo you handle panel upgrades?\nCan you install EV chargers?\nDo you provide estimates?",
    greeting: "Hi, thanks for calling {business}. How can I help you today?",
  },
  {
    id: "plumber",
    label: "Plumber",
    businessType: "Plumbing",
    accent: "from-sky-500 to-blue-600",
    icon: "drop",
    services: "Drain cleaning\nLeak repair\nWater heaters\nSump pumps\nEmergency plumbing",
    faq: "Do you offer emergency plumbing?\nDo you provide estimates?\nWhat areas do you serve?\nCan you help with water heaters?",
    greeting: "Hi, thanks for calling {business}. How can I help with your plumbing today?",
  },
  {
    id: "hvac",
    label: "HVAC",
    businessType: "HVAC",
    accent: "from-cyan-500 to-indigo-500",
    icon: "snow",
    services: "Furnace repair\nAir conditioning repair\nMaintenance calls\nThermostats\nEmergency no-heat calls",
    faq: "Do you offer emergency HVAC service?\nDo you service furnaces and AC units?\nDo you provide maintenance?\nWhat brands do you work on?",
    greeting: "Hi, thanks for calling {business}. Are you calling about heating, cooling, or maintenance?",
  },
  {
    id: "contractor",
    label: "Contractor",
    businessType: "Contractor",
    accent: "from-slate-700 to-blue-600",
    icon: "hammer",
    services: "Renovation calls\nEstimate requests\nProject questions\nSite visits\nCustomer follow-up",
    faq: "Do you provide estimates?\nWhat areas do you serve?\nCan you handle small jobs?\nWhen can someone call me back?",
    greeting: "Hi, thanks for calling {business}. What kind of project can we help with?",
  },
  {
    id: "roofer",
    label: "Roofer",
    businessType: "Roofing",
    accent: "from-indigo-500 to-slate-700",
    icon: "home",
    services: "Roof repair\nLeak repair\nShingle replacement\nStorm damage\nRoof inspections",
    faq: "Do you repair roof leaks?\nDo you provide inspections?\nCan you help after storm damage?\nDo you offer estimates?",
    greeting: "Hi, thanks for calling {business}. Are you calling about a roof repair, leak, or estimate?",
  },
  {
    id: "painter",
    label: "Painter",
    businessType: "Painting",
    accent: "from-purple-500 to-blue-600",
    icon: "roller",
    services: "Interior painting\nExterior painting\nCabinet painting\nTouch-ups\nEstimate requests",
    faq: "Do you provide painting estimates?\nDo you handle interior and exterior work?\nWhat areas do you serve?\nWhen can someone call me back?",
    greeting: "Hi, thanks for calling {business}. Are you looking for interior, exterior, or cabinet painting?",
  },
];

const AREA_OPTIONS = [
  "Niagara Falls",
  "Welland",
  "St. Catharines",
  "Thorold",
  "Port Colborne",
  "Fort Erie",
  "Grimsby",
  "Hamilton",
  "Burlington",
  "Oakville",
  "Milton",
  "Mississauga",
  "Brampton",
  "Toronto",
  "Vaughan",
  "Markham",
  "Richmond Hill",
  "Pickering",
  "Ajax",
  "Whitby",
  "Oshawa",
  "Kitchener",
  "Waterloo",
  "Cambridge",
  "Guelph",
  "Brantford",
  "London",
  "Barrie",
];
const SETUP_STEPS = [
  { number: 1, label: "Your business" },
  { number: 2, label: "Specializations" },
  { number: 3, label: "Hear voice" },
  { number: 4, label: "Review & launch" },
];
const ASSISTANT_SAMPLE_AUDIO_SRC = `${process.env.PUBLIC_URL || ""}/Assistant_Testing.wav`;
const ASSISTANT_AGENT = {
  value: "elliot",
  label: "My AI PA Agent",
  sampleSrc: ASSISTANT_SAMPLE_AUDIO_SRC,
};
const SPECIALIZATION_OPTIONS = [
  { id: "residential", label: "Residential", icon: "home" },
  { id: "commercial", label: "Commercial", icon: "building" },
  { id: "industrial", label: "Industrial", icon: "factory" },
  { id: "agricultural", label: "Agricultural", icon: "leaf" },
  { id: "specialty", label: "Specialty", icon: "star" },
];
const OPENING_DIALOGUE_OPTIONS = [
  {
    id: "help-today",
    text: "Hi, thanks for calling. How can I help you today?",
  },
  {
    id: "res-commercial",
    text: "Hello, and thanks for calling. We proudly serve both residential and commercial customers.",
  },
  {
    id: "community",
    text: "Good day, and thanks for calling. We've been helping the community for over 10 years.",
  },
  {
    id: "welcome",
    text: "Welcome, and thanks for calling. Please let me know what you need.",
  },
];

const SIGNUP_ATTEMPT_STORAGE_KEY = "myaipa_signup_attempts_v1";
const SIGNUP_ATTEMPT_WINDOW_MS = 60 * 60 * 1000;
const SIGNUP_ATTEMPT_LIMIT = 3;

function getBrowserSignupAttempts() {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SIGNUP_ATTEMPT_STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (_err) {
    return [];
  }
}

function rememberBrowserSignupAttempt() {
  if (typeof window === "undefined") return;
  const now = Date.now();
  const attempts = getBrowserSignupAttempts().filter((timestamp) => now - Number(timestamp) < SIGNUP_ATTEMPT_WINDOW_MS);
  attempts.push(now);
  window.localStorage.setItem(SIGNUP_ATTEMPT_STORAGE_KEY, JSON.stringify(attempts));
}

function hasTooManyBrowserSignupAttempts() {
  const now = Date.now();
  return getBrowserSignupAttempts().filter((timestamp) => now - Number(timestamp) < SIGNUP_ATTEMPT_WINDOW_MS).length >= SIGNUP_ATTEMPT_LIMIT;
}

function isValidEmailAddress(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

async function parseApiResponse(response, fallbackLabel) {
  const rawText = await response.text();
  let data = {};
  try {
    data = rawText ? JSON.parse(rawText) : {};
  } catch (_err) {
    data = rawText ? { message: rawText } : {};
  }

  if (!response.ok) {
    throw new Error(data?.error || `${fallbackLabel} (${response.status})`);
  }

  return { ok: true, ...data };
}

function getSignupSuccess(data) {
  if (data?.success === false || data?.ok === false) return false;
  return data?.success === true || data?.ok === true;
}

function parseMaybeJson(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch (_err) {
    return value;
  }
}

function extractPhoneFromText(value) {
  const match = String(value || "").match(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/);
  return match?.[0]?.trim() || "";
}

function getTwilioPhoneNumber(data) {
  const phoneKeys = new Set([
    "twiliophonenumber",
    "twilio_phone_number",
    "phonenumber",
    "assignedphonenumber",
    "assigned_number",
    "number",
  ]);
  const seen = new Set();

  const visit = (value, key = "") => {
    const parsed = parseMaybeJson(value);
    if (parsed && typeof parsed === "object") {
      if (seen.has(parsed)) return "";
      seen.add(parsed);

      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          const found = visit(item, key);
          if (found) return found;
        }
        return "";
      }

      for (const [entryKey, entryValue] of Object.entries(parsed)) {
        const normalizedKey = entryKey.toLowerCase().replace(/[^a-z0-9_]/g, "");
        if (phoneKeys.has(normalizedKey)) {
          const directPhone = extractPhoneFromText(entryValue);
          if (directPhone) return directPhone;
        }

        const found = visit(entryValue, entryKey);
        if (found) return found;
      }
      return "";
    }

    const normalizedKey = String(key || "").toLowerCase().replace(/[^a-z0-9_]/g, "");
    return phoneKeys.has(normalizedKey) ? extractPhoneFromText(parsed) : "";
  };

  return visit(data) || extractPhoneFromText(JSON.stringify(data || {}));
}

function formatPhoneNumber(value) {
  const raw = String(value || "").trim();
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return raw;
}

function Icon({ name, className = "h-6 w-6" }) {
  if (name === "bolt") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="currentColor">
        <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" />
      </svg>
    );
  }
  if (name === "drop") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="currentColor">
        <path d="M12 2S5 10.1 5 15a7 7 0 0 0 14 0c0-4.9-7-13-7-13Z" />
      </svg>
    );
  }
  if (name === "snow") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 2v20M4.9 4.9l14.2 14.2M2 12h20M4.9 19.1 19.1 4.9" />
      </svg>
    );
  }
  if (name === "hammer") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
        <path d="m14 5 5 5-3 3-5-5 3-3Z" />
        <path d="M11 8 4 15l5 5 7-7" />
        <path d="M16 3l5 5" />
      </svg>
    );
  }
  if (name === "home") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 12 12 4l9 8" />
        <path d="M6 11v9h12v-9" />
      </svg>
    );
  }
  if (name === "building") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="5" y="3" width="14" height="18" rx="1.5" />
        <path d="M9 7h1M14 7h1M9 11h1M14 11h1M9 15h1M14 15h1" />
      </svg>
    );
  }
  if (name === "factory") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M4 21V9l5 4V9l5 4V6h5v15H4Z" />
        <path d="M8 17h1M12 17h1M16 17h1" />
      </svg>
    );
  }
  if (name === "leaf") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M5 19c9 0 14-5 14-14-9 0-14 5-14 14Z" />
        <path d="M5 19c3-6 7-9 14-14" />
      </svg>
    );
  }
  if (name === "star") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
        <path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1L12 16.9 6.6 19.8l1-6.1-4.4-4.3 6.1-.9L12 3Z" />
      </svg>
    );
  }
  if (name === "roller") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="4" y="4" width="12" height="5" rx="1.5" />
        <path d="M16 6h2a2 2 0 0 1 2 2v3H9v3" />
        <path d="M7 14h4v6H7z" />
      </svg>
    );
  }
  if (name === "shield") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 3 20 6v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3Z" />
        <path d="m8.5 12 2.2 2.2 4.8-5" />
      </svg>
    );
  }
  if (name === "chat") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M5 18.5 3.8 22l3.8-1.2A9.5 9.5 0 1 0 5 18.5Z" />
        <path d="M8 12h.01M12 12h.01M16 12h.01" />
      </svg>
    );
  }
  if (name === "bulb") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M9 18h6" />
        <path d="M10 22h4" />
        <path d="M8.2 14.6A6 6 0 1 1 15.8 14.6c-.8.7-1.3 1.5-1.5 2.4H9.7c-.2-.9-.7-1.7-1.5-2.4Z" />
      </svg>
    );
  }
  if (name === "check") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2.5">
        <path d="m5 12 5 5L20 7" />
      </svg>
    );
  }
  if (name === "info") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 10v6" />
        <path d="M12 7h.01" />
      </svg>
    );
  }
  if (name === "card") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M3 10h18" />
        <path d="M7 15h2" />
      </svg>
    );
  }
  if (name === "refresh") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M20 12a8 8 0 1 1-2.34-5.66" />
        <path d="M20 4v6h-6" />
      </svg>
    );
  }
  if (name === "lock") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="5" y="10" width="14" height="10" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      </svg>
    );
  }
  if (name === "user" || name === "person") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21a8 8 0 0 1 16 0" />
      </svg>
    );
  }
  if (name === "briefcase") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="4" y="7" width="16" height="13" rx="2" />
        <path d="M9 7V5h6v2" />
      </svg>
    );
  }
  if (name === "phone") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M22 16.9v2.6a2 2 0 0 1-2.2 2 19.7 19.7 0 0 1-8.6-3 19 19 0 0 1-5.8-5.8 19.7 19.7 0 0 1-3-8.6A2 2 0 0 1 4.5 2h2.6a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.6a2 2 0 0 1-.5 2.1l-1 1a16 16 0 0 0 5.4 5.4l1-1a2 2 0 0 1 2.1-.5c.8.3 1.7.5 2.6.6a2 2 0 0 1 1.7 2Z" />
      </svg>
    );
  }
  if (name === "mail") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="m4 7 8 6 8-6" />
      </svg>
    );
  }
  if (name === "pin") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 21s7-5.5 7-12a7 7 0 1 0-14 0c0 6.5 7 12 7 12Z" />
        <circle cx="12" cy="9" r="2.4" />
      </svg>
    );
  }
  if (name === "arrow") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M5 12h14" />
        <path d="m13 6 6 6-6 6" />
      </svg>
    );
  }
  if (name === "play") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="currentColor">
        <path d="M8 5v14l11-7L8 5Z" />
      </svg>
    );
  }
  if (name === "pause") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="currentColor">
        <path d="M7 5h4v14H7V5Zm6 0h4v14h-4V5Z" />
      </svg>
    );
  }
  if (name === "volume") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M4 9v6h4l5 4V5L8 9H4Z" />
        <path d="M16 9.5a4 4 0 0 1 0 5" />
        <path d="M18.5 7a8 8 0 0 1 0 10" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
      <path d="m12 2 2 7 7 3-7 3-2 7-2-7-7-3 7-3 2-7Z" />
    </svg>
  );
}

function BrandLogo() {
  return (
    <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
      <span className="grid h-11 w-11 shrink-0 place-items-center text-white sm:h-[52px] sm:w-[52px] xl:h-14 xl:w-14">
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
      </span>
      <span className="min-w-0 text-[1.75rem] font-black leading-none tracking-[-0.045em] text-white sm:text-[2.45rem] xl:text-[2.65rem]">
        My <span className="bg-[linear-gradient(90deg,#2563eb,#8fbfff)] bg-clip-text text-transparent">AI PA</span>
      </span>
    </div>
  );
}

function Benefit({ icon, children }) {
  return (
    <div className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600">
      <Icon name={icon} className="h-4 w-4 text-slate-700" />
      {children}
    </div>
  );
}

function Stepper({ currentStep }) {
  return (
    <div className="mx-auto mt-5 flex w-full max-w-full snap-x items-center justify-start gap-2 overflow-x-auto px-1 pb-2 sm:max-w-[590px] sm:justify-center sm:gap-3 sm:overflow-visible sm:px-3 sm:pb-0">
      {SETUP_STEPS.map((step, index) => (
        <React.Fragment key={step.number}>
          <div className="flex shrink-0 snap-center items-center gap-2 sm:gap-3">
            <span
              className={
                "grid h-9 w-9 place-items-center rounded-full text-sm font-bold shadow-sm " +
                (step.number <= currentStep
                  ? "bg-gradient-to-br from-blue-600 to-violet-600 text-white shadow-blue-500/30"
                  : "bg-slate-100 text-slate-600")
              }
            >
              {step.number < currentStep ? <Icon name="check" className="h-4 w-4" /> : step.number}
            </span>
            <span className={(step.number === currentStep ? "text-slate-950" : "text-slate-600") + " hidden text-sm font-semibold leading-tight sm:block"}>
              {step.label}
            </span>
          </div>
          {index < SETUP_STEPS.length - 1 ? <div className="h-px w-8 shrink-0 bg-slate-200 sm:w-24" /> : null}
        </React.Fragment>
      ))}
    </div>
  );
}

function TradeCard({ trade, selected, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "relative grid min-h-[82px] min-w-0 place-items-center rounded-xl border bg-white px-2 py-3 text-center transition sm:min-h-[86px] " +
        (selected
          ? "border-blue-600 shadow-[0_18px_34px_-24px_rgba(37,99,235,0.9),0_0_0_1px_rgba(124,58,237,0.38)_inset]"
          : "border-slate-200 shadow-sm hover:border-blue-300 hover:shadow-md")
      }
    >
      {selected ? (
        <span className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-gradient-to-br from-blue-600 to-violet-600 text-white shadow-lg shadow-blue-500/25">
          <Icon name="shield" className="h-3.5 w-3.5" />
        </span>
      ) : null}
      <span className={selected ? "text-blue-600 drop-shadow-[0_0_12px_rgba(37,99,235,0.22)]" : "text-slate-800"}>
        <Icon name={trade.icon} className="h-7 w-7" />
      </span>
      <span className="text-[0.82rem] font-semibold leading-tight text-slate-950 sm:text-sm">{trade.label}</span>
    </button>
  );
}

function AreaChip({ area, selected, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "min-h-[44px] rounded-xl border px-4 py-2 text-sm font-semibold transition sm:px-5 sm:text-base " +
        (selected
          ? "border-blue-500 bg-white text-blue-600 shadow-[0_10px_26px_-18px_rgba(37,99,235,0.9),0_0_0_1px_rgba(99,102,241,0.16)_inset]"
          : "border-slate-200 bg-white text-slate-700 hover:border-blue-300")
      }
    >
      {area}
    </button>
  );
}

function SpecializationCard({ item, selected, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "relative flex min-h-[104px] min-w-0 flex-col items-center justify-center gap-2 rounded-xl border bg-white px-2.5 py-3 text-center transition sm:min-h-[108px] sm:px-3 sm:py-4 " +
        (selected
          ? "border-blue-600 bg-blue-50/35 shadow-[0_18px_34px_-24px_rgba(37,99,235,0.9),0_0_0_1px_rgba(124,58,237,0.32)_inset]"
          : "border-slate-200 shadow-sm hover:border-blue-300 hover:bg-slate-50/80 hover:shadow-md")
      }
    >
      {selected ? (
        <span className="absolute right-2.5 top-2.5 grid h-6 w-6 place-items-center rounded-full bg-gradient-to-br from-blue-600 to-violet-600 text-white shadow-lg shadow-blue-500/25">
          <Icon name="check" className="h-3.5 w-3.5" />
        </span>
      ) : null}
      <span className={(selected ? "bg-blue-100 text-blue-600" : "bg-slate-100 text-slate-700") + " grid h-11 w-11 place-items-center rounded-xl"}>
        <Icon name={item.icon} className="h-6 w-6" />
      </span>
      <span className="text-sm font-bold leading-tight text-slate-950">{item.label}</span>
    </button>
  );
}

function LabeledInput({ label, icon, value, onChange, placeholder, type = "text", className = "" }) {
  return (
    <label className={className}>
      <span className="mb-1.5 block text-sm font-semibold leading-none text-slate-700">{label}</span>
      <span className="flex min-h-[48px] items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 shadow-[0_1px_0_rgba(15,23,42,0.02)] transition focus-within:border-blue-500 focus-within:ring-4 focus-within:ring-blue-500/10">
        <Icon name={icon} className="h-4 w-4 shrink-0 text-slate-600" />
        <input
          type={type}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent text-base font-medium text-slate-950 outline-none placeholder:text-slate-400"
        />
      </span>
    </label>
  );
}

function SpecializationPreview({ selectedLabels }) {
  const primary = selectedLabels.length ? selectedLabels.join(" and ").toLowerCase() : "the selected";

  return (
    <aside className="rounded-2xl border border-slate-200 bg-white/92 p-5 shadow-[0_28px_80px_-55px_rgba(15,23,42,0.45)]">
      <div className="text-lg font-black text-slate-950">How your AI will use this</div>
      <p className="mt-2 text-sm font-medium leading-6 text-slate-500">Your AI uses this info to answer caller questions with confidence.</p>

      <div className="mt-5 flex items-center justify-center gap-3 text-blue-500">
        <WaveBars side="left" />
        <button
          type="button"
          aria-label="Preview specialization response"
          className="grid h-14 w-14 place-items-center rounded-full border border-indigo-100 bg-white text-blue-600 shadow-[0_18px_50px_-24px_rgba(37,99,235,0.85),inset_0_0_0_1px_rgba(99,102,241,0.08)]"
        >
          <Icon name="play" className="ml-1 h-7 w-7" />
        </button>
        <WaveBars side="right" />
      </div>

      <div className="mt-5 space-y-3 text-sm font-medium leading-6">
        <div className="rounded-xl border border-blue-100 bg-blue-50/80 p-4 text-slate-800">
          <span className="font-black text-blue-600">Caller:</span> Do you handle commercial jobs?
        </div>
        <div className="rounded-xl border border-blue-100 bg-blue-50/80 p-4 text-slate-800">
          <span className="font-black text-blue-600">AI:</span> Yes, we handle {primary} work. How can I help you today?
        </div>
      </div>

      <div className="mt-5 flex gap-3 text-xs font-semibold leading-5 text-slate-500">
        <Icon name="spark" className="h-5 w-5 shrink-0 text-blue-500" />
        <span>Based on your selected specializations.</span>
      </div>
    </aside>
  );
}

function OpeningDialoguePanel({ selectedDialogueId, onSelectDialogue, notes, onNotesChange }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white/96 shadow-[0_34px_90px_-70px_rgba(15,23,42,0.8)]">
      <div className="p-4 sm:p-6">
        <div className="flex items-start gap-4">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-blue-100 text-blue-600 shadow-[0_18px_34px_-24px_rgba(37,99,235,0.9)]">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-blue-600 text-white">
              <Icon name="chat" className="h-5 w-5" />
            </span>
          </span>
          <div>
            <h2 className="text-[1.45rem] font-black leading-tight tracking-[-0.03em] text-slate-950 sm:text-[26px]">2. Anything you would like to add?</h2>
            <p className="mt-1.5 text-base font-medium leading-6 text-blue-700/75">Add any extra details that will help your AI assistant.</p>
          </div>
        </div>

        <div className="mt-7">
          <div className="text-base font-black text-slate-950">Helpful opening dialogue examples</div>
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {OPENING_DIALOGUE_OPTIONS.map((dialogue) => {
              const selected = selectedDialogueId === dialogue.id;
              return (
                <button
                  key={dialogue.id}
                  type="button"
                  onClick={() => onSelectDialogue(dialogue.id)}
                  className={
                    "min-h-[126px] rounded-2xl border p-4 text-left transition " +
                    (selected
                      ? "border-blue-500 bg-blue-50/60 shadow-[0_18px_34px_-24px_rgba(37,99,235,0.9),0_0_0_1px_rgba(124,58,237,0.18)_inset]"
                      : "border-slate-200 bg-slate-50/70 hover:border-blue-300 hover:bg-blue-50/35 hover:shadow-md")
                  }
                >
                  <div className="flex h-full gap-3">
                    <span className={(selected ? "bg-blue-600 text-white" : "bg-blue-100 text-blue-600") + " mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full"}>
                      <Icon name="chat" className="h-4 w-4" />
                    </span>
                    <span className="text-base font-semibold leading-7 text-slate-900">{dialogue.text}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <label className="mt-7 block">
          <span className="text-base font-black text-slate-950">Extra notes</span>
          <textarea
            value={notes}
            onChange={onNotesChange}
            placeholder="Write anything else your AI should know or say..."
            rows={4}
            className="mt-3 w-full resize-none rounded-xl border border-blue-200 bg-white px-4 py-3 text-base font-medium leading-7 text-slate-950 outline-none transition placeholder:text-blue-700/45 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
          />
        </label>

        <div className="mt-4 flex items-start gap-3 text-sm font-medium leading-6 text-blue-700/75">
          <Icon name="bulb" className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" />
          <span>Example: Add any extra details or preferences you want the AI to remember.</span>
        </div>
      </div>

      <div className="border-t border-slate-200 bg-slate-50/50 px-4 py-4 sm:px-6">
        <div className="flex items-center gap-3 text-sm font-medium text-blue-700/75">
          <Icon name="info" className="h-5 w-5 shrink-0 text-blue-600" />
          <span>You can update this later anytime in your settings.</span>
        </div>
      </div>
    </section>
  );
}

function WaveBars({ side }) {
  const bars = side === "left" ? [16, 26, 35, 48, 34, 22, 40, 56, 30] : [28, 50, 35, 22, 44, 58, 32, 20, 36];
  return (
    <div className="flex h-14 items-center gap-1">
      {bars.map((height, index) => (
        <span
          key={`${side}-${index}`}
          className="w-0.5 rounded-full bg-gradient-to-b from-blue-500 to-violet-500"
          style={{ height }}
        />
      ))}
    </div>
  );
}

function VoiceVisualizer({ active }) {
  const bars = [22, 36, 52, 31, 64, 44, 72, 38, 58, 26, 48, 68, 34, 54, 28, 46, 62, 32, 50, 24];
  return (
    <div className="relative overflow-hidden rounded-2xl border border-blue-100 bg-white/90 px-4 py-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
      <style>
        {`
          @keyframes assistantVoiceBar {
            0%, 100% { transform: scaleY(0.38); opacity: 0.58; }
            45% { transform: scaleY(1); opacity: 1; }
          }
          @keyframes assistantVoiceGlow {
            0%, 100% { transform: translateX(-18%); opacity: 0.2; }
            50% { transform: translateX(18%); opacity: 0.42; }
          }
        `}
      </style>
      <div
        className={`pointer-events-none absolute inset-y-0 left-0 w-2/3 bg-gradient-to-r from-transparent via-blue-200/70 to-transparent blur-xl ${
          active ? "" : "opacity-0"
        }`}
        style={active ? { animation: "assistantVoiceGlow 2.6s ease-in-out infinite" } : undefined}
      />
      <div className="relative flex h-24 items-center justify-center gap-1.5">
        {bars.map((height, index) => (
          <span
            key={`voice-bar-${index}`}
            className={`w-1.5 origin-center rounded-full bg-gradient-to-b from-blue-500 via-indigo-500 to-violet-500 shadow-[0_8px_20px_-12px_rgba(37,99,235,0.95)] ${
              active ? "" : "opacity-45"
            }`}
            style={{
              height,
              transform: active ? undefined : "scaleY(0.45)",
              animation: active ? `assistantVoiceBar ${760 + (index % 5) * 90}ms ease-in-out infinite` : undefined,
              animationDelay: `${index * 52}ms`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

function VoiceDemoStep({ agent }) {
  const audioRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioTime, setAudioTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const progress = audioDuration ? Math.min(100, Math.max(0, (audioTime / audioDuration) * 100)) : 0;

  const togglePlayback = () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (audio.paused) {
      audio.play().catch(() => setIsPlaying(false));
    } else {
      audio.pause();
    }
  };

  return (
    <section className="mt-5 grid gap-6">
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white/96 shadow-[0_34px_90px_-70px_rgba(15,23,42,0.8)]">
        <div className="p-4 sm:p-6">
          <div className="flex items-start gap-4">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-blue-100 text-blue-600 shadow-[0_18px_34px_-24px_rgba(37,99,235,0.9)]">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-blue-600 text-white">
                <Icon name="volume" className="h-5 w-5" />
              </span>
            </span>
            <div>
              <h2 className="text-[1.45rem] font-black leading-tight tracking-[-0.03em] text-slate-950 sm:text-[26px]">3. Hear your agent's voice</h2>
              <p className="mt-1.5 text-base font-medium leading-6 text-blue-700/75">Preview the assistant voice before launch.</p>
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-blue-100 bg-blue-50/70 p-4 sm:p-5">
            <div className="text-xs font-black uppercase tracking-[0.16em] text-blue-600/70">Assistant voice sample</div>
            <div className="mt-2 text-xl font-black text-slate-950">{agent.label}</div>
            <div className="mt-5 grid gap-4 lg:grid-cols-[auto_1fr] lg:items-center">
              <button
                type="button"
                onClick={togglePlayback}
                className="group grid h-20 w-20 place-items-center rounded-2xl bg-gradient-to-br from-blue-600 to-violet-600 text-white shadow-[0_22px_45px_-24px_rgba(37,99,235,0.95)] transition hover:-translate-y-0.5 hover:shadow-[0_30px_54px_-24px_rgba(37,99,235,1)] focus:outline-none focus:ring-4 focus:ring-blue-200"
                aria-label={isPlaying ? "Pause voice sample" : "Play voice sample"}
              >
                <Icon name={isPlaying ? "pause" : "play"} className={`h-8 w-8 ${isPlaying ? "" : "ml-1"}`} />
              </button>
              <VoiceVisualizer active={isPlaying} />
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-white shadow-[inset_0_1px_2px_rgba(15,23,42,0.1)]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-blue-600 to-violet-600 transition-[width] duration-200"
                style={{ width: `${progress}%` }}
              />
            </div>
            <audio
              ref={audioRef}
              preload="metadata"
              src={agent.sampleSrc}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onEnded={() => {
                setIsPlaying(false);
                setAudioTime(0);
              }}
              onTimeUpdate={(event) => setAudioTime(event.currentTarget.currentTime || 0)}
              onLoadedMetadata={(event) => setAudioDuration(event.currentTarget.duration || 0)}
            >
              Your browser does not support audio playback.
            </audio>
          </div>
        </div>

        <div className="border-t border-slate-200 bg-slate-50/50 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3 text-sm font-medium text-blue-700/75">
            <Icon name="info" className="h-5 w-5 shrink-0 text-blue-600" />
            <span>This live assistant's voice is subject to change due to how cellular voice is transferred in your area.</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function ReviewPanel({ trade, areas, specializations, voice, details }) {
  const reviewItems = [
    ["Trade", trade.label],
    ["Service area", areas.join(", ")],
    ["Specializations", specializations.join(", ")],
    ["Assistant voice", voice.label],
    ["Business", details.businessName || "Not added yet"],
    ["Owner", details.ownerName || "Not added yet"],
  ];

  return (
    <div className="rounded-2xl border border-slate-200 bg-white/96 p-4 shadow-[0_34px_90px_-70px_rgba(15,23,42,0.8)] sm:p-6">
      <h2 className="text-xl font-black tracking-[-0.02em] text-slate-950">Review your setup</h2>
      <p className="mt-1 text-sm font-medium text-slate-500">Confirm the basics before we send the setup brief.</p>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {reviewItems.map(([label, value]) => (
          <div key={label} className="rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3">
            <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">{label}</div>
            <div className="mt-1 text-sm font-bold text-slate-950">{value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TrialButton({ disabled, busy, finalStep = false, label = "Start free trial" }) {
  const isBlocked = !finalStep && disabled;

  return (
    <button
      type="submit"
      disabled={isBlocked || busy}
      className={
        "mx-auto mt-5 flex h-14 w-full max-w-[500px] items-center justify-center gap-3 rounded-xl text-base font-black text-white transition sm:gap-4 sm:text-xl " +
        (isBlocked
          ? "cursor-not-allowed bg-slate-300"
          : "bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 shadow-[0_26px_65px_-34px_rgba(79,70,229,0.95)] hover:-translate-y-0.5 hover:brightness-110 disabled:cursor-wait disabled:hover:translate-y-0 disabled:hover:brightness-100")
      }
    >
      {busy ? "Sending setup..." : label}
      <Icon name="arrow" className="h-6 w-6" />
    </button>
  );
}

function TurnstileCheck({ siteKey, onVerify }) {
  const containerRef = useRef(null);
  const widgetIdRef = useRef(null);

  useEffect(() => {
    if (!siteKey || typeof window === "undefined") return undefined;

    let cancelled = false;
    let pollTimer = null;

    const renderWidget = () => {
      if (cancelled || !containerRef.current || !window.turnstile || widgetIdRef.current != null) return;
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        callback: (token) => onVerify(token || ""),
        "expired-callback": () => onVerify(""),
        "error-callback": () => onVerify(""),
      });
    };

    if (!document.querySelector('script[src="https://challenges.cloudflare.com/turnstile/v0/api.js"]')) {
      const script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
      script.async = true;
      script.defer = true;
      script.onload = renderWidget;
      document.body.appendChild(script);
    }

    pollTimer = window.setInterval(renderWidget, 250);
    renderWidget();

    return () => {
      cancelled = true;
      if (pollTimer) window.clearInterval(pollTimer);
      if (window.turnstile && widgetIdRef.current != null) {
        window.turnstile.remove(widgetIdRef.current);
      }
      widgetIdRef.current = null;
    };
  }, [siteKey, onVerify]);

  if (!siteKey) return null;

  return (
    <div className="mt-5 flex justify-center">
      <div ref={containerRef} />
    </div>
  );
}

function SignupSuccessPage({ result, onStartAnother }) {
  const businessName = result?.businessName || "your business";
  const assignedNumber = result?.twilioPhoneNumber || "";
  const numberMissing = !assignedNumber;
  const [progress, setProgress] = useState(12);
  const [showNumber, setShowNumber] = useState(false);

  useEffect(() => {
    if (numberMissing) {
      setProgress(100);
      return undefined;
    }

    const progressTimer = window.setInterval(() => {
      setProgress((value) => Math.min(100, value + 11));
    }, 420);
    const revealTimer = window.setTimeout(() => {
      setProgress(100);
      setShowNumber(true);
    }, 4200);

    return () => {
      window.clearInterval(progressTimer);
      window.clearTimeout(revealTimer);
    };
  }, [numberMissing]);

  return (
    <main className="min-h-screen bg-[linear-gradient(135deg,#f8fbff_0%,#ffffff_45%,#edf4ff_100%)] text-slate-950">
      <header className="min-h-16 bg-[#020918] shadow-[0_24px_60px_-48px_rgba(15,23,42,0.85)]">
        <div className="mx-auto flex min-h-16 max-w-[1440px] items-center px-4 py-3 sm:px-12">
          <BrandLogo />
        </div>
      </header>

      <section className="mx-auto grid min-h-[calc(100vh-64px)] w-full max-w-5xl place-items-center px-4 py-10 sm:px-6">
        <div className="w-full overflow-hidden rounded-[28px] border border-blue-100 bg-white/96 shadow-[0_34px_100px_-70px_rgba(15,23,42,0.86)]">
          <div className="bg-[radial-gradient(circle_at_20%_10%,rgba(96,165,250,0.26),transparent_34%),linear-gradient(135deg,#07142a,#0b3b7a)] px-5 py-7 text-white sm:px-8 sm:py-9">
            <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-[#00b84a] text-white shadow-[0_0_30px_-10px_rgba(0,184,74,1)]">
              <Icon name="check" className="h-8 w-8" />
            </div>
            <h1 className="mt-5 text-[clamp(2rem,9vw,3.75rem)] font-black leading-tight tracking-[-0.05em]">
              Thanks, {businessName}.
            </h1>
            <p className="mt-3 max-w-3xl text-base font-medium leading-7 text-blue-50 sm:text-xl sm:leading-8">
              Your AI phone assistant signup is in motion. We created your handoff and sent the setup details for review.
            </p>
          </div>

          <div className="grid gap-5 p-5 sm:p-8 lg:grid-cols-[1fr_0.9fr]">
            <div className="rounded-2xl border border-blue-100 bg-blue-50/70 p-5 sm:p-6">
              <p className="text-sm font-black uppercase tracking-[0.16em] text-blue-600">Your new My AI PA number</p>
              {showNumber && assignedNumber ? (
                <div className="mt-5">
                  <a
                    href={`tel:${assignedNumber.replace(/[^\d+]/g, "")}`}
                    aria-label={`Call ${formatPhoneNumber(assignedNumber)}`}
                    className="inline-flex max-w-full items-center rounded-xl text-[#07142a] transition hover:text-blue-700 focus:outline-none focus:ring-4 focus:ring-blue-200"
                  >
                    <span className="block max-w-full whitespace-nowrap text-[clamp(1.55rem,7vw,3rem)] font-black leading-none tabular-nums">
                      {formatPhoneNumber(assignedNumber)}
                    </span>
                  </a>
                  <p className="mt-2 text-xs font-bold uppercase text-blue-600/70">Tap or click to call</p>
                </div>
              ) : numberMissing ? (
                <div className="mt-5">
                  <p className="text-[1.28rem] font-black leading-tight tracking-[-0.03em] text-[#07142a]">
                    Setup complete. Number pending.
                  </p>
                  <p className="mt-3 text-sm font-semibold leading-6 text-slate-500">
                    The handoff finished, but the response did not include a readable forwarding number yet.
                  </p>
                </div>
              ) : (
                <div className="mt-5">
                  <p className="text-[1.28rem] font-black leading-tight tracking-[-0.03em] text-[#07142a]">
                    Securing your forwarding number...
                  </p>
                  <div className="mt-4 h-3 overflow-hidden rounded-full bg-white shadow-[inset_0_1px_2px_rgba(15,23,42,0.12)]">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 transition-all duration-500"
                      style={{ width: `${progress}%` }}
                      role="progressbar"
                      aria-valuemin="0"
                      aria-valuemax="100"
                      aria-valuenow={progress}
                    />
                  </div>
                  <p className="mt-3 text-sm font-semibold text-slate-500">
                    {assignedNumber ? "Final check in progress. Your number will appear here shortly." : "Waiting for the phone number assignment to finish."}
                  </p>
                </div>
              )}
              <p className="mt-3 text-base font-medium leading-7 text-slate-600">
                Use this as the forwarding destination once you are ready to send missed calls to My AI PA.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
              <h2 className="text-xl font-black tracking-[-0.02em] text-slate-950">What happens next</h2>
              <div className="mt-4 space-y-3 text-base font-medium leading-7 text-slate-600">
                <p>We will use your business details, trade, service area, greeting, and selected voice to prepare the assistant.</p>
                <p>Keep your current business number. Forward calls to the new number when you are ready to test it live.</p>
              </div>
            </div>
          </div>

          <div className="border-t border-slate-100 bg-slate-50/70 px-5 py-5 sm:px-8">
            <button
              type="button"
              onClick={onStartAnother}
              className="inline-flex min-h-[48px] w-full items-center justify-center rounded-xl border border-blue-200 bg-white px-5 text-base font-black text-blue-700 transition hover:border-blue-400 hover:bg-blue-50 sm:w-auto"
            >
              Start another signup
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}

export default function Signup() {
  const signupStartedAtRef = useRef(Date.now());
  const [currentStep, setCurrentStep] = useState(1);
  const [selectedTradeId, setSelectedTradeId] = useState("electrician");
  const [selectedAreas, setSelectedAreas] = useState(["Niagara Falls"]);
  const [selectedSpecializationIds, setSelectedSpecializationIds] = useState(["residential", "commercial", "specialty"]);
  const [selectedDialogueId, setSelectedDialogueId] = useState("help-today");
  const [specializationNotes, setSpecializationNotes] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [signupResult, setSignupResult] = useState(null);
  const [botTrap, setBotTrap] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [details, setDetails] = useState({
    ownerName: "",
    businessName: "",
    phone: "",
    email: "",
    address: "",
  });

  const selectedTrade = useMemo(
    () => TRADE_OPTIONS.find((trade) => trade.id === selectedTradeId) || TRADE_OPTIONS[0],
    [selectedTradeId]
  );
  const selectedSpecializationLabels = useMemo(
    () => SPECIALIZATION_OPTIONS.filter((item) => selectedSpecializationIds.includes(item.id)).map((item) => item.label),
    [selectedSpecializationIds]
  );
  const selectedDialogueText = useMemo(
    () => OPENING_DIALOGUE_OPTIONS.find((dialogue) => dialogue.id === selectedDialogueId)?.text || OPENING_DIALOGUE_OPTIONS[0].text,
    [selectedDialogueId]
  );
  const selectedAgent = ASSISTANT_AGENT;

  const businessStepDisabled = !details.ownerName.trim() || !details.businessName.trim() || !details.phone.trim() || !isValidEmailAddress(details.email);
  const specializationStepDisabled = selectedSpecializationIds.length === 0;
  const voiceStepDisabled = false;
  const securityStepDisabled = Boolean(TURNSTILE_SITE_KEY && !turnstileToken);

  const updateDetails = (field) => (event) => {
    setDetails((prev) => ({ ...prev, [field]: event.target.value }));
    setStatus("");
    setError("");
  };

  const toggleArea = (area) => {
    setSelectedAreas((prev) => {
      if (prev.includes(area)) {
        return prev.length === 1 ? prev : prev.filter((item) => item !== area);
      }
      return [...prev, area];
    });
  };

  const toggleSpecialization = (id) => {
    setSelectedSpecializationIds((prev) => {
      if (prev.includes(id)) return prev.length === 1 ? prev : prev.filter((item) => item !== id);
      return [...prev, id];
    });
  };

  const resetSignup = () => {
    setCurrentStep(1);
    setSelectedTradeId("electrician");
    setSelectedAreas(["Niagara Falls"]);
    setSelectedSpecializationIds(["residential", "commercial", "specialty"]);
    setSelectedDialogueId("help-today");
    setSpecializationNotes("");
    setStatus("");
    setError("");
    setBusy(false);
    setSignupResult(null);
    setBotTrap("");
    setTurnstileToken("");
    signupStartedAtRef.current = Date.now();
    setDetails({
      ownerName: "",
      businessName: "",
      phone: "",
      email: "",
      address: "",
    });
    window.scrollTo?.({ top: 0, behavior: "smooth" });
  };

  const submitSignup = async (event) => {
    event.preventDefault();
    if (busy) return;
    if (currentStep === 1) {
      if (businessStepDisabled) return;
      setCurrentStep(2);
      window.scrollTo?.({ top: 0, behavior: "smooth" });
      return;
    }
    if (currentStep === 2) {
      if (specializationStepDisabled) return;
      setCurrentStep(3);
      window.scrollTo?.({ top: 0, behavior: "smooth" });
      return;
    }
    if (currentStep === 3) {
      if (voiceStepDisabled) return;
      setCurrentStep(4);
      window.scrollTo?.({ top: 0, behavior: "smooth" });
      return;
    }
    if (currentStep !== 4) return;

    if (hasTooManyBrowserSignupAttempts()) {
      setError("Too many signup attempts from this browser. Please try again later.");
      return;
    }

    if (botTrap.trim()) {
      setStatus("Signup received.");
      return;
    }

    setBusy(true);
    setError("");
    setStatus("");

    const serviceArea = selectedAreas.join(", ");
    const greeting = selectedDialogueText;
    const formData = {
      country: "ca",
      selectedPlace: null,
      businessProfile: {
        businessName: details.businessName.trim(),
        phone: details.phone.trim(),
        address: details.address.trim(),
        website: "",
        hours: "Monday-Friday 9:00 AM-5:00 PM",
        services: selectedTrade.services,
      },
      setupDetails: {
        ownerName: details.ownerName.trim(),
        ownerEmail: details.email.trim(),
        ownerPhone: details.phone.trim(),
        businessType: selectedTrade.businessType,
        serviceArea,
        callForwardingNumber: details.phone.trim(),
        bookingPreference: "Text owner first",
        notificationPreference: "SMS",
        aiTone: "Professional",
        assistantVoice: selectedAgent.value,
        assistantVoiceLabel: selectedAgent.label,
        voiceSampleUrl: selectedAgent.sampleSrc,
        openingDialogue: selectedDialogueText,
        specializations: selectedSpecializationLabels,
        specializationNotes: specializationNotes.trim(),
        aiGoals: `Answer calls, capture lead details, text the owner, and help callers in ${serviceArea}. The business handles ${selectedSpecializationLabels.join(", ").toLowerCase()} work.${specializationNotes.trim() ? ` Notes: ${specializationNotes.trim()}` : ""}`,
        faq: selectedTrade.faq,
        greetingScript: greeting,
        emergencyAfterHoursAvailable: true,
        emergencyRules: "Escalate urgent safety or service requests to the owner.",
      },
      security: {
        companyWebsite: botTrap,
        clientElapsedMs: Date.now() - signupStartedAtRef.current,
        turnstileToken,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
        pageUrl: typeof window !== "undefined" ? window.location.href : "",
      },
    };

    try {
      if (!SIGNUP_SUBMIT_URL) {
        throw new Error("Signup is not connected yet. Set REACT_APP_API_BASE_URL to your Make webhook URL and rebuild.");
      }

      const response = await fetch(SIGNUP_SUBMIT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(MAKE_SIGNUP_WEBHOOK_API_KEY ? { "x-make-apikey": MAKE_SIGNUP_WEBHOOK_API_KEY } : {}),
        },
        body: JSON.stringify(formData),
      });

      const result = await parseApiResponse(response, "Signup handoff failed");
      if (!getSignupSuccess(result)) {
        throw new Error(result?.error || "Signup handoff failed.");
      }
      rememberBrowserSignupAttempt();
      setSignupResult({
        businessName: details.businessName.trim(),
        twilioPhoneNumber: getTwilioPhoneNumber(result),
      });
      window.scrollTo?.({ top: 0, behavior: "smooth" });
    } catch (submitError) {
      setError(submitError?.message || "Signup handoff failed.");
    } finally {
      setBusy(false);
    }
  };

  if (signupResult) {
    return <SignupSuccessPage result={signupResult} onStartAnother={resetSignup} />;
  }

  return (
    <main className="min-h-screen bg-[linear-gradient(135deg,#f8fbff_0%,#ffffff_45%,#edf4ff_100%)] text-slate-950">
      <header className="min-h-16 bg-[#020918] shadow-[0_24px_60px_-48px_rgba(15,23,42,0.85)]">
        <div className="mx-auto flex min-h-16 max-w-[1440px] items-center px-4 py-3 sm:px-12">
          <BrandLogo />
        </div>
      </header>

      <form onSubmit={submitSignup} className="mx-auto max-w-[1160px] px-3 pb-8 pt-5 sm:px-6 lg:px-8">
        <section className="text-center">
          <h1 className="text-[clamp(1.85rem,8vw,2.75rem)] font-black leading-tight tracking-[-0.04em] text-slate-950">
            Create your AI phone assistant
          </h1>
          <p className="mt-1 text-base font-medium text-slate-600 sm:text-lg">Set up your business assistant in minutes.</p>

          <div className="mt-4 flex flex-wrap justify-center gap-x-10 gap-y-2">
            <Benefit icon="shield">Free for 14 days</Benefit>
            <Benefit icon="card">No credit card required</Benefit>
            <Benefit icon="refresh">Cancel anytime</Benefit>
          </div>

          <Stepper currentStep={currentStep} />
        </section>

        {currentStep === 1 ? (
          <section className="mt-5 grid gap-6">
            <div className="rounded-2xl border border-slate-200 bg-white/96 p-4 shadow-[0_34px_90px_-70px_rgba(15,23,42,0.8)] sm:p-6">
              <section>
                <h2 className="text-xl font-black tracking-[-0.02em] text-slate-950">1. Choose your trade</h2>
                <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 xl:grid-cols-6">
                  {TRADE_OPTIONS.map((trade) => (
                    <TradeCard
                      key={trade.id}
                      trade={trade}
                      selected={trade.id === selectedTradeId}
                      onClick={() => setSelectedTradeId(trade.id)}
                    />
                  ))}
                </div>
              </section>

              <section className="mt-4">
                <h2 className="text-xl font-black tracking-[-0.02em] text-slate-950">2. Service area</h2>
                <p className="mt-0.5 text-sm font-medium text-slate-500">Select the Southern Ontario areas you serve.</p>
                <div className="mt-3 flex flex-wrap gap-2.5 sm:gap-3">
                  {AREA_OPTIONS.map((area) => (
                    <AreaChip key={area} area={area} selected={selectedAreas.includes(area)} onClick={() => toggleArea(area)} />
                  ))}
                </div>
              </section>

              <section className="mt-4">
                <h2 className="text-xl font-black tracking-[-0.02em] text-slate-950">3. Business details</h2>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <LabeledInput
                    label="Business owner's name"
                    icon="user"
                    value={details.ownerName}
                    onChange={updateDetails("ownerName")}
                    placeholder="e.g., Jamie Smith"
                  />
                  <LabeledInput
                    label="Business name"
                    icon="briefcase"
                    value={details.businessName}
                    onChange={updateDetails("businessName")}
                    placeholder={`e.g., ${selectedTrade.label === "Electrician" ? "Smith Electrical Services" : `${selectedTrade.label} Services`}`}
                  />
                  <LabeledInput
                    label="Business phone number"
                    icon="phone"
                    value={details.phone}
                    onChange={updateDetails("phone")}
                    placeholder="(416) 555-1234"
                  />
                  <LabeledInput
                    label="Email address"
                    icon="mail"
                    value={details.email}
                    onChange={updateDetails("email")}
                    placeholder="you@yourbusiness.com"
                    type="email"
                  />
                  <LabeledInput
                    className="sm:col-span-2"
                    label="Business address"
                    icon="pin"
                    value={details.address}
                    onChange={updateDetails("address")}
                    placeholder="123 Main St, Toronto, ON, Canada"
                  />
                </div>
                <p className="mt-1.5 text-xs font-medium text-slate-500">City, province and postal code help us serve your callers better.</p>
              </section>
            </div>
          </section>
        ) : null}

        {currentStep === 2 ? (
          <section className="mt-5 grid gap-6">
            <div className="rounded-2xl border border-slate-200 bg-white/96 p-4 shadow-[0_34px_90px_-70px_rgba(15,23,42,0.8)] sm:p-6">
              <section>
                <h2 className="text-xl font-black tracking-[-0.02em] text-slate-950">1. Areas of specialization</h2>
                <p className="mt-1 text-sm font-medium text-slate-500">Select all that apply.</p>
                <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 xl:grid-cols-5">
                  {SPECIALIZATION_OPTIONS.map((item) => (
                    <SpecializationCard
                      key={item.id}
                      item={item}
                      selected={selectedSpecializationIds.includes(item.id)}
                      onClick={() => toggleSpecialization(item.id)}
                    />
                  ))}
                </div>
                <div className="mt-4 flex items-start gap-2 text-xs font-medium leading-5 text-slate-500">
                  <Icon name="info" className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                  <span>Select the types of work your business provides so the AI can answer accurately.</span>
                </div>
              </section>
            </div>

            <OpeningDialoguePanel
              selectedDialogueId={selectedDialogueId}
              onSelectDialogue={(id) => {
                setSelectedDialogueId(id);
                setStatus("");
                setError("");
              }}
              notes={specializationNotes}
              onNotesChange={(event) => {
                setSpecializationNotes(event.target.value);
                setStatus("");
                setError("");
              }}
            />
          </section>
        ) : null}

        {currentStep === 3 ? (
          <VoiceDemoStep agent={selectedAgent} />
        ) : null}

        {currentStep === 4 ? (
          <section className="mt-5">
            <ReviewPanel
              trade={selectedTrade}
              areas={selectedAreas}
              specializations={selectedSpecializationLabels}
              voice={selectedAgent}
              details={details}
            />
          </section>
        ) : null}

        {currentStep > 1 ? (
          <button
            type="button"
            onClick={() => {
              setCurrentStep((step) => Math.max(1, step - 1));
              window.scrollTo?.({ top: 0, behavior: "smooth" });
            }}
            className="mx-auto mt-5 flex min-h-[44px] items-center justify-center rounded-xl border border-slate-200 bg-white px-5 text-base font-bold text-slate-600 transition hover:border-blue-300 hover:text-blue-600"
          >
            Back
          </button>
        ) : null}

        <TrialButton
          disabled={currentStep === 1 ? businessStepDisabled : currentStep === 2 ? specializationStepDisabled : currentStep === 3 ? voiceStepDisabled : securityStepDisabled}
          busy={busy}
          finalStep={currentStep === 4}
          label={currentStep === 4 ? "Start free trial" : "Save & continue"}
        />

        <label className="sr-only" aria-hidden="true">
          Company website
          <input
            name="companyWebsite"
            type="text"
            tabIndex="-1"
            autoComplete="off"
            value={botTrap}
            onChange={(event) => setBotTrap(event.target.value)}
            className="absolute -left-[10000px] top-auto h-px w-px opacity-0"
          />
        </label>

        {currentStep === 4 ? <TurnstileCheck siteKey={TURNSTILE_SITE_KEY} onVerify={setTurnstileToken} /> : null}

        <div className="mt-3 flex items-center justify-center gap-2 text-center text-sm font-medium text-slate-500 sm:text-base">
          <Icon name="lock" className="h-4 w-4" />
          Your data is secure and will never be shared.
        </div>

        {error ? <p className="mt-4 text-center text-sm font-semibold text-rose-600">{error}</p> : null}
        {status ? <p className="mt-4 text-center text-sm font-semibold text-emerald-600">{status}</p> : null}
      </form>
    </main>
  );
}
