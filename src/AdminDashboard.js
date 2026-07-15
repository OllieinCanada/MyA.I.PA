import React, { useEffect, useMemo, useState } from "react";
import "./AdminDashboard.css";
import { getApiBaseUrl, normalizeApiBase } from "./config/apiBase";

const CONFIGURED_API_BASE = process.env.REACT_APP_API_BASE_URL || "";
const API_BASE = normalizeApiBase(getApiBaseUrl(CONFIGURED_API_BASE));
const API_SOURCE_LABEL = /localhost|127\.0\.0\.1/i.test(API_BASE) ? "Local API" : "Live Render API";
const ADMIN_API_TIMEOUT_MS = 6500;
const ADMIN_PASSWORD_SESSION_KEY = "myaipa_admin_password";

function getStoredAdminPassword() {
  try {
    return window.sessionStorage.getItem(ADMIN_PASSWORD_SESSION_KEY) || "";
  } catch (_err) {
    return "";
  }
}

function setStoredAdminPassword(value) {
  try {
    if (value) window.sessionStorage.setItem(ADMIN_PASSWORD_SESSION_KEY, value);
    else window.sessionStorage.removeItem(ADMIN_PASSWORD_SESSION_KEY);
  } catch (_err) {
    // Session storage can be unavailable in strict browser modes. The cookie/header login still works for the current request.
  }
}

async function api(path, { method = "GET", body } = {}) {
  const headers = { "Content-Type": "application/json" };
  const storedAdminPassword = getStoredAdminPassword();
  if (storedAdminPassword) headers["X-Admin-Password"] = storedAdminPassword;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ADMIN_API_TIMEOUT_MS);

  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      credentials: "include",
      signal: controller.signal,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch (_e) {
      data = { error: text || `HTTP ${res.status}` };
    }
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  } catch (err) {
    if (err?.name === "AbortError") {
      throw new Error("Admin request timed out. Check DATABASE_URL and backend service health.");
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

function dt(value) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString();
}

function daysText(value) {
  if (value == null) return "—";
  if (value < 0) return `${Math.abs(value)}d overdue`;
  if (value === 0) return "Ends today";
  return `${value}d left`;
}

function expiryClasses(color) {
  if (color === "green") return "border-emerald-300/30 bg-emerald-300/15 text-emerald-100";
  if (color === "yellow") return "border-amber-300/35 bg-amber-300/15 text-amber-100";
  if (color === "red") return "border-rose-300/35 bg-rose-300/15 text-rose-100";
  return "border-white/15 bg-white/5 text-white/60";
}

function statusClasses(ok) {
  return ok
    ? "border-emerald-300/30 bg-emerald-300/15 text-emerald-100"
    : "border-amber-300/35 bg-amber-300/15 text-amber-100";
}

function simpleStatusClasses(status) {
  if (status === "Ready") return "border-emerald-300/30 bg-emerald-300/15 text-emerald-100";
  if (status === "Problem") return "border-rose-300/35 bg-rose-300/15 text-rose-100";
  if (status === "Needs Setup") return "border-amber-300/35 bg-amber-300/15 text-amber-100";
  return "border-white/15 bg-white/5 text-white/65";
}

function setupStatusClasses(status) {
  if (status === "done" || status === "ready") return "border-emerald-300/30 bg-emerald-300/15 text-emerald-100";
  if (status === "failed" || status === "blocked") return "border-rose-300/35 bg-rose-300/15 text-rose-100";
  if (status === "manual") return "border-blue-300/30 bg-blue-300/15 text-blue-100";
  return "border-amber-300/35 bg-amber-300/15 text-amber-100";
}

function setupStatusLabel(status) {
  if (status === "done") return "Done";
  if (status === "failed") return "Failed";
  if (status === "manual") return "Manual";
  if (status === "ready") return "Ready";
  if (status === "blocked") return "Blocked";
  return "Waiting";
}

function fixItemClasses(status) {
  if (status === "Problem") return "border-rose-300/35 bg-rose-300/15 text-rose-100";
  if (status === "Ready") return "border-emerald-300/30 bg-emerald-300/15 text-emerald-100";
  return "border-amber-300/35 bg-amber-300/15 text-amber-100";
}

function yesNo(value) {
  return value ? "Ready" : "Needs setup";
}

function readinessColor(ok) {
  return ok ? "bg-emerald-300 text-emerald-950" : "bg-amber-300 text-amber-950";
}

function intervalText(ms) {
  const minutes = Math.round(Number(ms || 0) / 60000);
  if (!minutes) return "—";
  if (minutes < 60) return `${minutes} min`;
  return `${Math.round(minutes / 60)} hr`;
}

function money(value, currency = "USD") {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n === 0) return "—";
  return `${currency || "USD"} $${n.toFixed(4)}`;
}

function moneyCompact(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n === 0) return "$0.00";
  return `$${n.toFixed(n < 10 ? 4 : 2)}`;
}

const DEFAULT_MONTHLY_REVENUE_USD = Number(process.env.REACT_APP_MONTHLY_PRICE_USD || process.env.REACT_APP_SUBSCRIPTION_PRICE_USD || 79) || 79;
const EMPTY_STRIPE_TRIALS = {
  configured: false,
  fetchedAt: "",
  mode: "",
  account: null,
  totals: {
    subscriptionsAllStatuses: 0,
    statusCounts: {},
    activeTrialCount: 0,
    trialRelatedCount: 0,
    endingSoonWithin3DaysCount: 0,
    recentlyEndedTrialCountLast30Days: 0,
  },
  activeTrials: [],
  recentlyEndedTrialsLast30Days: [],
  warnings: [],
};

function moneyDashboard(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return "$0.00";
  const safe = Object.is(n, -0) ? 0 : n;
  const formatted = Math.abs(safe).toFixed(Math.abs(safe) < 10 ? 2 : 0);
  return safe < 0 ? `-$${formatted}` : `$${formatted}`;
}

function moneyFromCents(value, currency = "CAD", interval = "") {
  const cents = Number(value);
  if (!Number.isFinite(cents) || cents <= 0) return "—";
  const amount = cents / 100;
  const label = `${amount.toLocaleString(undefined, { style: "currency", currency: currency || "CAD" })}`;
  return interval ? `${label}/${interval}` : label;
}

function percentDashboard(value) {
  if (value == null || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${Math.round(n)}%`;
}

function maybeCentsToDollars(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n > 1000 ? n / 100 : n;
}

function signupRevenueAmount(signup) {
  if (!signup) return 0;
  return (
    maybeCentsToDollars(signup.monthlyRevenue) ||
    maybeCentsToDollars(signup.subscriptionAmount) ||
    maybeCentsToDollars(signup.amountMonthly) ||
    maybeCentsToDollars(signup.priceAmount) ||
    maybeCentsToDollars(signup.amountTotal) ||
    maybeCentsToDollars(signup.amount)
  );
}

function paymentStateForAccount(account) {
  const raw = [
    account?.subscriptionStatus,
    account?.signup?.subscriptionStatus,
    account?.signup?.paymentStatus,
    account?.signup?.checkoutStatus,
    account?.signup?.status,
    account?.trial?.subscriptionStatus,
  ].filter(Boolean).join(" ").toLowerCase();

  if (/past_due|unpaid|failed|cancelled|canceled|expired|rejected|error/.test(raw)) {
    return { key: "problem", label: "Problem" };
  }
  if (/\bactive\b|\bpaid\b|subscription_active/.test(raw)) {
    return { key: "paying", label: "Paying" };
  }
  if (/trial|checkout_completed|setup_started|subscription_trialing/.test(raw) || account?.trial?.expiry) {
    return { key: "trialing", label: "Trialing" };
  }
  if (/checkout|pending|open|incomplete|requires|not linked|signup/.test(raw)) {
    return { key: "pending", label: "Pending" };
  }
  return { key: "unknown", label: "Unknown" };
}

function paymentBadgeClass(key) {
  if (key === "paying") return "admin-money-badge admin-money-badge-good";
  if (key === "trialing") return "admin-money-badge admin-money-badge-info";
  if (key === "problem") return "admin-money-badge admin-money-badge-bad";
  return "admin-money-badge admin-money-badge-warn";
}

function stripeStatusBadgeClass(status, expiryColor) {
  const value = String(status || "").toLowerCase();
  if (value === "active") return "admin-money-badge admin-money-badge-good";
  if (value === "trialing" && expiryColor === "red") return "admin-money-badge admin-money-badge-bad";
  if (value === "trialing") return "admin-money-badge admin-money-badge-info";
  if (/past_due|unpaid|incomplete|canceled|cancelled/.test(value)) return "admin-money-badge admin-money-badge-bad";
  return "admin-money-badge admin-money-badge-warn";
}

function customerHealthTone(score, issues = []) {
  if (score >= 85 && !issues.length) return "good";
  if (score >= 70) return "watch";
  if (score >= 50) return "warn";
  return "bad";
}

function customerHealthLabel(score, issues = []) {
  if (score >= 85 && !issues.length) return "Healthy";
  if (score >= 70) return "Watch";
  if (score >= 50) return "Needs Work";
  return "Critical";
}

function callOutcomeBadgeClass(outcome) {
  const value = String(outcome || "UNREVIEWED").toUpperCase();
  if (value === "BOOKED") return "admin-call-badge admin-call-badge-good";
  if (value === "EMERGENCY" || value === "QUOTE_NEEDED" || value === "FOLLOW_UP") return "admin-call-badge admin-call-badge-warn";
  if (value === "SPAM" || value === "NOT_A_LEAD") return "admin-call-badge admin-call-badge-muted";
  return "admin-call-badge admin-call-badge-info";
}

function callStatusBadgeClass(status) {
  const value = String(status || "").toUpperCase();
  if (value === "COMPLETED") return "admin-call-badge admin-call-badge-good";
  if (value === "MISSED" || value === "FAILED") return "admin-call-badge admin-call-badge-bad";
  return "admin-call-badge admin-call-badge-info";
}

function friendlyCallStatus(status) {
  const labels = {
    STARTED: "In progress",
    COMPLETED: "Completed",
    MISSED: "Missed",
    FAILED: "Failed",
  };
  const value = String(status || "").toUpperCase();
  return labels[value] || "Unknown";
}

function friendlyCallOutcome(outcome) {
  const labels = {
    UNREVIEWED: "Waiting for review",
    BOOKED: "Job booked",
    QUOTE_NEEDED: "Quote needed",
    EMERGENCY: "Emergency",
    SPAM: "Spam",
    FOLLOW_UP: "Follow-up due",
    NOT_A_LEAD: "Not a lead",
  };
  const value = String(outcome || "UNREVIEWED").toUpperCase();
  return labels[value] || "Waiting for review";
}

function friendlyConnectionWarning(warning) {
  const text = String(warning || "");
  if (/DATABASE_URL|database|postgres/i.test(text)) {
    return {
      title: "Business records are not connected",
      detail: "Connect the database so customer, call, and billing records can be saved reliably.",
      actionLabel: "Connections",
      actionTab: "sync",
    };
  }
  if (/twilio/i.test(text)) {
    return {
      title: "Twilio is not connected",
      detail: "Phone-number, text-message, and call-cost information cannot update yet.",
      actionLabel: "Connections",
      actionTab: "sync",
    };
  }
  if (/vapi|VAPI_API_KEY/i.test(text)) {
    return {
      title: "Vapi is not connected",
      detail: "AI call activity, recordings, transcripts, and call costs cannot update yet.",
      actionLabel: "Connections",
      actionTab: "sync",
    };
  }
  if (/stripe/i.test(text)) {
    return {
      title: "Stripe needs attention",
      detail: "Payment and trial information cannot update until the billing connection is ready.",
      actionLabel: "Billing",
      actionTab: "costs",
    };
  }
  return {
    title: "A service connection needs attention",
    detail: text || "Open Connections to see what still needs to be completed.",
    actionLabel: "Connections",
    actionTab: "sync",
  };
}

function callDurationText(seconds) {
  const n = Number(seconds || 0);
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n < 60) return `${Math.round(n)}s`;
  const mins = Math.floor(n / 60);
  const secs = Math.round(n % 60);
  return secs ? `${mins}m ${secs}s` : `${mins}m`;
}

function callScoreClass(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return "admin-call-score";
  if (n >= 80) return "admin-call-score is-good";
  if (n >= 55) return "admin-call-score is-warn";
  return "admin-call-score is-bad";
}

function textKey(value) {
  return String(value || "").trim().toLowerCase();
}

function phoneKey(value) {
  return String(value || "").replace(/\D/g, "");
}

function displayValue(value, fallback = "—") {
  return value == null || value === "" ? fallback : value;
}

function addUnique(list, value) {
  if (value == null || value === "") return;
  const stringValue = String(value);
  if (!list.includes(stringValue)) list.push(stringValue);
}

function newestDate(...values) {
  const dates = values
    .filter(Boolean)
    .map((value) => new Date(value))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((a, b) => b.getTime() - a.getTime());
  return dates[0]?.toISOString() || "";
}

function csvCell(value) {
  const raw = Array.isArray(value) ? value.join("; ") : value == null ? "" : String(value);
  return `"${raw.replace(/"/g, '""')}"`;
}

function downloadCsv(filename, headers, rows) {
  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 500);
}

function cleanErrorMessage(message) {
  const text = String(message || "");
  if (/localhost:5432|database server|prisma\./i.test(text)) {
    return "Database is unavailable. Start Postgres locally or point DATABASE_URL at the live database.";
  }
  if (/timed out|aborted/i.test(text)) {
    return "Admin data request timed out. Check DATABASE_URL and backend service health.";
  }
  if (/networkerror|failed to fetch|load failed/i.test(text)) {
    return `Admin API is unreachable. If you are testing locally, make sure the backend is running at ${API_BASE}.`;
  }
  return text || "Something went wrong.";
}

function Shell({ children }) {
  return (
    <main className="myai-admin min-h-screen bg-[#f6fbff] text-[#102033]">
      <div className="relative min-h-screen overflow-x-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_500px_at_12%_12%,rgba(15,147,232,0.13),transparent_60%)]" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(800px_540px_at_80%_22%,rgba(232,117,0,0.1),transparent_70%)]" />
        <div className="relative z-10 mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-10">{children}</div>
      </div>
    </main>
  );
}

function Panel({ children }) {
  return (
    <div className="admin-panel rounded-[24px] border border-white/20 bg-[linear-gradient(180deg,rgba(10,12,18,0.78),rgba(8,10,16,0.9))] p-5 shadow-[0_45px_120px_-60px_rgba(0,0,0,0.85)] ring-1 ring-black/20">
      {children}
    </div>
  );
}

function Labeled({ label, children }) {
  return (
    <label className="block">
      <div className="mb-1 text-xs font-bold uppercase tracking-[0.16em] text-white/45">{label}</div>
      {children}
    </label>
  );
}

function Input(props) {
  return (
    <input
      {...props}
      className={
        "admin-input w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-white placeholder:text-white/35 outline-none " +
        (props.className || "")
      }
    />
  );
}

function Select(props) {
  return (
    <select
      {...props}
      className={"admin-input w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-sm font-semibold text-white outline-none " + (props.className || "")}
    />
  );
}

function Textarea(props) {
  return (
    <textarea
      {...props}
      className={
        "admin-input w-full resize-none rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-white placeholder:text-white/35 outline-none " +
        (props.className || "")
      }
    />
  );
}

function SetupReadinessCard({ items, score, onOpenSync }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.18em] text-white/45">Launch Readiness</div>
          <div className="mt-1 text-2xl font-extrabold text-white">{score}%</div>
        </div>
        <div className="h-14 w-14 rounded-full border border-white/10 bg-white/5 p-1">
          <div className="grid h-full w-full place-items-center rounded-full bg-[conic-gradient(#34d399_var(--score),rgba(255,255,255,0.12)_0)] text-xs font-black text-white" style={{ "--score": `${score}%` }}>
            {items.filter((item) => item.ok).length}/{items.length}
          </div>
        </div>
      </div>
      <div className="mt-4 grid gap-2">
        {items.map((item) => (
          <div key={item.label} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
            <span className="text-xs font-bold text-white/75">{item.label}</span>
            <span className={"rounded-full px-2 py-1 text-[0.65rem] font-black uppercase tracking-[0.1em] " + readinessColor(item.ok)}>
              {item.ok ? "Ready" : "Missing"}
            </span>
          </div>
        ))}
      </div>
      <button type="button" onClick={onOpenSync} className="mt-3 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-left text-xs font-bold text-white/75 hover:bg-white/10">
        Open setup checks
      </button>
    </div>
  );
}

