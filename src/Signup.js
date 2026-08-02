import React, { useEffect, useMemo, useRef, useState } from "react";
import Vapi from "@vapi-ai/web";

import {
  AREA_OPTIONS,
  ASSISTANT_AGENT,
  BUSINESS_SLIDE_TABS,
  CANADIAN_PROVINCES,
  CAPTCHA_PROVIDER,
  DEFAULT_DETAILS,
  DEFAULT_PRICING,
  MAKE_SIGNUP_WEBHOOK_API_KEY,
  OPENING_DIALOGUE_OPTIONS,
  SETUP_STEPS,
  SIGNUP_SUBMIT_URL,
  SPECIALIZATION_OPTIONS,
  TRADE_OPTIONS,
  VAPI_PREVIEW_CONFIG_URL,
  VAPI_PREVIEW_SESSION_URL,
} from "./features/signup/signupConfig";
import {
  buildPricingScript,
  buildSignupPayload,
  formatBusinessAddress,
  formatPhoneNumber,
  getSignupSuccess,
  getTwilioPhoneNumber,
  hasTooManyBrowserSignupAttempts,
  parseApiResponse,
  rememberBrowserSignupAttempt,
  validateBusinessDetails,
} from "./features/signup/signupUtils";
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

function getPaymentReturnStatus() {
  if (typeof window === "undefined") return "";
  const hash = window.location.hash || "";
  const hashQuery = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
  const params = new URLSearchParams(hashQuery || window.location.search);
  return String(params.get("payment") || "").toLowerCase();
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
    <div className="signup-macro-stepper mx-auto mt-3 flex w-full max-w-full snap-x items-center justify-start gap-2 overflow-x-auto px-1 pb-1 sm:max-w-[590px] sm:justify-center sm:gap-3 sm:overflow-visible sm:px-3 sm:pb-0">
      {SETUP_STEPS.map((step, index) => (
        <React.Fragment key={step.number}>
          <div className="flex shrink-0 snap-center items-center gap-2 sm:gap-3">
            <span
              className={
                "grid h-8 w-8 place-items-center rounded-full text-sm font-bold shadow-sm " +
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

function MobileSignupProgress({ currentStep, businessSlide, tradeSetupPanel }) {
  const stepNumber = currentStep === 1 ? businessSlide : currentStep === 2 ? 6 : 7;
  const title =
    currentStep === 2
      ? "Try your assistant"
      : currentStep === 3
        ? "Review and start"
        : businessSlide === 1
          ? tradeSetupPanel === "trade" ? "Choose your trade" : "Choose work types"
          : businessSlide === 2
            ? "Choose service areas"
            : businessSlide === 3
              ? "Add business details"
              : businessSlide === 4
                ? "Set your pricing"
                : "Review your setup";

  return (
    <div className="signup-mobile-progress" aria-label={`Step ${stepNumber} of 7: ${title}`}>
      <div className="signup-mobile-progress-copy">
        <span>Step {stepNumber} of 7</span>
        <strong>{title}</strong>
      </div>
      <div className="signup-mobile-progress-track" aria-hidden="true">
        <span style={{ width: `${(stepNumber / 7) * 100}%` }} />
      </div>
    </div>
  );
}

function TradeCard({ trade, selected, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "relative grid min-h-[112px] min-w-0 place-items-center rounded-2xl border bg-white px-3 py-4 text-center transition sm:min-h-[124px] xl:min-h-[138px] " +
        (selected
          ? "border-blue-600 shadow-[0_18px_34px_-24px_rgba(37,99,235,0.9),0_0_0_1px_rgba(124,58,237,0.38)_inset]"
          : "border-slate-200 shadow-sm hover:border-blue-300 hover:shadow-md")
      }
    >
      {selected ? (
        <span className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-blue-600 to-violet-600 text-white shadow-lg shadow-blue-500/25">
          <Icon name="shield" className="h-4 w-4" />
        </span>
      ) : null}
      <span className={selected ? "text-blue-600 drop-shadow-[0_0_12px_rgba(37,99,235,0.22)]" : "text-slate-800"}>
        <Icon name={trade.icon} className="h-9 w-9" />
      </span>
      <span className="text-base font-bold leading-tight text-slate-950 sm:text-lg">{trade.label}</span>
    </button>
  );
}

function AreaChip({ area, selected, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "min-h-[54px] rounded-2xl border px-5 py-3 text-base font-bold transition sm:px-6 sm:text-lg " +
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
        "relative flex min-h-[104px] min-w-0 flex-col items-center justify-center gap-2 rounded-2xl border bg-white px-2.5 py-3 text-center transition sm:min-h-[112px] sm:px-3 sm:py-4 " +
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
      <span className={(selected ? "text-blue-600 drop-shadow-[0_0_12px_rgba(37,99,235,0.22)]" : "text-slate-800") + " grid h-11 w-11 place-items-center rounded-xl"}>
        <Icon name={item.icon} className="h-7 w-7" />
      </span>
      <span className="text-sm font-bold leading-tight text-slate-950 sm:text-base">{item.label}</span>
    </button>
  );
}

function LabeledInput({ label, icon, value, onChange, onBlur, placeholder, type = "text", className = "", error = "", autoComplete, inputMode }) {
  const inputId = `${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-input`;
  const errorId = `${inputId}-error`;

  return (
    <label className={className}>
      <span className="mb-1.5 block text-sm font-semibold leading-none text-slate-700">{label}</span>
      <span
        className={
          "flex min-h-[48px] items-center gap-3 rounded-lg border bg-white px-3 shadow-[0_1px_0_rgba(15,23,42,0.02)] transition focus-within:ring-4 " +
          (error
            ? "border-rose-300 focus-within:border-rose-500 focus-within:ring-rose-500/10"
            : "border-slate-200 focus-within:border-blue-500 focus-within:ring-blue-500/10")
        }
      >
        <Icon name={icon} className="h-4 w-4 shrink-0 text-slate-600" />
        <input
          id={inputId}
          type={type}
          value={value}
          onChange={onChange}
          onBlur={onBlur}
          placeholder={placeholder}
          autoComplete={autoComplete}
          inputMode={inputMode}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
          className="min-w-0 flex-1 bg-transparent text-base font-medium text-slate-950 outline-none placeholder:text-slate-400"
        />
      </span>
      {error ? <span id={errorId} className="mt-1.5 block text-xs font-semibold text-rose-600">{error}</span> : null}
    </label>
  );
}

function LabeledSelect({ label, icon, value, onChange, onBlur, options, className = "", error = "" }) {
  const inputId = `${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-select`;
  const errorId = `${inputId}-error`;

  return (
    <label className={className}>
      <span className="mb-1.5 block text-sm font-semibold leading-none text-slate-700">{label}</span>
      <span
        className={
          "flex min-h-[48px] items-center gap-3 rounded-lg border bg-white px-3 shadow-[0_1px_0_rgba(15,23,42,0.02)] transition focus-within:ring-4 " +
          (error
            ? "border-rose-300 focus-within:border-rose-500 focus-within:ring-rose-500/10"
            : "border-slate-200 focus-within:border-blue-500 focus-within:ring-blue-500/10")
        }
      >
        <Icon name={icon} className="h-4 w-4 shrink-0 text-slate-600" />
        <select
          id={inputId}
          value={value}
          onChange={onChange}
          onBlur={onBlur}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
          className="min-w-0 flex-1 bg-transparent text-base font-medium text-slate-950 outline-none"
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.value} - {option.label}
            </option>
          ))}
        </select>
      </span>
      {error ? <span id={errorId} className="mt-1.5 block text-xs font-semibold text-rose-600">{error}</span> : null}
    </label>
  );
}

