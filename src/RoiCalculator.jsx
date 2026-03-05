import React, { useState } from "react";

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const toNumber = (value) => {
  if (value === "" || value === "-") return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const formatCurrency = (value) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Math.round(value || 0));

const formatNumber = (value, digits = 1) =>
  new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
  }).format(value || 0);

function InputCard({
  title,
  note,
  value,
  onChange,
  onBlur,
  min,
  max,
  step,
  prefix,
  ariaLabel,
  titleClassName = "",
}) {
  const numericValue = clamp(toNumber(value), min, max);
  const stepNum = Number(step) || 1;
  const nudge = (delta) => {
    const next = clamp(numericValue + delta, min, max);
    onChange(String(next));
  };

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-7 shadow-[0_20px_46px_-32px_rgba(15,23,42,0.35)]">
      <div className="flex items-start justify-between gap-6">
        <div>
          <div className={"text-lg font-extrabold text-slate-900 " + titleClassName}>{title}</div>
          {note && <div className="mt-1 text-sm font-semibold text-emerald-700">{note}</div>}
        </div>

        <div className="flex items-center gap-2">
          {prefix && <span className="text-sm font-bold text-slate-500">{prefix}</span>}
          <div className="flex flex-col items-center gap-4">
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              min={min}
              max={max}
              step={step}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onBlur={onBlur}
              aria-label={ariaLabel}
              className="h-10 w-28 min-w-[92px] rounded-2xl border border-slate-200 bg-white px-2 text-center text-lg font-extrabold text-slate-900 outline-none"
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label={`Decrease ${ariaLabel}`}
                onClick={() => nudge(-stepNum)}
                className="grid h-9 w-9 place-items-center rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100 hover:bg-emerald-100"
              >
                ◀
              </button>
              <button
                type="button"
                aria-label={`Increase ${ariaLabel}`}
                onClick={() => nudge(stepNum)}
                className="grid h-9 w-9 place-items-center rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100 hover:bg-emerald-100"
              >
                ▶
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-5">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={numericValue}
          onChange={(e) => onChange(e.target.value)}
          aria-label={ariaLabel + " slider"}
          className="h-2.5 w-full cursor-pointer accent-emerald-500"
        />
      </div>
    </div>
  );
}

export function RoiCalculatorResults({
  estimatedJobsLostPerMonth,
  displayRevenuePerMonth,
  pulse,
  className = "",
}) {
  return (
    <aside
      className={
        "rounded-[32px] border border-slate-200 bg-white p-6 shadow-[0_18px_50px_-40px_rgba(15,23,42,0.35)] " +
        className
      }
    >
      <div className="text-sm font-extrabold text-emerald-900">Results</div>

      <div className="mt-5 grid gap-4">
        <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Est. jobs missed / month</div>
          <div className="mt-2 text-4xl font-black text-slate-900">
            {formatNumber(estimatedJobsLostPerMonth, 1)}
          </div>
        </div>

        <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Est. revenue lost / month</div>
          <div className="mt-2 text-4xl font-black text-slate-900">
            {formatCurrency(displayRevenuePerMonth)}
          </div>
        </div>

        <div
          className={
            "rounded-2xl bg-emerald-900 p-4 text-white shadow-[0_18px_40px_-32px_rgba(15,23,42,0.65)] transition " +
            (pulse ? "ring-2 ring-emerald-300/70 shadow-[0_0_24px_rgba(16,185,129,0.35)]" : "")
          }
        >
          <div className="text-xs font-semibold uppercase tracking-wide text-emerald-100">My AI PA could recover</div>
          <div className="mt-2 text-4xl font-black">{formatCurrency(displayRevenuePerMonth)} / month</div>
        </div>
      </div>

      
    </aside>
  );
}