function AdminNav({ groups, activeTab, onSelect }) {
  return (
    <div className="grid gap-4">
      {groups.map((group) => (
        <div key={group.title}>
          <div className="text-xs font-bold uppercase tracking-[0.22em] text-white/35">{group.title}</div>
          <div className="mt-2 grid gap-2">
            {group.items.map(([key, label, desc]) => (
              <button
                key={key}
                type="button"
                onClick={() => onSelect(key)}
                className={
                  "rounded-2xl px-4 py-3 text-left text-sm font-bold transition " +
                  (activeTab === key
                    ? "bg-gradient-to-r from-emerald-700 to-amber-500 text-white shadow-[0_18px_48px_-36px_rgba(245,158,11,0.9)]"
                    : "border border-white/10 bg-white/5 text-white/70 hover:bg-white/10")
                }
              >
                <span className="block">{label}</span>
                <span className="mt-1 block text-xs font-semibold opacity-65">{desc}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ConceptLogo() {
  return (
    <div className="admin-brand">
      <span className="admin-brand-mark"><span /></span>
      <span className="admin-brand-text">My <strong>AI PA</strong></span>
    </div>
  );
}

function ConceptSidebar({ groups, activeTab, onSelect, onLock }) {
  return (
    <aside className="admin-concept-sidebar">
      <ConceptLogo />
      <nav className="admin-concept-nav" aria-label="Admin sections">
        {groups.map((group) => (
          <div key={group.title} className="admin-concept-nav-group">
            <div className="admin-concept-nav-title">{group.title}</div>
            {group.items.map(([key, label, desc]) => (
              <button
                key={key}
                type="button"
                onClick={() => onSelect(key)}
                className={"admin-concept-nav-item " + (activeTab === key ? "is-active" : "")}
                title={desc}
              >
                <span className="admin-concept-nav-icon">{label.slice(0, 1)}</span>
                <span>{label}</span>
              </button>
            ))}
          </div>
        ))}
      </nav>
      <div className="admin-concept-help">
        <div className="admin-concept-help-icon">?</div>
        <div className="admin-concept-help-title">Need help?</div>
        <p>See what needs attention and keep every business, call, and follow-up moving.</p>
        <button type="button" onClick={() => onSelect("sync")}>Check connections</button>
      </div>
      <button type="button" className="admin-concept-user" onClick={onLock}>
        <span>OC</span>
        <span><strong>Ollie in Canada</strong><small>Admin</small></span>
      </button>
    </aside>
  );
}

function ConceptTopBar({ loading, apiBase, apiSourceLabel, onRefresh, onRefreshAll, onSyncCalls, onSite }) {
  return (
    <header className="admin-concept-topbar">
      <div>
        <h1>Lead &amp; Business Overview</h1>
        <p>See what needs attention, follow every lead, and keep each business ready.</p>
        <div className="admin-api-source" title={apiBase}>
          <span className={apiSourceLabel === "Live Render API" ? "is-live" : "is-local"} />
          {apiSourceLabel}: {apiBase}
        </div>
      </div>
      <div className="admin-concept-top-actions">
        <div className="admin-concept-search">All businesses and calls</div>
        <div className="admin-concept-range">Last 30 days</div>
        <button type="button" className="admin-concept-status" onClick={onRefresh}>
          {loading ? "Checking..." : "Check Status"}
        </button>
        <button type="button" className="admin-concept-ghost" onClick={onRefreshAll}>Refresh Dashboard</button>
        <button type="button" className="admin-concept-primary" onClick={onSyncCalls}>Check Calls</button>
        <button type="button" className="admin-concept-ghost" onClick={onSite}>View Website</button>
      </div>
    </header>
  );
}

function ConceptReadiness({ items, score, onOpenSetup }) {
  const remaining = items.filter((item) => !item.ok).length;
  return (
    <section className="admin-card admin-readiness-card">
      <div className="admin-card-title">Launch Readiness</div>
      <div className="admin-readiness-layout">
        <div className="admin-readiness-ring" style={{ "--score": `${score}%` }}>
          <strong>{score}%</strong>
          <span>Ready</span>
        </div>
        <div>
          <h2>{remaining ? "You are almost ready to launch." : "Ready for live operations."}</h2>
          <p>Complete the remaining setup items before relying on automated billing and call-cost reporting.</p>
          <div className="admin-readiness-list">
            {items.map((item) => (
              <div key={item.label} className="admin-readiness-item">
                <span className={item.ok ? "admin-check is-ready" : "admin-check is-warning"}>{item.ok ? "OK" : "!"}</span>
                <span>{item.label}</span>
                {!item.ok ? <em>pending</em> : null}
              </div>
            ))}
          </div>
        </div>
      </div>
      <button type="button" className="admin-card-action" onClick={onOpenSetup}>Open Setup</button>
    </section>
  );
}

function IntegrationCard({ name, subtitle, ok, accent, onOpen }) {
  return (
    <section className="admin-card admin-integration-card">
      <div className={"admin-integration-mark " + accent}>{name.slice(0, 1)}</div>
      <div>
        <h3>{name}</h3>
        <p>{subtitle}</p>
      </div>
      <span className={ok ? "admin-pill is-ready" : "admin-pill is-warning"}>{ok ? "Connected" : "Not connected"}</span>
      <p className="admin-integration-copy">
        {ok ? `${name} is connected and ready.` : `Connect ${name} to unlock this part of the operation.`}
      </p>
      <button type="button" className="admin-inline-link" onClick={onOpen}>{ok ? "Manage" : "Open Setup"} <span>›</span></button>
    </section>
  );
}

function KpiCard({ title, value, sub, delta, children, onOpen }) {
  return (
    <section className="admin-card admin-kpi-card">
      <div className="admin-kpi-head">
        <div className="admin-card-title">{title}</div>
        {onOpen ? <button type="button" onClick={onOpen}>View all</button> : null}
      </div>
      <div className="admin-kpi-value">{value}</div>
      <div className="admin-kpi-sub">{sub}</div>
      {delta ? <div className="admin-kpi-delta">{delta}</div> : null}
      {children}
    </section>
  );
}

function MiniLineChart({ calls }) {
  const values = calls.slice(0, 7).map((call) => Number(call.durationSec || 0) || 0);
  const fallback = [18, 25, 19, 28, 21, 32, 26];
  const series = values.length >= 2 ? values : fallback;
  const max = Math.max(...series, 1);
  const points = series.map((value, index) => `${(index / Math.max(series.length - 1, 1)) * 100},${48 - (value / max) * 38}`).join(" ");
  return (
    <svg className="admin-mini-chart" viewBox="0 0 100 52" role="img" aria-label="Calls trend">
      <polyline points={points} fill="none" stroke="#106dff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <path d={`M0 52 L${points.replace(/ /g, " L")} L100 52 Z`} fill="rgba(16,109,255,0.08)" />
    </svg>
  );
}

function CostBars({ totals }) {
  const vapi = Number(totals?.vapiCost || 0);
  const twilio = Number(totals?.twilioCost || 0);
  const fixed = Number(totals?.fixedCost || 0);
  const total = Math.max(Number(totals?.estimatedProviderCost || totals?.totalInternalCost || vapi + twilio || 0), 1);
  const vapiPct = Math.round((vapi / total) * 100);
  const twilioPct = Math.round((twilio / total) * 100);
  const fixedPct = Math.max(0, 100 - vapiPct - twilioPct);
  return (
    <div className="admin-cost-bars">
      <div><span className="admin-dot admin-dot-teal" />AI Voice (Vapi)<strong>{moneyCompact(vapi)}</strong></div>
      <div><span className="admin-dot admin-dot-red" />Twilio Account<strong>{moneyCompact(twilio)}</strong></div>
      <div><span className="admin-dot admin-dot-slate" />Fixed / Other<strong>{moneyCompact(fixed)}</strong></div>
      <div className="admin-cost-stack">
        <span style={{ width: `${vapiPct}%` }} />
        <span style={{ width: `${twilioPct}%` }} />
        <span style={{ width: `${fixedPct}%` }} />
      </div>
    </div>
  );
}

function ConceptRecentCalls({ calls, onOpen }) {
  const rows = calls.slice(0, 5);
  return (
    <section className="admin-card admin-recent-calls">
      <div className="admin-section-head">
        <h2>Recent Calls</h2>
        <button type="button" onClick={onOpen}>View all calls</button>
      </div>
      <div className="admin-table-lite">
        <div className="admin-table-lite-head"><span>Time</span><span>Business Owner</span><span>From</span><span>Outcome</span><span>Cost</span></div>
        {rows.length ? rows.map((call) => (
          <div key={call.id} className="admin-table-lite-row">
            <span>{dt(call.startedAt)}</span>
            <span>{call.business?.name || `Business ${call.businessId}`}</span>
            <span>{call.caller?.phone || "—"}</span>
            <span><em className={call.status === "MISSED" ? "is-missed" : "is-answered"}>{call.outcome || call.status || "Answered"}</em></span>
            <span>{moneyCompact(call.totalInternalCost)}</span>
          </div>
        )) : <div className="admin-empty-row">No calls synced yet.</div>}
      </div>
    </section>
  );
}

function ConceptTrialSignups({ signups, onOpen }) {
  const rows = signups.slice(0, 5);
  return (
    <section className="admin-card admin-trial-card">
      <div className="admin-section-head">
        <h2>Trial Signups</h2>
        <button type="button" onClick={onOpen}>View all</button>
      </div>
      <div className="admin-kpi-value">{signups.length}</div>
      <div className="admin-kpi-sub">New trials</div>
      <div className="admin-list-lite">
        {rows.length ? rows.map((signup, index) => (
          <div key={signup.subscriptionId || signup.ownerEmail || index}>
            <span>{signup.businessName || "Unnamed business"}</span>
            <em>{signup.subscriptionStatus || signup.checkoutStatus || signup.status || "New"}</em>
          </div>
        )) : <div className="admin-empty-row">No signups yet.</div>}
      </div>
    </section>
  );
}

function ConceptSetupAlerts({ warnings, onOpenSetup, onOpenOwners }) {
  const rows = warnings.length ? warnings.slice(0, 4) : ["No active setup warnings detected."];
  return (
    <section className="admin-card admin-alert-card">
      <div className="admin-section-head">
        <h2>Setup Alerts <span>{warnings.length}</span></h2>
        <button type="button" onClick={onOpenSetup}>View all</button>
      </div>
      <div className="admin-alert-list">
        {rows.map((warning, index) => {
          const ok = !warnings.length;
          return (
            <div key={`${warning}-${index}`} className={ok ? "is-ok" : "is-alert"}>
              <span>{ok ? "OK" : "!"}</span>
              <p>{warning}</p>
              <button type="button" onClick={/mapping|business/i.test(warning) ? onOpenOwners : onOpenSetup}>{ok ? "Manage" : "Open Setup"}</button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function FixFirstPanel({ items, onOpen, onSyncCalls }) {
  return (
    <section className="admin-card admin-fix-first-card">
      <div className="admin-fix-first-intro">
        <div className="admin-fix-first-icon">!</div>
        <div>
          <h2>Fix First</h2>
          <p>These are the most important things that need your attention right now.</p>
          <button type="button" onClick={() => onOpen("setup")}>View all tasks ({items.length})</button>
        </div>
      </div>
      <div className="admin-fix-first-list">
        {items.length ? items.map((item, index) => (
          <div key={`${item.title}:${item.detail}:${index}`} className="admin-fix-first-row">
            <span className={"admin-fix-first-alert " + (item.status === "Problem" ? "is-problem" : "is-warning")}>{item.status === "Problem" ? "!" : "!"}</span>
            <div>
              <strong>{item.title}</strong>
              <small>{item.detail}</small>
            </div>
            <em className={item.status === "Problem" ? "is-problem" : "is-warning"}>{item.status}</em>
            <button type="button" onClick={() => (item.actionLabel === "Sync Calls" ? onSyncCalls() : onOpen(item.actionTab))}>
              {item.actionLabel}
            </button>
          </div>
        )) : (
          <div className="admin-fix-first-clear">
            Nothing urgent found. Keep an eye on new calls, leads, and costs.
          </div>
        )}
      </div>
    </section>
  );
}

function CustomerSnapshot({ customers, onOpen }) {
  const rows = customers.slice(0, 4);
  return (
    <section className="admin-card admin-dashboard-customers">
      <div className="admin-section-head">
        <h2>Customers</h2>
        <button type="button" onClick={onOpen}>View all</button>
      </div>
      <div className="admin-dashboard-customer-list">
        {rows.length ? rows.map((customer) => (
          <div key={customer.key} className={"admin-dashboard-customer-row " + (customer.statusLabel === "Ready" ? "is-ready" : customer.statusLabel === "Problem" ? "is-problem" : "is-warning")}>
            <span>{(customer.businessName || customer.ownerName || "?").slice(0, 2).toUpperCase()}</span>
            <div>
              <strong>{customer.ownerName || customer.businessName || "Unnamed customer"}</strong>
              <small>{customer.businessName || "No business name"}</small>
            </div>
            <ul>
              <li className={customer.hasNumber ? "is-ready" : "is-problem"}>{customer.hasNumber ? "AI Number Connected" : "No AI Number Connected"}</li>
              <li className={customer.ownerPhone ? "is-ready" : "is-warning"}>{customer.ownerPhone ? "Owner Text Ready" : "Add Owner Phone"}</li>
            </ul>
            <em>{customer.statusLabel}</em>
          </div>
        )) : <div className="admin-empty-row">No customers found yet.</div>}
      </div>
      <button type="button" className="admin-card-action" onClick={onOpen}>Manage All Customers</button>
    </section>
  );
}

function VapiSnapshot({ inventory, customerAccounts = [], onOpen }) {
  const activeNumbers = inventory.totals?.phoneNumbers ?? inventory.phoneNumbers?.length ?? 0;
  const activeAgents = inventory.totals?.assistants ?? inventory.assistants?.length ?? 0;
  const signupAssignedNumbers = new Set();
  customerAccounts.forEach((account) => {
    if (account.twilioPhoneNumber) signupAssignedNumbers.add(phoneKey(account.twilioPhoneNumber));
    (account.aiNumbers || []).forEach((number) => {
      if (number) signupAssignedNumbers.add(phoneKey(number));
    });
  });
  const notConnected =
    (inventory.phoneNumbers || []).filter((phone) => !phone.mappedBusiness).length +
    (inventory.assistants || []).filter((assistant) => !assistant.mappedBusiness).length;
  return (
    <section className="admin-card admin-dashboard-vapi">
      <div className="admin-section-head">
        <h2>Vapi Numbers & Agents</h2>
        <button type="button" onClick={onOpen}>View all</button>
      </div>
      <div className="admin-dashboard-vapi-list">
        <div><span className="is-ready">P</span><strong>{Math.max(activeNumbers, signupAssignedNumbers.size)}</strong><p>Tracked Numbers<small>{activeNumbers} Vapi · {signupAssignedNumbers.size} signup</small></p></div>
        <div><span className="is-blue">A</span><strong>{activeAgents}</strong><p>Active Agents<small>All online</small></p></div>
        <div><span className="is-warning">L</span><strong>{notConnected}</strong><p>Not Connected<small>Connect to customers</small></p></div>
      </div>
      <button type="button" className="admin-card-action" onClick={onOpen}>Open Vapi Numbers & Agents</button>
    </section>
  );
}

function MonthlyCostCard({ costAudit, onOpen }) {
  const total = costAudit?.totals?.estimatedProviderCost || costAudit?.totals?.totalInternalCost || 0;
  const vapi = costAudit?.totals?.vapiCost || costAudit?.totals?.callUsageCost || 0;
  const twilio = costAudit?.totals?.twilioCost || 0;
  return (
    <section className="admin-card admin-dashboard-cost">
      <div className="admin-section-head">
        <h2>Monthly Cost</h2>
        <button type="button" onClick={onOpen}>This Month</button>
      </div>
      <div className="admin-dashboard-cost-total">{moneyCompact(total)}</div>
      <div className="admin-kpi-sub">Total Spend</div>
      <div className="admin-dashboard-cost-lines">
        <div><span>Vapi AI Platform</span><strong>{moneyCompact(vapi)}</strong></div>
        <div><span>Twilio Phone & SMS</span><strong>{moneyCompact(twilio)}</strong></div>
      </div>
      <button type="button" className="admin-card-action" onClick={onOpen}>View Cost Breakdown</button>
    </section>
  );
}

function customerStatusLabel(account) {
  const subscription = String(account.subscriptionStatus || "").toLowerCase();
  if (/fail|past_due|unpaid|incomplete|requires|cancel/.test(subscription)) return "Payment Pending";
  if (/checkout|pending|open|not linked/.test(subscription)) return "Payment Pending";
  if (account.statusLabel === "Problem") return "Problem";
  if (account.hasNumber && !account.vapiMappings.length) return "Phone Not Connected";
  if (!account.hasNumber || !account.setupReady) return "Setup Needed";
  return "Live";
}

function customerNextAction(account) {
  const status = customerStatusLabel(account);
  if (status === "Payment Pending") return { label: "Resend Checkout", tab: "signups" };
  if (status === "Phone Not Connected" || !account.hasNumber) return { label: "Connect AI Number", tab: "mappings" };
  if (!account.hasCalls) return { label: "Make Test Call", tab: "calls" };
  if (!account.setupReady) return { label: "Finish Business Setup", tab: "setup" };
  return { label: "View Business", tab: "customers" };
}

function dashboardBadgeClass(status) {
  if (status === "Live" || status === "Ready") return "is-live";
  if (status === "Problem") return "is-problem";
  if (status === "Payment Pending" || status === "Phone Not Connected") return "is-warning";
  return "is-muted";
}

function SystemHealthPanel({ setupItems, signups, apiSourceLabel, onOpen }) {
  const makeOk = signups.some((signup) => Number(signup.makeStatus || 0) >= 200 && Number(signup.makeStatus || 0) < 300);
  const items = [
    { label: "Stripe", ok: setupItems.find((item) => item.label === "Stripe checkout")?.ok, detail: "Payments" },
    { label: "Vapi", ok: setupItems.find((item) => item.label === "Vapi API")?.ok, detail: "AI calls" },
    { label: "Twilio", ok: setupItems.find((item) => item.label === "Twilio cost sync")?.ok, detail: "Numbers & texts" },
    { label: "Make", ok: makeOk, detail: makeOk ? "Signup automation ready" : "Signup automation not tested" },
    { label: "Render", ok: apiSourceLabel === "Live Render API", detail: apiSourceLabel === "Live Render API" ? "Backend online" : "Using local backend" },
    { label: "Database", ok: setupItems.find((item) => item.label === "Database")?.ok, detail: "Customer records" },
  ];

  return (
    <section className="admin-v2-card admin-v2-health">
      <div className="admin-v2-card-head">
        <div>
          <span>Connections</span>
          <h2>Connected services</h2>
        </div>
        <button type="button" onClick={() => onOpen("sync")}>Details</button>
      </div>
      <div className="admin-v2-health-list">
        {items.map((item) => (
          <button key={item.label} type="button" onClick={() => onOpen(item.label === "Vapi" ? "vapi" : item.label === "Twilio" ? "costs" : item.label === "Stripe checkout" ? "trials" : "sync")}>
            <span className={"admin-v2-health-dot " + (item.ok ? "is-ok" : "is-warn")} />
            <strong>{item.label}</strong>
            <em>{item.detail}</em>
          </button>
        ))}
      </div>
    </section>
  );
}

function LeadJourney({ totalCalls, unreviewed, followUps, booked, handoffSummary, onOpen }) {
  const ownerNotified = handoffSummary?.ownerNotified || 0;
  const textIssues = (handoffSummary?.retryDue || 0) + (handoffSummary?.failed || 0);
  const stages = [
    { label: "Calls captured", value: totalCalls, detail: "Saved for review", tone: "is-blue" },
    { label: "Owner text sent", value: ownerNotified, detail: "Twilio accepted the text", tone: ownerNotified ? "is-blue" : "is-gap" },
    { label: "Text issues", value: textIssues, detail: textIssues ? "Retry or manual follow-up" : "No sending problems", tone: textIssues ? "is-warn" : "is-good" },
    { label: "Follow-up due", value: followUps, detail: "Needs the next action", tone: "is-warn" },
    { label: "Jobs booked", value: booked, detail: "Marked as won", tone: "is-good" },
  ];

  return (
    <section className="admin-v2-card admin-lead-journey">
      <div className="admin-v2-card-head">
        <div>
          <span>Lead follow-up</span>
          <h2>Every lead should have a clear next step</h2>
        </div>
        <button type="button" onClick={onOpen}>Review leads &amp; calls</button>
      </div>
      <div className="admin-lead-journey-stages">
        {stages.map((stage, index) => (
          <div key={stage.label} className={`admin-lead-stage ${stage.tone}`}>
            <div className="admin-lead-stage-number">{index + 1}</div>
            <span>{stage.label}</span>
            <strong>{stage.value}</strong>
            <small>{stage.detail}</small>
          </div>
        ))}
      </div>
      <div className="admin-lead-journey-note">
        <strong>{textIssues ? `${textIssues} owner text${textIssues === 1 ? " needs" : "s need"} attention.` : unreviewed ? `${unreviewed} call${unreviewed === 1 ? " is" : "s are"} waiting for review.` : "No calls are waiting for review."}</strong>
        <span>Vapi remains the sender. My AI PA records whether Twilio accepted the owner text and flags failures after the retry attempts are used.</span>
      </div>
    </section>
  );
}

function ConceptOverview({
  stats,
  costAudit,
  calls,
  customerAccounts,
  fixFirstItems,
  vapiInventory,
  setupItems,
  signups,
  apiSourceLabel,
  leadHandoffs,
  onOpenTab,
  onSyncCalls,
}) {
  const totalCalls = costAudit?.totals?.totalCalls || calls.length;
  const liveCustomers = customerAccounts.filter((account) => customerStatusLabel(account) === "Live").length;
  const needsAction = customerAccounts.filter((account) => customerStatusLabel(account) !== "Live").length;
  const monthlyCost = costAudit?.totals?.estimatedProviderCost || costAudit?.totals?.totalInternalCost || stats.totalCost || 0;
  const customerRows = customerAccounts.slice(0, 6);
  const fixRows = fixFirstItems.slice(0, 3);
  const unreviewed = calls.filter((call) => !call.outcome || call.outcome === "UNREVIEWED").length;
  const followUps = calls.filter((call) => call.followUpNeeded || call.outcome === "FOLLOW_UP" || call.outcome === "QUOTE_NEEDED").length;
  const booked = calls.filter((call) => call.outcome === "BOOKED").length;

  return (
    <div className="admin-v2-overview">
      <div className="admin-v2-kpis">
        <button type="button" onClick={() => onOpenTab("customers")} className="admin-v2-kpi">
          <span>Live Businesses</span>
          <strong>{liveCustomers}</strong>
          <em>{customerAccounts.length || stats.owners} total businesses</em>
        </button>
        <button type="button" onClick={() => onOpenTab("setup")} className="admin-v2-kpi is-warning">
          <span>Business Setup Needed</span>
          <strong>{needsAction}</strong>
          <em>Setup, payment, or phone connection</em>
        </button>
        <button type="button" onClick={() => onOpenTab("calls")} className="admin-v2-kpi">
          <span>Calls Captured</span>
          <strong>{totalCalls}</strong>
          <em>{calls.length} ready for lead review</em>
        </button>
        <button type="button" onClick={() => onOpenTab("costs")} className="admin-v2-kpi">
          <span>Provider Cost</span>
          <strong>{moneyCompact(monthlyCost)}</strong>
          <em>{costAudit?.totals?.pricedCalls || 0} priced calls</em>
        </button>
      </div>

      <LeadJourney
        totalCalls={totalCalls}
        unreviewed={unreviewed}
        followUps={followUps}
        booked={booked}
        handoffSummary={leadHandoffs?.summary}
        onOpen={() => onOpenTab("calls")}
      />

      <div className="admin-v2-main-grid">
        <section className="admin-v2-card admin-v2-fix">
          <div className="admin-v2-card-head">
            <div>
              <span>What needs attention</span>
              <h2>Do these next</h2>
            </div>
            <button type="button" onClick={() => onOpenTab("setup")}>View all</button>
          </div>
          <div className="admin-v2-fix-list">
            {fixRows.length ? fixRows.map((item, index) => (
              <div key={`${item.title}:${index}`} className="admin-v2-fix-row">
                <span className={item.status === "Problem" ? "is-problem" : "is-warning"}>{index + 1}</span>
                <div>
                  <strong>{item.title}</strong>
                  <small>{item.detail}</small>
                </div>
                <button type="button" onClick={() => (item.actionLabel === "Sync Calls" ? onSyncCalls() : onOpenTab(item.actionTab))}>
                  {item.actionLabel}
                </button>
              </div>
            )) : (
              <div className="admin-v2-empty"><strong>You’re caught up.</strong><span>New setup, call, or billing issues will appear here with the next action.</span></div>
            )}
          </div>
        </section>

        <SystemHealthPanel setupItems={setupItems} signups={signups} apiSourceLabel={apiSourceLabel} onOpen={onOpenTab} />
      </div>

      <section className="admin-v2-card admin-v2-customers">
        <div className="admin-v2-card-head">
          <div>
            <span>Business accounts</span>
            <h2>Businesses</h2>
          </div>
          <button type="button" onClick={() => onOpenTab("customers")}>Manage businesses</button>
        </div>
        <div className="admin-v2-table">
          <div className="admin-v2-table-head">
            <span>Business</span><span>Trial</span><span>AI Phone Number</span><span>Phone Assistant</span><span>Calls</span><span>Next Action</span>
          </div>
          {customerRows.length ? customerRows.map((account) => {
            const status = customerStatusLabel(account);
            const action = customerNextAction(account);
            return (
              <div key={account.key} className="admin-v2-table-row">
                <span><strong>{account.businessName || account.ownerName || "Unnamed business"}</strong><small>{account.ownerEmail || account.ownerPhone || "No owner contact"}</small></span>
                <span><em className={"admin-v2-badge " + dashboardBadgeClass(status)}>{status === "Live" ? "Live" : account.subscriptionStatus || status}</em></span>
                <span>{account.aiNumbers[0] || account.twilioPhoneNumber || "Not assigned"}</span>
                <span><em className={"admin-v2-badge " + dashboardBadgeClass(status)}>{status}</em></span>
                <span>{account.callCount || 0}</span>
                <span><button type="button" onClick={() => onOpenTab(action.tab)}>{action.label}</button></span>
              </div>
            );
          }) : (
            <div className="admin-v2-empty admin-v2-empty-action">
              <div><strong>No businesses yet.</strong><span>Open Business Setup to add the first business, connect its AI number, and make a test call.</span></div>
              <button type="button" onClick={() => onOpenTab("setup")}>Open Business Setup</button>
            </div>
          )}
        </div>
      </section>
      </div>
  );
}

export default function AdminDashboard() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [candidate, setCandidate] = useState("");
  const [activeTab, setActiveTab] = useState("overview");
  const [selectedCustomerKey, setSelectedCustomerKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [gateBusy, setGateBusy] = useState(false);
  const [vapiSyncStatus, setVapiSyncStatus] = useState("");

  const [leads, setLeads] = useState([]);
  const [calls, setCalls] = useState([]);
  const [selectedCall, setSelectedCall] = useState(null);
  const [signups, setSignups] = useState([]);
  const [analytics, setAnalytics] = useState([]);
  const [trialHealth, setTrialHealth] = useState([]);
  const [stripeTrials, setStripeTrials] = useState(EMPTY_STRIPE_TRIALS);
  const [customerSetup, setCustomerSetup] = useState({ customers: [], summary: null, warnings: [] });
  const [vapiMappings, setVapiMappings] = useState([]);
  const [vapiInventory, setVapiInventory] = useState({ phoneNumbers: [], assistants: [], warnings: [], totals: null, fetchedAt: "" });
  const [businesses, setBusinesses] = useState([]);
  const [opsOverview, setOpsOverview] = useState({ owners: [], sync: null });
  const [costAudit, setCostAudit] = useState(null);
  const [digest, setDigest] = useState(null);
  const [faqs, setFaqs] = useState([]);
  const [settings, setSettings] = useState(null);
  const [leadHandoffs, setLeadHandoffs] = useState({ summary: {}, handoffs: [] });

  const [leadFilters, setLeadFilters] = useState({ status: "", intent: "", urgency: "" });
  const [callFilters, setCallFilters] = useState({ status: "", minDuration: "", outcome: "", search: "" });
  const [costDays, setCostDays] = useState("30");
  const [faqDraft, setFaqDraft] = useState({ question: "", answer: "", tags: "" });
  const [mappingDraft, setMappingDraft] = useState({ businessId: "1", matchType: "assistantId", matchValue: "", label: "" });
  const [businessDraft, setBusinessDraft] = useState({
    id: "1",
    name: "My AI PA",
    phone: "+12495033301",
    ownerPhone: "+12495033301",
    timezone: "America/Toronto",
    vapiMatchType: "phoneNumber",
    vapiMatchValue: "+12495033301",
    vapiLabel: "Main AI number",
  });

  const stats = useMemo(
    () => ({
      leads: leads.length,
      calls: calls.length,
      signups: signups.length,
      owners: opsOverview.owners?.length || 0,
      mappedOwners: opsOverview.sync?.mappedBusinessCount || 0,
      totalCost: costAudit?.totals?.totalInternalCost || 0,
      setupBlocked: customerSetup.summary?.blocked || 0,
      syncWarnings: opsOverview.sync?.warnings?.length || costAudit?.warnings?.length || 0,
      faqs: faqs.length,
      rings: settings?.answerAfterRings ?? "—",
      stripeTrials: stripeTrials.totals?.activeTrialCount || 0,
    }),
    [leads.length, calls.length, signups.length, opsOverview.owners?.length, opsOverview.sync, costAudit, customerSetup.summary, faqs.length, settings, stripeTrials.totals?.activeTrialCount]
  );

  const setupItems = useMemo(
    () => [
      { label: "Database", ok: Boolean(opsOverview.sync?.env?.databaseAvailable) },
      { label: "Admin password", ok: Boolean(opsOverview.sync && !opsOverview.sync?.env?.adminPasswordLooksDefault) },
      { label: "Stripe checkout", ok: Boolean(opsOverview.sync?.env?.stripeConfigured) },
      { label: "Vapi API", ok: Boolean(opsOverview.sync?.env?.vapiApiKeyConfigured) },
      { label: "Twilio cost sync", ok: Boolean(opsOverview.sync?.env?.twilioConfigured) },
      { label: "Owner mappings", ok: Boolean(opsOverview.sync?.mappedBusinessCount) },
    ],
    [opsOverview.sync]
  );

  const setupScore = useMemo(() => {
    if (!setupItems.length) return 0;
    return Math.round((setupItems.filter((item) => item.ok).length / setupItems.length) * 100);
  }, [setupItems]);

  const systemHealth = useMemo(() => {
    const env = opsOverview.sync?.env || {};
    const makeOk = signups.some((signup) => Number(signup.makeStatus || 0) >= 200 && Number(signup.makeStatus || 0) < 300);
    const mappedBusinesses = Number(opsOverview.sync?.mappedBusinessCount || 0);
    const syncedRecords = Number(opsOverview.sync?.syncStoreCount || 0);
    const services = [
      {
        label: "Render API",
        status: API_SOURCE_LABEL === "Live Render API" ? "Connected" : "Local",
        ok: API_SOURCE_LABEL === "Live Render API",
        detail: API_SOURCE_LABEL,
        action: API_SOURCE_LABEL === "Live Render API" ? "Live admin API" : "Preview is using local API",
      },
      {
        label: "Database",
        status: env.databaseAvailable ? "Connected" : "Problem",
        ok: Boolean(env.databaseAvailable),
        detail: "Postgres",
        action: env.databaseAvailable ? "Reads and writes available" : "Check DATABASE_URL / Render Postgres",
      },
      {
        label: "Stripe",
        status: env.stripeConfigured ? "Connected" : "Missing",
        ok: Boolean(env.stripeConfigured),
        detail: "Checkout + webhooks",
        action: env.stripeConfigured ? "Trials and subscriptions can update" : "Add Stripe keys and webhook secret",
      },
      {
        label: "Vapi",
        status: env.vapiApiKeyConfigured ? "Connected" : "Missing",
        ok: Boolean(env.vapiApiKeyConfigured),
        detail: `${vapiInventory.totals?.phoneNumbers ?? vapiInventory.phoneNumbers?.length ?? 0} numbers`,
        action: env.vapiApiKeyConfigured ? `${syncedRecords} synced records` : "Add VAPI_API_KEY",
      },
      {
        label: "Twilio",
        status: env.twilioConfigured ? "Connected" : "Missing",
        ok: Boolean(env.twilioConfigured),
        detail: "Cost sync",
        action: env.twilioConfigured ? "Per-call costs can sync" : "Add Twilio SID/token",
      },
      {
        label: "Make",
        status: makeOk ? "Handoff OK" : "Waiting",
        ok: makeOk || !signups.length,
        detail: "Signup automation",
        action: makeOk ? "Recent signup handoff accepted" : signups.length ? "Check latest Make scenario run" : "No signup handoff observed yet",
      },
      {
        label: "Mappings",
        status: mappedBusinesses ? "Mapped" : "Needs setup",
        ok: Boolean(mappedBusinesses),
        detail: `${mappedBusinesses} customers`,
        action: mappedBusinesses ? "Calls can attach to owners" : "Map Vapi numbers to customers",
      },
      {
        label: "Admin Password",
        status: env.adminPasswordLooksDefault ? "Weak" : "Set",
        ok: Boolean(opsOverview.sync && !env.adminPasswordLooksDefault),
        detail: "Dashboard gate",
        action: env.adminPasswordLooksDefault ? "Change ADMIN_PASSWORD" : "Protected",
      },
    ];
    const warnings = [
      ...(opsOverview.sync?.warnings || []),
      ...(vapiInventory.warnings || []),
      ...(costAudit?.warnings || []),
    ].filter(Boolean);
    const connected = services.filter((item) => item.ok).length;
    const score = services.length ? Math.round((connected / services.length) * 100) : 0;
    const actionItems = services.filter((item) => !item.ok).slice(0, 5);
    return { services, warnings, connected, score, actionItems };
  }, [costAudit?.warnings, opsOverview.sync, signups, vapiInventory.phoneNumbers, vapiInventory.totals, vapiInventory.warnings]);

  const customerAccounts = useMemo(() => {
    const accounts = [];

    const matchesSeed = (account, seed) => {
      const businessId = seed.businessId ?? seed.id;
      if (businessId != null && account.businessId != null && String(account.businessId) === String(businessId)) return true;
      if (seed.ownerEmail && textKey(account.ownerEmail) && textKey(account.ownerEmail) === textKey(seed.ownerEmail)) return true;
      const ownerPhone = phoneKey(seed.ownerPhone);
      const businessPhone = phoneKey(seed.businessPhone || seed.phoneNumber || seed.phone);
      if (ownerPhone && phoneKey(account.ownerPhone) === ownerPhone) return true;
      if (businessPhone && phoneKey(account.businessPhone) === businessPhone) return true;
      if (businessPhone && account.aiNumbers.some((number) => phoneKey(number) === businessPhone)) return true;
      if (seed.businessName && textKey(account.businessName) && textKey(account.businessName) === textKey(seed.businessName)) return true;
      return false;
    };

    const ensureAccount = (seed = {}) => {
      const existing = accounts.find((account) => matchesSeed(account, seed));
      const businessId = seed.businessId ?? (seed.kind === "business" ? seed.id : null);
      const fallbackKey =
        businessId != null
          ? `business:${businessId}`
          : seed.ownerEmail
            ? `email:${textKey(seed.ownerEmail)}`
            : seed.ownerPhone
              ? `owner:${phoneKey(seed.ownerPhone)}`
              : seed.businessPhone || seed.phoneNumber || seed.phone
                ? `phone:${phoneKey(seed.businessPhone || seed.phoneNumber || seed.phone)}`
                : `name:${textKey(seed.businessName || seed.name || "unknown")}`;
      const account =
        existing ||
        {
          key: fallbackKey,
          businessId,
          businessName: "",
          businessPhone: "",
          ownerName: "",
          ownerEmail: "",
          ownerPhone: "",
          twilioPhoneNumber: "",
          aiNumbers: [],
          vapiMappings: [],
          needsSetup: false,
          setupStatus: "",
          readinessPercent: 0,
          nextAction: "",
          blockerLabel: "",
          setupSteps: [],
          signup: null,
          trial: null,
          cost: null,
          recentCalls: [],
          recentLeads: [],
          callCount: 0,
          leadCount: 0,
          lastCallAt: "",
          lastSignupAt: "",
          stats: {},
        };

      if (!existing) accounts.push(account);
      if (businessId != null) account.businessId = businessId;
      account.businessName = account.businessName || seed.businessName || seed.name || seed.business?.name || "";
      account.businessPhone = account.businessPhone || seed.businessPhone || seed.phoneNumber || seed.phone || "";
      account.ownerName = account.ownerName || seed.ownerName || "";
      account.ownerEmail = account.ownerEmail || seed.ownerEmail || "";
      account.ownerPhone = account.ownerPhone || seed.ownerPhone || "";
      account.twilioPhoneNumber = account.twilioPhoneNumber || seed.twilioPhoneNumber || "";
      addUnique(account.aiNumbers, seed.twilioPhoneNumber);
      return account;
    };

    (opsOverview.owners || []).forEach((owner) => {
      const account = ensureAccount({ ...owner, kind: "business" });
      (owner.aiNumbers || []).forEach((number) => addUnique(account.aiNumbers, number));
      (owner.vapiMappings || []).forEach((mapping) => {
        if (!account.vapiMappings.some((item) => item.id === mapping.id)) account.vapiMappings.push(mapping);
      });
      account.needsSetup = Boolean(owner.needsSetup);
      account.stats = { ...account.stats, ...(owner.stats || {}) };
      account.callCount = Math.max(account.callCount, Number(owner.stats?.recentCallWindow || owner.stats?.syncedCalls || 0));
      account.lastCallAt = newestDate(account.lastCallAt, owner.stats?.lastCallAt);
      (owner.recentCalls || []).forEach((call) => {
        if (!account.recentCalls.some((item) => item.id === call.id)) account.recentCalls.push(call);
      });
    });

    (customerSetup.customers || []).forEach((customer) => {
      const account = ensureAccount(customer);
      account.setupStatus = customer.overallStatus || account.setupStatus;
      account.readinessPercent = Math.max(account.readinessPercent, Number(customer.readinessPercent || 0));
      account.nextAction = customer.nextAction || account.nextAction;
      account.blockerLabel = customer.blockerLabel || account.blockerLabel;
      account.setupSteps = customer.steps || account.setupSteps;
      account.twilioPhoneNumber = account.twilioPhoneNumber || customer.twilioPhoneNumber || "";
      addUnique(account.aiNumbers, customer.twilioPhoneNumber);
      (customer.aiNumbers || []).forEach((number) => addUnique(account.aiNumbers, number));
      account.callCount = Math.max(account.callCount, Number(customer.callCount || 0));
      account.lastCallAt = newestDate(account.lastCallAt, customer.lastCallAt);
      account.lastSignupAt = newestDate(account.lastSignupAt, customer.signedUpAt);
    });

    (trialHealth || []).forEach((trial) => {
      const account = ensureAccount(trial);
      account.trial = trial;
      account.readinessPercent = Math.max(account.readinessPercent, Number(trial.readinessPercent || 0));
      account.callCount = Math.max(account.callCount, Number(trial.callCount || 0));
      account.lastSignupAt = newestDate(account.lastSignupAt, trial.signedUpAt || trial.createdAt);
    });

    (signups || []).forEach((signup) => {
      const account = ensureAccount(signup);
      account.signup = signup;
      account.twilioPhoneNumber = account.twilioPhoneNumber || signup.twilioPhoneNumber || "";
      addUnique(account.aiNumbers, signup.twilioPhoneNumber);
      account.lastSignupAt = newestDate(account.lastSignupAt, signup.signedUpAt || signup.createdAt);
    });

    (costAudit?.summary || []).forEach((row) => {
      const account = ensureAccount(row);
      account.cost = row;
      account.callCount = Math.max(account.callCount, Number(row.totalCalls || 0));
      account.lastCallAt = newestDate(account.lastCallAt, row.lastCallAt);
      addUnique(account.aiNumbers, row.phoneNumber);
    });

    const callRows = [...(calls || []), ...(costAudit?.calls || [])];
    callRows.forEach((call) => {
      const account = ensureAccount({
        businessId: call.businessId,
        businessName: call.business?.name,
      });
      if (!account.recentCalls.some((item) => item.id === call.id)) account.recentCalls.push(call);
      account.callCount = Math.max(account.callCount, account.recentCalls.length);
      account.lastCallAt = newestDate(account.lastCallAt, call.startedAt);
    });

    (leads || []).forEach((lead) => {
      const businessId = lead.businessId || lead.call?.businessId;
      if (!businessId && !lead.businessName && !lead.call?.business?.name) return;
      const account = ensureAccount({
        businessId,
        businessName: lead.businessName || lead.call?.business?.name,
      });
      if (!account.recentLeads.some((item) => item.id === lead.id)) account.recentLeads.push(lead);
      account.leadCount = Math.max(account.leadCount, account.recentLeads.length);
    });

    return accounts
      .map((account) => {
        const recentCalls = [...account.recentCalls].sort((a, b) => new Date(b.startedAt || 0) - new Date(a.startedAt || 0));
        const recentLeads = [...account.recentLeads].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
        const setupReady = account.setupStatus === "ready" || account.setupStatus === "done" || account.readinessPercent >= 80;
        const hasNumber = account.aiNumbers.length > 0 || account.vapiMappings.length > 0;
        const hasCalls = account.callCount > 0 || recentCalls.length > 0;
        const subscriptionStatus =
          account.signup?.subscriptionStatus ||
          account.signup?.paymentStatus ||
          account.signup?.checkoutStatus ||
          account.signup?.status ||
          "Not linked";
        const hasProblem = account.setupStatus === "failed" || account.setupStatus === "blocked" || Boolean(account.blockerLabel);
        const statusLabel = hasProblem ? "Problem" : !hasNumber || !setupReady || account.needsSetup ? "Needs Setup" : "Ready";
        const timeline = [
          account.lastSignupAt
            ? { label: "Signup received", value: dt(account.lastSignupAt) }
            : null,
          hasNumber
            ? { label: account.vapiMappings.length ? "AI number mapped" : "AI number assigned", value: account.aiNumbers.join(", ") || `${account.vapiMappings.length} mapping(s)` }
            : null,
          account.nextAction
            ? { label: "Next setup action", value: account.nextAction }
            : null,
          account.lastCallAt
            ? { label: "Last call", value: dt(account.lastCallAt) }
            : null,
          account.cost
            ? { label: "Cost window", value: `${moneyCompact(account.cost.totalInternalCost)} / ${account.cost.totalCalls || 0} calls` }
            : null,
        ].filter(Boolean);

        return {
          ...account,
          recentCalls,
          recentLeads,
          callCount: Math.max(account.callCount, recentCalls.length),
          leadCount: Math.max(account.leadCount, recentLeads.length),
          setupReady,
          hasNumber,
          hasCalls,
          statusLabel,
          subscriptionStatus,
          timeline,
        };
      })
      .sort((a, b) => {
        const scoreA = new Date(a.lastCallAt || a.lastSignupAt || 0).getTime();
        const scoreB = new Date(b.lastCallAt || b.lastSignupAt || 0).getTime();
        return scoreB - scoreA || String(a.businessName).localeCompare(String(b.businessName));
      });
  }, [opsOverview.owners, customerSetup.customers, trialHealth, signups, costAudit, calls, leads]);

  const selectedCustomer = useMemo(() => {
    if (!customerAccounts.length) return null;
    return customerAccounts.find((account) => account.key === selectedCustomerKey) || customerAccounts[0];
  }, [customerAccounts, selectedCustomerKey]);

  const selectedCustomerNextAction = useMemo(() => {
    if (!selectedCustomer) return "";
    if (selectedCustomer.statusLabel === "Problem") {
      return selectedCustomer.blockerLabel || selectedCustomer.nextAction || "Fix the blocked setup item.";
    }
    if (!selectedCustomer.hasNumber) return "Assign this customer an AI phone number.";
    if (!selectedCustomer.setupReady) return selectedCustomer.nextAction || "Finish the customer setup checklist.";
    if (!selectedCustomer.hasCalls) return "Click Sync Calls to confirm the number is working.";
    if (!(selectedCustomer.ownerPhone || settings?.ownerPhone)) return "Add the owner phone so text alerts can go to the right person.";
    return "Nothing urgent. This customer is ready. Watch new calls, leads, and costs.";
  }, [selectedCustomer, settings?.ownerPhone]);

  const selectedCustomerOps = useMemo(() => {
    if (!selectedCustomer) {
      return {
        calls: [],
        vapiCalls: [],
        twilioCalls: [],
        connectionRows: [],
        transcriptCount: 0,
        recordingCount: 0,
        totalVapiCost: 0,
        totalTwilioCost: 0,
        totalInternalCost: 0,
      };
    }

    const seenCalls = new Set();
    const callsForCustomer = [];
    (selectedCustomer.recentCalls || []).forEach((call) => {
      const key = call.id || call.externalId || call.twilioCallSid || `${call.startedAt || ""}:${call.caller?.phone || ""}`;
      if (seenCalls.has(key)) return;
      seenCalls.add(key);
      callsForCustomer.push(call);
    });

    const hasVapiRecord = (call) => String(call.externalProvider || "").toLowerCase() === "vapi" || Boolean(call.externalId || call.vapiCallId);
    const hasTwilioRecord = (call) => Boolean(call.twilioCallSid || call.twilioPrice != null || call.twilioCost != null || call.twilioPriceUnit);
    const sum = (rows, getter) => rows.reduce((total, row) => total + Number(getter(row) || 0), 0);
    const vapiCalls = callsForCustomer.filter(hasVapiRecord);
    const twilioCalls = callsForCustomer.filter(hasTwilioRecord);
    const totalVapiCost = Number(selectedCustomer.cost?.vapiCost ?? sum(callsForCustomer, (call) => call.vapiCost));
    const totalTwilioCost = Number(selectedCustomer.cost?.twilioCost ?? sum(callsForCustomer, (call) => call.twilioPrice || call.twilioCost));
    const totalInternalCost = Number(selectedCustomer.cost?.totalInternalCost ?? sum(callsForCustomer, (call) => call.totalInternalCost));
    const transcriptCount = callsForCustomer.filter((call) => call.transcriptAvailable || call.transcript).length;
    const recordingCount = callsForCustomer.filter((call) => call.recordingAvailable || call.recordingUrl).length;

    const connectionRows = [];
    (selectedCustomer.aiNumbers || []).forEach((number) => {
      connectionRows.push({
        key: `ai:${number}`,
        type: "AI number",
        value: number,
        detail: number === selectedCustomer.twilioPhoneNumber ? "Assigned Twilio number" : "Mapped number",
        state: "Linked",
      });
    });
    (selectedCustomer.vapiMappings || []).forEach((mapping, index) => {
      connectionRows.push({
        key: `vapi:${mapping.id || index}`,
        type: "Vapi mapping",
        value: mapping.matchValue || mapping.label || mapping.id || "Mapping",
        detail: [mapping.matchType, mapping.label].filter(Boolean).join(" · ") || "Assistant/customer mapping",
        state: "Linked",
      });
    });

    const twilioSidRows = [];
    const seenTwilioSids = new Set();
    callsForCustomer.forEach((call) => {
      if (!call.twilioCallSid || seenTwilioSids.has(call.twilioCallSid)) return;
      seenTwilioSids.add(call.twilioCallSid);
      twilioSidRows.push({
        key: `twilio:${call.twilioCallSid}`,
        type: "Twilio call",
        value: call.twilioCallSid,
        detail: `${dt(call.startedAt)} · ${moneyCompact(call.twilioPrice || call.twilioCost)}`,
        state: "Synced",
      });
    });

    if (!connectionRows.length) {
      connectionRows.push({
        key: "empty",
        type: "No number linked",
        value: "Assign a Vapi/Twilio number",
        detail: "Calls cannot be tracked to this customer until a number or mapping exists.",
        state: "Missing",
      });
    }

    return {
      calls: callsForCustomer,
      vapiCalls,
      twilioCalls,
      connectionRows: [...connectionRows, ...twilioSidRows.slice(0, 5)],
      transcriptCount,
      recordingCount,
      totalVapiCost,
      totalTwilioCost,
      totalInternalCost,
    };
  }, [selectedCustomer]);

  const customerFinancialRows = useMemo(() => {
    const days = Math.max(Number(costAudit?.days || costDays || 30), 1);
    const planRevenue = DEFAULT_MONTHLY_REVENUE_USD;
    const rows = customerAccounts.map((account) => {
      const payment = paymentStateForAccount(account);
      const configuredRevenue = signupRevenueAmount(account.signup) || planRevenue;
      const monthlyRevenue = payment.key === "paying" ? configuredRevenue : 0;
      const spendWindow = Number(account.cost?.totalInternalCost || 0);
      const spendMonthly = Number((spendWindow * (30 / days)).toFixed(2));
      const profitMonthly = Number((monthlyRevenue - spendMonthly).toFixed(2));
      const margin = monthlyRevenue > 0 ? (profitMonthly / monthlyRevenue) * 100 : null;
      const callsWindow = Number(account.cost?.totalCalls || account.callCount || 0);
      const projectedRevenue = payment.key === "trialing" ? configuredRevenue : 0;
      const nextAction =
        payment.key === "paying"
          ? profitMonthly < 0
            ? "Check call volume or pricing."
            : "Healthy paying account."
          : payment.key === "trialing"
            ? "Watch trial conversion."
            : payment.key === "problem"
              ? "Fix Stripe/payment status."
              : "Get Stripe checkout completed.";

      return {
        account,
        key: account.key,
        businessName: account.businessName || account.ownerName || account.ownerEmail || "Unknown customer",
        owner: account.ownerName || account.ownerEmail || account.ownerPhone || "—",
        phone: account.aiNumbers?.[0] || account.twilioPhoneNumber || account.businessPhone || "—",
        payment,
        monthlyRevenue,
        projectedRevenue,
        configuredRevenue,
        spendWindow,
        spendMonthly,
        profitMonthly,
        margin,
        callsWindow,
        nextAction,
      };
    }).sort((a, b) => {
      const stateRank = { paying: 0, trialing: 1, pending: 2, problem: 3, unknown: 4 };
      return (stateRank[a.payment.key] ?? 5) - (stateRank[b.payment.key] ?? 5) || b.spendMonthly - a.spendMonthly;
    });

    const providerWindowSpend = Number(costAudit?.totals?.estimatedProviderCost || costAudit?.totals?.totalInternalCost || 0);
    const providerMonthlySpend = Number((providerWindowSpend * (30 / days)).toFixed(2));
    const customerWindowSpend = rows.reduce((sum, row) => sum + row.spendWindow, 0);
    const revenueMonthly = rows.reduce((sum, row) => sum + row.monthlyRevenue, 0);
    const projectedTrialRevenue = rows.reduce((sum, row) => sum + row.projectedRevenue, 0);
    const profitMonthly = Number((revenueMonthly - providerMonthlySpend).toFixed(2));
    const margin = revenueMonthly > 0 ? (profitMonthly / revenueMonthly) * 100 : null;
    const paying = rows.filter((row) => row.payment.key === "paying").length;
    const trialing = rows.filter((row) => row.payment.key === "trialing").length;
    const attention = rows.filter((row) =>
      row.payment.key === "problem" ||
      row.payment.key === "pending" ||
      (row.payment.key === "paying" && row.profitMonthly < 0) ||
      (row.payment.key === "unknown" && row.spendWindow > 0)
    ).slice(0, 6);

    return {
      rows,
      attention,
      days,
      totals: {
        paying,
        trialing,
        revenueMonthly,
        projectedTrialRevenue,
        providerWindowSpend,
        providerMonthlySpend,
        customerWindowSpend,
        unallocatedWindowSpend: Math.max(providerWindowSpend - customerWindowSpend, 0),
        profitMonthly,
        margin,
      },
    };
  }, [customerAccounts, costAudit?.days, costAudit?.totals, costDays]);

  const customerHealthQueue = useMemo(() => {
    const rowsByKey = new Map((customerFinancialRows.rows || []).map((row) => [row.key, row]));
    const rows = customerAccounts.map((account) => {
      const financial = rowsByKey.get(account.key) || {};
      const payment = financial.payment || paymentStateForAccount(account);
      const monthlyRevenue = Number(financial.monthlyRevenue || 0);
      const projectedRevenue = Number(financial.projectedRevenue || 0);
      const spendMonthly = Number(financial.spendMonthly || 0);
      const profitMonthly = Number(financial.profitMonthly || (monthlyRevenue - spendMonthly));
      const displayRevenue = monthlyRevenue || projectedRevenue;
      const displayProfit = monthlyRevenue ? profitMonthly : projectedRevenue ? Number((projectedRevenue - spendMonthly).toFixed(2)) : profitMonthly;
      const margin = financial.margin;
      const issues = [];
      let score = 100;
      let action = "Open customer";
      let actionTab = "customers";

      const addIssue = (label, weight, nextAction, tab = "customers") => {
        issues.push(label);
        score -= weight;
        if (issues.length === 1) {
          action = nextAction;
          actionTab = tab;
        }
      };

      if (payment.key === "problem") addIssue("Payment problem", 30, "Fix billing", "costs");
      else if (payment.key === "pending") addIssue("Checkout pending", 22, "Finish checkout", "costs");
      else if (payment.key === "unknown") addIssue("Stripe unknown", 16, "Check billing", "costs");
      else if (payment.key === "trialing") addIssue("Trial account", 8, "Watch trial", "trials");

      if (!account.hasNumber) addIssue("No AI number", 24, "Map number", "mappings");
      if (!account.setupReady) addIssue("Setup incomplete", 18, account.nextAction || "Finish setup", "setup");
      if (!account.hasCalls) addIssue("No synced calls", 13, "Sync calls", "calls");
      if (!(account.ownerPhone || settings?.ownerPhone)) addIssue("No owner text", 10, "Add owner text", "setup");
      if (account.statusLabel === "Problem") addIssue(account.blockerLabel || "Blocked setup", 16, "Fix setup", "setup");

      if (payment.key === "paying" && profitMonthly < 0) {
        addIssue("Losing money", 28, "Review spend", "costs");
      } else if (payment.key === "paying" && monthlyRevenue > 0 && spendMonthly > monthlyRevenue * 0.45) {
        addIssue("High spend", 15, "Review spend", "costs");
      }

      if (account.recentLeads?.length && !account.ownerPhone && !settings?.ownerPhone) {
        addIssue("Lead handoff risk", 8, "Add owner text", "setup");
      }

      score = Math.max(0, Math.min(100, Math.round(score)));
      const tone = customerHealthTone(score, issues);
      const label = customerHealthLabel(score, issues);
      const why =
        issues.length
          ? issues.slice(0, 3).join(", ")
          : payment.key === "paying"
            ? "Paying, mapped, and active"
            : "No urgent customer blockers";

      return {
        key: account.key,
        account,
        payment,
        score,
        tone,
        label,
        why,
        issues,
        action,
        actionTab,
        monthlyRevenue,
        projectedRevenue,
        displayRevenue,
        spendMonthly,
        profitMonthly,
        displayProfit,
        margin,
        calls: Number(account.callCount || 0),
      };
    }).sort((a, b) => {
      const toneRank = { bad: 0, warn: 1, watch: 2, good: 3 };
      return (toneRank[a.tone] ?? 4) - (toneRank[b.tone] ?? 4) || a.score - b.score || b.spendMonthly - a.spendMonthly;
    });

    const counts = rows.reduce(
      (acc, row) => {
        acc[row.tone] = (acc[row.tone] || 0) + 1;
        return acc;
      },
      { bad: 0, warn: 0, watch: 0, good: 0 }
    );

    return {
      rows,
      urgent: rows.filter((row) => row.tone === "bad" || row.tone === "warn").slice(0, 6),
      counts,
      averageScore: rows.length ? Math.round(rows.reduce((sum, row) => sum + row.score, 0) / rows.length) : 0,
    };
  }, [customerAccounts, customerFinancialRows.rows, settings?.ownerPhone]);

  const callInsights = useMemo(() => {
    const rows = calls || [];
    const total = rows.length;
    const unreviewed = rows.filter((call) => !call.outcome || call.outcome === "UNREVIEWED").length;
    const followUps = rows.filter((call) => call.followUpNeeded || call.outcome === "FOLLOW_UP").length;
    const booked = rows.filter((call) => call.outcome === "BOOKED").length;
    const scores = rows.map((call) => Number(call.qualityScore)).filter((score) => Number.isFinite(score));
    const durations = rows.map((call) => Number(call.durationSec)).filter((duration) => Number.isFinite(duration) && duration > 0);
    const avgScore = scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : null;
    const avgDuration = durations.length ? Math.round(durations.reduce((sum, duration) => sum + duration, 0) / durations.length) : 0;
    const queue = rows
      .filter((call) => {
        const outcome = call.outcome || "UNREVIEWED";
        const score = Number(call.qualityScore);
        return outcome === "UNREVIEWED" || outcome === "EMERGENCY" || outcome === "FOLLOW_UP" || call.followUpNeeded || (Number.isFinite(score) && score < 60);
      })
      .slice(0, 5);
    return { total, unreviewed, followUps, booked, avgScore, avgDuration, queue };
  }, [calls]);

  const fixFirstItems = useMemo(() => {
    const items = [];
    const addItem = (item) => {
      if (!item?.title) return;
      items.push({
        status: "Needs Setup",
        actionLabel: "Open",
        actionTab: "customers",
        ...item,
      });
    };

    (vapiInventory.warnings || []).forEach((warning) => {
      addItem({
        status: "Problem",
        title: "Vapi cannot fully load",
        detail: warning,
        actionLabel: "API Check",
        actionTab: "sync",
      });
    });

    (vapiInventory.phoneNumbers || []).forEach((phone) => {
      if (!phone.mappedBusiness) {
        addItem({
          title: "Vapi number is not connected to a customer",
          detail: `${phone.number || phone.id || "Unknown number"}${phone.assistantName ? ` uses ${phone.assistantName}` : ""}`,
          actionLabel: "Connect Number",
          actionTab: "mappings",
        });
      }
      if (!phone.assistantId && !phone.assistantName) {
        addItem({
          status: "Problem",
          title: "Vapi number has no agent attached",
          detail: phone.number || phone.name || phone.id || "Unknown number",
          actionLabel: "Vapi Numbers",
          actionTab: "vapi",
        });
      }
    });

    (vapiInventory.assistants || []).forEach((assistant) => {
      if (!assistant.phoneNumbers?.length) {
        addItem({
          status: "Problem",
          title: "Vapi agent has no phone number",
          detail: assistant.name || assistant.id || "Unnamed agent",
          actionLabel: "Vapi Numbers",
          actionTab: "vapi",
        });
      }
      if (!assistant.mappedBusiness) {
        addItem({
          title: "Vapi agent is not connected to a customer",
          detail: assistant.name || assistant.id || "Unnamed agent",
          actionLabel: "Connect Agent",
          actionTab: "mappings",
        });
      }
    });

    customerAccounts.forEach((account) => {
      const name = account.businessName || account.ownerName || "Unnamed customer";
      if (account.statusLabel === "Problem") {
        addItem({
          status: "Problem",
          title: `${name} has a blocked setup item`,
          detail: account.blockerLabel || account.nextAction || "Open the customer setup checklist.",
          actionLabel: "Setup To-Do",
          actionTab: "setup",
        });
        return;
      }
      if (!account.hasNumber) {
        addItem({
          title: `${name} has no AI number connected`,
          detail: "Connect a Vapi phone number or agent to this customer.",
          actionLabel: "Connect Number",
          actionTab: "mappings",
        });
        return;
      }
      if (!account.setupReady) {
        addItem({
          title: `${name} setup is not finished`,
          detail: account.nextAction || `${account.readinessPercent || 0}% ready`,
          actionLabel: "Setup To-Do",
          actionTab: "setup",
        });
        return;
      }
      if (!account.hasCalls) {
        addItem({
          title: `${name} has no synced calls yet`,
          detail: "Sync calls to confirm this customer is actually receiving call data.",
          actionLabel: "Sync Calls",
          actionTab: "calls",
        });
      }
      if (!(account.ownerPhone || settings?.ownerPhone)) {
        addItem({
          title: `${name} has no owner text number`,
          detail: "Add the owner phone so call summaries can be texted to the right person.",
          actionLabel: "Settings",
          actionTab: "settings",
        });
      }
    });

    const handoffProblems = (leadHandoffs.summary?.retryDue || 0) + (leadHandoffs.summary?.escalationDue || 0) + (leadHandoffs.summary?.failed || 0);
    if (handoffProblems) {
      addItem({
        status: "Problem",
        title: `${handoffProblems} lead alert${handoffProblems === 1 ? " needs" : "s need"} attention`,
        detail: "A Vapi text failed, is due for retry, or needs a configured backup contact.",
        actionLabel: "Review Leads",
        actionTab: "calls",
      });
    }

    (costAudit?.warnings || []).forEach((warning) => {
      const friendly = friendlyConnectionWarning(warning);
      addItem({
        status: "Problem",
        ...friendly,
      });
    });

    const priority = { Problem: 0, "Needs Setup": 1, Ready: 2 };
    return items.sort((a, b) => (priority[a.status] ?? 9) - (priority[b.status] ?? 9)).slice(0, 8);
  }, [costAudit?.warnings, customerAccounts, leadHandoffs.summary?.escalationDue, leadHandoffs.summary?.failed, leadHandoffs.summary?.retryDue, settings?.ownerPhone, vapiInventory.assistants, vapiInventory.phoneNumbers, vapiInventory.warnings]);

  const navGroups = useMemo(
    () => [
      {
        title: "Command",
        items: [
          ["overview", "Overview", "Control center"],
          ["customers", "Businesses", "See every business and its next action"],
          ["setup", "Business Setup", "Finish businesses that are not ready"],
          ["calls", "Leads & Calls", "Review calls and move leads forward"],
          ["trials", "Trials", "Live Stripe trial status"],
          ["costs", "Billing", "Vapi and Twilio spend"],
          ["sync", "Connections", "Service connection and refresh status"],
        ],
      },
    ],
    []
  );

  const loadLeads = async () => {
    const p = new URLSearchParams();
    if (leadFilters.status) p.set("status", leadFilters.status);
    if (leadFilters.intent) p.set("intent", leadFilters.intent);
    if (leadFilters.urgency) p.set("urgency", leadFilters.urgency);
    const data = await api(`/api/admin/leads${p.toString() ? `?${p}` : ""}`);
    setLeads(data.leads || []);
  };

  const loadCalls = async () => {
    const p = new URLSearchParams();
    if (callFilters.status) p.set("status", callFilters.status);
    if (callFilters.minDuration) p.set("minDuration", callFilters.minDuration);
    if (callFilters.outcome) p.set("outcome", callFilters.outcome);
    if (callFilters.search) p.set("q", callFilters.search);
    const path = callFilters.search ? "/api/admin/calls/search" : "/api/admin/calls";
    const data = await api(`${path}${p.toString() ? `?${p}` : ""}`);
    setCalls(data.calls || []);
  };

  const loadSignups = async () => {
    const data = await api("/api/admin/signups");
    setSignups(data.signups || []);
  };

  const loadFaqs = async () => {
    const data = await api("/api/admin/faqs");
    setFaqs(data.faqs || []);
  };

  const loadSettings = async () => {
    const data = await api("/api/admin/settings");
    setSettings(data.settings || null);
  };

  const loadLeadHandoffs = async () => {
    const data = await api("/api/admin/lead-handoffs");
    setLeadHandoffs({ summary: data.summary || {}, handoffs: data.handoffs || [] });
  };

  const loadAnalytics = async () => {
    const data = await api("/api/admin/calls/analytics?days=30");
    setAnalytics(data.analytics || []);
  };

  const loadTrialHealth = async () => {
    const data = await api("/api/admin/trial-health");
    setTrialHealth(data.accounts || []);
  };

  const loadStripeTrials = async () => {
    const data = await api("/api/admin/stripe-trials");
    setStripeTrials({
      ...EMPTY_STRIPE_TRIALS,
      ...data,
      totals: { ...EMPTY_STRIPE_TRIALS.totals, ...(data.totals || {}) },
      activeTrials: data.activeTrials || [],
      recentlyEndedTrialsLast30Days: data.recentlyEndedTrialsLast30Days || [],
      warnings: data.warnings || [],
    });
  };

  const loadCustomerSetup = async () => {
    const data = await api("/api/admin/customer-setup");
    setCustomerSetup({
      customers: data.customers || [],
      summary: data.summary || null,
      warnings: data.warnings || [],
      env: data.env || null,
    });
  };

  const loadOpsOverview = async () => {
    const data = await api("/api/admin/ops-overview");
    setOpsOverview({ owners: data.owners || [], sync: data.sync || null });
  };

  const loadCostAudit = async () => {
    const data = await api(`/api/admin/cost-audit?days=${encodeURIComponent(costDays || "30")}`);
    setCostAudit(data.audit || null);
  };

  const loadVapiMappings = async () => {
    const data = await api("/api/admin/vapi/mappings");
    setVapiMappings(data.mappings || []);
    setBusinesses(data.businesses || []);
    if ((data.businesses || []).length && mappingDraft.businessId === "1") {
      setMappingDraft((s) => ({ ...s, businessId: String(data.businesses[0].id) }));
    }
  };

  const loadVapiInventory = async () => {
    const data = await api("/api/admin/vapi/inventory");
    setVapiInventory(data.inventory || { phoneNumbers: [], assistants: [], warnings: [], totals: null, fetchedAt: "" });
  };

  const loadDigest = async () => {
    const data = await api("/api/admin/daily-digest?days=1");
    setDigest(data.digest || null);
  };

  const syncVapiCalls = async () => {
    setError("");
    setVapiSyncStatus("Syncing Vapi calls...");
    try {
      const data = await api("/api/admin/vapi/sync-calls", { method: "POST", body: { limit: 100 } });
      setVapiSyncStatus(`Synced ${data.synced || 0} of ${data.fetched || 0} Vapi calls.`);
      if (activeTab === "calls") await loadCalls();
      if (activeTab === "overview" || activeTab === "businesses") await loadOpsOverview();
      if (activeTab === "setup") await loadCustomerSetup();
      if (activeTab === "customers") await Promise.allSettled([loadCalls(), loadOpsOverview(), loadCustomerSetup(), loadCostAudit()]);
    } catch (err) {
      setVapiSyncStatus("");
      setError(cleanErrorMessage(err.message));
    }
  };

  const syncCosts = async () => {
    setError("");
    setVapiSyncStatus("Syncing Vapi and Twilio costs...");
    try {
      const data = await api("/api/admin/cost-sync", { method: "POST", body: { days: Number(costDays || 30), includeVapi: true } });
      setCostAudit(data.audit || null);
      setVapiSyncStatus(`Cost sync complete. Twilio updated ${data.twilio?.updated || 0} of ${data.twilio?.fetched || 0} fetched calls.`);
    } catch (err) {
      setVapiSyncStatus("");
      setError(cleanErrorMessage(err.message));
    }
  };

  const createBusiness = async (e) => {
    e.preventDefault();
    setError("");
    try {
      const data = await api("/api/admin/businesses", { method: "POST", body: businessDraft });
      setVapiSyncStatus(`Created ${data.business?.name || "business"} as Business #${data.business?.id || businessDraft.id}.`);
      await Promise.allSettled([loadOpsOverview(), loadVapiMappings(), loadSettings()]);
    } catch (err) {
      setError(cleanErrorMessage(err.message));
    }
  };

  const exportBusinessesCsv = () => {
    downloadCsv(
      "myai-admin-businesses.csv",
      ["Business", "Business phone", "Owner", "Owner email", "Owner phone", "AI numbers", "Mapped", "Synced calls", "Missed calls", "Follow ups", "Last sync"],
      (opsOverview.owners || []).map((owner) => [
        owner.businessName,
        owner.businessPhone,
        owner.ownerName,
        owner.ownerEmail,
        owner.ownerPhone,
        owner.aiNumbers || [],
        owner.needsSetup ? "Needs setup" : "Ready",
        owner.stats?.syncedCalls ?? "",
        owner.stats?.missedCalls ?? "",
        owner.stats?.followUps ?? "",
        owner.stats?.lastSyncedAt || "",
      ])
    );
  };

  const exportCallsCsv = () => {
    downloadCsv(
      "myai-admin-calls.csv",
      ["Started", "Company", "Status", "Outcome", "Score", "Duration sec", "Caller", "Follow up", "Twilio SID", "Internal cost"],
      (calls || []).map((call) => [
        call.startedAt || "",
        call.business?.name || `Business ${call.businessId}`,
        call.status,
        call.outcome || "UNREVIEWED",
        call.qualityScore ?? "",
        call.durationSec ?? "",
        call.caller?.phone || "",
        call.followUpNeeded ? "Yes" : "No",
        call.twilioCallSid || "",
        call.totalInternalCost ?? "",
      ])
    );
  };

  const exportCostsCsv = () => {
    downloadCsv(
      `myai-admin-profitability-${costDays || 30}d.csv`,
      ["Customer", "Owner", "Phone", "Payment", "Revenue per month", "Provider spend per month", "Profit per month", "Margin", "Calls", "Next action"],
      (customerFinancialRows.rows || []).map((row) => [
        row.businessName,
        row.owner,
        row.phone,
        row.payment.label,
        row.monthlyRevenue,
        row.spendMonthly,
        row.profitMonthly,
        row.margin == null ? "" : `${Math.round(row.margin)}%`,
        row.callsWindow,
        row.nextAction,
      ])
    );
  };

  const refreshAll = async () => {
    if (!isAuthenticated) return;
    setLoading(true);
    setError("");
    setVapiSyncStatus("Refreshing everything...");
    try {
      await Promise.allSettled([
        loadOpsOverview(),
        loadCustomerSetup(),
        loadTrialHealth(),
        loadStripeTrials(),
        loadSignups(),
        loadCalls(),
        loadLeads(),
        loadCostAudit(),
        loadVapiMappings(),
        loadVapiInventory(),
        loadAnalytics(),
        loadDigest(),
        loadSettings(),
        loadLeadHandoffs(),
      ]);
      setVapiSyncStatus("Dashboard refreshed.");
    } catch (e) {
      setVapiSyncStatus("");
      setError(cleanErrorMessage(e.message));
    } finally {
      setLoading(false);
    }
  };

  const refresh = async () => {
    if (!isAuthenticated) return;
    setLoading(true);
    setError("");
    try {
      if (activeTab === "leads") await loadLeads();
      if (activeTab === "overview") {
        await Promise.allSettled([loadOpsOverview(), loadCustomerSetup(), loadTrialHealth(), loadStripeTrials(), loadCostAudit(), loadCalls(), loadLeads(), loadSignups(), loadAnalytics(), loadVapiMappings(), loadVapiInventory(), loadSettings(), loadLeadHandoffs()]);
      }
      if (activeTab === "customers") {
        await Promise.allSettled([loadOpsOverview(), loadCustomerSetup(), loadTrialHealth(), loadSignups(), loadCalls(), loadLeads(), loadCostAudit(), loadVapiMappings(), loadVapiInventory()]);
      }
      if (activeTab === "setup") await loadCustomerSetup();
      if (activeTab === "businesses") await loadOpsOverview();
      if (activeTab === "calls") await Promise.allSettled([loadCalls(), loadLeadHandoffs()]);
      if (activeTab === "signups") await loadSignups();
      if (activeTab === "ops") await loadAnalytics();
      if (activeTab === "health") await loadTrialHealth();
      if (activeTab === "trials") await loadStripeTrials();
      if (activeTab === "costs") await Promise.allSettled([loadCostAudit(), loadStripeTrials()]);
      if (activeTab === "sync") await Promise.allSettled([loadOpsOverview(), loadVapiInventory(), loadCostAudit(), loadStripeTrials()]);
      if (activeTab === "vapi") await loadVapiInventory();
      if (activeTab === "mappings") await loadVapiMappings();
      if (activeTab === "digest") await loadDigest();
      if (activeTab === "faqs") await loadFaqs();
      if (activeTab === "settings") await loadSettings();
    } catch (e) {
      setError(cleanErrorMessage(e.message));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let alive = true;
    api("/api/admin/session")
      .then(() => {
        if (!alive) return;
        setIsAuthenticated(true);
      })
      .catch(() => {
        if (!alive) return;
        setIsAuthenticated(false);
      })
      .finally(() => {
        if (alive) setAuthChecked(true);
      });

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    refresh();
  }, [isAuthenticated, activeTab, leadFilters.status, leadFilters.intent, leadFilters.urgency, callFilters.status, callFilters.minDuration, callFilters.outcome, costDays]);

  useEffect(() => {
    if (activeTab !== "customers" || !customerAccounts.length) return;
    if (!selectedCustomerKey || !customerAccounts.some((account) => account.key === selectedCustomerKey)) {
      setSelectedCustomerKey(customerAccounts[0].key);
    }
  }, [activeTab, customerAccounts, selectedCustomerKey]);

  const unlock = async (e) => {
    e.preventDefault();
    setGateBusy(true);
    setError("");
    try {
      await api("/api/admin/login", { method: "POST", body: { password: candidate } });
      setStoredAdminPassword(candidate);
      setIsAuthenticated(true);
      setCandidate("");
    } catch (err) {
      setError(cleanErrorMessage(err.message));
    } finally {
      setGateBusy(false);
    }
  };

  const lock = async () => {
    setError("");
    try {
      await api("/api/admin/logout", { method: "POST" });
    } catch (_err) {
      // no-op
    } finally {
      setStoredAdminPassword("");
      setIsAuthenticated(false);
      setLeads([]);
      setCalls([]);
      setSignups([]);
      setAnalytics([]);
      setTrialHealth([]);
      setStripeTrials(EMPTY_STRIPE_TRIALS);
      setCustomerSetup({ customers: [], summary: null, warnings: [] });
      setVapiMappings([]);
      setVapiInventory({ phoneNumbers: [], assistants: [], warnings: [], totals: null, fetchedAt: "" });
      setBusinesses([]);
      setOpsOverview({ owners: [], sync: null });
      setCostAudit(null);
      setDigest(null);
      setFaqs([]);
      setSettings(null);
      setSelectedCustomerKey("");
    }
  };

  const createFaq = async (e) => {
    e.preventDefault();
    setError("");
    try {
      await api("/api/admin/faqs", { method: "POST", body: { businessId: 1, ...faqDraft } });
      setFaqDraft({ question: "", answer: "", tags: "" });
      await loadFaqs();
    } catch (err) {
      setError(cleanErrorMessage(err.message));
    }
  };

  const updateCall = async (call, patch) => {
    try {
      await api(`/api/admin/calls/${call.id}`, { method: "PUT", body: patch });
      await loadCalls();
    } catch (err) {
      setError(cleanErrorMessage(err.message));
    }
  };

  const addCallTask = async (call) => {
    const title = window.prompt("Task title");
    if (!title) return;
    try {
      await api(`/api/admin/calls/${call.id}/tasks`, { method: "POST", body: { title } });
      await loadCalls();
    } catch (err) {
      setError(cleanErrorMessage(err.message));
    }
  };

  const addCallNote = async (call) => {
    const body = window.prompt("Note");
    if (!body) return;
    try {
      await api(`/api/admin/calls/${call.id}/notes`, { method: "POST", body: { body } });
      await loadCalls();
    } catch (err) {
      setError(cleanErrorMessage(err.message));
    }
  };

  const loadCallDetails = async (call) => {
    if (!call?.id) return;
    setError("");
    try {
      const data = await api(`/api/admin/calls/${call.id}`);
      setSelectedCall(data.call || call);
    } catch (err) {
      setError(cleanErrorMessage(err.message));
    }
  };

  const createMapping = async (e) => {
    e.preventDefault();
    try {
      await api("/api/admin/vapi/mappings", { method: "POST", body: mappingDraft });
      setMappingDraft((s) => ({ ...s, matchValue: "", label: "" }));
      await loadVapiMappings();
    } catch (err) {
      setError(cleanErrorMessage(err.message));
    }
  };

  const deleteMapping = async (id) => {
    try {
      await api(`/api/admin/vapi/mappings/${id}`, { method: "DELETE" });
      await loadVapiMappings();
    } catch (err) {
      setError(cleanErrorMessage(err.message));
    }
  };

  const updateCustomerSetupStep = async (customer, step, status) => {
    const note =
      status === "clear"
        ? ""
        : window.prompt(
            status === "done"
              ? "Optional note for marking this step done"
              : status === "manual"
                ? "What manual action is needed?"
                : "Why is this step blocked or waiting?",
            step.reason || ""
          );
    if (status !== "clear" && note == null) return;
    try {
      const data = await api(`/api/admin/customer-setup/${customer.id}/steps/${step.key}`, {
        method: "POST",
        body: { status, note },
      });
      setCustomerSetup({
        customers: data.customers || [],
        summary: data.summary || null,
        warnings: data.warnings || [],
        env: data.env || null,
      });
    } catch (err) {
      setError(cleanErrorMessage(err.message));
    }
  };

  const updateFaq = async (faq) => {
    try {
      await api(`/api/admin/faqs/${faq.id}`, { method: "PUT", body: faq });
      await loadFaqs();
    } catch (err) {
      setError(cleanErrorMessage(err.message));
    }
  };

  const removeFaq = async (id) => {
    try {
      await api(`/api/admin/faqs/${id}`, { method: "DELETE" });
      await loadFaqs();
    } catch (err) {
      setError(cleanErrorMessage(err.message));
    }
  };

  const saveSettings = async (e) => {
    e.preventDefault();
    if (!settings) return;
    try {
      const data = await api("/api/admin/settings", {
        method: "PUT",
        body: {
          businessId: settings.businessId || 1,
          answerAfterRings: Number(settings.answerAfterRings || 3),
          afterHoursMode: settings.afterHoursMode || "AI_ALWAYS_ON",
          ownerPhone: settings.ownerPhone || "",
          backupPhone: settings.backupPhone || "",
          bookingLink: settings.bookingLink || "",
        },
      });
      setSettings(data.settings);
    } catch (err) {
      setError(cleanErrorMessage(err.message));
    }
  };

  if (!authChecked) {
    return (
      <Shell>
        <Panel>
          <div className="text-xs font-bold uppercase tracking-[0.28em] text-white/60">Admin Session</div>
          <p className="mt-3 text-sm font-semibold text-white/75">Checking your admin session...</p>
        </Panel>
      </Shell>
    );
  }

  if (!isAuthenticated) {
    return (
      <Shell>
        <div className="grid gap-8 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <div className="inline-flex items-center rounded-full border border-white/35 bg-white/10 px-4 py-2 text-xs font-bold uppercase tracking-[0.3em] text-white/90">Admin Dashboard</div>
            <h1 className="mt-6 font-serif text-[clamp(2.7rem,12vw,4rem)] font-semibold leading-[0.95] text-white">My AI PA control center</h1>
            <p className="mt-6 max-w-2xl text-lg font-bold leading-snug text-[#0c1736] sm:text-xl">
              Enter the admin password to manage leads, calls, FAQs, and answering settings.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <button type="button" onClick={() => (window.location.hash = "/")} className="rounded-full border border-white/25 bg-white/5 px-5 py-3 text-sm font-black uppercase tracking-[0.14em] text-white/80">Back To Site</button>
              <button type="button" onClick={() => (window.location.hash = "/signup")} className="rounded-full border border-white/25 bg-white/5 px-5 py-3 text-sm font-black uppercase tracking-[0.14em] text-white/80">Open Setup Flow</button>
            </div>
            <div className="mt-8 grid max-w-3xl gap-3 sm:grid-cols-2">
              {[
                ["Trial pipeline", "Track signups, checkout status, and trial expiry."],
                ["Owner numbers", "Match every business owner to their AI phone numbers."],
                ["Call costs", "See Vapi and Twilio spend by phone number."],
                ["Setup checks", "Know exactly which integrations still need keys."],
              ].map(([label, copy]) => (
                <div key={label} className="rounded-2xl border border-white/35 bg-white/55 p-4 shadow-[0_20px_60px_-50px_rgba(15,23,42,0.65)]">
                  <div className="text-xs font-black uppercase tracking-[0.18em] text-[#1d4ed8]">{label}</div>
                  <p className="mt-2 text-sm font-bold leading-6 text-[#102033]/75">{copy}</p>
                </div>
              ))}
            </div>
          </div>
          <Panel>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="text-xs font-bold uppercase tracking-[0.28em] text-white/60">Secure Sign In</div>
              <p className="mt-3 text-sm font-semibold text-white/75">Enter the admin password once. The dashboard then uses a secure session cookie.</p>
              <form className="mt-4 space-y-4" onSubmit={unlock}>
                <Labeled label="Admin Password">
                  <Input type="password" value={candidate} onChange={(e) => setCandidate(e.target.value)} placeholder="Enter ADMIN_PASSWORD" />
                </Labeled>
                {error ? <p className="text-sm font-semibold text-rose-200">{error}</p> : null}
                <button type="submit" disabled={gateBusy} className="rounded-full bg-gradient-to-r from-emerald-700 to-amber-500 px-6 py-3 text-sm font-black uppercase tracking-[0.14em] text-white disabled:opacity-60">
                  {gateBusy ? "Checking..." : "Unlock Admin"}
                </button>
              </form>
            </div>
          </Panel>
        </div>
      </Shell>
    );
  }

  return (
    <main className="myai-admin admin-concept-root">
      <div className="admin-concept-shell">
        <ConceptSidebar groups={navGroups} activeTab={activeTab} onSelect={setActiveTab} onLock={lock} />
        <section className="admin-concept-main">
          <ConceptTopBar
            loading={loading}
            apiBase={API_BASE}
            apiSourceLabel={API_SOURCE_LABEL}
            onRefresh={refresh}
            onRefreshAll={refreshAll}
            onSyncCalls={syncVapiCalls}
            onSite={() => (window.location.hash = "/")}
          />
          <div className="admin-mobile-tabs">
          {navGroups.flatMap((group) => group.items).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setActiveTab(k)} className={"rounded-full px-4 py-2 text-sm font-bold " + (activeTab === k ? "bg-gradient-to-r from-emerald-700 to-amber-500 text-white" : "border border-white/15 bg-white/5 text-white/70")}>{label}</button>
          ))}
          <button type="button" onClick={refresh} className="ml-auto rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-bold text-white/80">Refresh</button>
        </div>

        {error ? <p className="mt-3 text-sm font-semibold text-rose-200">{error}</p> : null}
        {loading ? <p className="mt-3 text-sm font-semibold text-white/65">Loading...</p> : null}

        {activeTab === "overview" ? (
          <ConceptOverview
            stats={stats}
            costAudit={costAudit}
            calls={calls}
            customerAccounts={customerAccounts}
            fixFirstItems={fixFirstItems}
            vapiInventory={vapiInventory}
            setupItems={setupItems}
            signups={signups}
            apiSourceLabel={API_SOURCE_LABEL}
            leadHandoffs={leadHandoffs}
            onOpenTab={setActiveTab}
            onSyncCalls={syncVapiCalls}
          />
        ) : null}

        {activeTab === "customers" ? (
          <div className="admin-customer-page">
            <div className="admin-customer-header">
              <div>
                <div className="admin-customer-eyebrow">Customer Command Center</div>
                <h2>Business drill-down</h2>
                <p>Select a business to see its Vapi records, Twilio usage, call logs, setup state, and spend together.</p>
              </div>
              <div className="admin-customer-actions">
                <button type="button" onClick={refresh}>Refresh</button>
                <button type="button" onClick={syncVapiCalls}>Sync Calls</button>
                <button type="button" onClick={syncCosts} className="admin-customer-primary">Sync Costs</button>
              </div>
            </div>

            {vapiSyncStatus ? <div className="admin-customer-status">{vapiSyncStatus}</div> : null}

            <FixFirstPanel items={fixFirstItems} onOpen={setActiveTab} onSyncCalls={syncVapiCalls} />

            <div className="admin-customer-kpis">
              {[
                ["Customers", customerAccounts.length, "Accounts found"],
                ["Ready", customerAccounts.filter((account) => account.statusLabel === "Ready").length, "Operational"],
                ["Health Score", customerHealthQueue.averageScore ? `${customerHealthQueue.averageScore}%` : "—", `${customerHealthQueue.counts.bad + customerHealthQueue.counts.warn} urgent`],
                ["Profit / Mo", moneyDashboard(customerFinancialRows.totals.profitMonthly), `${percentDashboard(customerFinancialRows.totals.margin)} margin`],
                ["Provider Spend", moneyDashboard(customerFinancialRows.totals.providerMonthlySpend), "Projected monthly"],
              ].map(([label, value, copy]) => (
                <div key={label} className="admin-customer-kpi">
                  <span>{label}</span>
                  <strong>{value}</strong>
                  <em>{copy}</em>
                </div>
              ))}
            </div>

            <section className="admin-customer-card admin-health-queue">
              <div className="admin-customer-card-head">
                <div>
                  <span>Customer Health Queue</span>
                  <h3>Fix the accounts that can cost you money first</h3>
                </div>
                <p>{customerHealthQueue.rows.length} scored customer(s)</p>
              </div>
              <div className="admin-health-queue-list">
                {customerHealthQueue.rows.length ? customerHealthQueue.rows.slice(0, 6).map((row, index) => (
                  <div key={row.key} className={"admin-health-row is-" + row.tone}>
                    <button
                      type="button"
                      className="admin-health-main"
                      onClick={() => setSelectedCustomerKey(row.account.key)}
                    >
                      <span className="admin-health-rank">{index + 1}</span>
                      <span className="admin-health-score">
                        <strong>{row.score}</strong>
                        <em>{row.label}</em>
                      </span>
                      <span className="admin-health-name">
                        <strong>{row.account.businessName || row.account.ownerName || "Unknown customer"}</strong>
                        <em>{row.why}</em>
                      </span>
                    </button>
                    <div className="admin-health-money">
                      <span><b>{moneyDashboard(row.displayRevenue)}</b> {row.monthlyRevenue ? "revenue" : "pipeline"}</span>
                      <span><b>{moneyDashboard(row.spendMonthly)}</b> spend</span>
                      <span className={row.displayProfit >= 0 ? "is-good" : "is-bad"}><b>{moneyDashboard(row.displayProfit)}</b> {row.monthlyRevenue ? "profit" : "projected"}</span>
                    </div>
                    <div className="admin-health-issues">
                      {row.issues.length ? row.issues.slice(0, 3).map((issue) => <span key={issue}>{issue}</span>) : <span>Clear</span>}
                    </div>
                    <button
                      type="button"
                      className="admin-health-action"
                      onClick={() => {
                        setSelectedCustomerKey(row.account.key);
                        setActiveTab(row.actionTab);
                      }}
                    >
                      {row.action}
                    </button>
                  </div>
                )) : <div className="admin-customer-empty">No customers to score yet.</div>}
              </div>
            </section>

            <div className="admin-customer-layout">
              <section className="admin-customer-card admin-customer-list-card">
                <div className="admin-customer-card-head">
                  <div>
                    <span>Businesses</span>
                    <h3>Click a business name</h3>
                  </div>
                  <p>{customerAccounts.length} total</p>
                </div>
                <div className="admin-customer-list-v2">
                  {customerAccounts.length ? customerAccounts.map((account) => (
                    <button
                      key={account.key}
                      type="button"
                      onClick={() => setSelectedCustomerKey(account.key)}
                      className={"admin-customer-row-v2 " + (selectedCustomer?.key === account.key ? "is-selected" : "")}
                    >
                      <div>
                        <strong>{account.businessName || "Unnamed business"}</strong>
                        <small>{displayValue(account.ownerName, "No owner")} · {displayValue(account.ownerPhone || account.ownerEmail, "No contact")}</small>
                      </div>
                      <span className={"admin-customer-status-pill is-" + String(account.statusLabel || "unknown").toLowerCase().replace(/\s+/g, "-")}>{account.statusLabel}</span>
                      <div className="admin-customer-row-metrics">
                        <span><b>{account.aiNumbers.length || account.vapiMappings.length}</b> nums</span>
                        <span><b>{account.callCount}</b> calls</span>
                        <span><b>{moneyCompact(account.cost?.totalInternalCost)}</b> cost</span>
                      </div>
                    </button>
                  )) : <div className="admin-customer-empty">No customer records found yet.</div>}
                </div>
              </section>

              {selectedCustomer ? (
                <section className="admin-customer-detail">
                  <div className="admin-customer-card admin-customer-hero">
                    <div className="admin-customer-hero-main">
                      <div>
                        <div className="admin-customer-eyebrow">Selected Business</div>
                        <h2>{selectedCustomer.businessName || "Unnamed business"}</h2>
                        <p>
                          Business #{displayValue(selectedCustomer.businessId)} · {displayValue(selectedCustomer.businessPhone, "No business phone")} · Owner {displayValue(selectedCustomer.ownerName, "not recorded")}
                        </p>
                      </div>
                      <span className={"admin-customer-status-pill is-" + String(selectedCustomer.statusLabel || "unknown").toLowerCase().replace(/\s+/g, "-")}>{selectedCustomer.statusLabel}</span>
                    </div>
                    <div className="admin-customer-next-action">
                      <span>Next action</span>
                      <strong>{selectedCustomerNextAction}</strong>
                    </div>
                  </div>

                  <div className="admin-customer-metric-grid">
                    <div className="admin-customer-metric"><span>AI Numbers</span><strong>{selectedCustomer.aiNumbers.length || selectedCustomer.vapiMappings.length}</strong><em>{selectedCustomer.aiNumbers[0] || selectedCustomer.vapiMappings[0]?.matchValue || "No number linked"}</em></div>
                    <div className="admin-customer-metric"><span>Vapi Calls</span><strong>{selectedCustomerOps.vapiCalls.length}</strong><em>{selectedCustomerOps.transcriptCount} transcript(s), {selectedCustomerOps.recordingCount} recording(s)</em></div>
                    <div className="admin-customer-metric"><span>Twilio Calls</span><strong>{selectedCustomerOps.twilioCalls.length}</strong><em>{moneyCompact(selectedCustomerOps.totalTwilioCost)} Twilio cost</em></div>
                    <div className="admin-customer-metric"><span>Total Spend</span><strong>{moneyCompact(selectedCustomerOps.totalInternalCost)}</strong><em>Vapi {moneyCompact(selectedCustomerOps.totalVapiCost)} · avg {moneyCompact(selectedCustomer.cost?.averageCost)}</em></div>
                  </div>

                  <div className="admin-customer-two-col">
                    <div className="admin-customer-card">
                      <div className="admin-customer-card-head">
                        <div>
                          <span>Vapi + Twilio Links</span>
                          <h3>Numbers, mappings, and synced provider IDs</h3>
                        </div>
                      </div>
                      <div className="admin-customer-link-list">
                        {selectedCustomerOps.connectionRows.map((row) => (
                          <div key={row.key} className={"admin-customer-link-row " + (row.state === "Missing" ? "is-missing" : "")}>
                            <div>
                              <strong>{row.type}</strong>
                              <small>{row.detail}</small>
                            </div>
                            <code>{row.value}</code>
                            <span>{row.state}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="admin-customer-card">
                      <div className="admin-customer-card-head">
                        <div>
                          <span>Setup + Billing</span>
                          <h3>Customer state</h3>
                        </div>
                      </div>
                      <div className="admin-customer-check-grid">
                        {[
                          ["Signup", Boolean(selectedCustomer.signup || selectedCustomer.trial), selectedCustomer.lastSignupAt ? dt(selectedCustomer.lastSignupAt) : "No signup linked"],
                          ["Stripe", paymentStateForAccount(selectedCustomer).key !== "unknown", selectedCustomer.subscriptionStatus],
                          ["Setup", selectedCustomer.setupReady, `${selectedCustomer.readinessPercent || 0}% ready`],
                          ["Owner Text", Boolean(selectedCustomer.ownerPhone || settings?.ownerPhone), selectedCustomer.ownerPhone || settings?.ownerPhone || "No owner text number"],
                        ].map(([label, ok, detail]) => (
                          <div key={label} className={"admin-customer-check " + (ok ? "is-ready" : "is-warning")}>
                            <span>{ok ? "Ready" : "Check"}</span>
                            <strong>{label}</strong>
                            <em>{detail}</em>
                          </div>
                        ))}
                      </div>
                      <div className="admin-customer-shortcuts">
                        <button type="button" onClick={() => setActiveTab("setup")}>Setup</button>
                        <button type="button" onClick={() => setActiveTab("calls")}>Calls</button>
                        <button type="button" onClick={() => setActiveTab("costs")}>Billing</button>
                        <button type="button" onClick={() => setActiveTab("mappings")}>Vapi Mapping</button>
                      </div>
                    </div>
                  </div>

                  <div className="admin-customer-card">
                    <div className="admin-customer-card-head">
                      <div>
                        <span>Call Logs</span>
                        <h3>Vapi and Twilio activity for this business</h3>
                      </div>
                      <p>{selectedCustomerOps.calls.length} linked call(s)</p>
                    </div>
                    <div className="admin-customer-table-wrap">
                      <table className="admin-customer-table">
                        <thead>
                          <tr>
                            <th>Started</th>
                            <th>Caller</th>
                            <th>Vapi</th>
                            <th>Twilio</th>
                            <th>Artifacts</th>
                            <th>Spend</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedCustomerOps.calls.length ? selectedCustomerOps.calls.slice(0, 10).map((call) => (
                            <tr key={call.id || call.externalId || call.startedAt}>
                              <td><strong>{dt(call.startedAt)}</strong><small>{callDurationText(call.durationSec)}</small></td>
                              <td>{call.caller?.phone || "Unknown"}</td>
                              <td><strong>{call.externalId || call.vapiCallId || "—"}</strong><small>{call.outcome || call.status || "UNREVIEWED"}</small></td>
                              <td><strong>{call.twilioCallSid || "—"}</strong><small>{moneyCompact(call.twilioPrice || call.twilioCost)}</small></td>
                              <td>
                                <span className={call.transcriptAvailable || call.transcript ? "admin-customer-mini-good" : "admin-customer-mini-muted"}>Transcript</span>
                                <span className={call.recordingAvailable || call.recordingUrl ? "admin-customer-mini-good" : "admin-customer-mini-muted"}>Recording</span>
                              </td>
                              <td>{moneyCompact(call.totalInternalCost)}</td>
                            </tr>
                          )) : <tr><td colSpan="6">No Vapi/Twilio calls have been linked to this customer yet.</td></tr>}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="admin-customer-two-col">
                    <div className="admin-customer-card">
                      <div className="admin-customer-card-head"><div><span>Timeline</span><h3>What happened recently</h3></div></div>
                      <div className="admin-customer-timeline">
                        {selectedCustomer.timeline.length ? selectedCustomer.timeline.map((event) => (
                          <div key={event.label}><strong>{event.label}</strong><span>{event.value}</span></div>
                        )) : <p>No timeline events yet.</p>}
                      </div>
                    </div>
                    <div className="admin-customer-card">
                      <div className="admin-customer-card-head"><div><span>Leads</span><h3>Captured from this business</h3></div></div>
                      <div className="admin-customer-lead-list">
                        {selectedCustomer.recentLeads.length ? selectedCustomer.recentLeads.slice(0, 5).map((lead) => (
                          <div key={lead.id}><strong>{lead.name || "Unnamed lead"}</strong><span>{lead.intent || "No intent"} · {lead.callbackNumber || "No callback"}</span></div>
                        )) : <p>No captured leads linked yet.</p>}
                      </div>
                    </div>
                  </div>
                </section>
              ) : (
                <section className="admin-customer-card admin-customer-empty">No customer selected.</section>
              )}
            </div>
          </div>
        ) : null}

        {activeTab === "leads" ? (
          <div className="mt-4">
            <div className="mb-4 grid gap-3 sm:grid-cols-3">
              <Labeled label="Status">
                <Select value={leadFilters.status} onChange={(e) => setLeadFilters((s) => ({ ...s, status: e.target.value }))}>
                  <option value="">All</option><option value="NEW">NEW</option><option value="CONTACTED">CONTACTED</option><option value="WON">WON</option><option value="LOST">LOST</option>
                </Select>
              </Labeled>
              <Labeled label="Intent">
                <Select value={leadFilters.intent} onChange={(e) => setLeadFilters((s) => ({ ...s, intent: e.target.value }))}>
                  <option value="">All</option><option value="GENERAL">GENERAL</option><option value="BOOKING">BOOKING</option><option value="QUOTE">QUOTE</option><option value="SUPPORT">SUPPORT</option><option value="OTHER">OTHER</option>
                </Select>
              </Labeled>
              <Labeled label="Urgency">
                <Select value={leadFilters.urgency} onChange={(e) => setLeadFilters((s) => ({ ...s, urgency: e.target.value }))}>
                  <option value="">All</option><option value="LOW">LOW</option><option value="MEDIUM">MEDIUM</option><option value="HIGH">HIGH</option><option value="URGENT">URGENT</option>
                </Select>
              </Labeled>
            </div>
            <div className="overflow-x-auto rounded-2xl border border-white/10 bg-black/20">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-white/10 text-xs font-bold uppercase tracking-[0.18em] text-white/55">
                  <tr><th className="px-4 py-3">Created</th><th className="px-4 py-3">Name</th><th className="px-4 py-3">Intent</th><th className="px-4 py-3">Urgency</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Callback</th><th className="px-4 py-3">Summary</th></tr>
                </thead>
                <tbody>
                  {leads.length ? leads.map((lead) => (
                    <tr key={lead.id} className="border-t border-white/5 align-top">
                      <td className="px-4 py-3 text-white/70">{dt(lead.createdAt)}</td><td className="px-4 py-3 font-semibold">{lead.name}</td><td className="px-4 py-3">{lead.intent}</td><td className="px-4 py-3">{lead.urgency}</td><td className="px-4 py-3">{lead.status}</td><td className="px-4 py-3">{lead.callbackNumber}</td><td className="px-4 py-3">{lead.summary}</td>
                    </tr>
                  )) : <tr><td colSpan="7" className="px-4 py-4 text-white/55">No leads found.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {activeTab === "calls" ? (
          <div className="admin-call-page">
            <div className="admin-call-header">
              <div>
                <div className="admin-call-eyebrow">Lead follow-up</div>
                <h2>Make sure every call gets a next step</h2>
                <p>Review new calls, record the result, and assign follow-up before an opportunity goes cold.</p>
              </div>
              <div className="admin-call-actions">
                <button type="button" onClick={exportCallsCsv}>Export CSV</button>
                <button type="button" onClick={syncVapiCalls} className="admin-call-primary">Check for New Calls</button>
              </div>
            </div>
            {vapiSyncStatus ? <p className="admin-call-status">{vapiSyncStatus}</p> : null}

            <div className="admin-call-filter-card">
              <Labeled label="Call status">
                <Select value={callFilters.status} onChange={(e) => setCallFilters((s) => ({ ...s, status: e.target.value }))}>
                  <option value="">All call statuses</option><option value="STARTED">In progress</option><option value="COMPLETED">Completed</option><option value="MISSED">Missed</option><option value="FAILED">Failed</option>
                </Select>
              </Labeled>
              <Labeled label="Lead result">
                <Select value={callFilters.outcome} onChange={(e) => setCallFilters((s) => ({ ...s, outcome: e.target.value }))}>
                  <option value="">All lead results</option><option value="UNREVIEWED">Waiting for review</option><option value="BOOKED">Job booked</option><option value="QUOTE_NEEDED">Quote needed</option><option value="EMERGENCY">Emergency</option><option value="SPAM">Spam</option><option value="FOLLOW_UP">Follow-up due</option><option value="NOT_A_LEAD">Not a lead</option>
                </Select>
              </Labeled>
              <Labeled label="Minimum call length">
                <Input type="number" min="0" value={callFilters.minDuration} onChange={(e) => setCallFilters((s) => ({ ...s, minDuration: e.target.value }))} />
              </Labeled>
              <Labeled label="Search calls">
                <Input value={callFilters.search} onChange={(e) => setCallFilters((s) => ({ ...s, search: e.target.value }))} onKeyDown={(e) => { if (e.key === "Enter") loadCalls(); }} placeholder="caller, phone, service..." />
              </Labeled>
              <button type="button" onClick={loadCalls}>Apply Filters</button>
            </div>

            <div className="admin-call-kpis">
              <div className="admin-call-kpi"><span>Calls Captured</span><strong>{callInsights.total}</strong><em>Shown with these filters</em></div>
              <div className="admin-call-kpi is-warn"><span>Waiting for Review</span><strong>{callInsights.unreviewed}</strong><em>Result not recorded yet</em></div>
              <div className="admin-call-kpi is-blue"><span>Owner Text Sent</span><strong>{leadHandoffs.summary?.ownerNotified || 0}</strong><em>Twilio accepted the text</em></div>
              <div className="admin-call-kpi is-warn"><span>SMS Retries Due</span><strong>{leadHandoffs.summary?.retryDue || 0}</strong><em>Automatic retry needed</em></div>
              <div className="admin-call-kpi is-warn"><span>Failed Texts</span><strong>{leadHandoffs.summary?.failed || 0}</strong><em>Manual follow-up required</em></div>
            </div>

            <div className="admin-call-grid">
              <section className="admin-call-card admin-call-main-card">
                <div className="admin-call-card-head">
                  <div>
                    <span>Lead activity</span>
                    <h3>Latest leads and calls</h3>
                  </div>
                  <p>{calls.length} calls</p>
                </div>
                <div className="admin-call-table-wrap">
                  <table className="admin-call-table">
                    <thead>
                      <tr><th>Call</th><th>Business</th><th>Lead result</th><th>Answer quality</th><th>Next step</th></tr>
                    </thead>
                    <tbody>
                      {calls.length ? calls.map((call) => (
                        <tr key={call.id}>
                          <td>
                            <strong>{dt(call.startedAt)}</strong>
                            <small>{callDurationText(call.durationSec)} · {call.caller?.phone || "Unknown caller"}</small>
                            <span className={callStatusBadgeClass(call.status)}>{friendlyCallStatus(call.status)}</span>
                          </td>
                          <td>
                            <strong>{call.business?.name || `Business ${call.businessId}`}</strong>
                            <small>{call.aiSummary || call.transcript ? String(call.aiSummary || call.transcript).slice(0, 90) : call.transcriptProtected ? "Transcript stored privately" : "No summary yet"}</small>
                          </td>
                          <td>
                            <Select value={call.outcome || "UNREVIEWED"} onChange={(e) => updateCall(call, { outcome: e.target.value })}>
                              <option value="UNREVIEWED">Waiting for review</option><option value="BOOKED">Job booked</option><option value="QUOTE_NEEDED">Quote needed</option><option value="EMERGENCY">Emergency</option><option value="SPAM">Spam</option><option value="FOLLOW_UP">Follow-up due</option><option value="NOT_A_LEAD">Not a lead</option>
                            </Select>
                          </td>
                          <td><span className={callScoreClass(call.qualityScore)}>{call.qualityScore ?? "—"}</span></td>
                          <td>
                            <div className="admin-call-workflow">
                              <button type="button" onClick={() => loadCallDetails(call)}>Review Call</button>
                              <button type="button" onClick={() => addCallTask(call)}>Add Task</button>
                              <button type="button" onClick={() => addCallNote(call)}>Add Note</button>
                              <button type="button" onClick={() => updateCall(call, { followUpNeeded: !call.followUpNeeded })} className={call.followUpNeeded ? "is-active" : ""}>Follow-up Due</button>
                            </div>
                            {call.tasks?.length ? <small>{call.tasks.filter((task) => task.status === "OPEN").length} open tasks</small> : null}
                          </td>
                        </tr>
                      )) : <tr><td colSpan="5">No calls are shown. After a test call, choose “Check for New Calls,” or change the filters.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </section>

              <aside className="admin-call-card">
                <div className="admin-call-detail-panel">
                  <div className="admin-call-card-head">
                    <div>
                      <span>Call information</span>
                      <h3>Recording &amp; transcript</h3>
                    </div>
                  </div>
                  {selectedCall ? (
                    <div className="admin-call-detail-body">
                      <strong>{selectedCall.business?.name || `Business ${selectedCall.businessId}`}</strong>
                      <span>{dt(selectedCall.startedAt)} · {callDurationText(selectedCall.durationSec)}</span>
                      <p>{selectedCall.aiSummary || "No call summary yet. Choose Check for New Calls after the call has ended."}</p>
                      <div className="admin-call-detail-meta">
                        <div><span>Provider call ID</span><strong>{selectedCall.externalProvider === "vapi" ? selectedCall.externalId || "—" : "Not linked"}</strong></div>
                        <div><span>Transcript</span><strong>{selectedCall.transcriptAvailable ? selectedCall.transcript ? "Visible" : "Stored privately" : "Missing"}</strong></div>
                        <div><span>Recording</span><strong>{selectedCall.recordingAvailable ? selectedCall.recordingUrl ? "Visible" : "Stored privately" : "Missing"}</strong></div>
                      </div>
                      {selectedCall.recordingUrl ? <a className="admin-call-recording-link" href={selectedCall.recordingUrl} target="_blank" rel="noreferrer">Open recording</a> : null}
                      {selectedCall.transcript ? (
                        <pre className="admin-call-transcript">{selectedCall.transcript}</pre>
                      ) : selectedCall.transcriptProtected ? (
                        <div className="admin-call-protected">This transcript is stored securely but hidden by the dashboard privacy settings.</div>
                      ) : (
                        <div className="admin-call-protected">No transcript stored for this call yet.</div>
                      )}
                    </div>
                  ) : (
                    <div className="admin-call-empty">Choose Review Call beside a conversation to see its recording, transcript, and summary.</div>
                  )}
                </div>

                <div className="admin-call-card-head">
                  <div>
                    <span>Needs attention</span>
                    <h3>Follow up first</h3>
                  </div>
                </div>
                <div className="admin-call-review-list">
                  {callInsights.queue.length ? callInsights.queue.map((call) => (
                    <div key={call.id} className="admin-call-review-item">
                      <strong>{call.business?.name || `Business ${call.businessId}`}</strong>
                      <span>{call.caller?.phone || "Unknown caller"} · {callDurationText(call.durationSec)}</span>
                      <em>{friendlyCallOutcome(call.outcome)} · Answer quality {call.qualityScore ?? "—"}</em>
                    </div>
                  )) : <div className="admin-call-empty">You’re caught up. No calls in this view need immediate attention.</div>}
                </div>
              </aside>
            </div>
          </div>
        ) : null}

        {activeTab === "setup" ? (
          <div className="mt-4 grid gap-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-sm font-bold uppercase tracking-[0.2em] text-white/60">Business Setup</div>
                <p className="mt-1 text-sm font-semibold text-white/55">Every business gets a checklist, a clear blocker, and the next action needed to become ready.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={loadCustomerSetup} className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-bold text-white/80">Refresh</button>
                <button type="button" onClick={() => (window.location.hash = "/signup")} className="rounded-full bg-gradient-to-r from-emerald-700 to-amber-500 px-5 py-2 text-sm font-black uppercase tracking-[0.12em] text-white">New Signup</button>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {[
                ["Customers", customerSetup.summary?.total || 0, "All setup rows"],
                ["Ready", customerSetup.summary?.ready || 0, "Fully complete"],
                ["Blocked", customerSetup.summary?.blocked || 0, "Failed step"],
                ["Manual", customerSetup.summary?.manual || 0, "Needs your action"],
                ["Waiting", customerSetup.summary?.waiting || 0, "Pending customer/system"],
              ].map(([label, value, copy]) => (
                <div key={label} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="text-xs font-black uppercase tracking-[0.18em] text-white/50">{label}</div>
                  <div className="mt-1 text-2xl font-extrabold text-white">{value}</div>
                  <div className="mt-1 text-xs font-semibold text-white/45">{copy}</div>
                </div>
              ))}
            </div>

            {customerSetup.warnings?.length ? (
              <div className="grid gap-2">
                {customerSetup.warnings.map((warning) => (
                  <div key={warning} className="rounded-xl border border-amber-300/25 bg-amber-300/10 px-4 py-3 text-sm font-semibold text-amber-100">{warning}</div>
                ))}
              </div>
            ) : null}

            {customerSetup.customers?.length ? customerSetup.customers.map((customer) => (
              <div key={customer.id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-xl font-extrabold text-white">{customer.businessName || "Unnamed business"}</div>
                    <div className="mt-1 text-sm font-semibold text-white/55">
                      {customer.ownerName || "No owner name"} · {customer.ownerEmail || "No email"} · {customer.ownerPhone || customer.businessPhone || "No phone"}
                    </div>
                    <div className="mt-2 text-xs font-semibold text-white/40">
                      Signup: {dt(customer.signedUpAt)} · Calls: {customer.callCount || 0} · Last call: {dt(customer.lastCallAt)}
                    </div>
                  </div>
                  <div className="text-right">
                    <span className={"inline-flex rounded-full border px-3 py-1 text-xs font-black uppercase tracking-[0.12em] " + setupStatusClasses(customer.overallStatus)}>
                      {setupStatusLabel(customer.overallStatus)}
                    </span>
                    <div className="mt-2 text-sm font-black text-white">{customer.readinessPercent || 0}% ready</div>
                  </div>
                </div>

                <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-3">
                  <div className="text-xs font-bold uppercase tracking-[0.16em] text-white/45">Next action</div>
                  <div className="mt-2 text-sm font-semibold text-white/80">{customer.nextAction || "Customer setup is ready."}</div>
                  {customer.blockerLabel ? <div className="mt-1 text-xs font-semibold text-amber-100">Current blocker: {customer.blockerLabel}</div> : null}
                </div>

                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  {(customer.steps || []).map((step) => (
                    <div key={step.key} className={"rounded-xl border p-3 " + setupStatusClasses(step.status)}>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <div className="text-sm font-black text-white">{step.label}</div>
                          <div className="mt-1 text-xs font-semibold opacity-80">{step.reason || step.nextAction}</div>
                          {step.manualOverride ? <div className="mt-1 text-[0.68rem] font-black uppercase tracking-[0.14em] opacity-70">Manual override · {dt(step.manualOverride.updatedAt)}</div> : null}
                        </div>
                        <span className="rounded-full border border-current/25 px-2 py-1 text-[0.68rem] font-black uppercase tracking-[0.12em]">{setupStatusLabel(step.status)}</span>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button type="button" onClick={() => updateCustomerSetupStep(customer, step, "done")} className="rounded-full border border-emerald-200/25 bg-emerald-200/10 px-3 py-1 text-xs font-bold text-emerald-50">Mark done</button>
                        <button type="button" onClick={() => updateCustomerSetupStep(customer, step, "manual")} className="rounded-full border border-blue-200/25 bg-blue-200/10 px-3 py-1 text-xs font-bold text-blue-50">Manual</button>
                        <button type="button" onClick={() => updateCustomerSetupStep(customer, step, "failed")} className="rounded-full border border-rose-200/25 bg-rose-200/10 px-3 py-1 text-xs font-bold text-rose-50">Block</button>
                        {step.manualOverride ? <button type="button" onClick={() => updateCustomerSetupStep(customer, step, "clear")} className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-bold text-white/70">Clear</button> : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )) : <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-white/55">No customer setup rows yet. Submit a signup or create a business first.</div>}
          </div>
        ) : null}

        {activeTab === "businesses" ? (
          <div className="mt-4 grid gap-4">
            <div className="flex justify-between gap-3">
              <div className="text-sm font-bold uppercase tracking-[0.2em] text-white/60">Owners, numbers, and mappings</div>
              <button type="button" onClick={exportBusinessesCsv} className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-bold text-white/80">
                Export CSV
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="text-xs font-black uppercase tracking-[0.18em] text-white/50">Businesses</div>
                <div className="mt-1 text-2xl font-extrabold text-white">{opsOverview.owners?.length || 0}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="text-xs font-black uppercase tracking-[0.18em] text-white/50">Mapped</div>
                <div className="mt-1 text-2xl font-extrabold text-white">{opsOverview.sync?.mappedBusinessCount || 0}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="text-xs font-black uppercase tracking-[0.18em] text-white/50">Synced</div>
                <div className="mt-1 text-2xl font-extrabold text-white">{opsOverview.sync?.businessesWithSyncedCalls || 0}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="text-xs font-black uppercase tracking-[0.18em] text-white/50">Last Sync</div>
                <div className="mt-1 text-sm font-extrabold text-white">{dt(opsOverview.sync?.lastSyncedAt)}</div>
              </div>
            </div>

            <form onSubmit={createBusiness} className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-bold uppercase tracking-[0.2em] text-white/60">Create Business</div>
                  <p className="mt-1 text-sm font-semibold text-white/55">Create the owner record directly, map the known AI phone number, then sync past Vapi calls.</p>
                </div>
                <button type="submit" className="rounded-full bg-gradient-to-r from-emerald-700 to-amber-500 px-5 py-3 text-sm font-black uppercase tracking-[0.12em] text-white">
                  Save Business
                </button>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <Labeled label="Business ID">
                  <Input value={businessDraft.id} onChange={(e) => setBusinessDraft((s) => ({ ...s, id: e.target.value }))} />
                </Labeled>
                <Labeled label="Business Name">
                  <Input value={businessDraft.name} onChange={(e) => setBusinessDraft((s) => ({ ...s, name: e.target.value }))} />
                </Labeled>
                <Labeled label="Business Phone">
                  <Input value={businessDraft.phone} onChange={(e) => setBusinessDraft((s) => ({ ...s, phone: e.target.value }))} />
                </Labeled>
                <Labeled label="Owner Alert Phone">
                  <Input value={businessDraft.ownerPhone} onChange={(e) => setBusinessDraft((s) => ({ ...s, ownerPhone: e.target.value }))} />
                </Labeled>
                <Labeled label="Timezone">
                  <Input value={businessDraft.timezone} onChange={(e) => setBusinessDraft((s) => ({ ...s, timezone: e.target.value }))} />
                </Labeled>
                <Labeled label="Vapi Match Type">
                  <Select value={businessDraft.vapiMatchType} onChange={(e) => setBusinessDraft((s) => ({ ...s, vapiMatchType: e.target.value }))}>
                    <option value="phoneNumber">Phone number</option>
                    <option value="assistantId">Assistant ID</option>
                    <option value="phoneNumberId">Phone number ID</option>
                  </Select>
                </Labeled>
                <Labeled label="Vapi Match Value">
                  <Input value={businessDraft.vapiMatchValue} onChange={(e) => setBusinessDraft((s) => ({ ...s, vapiMatchValue: e.target.value }))} />
                </Labeled>
                <Labeled label="Mapping Label">
                  <Input value={businessDraft.vapiLabel} onChange={(e) => setBusinessDraft((s) => ({ ...s, vapiLabel: e.target.value }))} />
                </Labeled>
              </div>
            </form>

            {opsOverview.sync?.warnings?.length ? (
              <div className="grid gap-2">
                {opsOverview.sync.warnings.slice(0, 3).map((warning) => (
                  <div key={warning} className="rounded-xl border border-amber-300/25 bg-amber-300/10 px-4 py-3 text-sm font-semibold text-amber-100">{warning}</div>
                ))}
              </div>
            ) : null}

            {opsOverview.owners?.length ? opsOverview.owners.map((owner) => (
              <div key={owner.businessId} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-xl font-extrabold text-white">{owner.businessName}</div>
                    <div className="mt-1 text-sm font-semibold text-white/55">Business #{owner.businessId}</div>
                  </div>
                  <span className={"rounded-full border px-3 py-1 text-xs font-black uppercase tracking-[0.12em] " + statusClasses(!owner.needsSetup)}>
                    {owner.needsSetup ? "Needs setup" : "Ready"}
                  </span>
                </div>

                <div className="mt-4 grid gap-3 lg:grid-cols-[0.9fr_0.9fr_1.2fr_1fr]">
                  <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                    <div className="text-xs font-bold uppercase tracking-[0.16em] text-white/45">Owner</div>
                    <div className="mt-2 font-extrabold text-white">{owner.ownerName || "Not recorded"}</div>
                    <div className="mt-1 text-sm font-semibold text-white/60">{owner.ownerPhone || "No owner phone"}</div>
                    <div className="mt-1 text-xs font-semibold text-white/40">{owner.ownerEmail || "No owner email"}</div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                    <div className="text-xs font-bold uppercase tracking-[0.16em] text-white/45">Numbers</div>
                    <div className="mt-2 text-sm font-semibold text-white/70">Business: <span className="text-white">{owner.businessPhone || "—"}</span></div>
                    <div className="mt-1 text-sm font-semibold text-white/70">AI/Vapi: <span className="text-white">{owner.aiNumbers?.length ? owner.aiNumbers.join(", ") : "Not mapped"}</span></div>
                    <div className="mt-1 text-xs font-semibold text-white/40">Alerts go to owner phone above.</div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                    <div className="text-xs font-bold uppercase tracking-[0.16em] text-white/45">Vapi Mappings</div>
                    <div className="mt-2 space-y-2">
                      {owner.vapiMappings?.length ? owner.vapiMappings.map((mapping) => (
                        <div key={mapping.id} className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm">
                          <span className="font-bold text-white">{mapping.matchType}</span>
                          <span className="text-white/55"> · {mapping.matchValue}</span>
                          {mapping.label ? <span className="text-white/40"> · {mapping.label}</span> : null}
                        </div>
                      )) : <div className="text-sm font-semibold text-amber-100">No mapping yet.</div>}
                    </div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                    <div className="text-xs font-bold uppercase tracking-[0.16em] text-white/45">Call Data</div>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                      <div><div className="text-lg font-black text-white">{owner.stats?.recentCallWindow || 0}</div><div className="text-[0.68rem] font-bold uppercase text-white/40">Recent</div></div>
                      <div><div className="text-lg font-black text-white">{owner.stats?.missedCalls || 0}</div><div className="text-[0.68rem] font-bold uppercase text-white/40">Missed</div></div>
                      <div><div className="text-lg font-black text-white">{owner.stats?.followUps || 0}</div><div className="text-[0.68rem] font-bold uppercase text-white/40">Follow</div></div>
                    </div>
                    <div className="mt-3 text-xs font-semibold text-white/45">Last call: {dt(owner.stats?.lastCallAt)}</div>
                    <div className="mt-1 text-xs font-semibold text-white/45">Last sync: {dt(owner.stats?.lastSyncedAt)}</div>
                  </div>
                </div>

                <div className="mt-4 overflow-x-auto rounded-xl border border-white/10 bg-black/20">
                  <table className="min-w-full text-left text-sm">
                    <thead className="border-b border-white/10 text-xs font-bold uppercase tracking-[0.16em] text-white/50">
                      <tr><th className="px-3 py-2">Started</th><th className="px-3 py-2">Caller</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Outcome</th><th className="px-3 py-2">Summary</th></tr>
                    </thead>
                    <tbody>
                      {owner.recentCalls?.length ? owner.recentCalls.map((call) => (
                        <tr key={call.id} className="border-t border-white/5 align-top">
                          <td className="px-3 py-2 text-white/70">{dt(call.startedAt)}</td>
                          <td className="px-3 py-2">{call.caller?.phone || "—"}</td>
                          <td className="px-3 py-2">{call.status}</td>
                          <td className="px-3 py-2">{call.outcome || "UNREVIEWED"}</td>
                          <td className="px-3 py-2 text-white/65">{call.aiSummary || call.transcript ? String(call.aiSummary || call.transcript).slice(0, 120) : call.transcriptProtected ? "Stored (protected)" : "—"}</td>
                        </tr>
                      )) : <tr><td colSpan="5" className="px-3 py-3 text-white/55">No calls synced for this business yet.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            )) : <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-white/55">No businesses found. Run the seed or create businesses through signup/setup first.</div>}
          </div>
        ) : null}

        {activeTab === "sync" ? (
          <div className="admin-system-page">
            <div className="admin-system-header">
              <div>
                <div className="admin-system-eyebrow">System Health</div>
                <h2>Integrations and sync status</h2>
                <p>Checks the services that make signup, checkout, call sync, owner mapping, and cost tracking work together.</p>
              </div>
              <div className="admin-system-actions">
                <button type="button" onClick={() => Promise.allSettled([loadOpsOverview(), loadVapiInventory(), loadCostAudit()])}>Refresh</button>
                <button type="button" onClick={syncVapiCalls} className="admin-system-primary">Sync Vapi Calls</button>
              </div>
            </div>
            {vapiSyncStatus ? <p className="admin-system-status">{vapiSyncStatus}</p> : null}

            <div className="admin-system-score-grid">
              <section className={systemHealth.score >= 80 ? "admin-system-score is-good" : systemHealth.score >= 60 ? "admin-system-score is-warn" : "admin-system-score is-bad"}>
                <span>Health Score</span>
                <strong>{systemHealth.score}%</strong>
                <em>{systemHealth.connected} of {systemHealth.services.length} checks passing</em>
              </section>
              <section className="admin-system-score">
                <span>Warnings</span>
                <strong>{systemHealth.warnings.length}</strong>
                <em>{systemHealth.warnings.length ? "Needs review" : "No known warnings"}</em>
              </section>
              <section className="admin-system-score">
                <span>Synced Calls</span>
                <strong>{opsOverview.sync?.syncStoreCount ?? 0}</strong>
                <em>Vapi records tracked</em>
              </section>
              <section className="admin-system-score">
                <span>Mapped Customers</span>
                <strong>{opsOverview.sync?.mappedBusinessCount ?? 0}</strong>
                <em>Owners connected to AI numbers</em>
              </section>
            </div>

            <section className="admin-system-card">
              <div className="admin-system-card-head">
                <div>
                  <span>Services</span>
                  <h3>What is connected right now</h3>
                </div>
                <p>{API_SOURCE_LABEL}</p>
              </div>
              <div className="admin-system-service-grid">
                {systemHealth.services.map((item) => (
                  <div key={item.label} className={item.ok ? "admin-system-service is-ok" : "admin-system-service is-warn"}>
                    <div>
                      <span className="admin-system-dot" />
                      <strong>{item.label}</strong>
                    </div>
                    <em>{item.status}</em>
                    <p>{item.detail}</p>
                    <small>{item.action}</small>
                  </div>
                ))}
              </div>
            </section>

            <div className="admin-system-grid">
              <section className="admin-system-card">
                <div className="admin-system-card-head">
                  <div>
                    <span>Next Fix</span>
                    <h3>Action queue</h3>
                  </div>
                </div>
                <div className="admin-system-action-list">
                  {systemHealth.actionItems.length ? systemHealth.actionItems.map((item) => (
                    <div key={item.label} className="admin-system-action-item">
                      <strong>{item.label}</strong>
                      <span>{item.action}</span>
                    </div>
                  )) : <div className="admin-system-empty">No urgent system fixes detected.</div>}
                </div>
              </section>

              <section className="admin-system-card">
                <div className="admin-system-card-head">
                  <div>
                    <span>Warnings</span>
                    <h3>Configuration messages</h3>
                  </div>
                </div>
                <div className="admin-system-warning-list">
                  {systemHealth.warnings.length ? systemHealth.warnings.map((warning) => (
                    <div key={warning}>{warning}</div>
                  )) : <div className="admin-system-empty">No sync configuration warnings detected.</div>}
                </div>
              </section>
            </div>

            <section className="admin-system-card">
              <div className="admin-system-card-head">
                <div>
                  <span>Configuration</span>
                  <h3>Sync settings and privacy switches</h3>
                </div>
              </div>
              <div className="admin-system-config-grid">
                {[
                  ["Auto-sync interval", intervalText(opsOverview.sync?.env?.vapiAutoSyncIntervalMs)],
                  ["Auto-sync enabled", opsOverview.sync?.env?.vapiAutoSyncEnabled ? "Yes" : "No"],
                  ["Default business ID", opsOverview.sync?.env?.vapiDefaultBusinessId || "—"],
                  ["Env map entries", opsOverview.sync?.env?.vapiBusinessMapEntries ?? "—"],
                  ["DB mapped businesses", opsOverview.sync?.mappedBusinessCount ?? "—"],
                  ["Synced Vapi records", opsOverview.sync?.syncStoreCount ?? "—"],
                  ["Transcripts visible", opsOverview.sync?.env?.exposeCallTranscriptsInAdmin ? "Yes" : "No"],
                  ["Recording URLs visible", opsOverview.sync?.env?.exposeRecordingUrlsInAdmin ? "Yes" : "No"],
                ].map(([label, value]) => (
                  <div key={label}>
                    <span>{label}</span>
                    <strong>{value}</strong>
                  </div>
                ))}
              </div>
            </section>
          </div>
        ) : null}

        {activeTab === "trials" ? (
          <div className="admin-stripe-page">
            <div className="admin-money-header">
              <div>
                <div className="admin-money-eyebrow">Stripe Trials</div>
                <h2>Live subscriptions in Stripe</h2>
                <p>Read-only billing view from Stripe. Use it to catch trials before they end and spot live-mode test customers.</p>
              </div>
              <div className="admin-money-actions">
                <button type="button" onClick={loadStripeTrials}>Refresh Stripe</button>
                <a href="https://dashboard.stripe.com/subscriptions?status=trialing" target="_blank" rel="noreferrer">Open Stripe</a>
              </div>
            </div>

            {stripeTrials.warnings?.length ? (
              <div className="admin-money-warning-list">
                {stripeTrials.warnings.map((warning) => (
                  <div key={warning}>{warning}</div>
                ))}
              </div>
            ) : null}

            {!stripeTrials.configured ? (
              <section className="admin-money-card">
                <div className="admin-money-card-head">
                  <div>
                    <span>Not Connected</span>
                    <h3>Stripe key missing on the backend</h3>
                  </div>
                </div>
                <p className="admin-stripe-note">Add STRIPE_SECRET_KEY to the backend environment, then refresh this page.</p>
              </section>
            ) : null}

            <div className="admin-money-kpis">
              <div className="admin-money-kpi admin-money-kpi-blue">
                <span>Active Trials</span>
                <strong>{stripeTrials.totals?.activeTrialCount || 0}</strong>
                <em>{stripeTrials.mode === "live" ? "Live mode" : stripeTrials.mode === "test" ? "Test mode" : "Stripe mode unknown"}</em>
              </div>
              <div className={(stripeTrials.totals?.endingSoonWithin3DaysCount || 0) ? "admin-money-kpi admin-money-kpi-red" : "admin-money-kpi admin-money-kpi-green"}>
                <span>Ending Soon</span>
                <strong>{stripeTrials.totals?.endingSoonWithin3DaysCount || 0}</strong>
                <em>Within 3 days</em>
              </div>
              <div className="admin-money-kpi admin-money-kpi-amber">
                <span>All Subscriptions</span>
                <strong>{stripeTrials.totals?.subscriptionsAllStatuses || 0}</strong>
                <em>{Object.entries(stripeTrials.totals?.statusCounts || {}).map(([status, count]) => `${count} ${status}`).join(", ") || "No subscriptions loaded"}</em>
              </div>
              <div className={stripeTrials.account?.payoutsEnabled ? "admin-money-kpi admin-money-kpi-green" : "admin-money-kpi admin-money-kpi-red"}>
                <span>Stripe Account</span>
                <strong>{stripeTrials.account?.chargesEnabled ? "Charges on" : "Check"}</strong>
                <em>{stripeTrials.account?.payoutsEnabled ? "Payouts enabled" : "Payouts not enabled"}</em>
              </div>
            </div>

            <section className="admin-money-card admin-stripe-card">
              <div className="admin-money-card-head">
                <div>
                  <span>Active Trial Queue</span>
                  <h3>Who needs owner follow-up before billing starts</h3>
                </div>
                <p>{stripeTrials.fetchedAt ? `Last checked ${dt(stripeTrials.fetchedAt)}` : "Not loaded yet"}</p>
              </div>
              <div className="admin-money-table-wrap">
                <table className="admin-money-table admin-stripe-table">
                  <thead>
                    <tr>
                      <th>Customer</th>
                      <th>Status</th>
                      <th>Trial Ends</th>
                      <th>Time Left</th>
                      <th>Price</th>
                      <th>Subscription</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stripeTrials.activeTrials?.length ? stripeTrials.activeTrials.map((trial) => {
                      const expiry = trial.expiry || {};
                      return (
                        <tr key={trial.subscriptionId} className="align-top">
                          <td>
                            <strong>{trial.businessName || trial.customerName || "Unnamed customer"}</strong>
                            <small>{trial.customerEmail || trial.customerName || trial.customerId || "No customer details"}</small>
                          </td>
                          <td><span className={stripeStatusBadgeClass(trial.status, expiry.color)}>{trial.status || "unknown"}</span></td>
                          <td>
                            <strong>{dt(trial.trialEndAt)}</strong>
                            {trial.cancelAtPeriodEnd ? <small>Cancel at period end</small> : null}
                          </td>
                          <td>
                            <span className={"admin-stripe-expiry " + expiryClasses(expiry.color)}>{daysText(expiry.daysRemaining)}</span>
                            {expiry.percentUsed != null ? <small>{expiry.percentUsed}% used</small> : null}
                          </td>
                          <td>
                            <strong>{moneyFromCents(trial.priceAmount, trial.priceCurrency || "CAD", trial.priceInterval)}</strong>
                            <small>{trial.priceId || "No price ID"}</small>
                          </td>
                          <td>
                            <strong>{trial.subscriptionId}</strong>
                            <small>Created {dt(trial.createdAt)}</small>
                          </td>
                          <td>
                            {trial.dashboardUrl ? <a href={trial.dashboardUrl} target="_blank" rel="noreferrer" className="admin-stripe-link">Open</a> : "—"}
                          </td>
                        </tr>
                      );
                    }) : <tr><td colSpan="7">No active Stripe trials found.</td></tr>}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="admin-money-card admin-stripe-card">
              <div className="admin-money-card-head">
                <div>
                  <span>Recently Ended</span>
                  <h3>Trials that ended in the last 30 days</h3>
                </div>
                <p>{stripeTrials.totals?.recentlyEndedTrialCountLast30Days || 0} ended</p>
              </div>
              <div className="admin-money-table-wrap">
                <table className="admin-money-table admin-stripe-table">
                  <thead>
                    <tr>
                      <th>Customer</th>
                      <th>Status</th>
                      <th>Trial Ended</th>
                      <th>Price</th>
                      <th>Subscription</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stripeTrials.recentlyEndedTrialsLast30Days?.length ? stripeTrials.recentlyEndedTrialsLast30Days.map((trial) => (
                      <tr key={trial.subscriptionId}>
                        <td>
                          <strong>{trial.businessName || trial.customerName || "Unnamed customer"}</strong>
                          <small>{trial.customerEmail || trial.customerId || "No customer details"}</small>
                        </td>
                        <td><span className={stripeStatusBadgeClass(trial.status, trial.expiry?.color)}>{trial.status || "unknown"}</span></td>
                        <td>{dt(trial.trialEndAt)}</td>
                        <td>{moneyFromCents(trial.priceAmount, trial.priceCurrency || "CAD", trial.priceInterval)}</td>
                        <td>{trial.subscriptionId}</td>
                        <td>{trial.dashboardUrl ? <a href={trial.dashboardUrl} target="_blank" rel="noreferrer" className="admin-stripe-link">Open</a> : "—"}</td>
                      </tr>
                    )) : <tr><td colSpan="6">No recently ended trials found.</td></tr>}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        ) : null}

        {activeTab === "costs" ? (
          <div className="admin-money-page">
            <div className="admin-money-header">
              <div>
                <div className="admin-money-eyebrow">Money Dashboard</div>
                <h2>Paying customers, spend, and profit</h2>
                <p>Revenue uses the live $79/month plan unless Stripe sends a specific amount. Provider spend is normalized from the selected cost window.</p>
              </div>
              <div className="admin-money-actions">
                <Labeled label="Days">
                  <Select value={costDays} onChange={(e) => setCostDays(e.target.value)}>
                    <option value="7">7</option>
                    <option value="30">30</option>
                    <option value="60">60</option>
                    <option value="90">90</option>
                  </Select>
                </Labeled>
                <button type="button" onClick={loadCostAudit}>Refresh</button>
                <button type="button" onClick={exportCostsCsv}>Export CSV</button>
                <button type="button" onClick={syncCosts} className="admin-money-primary">Sync Costs</button>
              </div>
            </div>
            {vapiSyncStatus ? <p className="admin-money-status">{vapiSyncStatus}</p> : null}

            <div className="admin-money-kpis">
              <div className="admin-money-kpi admin-money-kpi-blue">
                <span>Paying Customers</span>
                <strong>{customerFinancialRows.totals.paying}</strong>
                <em>{customerFinancialRows.totals.trialing} trialing</em>
              </div>
              <div className="admin-money-kpi admin-money-kpi-green">
                <span>Monthly Revenue</span>
                <strong>{moneyDashboard(customerFinancialRows.totals.revenueMonthly)}</strong>
                <em>{moneyDashboard(customerFinancialRows.totals.projectedTrialRevenue)} trial pipeline</em>
              </div>
              <div className="admin-money-kpi admin-money-kpi-amber">
                <span>Provider Spend / Mo</span>
                <strong>{moneyDashboard(customerFinancialRows.totals.providerMonthlySpend)}</strong>
                <em>{moneyDashboard(customerFinancialRows.totals.providerWindowSpend)} in {customerFinancialRows.days}d</em>
              </div>
              <div className={customerFinancialRows.totals.profitMonthly >= 0 ? "admin-money-kpi admin-money-kpi-green" : "admin-money-kpi admin-money-kpi-red"}>
                <span>Projected Profit / Mo</span>
                <strong>{moneyDashboard(customerFinancialRows.totals.profitMonthly)}</strong>
                <em>{percentDashboard(customerFinancialRows.totals.margin)} margin</em>
              </div>
            </div>

            {costAudit?.warnings?.length ? (
              <div className="admin-money-warning-list">
                {costAudit.warnings.map((warning) => (
                  <div key={warning}>{warning}</div>
                ))}
              </div>
            ) : null}

            <div className="admin-money-grid">
              <section className="admin-money-card admin-money-main-card">
                <div className="admin-money-card-head">
                  <div>
                    <span>Customer Profitability</span>
                    <h3>Who is paying and what each account costs</h3>
                  </div>
                  <p>{customerFinancialRows.rows.length} customer rows</p>
                </div>
                <div className="admin-money-table-wrap">
                  <table className="admin-money-table">
                    <thead>
                      <tr>
                        <th>Customer</th>
                        <th>Payment</th>
                        <th>Revenue / Mo</th>
                        <th>Spend / Mo</th>
                        <th>Profit / Mo</th>
                        <th>Margin</th>
                        <th>Calls</th>
                        <th>Next Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {customerFinancialRows.rows.length ? customerFinancialRows.rows.map((row) => (
                        <tr key={row.key}>
                          <td>
                            <strong>{row.businessName}</strong>
                            <small>{row.owner} · {row.phone}</small>
                          </td>
                          <td><span className={paymentBadgeClass(row.payment.key)}>{row.payment.label}</span></td>
                          <td>
                            <strong>{moneyDashboard(row.monthlyRevenue)}</strong>
                            {row.projectedRevenue ? <small>{moneyDashboard(row.projectedRevenue)} after trial</small> : null}
                          </td>
                          <td>
                            <strong>{moneyDashboard(row.spendMonthly)}</strong>
                            <small>{moneyDashboard(row.spendWindow)} in {customerFinancialRows.days}d</small>
                          </td>
                          <td className={row.profitMonthly >= 0 ? "admin-money-profit-good" : "admin-money-profit-bad"}>{moneyDashboard(row.profitMonthly)}</td>
                          <td>{percentDashboard(row.margin)}</td>
                          <td>{row.callsWindow}</td>
                          <td>{row.nextAction}</td>
                        </tr>
                      )) : <tr><td colSpan="8">No customer or cost rows found yet.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </section>

              <aside className="admin-money-card">
                <div className="admin-money-card-head">
                  <div>
                    <span>Needs Attention</span>
                    <h3>Money blockers</h3>
                  </div>
                </div>
                <div className="admin-money-attention-list">
                  {customerFinancialRows.attention.length ? customerFinancialRows.attention.map((row) => (
                    <div key={row.key} className="admin-money-attention-item">
                      <strong>{row.businessName}</strong>
                      <span>{row.nextAction}</span>
                      <em>{row.payment.label} · {moneyDashboard(row.spendMonthly)} spend/mo</em>
                    </div>
                  )) : <div className="admin-money-empty">No urgent billing issues in this window.</div>}
                </div>
              </aside>
            </div>

            <section className="admin-money-card">
              <div className="admin-money-card-head">
                <div>
                  <span>Business Spending</span>
                  <h3>Provider cost breakdown</h3>
                </div>
                <p>{customerFinancialRows.days}-day window</p>
              </div>
              <div className="admin-money-breakdown">
                <div><span>Matched Vapi + Twilio calls</span><strong>{moneyDashboard(costAudit?.totals?.callUsageCost)}</strong></div>
                <div><span>Whole Twilio account</span><strong>{moneyDashboard(costAudit?.totals?.twilioCost)}</strong></div>
                <div><span>Fixed / other</span><strong>{moneyDashboard(costAudit?.totals?.fixedCost)}</strong></div>
                <div><span>Unallocated account spend</span><strong>{moneyDashboard(customerFinancialRows.totals.unallocatedWindowSpend)}</strong></div>
              </div>
            </section>

            <details className="admin-money-details">
              <summary>Technical provider audit</summary>

              {costAudit?.twilioAccountUsage?.records?.length ? (
                <div className="admin-money-table-wrap">
                  <div className="admin-money-detail-title">Twilio Account Usage</div>
                  <table className="admin-money-table">
                    <thead>
                      <tr><th>Role</th><th>Category</th><th>Description</th><th>Usage</th><th>Count</th><th>Cost</th></tr>
                    </thead>
                    <tbody>
                      {costAudit.twilioAccountUsage.records.map((record) => (
                        <tr key={`${record.category}:${record.description}:${record.price}`}>
                          <td>{record.isAccountTotal ? "Account total" : record.includedInTotal ? "Counted" : "Breakdown"}</td>
                          <td>{record.category}</td>
                          <td>{record.description}</td>
                          <td>{record.usage ?? "—"} {record.usageUnit || ""}</td>
                          <td>{record.count ?? "—"} {record.countUnit || ""}</td>
                          <td>{money(record.price, record.priceUnit)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}

              {costAudit?.fixedCosts?.records?.length ? (
                <div className="admin-money-table-wrap">
                  <div className="admin-money-detail-title">Fixed Monthly Costs</div>
                  <table className="admin-money-table">
                    <thead>
                      <tr><th>Item</th><th>Monthly</th><th>This Window</th></tr>
                    </thead>
                    <tbody>
                      {costAudit.fixedCosts.records.map((record) => (
                        <tr key={record.label}>
                          <td>{record.label}</td>
                          <td>{money(record.monthlyCost, record.currency)}</td>
                          <td>{money(record.proratedCost, record.currency)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}

              <div className="admin-money-table-wrap">
                <div className="admin-money-detail-title">Matched Cost By AI Number</div>
                <table className="admin-money-table">
                  <thead>
                    <tr><th>Business</th><th>Phone</th><th>Calls</th><th>Priced</th><th>Vapi</th><th>Twilio</th><th>Total</th><th>Avg</th><th>Last Call</th></tr>
                  </thead>
                  <tbody>
                    {costAudit?.summary?.length ? costAudit.summary.map((row) => (
                      <tr key={`${row.businessId}:${row.phoneNumber}`}>
                        <td>{row.businessName}</td>
                        <td>{row.phoneNumber}</td>
                        <td>{row.totalCalls}</td>
                        <td>{row.pricedCalls}</td>
                        <td>{money(row.vapiCost, row.currency)}</td>
                        <td>{money(row.twilioCost, row.currency)}</td>
                        <td>{money(row.totalInternalCost, row.currency)}</td>
                        <td>{money(row.averageCost, row.currency)}</td>
                        <td>{dt(row.lastCallAt)}</td>
                      </tr>
                    )) : <tr><td colSpan="9">No cost data found for this window.</td></tr>}
                  </tbody>
                </table>
              </div>

              <div className="admin-money-table-wrap">
                <div className="admin-money-detail-title">Recent Costed Calls</div>
                <table className="admin-money-table">
                  <thead>
                    <tr><th>Started</th><th>Business</th><th>Caller</th><th>Duration</th><th>Vapi</th><th>Twilio</th><th>Total</th><th>Twilio SID</th></tr>
                  </thead>
                  <tbody>
                    {costAudit?.calls?.length ? costAudit.calls.map((call) => (
                      <tr key={call.id}>
                        <td>{dt(call.startedAt)}</td>
                        <td>{call.business?.name || `Business ${call.businessId}`}</td>
                        <td>{call.caller?.phone || "—"}</td>
                        <td>{call.durationSec ?? "—"}s</td>
                        <td>{money(call.vapiCost, call.twilioPriceUnit)}</td>
                        <td>{money(call.twilioPrice, call.twilioPriceUnit)}</td>
                        <td>{money(call.totalInternalCost, call.twilioPriceUnit)}</td>
                        <td>{call.twilioCallSid || "—"}</td>
                      </tr>
                    )) : <tr><td colSpan="8">No recent calls in this window.</td></tr>}
                  </tbody>
                </table>
              </div>
            </details>
          </div>
        ) : null}

        {activeTab === "signups" ? (
          <div className="mt-4">
            <div className="mb-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-emerald-300/20 bg-emerald-300/10 p-4">
                <div className="text-xs font-black uppercase tracking-[0.18em] text-emerald-100">Green</div>
                <div className="mt-1 text-sm font-semibold text-white/70">Before halfway</div>
              </div>
              <div className="rounded-2xl border border-amber-300/25 bg-amber-300/10 p-4">
                <div className="text-xs font-black uppercase tracking-[0.18em] text-amber-100">Yellow</div>
                <div className="mt-1 text-sm font-semibold text-white/70">Halfway or later</div>
              </div>
              <div className="rounded-2xl border border-rose-300/25 bg-rose-300/10 p-4">
                <div className="text-xs font-black uppercase tracking-[0.18em] text-rose-100">Red</div>
                <div className="mt-1 text-sm font-semibold text-white/70">Close to end or expired</div>
              </div>
            </div>
            <div className="overflow-x-auto rounded-2xl border border-white/10 bg-black/20">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-white/10 text-xs font-bold uppercase tracking-[0.18em] text-white/55">
                  <tr>
                    <th className="px-4 py-3">Signed Up</th>
                    <th className="px-4 py-3">Business</th>
                    <th className="px-4 py-3">Owner</th>
                    <th className="px-4 py-3">Subscription</th>
                    <th className="px-4 py-3">Ends</th>
                    <th className="px-4 py-3">Time Left</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {signups.length ? signups.map((signup, index) => {
                    const expiry = signup.expiry || {};
                    const endAt = signup.trialEndAt || signup.currentPeriodEndAt || signup.periodEndAt;
                    return (
                      <tr key={signup.subscriptionId || signup.ownerEmail || signup.checkoutSessionId || index} className="border-t border-white/5 align-top">
                        <td className="px-4 py-3 text-white/70">{dt(signup.signedUpAt || signup.createdAt)}</td>
                        <td className="px-4 py-3">
                          <div className="font-extrabold text-white">{signup.businessName || "—"}</div>
                          <div className="mt-1 text-xs font-semibold text-white/45">{signup.businessPhone || signup.businessWebsite || ""}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-semibold">{signup.ownerName || "—"}</div>
                          <div className="mt-1 text-xs font-semibold text-white/55">{signup.ownerEmail || "—"}</div>
                          <div className="mt-1 text-xs font-semibold text-white/40">{signup.ownerPhone || ""}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-semibold">{signup.subscriptionStatus || signup.paymentStatus || signup.checkoutStatus || "Not started"}</div>
                          <div className="mt-1 text-xs font-semibold text-white/45">{signup.subscriptionId || signup.checkoutSessionId || ""}</div>
                        </td>
                        <td className="px-4 py-3 text-white/70">{dt(endAt)}</td>
                        <td className="px-4 py-3">
                          <span className={"inline-flex rounded-full border px-3 py-1 text-xs font-black uppercase tracking-[0.12em] " + expiryClasses(expiry.color)}>
                            {daysText(expiry.daysRemaining)}
                          </span>
                          {expiry.percentUsed != null ? <div className="mt-2 h-1.5 w-28 overflow-hidden rounded-full bg-white/10"><div className={"h-full " + (expiry.color === "red" ? "bg-rose-300" : expiry.color === "yellow" ? "bg-amber-300" : "bg-emerald-300")} style={{ width: `${expiry.percentUsed}%` }} /></div> : null}
                        </td>
                        <td className="px-4 py-3">
                          <div className={"inline-flex rounded-full border px-3 py-1 text-xs font-black uppercase tracking-[0.12em] " + expiryClasses(expiry.color)}>
                            {expiry.label || "No end date"}
                          </div>
                          <div className="mt-2 text-xs font-semibold text-white/45">{signup.status || "signup_received"}</div>
                          {signup.emailVerificationRequired && !signup.emailVerified ? <div className="mt-1 text-xs font-semibold text-amber-100">Email verification pending</div> : null}
                        </td>
                      </tr>
                    );
                  }) : <tr><td colSpan="7" className="px-4 py-4 text-white/55">No signups found yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {activeTab === "ops" ? (
          <div className="mt-4">
            <div className="overflow-x-auto rounded-2xl border border-white/10 bg-black/20">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-white/10 text-xs font-bold uppercase tracking-[0.18em] text-white/55">
                  <tr><th className="px-4 py-3">Company</th><th className="px-4 py-3">Calls</th><th className="px-4 py-3">Answered</th><th className="px-4 py-3">Missed</th><th className="px-4 py-3">Missed Rate</th><th className="px-4 py-3">Booked</th><th className="px-4 py-3">Follow Ups</th><th className="px-4 py-3">Avg Duration</th><th className="px-4 py-3">Busiest Hour</th></tr>
                </thead>
                <tbody>
                  {analytics.length ? analytics.map((row) => (
                    <tr key={row.businessId} className="border-t border-white/5">
                      <td className="px-4 py-3 font-semibold">{row.businessName}</td><td className="px-4 py-3">{row.totalCalls}</td><td className="px-4 py-3">{row.answeredCalls}</td><td className="px-4 py-3">{row.missedCalls}</td><td className="px-4 py-3">{row.missedRate}%</td><td className="px-4 py-3">{row.bookedCalls}</td><td className="px-4 py-3">{row.followUps}</td><td className="px-4 py-3">{row.averageDurationSec}s</td><td className="px-4 py-3">{row.busiestHour}</td>
                    </tr>
                  )) : <tr><td colSpan="9" className="px-4 py-4 text-white/55">No call analytics yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {activeTab === "health" ? (
          <div className="mt-4 grid gap-3">
            {trialHealth.length ? trialHealth.map((account, index) => (
              <div key={account.subscriptionId || account.ownerEmail || index} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-extrabold text-white">{account.businessName || "Unnamed business"}</div>
                    <div className="mt-1 text-sm font-semibold text-white/55">{account.ownerName || "—"} · {account.ownerEmail || "—"}</div>
                  </div>
                  <div className={"rounded-full border px-3 py-1 text-xs font-black uppercase tracking-[0.12em] " + expiryClasses(account.expiry?.color)}>
                    {account.expiry?.label || "No end date"}
                  </div>
                </div>
                <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                  {(account.readinessChecklist || []).map((item) => (
                    <div key={item.key} className={"rounded-xl border px-3 py-2 text-sm font-bold " + (item.done ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-100" : "border-amber-300/25 bg-amber-300/10 text-amber-100")}>
                      {item.done ? "Done: " : "Missing: "}{item.label}
                    </div>
                  ))}
                </div>
                <div className="mt-3 text-sm font-semibold text-white/55">Readiness {account.readinessPercent || 0}% · Calls synced {account.callCount || 0}</div>
              </div>
            )) : <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-white/55">No signup health data yet.</div>}
          </div>
        ) : null}

        {activeTab === "vapi" ? (
          <div className="mt-4 grid gap-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-sm font-bold uppercase tracking-[0.2em] text-white/60">Vapi Account</div>
                <p className="mt-1 text-sm font-semibold text-white/55">Phone numbers and agents pulled directly from Vapi. This page only reads Vapi; it does not create or delete anything.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={loadVapiInventory} className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-bold text-white/80">Refresh Vapi</button>
                <button type="button" onClick={syncVapiCalls} className="rounded-full border border-emerald-300/25 bg-emerald-300/10 px-4 py-2 text-sm font-bold text-emerald-100">Sync Calls</button>
                <button type="button" onClick={() => setActiveTab("mappings")} className="rounded-full bg-gradient-to-r from-emerald-700 to-amber-500 px-5 py-2 text-sm font-black uppercase tracking-[0.12em] text-white">Phone Setup</button>
              </div>
            </div>

            {vapiSyncStatus ? <p className="text-sm font-semibold text-emerald-100">{vapiSyncStatus}</p> : null}

            {vapiInventory.warnings?.length ? (
              <div className="grid gap-2">
                {vapiInventory.warnings.map((warning) => (
                  <div key={warning} className="rounded-xl border border-amber-300/25 bg-amber-300/10 px-4 py-3 text-sm font-semibold text-amber-100">{warning}</div>
                ))}
              </div>
            ) : null}

            <FixFirstPanel items={fixFirstItems} onOpen={setActiveTab} onSyncCalls={syncVapiCalls} />

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {[
                ["Phone Numbers", vapiInventory.totals?.phoneNumbers ?? vapiInventory.phoneNumbers?.length ?? 0, "Numbers in Vapi"],
                ["Agents", vapiInventory.totals?.assistants ?? vapiInventory.assistants?.length ?? 0, "Assistants in Vapi"],
                ["Mapped Numbers", vapiInventory.totals?.mappedPhoneNumbers ?? 0, "Connected to customers"],
                ["Mapped Agents", vapiInventory.totals?.mappedAssistants ?? 0, "Connected to customers"],
                ["Last Checked", vapiInventory.fetchedAt ? dt(vapiInventory.fetchedAt) : "Not loaded", "Read-only Vapi sync"],
              ].map(([label, value, copy]) => (
                <div key={label} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="text-xs font-black uppercase tracking-[0.18em] text-white/50">{label}</div>
                  <div className="mt-1 text-xl font-extrabold text-white">{value}</div>
                  <div className="mt-1 text-xs font-semibold text-white/45">{copy}</div>
                </div>
              ))}
            </div>

            <div className="overflow-x-auto rounded-2xl border border-white/10 bg-black/20">
              <div className="border-b border-white/10 px-4 py-3">
                <div className="text-sm font-black uppercase tracking-[0.18em] text-white/60">Vapi Phone Numbers</div>
                <div className="mt-1 text-xs font-semibold text-white/45">Every number Vapi returned, with the customer it is mapped to.</div>
              </div>
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-white/10 text-xs font-bold uppercase tracking-[0.18em] text-white/55">
                  <tr>
                    <th className="px-4 py-3">Number</th>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Agent</th>
                    <th className="px-4 py-3">Provider</th>
                    <th className="px-4 py-3">Customer</th>
                    <th className="px-4 py-3">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {vapiInventory.phoneNumbers?.length ? vapiInventory.phoneNumbers.map((phone) => (
                    <tr key={phone.id || phone.number} className="border-t border-white/5 align-top">
                      <td className="px-4 py-3">
                        <div className="font-extrabold text-white">{phone.number || "No number shown"}</div>
                        <div className="mt-1 max-w-[18rem] break-all text-xs font-semibold text-white/40">{phone.id || "No Vapi ID"}</div>
                      </td>
                      <td className="px-4 py-3 font-semibold">{phone.name || "—"}</td>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-white/80">{phone.assistantName || "Not attached"}</div>
                        <div className="mt-1 max-w-[18rem] break-all text-xs font-semibold text-white/40">{phone.assistantId || ""}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-semibold">{phone.provider || "—"}</div>
                        <div className="mt-1 text-xs font-semibold text-white/45">{phone.status || "No status"}</div>
                      </td>
                      <td className="px-4 py-3">
                        {phone.mappedBusiness ? (
                          <span className="inline-flex rounded-full border border-emerald-300/30 bg-emerald-300/15 px-3 py-1 text-xs font-black uppercase tracking-[0.12em] text-emerald-100">{phone.mappedBusiness.name}</span>
                        ) : (
                          <button type="button" onClick={() => setActiveTab("mappings")} className="rounded-full border border-amber-300/25 bg-amber-300/10 px-3 py-1 text-xs font-black uppercase tracking-[0.12em] text-amber-100">Needs mapping</button>
                        )}
                      </td>
                      <td className="px-4 py-3 text-white/65">{dt(phone.updatedAt || phone.createdAt)}</td>
                    </tr>
                  )) : <tr><td colSpan="6" className="px-4 py-4 text-white/55">No Vapi phone numbers loaded yet. Check VAPI_API_KEY, then refresh.</td></tr>}
                </tbody>
              </table>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-white/10 bg-black/20">
              <div className="border-b border-white/10 px-4 py-3">
                <div className="text-sm font-black uppercase tracking-[0.18em] text-white/60">Vapi Agents</div>
                <div className="mt-1 text-xs font-semibold text-white/45">Every assistant in Vapi, plus attached numbers and customer mapping.</div>
              </div>
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-white/10 text-xs font-bold uppercase tracking-[0.18em] text-white/55">
                  <tr>
                    <th className="px-4 py-3">Agent</th>
                    <th className="px-4 py-3">Model / Voice</th>
                    <th className="px-4 py-3">Phone Numbers</th>
                    <th className="px-4 py-3">Customer</th>
                    <th className="px-4 py-3">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {vapiInventory.assistants?.length ? vapiInventory.assistants.map((assistant) => (
                    <tr key={assistant.id || assistant.name} className="border-t border-white/5 align-top">
                      <td className="px-4 py-3">
                        <div className="font-extrabold text-white">{assistant.name || "Unnamed agent"}</div>
                        <div className="mt-1 max-w-[22rem] break-all text-xs font-semibold text-white/40">{assistant.id || "No Vapi ID"}</div>
                        {assistant.firstMessage ? <div className="mt-2 max-w-md text-xs font-semibold text-white/55">{assistant.firstMessage}</div> : null}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-semibold">{assistant.model || "—"}</div>
                        <div className="mt-1 text-xs font-semibold text-white/45">{assistant.voice || "No voice shown"}</div>
                      </td>
                      <td className="px-4 py-3">
                        {assistant.phoneNumbers?.length ? assistant.phoneNumbers.map((number) => (
                          <div key={number} className="mb-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs font-bold text-white/75">{number}</div>
                        )) : <span className="text-white/50">No numbers attached</span>}
                      </td>
                      <td className="px-4 py-3">
                        {assistant.mappedBusiness ? (
                          <span className="inline-flex rounded-full border border-emerald-300/30 bg-emerald-300/15 px-3 py-1 text-xs font-black uppercase tracking-[0.12em] text-emerald-100">{assistant.mappedBusiness.name}</span>
                        ) : (
                          <button type="button" onClick={() => setActiveTab("mappings")} className="rounded-full border border-amber-300/25 bg-amber-300/10 px-3 py-1 text-xs font-black uppercase tracking-[0.12em] text-amber-100">Needs mapping</button>
                        )}
                      </td>
                      <td className="px-4 py-3 text-white/65">{dt(assistant.updatedAt || assistant.createdAt)}</td>
                    </tr>
                  )) : <tr><td colSpan="5" className="px-4 py-4 text-white/55">No Vapi agents loaded yet. Check VAPI_API_KEY, then refresh.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {activeTab === "mappings" ? (
          <div className="mt-4 grid gap-5 lg:grid-cols-[0.85fr_1.15fr]">
            <form className="rounded-2xl border border-white/10 bg-black/20 p-4" onSubmit={createMapping}>
              <div className="text-sm font-bold uppercase tracking-[0.2em] text-white/60">Add Vapi Mapping</div>
              <div className="mt-4 grid gap-3">
                <Labeled label="Business">
                  <Select value={mappingDraft.businessId} onChange={(e) => setMappingDraft((s) => ({ ...s, businessId: e.target.value }))}>
                    {businesses.length ? businesses.map((business) => <option key={business.id} value={business.id}>{business.name}</option>) : <option value="1">Business 1</option>}
                  </Select>
                </Labeled>
                <Labeled label="Match Type">
                  <Select value={mappingDraft.matchType} onChange={(e) => setMappingDraft((s) => ({ ...s, matchType: e.target.value }))}>
                    <option value="assistantId">Vapi Assistant ID</option><option value="phoneNumberId">Vapi Phone Number ID</option><option value="phone">Phone Number</option>
                  </Select>
                </Labeled>
                <Labeled label="Match Value"><Input value={mappingDraft.matchValue} onChange={(e) => setMappingDraft((s) => ({ ...s, matchValue: e.target.value }))} placeholder="asst_..., pn_..., or +1249..." /></Labeled>
                <Labeled label="Label"><Input value={mappingDraft.label} onChange={(e) => setMappingDraft((s) => ({ ...s, label: e.target.value }))} placeholder="Tim's Electrical main line" /></Labeled>
                <button type="submit" className="rounded-full bg-gradient-to-r from-emerald-700 to-amber-500 px-5 py-3 text-sm font-black uppercase tracking-[0.14em] text-white">Save Mapping</button>
              </div>
            </form>
            <div className="overflow-x-auto rounded-2xl border border-white/10 bg-black/20">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-white/10 text-xs font-bold uppercase tracking-[0.18em] text-white/55"><tr><th className="px-4 py-3">Business</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Value</th><th className="px-4 py-3">Label</th><th className="px-4 py-3"></th></tr></thead>
                <tbody>
                  {vapiMappings.length ? vapiMappings.map((mapping) => (
                    <tr key={mapping.id} className="border-t border-white/5">
                      <td className="px-4 py-3 font-semibold">{mapping.business?.name || mapping.businessId}</td><td className="px-4 py-3">{mapping.matchType}</td><td className="px-4 py-3">{mapping.matchValue}</td><td className="px-4 py-3">{mapping.label || "—"}</td><td className="px-4 py-3"><button type="button" onClick={() => deleteMapping(mapping.id)} className="rounded-full border border-rose-300/25 bg-rose-200/10 px-3 py-1 text-xs font-bold text-rose-100">Delete</button></td>
                    </tr>
                  )) : <tr><td colSpan="5" className="px-4 py-4 text-white/55">No Vapi mappings yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {activeTab === "digest" ? (
          <div className="mt-4 grid gap-4">
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={loadDigest} className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-bold text-white/80">Refresh Digest</button>
              <button type="button" onClick={async () => { const data = await api("/api/admin/daily-digest/send", { method: "POST" }); setDigest(data.digest || digest); }} className="rounded-full bg-gradient-to-r from-emerald-700 to-amber-500 px-4 py-2 text-sm font-black uppercase tracking-[0.12em] text-white">Send Digest</button>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="text-sm font-bold uppercase tracking-[0.2em] text-white/60">Follow Ups</div>
              <div className="mt-3 space-y-2">
                {digest?.followUps?.length ? digest.followUps.map((call) => (
                  <div key={call.id} className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm">
                    <span className="font-bold">{call.business?.name || `Business ${call.businessId}`}</span> · {dt(call.startedAt)} · {call.caller?.phone || "—"} · {call.outcome || call.status}
                  </div>
                )) : <div className="text-white/55">No follow-ups in the current digest window.</div>}
              </div>
            </div>
          </div>
        ) : null}

        {activeTab === "faqs" ? (
          <div className="mt-4 grid gap-5 lg:grid-cols-[0.95fr_1.05fr]">
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="text-sm font-bold uppercase tracking-[0.2em] text-white/60">Create FAQ</div>
              <form className="mt-4 space-y-3" onSubmit={createFaq}>
                <Labeled label="Question"><Input value={faqDraft.question} onChange={(e) => setFaqDraft((s) => ({ ...s, question: e.target.value }))} /></Labeled>
                <Labeled label="Answer"><Textarea rows={4} value={faqDraft.answer} onChange={(e) => setFaqDraft((s) => ({ ...s, answer: e.target.value }))} /></Labeled>
                <Labeled label="Tags"><Input value={faqDraft.tags} onChange={(e) => setFaqDraft((s) => ({ ...s, tags: e.target.value }))} placeholder="hours,booking" /></Labeled>
                <button type="submit" className="rounded-full bg-gradient-to-r from-emerald-700 to-amber-500 px-5 py-3 text-sm font-black uppercase tracking-[0.14em] text-white">Save FAQ</button>
              </form>
            </div>
            <div className="space-y-3">
              {faqs.length ? faqs.map((faq) => <FaqRow key={faq.id} faq={faq} onSave={updateFaq} onDelete={removeFaq} />) : <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-white/55">No FAQs yet.</div>}
            </div>
          </div>
        ) : null}

        {activeTab === "settings" ? (
          <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="text-sm font-bold uppercase tracking-[0.2em] text-white/60">Settings Editor</div>
            {!settings ? <p className="mt-3 text-white/55">No settings loaded.</p> : (
              <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={saveSettings}>
                <Labeled label="Answer After Rings"><Input type="number" min="1" max="10" value={settings.answerAfterRings ?? 3} onChange={(e) => setSettings((s) => ({ ...s, answerAfterRings: e.target.value }))} /></Labeled>
                <Labeled label="After Hours Mode">
                  <Select value={settings.afterHoursMode || "AI_ALWAYS_ON"} onChange={(e) => setSettings((s) => ({ ...s, afterHoursMode: e.target.value }))}>
                    <option value="AI_ALWAYS_ON">AI_ALWAYS_ON</option><option value="AI_BUSINESS_HOURS_ONLY">AI_BUSINESS_HOURS_ONLY</option><option value="VOICEMAIL_ONLY">VOICEMAIL_ONLY</option><option value="FORWARD_TO_OWNER">FORWARD_TO_OWNER</option>
                  </Select>
                </Labeled>
                <Labeled label="Owner Phone"><Input value={settings.ownerPhone || ""} onChange={(e) => setSettings((s) => ({ ...s, ownerPhone: e.target.value }))} /></Labeled>
                <Labeled label="Backup Escalation Phone"><Input value={settings.backupPhone || ""} onChange={(e) => setSettings((s) => ({ ...s, backupPhone: e.target.value }))} placeholder="Approved backup contact" /></Labeled>
                <Labeled label="Booking Link"><Input value={settings.bookingLink || ""} onChange={(e) => setSettings((s) => ({ ...s, bookingLink: e.target.value }))} placeholder="https://..." /></Labeled>
                <div className="sm:col-span-2"><button type="submit" className="rounded-full bg-gradient-to-r from-emerald-700 to-amber-500 px-6 py-3 text-sm font-black uppercase tracking-[0.14em] text-white">Save Settings</button></div>
              </form>
            )}
          </div>
        ) : null}
        </section>
      </div>
    </main>
  );
}

function FaqRow({ faq, onSave, onDelete }) {
  const [draft, setDraft] = useState({ question: faq.question || "", answer: faq.answer || "", tags: faq.tags || "" });
  useEffect(() => { setDraft({ question: faq.question || "", answer: faq.answer || "", tags: faq.tags || "" }); }, [faq.answer, faq.question, faq.tags]);

  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
      <div className="grid gap-3">
        <Labeled label="Question"><Input value={draft.question} onChange={(e) => setDraft((s) => ({ ...s, question: e.target.value }))} /></Labeled>
        <Labeled label="Answer"><Textarea rows={3} value={draft.answer} onChange={(e) => setDraft((s) => ({ ...s, answer: e.target.value }))} /></Labeled>
        <Labeled label="Tags"><Input value={draft.tags} onChange={(e) => setDraft((s) => ({ ...s, tags: e.target.value }))} /></Labeled>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => onSave({ id: faq.id, ...draft })} className="rounded-full bg-white/10 px-4 py-2 text-sm font-bold text-white">Update</button>
        <button type="button" onClick={() => onDelete(faq.id)} className="rounded-full border border-rose-300/25 bg-rose-200/10 px-4 py-2 text-sm font-bold text-rose-100">Delete</button>
        <div className="ml-auto text-xs font-semibold text-white/45">Updated {dt(faq.updatedAt)}</div>
      </div>
    </div>
  );
}