function LabeledTextarea({ label, icon, value, onChange, placeholder, className = "" }) {
  const inputId = `${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-textarea`;

  return (
    <label className={className}>
      <span className="mb-1.5 block text-sm font-semibold leading-none text-slate-700">{label}</span>
      <span className="flex min-h-[96px] items-start gap-3 rounded-lg border border-slate-200 bg-white px-3 py-3 shadow-[0_1px_0_rgba(15,23,42,0.02)] transition focus-within:border-blue-500 focus-within:ring-4 focus-within:ring-blue-500/10">
        <Icon name={icon} className="mt-1 h-4 w-4 shrink-0 text-slate-600" />
        <textarea
          id={inputId}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          rows={3}
          className="min-w-0 flex-1 resize-none bg-transparent text-base font-medium leading-6 text-slate-950 outline-none placeholder:text-slate-400"
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

function OpeningDialoguePanel({ notes, onNotesChange }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white/96 shadow-[0_34px_90px_-70px_rgba(15,23,42,0.8)]">
      <div className="p-4 sm:p-6">
        <label className="block">
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

function getVoicePreviewErrorMessage(error) {
  const message = String(error?.message || error?.error || error || "").toLowerCase();
  if (/microphone|permission|notallowed|not allowed|denied/.test(message)) {
    return "Please allow microphone access to start the test call. You can still use the recording below.";
  }
  if (/busy|concurr|limit|quota|429/.test(message)) {
    return "The live preview is busy right now. Use the recording below or try again in a moment.";
  }
  if (/network|connect|offline|timeout/.test(message)) {
    return "The live preview could not connect. Check your internet connection or use the recording below.";
  }
  return "The live preview is unavailable right now. You can continue setup or use the recording below.";
}

export function VoiceDemoStep({ agent, businessName, trade, areas, standalone = false }) {
  const audioRef = useRef(null);
  const vapiRef = useRef(null);
  const previewSessionIdRef = useRef("");
  const callEndTimerRef = useRef(null);
  const callStartedAtRef = useRef(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioTime, setAudioTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [previewConfig, setPreviewConfig] = useState(null);
  const [callState, setCallState] = useState("loading");
  const [callError, setCallError] = useState("");
  const [callElapsed, setCallElapsed] = useState(0);
  const [assistantSpeaking, setAssistantSpeaking] = useState(false);
  const [localVolume, setLocalVolume] = useState(0);
  const [showRecording, setShowRecording] = useState(false);
  const progress = audioDuration ? Math.min(100, Math.max(0, (audioTime / audioDuration) * 100)) : 0;
  const safeBusinessName = String(businessName || "").trim().slice(0, 80) || "your business";
  const tradeLabel = String(trade?.label || "Trade business").trim();
  const primaryArea = Array.isArray(areas) && areas.length ? String(areas[0]) : "Southern Ontario";
  const greeting = standalone
    ? `Hi, thanks for calling ${safeBusinessName}. Do you need an installation, repair, or maintenance today?`
    : `Hi, thanks for calling ${safeBusinessName}. How can I help you today?`;
  const configuredMaxDurationSeconds = Math.max(
    15,
    Math.min(60, Number(previewConfig?.maxDurationSeconds || (standalone ? 60 : 30)) || (standalone ? 60 : 30))
  );
  const maxDurationSeconds = standalone
    ? configuredMaxDurationSeconds
    : Math.min(30, configuredMaxDurationSeconds);
  const callIsActive = callState === "connecting" || callState === "active" || callState === "ending";

  useEffect(() => {
    const controller = new AbortController();
    setCallState("loading");
    fetch(VAPI_PREVIEW_CONFIG_URL, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data?.error || `Preview configuration failed with HTTP ${response.status}.`);
        return data;
      })
      .then((data) => {
        if (!data?.enabled || !data?.assistantId) {
          setPreviewConfig(null);
          setCallState("unavailable");
          setShowRecording(true);
          return;
        }
        setPreviewConfig({
          assistantId: String(data.assistantId),
          maxDurationSeconds: Math.max(15, Math.min(60, Number(data.maxDurationSeconds || 30) || 30)),
        });
        setCallState("ready");
      })
      .catch((error) => {
        if (error?.name === "AbortError") return;
        setPreviewConfig(null);
        setCallState("unavailable");
        setCallError(getVoicePreviewErrorMessage(error));
        setShowRecording(true);
      });

    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (callState !== "active") return undefined;
    const timer = window.setInterval(() => {
      const elapsed = Math.max(0, Math.floor((Date.now() - callStartedAtRef.current) / 1000));
      setCallElapsed(Math.min(maxDurationSeconds, elapsed));
    }, 250);
    return () => window.clearInterval(timer);
  }, [callState, maxDurationSeconds]);

  useEffect(
    () => () => {
      if (callEndTimerRef.current) window.clearTimeout(callEndTimerRef.current);
      const vapi = vapiRef.current;
      vapiRef.current = null;
      if (vapi) {
        vapi.removeAllListeners();
        Promise.resolve(vapi.stop()).catch(() => {});
      }
      const audio = audioRef.current;
      if (audio) audio.pause();
      const previewSessionId = previewSessionIdRef.current;
      previewSessionIdRef.current = "";
      if (previewSessionId) {
        fetch(`${VAPI_PREVIEW_SESSION_URL}/release`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: previewSessionId }),
          keepalive: true,
        }).catch(() => {});
      }
    },
    []
  );

  const releasePreviewSession = () => {
    const previewSessionId = previewSessionIdRef.current;
    previewSessionIdRef.current = "";
    if (!previewSessionId) return;
    fetch(`${VAPI_PREVIEW_SESSION_URL}/release`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: previewSessionId }),
      keepalive: true,
    }).catch(() => {});
  };

  const finishLiveCall = () => {
    if (callEndTimerRef.current) {
      window.clearTimeout(callEndTimerRef.current);
      callEndTimerRef.current = null;
    }
    setAssistantSpeaking(false);
    setLocalVolume(0);
    setCallElapsed(0);
    setCallState(previewConfig ? "ready" : "unavailable");
    releasePreviewSession();
    const vapi = vapiRef.current;
    vapiRef.current = null;
    if (vapi) {
      vapi.removeAllListeners();
      Promise.resolve(vapi.stop()).catch(() => {});
    }
  };

  const startLiveCall = async () => {
    if (!previewConfig || callIsActive) return;
    setCallError("");
    setCallElapsed(0);
    setAssistantSpeaking(false);
    setLocalVolume(0);
    setCallState("connecting");

    try {
      const sessionResponse = await fetch(VAPI_PREVIEW_SESSION_URL, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          businessName: safeBusinessName,
        }),
      });
      const session = await sessionResponse.json().catch(() => ({}));
      if (!sessionResponse.ok || !session?.token || !session?.assistantId || !session?.sessionId) {
        throw new Error(session?.error || `The live preview could not start (HTTP ${sessionResponse.status}).`);
      }
      previewSessionIdRef.current = String(session.sessionId);
      const sessionDurationLimit = Math.max(
        15,
        Math.min(
          60,
          Number(session.maxDurationSeconds || previewConfig.maxDurationSeconds) || (standalone ? 60 : 30)
        )
      );
      const sessionMaxDurationSeconds = standalone
        ? sessionDurationLimit
        : Math.min(30, sessionDurationLimit);
      const vapi = new Vapi(String(session.token));
      vapiRef.current = vapi;
      vapi.on("call-start", () => {
        callStartedAtRef.current = Date.now();
        setCallState("active");
        setCallElapsed(0);
        callEndTimerRef.current = window.setTimeout(() => {
          setCallState("ending");
          vapi.end();
        }, sessionMaxDurationSeconds * 1000);
      });
      vapi.on("call-end", finishLiveCall);
      vapi.on("speech-start", () => setAssistantSpeaking(true));
      vapi.on("speech-end", () => setAssistantSpeaking(false));
      vapi.on("local-volume-level", (volume) => setLocalVolume(Math.max(0, Math.min(1, Number(volume) || 0))));
      vapi.on("error", (error) => {
        setCallError(getVoicePreviewErrorMessage(error));
        setShowRecording(true);
        finishLiveCall();
      });
      vapi.on("call-start-failed", (event) => {
        setCallError(getVoicePreviewErrorMessage(event?.error || event));
        setShowRecording(true);
        finishLiveCall();
      });

      const call = await vapi.start(String(session.assistantId), {
        firstMessage: greeting,
        firstMessageMode: "assistant-speaks-first",
        firstMessageInterruptionsEnabled: true,
        maxDurationSeconds: sessionMaxDurationSeconds,
        backgroundSound: "off",
        variableValues: {
          businessName: safeBusinessName,
          trade: tradeLabel,
          serviceArea: primaryArea,
          previewMode: "true",
        },
      });
      if (!call) {
        throw new Error("The live preview could not start.");
      }
    } catch (error) {
      setCallError(getVoicePreviewErrorMessage(error));
      setShowRecording(true);
      finishLiveCall();
    }
  };

  const stopLiveCall = () => {
    const vapi = vapiRef.current;
    if (!vapi || !callIsActive) return;
    setCallState("ending");
    try {
      vapi.end();
    } catch (_error) {
      finishLiveCall();
    }
  };

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
    <section className="signup-voice-step mt-5 grid gap-6">
      <div className="signup-voice-shell overflow-hidden rounded-3xl border border-slate-200 bg-white/96 shadow-[0_34px_90px_-70px_rgba(15,23,42,0.8)]">
        <div className="signup-voice-desktop-head flex items-center justify-between border-b border-slate-100 bg-slate-50/70 px-5 py-4 sm:px-8">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-blue-600">
            {standalone ? "1-minute live voice demo" : "Live voice preview"}
          </p>
          <p className="text-xs font-black text-slate-400">{standalone ? "Ready to try" : "2 of 3"}</p>
        </div>

        <div className="signup-voice-layout grid gap-6 p-5 sm:p-8 lg:grid-cols-[360px_minmax(0,1fr)] lg:p-10 xl:grid-cols-[390px_minmax(0,1fr)]">
          <div className="signup-voice-intro flex flex-col justify-between rounded-3xl border border-blue-100 bg-blue-50/70 p-5 sm:p-8">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.16em] text-blue-600">
                {standalone ? "Your demo" : "Step 2"}
              </p>
              <h2 className="mt-2 text-[clamp(2rem,3vw,3.1rem)] font-black leading-tight tracking-[-0.04em] text-slate-950">Try your assistant<span className="sm:hidden"> (optional)</span></h2>
              <p className="mt-4 text-lg font-medium leading-8 text-slate-600">
                Have a quick conversation using your microphone before you launch.
              </p>
            </div>
            <div className="signup-voice-business-card mt-7 rounded-2xl border border-blue-100 bg-white/85 p-4">
              <p className="text-xs font-black uppercase tracking-[0.14em] text-blue-600">Set up for</p>
              <p className="mt-2 text-lg font-black text-slate-950">{safeBusinessName}</p>
              <p className="mt-1 text-sm font-bold text-slate-500">{tradeLabel} · {primaryArea}</p>
            </div>
          </div>

          <div className="signup-voice-call-card rounded-3xl border border-blue-100 bg-gradient-to-br from-blue-50/80 to-violet-50/80 p-5 sm:p-7">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-xs font-black uppercase tracking-[0.16em] text-blue-600">Quick browser call</div>
                <div className="mt-2 text-2xl font-black tracking-[-0.03em] text-slate-950">{agent.label}</div>
                <p className="mt-1 text-sm font-semibold leading-6 text-slate-500">
                  {standalone
                    ? "Your assistant will ask whether you need an installation, repair, or maintenance today."
                    : "Ask one short question, just like a customer would."}
                </p>
              </div>
              <span
                className={
                  "inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-black " +
                  (callState === "active"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : callState === "connecting" || callState === "ending"
                      ? "border-blue-200 bg-blue-50 text-blue-700"
                      : callState === "ready"
                        ? "border-emerald-200 bg-white text-emerald-700"
                        : "border-slate-200 bg-white text-slate-500")
                }
              >
                <span
                  className={
                    "h-2 w-2 rounded-full " +
                    (callState === "active" ? "animate-pulse bg-emerald-500" : callState === "ready" ? "bg-emerald-500" : "bg-slate-300")
                  }
                />
                {callState === "loading"
                  ? "Checking availability"
                  : callState === "connecting"
                    ? "Connecting"
                    : callState === "active"
                      ? assistantSpeaking
                        ? "Assistant speaking"
                        : "Listening"
                      : callState === "ending"
                        ? "Ending call"
                        : callState === "ready"
                          ? "Ready to call"
                          : "Recording available"}
              </span>
            </div>

            <div className="mt-6 rounded-2xl border border-white/90 bg-white/90 p-4 shadow-[0_22px_55px_-42px_rgba(15,23,42,0.8)] sm:p-5">
              <div className="signup-voice-call-control grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center">
                <button
                  type="button"
                  onClick={callIsActive ? stopLiveCall : startLiveCall}
                  disabled={callState === "loading" || callState === "unavailable" || callState === "ending"}
                  className={
                    "signup-voice-call-button group grid h-20 w-20 place-items-center rounded-2xl text-white transition focus:outline-none focus:ring-4 " +
                    (callState === "active"
                      ? "bg-rose-600 shadow-[0_22px_45px_-24px_rgba(225,29,72,0.95)] hover:bg-rose-700 focus:ring-rose-200"
                      : callState === "loading" || callState === "unavailable"
                        ? "cursor-not-allowed bg-slate-300"
                        : "bg-gradient-to-br from-blue-600 to-violet-600 shadow-[0_22px_45px_-24px_rgba(37,99,235,0.95)] hover:-translate-y-0.5 hover:shadow-[0_30px_54px_-24px_rgba(37,99,235,1)] focus:ring-blue-200")
                  }
                  aria-label={callIsActive ? "End test call" : "Start test call"}
                >
                  <Icon
                    name="phone"
                    className={`h-8 w-8 ${callState === "active" ? "rotate-[135deg]" : ""}`}
                  />
                  <span className="hidden sm:hidden">
                    {callIsActive ? "End test call" : "Start test call"}
                  </span>
                </button>
                <div className="signup-voice-call-copy">
                  <p className="text-lg font-black text-slate-950">
                    {callState === "active"
                      ? assistantSpeaking
                        ? "Your assistant is speaking"
                        : "Go ahead — say something"
                      : callState === "connecting"
                        ? "Starting your secure browser call…"
                        : callState === "ending"
                          ? "Ending the test call…"
                          : callState === "unavailable"
                            ? "Live test is not configured yet"
                            : standalone
                              ? "Start my 1-minute demo"
                              : "Start a quick test call"}
                  </p>
                  <p className="mt-1 text-sm font-semibold leading-6 text-slate-500">
                    {callState === "active"
                      ? `${callElapsed}s of ${maxDurationSeconds}s · Tap the red phone to end early.`
                      : `Microphone permission required · Ends automatically after ${maxDurationSeconds} seconds.`}
                  </p>
                  <div className="mt-4 flex h-7 items-end gap-1" aria-hidden="true">
                    {Array.from({ length: 22 }).map((_, index) => {
                      const baseHeight = 7 + ((index * 11) % 16);
                      const boost = callState === "active" ? Math.round((assistantSpeaking ? 12 : localVolume * 18) * (0.45 + ((index % 5) / 7))) : 0;
                      return (
                        <span
                          key={`live-bar-${index}`}
                          className={
                            "w-1 rounded-full transition-all duration-150 " +
                            (callState === "active" ? "bg-gradient-to-t from-blue-600 to-violet-500" : "bg-blue-200")
                          }
                          style={{ height: `${Math.min(28, baseHeight + boost)}px` }}
                        />
                      );
                    })}
                  </div>
                </div>
              </div>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-blue-600 to-violet-600 transition-[width] duration-300"
                  style={{ width: `${callState === "active" ? Math.min(100, (callElapsed / maxDurationSeconds) * 100) : 0}%` }}
                />
              </div>
            </div>

            <div className="mt-5 border-l-2 border-violet-500 pl-4">
              <p className="text-[0.68rem] font-black uppercase tracking-[0.16em] text-violet-600">Your personalized greeting</p>
              <p className="mt-2 text-base font-black leading-7 text-slate-950">“{greeting}”</p>
            </div>

            {callError ? (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold leading-6 text-amber-900" role="status">
                {callError}
              </div>
            ) : null}

            <div className="mt-5 border-t border-blue-100 pt-4">
              <button
                type="button"
                onClick={() => {
                  setShowRecording((value) => !value);
                  if (showRecording && audioRef.current) audioRef.current.pause();
                }}
                className="text-sm font-black text-blue-700 underline decoration-blue-200 underline-offset-4 transition hover:text-blue-900"
              >
                {showRecording ? "Hide the backup recording" : "Prefer not to use your microphone? Play the recording"}
              </button>
              {showRecording ? (
                <div className="mt-4 rounded-2xl border border-blue-100 bg-white/90 p-4">
                  <div className="grid gap-4 sm:grid-cols-[auto_1fr] sm:items-center">
                    <button
                      type="button"
                      onClick={togglePlayback}
                      className="group grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-blue-600 to-violet-600 text-white shadow-[0_22px_45px_-24px_rgba(37,99,235,0.95)] transition hover:-translate-y-0.5 focus:outline-none focus:ring-4 focus:ring-blue-200"
                      aria-label={isPlaying ? "Pause backup voice recording" : "Play backup voice recording"}
                    >
                      <Icon name={isPlaying ? "pause" : "play"} className={`h-7 w-7 ${isPlaying ? "" : "ml-1"}`} />
                    </button>
                    <div>
                      <p className="text-sm font-black text-slate-950">Backup voice recording</p>
                      <VoiceVisualizer active={isPlaying} />
                    </div>
                  </div>
                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100 shadow-[inset_0_1px_2px_rgba(15,23,42,0.1)]">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-blue-600 to-violet-600 transition-[width] duration-200"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              ) : null}
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

        <div className="border-t border-slate-200 bg-slate-50/50 px-5 py-4 sm:px-8">
          <div className="flex items-center gap-3 text-sm font-medium text-blue-700/75">
            <Icon name="info" className="h-5 w-5 shrink-0 text-blue-600" />
            <span>
              {standalone
                ? "This 1-minute demo uses your browser microphone and is not recorded. The backup recording works without microphone access."
                : "This optional preview uses your browser microphone. If it is unavailable, you can still continue setup normally."}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

