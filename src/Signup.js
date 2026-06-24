import React, { useEffect, useMemo, useRef, useState } from "react";

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
    <div className="mx-auto mt-3 flex w-full max-w-full snap-x items-center justify-start gap-2 overflow-x-auto px-1 pb-1 sm:max-w-[590px] sm:justify-center sm:gap-3 sm:overflow-visible sm:px-3 sm:pb-0">
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

function LabeledInput({ label, icon, value, onChange, onBlur, placeholder, type = "text", className = "", error = "" }) {
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

function ReviewPanel({ trade, areas, specializations, voice, details, pricing, onUpdateDetails, onEditBusinessSlide, onEditVoice, getFieldError, onFieldBlur }) {
  const businessAddress = formatBusinessAddress(details);
  const pricingScript = pricing ? buildPricingScript(pricing) : "";
  const optionItems = [
    ["Trade", trade.label, () => onEditBusinessSlide?.(1)],
    ["Service area", areas.join(", "), () => onEditBusinessSlide?.(2)],
    ["Pricing script", pricingScript, () => onEditBusinessSlide?.(4)],
    ["Specializations", specializations.join(", "), null],
    ["Assistant voice", voice.label, onEditVoice],
  ];

  return (
    <div className="rounded-2xl border border-slate-200 bg-white/96 p-4 shadow-[0_34px_90px_-70px_rgba(15,23,42,0.8)] sm:p-6">
      <h2 className="text-xl font-black tracking-[-0.02em] text-slate-950">Review your setup</h2>
      <p className="mt-1 text-sm font-medium text-slate-500">Confirm the basics before we send the setup brief.</p>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {optionItems.map(([label, value, onEdit]) => (
          <div key={label} className="rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">{label}</div>
                <div className="mt-1 text-sm font-bold text-slate-950">{value || "Not added yet"}</div>
              </div>
              {onEdit ? (
                <button
                  type="button"
                  onClick={onEdit}
                  className="rounded-lg border border-blue-100 bg-white px-3 py-1 text-xs font-black uppercase tracking-[0.08em] text-blue-600 transition hover:border-blue-300 hover:bg-blue-50"
                >
                  Change
                </button>
              ) : null}
            </div>
          </div>
        ))}

        {onUpdateDetails ? (
          <>
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
          </>
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
      {busy ? "Sending setup..." : label}
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
        headers: {
          "Content-Type": "text/plain;charset=UTF-8",
        },
        body: jsonBody,
      });

      return optimisticMakeResponse;
    } catch {
      if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
        const sent = navigator.sendBeacon(url, new Blob([jsonBody], { type: "text/plain;charset=UTF-8" }));
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
  const numberMissing = !assignedNumber;
  const [progress, setProgress] = useState(12);
  const [showNumber, setShowNumber] = useState(false);
  const [copiedNumber, setCopiedNumber] = useState(false);

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
              Setup milestone unlocked
            </p>
            <h1 className="mt-2 text-[clamp(2.1rem,8vw,4.6rem)] font-black leading-tight tracking-[-0.055em]">
              Thanks, {businessName}.
            </h1>
            <p className="mt-3 max-w-3xl text-base font-medium leading-7 text-blue-50 sm:text-xl sm:leading-8">
              {reviewRequired
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
                {assignedNumber && !reviewRequired ? (
                  <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-black uppercase tracking-[0.12em] text-emerald-700">
                    Ready
                  </span>
                ) : null}
              </div>
              {reviewRequired ? (
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
              <h2 className="text-xl font-black tracking-[-0.02em] text-slate-950">What happens next</h2>
              <div className="mt-5 space-y-3">
                {[
                  "Call your new number and hear the assistant answer.",
                  "Forward missed calls from your current business number.",
                  "Use the setup details to fine-tune the assistant.",
                ].map((item) => (
                  <div key={item} className="flex gap-3 rounded-2xl border border-slate-100 bg-slate-50/80 p-4 text-sm font-bold leading-6 text-slate-700">
                    <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-700">
                      <Icon name="check" className="h-4 w-4" />
                    </span>
                    <span>{item}</span>
                  </div>
                ))}
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
  const [businessSlide, setBusinessSlide] = useState(1);
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
  const businessSlideDisabled =
    currentStep === 1 &&
    ((businessSlide === 2 && selectedAreas.length === 0) || (businessSlide === 3 && !businessValidation.isValid));
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
  const specializationStepDisabled = selectedSpecializationIds.length === 0;
  const voiceStepDisabled = false;
  const securityStepDisabled = Boolean(CAPTCHA_PROVIDER && !captchaToken);

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

  const selectTradeAndAdvance = (tradeId) => {
    setSelectedTradeId(tradeId);
    setError("");
    if (returnToReviewAfterEdit) {
      setReturnToReviewAfterEdit(false);
      setBusinessSlide(5);
      return;
    }
    setBusinessSlide(2);
  };

  const editBusinessSlideFromReview = (slideNumber) => {
    setReturnToReviewAfterEdit(true);
    setError("");
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
      if (!SIGNUP_SUBMIT_URL) {
        throw new Error("Signup is not connected yet. Set REACT_APP_API_BASE_URL to your Make webhook URL and rebuild.");
      }

      const response = await postSignupPayload(SIGNUP_SUBMIT_URL, formData);

      const result = await parseApiResponse(response, "Signup handoff failed");
      if (!getSignupSuccess(result)) {
        throw new Error(result?.error || "Signup handoff failed.");
      }
      rememberBrowserSignupAttempt();
      setSignupResult({
        businessName: details.businessName.trim(),
        twilioPhoneNumber: getTwilioPhoneNumber(result),
        reviewRequired: Boolean(result?.reviewRequired),
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
        `}
      </style>
      <header className="hidden bg-[#020918] shadow-[0_24px_60px_-48px_rgba(15,23,42,0.85)]">
        <div className="mx-auto flex min-h-16 max-w-[1440px] items-center px-4 py-3 sm:px-12">
          <BrandLogo />
        </div>
      </header>

      <form onSubmit={submitSignup} className="mx-auto flex min-h-screen w-full max-w-[1680px] flex-col px-3 pb-5 pt-1 sm:px-6 lg:px-8">
        <section className="shrink-0 text-center">
          <h1 className="text-[clamp(1.65rem,3.8vw,2.55rem)] font-black leading-tight tracking-[-0.04em] text-slate-950">
            Create your AI phone assistant
          </h1>
          <p className="mt-0.5 text-base font-medium text-slate-600 sm:text-lg">Set up your business assistant in minutes.</p>

          <div className="mt-2 flex flex-wrap justify-center gap-x-8 gap-y-1.5">
            <Benefit icon="shield">Free for 14 days</Benefit>
            <Benefit icon="card">No credit card required</Benefit>
            <Benefit icon="refresh">Cancel anytime</Benefit>
          </div>

          <Stepper currentStep={currentStep} />
        </section>

        {currentStep === 1 ? (
          <section className="mt-2 flex flex-1 flex-col">
            <div className="flex flex-1 flex-col rounded-3xl border border-slate-200 bg-white/96 shadow-[0_34px_90px_-70px_rgba(15,23,42,0.8)]">
              <div className="border-b border-slate-100 bg-slate-50/70 px-4 py-4 sm:px-8">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-blue-600">Business setup</p>
                  <p className="text-xs font-black text-slate-400">{businessSlide} of 5</p>
                </div>
                <div className="mt-4 grid grid-cols-5 gap-3">
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
                          setError("");
                        }}
                        className={
                          "min-h-[58px] rounded-2xl border px-2 text-center text-[0.72rem] font-black uppercase tracking-[0.1em] transition sm:text-xs " +
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

              <div key={businessSlide} className="business-slide-window relative flex flex-1 p-5 sm:p-8 lg:p-10">
              {businessSlide === 1 ? (
                <section className="grid w-full gap-6 lg:grid-cols-[360px_minmax(0,1fr)] xl:grid-cols-[390px_minmax(0,1fr)] lg:items-stretch">
                  <div className="flex flex-col justify-center rounded-3xl border border-blue-100 bg-blue-50/70 p-8">
                    <p className="text-xs font-black uppercase tracking-[0.16em] text-blue-600">Step 1</p>
                    <h2 className="mt-2 text-[clamp(2rem,3vw,3.1rem)] font-black leading-tight tracking-[-0.04em] text-slate-950">Choose your trade</h2>
                    <p className="mt-4 text-lg font-medium leading-8 text-slate-600">Pick the type of business your AI assistant will answer for.</p>
                  </div>
                <div className="grid grid-cols-2 content-center gap-4 sm:grid-cols-3 xl:gap-5">
                  {TRADE_OPTIONS.map((trade) => (
                    <TradeCard
                      key={trade.id}
                      trade={trade}
                      selected={trade.id === selectedTradeId}
                      onClick={() => selectTradeAndAdvance(trade.id)}
                    />
                  ))}
                </div>
              </section>
              ) : null}

              {businessSlide === 2 ? (
              <section className="grid min-h-0 w-full gap-6 lg:grid-cols-[360px_minmax(0,1fr)] xl:grid-cols-[390px_minmax(0,1fr)] lg:items-stretch">
                <div className="flex flex-col justify-center rounded-3xl border border-blue-100 bg-blue-50/70 p-8">
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-blue-600">Step 2</p>
                  <h2 className="mt-2 text-[clamp(2rem,3vw,3.1rem)] font-black leading-tight tracking-[-0.04em] text-slate-950">Service area</h2>
                  <p className="mt-4 text-lg font-medium leading-8 text-slate-600">Select the Southern Ontario areas you serve.</p>
                </div>
                <div className="min-h-0 overflow-hidden rounded-3xl">
                  <div className="flex h-full max-h-[42vh] content-start items-start overflow-y-auto pr-2 pb-2 [scrollbar-width:thin] sm:max-h-[46vh] lg:max-h-full">
                    <div className="flex flex-wrap content-start items-start gap-3 xl:gap-4">
                      {AREA_OPTIONS.map((area) => (
                        <AreaChip key={area} area={area} selected={selectedAreas.includes(area)} onClick={() => toggleArea(area)} />
                      ))}
                      <button
                        type="button"
                        onClick={() => setBusinessSlide(1)}
                        className="min-h-[54px] min-w-[160px] rounded-2xl border border-slate-200 bg-white px-6 py-3 text-base font-bold text-slate-600 transition hover:border-blue-300 hover:text-blue-600 sm:text-lg"
                      >
                        Back
                      </button>
                      <button
                        type="submit"
                        disabled={businessSlideDisabled || busy}
                        className={
                          "inline-flex min-h-[54px] min-w-[260px] items-center justify-center gap-3 rounded-2xl px-6 py-3 text-base font-black text-white transition sm:text-lg " +
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
              <section className="grid w-full gap-6 lg:grid-cols-[360px_minmax(0,1fr)] xl:grid-cols-[390px_minmax(0,1fr)] lg:items-stretch">
                <div className="flex flex-col justify-center rounded-3xl border border-blue-100 bg-blue-50/70 p-8">
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-blue-600">Step 3</p>
                  <h2 className="mt-2 text-[clamp(2rem,3vw,3.1rem)] font-black leading-tight tracking-[-0.04em] text-slate-950">Business details</h2>
                  <p className="mt-4 text-lg font-medium leading-8 text-slate-600">Enter real, complete business details. These are required before you can continue.</p>
                  <p className="mt-4 text-sm font-semibold leading-6 text-slate-500">Street address, city, province, and postal code help us serve your callers better.</p>
                </div>
                <div className="grid content-start gap-4 sm:grid-cols-2 xl:grid-cols-4 xl:gap-5">
                  <LabeledInput
                    label="Business owner's name"
                    icon="user"
                    value={details.ownerName}
                    onChange={updateDetails("ownerName")}
                    onBlur={markDetailTouched("ownerName")}
                    placeholder="e.g., Jamie Smith"
                    error={getBusinessFieldError("ownerName")}
                  />
                  <LabeledInput
                    label="Business name"
                    icon="briefcase"
                    value={details.businessName}
                    onChange={updateDetails("businessName")}
                    onBlur={markDetailTouched("businessName")}
                    placeholder={`e.g., ${selectedTrade.label === "Electrician" ? "Smith Electrical Services" : `${selectedTrade.label} Services`}`}
                    error={getBusinessFieldError("businessName")}
                  />
                  <LabeledInput
                    label="Business phone number"
                    icon="phone"
                    value={details.phone}
                    onChange={updateDetails("phone")}
                    onBlur={markDetailTouched("phone")}
                    placeholder="(416) 555-1234"
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
                    error={getBusinessFieldError("email")}
                  />
                  <LabeledInput
                    className="sm:col-span-2 lg:col-span-2"
                    label="Street address"
                    icon="pin"
                    value={details.streetAddress}
                    onChange={updateDetails("streetAddress")}
                    onBlur={markDetailTouched("streetAddress")}
                    placeholder="123 Main St"
                    error={getBusinessFieldError("streetAddress")}
                  />
                  <LabeledInput
                    label="City"
                    icon="pin"
                    value={details.city}
                    onChange={updateDetails("city")}
                    onBlur={markDetailTouched("city")}
                    placeholder="Toronto"
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
                    error={getBusinessFieldError("postalCode")}
                  />
                  <button
                    type="button"
                    onClick={() => setBusinessSlide(2)}
                    className="mt-auto flex min-h-[54px] items-center justify-center rounded-xl border border-slate-200 bg-white px-5 text-base font-bold text-slate-600 transition hover:border-blue-300 hover:text-blue-600"
                  >
                    Back
                  </button>
                  <button
                    type="submit"
                    disabled={businessSlideDisabled || busy}
                    className={
                      "mt-auto inline-flex min-h-[54px] items-center justify-center gap-3 rounded-2xl px-6 text-base font-black text-white transition sm:text-lg xl:col-span-2 " +
                      (businessSlideDisabled || busy
                        ? "cursor-not-allowed bg-slate-300"
                        : "bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 shadow-[0_16px_42px_-28px_rgba(79,70,229,0.95)] hover:-translate-y-0.5 hover:brightness-110")
                    }
                  >
                    {busy ? "Saving..." : businessSlideLabel}
                    <Icon name="arrow" className="h-5 w-5" />
                  </button>
                </div>
              </section>
              ) : null}

              {businessSlide === 4 ? (
                <section className="grid w-full gap-6 lg:grid-cols-[360px_minmax(0,1fr)] xl:grid-cols-[390px_minmax(0,1fr)] lg:items-stretch">
                  <div className="flex flex-col justify-center rounded-3xl border border-blue-100 bg-blue-50/70 p-8">
                    <p className="text-xs font-black uppercase tracking-[0.16em] text-blue-600">Step 4</p>
                    <h2 className="mt-2 text-[clamp(2rem,3vw,3.1rem)] font-black leading-tight tracking-[-0.04em] text-slate-950">Pricing script</h2>
                    <p className="mt-4 text-lg font-medium leading-8 text-slate-600">Set the simple prices your assistant should explain before booking.</p>
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
                </section>
              ) : null}

              {businessSlide === 5 ? (
                <section className="grid w-full gap-6 lg:grid-cols-[360px_minmax(0,1fr)] xl:grid-cols-[390px_minmax(0,1fr)] lg:items-stretch">
                  <div className="flex flex-col justify-center rounded-3xl border border-blue-100 bg-blue-50/70 p-8">
                    <p className="text-xs font-black uppercase tracking-[0.16em] text-blue-600">Step 5</p>
                    <h2 className="mt-2 text-[clamp(2rem,3vw,3.1rem)] font-black leading-tight tracking-[-0.04em] text-slate-950">Review</h2>
                    <p className="mt-4 text-lg font-medium leading-8 text-slate-600">Check the details before continuing. Use Back or the top columns to change anything.</p>
                  </div>
                  <div className="content-center">
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
                <div className="border-t border-slate-100 bg-slate-50/80 px-5 py-4 sm:px-8">
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
          <VoiceDemoStep agent={selectedAgent} />
        ) : null}

        {currentStep === 3 ? (
          <section className="mt-5">
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

        <div className="shrink-0 pt-3">
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

          <div className="mt-1 flex items-center justify-center gap-2 text-center text-sm font-medium text-slate-500 sm:text-base">
            <Icon name="lock" className="h-4 w-4" />
            Your data is secure and will never be shared.
          </div>
        </div>

        {error ? <p className="mt-4 text-center text-sm font-semibold text-rose-600">{error}</p> : null}
        {status ? <p className="mt-4 text-center text-sm font-semibold text-emerald-600">{status}</p> : null}
      </form>
    </main>
  );
}
