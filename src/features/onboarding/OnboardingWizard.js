import React, { useEffect, useRef, useState } from "react";
import MyAiPaBrand from "../../components/MyAiPaBrand";
import BusinessDetailsEditor from "./BusinessDetailsEditor";
import copy from "./onboardingCopy";
import { canonicalPhone, copySetupText, displayPhone, onboardingRequest, readWizardLocation, tokenFromSetupUrl, updateWizardLocation } from "./onboardingApi";
import "./onboardingWizard.css";

const PHONE_SERVICES = [["bell:mobile", "Bell Mobility"], ["rogers:mobile", "Rogers Wireless"], ["telus:mobile", "TELUS Mobility"], ["bell:landline", "Bell business landline"], ["rogers:landline", "Rogers Home Phone"], ["other:voip", "Office / cloud service"], ["other:landline", "Other landline"], ["not_sure:mobile", "Other cellphone service"], ["not_sure:not_sure", "Not sure"]];

export function OnboardingIcon({ name, ...props }) {
  const paths = {
    phone: "M6.6 10.8a15.8 15.8 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.24c1.1.37 2.3.57 3.5.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A18 18 0 0 1 2 3a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.2.2 2.4.57 3.5a1 1 0 0 1-.24 1l-2.2 2.2Z",
    copy: "M9 3h11v14H9z M5 7H3v14h12v-2",
    edit: "m4 16 12-12 4 4L8 20H4v-4Zm10-10 4 4",
    message: "M4 3h16v13H9l-5 5V3Z",
    report: "M6 2h9l4 4v16H6V2Zm8 0v6h5M9 12h7m-7 4h7",
    computer: "M3 3h18v13H3V3Zm6 17h6m-3-4v4M1 23h22",
    bulb: "M9 18v-2c-5-4-3-12 3-12s8 8 3 12v2H9Zm0 3h6",
  };
  return <svg className="onboarding-icon" viewBox="0 0 24 24" fill={name === "phone" ? "currentColor" : "none"} stroke={name === "phone" ? "none" : "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}><path d={paths[name] || paths.phone} /></svg>;
}

export function OnboardingSupport({ footer = false, final = false }) {
  return footer ? <footer className="onboarding-help-footer">
    <h2>{final ? copy.finalSupport : copy.supportQuestion}</h2>
    <a className="onboarding-secondary" href={`tel:${copy.supportPhone}`}><OnboardingIcon name="phone" />{copy.supportLabel}</a>
  </footer> : <div className="onboarding-support is-top">
    <strong>{copy.supportQuestion}</strong>
    <a className="onboarding-secondary" href={`tel:${copy.supportPhone}`}><OnboardingIcon name="phone" />{copy.supportLabel}</a>
  </div>;
}

export default function OnboardingWizard({ assignedNumber = "", setupUrl = "", forwarding: initialForwarding = null, token = "", initialStep = 1, initialEdit = false }) {
  const [forwarding, setForwarding] = useState(initialForwarding);
  const [accessToken, setAccessToken] = useState(token || tokenFromSetupUrl(setupUrl));
  const [step, setStep] = useState([1, 2, 3].includes(initialStep) ? initialStep : 1);
  const [editor, setEditor] = useState(initialEdit ? "details" : "");
  const [helpOpen, setHelpOpen] = useState(false);
  const [carrier, setCarrier] = useState(initialForwarding?.carrier || "not_sure");
  const [lineType, setLineType] = useState(initialForwarding?.lineType || "mobile");
  const [loading, setLoading] = useState(Boolean(accessToken && !initialForwarding));
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState("");
  const [message, setMessage] = useState("");
  const [numberConflict, setNumberConflict] = useState(false);
  const heading = useRef(null);
  const number = numberConflict ? "" : canonicalPhone(assignedNumber || forwarding?.assignedMyAiPaNumber);
  const rule = forwarding?.rule;
  const active = forwarding?.forwardingStatus === "active";
  const dialUri = rule?.activationMethod === "DIAL_STRING" && rule.supported === true && /^tel:[+*#0-9%]+$/i.test(rule.activationTelUri || "") ? rule.activationTelUri : "";

  useEffect(() => {
    const nextToken = token || tokenFromSetupUrl(setupUrl);
    if (nextToken) setAccessToken(nextToken);
  }, [token, setupUrl]);

  useEffect(() => {
    if (!accessToken) return undefined;
    let cancelled = false;
    setLoading(true);
    onboardingRequest("/api/forwarding/setup", accessToken).then(data => {
      if (cancelled) return;
      if (assignedNumber && canonicalPhone(data.forwarding?.assignedMyAiPaNumber) !== canonicalPhone(assignedNumber)) {
        setNumberConflict(true); setForwarding(null);
        throw new Error("This saved setup no longer matches your assigned number. Please reopen your current setup link or call support.");
      }
      setNumberConflict(false);
      setForwarding(data.forwarding);
      setCarrier(data.forwarding?.carrier || "not_sure");
      setLineType(data.forwarding?.lineType || "mobile");
    }).catch(error => { if (!cancelled) setMessage(error.message); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [accessToken, assignedNumber]);

  useEffect(() => {
    const syncLocation = () => {
      const location = readWizardLocation();
      setStep(location.step);
      setEditor(location.edit ? "details" : "");
    };
    window.addEventListener("popstate", syncLocation);
    window.addEventListener("hashchange", syncLocation);
    return () => { window.removeEventListener("popstate", syncLocation); window.removeEventListener("hashchange", syncLocation); };
  }, []);

  const moveTo = nextStep => {
    setStep(nextStep); setEditor(""); setMessage(""); setCopied("");
    updateWizardLocation(nextStep);
    window.requestAnimationFrame?.(() => {
      heading.current?.focus({ preventScroll: true });
      window.scrollTo?.({ top: 0, behavior: "auto" });
    });
  };

  const copyValue = async (value, kind) => {
    try { await copySetupText(value); setCopied(kind); }
    catch (error) { setMessage(error.message); }
  };

  const saveChoices = async event => {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const data = await onboardingRequest("/api/forwarding/setup/selections", accessToken, { method: "PUT", body: JSON.stringify({ carrier, lineType }) });
      setForwarding(data.forwarding); setHelpOpen(false);
    } catch (error) { setMessage(error.message); } finally { setBusy(false); }
  };

  const recordDialerOpened = () => {
    if (!accessToken || busy || active) return;
    // Do not await or replace this real tel link: preserve the user's gesture.
    // This records intent only; it never starts a call or claims activation.
    setBusy(true); setMessage("");
    const recordIntent = async () => {
      // Upgrade only the existing saved choices, only on the explicit click.
      // Legacy manual/carrier-needed rows cannot transition straight to opened.
      if (!["ready_to_activate", "dialer_opened"].includes(forwarding?.forwardingStatus) && rule?.supported === true) {
        const normalized = await onboardingRequest("/api/forwarding/setup/selections", accessToken, { method: "PUT", body: JSON.stringify({ carrier: forwarding.carrier || "not_sure", lineType: forwarding.lineType === "not_sure" ? "mobile" : forwarding.lineType || "mobile" }) });
        if (normalized.forwarding) setForwarding(normalized.forwarding);
      }
      return onboardingRequest("/api/forwarding/setup/activation-opened", accessToken, { method: "POST", body: "{}" });
    };
    recordIntent()
      .then(data => { if (data.forwarding) setForwarding(data.forwarding); })
      .catch(error => setMessage(error.message))
      .finally(() => setBusy(false));
  };

  const openEditor = (kind = "details") => { setEditor(kind); setMessage(""); updateWizardLocation(kind === "details" ? 1 : step, kind === "details"); };
  const closeEditor = () => { setEditor(""); updateWizardLocation(step); };
  const setupCode = rule?.activationDialString || rule?.destinationDigits || number.replace(/^\+1/, "");

  return <main className="onboarding-page forwarding-onboarding">
    <div className="onboarding-shell">
      <header className="onboarding-header"><MyAiPaBrand className="onboarding-brand forwarding-brand" markClassName="onboarding-brand-mark forwarding-brand-mark" /></header>
      {step !== 3 || editor ? <OnboardingSupport /> : null}
      <nav className="onboarding-progress" aria-label="Receptionist setup stages"><ol>{copy.steps.map((label, index) => <li key={label} data-step={index + 1}>
        <button type="button" aria-current={step === index + 1 ? "step" : undefined} onClick={() => moveTo(index + 1)}><span className="onboarding-step-number">{index + 1}</span><span>{label}</span></button>
      </li>)}</ol></nav>
      {editor ? <>
        <BusinessDetailsEditor token={accessToken} accessOnly={editor === "access"} onCancel={closeEditor} onAccess={(nextToken, saved) => { setAccessToken(nextToken); if (saved) setForwarding(saved); if (editor === "access") setEditor(""); }} onSaved={() => moveTo(1)} />
        <OnboardingSupport footer />
      </> : <>
        {step === 1 ? <>
          <section className="onboarding-panel onboarding-stage-one" aria-labelledby="onboarding-title">
            <h1 className="onboarding-title" id="onboarding-title" tabIndex={-1} ref={heading}>Your <span className="onboarding-title-brand">My AI PA</span> number is ready</h1>
            {number ? <>
              <div className="onboarding-number" aria-label="Assigned My AI PA number">
                <a className="onboarding-number-value" href={`tel:${number}`}><OnboardingIcon name="phone" /><span>{displayPhone(number)}</span></a>
                <p className="onboarding-number-label">{copy.numberLabel}</p>
                <button type="button" className="onboarding-secondary" onClick={() => copyValue(number, "number")}><OnboardingIcon name="copy" />{copied === "number" ? "Copied" : copy.copyNumber}</button>
              </div>
              <section className="onboarding-test" aria-labelledby="onboarding-test-title">
                <h2 id="onboarding-test-title">{copy.testTitle}</h2>
                <p>{copy.practice}</p>
                <div className="onboarding-info"><span className="onboarding-info-icon" tabIndex={0} role="img" aria-label={copy.testScope} title={copy.testScope}>i</span><p>{active || !forwarding ? copy.editInfo : copy.testInfo}</p></div>
                <a className="onboarding-primary" href={`tel:${number}`}><OnboardingIcon name="phone" />{copy.callReceptionist}</a>
                <button type="button" className="onboarding-secondary" onClick={() => openEditor()}><OnboardingIcon name="edit" />{copy.editDetails}</button>
              </section>
              <p className="onboarding-ready-next">{copy.readyForForwarding}</p>
              <button type="button" className="onboarding-primary onboarding-forward-cta" onClick={() => moveTo(2)}>{copy.forwardingAction}</button>
            </> : <p className="onboarding-loading" role="status">{loading ? "Opening your assigned number…" : "Open your current secure setup link to see your assigned number."}</p>}
          </section>
          {message ? <p className="onboarding-message" role="alert">{message}</p> : null}
          <OnboardingSupport footer />
        </> : null}
        {step === 2 ? <>
          <section className="onboarding-panel onboarding-stage-two" aria-labelledby="onboarding-title">
            <p className="onboarding-eyebrow">{copy.goingLive}</p>
            <h1 className="onboarding-title" id="onboarding-title" tabIndex={-1} ref={heading}>{copy.forwardingTitle}</h1>
            <p>{copy.forwardingDescription}</p>
            {number ? <div className="onboarding-number">
              <p className="onboarding-destination-label">{copy.forwardingDestination}</p>
              <div className="onboarding-number-value"><OnboardingIcon name="phone" /><span>{displayPhone(number)}</span></div>
              <details className="onboarding-instructions" open={helpOpen} onToggle={event => setHelpOpen(event.currentTarget.open)}>
                <summary>{copy.instructions}</summary>
                <div className="onboarding-instructions-content">
                  {rule ? <>
                    <ol>{(rule.humanInstructions || []).map((text, index) => <li key={index}>{text}</li>)}</ol>
                    {rule.timing ? <><p>{rule.timing.customerCopy}</p><p>{rule.timing.adjustmentCopy}</p></> : null}
                    {(rule.warnings || []).map((text, index) => <p key={index}>{text}</p>)}
                    {rule.activationDialString ? <div className="onboarding-command forwarding-command"><span>Your forwarding code</span><strong>{rule.activationDialString}</strong></div> : <p>Use your phone company’s unanswered-call settings. No carrier command is guessed for this service.</p>}
                    <form className="onboarding-provider-form" onSubmit={saveChoices}>
                      <label>Phone service<select value={`${carrier}:${lineType}`} onChange={event => { const [nextCarrier, nextLineType] = event.target.value.split(":"); setCarrier(nextCarrier); setLineType(nextLineType); }}>{PHONE_SERVICES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                      <small>Optional: change this if your phone company rejects the instructions.</small>
                      <button className="onboarding-secondary" type="submit" disabled={busy}>{busy ? "Saving…" : "Update instructions"}</button>
                    </form>
                  </> : <><p>{loading ? "Loading your saved phone-company instructions…" : "Open your saved setup to load the right phone-company instructions. We will not guess a command."}</p>{!accessToken ? <button className="onboarding-secondary" type="button" onClick={() => openEditor("access")}>Open saved instructions</button> : null}</>}
                </div>
              </details>
            </div> : null}
            {dialUri ? <a className="onboarding-primary onboarding-forward-cta forwarding-activate" href={dialUri} onClick={recordDialerOpened}><OnboardingIcon name="phone" />{copy.forwardingAction}</a>
              : <button type="button" className="onboarding-primary onboarding-forward-cta" disabled={numberConflict} onClick={() => setHelpOpen(true)}><OnboardingIcon name="phone" />{copy.forwardingAction}</button>}
            <button type="button" className="onboarding-secondary" onClick={() => copyValue(setupCode, "code")} disabled={!setupCode}><OnboardingIcon name="copy" />{copied === "code" ? "Copied" : rule?.activationDialString ? copy.copyCode : "Copy forwarding number"}</button>
            <p className="onboarding-confirmation">{copy.confirmation}</p>
            <p className="onboarding-timing">{copy.timing}</p>
            <aside className="onboarding-note"><OnboardingIcon name="computer" /><div><h2>{copy.desktopTitle}</h2><p>{copy.desktopCopy}</p></div></aside>
            <aside className="onboarding-note onboarding-boundary"><span className="onboarding-info-icon" aria-hidden="true">!</span><p>{copy.activationBoundary}</p></aside>
            <button type="button" className="onboarding-primary" onClick={() => moveTo(3)}>{copy.continueReminders}<span aria-hidden="true">→</span></button>
            {active ? <details className="onboarding-deactivation"><summary>Turn off / view disable instructions</summary><p>{rule?.deactivationDialString ? `Dial ${rule.deactivationDialString} from your business phone.` : "Use your phone company’s unanswered-call settings. We will not guess a disable command for this service."}</p></details> : null}
          </section>
          {message ? <p className="onboarding-message" role="alert">{message}</p> : null}
          <OnboardingSupport footer />
        </> : null}
        {step === 3 ? <section className="onboarding-stage-three" aria-labelledby="onboarding-title">
          <h1 className="onboarding-title" id="onboarding-title" tabIndex={-1} ref={heading}>{copy.finalTitle}</h1>
          <div className="onboarding-reminder"><span className="onboarding-reminder-icon"><OnboardingIcon name="phone" /></span><p>{copy.finalCall}</p></div>
          <div className="onboarding-reminder"><span className="onboarding-reminder-icon"><OnboardingIcon name="message" /></span><p>{copy.finalMessages}</p></div>
          <div className="onboarding-reminder"><span className="onboarding-reminder-icon"><OnboardingIcon name="report" /></span><div><h2>{copy.finalReportTitle}</h2><p>{copy.finalReport}</p></div></div>
          <OnboardingSupport footer final />
          <div className="onboarding-reminder onboarding-reassurance"><span className="onboarding-reminder-icon"><OnboardingIcon name="bulb" /></span><p>{copy.finalReassurance}</p></div>
        </section> : null}
      </>}
    </div>
  </main>;
}
