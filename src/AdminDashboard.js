import React, { useEffect, useMemo, useState } from "react";
import "./AdminDashboard.css";
import { getDefaultApiBaseUrl, normalizeApiBase } from "./config/apiBase";

const API_BASE = normalizeApiBase(process.env.REACT_APP_API_BASE_URL || getDefaultApiBaseUrl());
const ADMIN_API_TIMEOUT_MS = 6500;

async function api(path, { method = "GET", body } = {}) {
  const headers = { "Content-Type": "application/json" };
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
        <p>Check setup status, integrations, and customer call records from one control center.</p>
        <button type="button" onClick={() => onSelect("sync")}>Open setup checks</button>
      </div>
      <button type="button" className="admin-concept-user" onClick={onLock}>
        <span>OC</span>
        <span><strong>Ollie in Canada</strong><small>Admin</small></span>
      </button>
    </aside>
  );
}

function ConceptTopBar({ loading, onRefresh, onSyncCosts, onSite }) {
  return (
    <header className="admin-concept-topbar">
      <div>
        <h1>Control Center</h1>
        <p>Overview of your AI phone answering operation.</p>
      </div>
      <div className="admin-concept-top-actions">
        <div className="admin-concept-search">Search owners, numbers, calls...</div>
        <div className="admin-concept-range">Last 30 days</div>
        <button type="button" className="admin-concept-status" onClick={onRefresh}>
          <span className="admin-dot admin-dot-green" />
          {loading ? "Syncing..." : "All systems check"}
        </button>
        <button type="button" className="admin-concept-primary" onClick={onSyncCosts}>Sync Costs</button>
        <button type="button" className="admin-concept-ghost" onClick={onSite}>Site</button>
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
  const total = Math.max(vapi + twilio, 1);
  const vapiPct = Math.round((vapi / total) * 100);
  const twilioPct = Math.round((twilio / total) * 100);
  const otherPct = Math.max(0, 100 - vapiPct - twilioPct);
  return (
    <div className="admin-cost-bars">
      <div><span className="admin-dot admin-dot-teal" />AI Voice (Vapi)<strong>{moneyCompact(vapi)}</strong></div>
      <div><span className="admin-dot admin-dot-red" />Phone (Twilio)<strong>{moneyCompact(twilio)}</strong></div>
      <div><span className="admin-dot admin-dot-slate" />Other<strong>{otherPct}%</strong></div>
      <div className="admin-cost-stack">
        <span style={{ width: `${vapiPct}%` }} />
        <span style={{ width: `${twilioPct}%` }} />
        <span style={{ width: `${otherPct}%` }} />
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

function ConceptOverview({
  setupItems,
  setupScore,
  stats,
  opsOverview,
  costAudit,
  calls,
  signups,
  onOpenTab,
  onSyncCosts,
}) {
  const aiNumbers = (opsOverview.owners || []).reduce((total, owner) => total + (owner.aiNumbers?.length || 0), 0);
  const activeOwners = (opsOverview.owners || []).filter((owner) => !owner.needsSetup).length;
  const warnings = [...(opsOverview.sync?.warnings || []), ...(costAudit?.warnings || [])];
  const totalCalls = costAudit?.totals?.totalCalls || calls.length;
  const totalSpend = costAudit?.totals?.totalInternalCost || stats.totalCost;
  const avgCost = totalCalls ? totalSpend / totalCalls : 0;

  return (
    <div className="admin-concept-overview">
      <div className="admin-overview-top-grid">
        <ConceptReadiness items={setupItems} score={setupScore} onOpenSetup={() => onOpenTab("sync")} />
        <IntegrationCard name="Vapi" subtitle="AI Voice Platform" ok={opsOverview.sync?.env?.vapiApiKeyConfigured} accent="vapi" onOpen={() => onOpenTab("sync")} />
        <IntegrationCard name="Twilio" subtitle="Phone System" ok={opsOverview.sync?.env?.twilioConfigured} accent="twilio" onOpen={() => onOpenTab("sync")} />
        <IntegrationCard name="Stripe" subtitle="Payments" ok={opsOverview.sync?.env?.stripeConfigured} accent="stripe" onOpen={() => onOpenTab("sync")} />
        <section className="admin-card admin-sync-card">
          <div className="admin-sync-icon">R</div>
          <h3>Sync Costs</h3>
          <p>Last synced<br />{dt(opsOverview.sync?.lastSyncedAt)}</p>
          <button type="button" className="admin-card-action" onClick={onSyncCosts}>Sync Now</button>
        </section>
      </div>

      <div className="admin-kpi-grid">
        <KpiCard title="Business Owners" value={stats.owners} sub="Total Owners" delta={`${activeOwners} active`} onOpen={() => onOpenTab("businesses")}>
          <div className="admin-kpi-list">
            <div><span className="admin-dot admin-dot-green" />Active<strong>{activeOwners}</strong></div>
            <div><span className="admin-dot admin-dot-blue" />In Trial<strong>{stats.signups}</strong></div>
            <div><span className="admin-dot admin-dot-orange" />Setup Incomplete<strong>{Math.max(stats.owners - activeOwners, 0)}</strong></div>
          </div>
        </KpiCard>
        <KpiCard title="Phone Numbers" value={aiNumbers} sub="AI numbers mapped" delta={`${stats.mappedOwners} businesses`} onOpen={() => onOpenTab("mappings")}>
          <div className="admin-kpi-list">
            <div><span className="admin-dot admin-dot-green" />Mapped<strong>{stats.mappedOwners}</strong></div>
            <div><span className="admin-dot admin-dot-orange" />Need mapping<strong>{Math.max(stats.owners - stats.mappedOwners, 0)}</strong></div>
          </div>
        </KpiCard>
        <KpiCard title="Calls This Week" value={totalCalls} sub="Total calls">
          <MiniLineChart calls={calls} />
        </KpiCard>
        <KpiCard title="Call Cost This Week" value={moneyCompact(totalSpend)} sub="Total spend" delta={`${costAudit?.totals?.pricedCalls || 0} priced`}>
          <CostBars totals={costAudit?.totals} />
        </KpiCard>
      </div>

      <div className="admin-bottom-grid">
        <ConceptRecentCalls calls={calls} onOpen={() => onOpenTab("calls")} />
        <ConceptTrialSignups signups={signups} onOpen={() => onOpenTab("signups")} />
        <ConceptSetupAlerts warnings={warnings} onOpenSetup={() => onOpenTab("sync")} onOpenOwners={() => onOpenTab("businesses")} />
      </div>

      <div className="admin-bottom-strip">
        <div><span>Owners</span><strong>{stats.owners}</strong></div>
        <div><span>Active Numbers</span><strong>{aiNumbers}</strong></div>
        <div><span>Calls</span><strong>{totalCalls}</strong></div>
        <div><span>Total Spend</span><strong>{moneyCompact(totalSpend)}</strong></div>
        <div><span>Avg Cost / Call</span><strong>{moneyCompact(avgCost)}</strong></div>
        <div><span>Setup Warnings</span><strong>{warnings.length}</strong></div>
      </div>
    </div>
  );
}

export default function AdminDashboard() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [candidate, setCandidate] = useState("");
  const [activeTab, setActiveTab] = useState("overview");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [gateBusy, setGateBusy] = useState(false);
  const [vapiSyncStatus, setVapiSyncStatus] = useState("");

  const [leads, setLeads] = useState([]);
  const [calls, setCalls] = useState([]);
  const [signups, setSignups] = useState([]);
  const [analytics, setAnalytics] = useState([]);
  const [trialHealth, setTrialHealth] = useState([]);
  const [customerSetup, setCustomerSetup] = useState({ customers: [], summary: null, warnings: [] });
  const [vapiMappings, setVapiMappings] = useState([]);
  const [businesses, setBusinesses] = useState([]);
  const [opsOverview, setOpsOverview] = useState({ owners: [], sync: null });
  const [costAudit, setCostAudit] = useState(null);
  const [digest, setDigest] = useState(null);
  const [faqs, setFaqs] = useState([]);
  const [settings, setSettings] = useState(null);

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
    }),
    [leads.length, calls.length, signups.length, opsOverview.owners?.length, opsOverview.sync, costAudit, customerSetup.summary, faqs.length, settings]
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

  const navGroups = useMemo(
    () => [
      {
        title: "Command",
        items: [
          ["overview", "Overview", "Health, alerts, and next actions"],
          ["setup", "Customer Setup", "Where every customer is stuck"],
          ["businesses", "Businesses", "Owners, numbers, mappings"],
          ["signups", "Signups", "Trial and checkout pipeline"],
          ["health", "Trial Health", "Readiness by customer"],
        ],
      },
      {
        title: "Calls",
        items: [
          ["calls", "Calls", "Review calls and follow-ups"],
          ["costs", "Costs", "Vapi + Twilio spend"],
          ["ops", "Metrics", "Answered, missed, booked"],
          ["digest", "Daily Digest", "Owner follow-up summary"],
        ],
      },
      {
        title: "Setup",
        items: [
          ["sync", "Sync Health", "API keys and sync status"],
          ["mappings", "Vapi Mapping", "Connect numbers to owners"],
          ["faqs", "FAQ Editor", "Assistant answer library"],
          ["settings", "Settings", "Rings, hours, owner phone"],
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

  const loadAnalytics = async () => {
    const data = await api("/api/admin/calls/analytics?days=30");
    setAnalytics(data.analytics || []);
  };

  const loadTrialHealth = async () => {
    const data = await api("/api/admin/trial-health");
    setTrialHealth(data.accounts || []);
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
      `myai-admin-costs-${costDays || 30}d.csv`,
      ["Business", "Phone", "Calls", "Priced", "Vapi", "Twilio", "Total", "Average", "Last call"],
      (costAudit?.summary || []).map((row) => [
        row.businessName,
        row.phoneNumber,
        row.totalCalls,
        row.pricedCalls,
        row.vapiCost ?? "",
        row.twilioCost ?? "",
        row.totalInternalCost ?? "",
        row.averageInternalCost ?? "",
        row.lastCallAt || "",
      ])
    );
  };

  const refresh = async () => {
    if (!isAuthenticated) return;
    setLoading(true);
    setError("");
    try {
      if (activeTab === "leads") await loadLeads();
      if (activeTab === "overview") {
        await Promise.allSettled([loadOpsOverview(), loadCostAudit(), loadCalls(), loadSignups(), loadAnalytics()]);
      }
      if (activeTab === "setup") await loadCustomerSetup();
      if (activeTab === "businesses") await loadOpsOverview();
      if (activeTab === "calls") await loadCalls();
      if (activeTab === "signups") await loadSignups();
      if (activeTab === "ops") await loadAnalytics();
      if (activeTab === "health") await loadTrialHealth();
      if (activeTab === "costs") await loadCostAudit();
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

  const unlock = async (e) => {
    e.preventDefault();
    setGateBusy(true);
    setError("");
    try {
      await api("/api/admin/login", { method: "POST", body: { password: candidate } });
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
      setIsAuthenticated(false);
      setLeads([]);
      setCalls([]);
      setSignups([]);
      setAnalytics([]);
      setTrialHealth([]);
      setCustomerSetup({ customers: [], summary: null, warnings: [] });
      setVapiMappings([]);
      setBusinesses([]);
      setOpsOverview({ owners: [], sync: null });
      setCostAudit(null);
      setDigest(null);
      setFaqs([]);
      setSettings(null);
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
            onRefresh={refresh}
            onSyncCosts={syncCosts}
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
            setupItems={setupItems}
            setupScore={setupScore}
            stats={stats}
            opsOverview={opsOverview}
            costAudit={costAudit}
            calls={calls}
            signups={signups}
            onOpenTab={setActiveTab}
            onSyncCosts={syncCosts}
          />
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
          <div className="mt-4">
            <div className="mb-4 grid gap-3 lg:grid-cols-[1fr_1fr_1fr_1.2fr_auto]">
              <Labeled label="Status">
                <Select value={callFilters.status} onChange={(e) => setCallFilters((s) => ({ ...s, status: e.target.value }))}>
                  <option value="">All</option><option value="STARTED">STARTED</option><option value="COMPLETED">COMPLETED</option><option value="MISSED">MISSED</option><option value="FAILED">FAILED</option>
                </Select>
              </Labeled>
              <Labeled label="Outcome">
                <Select value={callFilters.outcome} onChange={(e) => setCallFilters((s) => ({ ...s, outcome: e.target.value }))}>
                  <option value="">All</option><option value="UNREVIEWED">UNREVIEWED</option><option value="BOOKED">BOOKED</option><option value="QUOTE_NEEDED">QUOTE_NEEDED</option><option value="EMERGENCY">EMERGENCY</option><option value="SPAM">SPAM</option><option value="FOLLOW_UP">FOLLOW_UP</option><option value="NOT_A_LEAD">NOT_A_LEAD</option>
                </Select>
              </Labeled>
              <Labeled label="Min Duration (sec)">
                <Input type="number" min="0" value={callFilters.minDuration} onChange={(e) => setCallFilters((s) => ({ ...s, minDuration: e.target.value }))} />
              </Labeled>
              <Labeled label="Search transcripts">
                <Input value={callFilters.search} onChange={(e) => setCallFilters((s) => ({ ...s, search: e.target.value }))} onKeyDown={(e) => { if (e.key === "Enter") loadCalls(); }} placeholder="name, phone, service..." />
              </Labeled>
              <div className="flex items-end gap-2">
                <button type="button" onClick={exportCallsCsv} className="w-full rounded-full border border-white/15 bg-white/5 px-4 py-3 text-sm font-bold text-white/80">
                  Export CSV
                </button>
                <button type="button" onClick={syncVapiCalls} className="w-full rounded-full bg-gradient-to-r from-emerald-700 to-amber-500 px-5 py-3 text-sm font-black uppercase tracking-[0.12em] text-white">
                  Sync Vapi Calls
                </button>
              </div>
            </div>
            {vapiSyncStatus ? <p className="mb-3 text-sm font-semibold text-emerald-100">{vapiSyncStatus}</p> : null}
            <div className="overflow-x-auto rounded-2xl border border-white/10 bg-black/20">
              <table className="admin-calls-table min-w-full text-left text-sm">
                <thead className="border-b border-white/10 text-xs font-bold uppercase tracking-[0.18em] text-white/55">
                  <tr><th className="px-4 py-3">Started</th><th className="px-4 py-3">Company</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Outcome</th><th className="px-4 py-3">Score</th><th className="px-4 py-3">Duration</th><th className="px-4 py-3">Caller</th><th className="px-4 py-3">Workflow</th></tr>
                </thead>
                <tbody>
                  {calls.length ? calls.map((call) => (
                    <tr key={call.id} className="border-t border-white/5 align-top">
                      <td className="px-4 py-3">{dt(call.startedAt)}</td>
                      <td className="px-4 py-3 font-semibold">{call.business?.name || `Business ${call.businessId}`}</td>
                      <td className="px-4 py-3">{call.status}</td>
                      <td className="px-4 py-3">
                        <Select value={call.outcome || "UNREVIEWED"} onChange={(e) => updateCall(call, { outcome: e.target.value })}>
                          <option value="UNREVIEWED">UNREVIEWED</option><option value="BOOKED">BOOKED</option><option value="QUOTE_NEEDED">QUOTE</option><option value="EMERGENCY">EMERGENCY</option><option value="SPAM">SPAM</option><option value="FOLLOW_UP">FOLLOW_UP</option><option value="NOT_A_LEAD">NOT_A_LEAD</option>
                        </Select>
                      </td>
                      <td className="px-4 py-3 font-black">{call.qualityScore ?? "—"}</td>
                      <td className="px-4 py-3">{call.durationSec ?? "—"}</td>
                      <td className="px-4 py-3">{call.caller?.phone || "—"}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          <button type="button" onClick={() => addCallTask(call)} className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-bold text-white/80">Task</button>
                          <button type="button" onClick={() => addCallNote(call)} className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-bold text-white/80">Note</button>
                          <button type="button" onClick={() => updateCall(call, { followUpNeeded: !call.followUpNeeded })} className={"rounded-full border px-3 py-1 text-xs font-bold " + (call.followUpNeeded ? "border-amber-300/30 bg-amber-300/15 text-amber-100" : "border-white/15 bg-white/5 text-white/70")}>Follow Up</button>
                        </div>
                        {call.tasks?.length ? <div className="mt-2 text-xs font-semibold text-white/45">{call.tasks.filter((task) => task.status === "OPEN").length} open tasks</div> : null}
                      </td>
                    </tr>
                  )) : <tr><td colSpan="8" className="px-4 py-4 text-white/55">No calls found.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {activeTab === "setup" ? (
          <div className="mt-4 grid gap-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-sm font-bold uppercase tracking-[0.2em] text-white/60">Customer Setup Command Center</div>
                <p className="mt-1 text-sm font-semibold text-white/55">Every signup gets a live checklist, a blocker, and the next action to move it forward.</p>
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
          <div className="mt-4 grid gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-bold uppercase tracking-[0.2em] text-white/60">Sync Health</div>
                <p className="mt-1 text-sm font-semibold text-white/55">Checks whether admin can pull Vapi calls and attach them to the right business owner.</p>
              </div>
              <button type="button" onClick={syncVapiCalls} className="rounded-full bg-gradient-to-r from-emerald-700 to-amber-500 px-5 py-3 text-sm font-black uppercase tracking-[0.12em] text-white">
                Sync Vapi Calls
              </button>
            </div>
            {vapiSyncStatus ? <p className="text-sm font-semibold text-emerald-100">{vapiSyncStatus}</p> : null}

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["Database", Boolean(opsOverview.sync?.env?.databaseAvailable)],
                ["Vapi API Key", opsOverview.sync?.env?.vapiApiKeyConfigured],
                ["Twilio", opsOverview.sync?.env?.twilioConfigured],
                ["Auto Sync", opsOverview.sync?.env?.vapiAutoSyncEnabled],
                ["Mappings", Boolean(opsOverview.sync?.mappedBusinessCount)],
                ["Admin Password", !opsOverview.sync?.env?.adminPasswordLooksDefault],
              ].map(([label, ok]) => (
                <div key={label} className={"rounded-2xl border p-4 " + statusClasses(ok)}>
                  <div className="text-xs font-black uppercase tracking-[0.16em] opacity-75">{label}</div>
                  <div className="mt-2 text-lg font-extrabold">{yesNo(ok)}</div>
                </div>
              ))}
            </div>

            <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="text-sm font-bold uppercase tracking-[0.2em] text-white/60">Configuration</div>
                <div className="mt-4 space-y-3 text-sm font-semibold text-white/70">
                  <div className="flex justify-between gap-4"><span>Auto-sync interval</span><span className="text-white">{intervalText(opsOverview.sync?.env?.vapiAutoSyncIntervalMs)}</span></div>
                  <div className="flex justify-between gap-4"><span>Default business ID</span><span className="text-white">{opsOverview.sync?.env?.vapiDefaultBusinessId || "—"}</span></div>
                  <div className="flex justify-between gap-4"><span>Env map entries</span><span className="text-white">{opsOverview.sync?.env?.vapiBusinessMapEntries ?? "—"}</span></div>
                  <div className="flex justify-between gap-4"><span>DB mapped businesses</span><span className="text-white">{opsOverview.sync?.mappedBusinessCount ?? "—"}</span></div>
                  <div className="flex justify-between gap-4"><span>Synced Vapi records</span><span className="text-white">{opsOverview.sync?.syncStoreCount ?? "—"}</span></div>
                  <div className="flex justify-between gap-4"><span>Transcripts visible</span><span className="text-white">{opsOverview.sync?.env?.exposeCallTranscriptsInAdmin ? "Yes" : "No"}</span></div>
                  <div className="flex justify-between gap-4"><span>Recording URLs visible</span><span className="text-white">{opsOverview.sync?.env?.exposeRecordingUrlsInAdmin ? "Yes" : "No"}</span></div>
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="text-sm font-bold uppercase tracking-[0.2em] text-white/60">Warnings</div>
                <div className="mt-4 space-y-2">
                  {opsOverview.sync?.warnings?.length ? opsOverview.sync.warnings.map((warning) => (
                    <div key={warning} className="rounded-xl border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-sm font-semibold text-amber-100">{warning}</div>
                  )) : <div className="rounded-xl border border-emerald-300/20 bg-emerald-300/10 px-3 py-2 text-sm font-semibold text-emerald-100">No sync configuration warnings detected.</div>}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {activeTab === "costs" ? (
          <div className="mt-4 grid gap-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <div className="text-sm font-bold uppercase tracking-[0.2em] text-white/60">Cost Audit</div>
                <p className="mt-1 text-sm font-semibold text-white/55">Per-call internal cost from Vapi plus Twilio, grouped by business phone number.</p>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <Labeled label="Days">
                  <Select value={costDays} onChange={(e) => setCostDays(e.target.value)}>
                    <option value="7">7</option>
                    <option value="30">30</option>
                    <option value="60">60</option>
                    <option value="90">90</option>
                  </Select>
                </Labeled>
                <button type="button" onClick={loadCostAudit} className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-bold text-white/80">Refresh</button>
                <button type="button" onClick={exportCostsCsv} className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-bold text-white/80">Export CSV</button>
                <button type="button" onClick={syncCosts} className="rounded-full bg-gradient-to-r from-emerald-700 to-amber-500 px-5 py-3 text-sm font-black uppercase tracking-[0.12em] text-white">Sync Costs</button>
              </div>
            </div>
            {vapiSyncStatus ? <p className="text-sm font-semibold text-emerald-100">{vapiSyncStatus}</p> : null}

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="text-xs font-black uppercase tracking-[0.18em] text-white/50">Calls</div>
                <div className="mt-1 text-2xl font-extrabold text-white">{costAudit?.totals?.totalCalls || 0}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="text-xs font-black uppercase tracking-[0.18em] text-white/50">Priced</div>
                <div className="mt-1 text-2xl font-extrabold text-white">{costAudit?.totals?.pricedCalls || 0}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="text-xs font-black uppercase tracking-[0.18em] text-white/50">Vapi</div>
                <div className="mt-1 text-xl font-extrabold text-white">{money(costAudit?.totals?.vapiCost)}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="text-xs font-black uppercase tracking-[0.18em] text-white/50">Twilio</div>
                <div className="mt-1 text-xl font-extrabold text-white">{money(costAudit?.totals?.twilioCost)}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="text-xs font-black uppercase tracking-[0.18em] text-white/50">Total Cost</div>
                <div className="mt-1 text-xl font-extrabold text-white">{money(costAudit?.totals?.totalInternalCost)}</div>
              </div>
            </div>

            {costAudit?.warnings?.length ? (
              <div className="grid gap-2">
                {costAudit.warnings.map((warning) => (
                  <div key={warning} className="rounded-xl border border-amber-300/25 bg-amber-300/10 px-4 py-3 text-sm font-semibold text-amber-100">{warning}</div>
                ))}
              </div>
            ) : null}

            <div className="overflow-x-auto rounded-2xl border border-white/10 bg-black/20">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-white/10 text-xs font-bold uppercase tracking-[0.18em] text-white/55">
                  <tr><th className="px-4 py-3">Business</th><th className="px-4 py-3">Phone</th><th className="px-4 py-3">Calls</th><th className="px-4 py-3">Priced</th><th className="px-4 py-3">Vapi</th><th className="px-4 py-3">Twilio</th><th className="px-4 py-3">Total</th><th className="px-4 py-3">Avg</th><th className="px-4 py-3">Last Call</th></tr>
                </thead>
                <tbody>
                  {costAudit?.summary?.length ? costAudit.summary.map((row) => (
                    <tr key={`${row.businessId}:${row.phoneNumber}`} className="border-t border-white/5 align-top">
                      <td className="px-4 py-3 font-semibold">{row.businessName}</td>
                      <td className="px-4 py-3">{row.phoneNumber}</td>
                      <td className="px-4 py-3">{row.totalCalls}</td>
                      <td className="px-4 py-3">{row.pricedCalls}</td>
                      <td className="px-4 py-3">{money(row.vapiCost, row.currency)}</td>
                      <td className="px-4 py-3">{money(row.twilioCost, row.currency)}</td>
                      <td className="px-4 py-3 font-extrabold text-white">{money(row.totalInternalCost, row.currency)}</td>
                      <td className="px-4 py-3">{money(row.averageCost, row.currency)}</td>
                      <td className="px-4 py-3 text-white/70">{dt(row.lastCallAt)}</td>
                    </tr>
                  )) : <tr><td colSpan="9" className="px-4 py-4 text-white/55">No cost data found for this window.</td></tr>}
                </tbody>
              </table>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-white/10 bg-black/20">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-white/10 text-xs font-bold uppercase tracking-[0.18em] text-white/55">
                  <tr><th className="px-4 py-3">Started</th><th className="px-4 py-3">Business</th><th className="px-4 py-3">Caller</th><th className="px-4 py-3">Duration</th><th className="px-4 py-3">Vapi</th><th className="px-4 py-3">Twilio</th><th className="px-4 py-3">Total</th><th className="px-4 py-3">Twilio SID</th></tr>
                </thead>
                <tbody>
                  {costAudit?.calls?.length ? costAudit.calls.map((call) => (
                    <tr key={call.id} className="border-t border-white/5 align-top">
                      <td className="px-4 py-3 text-white/70">{dt(call.startedAt)}</td>
                      <td className="px-4 py-3 font-semibold">{call.business?.name || `Business ${call.businessId}`}</td>
                      <td className="px-4 py-3">{call.caller?.phone || "—"}</td>
                      <td className="px-4 py-3">{call.durationSec ?? "—"}s</td>
                      <td className="px-4 py-3">{money(call.vapiCost, call.twilioPriceUnit)}</td>
                      <td className="px-4 py-3">{money(call.twilioPrice, call.twilioPriceUnit)}</td>
                      <td className="px-4 py-3 font-extrabold text-white">{money(call.totalInternalCost, call.twilioPriceUnit)}</td>
                      <td className="px-4 py-3 text-xs text-white/55">{call.twilioCallSid || "—"}</td>
                    </tr>
                  )) : <tr><td colSpan="8" className="px-4 py-4 text-white/55">No recent calls in this window.</td></tr>}
                </tbody>
              </table>
            </div>
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
