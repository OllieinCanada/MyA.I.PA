import React, { useEffect, useMemo, useState } from "react";
import "./AdminDashboard.css";

const API_BASE = (process.env.REACT_APP_API_BASE_URL || "http://localhost:8787").replace(/\/+$/, "");
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

function yesNo(value) {
  return value ? "Ready" : "Needs setup";
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

  const stats = useMemo(
    () => ({
      leads: leads.length,
      calls: calls.length,
      signups: signups.length,
      owners: opsOverview.owners?.length || 0,
      mappedOwners: opsOverview.sync?.mappedBusinessCount || 0,
      totalCost: costAudit?.totals?.totalInternalCost || 0,
      syncWarnings: opsOverview.sync?.warnings?.length || costAudit?.warnings?.length || 0,
      faqs: faqs.length,
      rings: settings?.answerAfterRings ?? "—",
    }),
    [leads.length, calls.length, signups.length, opsOverview.owners?.length, opsOverview.sync, costAudit, faqs.length, settings]
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
    <Shell>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs font-bold uppercase tracking-[0.28em] text-white/70">My AI PA Admin</div>
          <h1 className="mt-1 font-serif text-[clamp(2.25rem,10vw,3rem)] font-semibold text-white">Voice Ops Dashboard</h1>
          <p className="mt-2 text-sm font-semibold text-white/65">Backend: <code>{API_BASE}</code></p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={() => (window.location.hash = "/")} className="rounded-full border border-white/20 bg-white/5 px-4 py-2 text-sm font-bold text-white/80">Site</button>
          <button type="button" onClick={lock} className="rounded-full border border-white/20 bg-white/5 px-4 py-2 text-sm font-bold text-white/80">Lock</button>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Panel><div className="text-xs font-bold uppercase tracking-[0.2em] text-white/50">Owners</div><div className="mt-1 text-2xl font-extrabold">{stats.owners}</div><div className="mt-1 text-xs font-semibold text-white/45">{stats.mappedOwners} mapped</div></Panel>
        <Panel><div className="text-xs font-bold uppercase tracking-[0.2em] text-white/50">Calls</div><div className="mt-1 text-2xl font-extrabold">{stats.calls}</div><div className="mt-1 text-xs font-semibold text-white/45">current view</div></Panel>
        <Panel><div className="text-xs font-bold uppercase tracking-[0.2em] text-white/50">Cost</div><div className="mt-1 text-2xl font-extrabold">{money(stats.totalCost)}</div><div className="mt-1 text-xs font-semibold text-white/45">{costDays} day window</div></Panel>
        <Panel><div className="text-xs font-bold uppercase tracking-[0.2em] text-white/50">Signups</div><div className="mt-1 text-2xl font-extrabold">{stats.signups}</div><div className="mt-1 text-xs font-semibold text-white/45">trial pipeline</div></Panel>
        <Panel><div className="text-xs font-bold uppercase tracking-[0.2em] text-white/50">Warnings</div><div className="mt-1 text-2xl font-extrabold">{stats.syncWarnings}</div><div className="mt-1 text-xs font-semibold text-white/45">setup checks</div></Panel>
        <Panel><div className="text-xs font-bold uppercase tracking-[0.2em] text-white/50">Rings</div><div className="mt-1 text-2xl font-extrabold">{stats.rings}</div><div className="mt-1 text-xs font-semibold text-white/45">answer delay</div></Panel>
      </div>

      <div className="admin-shell-grid mt-5">
        <Panel>
          <div className="text-xs font-bold uppercase tracking-[0.22em] text-white/45">Workspace</div>
          <div className="mt-4 grid gap-2">
            {[
              ["overview", "Overview", "Health, alerts, and next actions"],
              ["businesses", "Businesses", "Owners, numbers, and mappings"],
              ["calls", "Calls", "Review calls and follow-ups"],
              ["costs", "Costs", "Vapi + Twilio spend"],
            ].map(([k, label, desc]) => (
              <button key={k} type="button" onClick={() => setActiveTab(k)} className={"rounded-2xl px-4 py-3 text-left text-sm font-bold transition " + (activeTab === k ? "bg-gradient-to-r from-emerald-700 to-amber-500 text-white shadow-[0_18px_48px_-36px_rgba(245,158,11,0.9)]" : "border border-white/10 bg-white/5 text-white/70 hover:bg-white/10")}>
                <span className="block">{label}</span>
                <span className="mt-1 block text-xs font-semibold opacity-65">{desc}</span>
              </button>
            ))}
          </div>
          <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="text-xs font-bold uppercase tracking-[0.18em] text-white/45">Quick Actions</div>
            <div className="mt-3 grid gap-2">
              <button type="button" onClick={syncVapiCalls} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-left text-xs font-bold text-white/75">Sync Vapi Calls</button>
              <button type="button" onClick={syncCosts} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-left text-xs font-bold text-white/75">Sync Costs</button>
              <button type="button" onClick={refresh} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-left text-xs font-bold text-white/75">Refresh View</button>
            </div>
          </div>
        </Panel>

        <Panel>
        <div className="hidden flex-wrap gap-2">
          {[
            ["leads", "Leads"],
            ["calls", "Calls"],
            ["owners", "Owners & Numbers"],
            ["sync", "Sync Health"],
            ["costs", "Cost Audit"],
            ["signups", "Signups"],
            ["ops", "Ops Metrics"],
            ["health", "Trial Health"],
            ["mappings", "Vapi Mapping"],
            ["digest", "Daily Digest"],
            ["faqs", "FAQ Editor"],
            ["settings", "Settings"],
          ].map(([k, label]) => (
            <button key={k} type="button" onClick={() => setActiveTab(k)} className={"rounded-full px-4 py-2 text-sm font-bold " + (activeTab === k ? "bg-gradient-to-r from-emerald-700 to-amber-500 text-white" : "border border-white/15 bg-white/5 text-white/70")}>{label}</button>
          ))}
          <button type="button" onClick={refresh} className="ml-auto rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-bold text-white/80">Refresh</button>
        </div>

        {error ? <p className="mt-3 text-sm font-semibold text-rose-200">{error}</p> : null}
        {loading ? <p className="mt-3 text-sm font-semibold text-white/65">Loading...</p> : null}

        {activeTab === "overview" ? (
          <div className="mt-4 grid gap-4">
            <div className="admin-overview-grid">
              <div className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-bold uppercase tracking-[0.2em] text-white/60">Operations Overview</div>
                    <h2 className="mt-2 text-2xl font-extrabold text-white">What needs attention now</h2>
                  </div>
                  <button type="button" onClick={refresh} className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-bold text-white/80">Refresh</button>
                </div>

                <div className="mt-5 grid gap-3 md:grid-cols-2">
                  {[
                    ["Database", Boolean(opsOverview.sync?.env?.databaseAvailable), "Required for businesses, calls, and cost history."],
                    ["Vapi", Boolean(opsOverview.sync?.env?.vapiApiKeyConfigured), "Required to pull AI call records and Vapi cost."],
                    ["Twilio", Boolean(opsOverview.sync?.env?.twilioConfigured), "Required to pull carrier call prices."],
                    ["Mappings", Boolean(opsOverview.sync?.mappedBusinessCount), "Connects phone numbers to the right business owner."],
                  ].map(([label, ok, desc]) => (
                    <div key={label} className={"rounded-2xl border p-4 " + statusClasses(ok)}>
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-xs font-black uppercase tracking-[0.16em] opacity-75">{label}</div>
                        <div className="rounded-full bg-white/20 px-2 py-1 text-[0.68rem] font-black uppercase tracking-[0.12em]">{yesNo(ok)}</div>
                      </div>
                      <p className="mt-3 text-sm font-semibold leading-6 opacity-80">{desc}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-5 grid gap-2">
                  {[...(opsOverview.sync?.warnings || []), ...(costAudit?.warnings || [])].slice(0, 5).map((warning) => (
                    <div key={warning} className="rounded-xl border border-amber-300/25 bg-amber-300/10 px-4 py-3 text-sm font-semibold text-amber-100">{warning}</div>
                  ))}
                  {!opsOverview.sync?.warnings?.length && !costAudit?.warnings?.length ? (
                    <div className="rounded-xl border border-emerald-300/20 bg-emerald-300/10 px-4 py-3 text-sm font-semibold text-emerald-100">No active setup warnings detected.</div>
                  ) : null}
                </div>
              </div>

              <div className="grid gap-4">
                <div className="rounded-2xl border border-white/10 bg-black/20 p-5">
                  <div className="text-sm font-bold uppercase tracking-[0.2em] text-white/60">Cost Snapshot</div>
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <div className="rounded-xl bg-white/5 p-4"><div className="text-xs font-bold uppercase text-white/45">Total</div><div className="mt-1 text-xl font-extrabold text-white">{money(costAudit?.totals?.totalInternalCost)}</div></div>
                    <div className="rounded-xl bg-white/5 p-4"><div className="text-xs font-bold uppercase text-white/45">Priced</div><div className="mt-1 text-xl font-extrabold text-white">{costAudit?.totals?.pricedCalls || 0}</div></div>
                    <div className="rounded-xl bg-white/5 p-4"><div className="text-xs font-bold uppercase text-white/45">Vapi</div><div className="mt-1 text-xl font-extrabold text-white">{money(costAudit?.totals?.vapiCost)}</div></div>
                    <div className="rounded-xl bg-white/5 p-4"><div className="text-xs font-bold uppercase text-white/45">Twilio</div><div className="mt-1 text-xl font-extrabold text-white">{money(costAudit?.totals?.twilioCost)}</div></div>
                  </div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/20 p-5">
                  <div className="text-sm font-bold uppercase tracking-[0.2em] text-white/60">Next Actions</div>
                  <div className="mt-4 grid gap-2">
                    <button type="button" onClick={() => setActiveTab("businesses")} className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-left text-sm font-bold text-white/75">Review owner numbers and mappings</button>
                    <button type="button" onClick={() => setActiveTab("calls")} className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-left text-sm font-bold text-white/75">Review missed calls and follow-ups</button>
                    <button type="button" onClick={() => setActiveTab("costs")} className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-left text-sm font-bold text-white/75">Audit Vapi + Twilio cost</button>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <div className="text-sm font-bold uppercase tracking-[0.2em] text-white/60">Businesses Needing Setup</div>
                <div className="mt-4 space-y-2">
                  {opsOverview.owners?.filter((owner) => owner.needsSetup).slice(0, 6).length ? opsOverview.owners.filter((owner) => owner.needsSetup).slice(0, 6).map((owner) => (
                    <div key={owner.businessId} className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                      <div className="font-extrabold text-white">{owner.businessName}</div>
                      <div className="mt-1 text-xs font-semibold text-white/45">{owner.ownerPhone || "No owner phone"} · {owner.aiNumbers?.length ? owner.aiNumbers.join(", ") : "No AI number mapping"}</div>
                    </div>
                  )) : <div className="text-sm font-semibold text-white/55">No business setup rows available yet.</div>}
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/20 p-5">
                <div className="text-sm font-bold uppercase tracking-[0.2em] text-white/60">Recent Follow-Up Calls</div>
                <div className="mt-4 space-y-2">
                  {calls.filter((call) => call.followUpNeeded).slice(0, 6).length ? calls.filter((call) => call.followUpNeeded).slice(0, 6).map((call) => (
                    <div key={call.id} className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                      <div className="font-extrabold text-white">{call.business?.name || `Business ${call.businessId}`}</div>
                      <div className="mt-1 text-xs font-semibold text-white/45">{dt(call.startedAt)} · {call.caller?.phone || "—"} · {call.outcome || call.status}</div>
                    </div>
                  )) : <div className="text-sm font-semibold text-white/55">No follow-up calls loaded in this view.</div>}
                </div>
              </div>
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
      </Panel>
      </div>
    </Shell>
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
