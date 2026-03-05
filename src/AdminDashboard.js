import React, { useEffect, useMemo, useState } from "react";

const API_BASE = (process.env.REACT_APP_API_BASE_URL || "http://localhost:8787").replace(/\/+$/, "");

function api(path, { method = "GET", password, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (password) headers["x-admin-password"] = password;
  return fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (res) => {
    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch (_e) {
      data = { error: text || `HTTP ${res.status}` };
    }
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  });
}

function dt(value) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString();
}

function Shell({ children }) {
  return (
    <main className="min-h-screen bg-[#c9b268] text-white">
      <div className="relative min-h-screen overflow-x-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_500px_at_12%_12%,rgba(255,245,210,0.28),transparent_60%)]" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(800px_540px_at_80%_22%,rgba(11,18,30,0.22),transparent_70%)]" />
        <div className="relative z-10 mx-auto max-w-7xl px-6 py-10">{children}</div>
      </div>
    </main>
  );
}

function Panel({ children }) {
  return (
    <div className="rounded-[24px] border border-white/20 bg-[linear-gradient(180deg,rgba(10,12,18,0.78),rgba(8,10,16,0.9))] p-5 shadow-[0_45px_120px_-60px_rgba(0,0,0,0.85)] ring-1 ring-black/20">
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
        "w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-white placeholder:text-white/35 outline-none " +
        (props.className || "")
      }
    />
  );
}

function Select(props) {
  return (
    <select
      {...props}
      className={"w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2 text-sm font-semibold text-white outline-none " + (props.className || "")}
    />
  );
}

function Textarea(props) {
  return (
    <textarea
      {...props}
      className={
        "w-full resize-none rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-white placeholder:text-white/35 outline-none " +
        (props.className || "")
      }
    />
  );
}

