import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getApiBaseUrl, normalizeApiBase } from "./config/apiBase";
import "./ForwardingSetup.css";

const API_BASE = normalizeApiBase(getApiBaseUrl(process.env.REACT_APP_API_BASE_URL));
const CARRIERS = [["bell", "Bell"], ["rogers", "Rogers"], ["telus", "TELUS"], ["other", "Other"], ["not_sure", "Not sure"]];
const LINE_TYPES = [["mobile", "Mobile / cell phone"], ["landline", "Business / home landline"], ["voip", "VoIP / cloud phone"], ["not_sure", "Not sure"]];

function tokenFromLocation() {
  const query = String(window.location.hash || "").split("?")[1] || window.location.search.replace(/^\?/, "");
  return new URLSearchParams(query).get("token") || "";
}

function fmtPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}` : value;
}

async function forwardingRequest(path, token, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", Authorization: `Forwarding ${token}`, ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Forwarding setup could not be updated.");
  return data;
}

export default function ForwardingSetup() {
  const token = useMemo(tokenFromLocation, []);
  const [forwarding, setForwarding] = useState(null);
  const [carrier, setCarrier] = useState("not_sure");
  const [lineType, setLineType] = useState("not_sure");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const automaticTestStarted = useRef(false);
  const supportsMobileDialer = typeof navigator !== "undefined" && (
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || "")
    || (navigator.platform === "MacIntel" && Number(navigator.maxTouchPoints) > 1)
  );

  const load = useCallback(async () => {
    if (!token) throw new Error("This secure setup link is incomplete. Open your dashboard for a new one.");
    const data = await forwardingRequest("/api/forwarding/setup", token);
    setForwarding(data.forwarding);
    setCarrier(data.forwarding.carrier);
    setLineType(data.forwarding.lineType);
    return data.forwarding;
  }, [token]);

  useEffect(() => { load().catch((error) => setMessage(error.message)); }, [load]);
  useEffect(() => {
    if (forwarding?.forwardingStatus !== "verification_pending") return undefined;
    const timer = window.setInterval(() => load().catch(() => {}), 3000);
    return () => window.clearInterval(timer);
  }, [forwarding?.forwardingStatus, load]);

  const startTest = useCallback(async () => {
    setBusy(true); setMessage("Your business phone is about to ring. Do not answer this test call.");
    try {
      const data = await forwardingRequest("/api/forwarding/setup/verify", token, { method: "POST", body: "{}" });
      setForwarding(data.forwarding);
    } catch (error) { setMessage(error.message); } finally { setBusy(false); }
  }, [token]);

  useEffect(() => {
    if (forwarding?.forwardingStatus !== "dialer_opened" || !forwarding?.id) return undefined;
    const storageKey = `myaipa-forwarding-auto-test:${forwarding.id}`;
    const beginWhenReturned = () => {
      let armedAt = 0;
      try { armedAt = Number(window.sessionStorage.getItem(storageKey) || 0); } catch {}
      if (document.visibilityState !== "visible" || !armedAt || Date.now() - armedAt < 1000 || automaticTestStarted.current) return;
      automaticTestStarted.current = true;
      try { window.sessionStorage.removeItem(storageKey); } catch {}
      startTest();
    };
    window.addEventListener("focus", beginWhenReturned);
    window.addEventListener("pageshow", beginWhenReturned);
    document.addEventListener("visibilitychange", beginWhenReturned);
    return () => {
      window.removeEventListener("focus", beginWhenReturned);
      window.removeEventListener("pageshow", beginWhenReturned);
      document.removeEventListener("visibilitychange", beginWhenReturned);
    };
  }, [forwarding?.forwardingStatus, forwarding?.id, startTest]);

  const saveChoices = async () => {
    setBusy(true); setMessage("");
    try {
      const data = await forwardingRequest("/api/forwarding/setup/selections", token, { method: "PUT", body: JSON.stringify({ carrier, lineType }) });
      setForwarding(data.forwarding);
    } catch (error) { setMessage(error.message); } finally { setBusy(false); }
  };

  const openDialer = async () => {
    if (!forwarding?.rule?.activationTelUri) return;
    setBusy(true); setMessage("");
    try {
      const data = await forwardingRequest("/api/forwarding/setup/activation-opened", token, { method: "POST", body: "{}" });
      setForwarding(data.forwarding);
      try { window.sessionStorage.setItem(`myaipa-forwarding-auto-test:${data.forwarding.id}`, String(Date.now())); } catch {}
      window.location.href = forwarding.rule.activationTelUri;
      setMessage("Press Call or Send in your phone app, then return here. We’ll test it automatically.");
    } catch (error) { setMessage(error.message); } finally { setBusy(false); }
  };

  const copyCommand = async () => {
    const value = forwarding?.rule?.activationDialString || forwarding?.rule?.destinationDigits || "";
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const input = document.createElement("textarea");
      input.value = value;
      input.setAttribute("readonly", "");
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
    }
    setCopied(true); window.setTimeout(() => setCopied(false), 1600);
  };

  const status = forwarding?.forwardingStatus;
  const needsChoices = status === "carrier_needed" || !forwarding;
  const active = status === "active";
  const pending = status === "verification_pending";
  const manual = status === "manual_setup_required";

  return (
    <main className="forwarding-onboarding">
      <section className="forwarding-card">
        <a className="forwarding-brand" href="#/">My <b>AI PA</b></a>
        {active ? (
          <>
            <span className="forwarding-success-mark">✓</span>
            <p className="forwarding-eyebrow">MISSED-CALL PROTECTION ACTIVE</p>
            <h1>You’re protected.</h1>
            <p>Your business phone will ring normally. If you don’t answer, My AI PA can pick up the call.</p>
            <div className="forwarding-number"><span>Your My AI PA number</span><strong>{fmtPhone(forwarding.assignedMyAiPaNumber)}</strong></div>
            <div className="forwarding-actions"><button onClick={startTest} disabled={busy}>Test Again</button><button className="secondary" onClick={() => setForwarding({ ...forwarding, forwardingStatus: "carrier_needed" })}>Change Setup</button></div>
            <details><summary>Turn off / view disable instructions</summary>{forwarding.rule.deactivationDialString ? <p>Dial <strong>{forwarding.rule.deactivationDialString}</strong> from your business phone.</p> : <p>Use your provider or cloud-phone settings to turn off unanswered-call forwarding. We will not guess a disable command for this phone service.</p>}</details>
          </>
        ) : (
          <>
            <p className="forwarding-eyebrow">YOUR MY AI PA NUMBER IS READY</p>
            <h1>Protect the calls you miss.</h1>
            <p>Nothing changes about how you answer your phone. It still rings normally. My AI PA simply catches what you miss.</p>
            {forwarding ? <div className="forwarding-number"><span>Your My AI PA number</span><strong>{fmtPhone(forwarding.assignedMyAiPaNumber)}</strong></div> : null}

            {needsChoices ? <div className="forwarding-form">
              <label>Who provides your business phone?<select value={carrier} onChange={(event) => setCarrier(event.target.value)}>{CARRIERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label>What kind of number is it?<select value={lineType} onChange={(event) => setLineType(event.target.value)}>{LINE_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <button onClick={saveChoices} disabled={busy || !forwarding}>{busy ? "Saving…" : "Continue"}</button>
            </div> : null}

            {!needsChoices && forwarding ? <>
              {pending ? <div className="forwarding-alert"><strong>Almost done</strong><span>Do not answer the test call. We’re waiting to see it arrive at My AI PA.</span></div> : null}
              {status === "verification_failed" ? <div className="forwarding-alert is-warning"><strong>We didn’t receive the forwarded call yet.</strong><span>{forwarding.lastFailureReason || "Voicemail may have answered first, or the carrier may need a different setup."}</span></div> : null}
              {manual ? <div className="forwarding-alert is-warning"><strong>Guided setup required</strong><span>We do not have a verified one-tap command for this phone service, so we will not guess one.</span></div> : null}
              <ol className="forwarding-steps">{forwarding.rule.humanInstructions.map((step) => <li key={step}>{step}</li>)}</ol>
              {forwarding.rule.warnings.map((warning) => <p className="forwarding-warning" key={warning}>{warning}</p>)}
              {forwarding.rule.activationMethod === "DIAL_STRING" && supportsMobileDialer ? <button className="forwarding-primary" onClick={openDialer} disabled={busy}>Protect My Missed Calls</button> : null}
              {forwarding.rule.activationMethod === "DIAL_STRING" && !supportsMobileDialer ? <div className="forwarding-alert"><strong>Open this link on your business phone</strong><span>Desktop browsers cannot reliably open a mobile carrier command. You can copy the command below instead.</span></div> : null}
              {forwarding.rule.activationDialString ? <div className="forwarding-command"><span>Dial this from your business phone</span><strong>{forwarding.rule.activationDialString}</strong><button className="secondary" onClick={copyCommand}>{copied ? "Copied" : "Copy"}</button></div> : null}
              {manual ? <div className="forwarding-command"><span>Forward unanswered calls to</span><strong>{fmtPhone(forwarding.assignedMyAiPaNumber)}</strong><button className="secondary" onClick={copyCommand}>{copied ? "Copied" : "Copy"}</button></div> : null}
              <button className="forwarding-test" onClick={startTest} disabled={busy || pending}>{pending ? "Testing…" : "Test My Setup"}</button>
              <button className="forwarding-change" onClick={() => setForwarding({ ...forwarding, forwardingStatus: "carrier_needed" })}>Choose Different Carrier or Phone Type</button>
            </> : null}
          </>
        )}
        {message ? <p className="forwarding-message" role="status">{message}</p> : null}
        <a className="forwarding-dashboard-link" href="#/dashboard">Open customer dashboard</a>
      </section>
    </main>
  );
}