function ReviewPanel({ trade, areas, specializations, voice, details, pricing, onUpdateDetails, onEditBusinessSlide, onEditVoice, getFieldError, onFieldBlur }) {
  const businessAddress = formatBusinessAddress(details);
  const pricingScript = pricing ? buildPricingScript(pricing) : "";
  const optionItems = [
    ["Trade", trade.label, () => onEditBusinessSlide?.(1, "trade")],
    ["Service area", areas.join(", "), () => onEditBusinessSlide?.(2)],
    [
      "Pricing script",
      pricingScript,
      () => onEditBusinessSlide?.(4),
      `${pricing?.installationFreeEstimate !== false ? "Free install estimates · " : ""}$${pricing?.repairVisitFee || "100"} visit · $${pricing?.repairHourlyRate || "100"}/hour`,
    ],
    ["Specializations", specializations.join(", "), () => onEditBusinessSlide?.(1, "specialization")],
    ["Assistant voice", voice.label, onEditVoice],
  ];

  return (
    <div className="rounded-2xl border border-slate-200 bg-white/96 p-4 shadow-[0_34px_90px_-70px_rgba(15,23,42,0.8)] sm:p-6">
      <h2 className="text-xl font-black tracking-[-0.02em] text-slate-950">Review your setup</h2>
      <p className="mt-1 text-sm font-medium text-slate-500">Confirm the basics before we send the setup brief.</p>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {optionItems.map(([label, value, onEdit, mobileValue]) => (
          <div key={label} className="rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">{label}</div>
                <div className="mt-1 text-sm font-bold text-slate-950">
                  <span className="signup-review-value-desktop">{value || "Not added yet"}</span>
                  <span className="signup-review-value-mobile">{mobileValue || value || "Not added yet"}</span>
                </div>
              </div>
              {onEdit ? (
                <button
                  type="button"
                  onClick={onEdit}
                  className="signup-review-edit-link rounded-lg border border-blue-100 bg-white px-3 py-1 text-xs font-black uppercase tracking-[0.08em] text-blue-600 transition hover:border-blue-300 hover:bg-blue-50"
                >
                  Change
                </button>
              ) : null}
            </div>
          </div>
        ))}

        {onUpdateDetails ? (
          <div className="signup-review-edit-fields contents">
            <LabeledInput
              label="Business name"
              icon="briefcase"
              value={details.businessName}
              onChange={onUpdateDetails("businessName")}
              onBlur={onFieldBlur?.("businessName")}
              placeholder="e.g., Smith Electrical Services"
              error={getFieldError?.("businessName") || ""}
            />
            <LabeledInput
              label="Owner"
              icon="user"
              value={details.ownerName}
              onChange={onUpdateDetails("ownerName")}
              onBlur={onFieldBlur?.("ownerName")}
              placeholder="e.g., Jamie Smith"
              error={getFieldError?.("ownerName") || ""}
            />
            <LabeledInput
              label="Phone"
              icon="phone"
              value={details.phone}
              onChange={onUpdateDetails("phone")}
              onBlur={onFieldBlur?.("phone")}
              placeholder="(416) 555-1234"
              error={getFieldError?.("phone") || ""}
            />
            <LabeledInput
              label="Email"
              icon="mail"
              value={details.email}
              onChange={onUpdateDetails("email")}
              onBlur={onFieldBlur?.("email")}
              placeholder="you@yourbusiness.com"
              type="email"
              error={getFieldError?.("email") || ""}
            />
            <LabeledInput
              className="sm:col-span-2"
              label="Street address"
              icon="pin"
              value={details.streetAddress}
              onChange={onUpdateDetails("streetAddress")}
              onBlur={onFieldBlur?.("streetAddress")}
              placeholder="123 Main St"
              error={getFieldError?.("streetAddress") || ""}
            />
            <LabeledInput
              label="City"
              icon="pin"
              value={details.city}
              onChange={onUpdateDetails("city")}
              onBlur={onFieldBlur?.("city")}
              placeholder="Toronto"
              error={getFieldError?.("city") || ""}
            />
            <LabeledSelect
              label="Province"
              icon="pin"
              value={details.province}
              onChange={onUpdateDetails("province")}
              onBlur={onFieldBlur?.("province")}
              options={CANADIAN_PROVINCES}
              error={getFieldError?.("province") || ""}
            />
            <LabeledInput
              label="Postal code"
              icon="pin"
              value={details.postalCode}
              onChange={onUpdateDetails("postalCode")}
              onBlur={onFieldBlur?.("postalCode")}
              placeholder="M5V 2T6"
              error={getFieldError?.("postalCode") || ""}
            />
          </div>
        ) : (
          <>
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3">
              <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">Business</div>
              <div className="mt-1 text-sm font-bold text-slate-950">{details.businessName || "Not added yet"}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3">
              <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">Owner</div>
              <div className="mt-1 text-sm font-bold text-slate-950">{details.ownerName || "Not added yet"}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3">
              <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">Phone</div>
              <div className="mt-1 text-sm font-bold text-slate-950">{details.phone || "Not added yet"}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3">
              <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">Email</div>
              <div className="mt-1 text-sm font-bold text-slate-950">{details.email || "Not added yet"}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3 sm:col-span-2">
              <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">Address</div>
              <div className="mt-1 text-sm font-bold text-slate-950">{businessAddress || "Not added yet"}</div>
            </div>
          </>
        )}
        {onUpdateDetails ? (
          <div className="signup-mobile-review-contact rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">Business and contact</div>
                <div className="mt-1 text-sm font-bold leading-6 text-slate-950">
                  {details.businessName || "Not added yet"}<br />
                  <span className="font-semibold text-slate-600">{details.ownerName} · {details.phone}</span><br />
                  <span className="font-semibold text-slate-600">{details.email}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onEditBusinessSlide?.(3)}
                className="signup-review-edit-link min-h-[44px] rounded-lg border border-blue-100 bg-white px-3 text-xs font-black uppercase tracking-[0.08em] text-blue-600"
              >
                Edit
              </button>
            </div>
            <div className="mt-3 border-t border-slate-200 pt-3 text-sm font-semibold leading-6 text-slate-600">
              {businessAddress || "No business address added"}
            </div>
          </div>
        ) : null}
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
        "mx-auto flex h-16 w-full max-w-[620px] items-center justify-center gap-3 rounded-2xl text-base font-black text-white transition sm:gap-4 sm:text-xl " +
        (isBlocked
          ? "cursor-not-allowed bg-slate-300"
          : "bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 shadow-[0_26px_65px_-34px_rgba(79,70,229,0.95)] hover:-translate-y-0.5 hover:brightness-110 disabled:cursor-wait disabled:hover:translate-y-0 disabled:hover:brightness-100")
      }
    >
      {busy ? "Starting trial..." : label}
      <Icon name="arrow" className="h-6 w-6" />
    </button>
  );
}

function HumanVerificationCheck() {
  return null;
}

function isMakeWebhookUrl(url) {
  return /^https:\/\/hook\.[^/]+\.make\.com\//.test(String(url || ""));
}

async function postSignupPayload(url, formData) {
  const jsonBody = JSON.stringify(formData);
  const makeFormBody = new FormData();
  Object.entries(formData).forEach(([key, value]) => {
    makeFormBody.append(key, typeof value === "string" ? value : JSON.stringify(value));
  });
  makeFormBody.append("payload", jsonBody);

  const optimisticMakeResponse = {
    ok: true,
    status: 202,
    text: async () => JSON.stringify({ ok: true, reviewRequired: true }),
  };
  const postMakeFallback = async () => {
    try {
      await fetch(url, {
        method: "POST",
        mode: "no-cors",
        body: makeFormBody,
      });

      return optimisticMakeResponse;
    } catch {
      if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
        const sent = navigator.sendBeacon(
          url,
          new Blob([jsonBody], { type: "application/json" })
        );
        if (sent) return optimisticMakeResponse;
      }

      throw new Error("Make.com rejected the signup handoff. Check that the webhook is enabled and not requiring an API key.");
    }
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(MAKE_SIGNUP_WEBHOOK_API_KEY ? { "x-make-apikey": MAKE_SIGNUP_WEBHOOK_API_KEY } : {}),
      },
      body: jsonBody,
    });

    if (isMakeWebhookUrl(url) && (response.status === 401 || response.status === 403)) {
      return postMakeFallback();
    }

    return response;
  } catch (error) {
    if (!isMakeWebhookUrl(url)) throw error;
    return postMakeFallback();
  }
}

