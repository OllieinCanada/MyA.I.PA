import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getApiBaseUrl, normalizeApiBase } from "./config/apiBase";
import CustomerHelpActions from "./components/CustomerHelpActions";
import ForwardingSetupGuide from "./components/ForwardingSetupGuide";
import "./components/CustomerSetupActions.css";
import "./CustomerDashboard.css";

const API_BASE = normalizeApiBase(getApiBaseUrl(process.env.REACT_APP_API_BASE_URL));
const STORAGE_KEY = "myaipa_customer_dashboard_lookup_v1";

function readStoredLookup() {
  if (typeof window === "undefined") return {};
  try {
    const sessionValue = window.sessionStorage?.getItem(STORAGE_KEY) || "";
    const legacyValue = window.localStorage?.getItem(STORAGE_KEY) || "";
    if (legacyValue) window.localStorage?.removeItem(STORAGE_KEY);
    const parsed = JSON.parse(sessionValue || legacyValue || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function rememberLookup(credentials) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage?.setItem(STORAGE_KEY, JSON.stringify(credentials));
    window.localStorage?.removeItem(STORAGE_KEY);
  } catch {
    // Session storage is only a convenience for returning to the dashboard in this browser tab.
  }
}

function forgetLookup() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage?.removeItem(STORAGE_KEY);
    window.localStorage?.removeItem(STORAGE_KEY);
  } catch {
    // Best-effort cleanup only.
  }
}

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

function fmtRefreshTime(value) {
  if (!value) return "just now";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "just now"
    : date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" });
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

function fmtDuration(seconds) {
  const total = Math.max(0, Number(seconds || 0));
  const minutes = Math.floor(total / 60);
  const remainder = Math.round(total % 60);
  if (!minutes) return `${remainder}s`;
  return `${minutes}m ${remainder}s`;
}

function fmtMoney(cents) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "CAD", maximumFractionDigits: 0 }).format(Number(cents || 0) / 100);
}

