import React, { useEffect, useMemo, useState } from "react";
import { getDefaultApiBaseUrl, normalizeApiBase } from "./config/apiBase";
import "./CustomerDashboard.css";

const API_BASE = normalizeApiBase(process.env.REACT_APP_API_BASE_URL || getDefaultApiBaseUrl());
const STORAGE_KEY = "myaipa_customer_dashboard_lookup_v1";

function fmtDate(value) {
  if (!value) return "Not available";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function fmtTime(value) {
  if (!value) return "Not available";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function fmtPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  return value || "Not assigned yet";
}

function statusLabel(value) {
  const raw = String(value || "").replace(/_/g, " ").trim();
  return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : "Setup started";
}

async function loadDashboard(credentials) {
  const response = await fetch(`${API_BASE}/api/customer/dashboard`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(credentials),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.dashboard) {
    throw new Error(data?.error || "Dashboard could not be loaded.");
  }
  return data.dashboard;
}

function Brand() {
  return (
    <div className="customer-brand">
      <span className="customer-brand-mark" />
      <span>My <strong>AI PA</strong></span>
    </div>
  );
}

function LookupForm({ credentials, setCredentials, onSubmit, busy, error }) {
  return (
    <main className="customer-dashboard customer-dashboard-login">
      <section className="customer-login-card">
        <Brand />
        <div className="customer-login-grid">
          <div>
            <p className="customer-eyebrow">Customer dashboard</p>
            <h1>Your AI answering setup, without the admin clutter.</h1>
            <p className="customer-login-copy">
              Business owners can check their trial, forwarding number, recent calls, and setup steps using the email and phone number they signed up with.
            </p>
            <div className="customer-login-points">
              <span>Call summaries</span>
              <span>Trial status</span>
              <span>Setup checklist</span>
            </div>
          </div>
          <form onSubmit={onSubmit} className="customer-login-form">
            <label>
              <span>Signup email</span>
              <input
                type="email"
                value={credentials.email}
                onChange={(event) => setCredentials((state) => ({ ...state, email: event.target.value }))}
                placeholder="owner@example.com"
                autoComplete="email"
              />
            </label>
            <label>
              <span>Owner or business phone</span>
              <input
                value={credentials.phone}
                onChange={(event) => setCredentials((state) => ({ ...state, phone: event.target.value }))}
                placeholder="(249) 503-3301"
                autoComplete="tel"
              />
            </label>
            {error ? <p className="customer-error">{error}</p> : null}
            <button type="submit" disabled={busy}>{busy ? "Opening dashboard..." : "Open Dashboard"}</button>
          </form>
        </div>
      </section>
    </main>
  );
}

function StatCard({ label, value, sub }) {
  return (
    <div className="customer-stat-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <em>{sub}</em>
    </div>
  );
}

function CustomerDashboardView({ dashboard, onSignOut }) {
  const signup = dashboard.signup || {};
  const stats = dashboard.stats || {};
  const assistant = dashboard.assistant || {};
  const checklist = dashboard.setup?.checklist || [];
  const readiness = dashboard.setup?.readinessPercent || 0;
  const nextStep = checklist.find((item) => !item.done);

  const trialText = useMemo(() => {
    if (!signup.trialEndAt) return "Trial date pending";
    const days = Math.ceil((new Date(signup.trialEndAt).getTime() - Date.now()) / 86400000);
    if (!Number.isFinite(days)) return fmtDate(signup.trialEndAt);
    if (days < 0) return "Trial ended";
    if (days === 0) return "Trial ends today";
    return `${days} days left`;
  }, [signup.trialEndAt]);

  return (
    <main className="customer-dashboard">
      <aside className="customer-sidebar">
        <Brand />
        <nav>
          <a href="#overview">Overview</a>
          <a href="#calls">Calls</a>
          <a href="#setup">Setup</a>
          <a href="#faqs">FAQs</a>
        </nav>
        <button type="button" onClick={onSignOut}>Switch account</button>
      </aside>

      <section className="customer-main">
        <header className="customer-topbar">
          <div>
            <p className="customer-eyebrow">Owner dashboard</p>
            <h1>{signup.businessName || "Your business"}</h1>
            <span>{statusLabel(signup.status)} · {signup.ownerEmail || "Email pending"}</span>
          </div>
          <a href="#/signup">Add another business</a>
        </header>

        <section id="overview" className="customer-hero-card">
          <div>
            <span className="customer-pill">AI phone assistant</span>
            <h2>{assistant.aiNumber ? "Your AI number is ready to test." : "Your AI number is being prepared."}</h2>
            <p>Forward missed calls here once setup feels right. Keep your current business number for customers.</p>
            <div className="customer-number">{fmtPhone(assistant.aiNumber || signup.twilioPhoneNumber)}</div>
          </div>
          <div className="customer-readiness" style={{ "--ready": `${readiness}%` }}>
            <strong>{readiness}%</strong>
            <span>Setup ready</span>
          </div>
        </section>

        <section className="customer-stats">
          <StatCard label="Calls handled" value={stats.totalCalls || 0} sub="recent synced calls" />
          <StatCard label="Missed calls" value={stats.missedCalls || 0} sub="needs attention" />
          <StatCard label="Follow-ups" value={stats.followUps || 0} sub="quotes or callbacks" />
          <StatCard label="Trial" value={trialText} sub={signup.trialEndAt ? `Ends ${fmtDate(signup.trialEndAt)}` : statusLabel(signup.subscriptionStatus)} />
        </section>

        <section className="customer-grid">
          <div id="setup" className="customer-panel">
            <div className="customer-panel-head">
              <h2>Setup checklist</h2>
              {nextStep ? <span>Next: {nextStep.label}</span> : <span>Ready</span>}
            </div>
            <div className="customer-checklist">
              {checklist.map((item) => (
                <div key={item.key} className={item.done ? "done" : ""}>
                  <span>{item.done ? "✓" : "!"}</span>
                  <p>{item.label}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="customer-panel">
            <div className="customer-panel-head">
              <h2>Assistant settings</h2>
              <span>{assistant.afterHoursMode || "AI_ALWAYS_ON"}</span>
            </div>
            <div className="customer-settings-list">
              <div><span>Answer after</span><strong>{assistant.answerAfterRings ?? 3} rings</strong></div>
              <div><span>Business phone</span><strong>{fmtPhone(signup.businessPhone)}</strong></div>
              <div><span>Owner phone</span><strong>{fmtPhone(signup.ownerPhone)}</strong></div>
              <div><span>Booking link</span><strong>{assistant.bookingLink || "Not added"}</strong></div>
            </div>
          </div>
        </section>

        <section id="calls" className="customer-panel">
          <div className="customer-panel-head">
            <h2>Recent calls</h2>
            <span>Last synced: {fmtTime(stats.lastCallAt)}</span>
          </div>
          <div className="customer-call-list">
            {dashboard.recentCalls?.length ? dashboard.recentCalls.map((call) => (
              <div key={call.id}>
                <div>
                  <strong>{call.caller?.name || fmtPhone(call.caller?.phone)}</strong>
                  <span>{fmtTime(call.startedAt)} · {call.durationSec || 0}s</span>
                </div>
                <p>{call.aiSummary || "Summary pending."}</p>
                <em className={call.followUpNeeded ? "needs-followup" : ""}>{call.followUpNeeded ? "Follow up" : statusLabel(call.outcome || call.status)}</em>
              </div>
            )) : <p className="customer-empty">No synced calls yet. Once Vapi/Twilio sync is connected, calls will show here.</p>}
          </div>
        </section>

        <section id="faqs" className="customer-panel">
          <div className="customer-panel-head">
            <h2>FAQs your assistant can use</h2>
            <span>{dashboard.faqs?.length || 0} saved</span>
          </div>
          <div className="customer-faq-grid">
            {dashboard.faqs?.length ? dashboard.faqs.map((faq) => (
              <div key={faq.id}>
                <strong>{faq.question}</strong>
                <p>{faq.answer}</p>
              </div>
            )) : <p className="customer-empty">No FAQs added yet. Add starter answers from the admin side until customer editing is enabled.</p>}
          </div>
        </section>
      </section>
    </main>
  );
}

export default function CustomerDashboard() {
  const [credentials, setCredentials] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    } catch {
      return {};
    }
  });
  const [dashboard, setDashboard] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const normalizedCredentials = {
    email: credentials.email || "",
    phone: credentials.phone || "",
  };

  const submit = async (event) => {
    event?.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = await loadDashboard(normalizedCredentials);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizedCredentials));
      setDashboard(data);
    } catch (err) {
      setDashboard(null);
      setError(err?.message || "Dashboard could not be loaded.");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (normalizedCredentials.email && normalizedCredentials.phone) {
      submit();
    }
  }, []);

  if (!dashboard) {
    return <LookupForm credentials={normalizedCredentials} setCredentials={setCredentials} onSubmit={submit} busy={busy} error={error} />;
  }

  return (
    <CustomerDashboardView
      dashboard={dashboard}
      onSignOut={() => {
        localStorage.removeItem(STORAGE_KEY);
        setDashboard(null);
        setCredentials({ email: "", phone: "" });
      }}
    />
  );
}