export default function AdminDashboard() {
  const [password, setPassword] = useState("");
  const [candidate, setCandidate] = useState("");
  const [activeTab, setActiveTab] = useState("leads");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [gateBusy, setGateBusy] = useState(false);

  const [leads, setLeads] = useState([]);
  const [calls, setCalls] = useState([]);
  const [faqs, setFaqs] = useState([]);
  const [settings, setSettings] = useState(null);

  const [leadFilters, setLeadFilters] = useState({ status: "", intent: "", urgency: "" });
  const [callFilters, setCallFilters] = useState({ status: "", minDuration: "" });
  const [faqDraft, setFaqDraft] = useState({ question: "", answer: "", tags: "" });

  const stats = useMemo(
    () => ({
      leads: leads.length,
      calls: calls.length,
      faqs: faqs.length,
      rings: settings?.answerAfterRings ?? "—",
    }),
    [leads.length, calls.length, faqs.length, settings]
  );

  const loadLeads = async () => {
    const p = new URLSearchParams();
    if (leadFilters.status) p.set("status", leadFilters.status);
    if (leadFilters.intent) p.set("intent", leadFilters.intent);
    if (leadFilters.urgency) p.set("urgency", leadFilters.urgency);
    const data = await api(`/api/admin/leads${p.toString() ? `?${p}` : ""}`, { password });
    setLeads(data.leads || []);
  };

  const loadCalls = async () => {
    const p = new URLSearchParams();
    if (callFilters.status) p.set("status", callFilters.status);
    if (callFilters.minDuration) p.set("minDuration", callFilters.minDuration);
    const data = await api(`/api/admin/calls${p.toString() ? `?${p}` : ""}`, { password });
    setCalls(data.calls || []);
  };

  const loadFaqs = async () => {
    const data = await api("/api/admin/faqs", { password });
    setFaqs(data.faqs || []);
  };

  const loadSettings = async () => {
    const data = await api("/api/admin/settings", { password });
    setSettings(data.settings || null);
  };

  const refresh = async () => {
    if (!password) return;
    setLoading(true);
    setError("");
    try {
      if (activeTab === "leads") await loadLeads();
      if (activeTab === "calls") await loadCalls();
      if (activeTab === "faqs") await loadFaqs();
      if (activeTab === "settings") await loadSettings();
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, [password, activeTab, leadFilters.status, leadFilters.intent, leadFilters.urgency, callFilters.status, callFilters.minDuration]);

  const unlock = async (e) => {
    e.preventDefault();
    setGateBusy(true);
    setError("");
    try {
      await api("/api/admin/login", { method: "POST", body: { password: candidate } });
      setPassword(candidate);
    } catch (err) {
      setError(err.message);
    } finally {
      setGateBusy(false);
    }
  };

  const createFaq = async (e) => {
    e.preventDefault();
    setError("");
    try {
      await api("/api/admin/faqs", { method: "POST", password, body: { businessId: 1, ...faqDraft } });
      setFaqDraft({ question: "", answer: "", tags: "" });
      await loadFaqs();
    } catch (err) {
      setError(err.message);
    }
  };

  const updateFaq = async (faq) => {
    try {
      await api(`/api/admin/faqs/${faq.id}`, { method: "PUT", password, body: faq });
      await loadFaqs();
    } catch (err) {
      setError(err.message);
    }
  };

  const removeFaq = async (id) => {
    try {
      await api(`/api/admin/faqs/${id}`, { method: "DELETE", password });
      await loadFaqs();
    } catch (err) {
      setError(err.message);
    }
  };

  const saveSettings = async (e) => {
    e.preventDefault();
    if (!settings) return;
    try {
      const data = await api("/api/admin/settings", {
        method: "PUT",
        password,
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
      setError(err.message);
    }
  };

  if (!password) {
    return (
      <Shell>
        <div className="grid gap-8 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <div className="inline-flex items-center rounded-full border border-white/35 bg-white/10 px-4 py-2 text-xs font-bold uppercase tracking-[0.3em] text-white/90">Admin Dashboard</div>
            <h1 className="mt-6 font-serif text-[48px] font-semibold leading-[0.95] text-white sm:text-[64px]">My AI PA control center</h1>
            <p className="mt-6 max-w-2xl text-xl font-bold leading-snug text-[#0c1736]">
              Enter the admin password to manage leads, calls, FAQs, and answering settings.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <button type="button" onClick={() => (window.location.hash = "/")} className="rounded-full border border-white/25 bg-white/5 px-5 py-3 text-sm font-black uppercase tracking-[0.14em] text-white/80">Back To Site</button>
              <button type="button" onClick={() => (window.location.hash = "/signup")} className="rounded-full border border-white/25 bg-white/5 px-5 py-3 text-sm font-black uppercase tracking-[0.14em] text-white/80">Open Setup Flow</button>
            </div>
          </div>
          <Panel>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="text-xs font-bold uppercase tracking-[0.28em] text-white/60">Password Gate</div>
              <p className="mt-3 text-sm font-semibold text-white/75">Checks backend `ADMIN_PASSWORD` via `/api/admin/login`.</p>
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
          <h1 className="mt-1 font-serif text-4xl font-semibold text-white sm:text-5xl">Voice Ops Dashboard</h1>
          <p className="mt-2 text-sm font-semibold text-white/65">Backend: <code>{API_BASE}</code></p>
        </div>
        <div className="flex gap-3">
          <button type="button" onClick={() => (window.location.hash = "/")} className="rounded-full border border-white/20 bg-white/5 px-4 py-2 text-sm font-bold text-white/80">Site</button>
          <button type="button" onClick={() => setPassword("")} className="rounded-full border border-white/20 bg-white/5 px-4 py-2 text-sm font-bold text-white/80">Lock</button>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Panel><div className="text-xs font-bold uppercase tracking-[0.2em] text-white/50">Leads</div><div className="mt-1 text-2xl font-extrabold">{stats.leads}</div></Panel>
        <Panel><div className="text-xs font-bold uppercase tracking-[0.2em] text-white/50">Calls</div><div className="mt-1 text-2xl font-extrabold">{stats.calls}</div></Panel>
        <Panel><div className="text-xs font-bold uppercase tracking-[0.2em] text-white/50">FAQs</div><div className="mt-1 text-2xl font-extrabold">{stats.faqs}</div></Panel>
        <Panel><div className="text-xs font-bold uppercase tracking-[0.2em] text-white/50">Rings</div><div className="mt-1 text-2xl font-extrabold">{stats.rings}</div></Panel>
      </div>

      <Panel>
        <div className="flex flex-wrap gap-2">
          {[
            ["leads", "Leads"],
            ["calls", "Calls"],
            ["faqs", "FAQ Editor"],
            ["settings", "Settings"],
          ].map(([k, label]) => (
            <button key={k} type="button" onClick={() => setActiveTab(k)} className={"rounded-full px-4 py-2 text-sm font-bold " + (activeTab === k ? "bg-gradient-to-r from-emerald-700 to-amber-500 text-white" : "border border-white/15 bg-white/5 text-white/70")}>{label}</button>
          ))}
          <button type="button" onClick={refresh} className="ml-auto rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-bold text-white/80">Refresh</button>
        </div>

        {error ? <p className="mt-3 text-sm font-semibold text-rose-200">{error}</p> : null}
        {loading ? <p className="mt-3 text-sm font-semibold text-white/65">Loading...</p> : null}

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
            <div className="mb-4 grid gap-3 sm:grid-cols-2">
              <Labeled label="Status">
                <Select value={callFilters.status} onChange={(e) => setCallFilters((s) => ({ ...s, status: e.target.value }))}>
                  <option value="">All</option><option value="STARTED">STARTED</option><option value="COMPLETED">COMPLETED</option><option value="MISSED">MISSED</option><option value="FAILED">FAILED</option>
                </Select>
              </Labeled>
              <Labeled label="Min Duration (sec)">
                <Input type="number" min="0" value={callFilters.minDuration} onChange={(e) => setCallFilters((s) => ({ ...s, minDuration: e.target.value }))} />
              </Labeled>
            </div>
            <div className="overflow-x-auto rounded-2xl border border-white/10 bg-black/20">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-white/10 text-xs font-bold uppercase tracking-[0.18em] text-white/55">
                  <tr><th className="px-4 py-3">Started</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Duration</th><th className="px-4 py-3">Caller</th><th className="px-4 py-3">Transcript</th></tr>
                </thead>
                <tbody>
                  {calls.length ? calls.map((call) => (
                    <tr key={call.id} className="border-t border-white/5 align-top">
                      <td className="px-4 py-3">{dt(call.startedAt)}</td><td className="px-4 py-3">{call.status}</td><td className="px-4 py-3">{call.durationSec ?? "—"}</td><td className="px-4 py-3">{call.caller?.phone || "—"}</td><td className="px-4 py-3">{call.transcript ? String(call.transcript).slice(0, 120) : "—"}</td>
                    </tr>
                  )) : <tr><td colSpan="5" className="px-4 py-4 text-white/55">No calls found.</td></tr>}
                </tbody>
              </table>
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