function readableKey(value) {
  return String(value || "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/^./, (letter) => letter.toUpperCase());
}

function readableValue(value) {
  if (value == null || value === "") return "Not provided";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

async function requestDashboardCode(credentials) {
  const response = await fetch(`${API_BASE}/api/customer/dashboard/request-code`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(credentials),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.codeSent) throw new Error(data?.error || "A sign-in code could not be sent.");
  return data;
}

async function verifyDashboardCode(credentials, code) {
  const response = await fetch(`${API_BASE}/api/customer/dashboard/verify-code`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...credentials, code }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.dashboard) throw new Error(data?.error || "The sign-in code could not be verified.");
  return { dashboard: data.dashboard, refreshedAt: data.refreshedAt || new Date().toISOString() };
}

async function refreshDashboard() {
  const response = await fetch(`${API_BASE}/api/customer/dashboard`, {
    method: "GET",
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.dashboard) {
    throw new Error(data?.error || "Dashboard could not be refreshed.");
  }
  return { dashboard: data.dashboard, refreshedAt: data.refreshedAt || new Date().toISOString() };
}

async function endDashboardSession() {
  await fetch(`${API_BASE}/api/customer/dashboard/logout`, {
    method: "POST",
    credentials: "include",
  });
}

async function startSecureBillingSetup() {
  const response = await fetch(`${API_BASE}/api/customer/dashboard/billing/setup`, {
    method: "POST",
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || "Secure billing could not be opened.");
  return data;
}

async function cancelPaidContinuation() {
  const response = await fetch(`${API_BASE}/api/customer/dashboard/billing/cancel-continuation`, {
    method: "POST",
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || "The billing change could not be saved.");
  return data;
}

async function respondToAppointmentRequest(appointmentId, payload) {
  const response = await fetch(`${API_BASE}/api/customer/dashboard/appointments/${encodeURIComponent(appointmentId)}/respond`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.appointment) {
    throw new Error(data?.error || "The appointment could not be updated.");
  }
  return data;
}

async function saveSchedulingSettings(payload) {
  const response = await fetch(`${API_BASE}/api/customer/dashboard/scheduling`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || "Scheduling settings could not be saved.");
  return data;
}

async function addStaffMember(payload) {
  const response = await fetch(`${API_BASE}/api/customer/dashboard/staff`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || "Team member could not be added.");
  return data;
}

async function removeStaffMember(staffMemberId) {
  const response = await fetch(`${API_BASE}/api/customer/dashboard/staff/${encodeURIComponent(staffMemberId)}`, {
    method: "DELETE",
    credentials: "include",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || "Team member could not be removed.");
  return data;
}

async function saveLeadOutcome(leadId, payload) {
  const response = await fetch(`${API_BASE}/api/customer/dashboard/leads/${encodeURIComponent(leadId)}/outcome`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.lead) throw new Error(data?.error || "The lead outcome could not be saved.");
  return data;
}

async function disconnectJobberIntegration() {
  const response = await fetch(`${API_BASE}/api/customer/dashboard/integrations/jobber/disconnect`, {
    method: "POST",
    credentials: "include",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || "Jobber could not be disconnected.");
  return data;
}

async function retryJobberLeadSync(leadId) {
  const response = await fetch(`${API_BASE}/api/customer/dashboard/integrations/jobber/leads/${encodeURIComponent(leadId)}/sync`, {
    method: "POST",
    credentials: "include",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || "The Jobber sync could not be retried.");
  return data;
}

async function disconnectCalendarConnection(connectionId) {
  const response = await fetch(`${API_BASE}/api/customer/dashboard/calendar/connections/${encodeURIComponent(connectionId)}`, {
    method: "DELETE",
    credentials: "include",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || "The calendar could not be disconnected.");
  return data;
}

async function getSupportSuggestions(payload) {
  const response = await fetch(`${API_BASE}/api/customer/dashboard/support/suggest`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.analysis) throw new Error(data?.error || "Suggestions are unavailable right now.");
  return data;
}

async function sendSupportReport(payload) {
  const response = await fetch(`${API_BASE}/api/customer/dashboard/support/reports`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.ticketNumber) throw new Error(data?.error || "The report could not be sent.");
  return data;
}

function toDateTimeInput(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function Brand({ auth = false }) {
  return (
    <div className={`customer-brand${auth ? " customer-brand-auth" : ""}`}>
      {auth ? (
        <span className="customer-brand-mark" aria-hidden="true">
          <svg viewBox="0 0 40 40" focusable="false">
            <path className="customer-brand-headset" d="M8.5 21v-2.2C8.5 12.8 13.4 8 19.5 8s11 4.8 11 10.8V21" />
            <path className="customer-brand-earpiece" d="M8.5 20.5H7.2A2.2 2.2 0 0 0 5 22.7v4.1A2.2 2.2 0 0 0 7.2 29h2.5V20.5H8.5Zm22 0h1.3a2.2 2.2 0 0 1 2.2 2.2v4.1a2.2 2.2 0 0 1-2.2 2.2h-2.5v-8.5h1.2Z" />
            <path className="customer-brand-wave" d="M13 23.5h2l1.5-3.2 2.5 7.1 2.4-9.1 2.1 5.2H27" />
            <path className="customer-brand-mic" d="M29.4 29c0 2-1.7 3.5-3.8 3.5h-2.1" />
            <circle className="customer-brand-dot" cx="21.8" cy="32.5" r="1.7" />
          </svg>
        </span>
      ) : <span className="customer-brand-mark" />}
      <span className="customer-brand-text">My <strong>AI PA</strong></span>
    </div>
  );
}

function LookupForm({ credentials, setCredentials, onSubmit, busy, error, step, code, setCode, destination, devCode, onBack }) {
  return (
    <main className="customer-dashboard customer-dashboard-login">
      <section className="customer-login-card">
        <div className="customer-login-grid">
          <aside className="customer-login-story">
            <Brand auth />
            <div className="customer-login-story-copy">
              <p className="customer-eyebrow">OWNER DASHBOARD</p>
              <h1>Your calls. Your leads. One clear view.</h1>
            </div>
            <p className="customer-login-copy">
              See recent call summaries, setup progress, your forwarding number, and trial status.
            </p>
            <div className="customer-login-points">
              <span><i aria-hidden="true">✓</i>Review recent calls</span>
              <span><i aria-hidden="true">✓</i>Track setup progress</span>
              <span><i aria-hidden="true">✓</i>Check your number and trial</span>
            </div>
            <div className="customer-login-preview" aria-hidden="true">
              <div className="customer-preview-head">
                <span>Latest call</span>
                <em>Summary ready</em>
              </div>
              <strong>New service request</strong>
              <p>Call details and next steps captured.</p>
              <div className="customer-preview-meta">
                <span><i />Follow-up noted</span>
                <span>Just now</span>
              </div>
            </div>
          </aside>
          <div className="customer-login-access">
            <div className="customer-login-mobile-brand"><Brand auth /></div>
            <div className="customer-login-heading">
              <h2>{step === "code" ? "Check your phone" : "Welcome back"}</h2>
              <p>{step === "code" ? `Enter the six-digit code sent to ${destination}.` : "Enter the details you used when you signed up."}</p>
            </div>
            <form onSubmit={onSubmit} className="customer-login-form" aria-busy={busy}>
              {step === "code" ? (
                <>
                  <label htmlFor="customer-dashboard-code">One-time sign-in code</label>
                  <input
                    id="customer-dashboard-code"
                    name="code"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength="6"
                    value={code}
                    onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder="000000"
                    autoComplete="one-time-code"
                    required
                    autoFocus
                    aria-invalid={error ? "true" : undefined}
                  />
                  <p className="customer-login-helper">The code expires in 10 minutes. Never share it with anyone.</p>
                  {devCode ? <p className="customer-dev-code">Local preview code: <strong>{devCode}</strong></p> : null}
                </>
              ) : (
                <>
                  <label htmlFor="customer-dashboard-email">Signup email</label>
                  <input
                    id="customer-dashboard-email"
                    name="email"
                    type="email"
                    value={credentials.email}
                    onChange={(event) => setCredentials((state) => ({ ...state, email: event.target.value }))}
                    placeholder="you@business.ca"
                    autoComplete="email"
                    required
                    aria-invalid={error ? "true" : undefined}
                    aria-describedby={error ? "customer-dashboard-error" : undefined}
                  />
                  <label htmlFor="customer-dashboard-phone">Owner or business phone</label>
                  <input
                    id="customer-dashboard-phone"
                    name="phone"
                    type="tel"
                    inputMode="tel"
                    value={credentials.phone}
                    onChange={(event) => setCredentials((state) => ({ ...state, phone: event.target.value }))}
                    placeholder="(249) 503-3301"
                    autoComplete="tel"
                    required
                    aria-invalid={error ? "true" : undefined}
                    aria-describedby={`customer-dashboard-phone-help${error ? " customer-dashboard-error" : ""}`}
                  />
                  <p id="customer-dashboard-phone-help" className="customer-login-helper">Use the number from signup in any format—Canada's +1 country code is optional. We will text the code to the registered owner phone.</p>
                </>
              )}
              {error ? (
                <p id="customer-dashboard-error" className="customer-error" role="alert" aria-live="polite">
                  {error}
                </p>
              ) : null}
              <button type="submit" disabled={busy}>
                <span>{busy ? (step === "code" ? "Checking code…" : "Sending code…") : (step === "code" ? "Verify and open dashboard" : "Text me a sign-in code")}</span>
                <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m7.5 4.5 5.5 5.5-5.5 5.5M12.5 10H3" /></svg>
              </button>
              {step === "code" ? <button type="button" className="customer-login-back" onClick={onBack} disabled={busy}>Use different details</button> : null}
            </form>
            <p className="customer-login-trust">
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5.8 8V6.2a4.2 4.2 0 0 1 8.4 0V8m-9.4 0h10.4v8H4.8V8Z" /></svg>
              Private access protected by a one-time code and a secure 12-hour session.
            </p>
            <div className="customer-login-links">
              <p>Having trouble? <a href="#/">Return to the main site</a></p>
              <nav aria-label="Legal"><a href="/privacy.html">Privacy</a><span>·</span><a href="/terms.html">Terms</a><span>·</span><a href="/calendar-data.html">Calendar data</a></nav>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

function AppointmentRequestCard({ appointment, staffMembers = [], onUpdated }) {
  const [start, setStart] = useState(toDateTimeInput(appointment.confirmedStart || appointment.requestedStart));
  const [staffMemberId, setStaffMemberId] = useState(staffMembers.some((staff) => staff.id === appointment.staffMember?.id) ? appointment.staffMember.id : "");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  const respond = async (action) => {
    if (action === "DECLINE" && !window.confirm(`Decline ${appointment.customerName}'s appointment request?`)) return;
    setBusy(action);
    setMessage("");
    try {
      const result = await respondToAppointmentRequest(appointment.id, {
        action,
        confirmedStart: action === "CONFIRM" && start ? new Date(start).toISOString() : undefined,
        staffMemberId: action === "CONFIRM" ? staffMemberId || null : undefined,
      });
      setMessage(action === "DECLINE"
        ? "Declined. The customer was notified."
        : result.appointment.status === "PROPOSED"
          ? "New time sent. Waiting for the customer to accept it."
          : "Confirmed. Calendar invitations were sent.");
      await onUpdated();
      return result;
    } catch (error) {
      setMessage(error?.message || "The appointment could not be updated.");
      return null;
    } finally {
      setBusy("");
    }
  };

  const status = String(appointment.status || "PENDING").toLowerCase();
  const calendarHref = appointment.calendarPath ? `${API_BASE}${appointment.calendarPath}` : "";
  const canRespond = ["PENDING", "CHANGE_REQUESTED"].includes(appointment.status);
  const proposesNewTime = appointment.status === "CHANGE_REQUESTED"
    || start !== toDateTimeInput(appointment.requestedStart);
  return (
    <article className={`customer-appointment-card is-${status}`}>
      <div className="customer-appointment-summary">
        <div>
          <strong>{appointment.customerName}</strong>
          <span>{fmtPhone(appointment.customerPhone)}</span>
        </div>
        <em>{statusLabel(appointment.status)}</em>
      </div>
      <h3>{appointment.service}</h3>
      {appointment.address ? <p>{appointment.address}</p> : null}
      <dl>
        <div><dt>Requested</dt><dd>{fmtTime(appointment.requestedStart)}</dd></div>
        <div><dt>Length</dt><dd>{appointment.durationMinutes} minutes</dd></div>
        <div><dt>Assigned to</dt><dd>{appointment.staffMember?.name || "Unassigned"}</dd></div>
      </dl>
      {appointment.status === "PROPOSED" ? (
        <div className="customer-appointment-awaiting">
          <strong>Waiting for customer acceptance</strong>
          <span>Proposed for {fmtTime(appointment.confirmedStart)}. Calendar invitations have not been sent.</span>
        </div>
      ) : null}
      {appointment.status === "CHANGE_REQUESTED" ? (
        <div className="customer-appointment-change-requested">
          <strong>The customer needs another time.</strong>
          {appointment.customerNote ? <span>Customer note: {appointment.customerNote}</span> : <span>Choose another time and send a new proposal.</span>}
        </div>
      ) : null}
      {canRespond ? (
        <div className="customer-appointment-actions">
          <label htmlFor={`appointment-time-${appointment.id}`}>
            {appointment.status === "CHANGE_REQUESTED" ? "Choose another time" : "Confirm this time or change it first"}
            <input
              id={`appointment-time-${appointment.id}`}
              type="datetime-local"
              value={start}
              onChange={(event) => setStart(event.target.value)}
              disabled={Boolean(busy)}
            />
          </label>
          {staffMembers.length ? (
            <label htmlFor={`appointment-staff-${appointment.id}`}>
              Assign team member
              <select id={`appointment-staff-${appointment.id}`} value={staffMemberId} onChange={(event) => setStaffMemberId(event.target.value)} disabled={Boolean(busy)}>
                <option value="">Whole business / unassigned</option>
                {staffMembers.map((staff) => <option key={staff.id} value={staff.id}>{staff.name}</option>)}
              </select>
            </label>
          ) : null}
          <div>
            <button type="button" className="confirm" onClick={() => respond("CONFIRM")} disabled={Boolean(busy) || !start}>
              {busy === "CONFIRM" ? "Sending…" : proposesNewTime ? "Send proposed time" : "Confirm appointment"}
            </button>
            <button type="button" className="decline" onClick={() => respond("DECLINE")} disabled={Boolean(busy)}>
              {busy === "DECLINE" ? "Declining…" : "Decline"}
            </button>
          </div>
          <small>{proposesNewTime ? "The new time will not be booked until the customer accepts it." : "The customer is told this is only a request until you confirm it."}</small>
        </div>
      ) : null}
      {appointment.status === "CONFIRMED" ? (
        <div className="customer-appointment-confirmed">
          <strong>Confirmed for {fmtTime(appointment.confirmedStart)}</strong>
          {calendarHref ? <a href={calendarHref}>Add to calendar (.ics)</a> : null}
        </div>
      ) : null}
      {message ? <p className="customer-appointment-message" role="status">{message}</p> : null}
    </article>
  );
}

function startOfCalendarWeek(value = new Date()) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return date;
}

function AppointmentCalendar({ appointments = [] }) {
  const [weekOffset, setWeekOffset] = useState(0);
  const weekStart = startOfCalendarWeek(new Date(Date.now() + weekOffset * 7 * 86400000));
  const days = Array.from({ length: 7 }, (_, index) => new Date(weekStart.getTime() + index * 86400000));
  const active = appointments.filter((appointment) => ["CONFIRMED", "PROPOSED"].includes(appointment.status));
  return (
    <section className="customer-schedule-calendar" aria-label="Appointment calendar">
      <div className="customer-calendar-toolbar">
        <div><p className="customer-eyebrow">Calendar view</p><h3>{weekStart.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</h3></div>
        <div><button type="button" onClick={() => setWeekOffset((value) => value - 1)}>Previous</button><button type="button" onClick={() => setWeekOffset(0)}>Today</button><button type="button" onClick={() => setWeekOffset((value) => value + 1)}>Next</button></div>
      </div>
      <div className="customer-calendar-week">
        {days.map((day) => {
          const dayAppointments = active.filter((appointment) => {
            const value = new Date(appointment.confirmedStart || appointment.requestedStart);
            return value.getFullYear() === day.getFullYear() && value.getMonth() === day.getMonth() && value.getDate() === day.getDate();
          });
          return <div className="customer-calendar-day" key={day.toISOString()}><header><span>{day.toLocaleDateString(undefined, { weekday: "short" })}</span><strong>{day.getDate()}</strong></header><div>{dayAppointments.length ? dayAppointments.map((appointment) => <article key={appointment.id} style={{ "--staff-color": appointment.staffMember?.color || "#126dff" }}><time>{new Date(appointment.confirmedStart || appointment.requestedStart).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</time><strong>{appointment.customerName}</strong><span>{appointment.service}</span><small>{appointment.staffMember?.name || "Unassigned"} · {statusLabel(appointment.status)}</small></article>) : <small className="customer-calendar-empty">Open</small>}</div></div>;
        })}
      </div>
      <p className="customer-calendar-note">Confirmed appointments and customer proposals appear here. Overlapping bookings are blocked, including your travel buffer.</p>
    </section>
  );
}

const SCHEDULE_DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

function SchedulingControls({ scheduling, staffMembers = [], calendarConnections = [], calendarProviders = {}, onUpdated }) {
  const [hours, setHours] = useState(scheduling?.bookingHours || {});
  const [bufferMinutes, setBufferMinutes] = useState(scheduling?.bufferMinutes ?? 15);
  const [reminderHours, setReminderHours] = useState(scheduling?.reminderHours || [24, 2]);
  const [calendarBookingMode, setCalendarBookingMode] = useState(scheduling?.calendarBookingMode || "MANUAL_APPROVAL");
  const [calendarOwner, setCalendarOwner] = useState("");
  const [staff, setStaff] = useState({ name: "", email: "", phone: "", color: "#126dff" });
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    setHours(scheduling?.bookingHours || {});
    setBufferMinutes(scheduling?.bufferMinutes ?? 15);
    setReminderHours(scheduling?.reminderHours || [24, 2]);
    setCalendarBookingMode(scheduling?.calendarBookingMode || "MANUAL_APPROVAL");
  }, [scheduling]);
  const updateDay = (day, field, value) => setHours((current) => ({ ...current, [day]: { ...(current[day] || {}), [field]: value } }));
  const save = async () => {
    setBusy("settings"); setMessage("");
    try { await saveSchedulingSettings({ bookingHours: hours, bufferMinutes, reminderHours, calendarBookingMode }); setMessage("Scheduling rules saved."); await onUpdated(); }
    catch (error) { setMessage(error.message); } finally { setBusy(""); }
  };
  const add = async (event) => {
    event.preventDefault(); setBusy("staff"); setMessage("");
    try { await addStaffMember(staff); setStaff({ name: "", email: "", phone: "", color: "#126dff" }); setMessage("Team member added."); await onUpdated(); }
    catch (error) { setMessage(error.message); } finally { setBusy(""); }
  };
  const remove = async (member) => {
    if (!window.confirm(`Remove ${member.name} from future assignment choices?`)) return;
    setBusy(member.id); setMessage("");
    try { await removeStaffMember(member.id); setMessage("Team member removed."); await onUpdated(); }
    catch (error) { setMessage(error.message); } finally { setBusy(""); }
  };
  const connect = (provider) => {
    const query = calendarOwner ? `?staffMemberId=${encodeURIComponent(calendarOwner)}` : "";
    window.location.assign(`${API_BASE}/api/customer/dashboard/calendar/connect/${provider}${query}`);
  };
  const disconnect = async (connection) => {
    if (!window.confirm(`Disconnect ${connection.accountEmail} from My AI PA scheduling?`)) return;
    setBusy(connection.id); setMessage("");
    try { await disconnectCalendarConnection(connection.id); setMessage("Calendar disconnected."); await onUpdated(); }
    catch (error) { setMessage(error.message); } finally { setBusy(""); }
  };
  return (
    <section className="customer-scheduling-controls">
      <div className="customer-calendar-connect">
        <div><p className="customer-eyebrow">Calendar connection</p><h3>Choose how appointments are booked</h3><p>Only the owner or staff member connects a calendar. Customers confirm by text or email and never need to sign in.</p></div>
        <div className="customer-booking-modes" role="radiogroup" aria-label="Appointment booking mode">
          {[
            ["MANUAL_APPROVAL", "Owner approves first", "The safest default. You approve the time, then My AI PA sends the invitations."],
            ["AUTO_BOOK_CONNECTED", "Book automatically", "Books immediately only when a connected calendar is clear. Otherwise it waits for your approval."],
            ["EMAIL_INVITES_ONLY", "Email and text only", "No calendar connection. You approve the time and everyone receives links and a calendar file."],
          ].map(([value, title, detail]) => <label key={value} className={calendarBookingMode === value ? "selected" : ""}><input type="radio" name="calendar-booking-mode" value={value} checked={calendarBookingMode === value} onChange={() => setCalendarBookingMode(value)} /><span><strong>{title}</strong><small>{detail}</small></span></label>)}
        </div>
        <div className="customer-calendar-provider-actions">
          <label>Calendar belongs to<select value={calendarOwner} onChange={(event) => setCalendarOwner(event.target.value)}><option value="">Owner / shared business calendar</option>{staffMembers.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
          <button type="button" onClick={() => connect("google")} disabled={!calendarProviders.googleConfigured}>Connect Google Calendar</button>
          <button type="button" onClick={() => connect("microsoft")} disabled={!calendarProviders.microsoftConfigured}>Connect Outlook / Hotmail</button>
        </div>
        {!calendarProviders.googleConfigured && !calendarProviders.microsoftConfigured ? <p className="customer-calendar-setup-note">Calendar sign-in will become available after the secure Google and Microsoft app credentials are added to the server. Email and text booking works now.</p> : null}
        <div className="customer-calendar-connections">{calendarConnections.length ? calendarConnections.map((connection) => <div key={connection.id}><span className={`provider ${String(connection.provider).toLowerCase()}`}>{connection.provider === "MICROSOFT" ? "M" : "G"}</span><span><strong>{connection.accountEmail}</strong><small>{connection.staffMemberName} · {statusLabel(connection.status)}</small></span><button type="button" onClick={() => disconnect(connection)} disabled={Boolean(busy)}>Disconnect</button></div>) : <p>No owner calendar is connected yet. Email and downloadable calendar invitations remain available.</p>}</div>
      </div>
      <div className="customer-scheduling-grid">
        <div><p className="customer-eyebrow">Availability</p><h3>Working hours and travel time</h3><div className="customer-hours-list">
          {SCHEDULE_DAYS.map((day) => { const rule = hours[day] || { enabled: false, start: "08:00", end: "17:00" }; return <div key={day} className={!rule.enabled ? "is-closed" : ""}><label><input type="checkbox" checked={Boolean(rule.enabled)} onChange={(event) => updateDay(day, "enabled", event.target.checked)} /> {day.charAt(0).toUpperCase() + day.slice(1)}</label><input type="time" value={rule.start || "08:00"} onChange={(event) => updateDay(day, "start", event.target.value)} disabled={!rule.enabled} /><span>to</span><input type="time" value={rule.end || "17:00"} onChange={(event) => updateDay(day, "end", event.target.value)} disabled={!rule.enabled} /></div>; })}
        </div><div className="customer-rule-options"><label>Travel/setup buffer<select value={bufferMinutes} onChange={(event) => setBufferMinutes(Number(event.target.value))}><option value="0">No buffer</option><option value="15">15 minutes</option><option value="30">30 minutes</option><option value="45">45 minutes</option><option value="60">60 minutes</option></select></label><fieldset><legend>Automatic reminders</legend>{[24, 2].map((value) => <label key={value}><input type="checkbox" checked={reminderHours.includes(value)} onChange={(event) => setReminderHours((current) => event.target.checked ? [...new Set([...current, value])] : current.filter((item) => item !== value))} /> {value === 24 ? "24 hours before" : "2 hours before"}</label>)}</fieldset></div><button className="customer-save-schedule" type="button" onClick={save} disabled={Boolean(busy)}>{busy === "settings" ? "Saving…" : "Save scheduling rules"}</button></div>
        <div><p className="customer-eyebrow">Team calendars</p><h3>People who take appointments</h3><div className="customer-staff-list">{staffMembers.length ? staffMembers.map((member) => <div key={member.id}><i style={{ background: member.color }} /><span><strong>{member.name}</strong><small>{member.email || member.phone || "No direct notifications"}</small></span><button type="button" onClick={() => remove(member)} disabled={Boolean(busy)}>Remove</button></div>) : <p>No team members yet. Unassigned appointments use one shared business calendar.</p>}</div><form className="customer-staff-form" onSubmit={add}><input aria-label="Team member name" placeholder="Name" required value={staff.name} onChange={(event) => setStaff({ ...staff, name: event.target.value })} /><input type="email" aria-label="Team member email" placeholder="Email (optional)" value={staff.email} onChange={(event) => setStaff({ ...staff, email: event.target.value })} /><input aria-label="Team member phone" placeholder="Mobile (optional)" value={staff.phone} onChange={(event) => setStaff({ ...staff, phone: event.target.value })} /><label>Calendar colour<input type="color" value={staff.color} onChange={(event) => setStaff({ ...staff, color: event.target.value })} /></label><button type="submit" disabled={Boolean(busy)}>{busy === "staff" ? "Adding…" : "Add team member"}</button></form></div>
      </div>{message ? <p className="customer-appointment-message" role="status">{message}</p> : null}
    </section>
  );
}

function SupportReportModal({ open, call, onClose, onSubmitted }) {
  const [description, setDescription] = useState("");
  const [includeSensitiveCallData, setIncludeSensitiveCallData] = useState(false);
  const [contactAllowed, setContactAllowed] = useState(true);
  const [analysis, setAnalysis] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [ticketNumber, setTicketNumber] = useState("");

  useEffect(() => {
    if (!open) return undefined;
    setDescription("");
    setIncludeSensitiveCallData(false);
    setContactAllowed(true);
    setAnalysis(null);
    setBusy("");
    setError("");
    setTicketNumber("");
    const closeOnEscape = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open, call?.id, onClose]);

  if (!open) return null;

  const payload = {
    description,
    callId: call?.id || null,
    includeSensitiveCallData,
    contactAllowed,
    analysis,
  };
  const suggest = async () => {
    setBusy("suggest");
    setError("");
    try {
      const result = await getSupportSuggestions(payload);
      setAnalysis(result.analysis);
    } catch (requestError) {
      setError(requestError?.message || "Suggestions are unavailable right now.");
    } finally {
      setBusy("");
    }
  };
  const report = async () => {
    setBusy("report");
    setError("");
    try {
      const result = await sendSupportReport(payload);
      setTicketNumber(result.ticketNumber);
      await onSubmitted?.({ silent: true });
    } catch (requestError) {
      setError(requestError?.message || "The report could not be sent.");
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="customer-support-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="customer-support-modal" role="dialog" aria-modal="true" aria-labelledby="customer-support-title">
        <button type="button" className="customer-support-close" onClick={onClose} aria-label="Close report window">×</button>
        {ticketNumber ? (
          <div className="customer-support-success">
            <span aria-hidden="true">✓</span>
            <p className="customer-eyebrow">Report received</p>
            <h2 id="customer-support-title">We have the diagnostic snapshot.</h2>
            <p>Your reference number is <strong>{ticketNumber}</strong>. You do not need to explain the dashboard setup again.</p>
            <button type="button" onClick={onClose}>Done</button>
          </div>
        ) : (
          <>
            <p className="customer-eyebrow">AI-guided troubleshooting</p>
            <h2 id="customer-support-title">What is not working?</h2>
            <p className="customer-support-intro">Describe it normally. We will check the status already visible to your business and suggest the safest next step.</p>
            {call ? (
              <div className="customer-support-call-context">
                <span>Attached call</span>
                <strong>{call.caller?.name || fmtPhone(call.caller?.phone)} · {fmtTime(call.startedAt)}</strong>
              </div>
            ) : null}
            <label className="customer-support-description">
              Tell us what happened
              <textarea
                autoFocus
                value={description}
                onChange={(event) => {
                  setDescription(event.target.value);
                  setAnalysis(null);
                }}
                maxLength={1200}
                rows={4}
                placeholder={call ? "Example: The owner text did not arrive after this call." : "Example: My latest call is not showing on the dashboard."}
              />
              <small>{description.length}/1200</small>
            </label>
            {call ? (
              <label className="customer-support-checkbox">
                <input type="checkbox" checked={includeSensitiveCallData} onChange={(event) => setIncludeSensitiveCallData(event.target.checked)} />
                <span><strong>Include transcript and caller details in the support report</strong><small>AI suggestions use status information only. These private details are attached only if you send the report.</small></span>
              </label>
            ) : null}
            <label className="customer-support-checkbox">
              <input type="checkbox" checked={contactAllowed} onChange={(event) => setContactAllowed(event.target.checked)} />
              <span><strong>Support may contact me about this report</strong></span>
            </label>
            {error ? <p className="customer-support-error" role="alert">{error}</p> : null}
            {analysis ? (
              <div className="customer-support-analysis" aria-live="polite">
                <div className="customer-support-analysis-head">
                  <span aria-hidden="true">✦</span>
                  <div><small>{analysis.source === "ai" ? "AI-assisted check" : "Instant diagnostic check"}</small><strong>{analysis.summary}</strong></div>
                  <em className={`is-${String(analysis.severity || "medium").toLowerCase()}`}>{statusLabel(analysis.severity)}</em>
                </div>
                <p><strong>Likely cause:</strong> {analysis.likelyCause}</p>
                <ol>{(analysis.suggestions || []).map((suggestion, index) => <li key={`${index}-${suggestion}`}>{suggestion}</li>)}</ol>
                <div className="customer-support-actions">
                  <button type="button" className="secondary" onClick={onClose}>That fixed it</button>
                  <button type="button" className="primary" onClick={report} disabled={Boolean(busy)}>{busy === "report" ? "Sending…" : "Send report to support"}</button>
                </div>
              </div>
            ) : (
              <div className="customer-support-actions">
                <button type="button" className="secondary" onClick={report} disabled={Boolean(busy) || description.trim().length < 8}>{busy === "report" ? "Sending…" : "Send report now"}</button>
                <button type="button" className="primary" onClick={suggest} disabled={Boolean(busy) || description.trim().length < 8}>{busy === "suggest" ? "Checking…" : "Get suggestions"}</button>
              </div>
            )}
            <p className="customer-support-safety">Suggestions never change your phone service, messaging, or dashboard settings.</p>
          </>
        )}
      </section>
    </div>
  );
}

function CallDetails({ call, onReport }) {
  const detailEntries = Object.entries(call.details || {});
  const metricEntries = Object.entries(call.quality?.metrics || {});
  return (
    <div className="customer-call-details">
      <div className="customer-call-detail-grid">
        <section>
          <h3>Call summary</h3>
          <p>{call.aiSummary || "Summary pending."}</p>
          {call.successEvaluation ? <p className="customer-call-evaluation"><strong>Outcome check:</strong> {call.successEvaluation}</p> : null}
        </section>
        <section>
          <h3>Lead information</h3>
          {call.lead ? (
            <dl>
              <div><dt>Name</dt><dd>{call.lead.name || call.caller?.name || "Not provided"}</dd></div>
              <div><dt>Callback number</dt><dd>{fmtPhone(call.lead.callbackNumber || call.caller?.phone)}</dd></div>
              <div><dt>Reason</dt><dd>{call.lead.intent || call.lead.summary || "Not provided"}</dd></div>
              <div><dt>Urgency</dt><dd>{statusLabel(call.lead.urgency || "normal")}</dd></div>
            </dl>
          ) : <p>No separate lead record was created for this call.</p>}
        </section>
      </div>

      {detailEntries.length ? (
        <section className="customer-call-section">
          <h3>Details captured</h3>
          <dl className="customer-captured-details">
            {detailEntries.map(([key, value]) => (
              <div key={key}><dt>{readableKey(key)}</dt><dd>{readableValue(value)}</dd></div>
            ))}
          </dl>
        </section>
      ) : null}

      <section className="customer-call-section">
        <div className="customer-call-section-head">
          <h3>Transcript</h3>
          {call.transcriptAvailable && call.transcriptExpiresAt ? <span>Available until {fmtDate(call.transcriptExpiresAt)}</span> : null}
        </div>
        {call.transcriptAvailable ? <pre className="customer-transcript">{call.transcript}</pre> : <p>Transcript is not available or has passed the 30-day retention period.</p>}
      </section>

      <section className="customer-call-section">
        <div className="customer-call-section-head">
          <h3>Recording</h3>
          {call.recordingAvailable && call.recordingExpiresAt ? <span>Available until {fmtDate(call.recordingExpiresAt)}</span> : null}
        </div>
        {call.recordingAvailable ? (
          <div className="customer-recording">
            <audio controls preload="none" src={`${API_BASE}${call.recordingPath}`}>Your browser does not support audio playback.</audio>
            <a href={`${API_BASE}${call.recordingPath}?download=1`}>Download recording</a>
            <p>Available because recording consent was captured for this call.</p>
          </div>
        ) : <p>No consent-backed recording is available for this call.</p>}
      </section>

      <div className="customer-call-detail-grid">
        <section>
          <h3>Activity</h3>
          {call.timeline?.length ? (
            <ol className="customer-call-timeline">
              {call.timeline.map((event, index) => (
                <li key={`${event.type}-${event.at || index}`}><i aria-hidden="true" /><div><strong>{event.label}</strong><span>{fmtTime(event.at)}</span></div></li>
              ))}
            </ol>
          ) : <p>No activity has been recorded yet.</p>}
        </section>
        <section>
          <h3>Text delivery</h3>
          {call.notifications?.length ? (
            <ul className="customer-notification-list">
              {call.notifications.map((item, index) => (
                <li key={`${item.recipient}-${index}`}><strong>{readableKey(item.recipient || "message")}</strong><span>{item.problem || statusLabel(item.status)}</span></li>
              ))}
            </ul>
          ) : <p>No owner or customer text delivery events are linked yet.</p>}
          {metricEntries.length || call.quality?.score != null ? (
            <details className="customer-quality-details">
              <summary>Call quality details</summary>
              {call.quality?.score != null ? <p>Quality score: {call.quality.score}</p> : null}
              <dl>{metricEntries.map(([key, value]) => <div key={key}><dt>{readableKey(key)}</dt><dd>{value}</dd></div>)}</dl>
            </details>
          ) : null}
        </section>
      </div>
      <div className="customer-call-report-row">
        <span>Something wrong with this call?</span>
        <button type="button" onClick={() => onReport(call)}>Report this call</button>
      </div>
    </div>
  );
}

function LeadOutcomeRow({ lead, jobberConnected, onUpdated }) {
  const [status, setStatus] = useState(lead.status || "NEW");
  const [estimatedValue, setEstimatedValue] = useState(lead.estimatedValueCents == null ? "" : String(lead.estimatedValueCents / 100));
  const [actualRevenue, setActualRevenue] = useState(lead.actualRevenueCents == null ? "" : String(lead.actualRevenueCents / 100));
  const [reason, setReason] = useState(lead.outcomeReason || "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const save = async () => {
    setBusy(true); setMessage("");
    try {
      const result = await saveLeadOutcome(lead.id, {
        status,
        estimatedValueCents: estimatedValue === "" ? null : Math.round(Number(estimatedValue) * 100),
        actualRevenueCents: actualRevenue === "" ? null : Math.round(Number(actualRevenue) * 100),
        reason,
        syncToJobber: jobberConnected,
      });
      setMessage(result.jobber?.error ? `Outcome saved · Jobber needs attention: ${result.jobber.error}` : jobberConnected ? "Outcome saved · Jobber sync recorded" : "Outcome saved");
      await onUpdated();
    } catch (error) {
      setMessage(error.message || "Outcome could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="customer-revenue-lead">
      <div className="customer-revenue-lead-copy">
        <strong>{lead.name || fmtPhone(lead.callbackNumber)}</strong>
        <span>{statusLabel(lead.intent)} · {fmtTime(lead.createdAt)}</span>
        <p>{lead.summary || "Lead summary pending."}</p>
        {lead.handoff ? <small className={lead.handoff.acknowledgedAt ? "is-good" : "is-warn"}>{lead.handoff.acknowledgedAt ? `Acknowledged ${fmtTime(lead.handoff.acknowledgedAt)}` : lead.handoff.escalatedAt ? "Escalated to backup" : `Handoff ${statusLabel(lead.handoff.status)}`}</small> : null}
      </div>
      <div className="customer-revenue-outcome-form">
        <label>Outcome<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="NEW">New</option><option value="REVIEWED">Reviewed</option><option value="CONTACTED">Contacted</option><option value="WON">Won</option><option value="LOST">Lost</option><option value="ARCHIVED">Archived</option></select></label>
        <label>Est. value ($)<input inputMode="decimal" min="0" type="number" value={estimatedValue} onChange={(event) => setEstimatedValue(event.target.value)} /></label>
        <label>Won revenue ($)<input inputMode="decimal" min="0" type="number" required={status === "WON"} value={actualRevenue} onChange={(event) => setActualRevenue(event.target.value)} /></label>
        <label className="customer-revenue-reason">Reason / note<input maxLength="500" value={reason} onChange={(event) => setReason(event.target.value)} placeholder={status === "LOST" ? "Why was it lost?" : "Optional note"} /></label>
        <button type="button" onClick={save} disabled={busy || (status === "WON" && actualRevenue === "")}>{busy ? "Saving…" : "Save outcome"}</button>
        {message ? <p className={/attention|could not/i.test(message) ? "has-error" : "has-success"} role="status">{message}</p> : null}
      </div>
    </article>
  );
}

function RevenueRescuePanel({ revenueRescue = {}, jobber = {}, onUpdated }) {
  const sla = revenueRescue.handoffSla || {};
  const leads = revenueRescue.leads || [];
  return (
    <section id="revenue" className="customer-panel customer-revenue-panel">
      <div className="customer-panel-head">
        <div><p className="customer-eyebrow">Revenue Rescue Ledger</p><h2>Every lead, handoff, and outcome</h2></div>
        <span>{revenueRescue.measuredLeads || 0} outcomes measured</span>
      </div>
      <div className="customer-revenue-kpis">
        <div><span>Recovered revenue</span><strong>{fmtMoney(revenueRescue.recoveredRevenueCents)}</strong><em>owner-confirmed won work</em></div>
        <div><span>Open pipeline</span><strong>{fmtMoney(revenueRescue.pipelineValueCents)}</strong><em>{revenueRescue.activeLeads || 0} active leads</em></div>
        <div><span>Lead conversion</span><strong>{revenueRescue.conversionRate == null ? "—" : `${revenueRescue.conversionRate}%`}</strong><em>{revenueRescue.wonLeads || 0} won · {revenueRescue.lostLeads || 0} lost</em></div>
        <div><span>2-minute SLA</span><strong>{sla.metSlaRate == null ? "—" : `${sla.metSlaRate}%`}</strong><em>{sla.overdue || 0} overdue now</em></div>
      </div>
      <p className="customer-revenue-intro">Update what happened after each call. Won revenue and lost reasons turn call activity into measurable return on investment.</p>
      <div className="customer-revenue-leads">
        {leads.length ? leads.map((lead) => <LeadOutcomeRow key={lead.id} lead={lead} jobberConnected={jobber.connected} onUpdated={onUpdated} />) : <p className="customer-empty">Qualified calls will appear here as soon as the assistant creates a lead.</p>}
      </div>
    </section>
  );
}

function JobberIntegrationPanel({ jobber = {}, onUpdated }) {
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const disconnect = async () => {
    setBusy("disconnect"); setMessage("");
    try { await disconnectJobberIntegration(); setMessage("Jobber disconnected."); await onUpdated(); }
    catch (error) { setMessage(error.message || "Jobber could not be disconnected."); }
    finally { setBusy(""); }
  };
  const retry = async (leadId) => {
    setBusy(`sync-${leadId}`); setMessage("");
    try { await retryJobberLeadSync(leadId); setMessage("Jobber sync completed."); await onUpdated(); }
    catch (error) { setMessage(error.message || "Jobber sync could not be retried."); }
    finally { setBusy(""); }
  };
  return (
    <section id="integrations" className="customer-panel customer-jobber-panel">
      <div className="customer-panel-head"><div><p className="customer-eyebrow">Field-service integration</p><h2>Jobber</h2></div><span className={jobber.connected ? "is-connected" : ""}>{jobber.connected ? "Connected" : jobber.configured ? "Ready to connect" : "Setup required"}</span></div>
      <div className="customer-jobber-summary">
        <div><strong>{jobber.accountName || "Send MyAIPA leads into Jobber"}</strong><p>Owner-confirmed lead outcomes create an idempotent Jobber client sync, with failures visible here instead of disappearing silently.</p></div>
        {jobber.connected ? <button type="button" onClick={disconnect} disabled={Boolean(busy)}>{busy === "disconnect" ? "Disconnecting…" : "Disconnect"}</button> : jobber.configured ? <a href={`${API_BASE}/api/customer/dashboard/integrations/jobber/connect`}>Connect Jobber</a> : <span className="customer-jobber-config-note">Add the Jobber app credentials on the backend to enable OAuth.</span>}
      </div>
      <div className="customer-jobber-syncs">
        {(jobber.recentSyncs || []).length ? jobber.recentSyncs.map((sync) => <div key={sync.id}><span><strong>{sync.leadName || `Lead #${sync.leadId}`}</strong><small>{statusLabel(sync.status)} · {fmtTime(sync.syncedAt || sync.createdAt)}</small>{sync.lastError ? <em>{sync.lastError}</em> : null}</span>{sync.status === "FAILED" ? <button type="button" onClick={() => retry(sync.leadId)} disabled={Boolean(busy)}>{busy === `sync-${sync.leadId}` ? "Retrying…" : "Retry"}</button> : null}</div>) : <p className="customer-empty">No Jobber sync attempts yet.</p>}
      </div>
      {message ? <p className="customer-jobber-message" role="status">{message}</p> : null}
    </section>
  );
}

function SimpleTrialBar({ usage = {}, trialText = "", trialEndAt = "", billing = {}, onRefresh }) {
  const remaining = Math.max(0, Math.round(Number(usage.remainingMinutes || 0)));
  const limit = Math.max(1, Number(usage.limitMinutes || 60));
  const used = Math.max(0, Number(usage.usedMinutes || 0));
  const percent = Math.max(0, Math.min(100, Math.round((used / limit) * 100)));
  const paused = Boolean(usage.newCallsPaused || usage.limitReached);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const openBilling = async () => {
    setBusy("setup");
    setMessage("");
    try {
      const result = await startSecureBillingSetup();
      if (result.checkoutUrl) window.location.assign(result.checkoutUrl);
      else {
        setMessage("Payment is ready.");
        await onRefresh?.();
      }
    } catch (error) {
      setMessage(error?.message || "Secure billing could not be opened.");
    } finally {
      setBusy("");
    }
  };
  const cancelContinuation = async () => {
    if (!window.confirm("Keep the free trial, but stop paid service from starting when it ends?")) return;
    setBusy("cancel");
    setMessage("");
    try {
      await cancelPaidContinuation();
      setMessage("Paid continuation is cancelled. Your trial remains available until it ends.");
      await onRefresh?.();
    } catch (error) {
      setMessage(error?.message || "The billing change could not be saved.");
    } finally {
      setBusy("");
    }
  };
  return (
    <section className={`customer-simple-trial${paused ? " is-paused" : ""}`} aria-label="Free trial usage">
      <div>
        <span>Free trial</span>
        <strong>{paused ? "New AI calls are paused" : `${remaining} minutes left`}</strong>
        <small>{trialText}{trialEndAt ? ` · Ends ${fmtDate(trialEndAt)}` : ""}</small>
      </div>
      <div className="customer-simple-trial-progress" role="progressbar" aria-label="Trial minutes used" aria-valuemin="0" aria-valuemax={limit} aria-valuenow={Math.min(limit, used)}>
        <i style={{ width: `${percent}%` }} />
      </div>
      <div className="customer-trial-billing">
        {billing.paymentReady ? <strong className="is-ready">✓ Payment ready</strong> : billing.checkoutAvailable ? (
          <button type="button" onClick={openBilling} disabled={Boolean(busy) || !billing.canAddPaymentMethod}>
            {busy === "setup" ? "Opening Stripe…" : billing.paymentFailed ? "Replace card securely" : "Add card securely"}
          </button>
        ) : <strong>Checkout opens after your trial</strong>}
        {billing.paymentReady && !billing.cancelAtPeriodEnd ? (
          <button type="button" className="is-link" onClick={cancelContinuation} disabled={Boolean(busy)}>
            {busy === "cancel" ? "Saving…" : "Cancel paid continuation"}
          </button>
        ) : null}
        {billing.cancelAtPeriodEnd ? <small>Paid continuation cancelled</small> : null}
      </div>
      <p className="customer-trial-disclosure">{billing.paymentFailed ? "The last payment did not go through, so new AI calls are paused. Use Stripe Checkout to replace the card." : billing.disclosure || "No card is required during your 14-day free trial. Stripe Checkout opens after it ends."}</p>
      {message ? <p className="customer-trial-message" role="status">{message}</p> : null}
    </section>
  );
}

function CustomerDashboardView({ dashboard, onSignOut, onRefresh, refreshing, refreshError, refreshedAt }) {
  const signup = dashboard.signup || {};
  const stats = dashboard.stats || {};
  const assistant = dashboard.assistant || {};
  const messaging = dashboard.messaging || {};
  const billing = dashboard.billing || {};
  const support = dashboard.support || {};
  const trialUsage = dashboard.trialUsage || {};
  const checklist = dashboard.setup?.checklist || [];
  const readiness = dashboard.setup?.readinessPercent || 0;
  const nextStep = checklist.find((item) => !item.done);
  const [openCallId, setOpenCallId] = useState(null);
  const [supportState, setSupportState] = useState({ open: false, call: null });
  const openSupport = useCallback((call = null) => setSupportState({ open: true, call }), []);
  const closeSupport = useCallback(() => setSupportState({ open: false, call: null }), []);
  const calls = dashboard.calls || dashboard.recentCalls || [];
  const appointments = dashboard.appointments || [];
  const supportReports = dashboard.supportReports || [];
  const staffMembers = dashboard.staffMembers || [];
  const actionRequiredAppointments = appointments.filter((appointment) => ["PENDING", "CHANGE_REQUESTED"].includes(appointment.status)).length;
  const confirmedAppointments = appointments.filter((appointment) => appointment.status === "CONFIRMED").length;
  const automaticCalendarBooking = dashboard.scheduling?.calendarBookingMode === "AUTO_BOOK_CONNECTED";
  const revenueRescue = dashboard.revenueRescue || {};
  const jobber = dashboard.integrations?.jobber || {};
  const aiNumber = assistant.aiNumber || signup.twilioPhoneNumber || "";
  const followUpCalls = calls.filter((call) => call.followUpNeeded);
  const followUpCount = Math.max(Number(stats.followUps || 0), followUpCalls.length);
  const pendingAppointments = appointments.filter((appointment) => ["PENDING", "CHANGE_REQUESTED"].includes(appointment.status));
  const [copyState, setCopyState] = useState("");
  const moreSettingsRef = useRef(null);

  const trialText = useMemo(() => {
    if (!signup.trialEndAt) return "Trial date pending";
    const days = Math.ceil((new Date(signup.trialEndAt).getTime() - Date.now()) / 86400000);
    if (!Number.isFinite(days)) return fmtDate(signup.trialEndAt);
    if (days < 0) return "Trial ended";
    if (days === 0) return "Trial ends today";
    return `${days} days left`;
  }, [signup.trialEndAt]);

  const primaryAction = useMemo(() => {
    if (!aiNumber) return {
      title: "Your phone number is being prepared",
      detail: "You do not need to do anything yet. Refresh this page in a few minutes.",
      label: "Check again",
      target: "refresh",
    };
    if (actionRequiredAppointments) return {
      title: `${actionRequiredAppointments} appointment${actionRequiredAppointments === 1 ? "" : "s"} ${actionRequiredAppointments === 1 ? "needs" : "need"} your answer`,
      detail: "Choose a time, then confirm it or suggest another one.",
      label: "Answer now",
      target: "#appointments",
    };
    if (followUpCount) return {
      title: `Call back ${followUpCount} ${followUpCount === 1 ? "customer" : "customers"}`,
      detail: "Their names, phone numbers, and reasons for calling are ready below.",
      label: "See calls",
      target: "#calls",
    };
    if (nextStep) return {
      title: nextStep.label,
      detail: "Open setup details and finish this one item.",
      label: "Open setup",
      target: "settings",
    };
    return {
      title: "You are all caught up",
      detail: "Nothing needs your attention right now.",
      label: "See recent calls",
      target: "#calls",
    };
  }, [actionRequiredAppointments, aiNumber, followUpCount, nextStep]);

  const copyNumber = async () => {
    if (!aiNumber) return;
    try {
      await navigator.clipboard.writeText(aiNumber);
      setCopyState("Copied");
    } catch (_error) {
      setCopyState("Press and hold the number to copy it");
    }
    window.setTimeout(() => setCopyState(""), 2400);
  };

  const openMoreSettings = () => {
    if (!moreSettingsRef.current) return;
    moreSettingsRef.current.open = true;
    moreSettingsRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <main className="customer-dashboard customer-dashboard-simple">
      <section className="customer-simple-shell">
        <header className="customer-simple-header">
          <Brand />
          <div>
            <strong>{signup.businessName || "Your business"}</strong>
            <span>{refreshError || (refreshing ? "Checking for updates…" : `Updated ${fmtRefreshTime(refreshedAt)}`)}</span>
          </div>
          <button type="button" onClick={onSignOut}>Sign out</button>
        </header>

        <section id="overview" className={`customer-simple-hero${aiNumber ? " is-ready" : " is-waiting"}`}>
          <div className="customer-simple-hero-copy">
            <span className="customer-simple-status"><i />{aiNumber ? "Ready for calls" : "Finishing setup"}</span>
            <h1>{aiNumber ? "Your assistant is ready." : "We are setting up your assistant."}</h1>
            <p>{aiNumber ? "Call the number to hear it. When you are happy, forward missed calls to it." : "Your number will appear here as soon as it is ready."}</p>
            <div className="customer-simple-service-state">
              <span>{messaging.serviceTextsActive ? "✓" : "!"}</span>
              <p><strong>Text updates: {messaging.serviceTextsActive ? "On" : messaging.status === "PAUSED" ? "Paused" : "Not ready"}</strong>{messaging.guidance ? ` · ${messaging.guidance}` : ""}</p>
            </div>
          </div>
          <div className="customer-simple-number-card">
            <span>Your My AI PA number</span>
            <strong>{fmtPhone(aiNumber)}</strong>
            {aiNumber ? <div><a href={`tel:${aiNumber}`}>Call it now</a><button type="button" onClick={copyNumber}>Copy number</button></div> : <button type="button" onClick={onRefresh} disabled={refreshing}>{refreshing ? "Checking…" : "Check again"}</button>}
            {copyState ? <small role="status">{copyState}</small> : null}
          </div>
        </section>

        <section className="customer-simple-next" aria-labelledby="customer-next-title">
          <span>DO THIS NEXT</span>
          <div>
            <h2 id="customer-next-title">{primaryAction.title}</h2>
            <p>{primaryAction.detail}</p>
          </div>
          {primaryAction.target === "refresh" ? <button type="button" onClick={onRefresh} disabled={refreshing}>{refreshing ? "Checking…" : primaryAction.label}</button> : primaryAction.target === "settings" ? <button type="button" onClick={openMoreSettings}>{primaryAction.label}</button> : <a href={primaryAction.target}>{primaryAction.label}</a>}
        </section>

        {trialUsage.lifecycle === "trial" || billing.paymentFailed || billing.paused ? <SimpleTrialBar usage={trialUsage} trialText={trialText} trialEndAt={signup.trialEndAt} billing={billing} onRefresh={onRefresh} /> : null}

        <CustomerHelpActions phone={support.phone} />

        {aiNumber ? <ForwardingSetupGuide assignedNumber={aiNumber} compact /> : null}

        <section className="customer-simple-stats" aria-label="Your important numbers">
          <article><span>Calls answered</span><strong>{stats.totalCalls || 0}</strong><small>by My AI PA</small></article>
          <article className={followUpCount ? "needs-action" : ""}><span>Call back</span><strong>{followUpCount}</strong><small>{followUpCount ? "customers waiting" : "none waiting"}</small></article>
          <article className={actionRequiredAppointments ? "needs-action" : ""}><span>Appointments</span><strong>{actionRequiredAppointments}</strong><small>{actionRequiredAppointments ? "need your answer" : `${confirmedAppointments} confirmed`}</small></article>
        </section>

        {pendingAppointments.length ? (
          <section id="appointments" className="customer-simple-section customer-simple-appointments">
            <div className="customer-simple-section-head"><div><span>NEEDS YOUR ANSWER</span><h2>Appointment requests</h2></div><strong>{pendingAppointments.length}</strong></div>
            <div className="customer-appointment-list">
              {pendingAppointments.map((appointment) => <AppointmentRequestCard key={appointment.id} appointment={appointment} staffMembers={staffMembers} onUpdated={onRefresh} />)}
            </div>
          </section>
        ) : null}

        <section id="calls" className="customer-simple-section customer-simple-calls">
          <div className="customer-panel-head customer-call-panel-head">
            <div><span className="customer-simple-kicker">WHAT HAPPENED</span><h2>Recent calls</h2></div>
            <div className="customer-live-refresh">
              <span className={refreshError ? "has-error" : ""} role="status" aria-live="polite">
                {refreshError || (refreshing ? "Checking…" : "Up to date")}
              </span>
              <button type="button" onClick={onRefresh} disabled={refreshing}>
                {refreshing ? "Checking…" : "Refresh"}
              </button>
            </div>
          </div>
          <div className="customer-call-list">
            {calls.length ? calls.map((call) => (
              <article key={call.id} className={openCallId === call.id ? "is-open" : ""}>
                <button
                  type="button"
                  className="customer-call-summary"
                  onClick={() => setOpenCallId((current) => current === call.id ? null : call.id)}
                  aria-expanded={openCallId === call.id}
                >
                  <span className="customer-call-identity">
                    <strong>{call.caller?.name || fmtPhone(call.caller?.phone)}</strong>
                    <small>{fmtTime(call.startedAt)} · {fmtDuration(call.durationSec)}</small>
                  </span>
                  <span className="customer-call-copy">{call.aiSummary || "Summary pending."}</span>
                  <span className={`customer-call-status${call.followUpNeeded ? " needs-followup" : ""}`}>{call.followUpNeeded ? "Follow up" : statusLabel(call.outcome || call.status)}</span>
                  <span className="customer-call-chevron" aria-hidden="true">⌄</span>
                </button>
                {openCallId === call.id ? <CallDetails call={call} onReport={openSupport} /> : null}
              </article>
            )) : <p className="customer-empty">No calls yet. Your first completed call will appear here.</p>}
          </div>
        </section>

        <details id="more-settings" className="customer-more-tools" ref={moreSettingsRef}>
          <summary><span><strong>More settings</strong><small>Phone setup, calendars, team, leads, FAQs, and support history</small></span><i aria-hidden="true">+</i></summary>
          <div className="customer-more-tools-body">
            <section className="customer-grid">
              <div id="setup" className="customer-panel">
                <div className="customer-panel-head"><h2>Setup</h2>{nextStep ? <span>Next: {nextStep.label}</span> : <span>Ready</span>}</div>
                <div className="customer-checklist">{checklist.map((item) => <div key={item.key} className={item.done ? "done" : ""}><span>{item.done ? "✓" : "!"}</span><p>{item.label}</p></div>)}</div>
              </div>
              <div className="customer-panel">
                <div className="customer-panel-head"><h2>Phone settings</h2><span>{readiness}% ready</span></div>
                <div className="customer-settings-list">
                  <div><span>Answers after</span><strong>{assistant.answerAfterRings ?? 3} rings</strong></div>
                  <div><span>Business phone</span><strong>{fmtPhone(signup.businessPhone)}</strong></div>
                  <div><span>Owner phone</span><strong>{fmtPhone(signup.ownerPhone)}</strong></div>
                  <div><span>Text updates</span><strong>{messaging.status === "PAUSED" ? "Paused" : messaging.serviceTextsActive ? "On" : "Not ready"}</strong></div>
                  <div><span>Appointment booking</span><strong>{automaticCalendarBooking ? "Automatic when clear" : dashboard.scheduling?.calendarBookingMode === "EMAIL_INVITES_ONLY" ? "Email and text only" : "You confirm first"}</strong></div>
                </div>
              </div>
            </section>

            <section className="customer-panel customer-appointments-panel">
              <div className="customer-panel-head"><div><p className="customer-eyebrow">Calendar</p><h2>Appointments and availability</h2></div><span>{confirmedAppointments} confirmed</span></div>
              <AppointmentCalendar appointments={appointments} />
              <SchedulingControls scheduling={dashboard.scheduling} staffMembers={staffMembers} calendarConnections={dashboard.calendarConnections || []} calendarProviders={dashboard.calendarProviders || {}} onUpdated={onRefresh} />
            </section>

            <RevenueRescuePanel revenueRescue={revenueRescue} jobber={jobber} onUpdated={onRefresh} />
            <JobberIntegrationPanel jobber={jobber} onUpdated={onRefresh} />

            <section id="faqs" className="customer-panel">
              <div className="customer-panel-head"><h2>Answers your assistant uses</h2><span>{dashboard.faqs?.length || 0} saved</span></div>
              <div className="customer-faq-grid">{dashboard.faqs?.length ? dashboard.faqs.map((faq) => <div key={faq.id}><strong>{faq.question}</strong><p>{faq.answer}</p></div>) : <p className="customer-empty">No answers added yet.</p>}</div>
            </section>

            <section id="support" className="customer-panel customer-support-history">
              <div className="customer-panel-head"><div><p className="customer-eyebrow">Help</p><h2>Your support reports</h2></div><button type="button" onClick={() => openSupport(null)}>Report a problem</button></div>
              <div className="customer-support-history-list">
                {supportReports.length ? supportReports.map((report) => <article key={report.id} className={`is-${String(report.status || "new").toLowerCase()}`}><div><strong>{report.ticketNumber}</strong><span>{fmtTime(report.createdAt)}{report.callId ? ` · Call #${report.callId}` : ""}</span></div><em>{statusLabel(report.status)}</em><p>{report.description}</p>{report.customerMessage ? <blockquote><strong>Support update</strong>{report.customerMessage}</blockquote> : null}{report.resolvedAt ? <small>Resolved {fmtTime(report.resolvedAt)}</small> : <small>Last updated {fmtTime(report.updatedAt)}</small>}</article>) : <p className="customer-empty">No support reports.</p>}
              </div>
            </section>
          </div>
        </details>

        <footer className="customer-simple-footer">
          <button type="button" onClick={() => openSupport(null)}>
            <span aria-hidden="true">?</span>
            <strong>Something not working?</strong>
            <small>Tell us once. We attach the useful details.</small>
          </button>
          <a href="#/signup">Add another business</a>
        </footer>
      </section>
      <button type="button" className="customer-support-launcher" onClick={() => openSupport(null)}>
        <span aria-hidden="true">?</span>
        Get help
      </button>
      <SupportReportModal open={supportState.open} call={supportState.call} onClose={closeSupport} onSubmitted={onRefresh} />
    </main>
  );
}

export default function CustomerDashboard() {
  const [credentials, setCredentials] = useState(readStoredLookup);
  const [dashboard, setDashboard] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [step, setStep] = useState("lookup");
  const [code, setCode] = useState("");
  const [destination, setDestination] = useState("");
  const [devCode, setDevCode] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const [refreshedAt, setRefreshedAt] = useState("");
  const refreshInFlight = useRef(false);

  const normalizedCredentials = {
    email: credentials.email || "",
    phone: credentials.phone || "",
  };

  const submit = async (event) => {
    event?.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (step === "lookup") {
        const result = await requestDashboardCode(normalizedCredentials);
        setDestination(result.destination || "your registered phone");
        setDevCode(result.devCode || "");
        setCode("");
        setStep("code");
      } else {
        const result = await verifyDashboardCode(normalizedCredentials, code);
        rememberLookup(normalizedCredentials);
        setDashboard(result.dashboard);
        setRefreshedAt(result.refreshedAt);
        setRefreshError("");
      }
    } catch (err) {
      if (step === "lookup") setDashboard(null);
      setError(err?.message || (step === "code" ? "The code could not be verified." : "A sign-in code could not be sent."));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    refreshDashboard()
      .then((result) => {
        if (cancelled) return;
        setDashboard(result.dashboard);
        setRefreshedAt(result.refreshedAt);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => { cancelled = true; };
  }, []);

  const refresh = useCallback(async ({ silent = false } = {}) => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    if (!silent) setRefreshing(true);
    try {
      const result = await refreshDashboard();
      setDashboard(result.dashboard);
      setRefreshedAt(result.refreshedAt);
      setRefreshError("");
    } catch (err) {
      setRefreshError(err?.message || "Live refresh is temporarily unavailable.");
    } finally {
      refreshInFlight.current = false;
      if (!silent) setRefreshing(false);
    }
  }, []);

  const hasDashboard = Boolean(dashboard);
  useEffect(() => {
    if (!hasDashboard) return undefined;

    const timer = window.setInterval(() => refresh({ silent: true }), 15000);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refresh({ silent: true });
    };
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [hasDashboard, refresh]);

  if (!dashboard) {
    return (
      <LookupForm
        credentials={normalizedCredentials}
        setCredentials={setCredentials}
        onSubmit={submit}
        busy={busy}
        error={error}
        step={step}
        code={code}
        setCode={setCode}
        destination={destination}
        devCode={devCode}
        onBack={() => {
          setStep("lookup");
          setCode("");
          setDestination("");
          setDevCode("");
          setError("");
        }}
      />
    );
  }

  return (
    <CustomerDashboardView
      dashboard={dashboard}
      onRefresh={() => refresh()}
      refreshing={refreshing}
      refreshError={refreshError}
      refreshedAt={refreshedAt}
      onSignOut={() => {
        endDashboardSession().catch(() => {});
        forgetLookup();
        setDashboard(null);
        setCredentials({ email: "", phone: "" });
        setStep("lookup");
        setCode("");
        setDestination("");
        setDevCode("");
        setRefreshError("");
        setRefreshedAt("");
      }}
    />
  );
}
