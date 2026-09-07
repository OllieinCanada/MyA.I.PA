import React, { useState } from "react";
import { getApiBaseUrl, normalizeApiBase } from "../config/apiBase";

const API_BASE = normalizeApiBase(getApiBaseUrl(process.env.REACT_APP_API_BASE_URL));

export default function ForwardingSetupGuide({ assignedNumber, forwarding, setupUrl = "", compact = false }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  if (!assignedNumber) return null;
  const active = forwarding?.forwardingStatus === "active";

  const openSetup = async () => {
    setBusy(true); setMessage("");
    try {
      if (setupUrl) {
        window.location.href = setupUrl;
        return;
      }
      const response = await fetch(`${API_BASE}/api/customer/dashboard/forwarding/setup-link`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.url) throw new Error(data.error || "Forwarding setup could not be opened.");
      window.location.href = data.url;
    } catch (error) {
      setMessage(error.message);
      setBusy(false);
    }
  };

  return (
    <section className={`forwarding-guide${compact ? " is-compact" : ""}${active ? " is-active" : ""}`} aria-labelledby="forwarding-guide-title">
      <div className="forwarding-guide-heading">
        <span>{active ? "✓ MISSED-CALL PROTECTION ACTIVE" : "YOUR NUMBER IS READY"}</span>
        <h2 id="forwarding-guide-title">{active ? "You’re protected" : "Protect your missed calls"}</h2>
        <p>{active ? "Your phone still rings normally. My AI PA steps in when you miss the call." : "One setup button. Your carrier completes the change when you press Call or Send."}</p>
      </div>
      <button type="button" className="forwarding-guide-primary" onClick={openSetup} disabled={busy}>
        {busy ? "Opening…" : active ? "Test Again or Change Setup" : "Protect My Missed Calls"}
      </button>
      {message ? <small role="status">{message}</small> : null}
    </section>
  );
}
