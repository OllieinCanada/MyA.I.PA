import React, { useEffect, useRef, useState } from "react";
import { onboardingRequest, tokenFromSetupUrl } from "./onboardingApi";

const emptyDetails = { businessName: "", services: "", serviceAreas: "", businessNotes: "" };
const FIELD_LABELS = { businessName: "Business display name", services: "Services", serviceAreas: "Service areas", businessNotes: "Business answers and notes" };
const FIELD_LIMITS = { businessName: 140, services: 4000, serviceAreas: 2000, businessNotes: 4000 };

function requestId() {
  return typeof window.crypto?.randomUUID === "function" ? window.crypto.randomUUID() : `business-edit-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function BusinessDetailsEditor({ token = "", onCancel, onSaved, onAccess, accessOnly = false }) {
  const [accessToken, setAccessToken] = useState(token);
  const [details, setDetails] = useState(emptyDetails);
  const [revision, setRevision] = useState(0);
  const [phase, setPhase] = useState("loading");
  const [credentials, setCredentials] = useState({ email: "", phone: "" });
  const [code, setCode] = useState("");
  const [destination, setDestination] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retryOnly, setRetryOnly] = useState(false);
  const draftDirty = useRef(false);
  const saveSnapshot = useRef(null);
  const mounted = useRef(true);
  const callbacks = useRef({ onAccess, onSaved });
  callbacks.current = { onAccess, onSaved };

  const open = async (providedToken = accessToken) => {
    setError("");
    try {
      let nextToken = providedToken;
      if (!nextToken || accessOnly) {
        const setup = await onboardingRequest("/api/customer/dashboard/forwarding/setup-link", "", { method: "POST", body: "{}" });
        nextToken = tokenFromSetupUrl(setup.url);
        if (!nextToken) throw new Error("The saved setup link is unavailable. Your receptionist has not been changed.");
        if (!mounted.current) return;
        setAccessToken(nextToken);
        callbacks.current.onAccess?.(nextToken, setup.forwarding, setup.url);
        if (accessOnly) return;
      }
      const data = await onboardingRequest("/api/customer/dashboard/business-details", nextToken);
      if (!mounted.current) return;
      if (data.pendingSave?.requestId && data.pendingSave?.details && Number.isInteger(data.pendingSave.expectedRevision)) {
        const pending = { requestId: data.pendingSave.requestId, expectedRevision: data.pendingSave.expectedRevision, details: { ...emptyDetails, ...data.pendingSave.details } };
        setDetails(pending.details);
        setRevision(pending.expectedRevision);
        draftDirty.current = true;
        saveSnapshot.current = { signature: JSON.stringify({ expectedRevision: pending.expectedRevision, details: pending.details }), body: pending };
        setRetryOnly(true);
      } else if (!draftDirty.current) {
        setDetails({ ...emptyDetails, ...data.details });
        setRevision(data.revision);
      }
      if (["needs_attention", "updating"].includes(data.status) && !data.pendingSave) {
        setPhase("error");
        setError("A previous save needs attention. Call support before starting another update.");
      } else setPhase("editing");
    } catch (requestError) {
      if (!mounted.current) return;
      if (requestError.status === 401) setPhase("login");
      else { setPhase("error"); setError(requestError.message); }
    }
  };

  useEffect(() => {
    mounted.current = true;
    open(token);
    return () => { mounted.current = false; };
    // Initial authorization check only. Drafts stay in memory; never in storage.
  }, []);

  const authenticate = async (event) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      if (phase === "login") {
        const data = await onboardingRequest("/api/customer/dashboard/request-code", "", { method: "POST", body: JSON.stringify(credentials) });
        if (!data.codeSent) throw new Error("The sign-in code was not accepted. Please call support.");
        setDestination(data.destination || "your registered phone");
        setPhase("code");
      } else {
        const data = await onboardingRequest("/api/customer/dashboard/verify-code", "", { method: "POST", body: JSON.stringify({ ...credentials, code }) });
        if (!data.dashboard) throw new Error("The code could not be verified. Please try again.");
        await open(accessToken);
      }
    } catch (requestError) { setError(requestError.message); } finally { setBusy(false); }
  };

  const save = async (event) => {
    event.preventDefault(); setBusy(true); setError("");
    const signature = JSON.stringify({ expectedRevision: revision, details });
    if (!saveSnapshot.current || (!retryOnly && saveSnapshot.current.signature !== signature)) {
      saveSnapshot.current = { signature, body: { requestId: requestId(), expectedRevision: revision, details: { ...details } } };
    }
    try {
      const data = await onboardingRequest("/api/customer/dashboard/business-details", accessToken, {
        method: "PATCH", headers: { "X-MyAIPA-Editor": "1" }, body: JSON.stringify(saveSnapshot.current.body),
      });
      if (data.status !== "published") throw new Error("This update has not been confirmed yet. Retry this same save before changing the draft.");
      saveSnapshot.current = null;
      callbacks.current.onSaved?.(data);
    } catch (requestError) {
      setError(requestError.message);
      if (requestError.status === 401) setPhase("login");
      else if (!requestError.status || requestError.status >= 500 || ["BUSINESS_EDIT_PENDING", "BUSINESS_EDIT_CALL_ACTIVE", "BUSINESS_EDIT_BUSY"].includes(requestError.code)) setRetryOnly(true);
    } finally { setBusy(false); }
  };

  return <section className="onboarding-editor" aria-labelledby="business-editor-title" aria-busy={busy || phase === "loading"}>
    <h1 id="business-editor-title">{accessOnly ? "Open your saved setup" : "Edit business details"}</h1>
    {phase === "loading" ? <p role="status">Opening your existing receptionist’s details…</p> : null}
    {phase === "login" || phase === "code" ? <>
      <p>Verify the registered owner to open this existing receptionist. You will return here after signing in.</p>
      <form onSubmit={authenticate}>
        <fieldset disabled={busy}>
          {phase === "login" ? <>
            <label>Signup email<input type="email" name="email" autoComplete="email" required value={credentials.email} onChange={event => setCredentials(current => ({ ...current, email: event.target.value }))} /></label>
            <label>Owner or business phone<input type="tel" name="phone" autoComplete="tel" required value={credentials.phone} onChange={event => setCredentials(current => ({ ...current, phone: event.target.value }))} /></label>
          </> : <>
            <p>Enter the six-digit code sent to {destination}.</p>
            <label>One-time sign-in code<input type="text" name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" required value={code} onChange={event => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} /></label>
          </>}
        </fieldset>
        <button className="onboarding-primary" type="submit" disabled={busy}>{busy ? "Checking…" : phase === "login" ? "Text me a sign-in code" : "Verify and return to setup"}</button>
      </form>
      {phase === "code" ? <button className="onboarding-secondary" type="button" disabled={busy} onClick={() => { setPhase("login"); setCode(""); }}>Use different sign-in details</button> : null}
    </> : null}
    {phase === "editing" ? <>
      <p>Update your existing receptionist’s business display name, services, areas and answers. Your assigned number stays the same.</p>
      <form onSubmit={save}>
        <fieldset disabled={busy || retryOnly}>
          {Object.keys(emptyDetails).map(field => <label key={field}>{FIELD_LABELS[field]}
            {field === "businessName" ? <input value={details[field]} required maxLength={FIELD_LIMITS[field]} onChange={event => { draftDirty.current = true; setDetails(current => ({ ...current, [field]: event.target.value })); }} />
              : <textarea value={details[field]} maxLength={FIELD_LIMITS[field]} onChange={event => { draftDirty.current = true; setDetails(current => ({ ...current, [field]: event.target.value })); }} />}
          </label>)}
        </fieldset>
        {retryOnly ? <p className="onboarding-edit-notice">The last save is not confirmed. Retry that same save before changing these details.</p> : null}
        <button className="onboarding-primary" type="submit" disabled={busy}>{busy ? "Saving and verifying…" : retryOnly ? "Retry this save" : "Save changes and return to test"}</button>
      </form>
    </> : null}
    {error ? <p className="onboarding-message is-error" role="alert">{error}</p> : null}
    {phase === "error" ? <button className="onboarding-primary" type="button" onClick={() => { setPhase("loading"); open(); }}>Try opening saved details again</button> : null}
    <button className="onboarding-secondary" type="button" onClick={onCancel} disabled={busy || retryOnly}>Return to my receptionist</button>
  </section>;
}