export default function RoiCalculator({
  missedCallsPerWeek,
  setMissedCallsPerWeek,
  avgRevenuePerJob,
  setAvgRevenuePerJob,
  bookingRate,
  setBookingRate,
  className = "",
}) {
  const [localMissedCalls, setLocalMissedCalls] = useState("6");
  const [localAvgRevenue, setLocalAvgRevenue] = useState("2550");
  const [localBookingRate, setLocalBookingRate] = useState("35");
  const [selectedIndustry, setSelectedIndustry] = useState("custom");

  const missedCallsValue = missedCallsPerWeek !== undefined ? missedCallsPerWeek : localMissedCalls;
  const avgRevenueValue = avgRevenuePerJob !== undefined ? avgRevenuePerJob : localAvgRevenue;
  const bookingRateValue = bookingRate !== undefined ? bookingRate : localBookingRate;

  const setMissedCallsValue = setMissedCallsPerWeek ?? setLocalMissedCalls;
  const setAvgRevenueValue = setAvgRevenuePerJob ?? setLocalAvgRevenue;
  const setBookingRateValue = setBookingRate ?? setLocalBookingRate;

  const missedCallsNum = clamp(toNumber(missedCallsValue), 0, 50);
  const avgRevenueNum = clamp(toNumber(avgRevenueValue), 0, 5000);
  const bookingRateNum = clamp(toNumber(bookingRateValue), 0, 100);
  const bookingOptions = [
    { label: "Rarely", value: 15, desc: "A few lost calls here and there." },
    { label: "Sometimes", value: 30, desc: "A recurring issue, not constant." },
    { label: "Often", value: 45, desc: "Missed calls regularly cost jobs." },
    { label: "Always", value: 60, desc: "This is a constant problem." },
  ];
  const industryPresets = [
    {
      key: "home_services",
      label: "Home Services",
      avgRevenuePerJob: 400,
      bookingRate: 45,
    },
    {
      key: "hvac",
      label: "HVAC",
      avgRevenuePerJob: 400,
      bookingRate: 45,
    },
    {
      key: "plumbing",
      label: "Plumbing",
      avgRevenuePerJob: 400,
      bookingRate: 45,
    },
    {
      key: "roofing",
      label: "Roofing",
      avgRevenuePerJob: 400,
      bookingRate: 45,
    },
  ];
  const snapBookingRate = (value) =>
    bookingOptions.reduce((closest, opt) =>
      Math.abs(opt.value - value) < Math.abs(closest.value - value) ? opt : closest
    ).value;
  const applyPreset = (preset) => {
    if (!preset) {
      setSelectedIndustry("custom");
      return;
    }
    setSelectedIndustry(preset.key);
    if (preset.missedCallsPerWeek !== undefined) {
      setMissedCallsValue(String(preset.missedCallsPerWeek));
    }
    if (preset.avgRevenuePerJob !== undefined) {
      setAvgRevenueValue(String(preset.avgRevenuePerJob));
    }
    if (preset.bookingRate !== undefined) {
      setBookingRateValue(String(snapBookingRate(preset.bookingRate)));
    }
  };

  return (
    <section
      className={
        "w-full rounded-[44px] bg-rose-50/70 p-10 ring-1 ring-rose-100 shadow-[0_26px_70px_-50px_rgba(15,23,42,0.3)] lg:min-h-[780px] " +
        className
      }
    >
      <div>
        <h3 className="text-4xl font-black tracking-tight text-slate-900 sm:text-5xl">
          Missed Calls Cost You Money.
        </h3>
        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => applyPreset(null)}
            className={
              "rounded-full border px-4 py-2 text-sm font-bold shadow-sm transition " +
              (selectedIndustry === "custom"
                ? "border-emerald-400 bg-emerald-100 text-emerald-900 shadow-[0_8px_20px_-14px_rgba(16,185,129,0.7)]"
                : "border-slate-200 bg-white text-slate-600 hover:border-emerald-200 hover:bg-emerald-50/60")
            }
          >
            Custom
          </button>
          {industryPresets.map((preset) => (
            <button
              key={preset.key}
              type="button"
              onClick={() => applyPreset(preset)}
              className={
                "rounded-full border px-4 py-2 text-sm font-bold shadow-sm transition " +
                (selectedIndustry === preset.key
                  ? "border-emerald-400 bg-emerald-100 text-emerald-900 shadow-[0_8px_20px_-14px_rgba(16,185,129,0.7)]"
                  : "border-slate-200 bg-white text-slate-600 hover:border-emerald-200 hover:bg-emerald-50/60")
              }
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div className="mt-3 inline-flex items-center rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-900 ring-1 ring-emerald-200">
          Canada-based vendor estimates (home services). Adjust to match your business.
        </div>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <InputCard
          title="Missed calls"
          value={missedCallsValue}
          onChange={setMissedCallsValue}
          onBlur={() => setMissedCallsValue(String(missedCallsNum))}
          min={0}
          max={50}
          step={1}
          ariaLabel="Missed calls per week"
        />
        <InputCard
          title="Average revenue per job"
          titleClassName="text-base font-semibold text-slate-600"
          value={avgRevenueValue}
          onChange={setAvgRevenueValue}
          onBlur={() => setAvgRevenueValue(String(avgRevenueNum))}
          min={0}
          max={5000}
          step={50}
          prefix="$"
          ariaLabel="Average revenue per job"
        />
        <div className="lg:col-span-2">
          <div className="rounded-3xl border border-slate-200 bg-white p-7 shadow-[0_20px_46px_-32px_rgba(15,23,42,0.35)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-lg font-extrabold text-slate-900">How often is this a problem?</div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-base font-extrabold text-slate-900">
                {bookingRateNum}%
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {bookingOptions.map((opt) => {
                const isActive = bookingRateNum === opt.value;
                return (
                  <button
                    key={opt.label}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => setBookingRateValue(String(opt.value))}
                    className={
                      "rounded-2xl border px-4 py-4 text-left text-sm font-semibold transition " +
                      (isActive
                        ? "border-emerald-400 bg-emerald-50 text-emerald-900 shadow-[0_8px_24px_-16px_rgba(16,185,129,0.6)]"
                        : "border-slate-200 bg-white text-slate-700 hover:border-emerald-200 hover:bg-emerald-50/60")
                    }
                  >
                    <div className="text-base font-extrabold">{opt.label}</div>
                    <div className="mt-1 text-xs font-semibold text-slate-500 leading-5">{opt.desc}</div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
