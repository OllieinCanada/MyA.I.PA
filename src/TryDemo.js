import React, { useMemo, useState } from "react";

import { VoiceDemoStep } from "./Signup";
import {
  AREA_OPTIONS,
  ASSISTANT_AGENT,
  TRADE_OPTIONS,
} from "./features/signup/signupConfig";

function DemoMark() {
  return (
    <span className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-blue-600 to-violet-600 text-white shadow-[0_18px_36px_-20px_rgba(37,99,235,0.9)]">
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M5 4h3l2 5-2 2a16 16 0 0 0 5 5l2-2 5 2v3a2 2 0 0 1-2 2C9.7 20.4 3.6 14.3 3 6a2 2 0 0 1 2-2Z" />
      </svg>
    </span>
  );
}

function FieldLabel({ number, children }) {
  return (
    <div className="flex items-center gap-3">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-blue-600 text-xs font-black text-white">
        {number}
      </span>
      <span className="text-base font-black text-slate-950">{children}</span>
    </div>
  );
}

export default function TryDemo() {
  const [stage, setStage] = useState("questions");
  const [tradeId, setTradeId] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [serviceArea, setServiceArea] = useState("");
  const [error, setError] = useState("");

  const selectedTrade = useMemo(
    () => TRADE_OPTIONS.find((trade) => trade.id === tradeId) || null,
    [tradeId]
  );

  const openDemo = (event) => {
    event.preventDefault();
    const safeBusinessName = businessName.trim();
    const safeServiceArea = serviceArea.trim();
    if (!selectedTrade || !safeBusinessName || !safeServiceArea) {
      setError("Choose your trade and add your business name and service area.");
      return;
    }
    setBusinessName(safeBusinessName);
    setServiceArea(safeServiceArea);
    setError("");
    setStage("call");
    window.scrollTo?.({ top: 0, behavior: "smooth" });
  };

  return (
    <main className="min-h-screen bg-[linear-gradient(135deg,#f8fbff_0%,#ffffff_45%,#edf4ff_100%)] px-3 py-4 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-[1440px]">
        <header className="flex items-center justify-between gap-4">
          <a href="./#/" className="inline-flex items-center gap-3 text-slate-950 no-underline" aria-label="My AI PA home">
            <DemoMark />
            <span className="text-base font-black tracking-[-0.025em]">
              MY <span className="text-blue-600">AI PA</span>
            </span>
          </a>
          <a
            href="./#/signup"
            className="rounded-full border border-blue-100 bg-white/85 px-4 py-2 text-sm font-black text-blue-700 no-underline shadow-sm transition hover:border-blue-300 hover:bg-blue-50"
          >
            Start free trial
          </a>
        </header>

        {stage === "questions" ? (
          <section className="mx-auto max-w-5xl pb-12 pt-8 sm:pt-14" aria-labelledby="demo-title">
            <div className="text-center">
              <div className="inline-flex items-center gap-2 rounded-full border border-blue-100 bg-blue-50/80 px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-blue-700">
                30-second live voice demo
              </div>
              <h1 id="demo-title" className="mx-auto mt-5 max-w-4xl text-[clamp(2.35rem,6vw,5rem)] font-black leading-[0.98] tracking-[-0.055em] text-slate-950">
                Hear My AI PA answer for your business.
              </h1>
              <p className="mx-auto mt-5 max-w-2xl text-lg font-medium leading-8 text-slate-600">
                Answer three quick questions. Then have a real conversation with your personalized AI phone assistant.
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm font-bold text-slate-500">
                <span>✓ No phone number needed</span>
                <span>✓ No email needed</span>
                <span>✓ No payment</span>
              </div>
            </div>

            <form
              onSubmit={openDemo}
              className="mt-8 overflow-hidden rounded-[2rem] border border-slate-200 bg-white/95 shadow-[0_34px_90px_-62px_rgba(15,23,42,0.65)]"
            >
              <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/70 px-5 py-4 sm:px-8">
                <p className="text-xs font-black uppercase tracking-[0.16em] text-blue-600">Make it yours</p>
                <p className="text-xs font-black text-slate-400">1 of 2</p>
              </div>

              <div className="grid gap-8 p-5 sm:p-8 lg:p-10">
                <fieldset>
                  <legend className="sr-only">Choose your trade</legend>
                  <FieldLabel number="1">What kind of work do you do?</FieldLabel>
                  <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                    {TRADE_OPTIONS.map((trade) => {
                      const selected = trade.id === tradeId;
                      return (
                        <button
                          key={trade.id}
                          type="button"
                          onClick={() => {
                            setTradeId(trade.id);
                            setError("");
                          }}
                          className={
                            "min-h-[84px] rounded-2xl border px-3 py-4 text-left transition " +
                            (selected
                              ? "border-blue-600 bg-blue-600 text-white shadow-[0_18px_36px_-24px_rgba(37,99,235,0.9)]"
                              : "border-slate-200 bg-white text-slate-800 hover:border-blue-300 hover:bg-blue-50")
                          }
                          aria-pressed={selected}
                        >
                          <span className={"block text-[0.65rem] font-black uppercase tracking-[0.12em] " + (selected ? "text-blue-100" : "text-blue-600")}>
                            Trade
                          </span>
                          <span className="mt-2 block text-sm font-black leading-tight">{trade.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </fieldset>

                <div className="grid gap-6 md:grid-cols-2">
                  <label className="grid gap-3">
                    <FieldLabel number="2">What is your business called?</FieldLabel>
                    <input
                      type="text"
                      value={businessName}
                      onChange={(event) => {
                        setBusinessName(event.target.value);
                        setError("");
                      }}
                      maxLength={80}
                      autoComplete="organization"
                      placeholder="e.g., Dan's Electrical"
                      className="min-h-[58px] rounded-2xl border border-slate-200 bg-slate-50/60 px-5 text-base font-bold text-slate-950 outline-none transition placeholder:font-medium placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-100"
                    />
                  </label>

                  <label className="grid gap-3">
                    <FieldLabel number="3">What city or area do you serve?</FieldLabel>
                    <input
                      type="text"
                      list="demo-service-areas"
                      value={serviceArea}
                      onChange={(event) => {
                        setServiceArea(event.target.value);
                        setError("");
                      }}
                      maxLength={60}
                      autoComplete="address-level2"
                      placeholder="e.g., Hamilton"
                      className="min-h-[58px] rounded-2xl border border-slate-200 bg-slate-50/60 px-5 text-base font-bold text-slate-950 outline-none transition placeholder:font-medium placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-100"
                    />
                    <datalist id="demo-service-areas">
                      {AREA_OPTIONS.map((area) => <option key={area} value={area} />)}
                    </datalist>
                  </label>
                </div>

                {error ? (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm font-bold text-amber-900" role="alert">
                    {error}
                  </div>
                ) : null}

                <div className="grid gap-4 border-t border-slate-100 pt-6 sm:grid-cols-[1fr_auto] sm:items-center">
                  <p className="text-sm font-semibold leading-6 text-slate-500">
                    Your answers personalize this demo only. The 30-second call is not recorded.
                  </p>
                  <button
                    type="submit"
                    className="inline-flex min-h-[58px] items-center justify-center gap-3 rounded-2xl bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 px-7 text-base font-black text-white shadow-[0_20px_44px_-28px_rgba(79,70,229,0.95)] transition hover:-translate-y-0.5 hover:brightness-110"
                  >
                    Create my live demo
                    <span aria-hidden="true">→</span>
                  </button>
                </div>
              </div>
            </form>
          </section>
        ) : (
          <section className="pb-12 pt-3">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-blue-600">Try the demo</p>
                <h1 className="mt-1 text-[clamp(1.8rem,4vw,3.35rem)] font-black tracking-[-0.045em] text-slate-950">
                  Your assistant is ready.
                </h1>
              </div>
              <button
                type="button"
                onClick={() => {
                  setStage("questions");
                  window.scrollTo?.({ top: 0, behavior: "smooth" });
                }}
                className="rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-black text-slate-600 transition hover:border-blue-300 hover:text-blue-700"
              >
                Change answers
              </button>
            </div>

            <VoiceDemoStep
              agent={ASSISTANT_AGENT}
              businessName={businessName}
              trade={selectedTrade}
              areas={[serviceArea]}
              standalone
            />

            <div className="mt-6 grid gap-5 rounded-3xl border border-blue-100 bg-gradient-to-r from-blue-600 to-violet-600 p-6 text-white shadow-[0_28px_60px_-38px_rgba(37,99,235,0.95)] sm:grid-cols-[1fr_auto] sm:items-center sm:p-8">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-blue-100">Like what you heard?</p>
                <h2 className="mt-2 text-2xl font-black tracking-[-0.03em]">Set up your complete assistant free for 14 days.</h2>
                <p className="mt-2 text-sm font-semibold text-blue-100">No credit card required. Cancel anytime.</p>
              </div>
              <a
                href="./#/signup"
                className="inline-flex min-h-[56px] items-center justify-center rounded-2xl bg-white px-7 text-base font-black text-blue-700 no-underline transition hover:-translate-y-0.5 hover:bg-blue-50"
              >
                Start free trial
              </a>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