function SignupSuccessPage({ result, onStartAnother }) {
  const businessName = result?.businessName || "your business";
  const assignedNumber = result?.twilioPhoneNumber || "";
  const reviewRequired = Boolean(result?.reviewRequired);
  const verificationRequired = Boolean(result?.verificationRequired || result?.emailVerificationRequired);
  const numberMissing = !assignedNumber;
  const [progress, setProgress] = useState(12);
  const [showNumber, setShowNumber] = useState(false);
  const [copiedNumber, setCopiedNumber] = useState(false);

  useEffect(() => {
    try {
      if (result?.ownerEmail && result?.ownerPhone) {
        window.sessionStorage?.setItem(
          "myaipa_customer_dashboard_lookup_v1",
          JSON.stringify({ email: result.ownerEmail, phone: result.ownerPhone })
        );
        window.localStorage?.removeItem("myaipa_customer_dashboard_lookup_v1");
      }
    } catch (_err) {
      // Session storage is only a convenience for returning to the dashboard.
    }
  }, [result?.ownerEmail, result?.ownerPhone]);

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

  const copyAssignedNumber = async () => {
    if (!assignedNumber || typeof navigator === "undefined" || !navigator.clipboard) return;
    await navigator.clipboard.writeText(formatPhoneNumber(assignedNumber));
    setCopiedNumber(true);
    window.setTimeout(() => setCopiedNumber(false), 1800);
  };

  const launchSteps = [
    { label: "Signup received", detail: "Business details saved for setup.", done: true },
    {
      label: "Owner verification",
      detail: verificationRequired ? "Waiting for the email verification link." : "No verification block right now.",
      done: !verificationRequired,
      active: verificationRequired,
    },
    {
      label: "AI number",
      detail: assignedNumber && !reviewRequired ? formatPhoneNumber(assignedNumber) : "Pending assignment or review.",
      done: Boolean(assignedNumber && !reviewRequired && !verificationRequired),
      active: !assignedNumber || reviewRequired,
    },
    {
      label: "Free trial active",
      detail: "No credit card is needed to start the trial.",
      done: !reviewRequired && !verificationRequired,
      active: reviewRequired || verificationRequired,
    },
    { label: "Test call", detail: "Call the AI number before forwarding live calls.", done: false },
  ];

  return (
    <main className="min-h-screen bg-[linear-gradient(135deg,#eef6ff_0%,#ffffff_42%,#f3f7ff_100%)] text-slate-950">
      <header className="min-h-16 bg-[#020918] shadow-[0_24px_60px_-48px_rgba(15,23,42,0.85)]">
        <div className="mx-auto flex min-h-16 max-w-[1440px] items-center px-4 py-3 sm:px-12">
          <BrandLogo />
        </div>
      </header>

      <section className="mx-auto grid min-h-[calc(100vh-64px)] w-full max-w-6xl place-items-center px-4 py-8 sm:px-6">
        <div className="w-full overflow-hidden rounded-[28px] border border-blue-100 bg-white/98 shadow-[0_34px_100px_-70px_rgba(15,23,42,0.86)]">
          <div className="bg-[linear-gradient(135deg,#07142a_0%,#0b3b7a_58%,#1357af_100%)] px-5 py-7 text-white sm:px-8 sm:py-10">
            <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-[#00c853] text-white shadow-[0_0_36px_-12px_rgba(0,200,83,1)]">
              <Icon name="check" className="h-8 w-8" />
            </div>
            <p className="mt-5 text-sm font-black uppercase tracking-[0.18em] text-[#9edaff]">
              {verificationRequired ? "Email verification required" : "Setup milestone unlocked"}
            </p>
            <h1 className="mt-2 text-[clamp(2.1rem,8vw,4.6rem)] font-black leading-tight tracking-[-0.055em]">
              Thanks, {businessName}.
            </h1>
            <p className="mt-3 max-w-3xl text-base font-medium leading-7 text-blue-50 sm:text-xl sm:leading-8">
              {verificationRequired
                ? "We sent a verification email. Click the link before your AI phone assistant setup continues."
                : reviewRequired
                ? "Your signup was received, but it needs review before the workflow continues."
                : assignedNumber
                  ? "Your AI phone assistant is ready for testing. Your forwarding number is below."
                  : "Your AI phone assistant signup is in motion. We created your handoff and sent the setup details for review."}
            </p>
          </div>

          <div className="grid gap-5 p-5 sm:p-8 lg:grid-cols-[1.18fr_0.82fr]">
            <div className="rounded-3xl border border-blue-200 bg-[linear-gradient(180deg,#f7fbff,#edf5ff)] p-5 shadow-[0_30px_80px_-60px_rgba(37,99,235,0.9)] sm:p-7">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm font-black uppercase tracking-[0.2em] text-blue-600">Your new My AI PA number</p>
                {assignedNumber && !reviewRequired && !verificationRequired ? (
                  <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-black uppercase tracking-[0.12em] text-emerald-700">
                    Ready
                  </span>
                ) : null}
              </div>
              {verificationRequired ? (
                <div className="mt-5">
                  <p className="text-[1.28rem] font-black leading-tight tracking-[-0.03em] text-[#07142a]">
                    Check your email to continue.
                  </p>
                  <p className="mt-3 text-sm font-semibold leading-6 text-slate-500">
                    We will not create your agent until the owner email is verified. The verification link expires after 24 hours.
                  </p>
                  {result?.devVerificationUrl ? (
                    <a
                      href={result.devVerificationUrl}
                      className="mt-4 inline-flex max-w-full rounded-xl bg-[#07142a] px-5 py-3 text-sm font-black text-white"
                    >
                      Open dev verification link
                    </a>
                  ) : null}
                </div>
              ) : reviewRequired ? (
                <div className="mt-5">
                  <p className="text-[1.28rem] font-black leading-tight tracking-[-0.03em] text-[#07142a]">
                    Signup received for review.
                  </p>
                  <p className="mt-3 text-sm font-semibold leading-6 text-slate-500">
                    The workflow has not been called yet because this submission was flagged for review.
                  </p>
                </div>
              ) : showNumber && assignedNumber ? (
                <div className="mt-5">
                  <a
                    href={`tel:${assignedNumber.replace(/[^\d+]/g, "")}`}
                    aria-label={`Call ${formatPhoneNumber(assignedNumber)}`}
                    className="inline-flex max-w-full items-center rounded-2xl text-[#07142a] transition hover:text-blue-700 focus:outline-none focus:ring-4 focus:ring-blue-200"
                  >
                    <span className="block max-w-full whitespace-nowrap text-[clamp(2.4rem,9vw,5rem)] font-black leading-none tracking-[-0.055em] tabular-nums">
                      {formatPhoneNumber(assignedNumber)}
                    </span>
                  </a>
                  <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                    <a
                      href={`tel:${assignedNumber.replace(/[^\d+]/g, "")}`}
                      className="inline-flex min-h-[52px] items-center justify-center rounded-xl bg-[#07142a] px-5 text-base font-black text-white transition hover:bg-blue-800"
                    >
                      Call the number
                    </a>
                    <button
                      type="button"
                      onClick={copyAssignedNumber}
                      className="inline-flex min-h-[52px] items-center justify-center rounded-xl border border-blue-200 bg-white px-5 text-base font-black text-blue-700 transition hover:border-blue-400 hover:bg-blue-50"
                    >
                      {copiedNumber ? "Copied" : "Copy number"}
                    </button>
                  </div>
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
                This is the forwarding destination for missed calls. Keep your current business number and forward calls here when you are ready to test live.
              </p>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-blue-600">Launch checklist</p>
                  <h2 className="mt-1 text-xl font-black tracking-[-0.02em] text-slate-950">What happens next</h2>
                </div>
                <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-black uppercase tracking-[0.12em] text-blue-700">
                  {launchSteps.filter((step) => step.done).length}/{launchSteps.length}
                </span>
              </div>
              <div className="mt-5 space-y-3">
                {launchSteps.map((step, index) => (
                  <div
                    key={step.label}
                    className={
                      "grid grid-cols-[auto_1fr_auto] gap-3 rounded-2xl border p-4 text-sm leading-6 " +
                      (step.done
                        ? "border-emerald-100 bg-emerald-50/80 text-emerald-950"
                        : step.active
                          ? "border-blue-200 bg-blue-50/90 text-slate-800"
                          : "border-slate-100 bg-slate-50/80 text-slate-600")
                    }
                  >
                    <span className={"mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-black " + (step.done ? "bg-emerald-600 text-white" : step.active ? "bg-blue-600 text-white" : "bg-slate-200 text-slate-600")}>
                      {step.done ? <Icon name="check" className="h-4 w-4" /> : index + 1}
                    </span>
                    <span>
                      <span className="block font-black">{step.label}</span>
                      <span className="mt-0.5 block font-semibold opacity-75">{step.detail}</span>
                    </span>
                    <span className={"self-start rounded-full px-2 py-1 text-[0.62rem] font-black uppercase tracking-[0.1em] " + (step.done ? "bg-emerald-100 text-emerald-700" : step.active ? "bg-blue-100 text-blue-700" : "bg-slate-200 text-slate-500")}>
                      {step.done ? "Done" : step.active ? "Now" : "Next"}
                    </span>
                  </div>
                ))}
              </div>

              {!reviewRequired && !verificationRequired ? (
                <div className="mt-5 rounded-3xl border border-blue-100 bg-[linear-gradient(180deg,#f7fbff,#eef6ff)] p-4">
                  <p className="text-sm font-black uppercase tracking-[0.16em] text-blue-600">Free trial</p>
                  <p className="mt-2 text-base font-semibold leading-7 text-slate-700">
                    Your 14-day trial has started without collecting a credit card. It includes up to 60 AI call minutes, with friendly usage updates along the way. New AI calls pause near the limit so the final five minutes are protected for a call already in progress. Later calls use your fallback routing. Billing can be set up after the trial is approved and ready.
                  </p>
                </div>
              ) : null}
            </div>
          </div>

          <div className="border-t border-slate-100 bg-slate-50/70 px-5 py-5 sm:px-8">
            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => (window.location.hash = "/dashboard")}
                className="inline-flex min-h-[48px] w-full items-center justify-center rounded-xl bg-[#07142a] px-5 text-base font-black text-white transition hover:bg-blue-800 sm:w-auto"
              >
                Open customer dashboard
              </button>
              <button
                type="button"
                onClick={onStartAnother}
                className="inline-flex min-h-[48px] w-full items-center justify-center rounded-xl border border-blue-200 bg-white px-5 text-base font-black text-blue-700 transition hover:border-blue-400 hover:bg-blue-50 sm:w-auto"
              >
                Start another signup
              </button>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

export default function Signup() {
  const signupStartedAtRef = useRef(Date.now());
  const [currentStep, setCurrentStep] = useState(1);
  const [businessSlide, setBusinessSlide] = useState(1);
  const [tradeSetupPanel, setTradeSetupPanel] = useState("trade");
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
  const [captchaToken, setCaptchaToken] = useState("");
  const [businessStepAttempted, setBusinessStepAttempted] = useState(false);
  const [touchedDetails, setTouchedDetails] = useState({});
  const [returnToReviewAfterEdit, setReturnToReviewAfterEdit] = useState(false);
  const [details, setDetails] = useState(() => ({ ...DEFAULT_DETAILS }));
  const [pricing, setPricing] = useState(() => ({ ...DEFAULT_PRICING }));
  const paymentReturnStatus = useMemo(() => getPaymentReturnStatus(), []);
  const paymentReturnNotice = useMemo(() => {
    if (paymentReturnStatus === "success") {
      return {
        title: "Checkout complete",
        body: "Stripe sent you back successfully. The admin setup queue will update from the payment webhook.",
        className: "border-emerald-200 bg-emerald-50 text-emerald-950",
      };
    }
    if (paymentReturnStatus === "cancelled" || paymentReturnStatus === "canceled") {
      return {
        title: "Checkout cancelled",
        body: "No checkout was completed. You can restart setup here when you are ready.",
        className: "border-amber-200 bg-amber-50 text-amber-950",
      };
    }
    return null;
  }, [paymentReturnStatus]);

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
  const businessValidation = useMemo(() => validateBusinessDetails(details), [details]);

  const businessStepDisabled = !businessValidation.isValid || selectedAreas.length === 0;
  const specializationStepDisabled = selectedSpecializationIds.length === 0;
  const businessSlideDisabled =
    currentStep === 1 &&
    ((businessSlide === 1 && tradeSetupPanel === "specialization" && specializationStepDisabled) ||
      (businessSlide === 2 && selectedAreas.length === 0) ||
      (businessSlide === 3 && !businessValidation.isValid));
  const businessSlideLabel =
    businessSlide === 1
      ? "Next: Service area"
      : businessSlide === 2
        ? "Next: Business details"
        : businessSlide === 3
          ? "Next: Pricing"
          : businessSlide === 4
            ? "Review details"
            : "Continue to voice";
  const maxBusinessSlide = businessValidation.isValid && selectedAreas.length > 0 ? 5 : selectedAreas.length > 0 ? 3 : 2;
  const voiceStepDisabled = false;
  const securityStepDisabled = Boolean(CAPTCHA_PROVIDER && !captchaToken);
  const mobilePrimaryLabel =
    currentStep === 2
      ? "Review setup"
      : currentStep === 3
        ? "Start my free 14-day trial"
        : businessSlide === 1
          ? tradeSetupPanel === "trade" ? "Choose work types" : "Continue to service area"
          : businessSlide === 2
            ? "Continue to business details"
            : businessSlide === 3
              ? "Continue to pricing"
              : businessSlide === 4
                ? "Review setup"
                : "Try your assistant";
  const mobilePrimaryDisabled = currentStep === 1 ? businessSlideDisabled : currentStep === 2 ? voiceStepDisabled : securityStepDisabled;

  const goBackFromMobileStep = () => {
    setError("");
    if (currentStep === 3) {
      setCurrentStep(2);
      return;
    }
    if (currentStep === 2) {
      setCurrentStep(1);
      setBusinessSlide(5);
      return;
    }
    if (businessSlide > 1) {
      setBusinessSlide((slide) => Math.max(1, slide - 1));
      if (businessSlide === 2) setTradeSetupPanel("specialization");
      return;
    }
    if (tradeSetupPanel === "specialization") setTradeSetupPanel("trade");
  };

  const updateDetails = (field) => (event) => {
    setDetails((prev) => ({ ...prev, [field]: event.target.value }));
    setStatus("");
    setError("");
  };

  const updatePricing = (field) => (event) => {
    const value = event.target.type === "checkbox" ? event.target.checked : event.target.value;
    setPricing((prev) => ({ ...prev, [field]: value }));
    setStatus("");
    setError("");
  };

  const markDetailTouched = (field) => () => {
    setTouchedDetails((prev) => ({ ...prev, [field]: true }));
  };

  const getBusinessFieldError = (field) => {
    if (!businessStepAttempted && !touchedDetails[field] && !details[field].trim()) return "";
    return businessValidation.errors[field] || "";
  };

  const toggleArea = (area) => {
    setSelectedAreas((prev) => {
      if (prev.includes(area)) {
        return prev.length === 1 ? prev : prev.filter((item) => item !== area);
      }
      return [...prev, area];
    });
  };

  const selectTrade = (tradeId) => {
    setSelectedTradeId(tradeId);
    setError("");
    setTradeSetupPanel("specialization");
  };

  const editBusinessSlideFromReview = (slideNumber, panel = "") => {
    setReturnToReviewAfterEdit(true);
    setError("");
    if (slideNumber === 1) setTradeSetupPanel(panel || "trade");
    setBusinessSlide(slideNumber);
  };

  const editVoiceFromReview = () => {
    setReturnToReviewAfterEdit(true);
    setError("");
    setCurrentStep(2);
    window.scrollTo?.({ top: 0, behavior: "smooth" });
  };

  const toggleSpecialization = (id) => {
    setSelectedSpecializationIds((prev) => {
      if (prev.includes(id)) return prev.length === 1 ? prev : prev.filter((item) => item !== id);
      return [...prev, id];
    });
  };

  const resetSignup = () => {
    setCurrentStep(1);
    setBusinessSlide(1);
    setTradeSetupPanel("trade");
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
    setCaptchaToken("");
    setBusinessStepAttempted(false);
    setTouchedDetails({});
    setReturnToReviewAfterEdit(false);
    signupStartedAtRef.current = Date.now();
    setDetails({ ...DEFAULT_DETAILS });
    setPricing({ ...DEFAULT_PRICING });
    window.scrollTo?.({ top: 0, behavior: "smooth" });
  };

  const submitSignup = async (event) => {
    event.preventDefault();
    if (busy) return;
    if (currentStep === 1) {
      if (businessSlide === 1) {
        if (tradeSetupPanel === "trade") {
          setTradeSetupPanel("specialization");
          return;
        }
        if (specializationStepDisabled) {
          setError("Select at least one specialization before continuing.");
          return;
        }
        if (returnToReviewAfterEdit) {
          setReturnToReviewAfterEdit(false);
          setBusinessSlide(5);
          return;
        }
        setBusinessSlide(2);
        return;
      }
      if (businessSlide === 2) {
        if (selectedAreas.length === 0) {
          setError("Select at least one service area before continuing.");
          return;
        }
        setError("");
        if (returnToReviewAfterEdit) {
          setReturnToReviewAfterEdit(false);
          setBusinessSlide(5);
          return;
        }
        setBusinessSlide(3);
        return;
      }
      if (businessSlide === 3 && !businessValidation.isValid) {
        setBusinessStepAttempted(true);
        setTouchedDetails({ ownerName: true, businessName: true, phone: true, email: true, streetAddress: true, city: true, province: true, postalCode: true });
        setError("Please complete the business details properly before continuing.");
        window.requestAnimationFrame?.(() => {
          const firstInvalid = document.querySelector("#signup-business-details [aria-invalid='true']");
          firstInvalid?.focus();
          firstInvalid?.scrollIntoView?.({ behavior: "smooth", block: "center" });
        });
        return;
      }
      if (businessSlide === 3) {
        setBusinessStepAttempted(false);
        setError("");
        if (returnToReviewAfterEdit) {
          setReturnToReviewAfterEdit(false);
          setBusinessSlide(5);
          return;
        }
        setBusinessSlide(4);
        return;
      }
      if (businessSlide === 4) {
        setError("");
        if (returnToReviewAfterEdit) {
          setReturnToReviewAfterEdit(false);
        }
        setBusinessSlide(5);
        return;
      }
      setBusinessStepAttempted(false);
      setError("");
      setCurrentStep(2);
      window.scrollTo?.({ top: 0, behavior: "smooth" });
      return;
    }
    if (currentStep === 2) {
      if (voiceStepDisabled) return;
      if (returnToReviewAfterEdit) {
        setReturnToReviewAfterEdit(false);
        setCurrentStep(1);
        setBusinessSlide(5);
        window.scrollTo?.({ top: 0, behavior: "smooth" });
        return;
      }
      setCurrentStep(3);
      window.scrollTo?.({ top: 0, behavior: "smooth" });
      return;
    }
    if (currentStep !== 3) return;

    if (hasTooManyBrowserSignupAttempts()) {
      setError("Too many signup attempts from this browser. Please try again later.");
      return;
    }

    if (botTrap.trim()) {
      setStatus("Signup received.");
      return;
    }

    if (!businessValidation.isValid || selectedAreas.length === 0) {
      setCurrentStep(1);
      setBusinessSlide(!selectedAreas.length ? 2 : 5);
      setBusinessStepAttempted(true);
      setTouchedDetails({ ownerName: true, businessName: true, phone: true, email: true, streetAddress: true, city: true, province: true, postalCode: true });
      setError(!selectedAreas.length ? "Select at least one service area before continuing." : "Please complete the business details properly before continuing.");
      window.scrollTo?.({ top: 0, behavior: "smooth" });
      return;
    }

    setBusy(true);
    setError("");
    setStatus("");

    const formData = buildSignupPayload({
      details,
      pricing,
      selectedAreas,
      selectedTrade,
      selectedAgent,
      selectedDialogueText,
      selectedSpecializationLabels,
      specializationNotes,
      botTrap,
      captchaProvider: CAPTCHA_PROVIDER,
      captchaToken,
      signupStartedAt: signupStartedAtRef.current,
    });

    try {
      rememberBrowserSignupAttempt();
      const response = await postSignupPayload(SIGNUP_SUBMIT_URL, formData);
      const data = await parseApiResponse(response, "Signup could not be completed");
      if (!getSignupSuccess(data)) {
        throw new Error(data?.error || "Signup could not be completed right now. Please try again later.");
      }

      setSignupResult({
        ...formData,
        ...data,
        businessName: data.businessName || formData.businessName || formData.businessProfile?.businessName || "",
        ownerName: data.ownerName || formData.ownerName || formData.setupDetails?.ownerName || "",
        ownerEmail: data.ownerEmail || formData.ownerEmail || formData.email || formData.setupDetails?.ownerEmail || "",
        ownerPhone: data.ownerPhone || formData.ownerPhone || formData.phone || formData.setupDetails?.ownerPhone || "",
        twilioPhoneNumber: getTwilioPhoneNumber(data) || data.twilioPhoneNumber || "",
        trialDays: 14,
      });
      setBusy(false);
      window.scrollTo?.({ top: 0, behavior: "smooth" });
    } catch (submitError) {
      setBusy(false);
      setError(submitError?.message || "Signup could not be completed right now. Please try again later.");
    }
  };

  if (signupResult) {
    return <SignupSuccessPage result={signupResult} onStartAnother={resetSignup} />;
  }

  return (
    <main className="min-h-screen bg-[linear-gradient(135deg,#f8fbff_0%,#ffffff_45%,#edf4ff_100%)] text-slate-950">
      <style>
        {`
          @keyframes businessSlideIn {
            0% {
              opacity: 0;
              transform: translateX(46px);
              filter: blur(5px);
            }
            58% {
              opacity: 0.82;
              filter: blur(1.2px);
            }
            100% {
              opacity: 1;
              transform: translateX(0);
              filter: blur(0);
            }
          }

          @keyframes businessSandSweep {
            0% {
              opacity: 0;
              transform: translateX(-125%) skewX(-14deg);
            }
            24% {
              opacity: 0.7;
            }
            78% {
              opacity: 0.28;
            }
            100% {
              opacity: 0;
              transform: translateX(125%) skewX(-14deg);
            }
          }

          @keyframes tradeChoiceSwipe {
            0% {
              opacity: 0;
              transform: translateX(42px);
              filter: blur(4px);
            }
            100% {
              opacity: 1;
              transform: translateX(0);
              filter: blur(0);
            }
          }

          .trade-choice-panel {
            animation: tradeChoiceSwipe 520ms cubic-bezier(.16,.84,.22,1) both;
          }

          .business-slide-window {
            animation: businessSlideIn 780ms cubic-bezier(.16,.84,.22,1) both;
            isolation: isolate;
            overflow: hidden;
          }

          .business-slide-window::after {
            content: "";
            position: absolute;
            inset: -24px -45%;
            pointer-events: none;
            z-index: 20;
            background:
              radial-gradient(circle at 18% 28%, rgba(255, 197, 116, 0.34) 0 1px, transparent 2px),
              radial-gradient(circle at 44% 62%, rgba(37, 99, 235, 0.18) 0 1px, transparent 2px),
              linear-gradient(105deg, transparent 0%, rgba(255, 255, 255, 0.08) 34%, rgba(255, 210, 140, 0.36) 48%, rgba(37, 99, 235, 0.14) 61%, transparent 100%);
            background-size: 22px 22px, 28px 28px, 100% 100%;
            filter: blur(0.25px);
            animation: businessSandSweep 980ms cubic-bezier(.16,.84,.22,1) both;
          }

          @media (prefers-reduced-motion: reduce) {
            .business-slide-window,
            .business-slide-window::after {
              animation: none;
            }
          }

          .signup-mobile-progress,
          .signup-mobile-action-bar,
          .signup-mobile-selected-count,
          .signup-mobile-field-group,
          .signup-mobile-review-contact {
            display: none;
          }

          .signup-review-value-mobile {
            display: none;
          }

          @media (max-width: 639px) {
            .signup-mobile-flow {
              min-height: 100dvh;
              padding: 0 16px calc(128px + env(safe-area-inset-bottom));
            }

            .signup-page-header {
              padding: 14px 0 10px;
              text-align: left;
            }

            .signup-page-header h1 {
              font-size: 1.65rem;
              line-height: 1.08;
              letter-spacing: -0.035em;
            }

            .signup-page-header > p,
            .signup-page-benefits,
            .signup-macro-stepper,
            .signup-desktop-tabs,
            .signup-task-explainer,
            .signup-inline-actions,
            .signup-inline-action,
            .signup-desktop-action-footer,
            .signup-privacy-footer {
              display: none !important;
            }

            .signup-mobile-progress {
              display: block;
              border-top: 1px solid #e2e8f0;
              padding: 10px 0 12px;
            }

            .signup-mobile-progress-copy {
              display: flex;
              align-items: center;
              justify-content: space-between;
              gap: 12px;
              font-size: 0.82rem;
              line-height: 1.2;
            }

            .signup-mobile-progress-copy span {
              color: #2563eb;
              font-weight: 800;
              white-space: nowrap;
            }

            .signup-mobile-progress-copy strong {
              min-width: 0;
              overflow: hidden;
              color: #0f172a;
              font-weight: 800;
              text-overflow: ellipsis;
              white-space: nowrap;
            }

            .signup-mobile-progress-track {
              height: 4px;
              margin-top: 8px;
              overflow: hidden;
              border-radius: 999px;
              background: #dbeafe;
            }

            .signup-mobile-progress-track span {
              display: block;
              height: 100%;
              border-radius: inherit;
              background: linear-gradient(90deg, #2563eb, #7c3aed);
              transition: width 240ms ease;
            }

            .signup-task-section {
              margin-top: 0;
            }

            .signup-task-shell {
              border: 0;
              border-radius: 0;
              background: transparent;
              box-shadow: none;
            }

            .signup-task-window {
              display: block;
              overflow: visible;
              padding: 10px 0 20px;
              animation-duration: 280ms;
            }

            .signup-task-window::after {
              display: none;
            }

            .signup-task-layout {
              display: block;
            }

            .signup-task-content {
              display: block;
              border: 0;
              border-radius: 0;
            }

            .signup-task-content-title {
              margin-bottom: 14px;
            }

            .signup-task-content-title p:first-child {
              font-size: 0.75rem;
            }

            .signup-task-content-title p:last-child {
              margin-top: 4px;
              font-size: 1rem;
              line-height: 1.5;
            }

            .signup-mobile-task-heading {
              display: block;
              margin-bottom: 14px;
            }

            .signup-mobile-task-heading h2 {
              margin: 0;
              color: #0f172a;
              font-size: clamp(1.75rem, 8vw, 2rem);
              font-weight: 900;
              letter-spacing: -0.04em;
              line-height: 1.05;
            }

            .signup-mobile-task-heading p {
              margin-top: 7px;
              color: #475569;
              font-size: 1rem;
              font-weight: 600;
              line-height: 1.45;
            }

            .signup-trade-grid,
            .signup-specialization-grid {
              gap: 10px;
            }

            .signup-trade-grid > button {
              min-height: 92px;
              border-radius: 16px;
              padding: 12px 8px;
            }

            .signup-specialization-grid > button {
              min-height: 88px;
              border-radius: 16px;
              padding: 10px 8px;
            }

            .signup-area-list {
              display: grid;
              height: auto;
              max-height: none;
              overflow: visible;
              padding: 0;
            }

            .signup-area-grid {
              display: grid;
              grid-template-columns: repeat(2, minmax(0, 1fr));
              gap: 10px;
            }

            .signup-area-grid > button:not(.signup-inline-action) {
              display: flex;
              min-width: 0;
              min-height: 48px;
              align-items: center;
              justify-content: space-between;
              border-radius: 14px;
              padding: 10px 12px;
              font-size: 0.95rem;
              line-height: 1.2;
              text-align: left;
            }

            .signup-mobile-selected-count {
              display: flex;
              align-items: center;
              justify-content: space-between;
              margin-bottom: 12px;
              border-radius: 12px;
              background: #eff6ff;
              padding: 10px 12px;
              color: #1d4ed8;
              font-size: 0.9rem;
              font-weight: 800;
            }

            .signup-business-fields {
              display: block;
            }

            .signup-business-fields > label {
              display: block;
              margin-bottom: 16px;
            }

            .signup-business-fields label > span:nth-child(2) {
              min-height: 52px;
            }

            .signup-mobile-field-group {
              display: block;
              margin: 6px 0 14px;
              color: #1e40af;
              font-size: 0.78rem;
              font-weight: 900;
              letter-spacing: 0.12em;
              text-transform: uppercase;
            }

            .signup-mobile-field-group.address {
              margin-top: 24px;
              padding-top: 18px;
              border-top: 1px solid #e2e8f0;
            }

            .signup-mobile-action-bar {
              position: fixed;
              right: 0;
              bottom: 0;
              left: 0;
              z-index: 50;
              display: grid;
              grid-template-columns: minmax(92px, 0.36fr) minmax(0, 1fr);
              gap: 10px;
              border-top: 1px solid rgba(203, 213, 225, 0.9);
              background: rgba(255, 255, 255, 0.96);
              padding: 10px 16px calc(10px + env(safe-area-inset-bottom));
              box-shadow: 0 -16px 34px -28px rgba(15, 23, 42, 0.65);
              backdrop-filter: blur(14px);
            }

            .signup-mobile-action-bar.is-first-step {
              grid-template-columns: 1fr;
            }

            .signup-mobile-action-bar button {
              min-height: 52px;
              border-radius: 14px;
              font-size: 0.98rem;
              font-weight: 900;
            }

            .signup-mobile-back {
              border: 1px solid #cbd5e1;
              background: #fff;
              color: #334155;
            }

            .signup-mobile-primary {
              display: inline-flex;
              align-items: center;
              justify-content: center;
              gap: 8px;
              border: 0;
              background: linear-gradient(90deg, #2563eb, #4f46e5);
              color: #fff;
              box-shadow: 0 14px 30px -20px rgba(37, 99, 235, 0.95);
            }

            .signup-mobile-primary:disabled {
              background: #cbd5e1;
              color: #64748b;
              box-shadow: none;
            }

            .signup-mobile-disabled-reason {
              grid-column: 1 / -1;
              margin: -3px 2px 0;
              color: #64748b;
              font-size: 0.78rem;
              font-weight: 650;
              line-height: 1.3;
              text-align: right;
            }

            .signup-voice-step {
              margin-top: 0;
              gap: 0;
            }

            .signup-voice-shell {
              border: 0;
              border-radius: 0;
              background: transparent;
              box-shadow: none;
            }

            .signup-voice-desktop-head {
              display: none;
            }

            .signup-voice-layout {
              display: block;
              padding: 10px 0 20px;
            }

            .signup-voice-intro {
              border: 0;
              border-radius: 0;
              background: transparent;
              padding: 0;
            }

            .signup-voice-intro h2 {
              font-size: 1.9rem;
            }

            .signup-voice-intro > div:first-child > p:last-child {
              margin-top: 7px;
              font-size: 1rem;
              line-height: 1.5;
            }

            .signup-voice-intro > div:first-child > p:first-child {
              display: none;
            }

            .signup-voice-business-card {
              margin-top: 14px;
              border-radius: 14px;
              padding: 14px;
            }

            .signup-voice-call-card {
              margin-top: 14px;
              border-radius: 18px;
              padding: 16px;
            }

            .signup-voice-call-control {
              display: block;
            }

            .signup-voice-call-button {
              display: flex;
              width: 100%;
              height: 56px;
              align-items: center;
              justify-content: center;
              gap: 10px;
            }

            .signup-voice-call-button svg {
              width: 22px;
              height: 22px;
            }

            .signup-voice-call-button span {
              display: inline;
              font-size: 1rem;
              font-weight: 900;
            }

            .signup-voice-call-copy {
              margin-top: 12px;
            }

            .signup-voice-call-copy > p:first-child {
              display: none;
            }

            .signup-review-edit-fields {
              display: none;
            }

            .signup-mobile-review-contact {
              display: block;
            }

            .signup-review-value-desktop {
              display: none;
            }

            .signup-review-value-mobile {
              display: inline;
            }

            .signup-review-edit-link {
              min-width: 76px;
              min-height: 44px;
              padding: 0 12px;
              white-space: nowrap;
            }

            .signup-review-step {
              margin-top: 0;
              padding-top: 10px;
            }

            .signup-review-step .rounded-3xl {
              border-radius: 16px;
            }
          }
        `}
      </style>
      <header className="hidden bg-[#020918] shadow-[0_24px_60px_-48px_rgba(15,23,42,0.85)]">
        <div className="mx-auto flex min-h-16 max-w-[1440px] items-center px-4 py-3 sm:px-12">
          <BrandLogo />
        </div>
      </header>

      <form onSubmit={submitSignup} className="signup-mobile-flow mx-auto flex min-h-screen w-full max-w-[1680px] flex-col px-3 pb-5 pt-1 sm:px-6 lg:px-8">
        <section className="signup-page-header shrink-0 text-center">
          <h1 className="text-[clamp(1.65rem,3.8vw,2.55rem)] font-black leading-tight tracking-[-0.04em] text-slate-950">
            Create your AI phone assistant
          </h1>
          <p className="mt-0.5 text-base font-medium text-slate-600 sm:text-lg">Set up your business assistant in minutes.</p>

          <div className="signup-page-benefits mt-2 flex flex-wrap justify-center gap-x-8 gap-y-1.5">
            <Benefit icon="shield">Free for 14 days</Benefit>
            <Benefit icon="card">No credit card required</Benefit>
            <Benefit icon="refresh">Cancel anytime</Benefit>
          </div>

          {paymentReturnNotice ? (
            <div
              className={`mx-auto mt-3 max-w-3xl rounded-2xl border px-4 py-3 text-left shadow-[0_18px_44px_-36px_rgba(15,23,42,0.75)] ${paymentReturnNotice.className}`}
              role="status"
              aria-live="polite"
            >
              <p className="text-sm font-black uppercase tracking-[0.12em]">{paymentReturnNotice.title}</p>
              <p className="mt-1 text-sm font-semibold leading-6 opacity-80">{paymentReturnNotice.body}</p>
            </div>
          ) : null}

          <Stepper currentStep={currentStep} />
        </section>

        <MobileSignupProgress currentStep={currentStep} businessSlide={businessSlide} tradeSetupPanel={tradeSetupPanel} />

        {currentStep === 1 ? (
          <section className="signup-task-section mt-2 flex flex-1 flex-col">
            <div className="signup-task-shell flex flex-1 flex-col rounded-3xl border border-slate-200 bg-white/96 shadow-[0_34px_90px_-70px_rgba(15,23,42,0.8)]">
              <div className="signup-desktop-tabs border-b border-slate-100 bg-slate-50/70 px-4 py-4 sm:px-8">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-blue-600">Business setup</p>
                  <p className="text-xs font-black text-slate-400">{businessSlide} of 5</p>
                </div>
                <div className="mt-4 flex gap-3 overflow-x-auto pb-1 [scrollbar-width:thin] sm:grid sm:grid-cols-5 sm:overflow-visible sm:pb-0">
                  {BUSINESS_SLIDE_TABS.map((slide) => {
                    const isActive = slide.number === businessSlide;
                    const isAvailable = slide.number <= maxBusinessSlide;
                    return (
                      <button
                        key={slide.number}
                        type="button"
                        disabled={!isAvailable}
                        onClick={() => {
                          if (!isAvailable) return;
                          setBusinessSlide(slide.number);
                          if (slide.number === 1) setTradeSetupPanel("trade");
                          setError("");
                        }}
                        className={
                          "min-h-[58px] min-w-[142px] rounded-2xl border px-3 text-center text-[0.72rem] font-black uppercase leading-tight tracking-[0.1em] transition sm:min-w-0 sm:text-xs " +
                          (isActive
                            ? "border-blue-600 bg-blue-600 text-white shadow-[0_14px_28px_-20px_rgba(37,99,235,0.95)]"
                            : isAvailable
                              ? "border-blue-100 bg-white text-blue-600 hover:border-blue-300 hover:bg-blue-50"
                              : "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400")
                        }
                        aria-current={isActive ? "step" : undefined}
                      >
                        <span className="block text-[0.68rem] opacity-75">0{slide.number}</span>
                        {slide.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div key={businessSlide} className="signup-task-window business-slide-window relative flex flex-1 p-5 sm:p-8 lg:p-10">
              {businessSlide === 1 ? (
                <section className="signup-task-layout grid w-full gap-6 lg:grid-cols-[360px_minmax(0,1fr)] xl:grid-cols-[390px_minmax(0,1fr)] lg:items-stretch">
                  <div className="signup-task-explainer flex flex-col justify-center rounded-3xl border border-blue-100 bg-blue-50/70 p-8">
                    <p className="text-xs font-black uppercase tracking-[0.16em] text-blue-600">Step 1</p>
                    <h2 className="mt-2 text-[clamp(2rem,3vw,3.1rem)] font-black leading-tight tracking-[-0.04em] text-slate-950">
                      {tradeSetupPanel === "trade" ? "Choose your trade" : "Choose specializations"}
                    </h2>
                    <p className="mt-4 text-lg font-medium leading-8 text-slate-600">
                      {tradeSetupPanel === "trade"
                        ? "Pick the main business type. The next panel will ask which kinds of work you handle."
                        : `Tell the assistant which types of ${selectedTrade.label.toLowerCase()} work to answer for.`}
                    </p>
                    <div className="mt-6 rounded-2xl border border-blue-100 bg-white/80 p-4 text-sm font-semibold leading-6 text-slate-600">
                      <span className="font-black text-blue-600">Selected:</span> {selectedTrade.label} for {selectedSpecializationLabels.join(", ").toLowerCase()} work.
                    </div>
                  </div>
                  <div className="signup-task-content relative grid content-center">
                    {tradeSetupPanel === "trade" ? (
                    <div key="trade-panel" className="trade-choice-panel">
                      <div className="signup-mobile-task-heading">
                        <h2>Choose your trade</h2>
                        <p>Pick the main type of work your business handles.</p>
                      </div>
                      <div className="signup-task-content-title mb-4 flex items-end justify-between gap-3">
                        <div>
                          <p className="text-xs font-black uppercase tracking-[0.16em] text-blue-600">Trade</p>
                          <p className="mt-1 text-sm font-semibold text-slate-500">Tap a trade to continue to specialization.</p>
                        </div>
                      </div>
                      <div className="signup-trade-grid grid grid-cols-2 gap-4 sm:grid-cols-3 xl:gap-5">
                        {TRADE_OPTIONS.map((trade) => (
                          <TradeCard
                            key={trade.id}
                            trade={trade}
                            selected={trade.id === selectedTradeId}
                            onClick={() => selectTrade(trade.id)}
                          />
                        ))}
                      </div>
                    </div>
                    ) : (
                    <div key="specialization-panel" className="trade-choice-panel grid gap-5">
                      <div className="signup-mobile-task-heading">
                        <h2>Choose work types</h2>
                        <p>Select everything your assistant should answer calls about.</p>
                      </div>
                      <div className="signup-task-content-title flex flex-wrap items-end justify-between gap-3">
                        <div>
                          <p className="text-xs font-black uppercase tracking-[0.16em] text-blue-600">Specialization</p>
                          <p className="mt-1 text-sm font-semibold text-slate-500">Choose at least one. You can select multiple.</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setTradeSetupPanel("trade");
                            setError("");
                          }}
                          className="inline-flex min-h-[42px] items-center justify-center rounded-xl border border-blue-100 bg-white px-4 text-sm font-black text-blue-600 transition hover:border-blue-300 hover:bg-blue-50"
                        >
                          Back to trades
                        </button>
                      </div>
                      <div className="signup-specialization-grid grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5 xl:gap-5">
                        {SPECIALIZATION_OPTIONS.map((item) => (
                          <SpecializationCard
                            key={item.id}
                            item={item}
                            selected={selectedSpecializationIds.includes(item.id)}
                            onClick={() => toggleSpecialization(item.id)}
                          />
                        ))}
                      </div>

                      <div className="signup-inline-actions grid gap-3 sm:grid-cols-[1fr_220px] sm:items-center">
                        <p className="text-sm font-semibold leading-6 text-slate-500">
                          Your assistant will use these choices to recognize the work customers ask about.
                        </p>
                        <button
                          type="submit"
                          disabled={businessSlideDisabled || busy}
                          className={
                            "inline-flex min-h-[54px] items-center justify-center gap-3 rounded-2xl px-6 py-3 text-base font-black text-white transition sm:text-lg " +
                            (businessSlideDisabled || busy
                              ? "cursor-not-allowed bg-slate-300"
                              : "bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 shadow-[0_16px_42px_-28px_rgba(79,70,229,0.95)] hover:-translate-y-0.5 hover:brightness-110")
                          }
                        >
                          {busy ? "Saving..." : businessSlideLabel}
                          <Icon name="arrow" className="h-5 w-5" />
                        </button>
                      </div>
                    </div>
                    )}
                  </div>
              </section>
              ) : null}

              {businessSlide === 2 ? (
              <section className="signup-task-layout grid min-h-0 w-full gap-6 lg:grid-cols-[360px_minmax(0,1fr)] xl:grid-cols-[390px_minmax(0,1fr)] lg:items-stretch">
                <div className="signup-task-explainer flex flex-col justify-center rounded-3xl border border-blue-100 bg-blue-50/70 p-8">
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-blue-600">Step 2</p>
                  <h2 className="mt-2 text-[clamp(2rem,3vw,3.1rem)] font-black leading-tight tracking-[-0.04em] text-slate-950">Service area</h2>
                  <p className="mt-4 text-lg font-medium leading-8 text-slate-600">Select the Southern Ontario areas you serve.</p>
                </div>
                <div className="signup-task-content min-h-0 overflow-hidden rounded-3xl">
                  <div className="signup-mobile-task-heading">
                    <h2>Where do you work?</h2>
                    <p>Select every area where you take jobs.</p>
                  </div>
                  <div className="signup-mobile-selected-count">
                    <span>Selected areas</span>
                    <span>{selectedAreas.length}</span>
                  </div>
                  <div className="signup-area-list flex h-full max-h-[42vh] content-start items-start overflow-y-auto pr-2 pb-2 [scrollbar-width:thin] sm:max-h-[46vh] lg:max-h-full">
                    <div className="signup-area-grid flex flex-wrap content-start items-start gap-3 xl:gap-4">
                      {AREA_OPTIONS.map((area) => (
                        <AreaChip key={area} area={area} selected={selectedAreas.includes(area)} onClick={() => toggleArea(area)} />
                      ))}
                      <button
                        type="button"
                        onClick={() => setBusinessSlide(1)}
                        className="signup-inline-action min-h-[54px] min-w-[160px] rounded-2xl border border-slate-200 bg-white px-6 py-3 text-base font-bold text-slate-600 transition hover:border-blue-300 hover:text-blue-600 sm:text-lg"
                      >
                        Back
                      </button>
                      <button
                        type="submit"
                        disabled={businessSlideDisabled || busy}
                        className={
                          "signup-inline-action inline-flex min-h-[54px] min-w-[260px] items-center justify-center gap-3 rounded-2xl px-6 py-3 text-base font-black text-white transition sm:text-lg " +
                          (businessSlideDisabled || busy
                            ? "cursor-not-allowed bg-slate-300"
                            : "bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 shadow-[0_16px_42px_-28px_rgba(79,70,229,0.95)] hover:-translate-y-0.5 hover:brightness-110")
                        }
                      >
                        {busy ? "Saving..." : businessSlideLabel}
                        <Icon name="arrow" className="h-5 w-5" />
                      </button>
                    </div>
                  </div>
                </div>
              </section>
              ) : null}

              {businessSlide === 3 ? (
              <section id="signup-business-details" className="signup-task-layout grid w-full gap-6 lg:grid-cols-[360px_minmax(0,1fr)] xl:grid-cols-[390px_minmax(0,1fr)] lg:items-stretch">
                <div className="signup-task-explainer flex flex-col justify-center rounded-3xl border border-blue-100 bg-blue-50/70 p-8">
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-blue-600">Step 3</p>
                  <h2 className="mt-2 text-[clamp(2rem,3vw,3.1rem)] font-black leading-tight tracking-[-0.04em] text-slate-950">Business details</h2>
                  <p className="mt-4 text-lg font-medium leading-8 text-slate-600">Enter real, complete business details. These are required before you can continue.</p>
                  <p className="mt-4 text-sm font-semibold leading-6 text-slate-500">Street address, city, province, and postal code help us serve your callers better.</p>
                </div>
                <div className="signup-task-content">
                  <div className="signup-mobile-task-heading">
                    <h2>Tell us about your business</h2>
                    <p>We use these details to personalize your assistant.</p>
                  </div>
                  <div className="signup-business-fields grid content-start gap-4 sm:grid-cols-2 xl:grid-cols-4 xl:gap-5">
                  <p className="signup-mobile-field-group">Contact</p>
                  <LabeledInput
                    label="Business owner's name"
                    icon="user"
                    value={details.ownerName}
                    onChange={updateDetails("ownerName")}
                    onBlur={markDetailTouched("ownerName")}
                    placeholder="e.g., Jamie Smith"
                    autoComplete="name"
                    error={getBusinessFieldError("ownerName")}
                  />
                  <LabeledInput
                    label="Business name"
                    icon="briefcase"
                    value={details.businessName}
                    onChange={updateDetails("businessName")}
                    onBlur={markDetailTouched("businessName")}
                    placeholder={`e.g., ${selectedTrade.label === "Electrician" ? "Smith Electrical Services" : `${selectedTrade.label} Services`}`}
                    autoComplete="organization"
                    error={getBusinessFieldError("businessName")}
                  />
                  <LabeledInput
                    label="Business phone number"
                    icon="phone"
                    value={details.phone}
                    onChange={updateDetails("phone")}
                    onBlur={markDetailTouched("phone")}
                    placeholder="(416) 555-1234"
                    autoComplete="tel"
                    inputMode="tel"
                    error={getBusinessFieldError("phone")}
                  />
                  <LabeledInput
                    label="Email address"
                    icon="mail"
                    value={details.email}
                    onChange={updateDetails("email")}
                    onBlur={markDetailTouched("email")}
                    placeholder="you@yourbusiness.com"
                    type="email"
                    autoComplete="email"
                    inputMode="email"
                    error={getBusinessFieldError("email")}
                  />
                  <p className="signup-mobile-field-group address">Business address</p>
                  <LabeledInput
                    className="sm:col-span-2 lg:col-span-2"
                    label="Street address"
                    icon="pin"
                    value={details.streetAddress}
                    onChange={updateDetails("streetAddress")}
                    onBlur={markDetailTouched("streetAddress")}
                    placeholder="123 Main St"
                    autoComplete="street-address"
                    error={getBusinessFieldError("streetAddress")}
                  />
                  <LabeledInput
                    label="City"
                    icon="pin"
                    value={details.city}
                    onChange={updateDetails("city")}
                    onBlur={markDetailTouched("city")}
                    placeholder="Toronto"
                    autoComplete="address-level2"
                    error={getBusinessFieldError("city")}
                  />
                  <LabeledSelect
                    label="Province"
                    icon="pin"
                    value={details.province}
                    onChange={updateDetails("province")}
                    onBlur={markDetailTouched("province")}
                    options={CANADIAN_PROVINCES}
                    error={getBusinessFieldError("province")}
                  />
                  <LabeledInput
                    label="Postal code"
                    icon="pin"
                    value={details.postalCode}
                    onChange={updateDetails("postalCode")}
                    onBlur={markDetailTouched("postalCode")}
                    placeholder="M5V 2T6"
                    autoComplete="postal-code"
                    error={getBusinessFieldError("postalCode")}
                  />
                  <button
                    type="button"
                    onClick={() => setBusinessSlide(2)}
                    className="signup-inline-action mt-auto flex min-h-[54px] items-center justify-center rounded-xl border border-slate-200 bg-white px-5 text-base font-bold text-slate-600 transition hover:border-blue-300 hover:text-blue-600"
                  >
                    Back
                  </button>
                  <button
                    type="submit"
                    disabled={businessSlideDisabled || busy}
                    className={
                      "signup-inline-action mt-auto inline-flex min-h-[54px] items-center justify-center gap-3 rounded-2xl px-6 text-base font-black text-white transition sm:text-lg xl:col-span-2 " +
                      (businessSlideDisabled || busy
                        ? "cursor-not-allowed bg-slate-300"
                        : "bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 shadow-[0_16px_42px_-28px_rgba(79,70,229,0.95)] hover:-translate-y-0.5 hover:brightness-110")
                    }
                  >
                    {busy ? "Saving..." : businessSlideLabel}
                    <Icon name="arrow" className="h-5 w-5" />
                  </button>
                  </div>
                </div>
              </section>
              ) : null}

              {businessSlide === 4 ? (
                <section className="signup-task-layout grid w-full gap-6 lg:grid-cols-[360px_minmax(0,1fr)] xl:grid-cols-[390px_minmax(0,1fr)] lg:items-stretch">
                  <div className="signup-task-explainer flex flex-col justify-center rounded-3xl border border-blue-100 bg-blue-50/70 p-8">
                    <p className="text-xs font-black uppercase tracking-[0.16em] text-blue-600">Step 4</p>
                    <h2 className="mt-2 text-[clamp(2rem,3vw,3.1rem)] font-black leading-tight tracking-[-0.04em] text-slate-950">Pricing script</h2>
                    <p className="mt-4 text-lg font-medium leading-8 text-slate-600">Set the simple prices your assistant should explain before booking.</p>
                  </div>
                  <div className="signup-task-content">
                    <div className="signup-mobile-task-heading">
                      <h2>What should your assistant quote?</h2>
                      <p>Add the simple prices callers ask about most.</p>
                    </div>
                    <div className="grid content-start gap-4 sm:grid-cols-2 xl:grid-cols-4 xl:gap-5">
                    <label className="sm:col-span-2 xl:col-span-2">
                      <span className="mb-1.5 block text-sm font-semibold leading-none text-slate-700">Installations</span>
                      <span className="flex min-h-[54px] items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 text-lg font-semibold text-slate-950 shadow-[0_1px_0_rgba(15,23,42,0.02)]">
                        <input
                          type="checkbox"
                          checked={pricing.installationFreeEstimate !== false}
                          onChange={updatePricing("installationFreeEstimate")}
                          className="h-5 w-5 rounded border-slate-300 text-blue-600 accent-blue-600"
                        />
                        Free estimates for installations
                      </span>
                    </label>
                    <LabeledInput
                      label="Repairs / maintenance visit"
                      icon="card"
                      value={pricing.repairVisitFee}
                      onChange={updatePricing("repairVisitFee")}
                      placeholder="100"
                      type="number"
                    />
                    <LabeledInput
                      label="Hourly rate after that"
                      icon="card"
                      value={pricing.repairHourlyRate}
                      onChange={updatePricing("repairHourlyRate")}
                      placeholder="100"
                      type="number"
                    />
                    </div>
                  </div>
                </section>
              ) : null}

              {businessSlide === 5 ? (
                <section className="signup-task-layout grid w-full gap-6 lg:grid-cols-[360px_minmax(0,1fr)] xl:grid-cols-[390px_minmax(0,1fr)] lg:items-stretch">
                  <div className="signup-task-explainer flex flex-col justify-center rounded-3xl border border-blue-100 bg-blue-50/70 p-8">
                    <p className="text-xs font-black uppercase tracking-[0.16em] text-blue-600">Step 5</p>
                    <h2 className="mt-2 text-[clamp(2rem,3vw,3.1rem)] font-black leading-tight tracking-[-0.04em] text-slate-950">Review</h2>
                    <p className="mt-4 text-lg font-medium leading-8 text-slate-600">Check the details before continuing. Use Back or the top columns to change anything.</p>
                  </div>
                  <div className="signup-task-content content-center">
                    <div className="signup-mobile-task-heading">
                      <h2>Check your setup</h2>
                      <p>Make sure everything looks right before trying your assistant.</p>
                    </div>
                    <ReviewPanel
                      trade={selectedTrade}
                      areas={selectedAreas}
                      specializations={selectedSpecializationLabels}
                      voice={selectedAgent}
                      details={details}
                      pricing={pricing}
                      onUpdateDetails={updateDetails}
                      onEditBusinessSlide={editBusinessSlideFromReview}
                      onEditVoice={editVoiceFromReview}
                      getFieldError={getBusinessFieldError}
                      onFieldBlur={markDetailTouched}
                    />
                  </div>
                </section>
              ) : null}
              </div>

              {businessSlide > 1 && businessSlide !== 2 && businessSlide !== 3 ? (
                <div className="signup-desktop-action-footer border-t border-slate-100 bg-slate-50/80 px-5 py-4 sm:px-8">
                  <div className="mx-auto grid max-w-[920px] gap-3 sm:grid-cols-[220px_minmax(0,1fr)] sm:items-center">
                    <button
                      type="button"
                      onClick={() => setBusinessSlide((slide) => Math.max(1, slide - 1))}
                      className="flex min-h-[54px] items-center justify-center rounded-xl border border-slate-200 bg-white px-5 text-base font-bold text-slate-600 transition hover:border-blue-300 hover:text-blue-600"
                    >
                      Back
                    </button>

                    <TrialButton
                      disabled={businessSlideDisabled}
                      busy={busy}
                      label={businessSlideLabel}
                    />
                  </div>
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        {currentStep === 2 ? (
          <VoiceDemoStep
            agent={selectedAgent}
            businessName={details.businessName}
            trade={selectedTrade}
            areas={selectedAreas}
          />
        ) : null}

        {currentStep === 3 ? (
          <section className="signup-review-step mt-5">
            <ReviewPanel
              trade={selectedTrade}
              areas={selectedAreas}
              specializations={selectedSpecializationLabels}
                      voice={selectedAgent}
                      details={details}
              pricing={pricing}
              onUpdateDetails={updateDetails}
              onEditBusinessSlide={(slideNumber) => {
                setCurrentStep(1);
                editBusinessSlideFromReview(slideNumber);
                window.scrollTo?.({ top: 0, behavior: "smooth" });
              }}
              onEditVoice={editVoiceFromReview}
              getFieldError={getBusinessFieldError}
              onFieldBlur={markDetailTouched}
            />
          </section>
        ) : null}

        {currentStep === 3 ? (
          <HumanVerificationCheck />
        ) : null}

        <div
          className={
            "signup-mobile-action-bar " +
            (currentStep === 1 && businessSlide === 1 && tradeSetupPanel === "trade" ? "is-first-step" : "")
          }
        >
          {currentStep === 1 && businessSlide === 1 && tradeSetupPanel === "trade" ? null : (
            <button type="button" onClick={goBackFromMobileStep} className="signup-mobile-back">
              {currentStep === 2 ? "Skip for now" : "Back"}
            </button>
          )}
          <button type="submit" disabled={mobilePrimaryDisabled || busy} className="signup-mobile-primary">
            {busy ? "Saving…" : mobilePrimaryLabel}
            <Icon name="arrow" className="h-4 w-4" />
          </button>
          {mobilePrimaryDisabled ? (
            <p className="signup-mobile-disabled-reason">
              {currentStep === 1 && businessSlide === 1
                ? "Choose at least one work type to continue."
                : currentStep === 1 && businessSlide === 2
                  ? "Choose at least one service area to continue."
                  : currentStep === 1 && businessSlide === 3
                    ? "Complete the required business details to continue."
                    : "Complete the verification above to start your trial."}
            </p>
          ) : null}
          {currentStep === 3 ? (
            <p className="signup-mobile-disabled-reason">Free for 14 days · No credit card required · Cancel anytime</p>
          ) : null}
        </div>

        <div className="signup-desktop-action-footer shrink-0 pt-3">
          {currentStep === 1 ? null : (
            <div className="mx-auto grid max-w-[920px] gap-3 sm:grid-cols-[220px_minmax(0,1fr)] sm:items-center">
              {currentStep > 1 || businessSlide > 1 ? (
                <button
                  type="button"
                  onClick={() => {
                    if (currentStep === 1 && businessSlide > 1) {
                      setBusinessSlide((slide) => Math.max(1, slide - 1));
                    } else {
                      setCurrentStep((step) => Math.max(1, step - 1));
                      if (currentStep === 2) setBusinessSlide(5);
                    }
                  }}
                  className="flex min-h-[54px] items-center justify-center rounded-xl border border-slate-200 bg-white px-5 text-base font-bold text-slate-600 transition hover:border-blue-300 hover:text-blue-600"
                >
                  Back
                </button>
              ) : (
                <span className="hidden sm:block" />
              )}

              <TrialButton
                disabled={currentStep === 1 ? businessSlideDisabled : currentStep === 2 ? voiceStepDisabled : securityStepDisabled}
                busy={busy}
                finalStep={currentStep === 3}
                label={currentStep === 1 ? businessSlideLabel : currentStep === 3 ? "Start free trial" : "Save & continue"}
              />
            </div>
          )}

          <label className="sr-only" aria-hidden="true">
            Company website
            <input
              name="companyWebsite"
              type="text"
              tabIndex="-1"
              autoComplete="off"
              value={botTrap}
              onChange={(event) => setBotTrap(event.target.value)}
              className="pointer-events-none fixed left-0 top-0 h-px w-px opacity-0"
            />
          </label>

          <div className="signup-privacy-footer mt-1 flex items-center justify-center gap-2 text-center text-sm font-medium text-slate-500 sm:text-base">
            <Icon name="lock" className="h-4 w-4" />
            Your information is protected and used to set up and operate your service.
          </div>
        </div>

        {error ? <p className="mt-4 text-center text-sm font-semibold text-rose-600">{error}</p> : null}
        {status ? <p className="mt-4 text-center text-sm font-semibold text-emerald-600">{status}</p> : null}
      </form>
    </main>
  );
}
