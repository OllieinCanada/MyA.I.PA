import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  timsElectricalBoundaries,
  timsElectricalCompany,
  timsElectricalConfirmations,
  timsElectricalFlowCards,
  timsElectricalKnowledge,
  timsElectricalScenarios,
} from "./timsElectricalDemoData";
import timsElectricalAudioManifest from "./timsElectricalAudioManifest.json";
import { getScenarioProgress } from "./firstClassRentalsLogic";
import "./FirstClassRentalsDemo.css";
import "./TimsElectricalDemo.css";

function Icon({ name, size = 22 }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.9,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
  };
  if (name === "phone") return <svg {...common}><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.4 19.4 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.2-1.2a2 2 0 0 1 2.1-.5c.9.3 1.9.6 2.9.7a2 2 0 0 1 1.7 2Z" /></svg>;
  if (name === "bolt") return <svg {...common}><path d="m13 2-8 12h7l-1 8 8-12h-7z" /></svg>;
  if (name === "document") return <svg {...common}><path d="M6 2h9l4 4v16H6z" /><path d="M14 2v5h5M9 12h6M9 16h6" /></svg>;
  if (name === "wrench") return <svg {...common}><path d="M14.7 6.3a4 4 0 0 0-5-5L12 3.6 8.4 7.2 6.1 4.9a4 4 0 0 0 5 5L4 17a2.1 2.1 0 1 0 3 3l7.1-7.1a4 4 0 0 0 5-5L16.8 10 13.2 6.4z" /></svg>;
  if (name === "message") return <svg {...common}><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" /></svg>;
  if (name === "check") return <svg {...common}><path d="m5 12 4 4L19 6" /></svg>;
  if (name === "shield") return <svg {...common}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /><path d="m9 12 2 2 4-4" /></svg>;
  if (name === "copy") return <svg {...common}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>;
  if (name === "play") return <svg {...common}><path d="m8 5 11 7-11 7z" /></svg>;
  if (name === "pause") return <svg {...common}><path d="M9 5v14M15 5v14" /></svg>;
  return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 8v4M12 16h.01" /></svg>;
}

function scrollToSection(event, id) {
  event.preventDefault();
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function Brand() {
  return (
    <a className="fcr-brand" href="#/" aria-label="My AI PA homepage">
      <span className="fcr-brand-mark"><Icon name="phone" size={24} /></span>
      <span><strong>My AI PA</strong><small>AI receptionist demonstrations</small></span>
    </a>
  );
}

export function buildTranscriptTimeline(transcript = [], durationSeconds = 0) {
  if (!transcript.length || durationSeconds <= 0) return [];
  const hasRecordedTiming = transcript.every((line) => Number.isFinite(line.startSeconds));
  if (hasRecordedTiming) {
    return transcript.map((line, index) => ({
      index,
      start: Math.max(0, line.startSeconds),
      end: Math.max(
        line.startSeconds,
        transcript[index + 1]?.startSeconds ?? durationSeconds,
      ),
    }));
  }
  const weights = transcript.map((line) => {
    const wordCount = String(line.text || "").trim().split(/\s+/).filter(Boolean).length;
    return Math.max(2.8, (wordCount / 2.7) + 1.2);
  });
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  let elapsedWeight = 0;
  return weights.map((weight, index) => {
    const start = (elapsedWeight / totalWeight) * durationSeconds;
    elapsedWeight += weight;
    return {
      index,
      start,
      end: (elapsedWeight / totalWeight) * durationSeconds,
    };
  });
}

export function getActiveTranscriptIndex(timeline = [], currentTime = 0) {
  if (!timeline.length) return -1;
  const active = timeline.findIndex((segment) => currentTime < segment.end);
  return active === -1 ? timeline.length - 1 : active;
}

function formatAudioTime(seconds = 0) {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, Math.round(seconds)) : 0;
  return `${Math.floor(safeSeconds / 60)}:${String(safeSeconds % 60).padStart(2, "0")}`;
}

function ScenarioRecording({ scenario, onTranscriptPosition }) {
  const recording = timsElectricalAudioManifest[scenario.id];
  const available = recording?.status === "available" && recording?.src;
  const audioRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(recording?.durationSeconds || 0);

  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(recording?.durationSeconds || 0);
    onTranscriptPosition?.(null);
  }, [recording?.durationSeconds, recording?.src, onTranscriptPosition]);

  const updatePosition = (nextTime) => {
    setCurrentTime(nextTime);
    onTranscriptPosition?.(nextTime);
  };

  const togglePlayback = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.paused) {
      audio.pause();
      return;
    }
    if (audio.ended || audio.currentTime >= (audio.duration || duration)) {
      audio.currentTime = 0;
      updatePosition(0);
    }
    try {
      onTranscriptPosition?.(audio.currentTime || 0);
      await audio.play();
    } catch (_) {
      setIsPlaying(false);
    }
  };

  const seekRecording = (event) => {
    const nextTime = Number(event.target.value);
    if (audioRef.current) audioRef.current.currentTime = nextTime;
    updatePosition(nextTime);
  };

  return (
    <section className={`tims-scenario-recording tims-phone-recording ${available ? "is-available" : "is-planned"}`} aria-label={`${scenario.shortLabel} recorded call`}>
      <div className="tims-recording-copy">
        <span className="fcr-kicker">Recorded scenario call</span>
        <strong>{available ? `Hear the ${scenario.shortLabel.toLowerCase()} conversation` : `${scenario.shortLabel} recording is being prepared`}</strong>
      </div>
      <div className={`tims-voice-visualizer ${isPlaying ? "is-speaking" : ""}`} aria-hidden="true">
        <span className="tims-voice-orbit orbit-one" />
        <span className="tims-voice-orbit orbit-two" />
        <span className="tims-voice-core"><Icon name="bolt" size={19} /></span>
        <span className="tims-voice-wave left">{Array.from({ length: 7 }, (_, index) => <i key={`left-${index}`} />)}</span>
        <span className="tims-voice-wave right">{Array.from({ length: 7 }, (_, index) => <i key={`right-${index}`} />)}</span>
      </div>
      {available ? (
        <>
          <div className="tims-recording-controls">
            <button type="button" onClick={togglePlayback} aria-label={isPlaying ? "Pause recorded scenario call" : "Play recorded scenario call"}>
              <Icon name={isPlaying ? "pause" : "play"} size={17} />
            </button>
            <span>{formatAudioTime(currentTime)}</span>
            <input
              type="range"
              min="0"
              max={Math.max(duration, 1)}
              step="0.1"
              value={Math.min(currentTime, Math.max(duration, 1))}
              onChange={seekRecording}
              aria-label="Recorded call position"
              style={{ "--tims-audio-progress": `${duration ? (currentTime / duration) * 100 : 0}%` }}
            />
            <span>{formatAudioTime(duration)}</span>
          </div>
          <small className="tims-recording-disclosure">Recorded demonstration · no real customer information</small>
          <audio
            className="tims-recording-audio"
            key={`${scenario.id}-${recording.src}`}
            ref={audioRef}
            preload="metadata"
            src={`${process.env.PUBLIC_URL || ""}${recording.src}`}
            onLoadedMetadata={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : recording.durationSeconds)}
            onTimeUpdate={(event) => updatePosition(event.currentTarget.currentTime)}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onEnded={() => setIsPlaying(false)}
          >
            Your browser does not support audio playback.
          </audio>
        </>
      ) : <span className="tims-recording-status">COMING SOON</span>}
    </section>
  );
}

function DemoPhone({ scenario, visibleLines, complete }) {
  const transcriptRef = useRef(null);
  const [recordingTime, setRecordingTime] = useState(null);
  const recording = timsElectricalAudioManifest[scenario.id];
  const transcriptTimeline = useMemo(
    () => buildTranscriptTimeline(scenario.transcript, recording?.durationSeconds || 0),
    [recording?.durationSeconds, scenario.transcript],
  );
  const activeRecordingLine = recordingTime === null ? -1 : getActiveTranscriptIndex(transcriptTimeline, recordingTime);
  const displayedLineCount = recordingTime === null ? visibleLines : Math.max(1, activeRecordingLine + 1);

  useEffect(() => {
    const transcript = transcriptRef.current;
    if (!transcript) return;
    const activeLine = transcript.querySelector('[data-active="true"]');
    const targetTop = activeLine
      ? Math.max(0, activeLine.offsetTop - (transcript.clientHeight * 0.32))
      : transcript.scrollHeight;
    transcript.scrollTo({ top: targetTop, behavior: "smooth" });
  }, [activeRecordingLine, displayedLineCount]);

  return (
    <div className="fcr-phone-shell">
      <div className="fcr-phone-top"><span>9:41</span><span className="fcr-phone-notch" /><span>5G&nbsp; ▰</span></div>
      <div className="fcr-phone-call">
        <div className="fcr-avatar"><Icon name="bolt" size={24} /></div>
        <div><strong>Tim&apos;s Electrical</strong><small>{complete ? "Call summary ready" : "Simulated call in progress"}</small></div>
        <span className="fcr-live-dot is-live" />
      </div>
      <ScenarioRecording scenario={scenario} onTranscriptPosition={setRecordingTime} />
      <div className={`fcr-phone-transcript ${recordingTime !== null ? "is-audio-following" : ""}`} ref={transcriptRef} aria-live="polite">
        {displayedLineCount === 0 ? (
          <div className="fcr-phone-empty"><Icon name="phone" size={30} /><strong>Loading the selected call…</strong><span>No real call or text will be sent.</span></div>
        ) : scenario.transcript.slice(0, displayedLineCount).map((line, index) => {
          const assistant = line.speaker === "assistant";
          const isActive = recordingTime !== null && index === activeRecordingLine;
          return (
            <div className={`tims-call-turn ${line.speaker} ${isActive ? "is-active" : ""}`} data-active={isActive ? "true" : undefined} key={`${scenario.id}-${index}`}>
              <span className="tims-call-avatar" aria-hidden="true">{assistant ? "AI" : "C"}</span>
              <div>
                <small>{assistant ? "VIRTUAL RECEPTIONIST" : "CALLER"}</small>
                <p>{line.text}</p>
              </div>
            </div>
          );
        })}
      </div>
      <div className="fcr-phone-footer tims-phone-footer">
        <span className={complete && recordingTime === null ? "complete" : ""}><Icon name={complete && recordingTime === null ? "check" : "phone"} size={15} />{recordingTime !== null ? "Conversation follows the recording" : complete ? "Call complete" : "Simulation running"}</span>
      </div>
    </div>
  );
}

function MessagePreview({ label, status, text, tone }) {
  return (
    <article className={`tims-message-preview ${tone}`} aria-label={`${label} text message preview`}>
      <div className="tims-text-phone-top"><span>9:41</span><i /><span>5G</span></div>
      <div className="tims-text-phone-contact"><span><Icon name={tone === "owner" ? "document" : "message"} size={15} /></span><div><strong>{label}</strong><small>{tone === "owner" ? "My AI PA" : "Tim's Electrical"} · now</small></div></div>
      <div className="tims-text-phone-thread"><p>{text}</p></div>
      <div className="tims-text-phone-status"><span>{status}</span><small>Simulated text preview</small></div>
    </article>
  );
}

function CallSummary({ scenario, complete, onAction }) {
  return (
    <section className={`fcr-summary-card ${complete ? "is-ready" : ""}`} aria-live="polite">
      <div className="fcr-summary-heading">
        <div><span className="fcr-kicker">Instant structured handoff</span><h3>{complete ? "Job summary ready" : "Summary builds during the call"}</h3></div>
        <span className={`fcr-status-pill ${complete ? "ready" : ""}`}>{complete ? "READY" : "LISTENING"}</span>
      </div>
      <div className="fcr-summary-grid">
        <div><small>Intent</small><strong>{complete ? scenario.intent : "Listening…"}</strong></div>
        <div><small>Priority</small><strong>{complete ? scenario.priority : "Checking…"}</strong></div>
        <div><small>Route</small><strong>{complete ? scenario.route : "Preparing…"}</strong></div>
      </div>
      <p className="fcr-summary-copy">{complete ? scenario.summary : "The receptionist organizes only observable caller details—never hidden reasoning or an electrical diagnosis."}</p>
      <div className="fcr-detail-columns tims-detail-disclosures">
        <details>
          <summary><span>Collected job details</span><strong>{complete ? scenario.collected.length : "—"}</strong></summary>
          {complete ? <ul>{scenario.collected.map((item) => <li key={item}><Icon name="check" size={14} />{item}</li>)}</ul> : <p className="fcr-none">Details are being organized during the call.</p>}
        </details>
        <details>
          <summary><span>Additional details useful</span><strong>{complete ? scenario.missing.length : "—"}</strong></summary>
          {complete ? (scenario.missing.length ? <ul className="missing">{scenario.missing.map((item) => <li key={item}>{item}</li>)}</ul> : <p className="fcr-none">Ordinary intake stopped for safety.</p>) : <p className="fcr-none">Remaining questions appear after the call.</p>}
        </details>
      </div>
      {complete ? (
        <div className="tims-message-grid">
          <MessagePreview key={`${scenario.id}-owner`} label="Owner's cellphone" status="READY" text={scenario.ownerText} tone="owner" />
          <MessagePreview key={`${scenario.id}-customer`} label="Customer's cellphone" status="READY" text={scenario.customerText} tone="customer" />
        </div>
      ) : <p className="tims-message-waiting"><Icon name="message" size={16} />Text previews appear when the simulated call is complete.</p>}
      <div className="fcr-summary-actions">
        <button type="button" disabled={!complete} onClick={() => onAction("Copied the simulated electrical-call summary.")}><Icon name="copy" size={16} /> Copy summary</button>
      </div>
    </section>
  );
}

export function TimsElectricalLiveDemo({ embedded = false, onSignup }) {
  const [scenarioId, setScenarioId] = useState(timsElectricalScenarios[0].id);
  const [runVersion, setRunVersion] = useState(0);
  const [visibleLines, setVisibleLines] = useState(0);
  const [actionMessage, setActionMessage] = useState("");
  const scenario = useMemo(
    () => timsElectricalScenarios.find((item) => item.id === scenarioId) || timsElectricalScenarios[0],
    [scenarioId],
  );
  const progress = getScenarioProgress(scenario, visibleLines);
  const complete = visibleLines >= scenario.transcript.length;

  useEffect(() => {
    setVisibleLines(0);
    setActionMessage("");
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setVisibleLines(scenario.transcript.length);
      return undefined;
    }

    const interval = window.setInterval(() => {
      setVisibleLines((current) => {
        const next = Math.min(current + 1, scenario.transcript.length);
        if (next >= scenario.transcript.length) window.clearInterval(interval);
        return next;
      });
    }, 320);
    return () => window.clearInterval(interval);
  }, [scenario, runVersion]);

  const chooseScenario = (id) => {
    setScenarioId(id);
    setRunVersion((current) => current + 1);
    setActionMessage("");
  };

  const handleScenarioKeyDown = (event, index) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    let nextIndex = index;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % timsElectricalScenarios.length;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + timsElectricalScenarios.length) % timsElectricalScenarios.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = timsElectricalScenarios.length - 1;
    const nextScenario = timsElectricalScenarios[nextIndex];
    chooseScenario(nextScenario.id);
    window.requestAnimationFrame(() => document.getElementById(`tims-scenario-${nextScenario.id}`)?.focus());
  };

  const handleAction = async (message) => {
    if (message.startsWith("Copied") && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(`${scenario.title}\n${scenario.summary}\n\n${scenario.ownerText}\n\n${scenario.customerText}`);
      } catch (_) {
        // The preview remains usable if clipboard permission is unavailable.
      }
    }
    setActionMessage(message);
  };

  const startSignup = () => {
    if (onSignup) onSignup();
    else window.location.hash = "/signup";
  };

  return (
    <section className="fcr-section fcr-live-section tims-live-section" id={embedded ? "tims-homepage-demo" : "tims-live-demo"}>
      <div className="fcr-shell">
        <div className="fcr-section-heading light tims-live-heading">
          <span className="fcr-kicker">{embedded ? "03 · See it work" : "See the call, then see the text"}</span>
          <h2>{embedded ? "Now watch a service call become a useful summary." : "Watch an electrical call become a useful summary."}</h2>
          <p>Choose a realistic situation. The call, captured details, and text previews will build automatically without contacting a customer or the electrical business.</p>
        </div>
        <div className="fcr-scenario-tabs" role="tablist" aria-label="Tim's Electrical demonstration scenarios">
          {timsElectricalScenarios.map((item, index) => (
            <button type="button" role="tab" id={`tims-scenario-${item.id}`} aria-controls="tims-scenario-panel" aria-selected={scenario.id === item.id} tabIndex={scenario.id === item.id ? 0 : -1} className={scenario.id === item.id ? "active" : ""} key={item.id} onKeyDown={(event) => handleScenarioKeyDown(event, index)} onClick={() => chooseScenario(item.id)}>{item.shortLabel}</button>
          ))}
        </div>
        <div className="fcr-live-grid" id="tims-scenario-panel" role="tabpanel" aria-labelledby={`tims-scenario-${scenario.id}`}>
          <DemoPhone key={scenario.id} scenario={scenario} visibleLines={visibleLines} complete={complete} />
          <div className="fcr-call-console">
            <div className="fcr-console-top">
              <div><span className="fcr-kicker">Current situation</span><h3>{scenario.title}</h3></div>
            </div>
            <div className="fcr-progress"><div><span>Call progress</span><strong>{progress}%</strong></div><div className="fcr-progress-track"><span style={{ width: `${progress}%` }} /></div></div>
            <div className="fcr-stage-row">{scenario.stages.map((stage, index) => { const done = progress >= ((index + 1) / scenario.stages.length) * 100; return <div className={done ? "done" : ""} key={stage}><span>{done ? <Icon name="check" size={14} /> : index + 1}</span>{stage}</div>; })}</div>
            <CallSummary scenario={scenario} complete={complete} onAction={handleAction} />
            {actionMessage && <p className="fcr-action-message" role="status">{actionMessage}</p>}
          </div>
        </div>
        {embedded ? (
          <div className="tims-demo-cta">
            <div><span className="fcr-kicker">Ready to catch the next missed call?</span><strong>Try My AI PA with your own business details.</strong><p>No credit card. Keep your current business number.</p></div>
            <div><button type="button" onClick={startSignup}>Start Your Free Trial</button><a href="tel:+12495033301">Call the Live Demo · (249) 503-3301</a></div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export default function TimsElectricalDemo() {
  useEffect(() => {
    document.title = "Tim's Electrical AI Receptionist Demo | My AI PA";
    window.scrollTo?.(0, 0);
  }, []);

  return (
    <main className="fcr-demo tims-demo">
      <div className="fcr-private-banner"><Icon name="shield" size={16} />{timsElectricalCompany.privateNotice}</div>
      <header className="fcr-header">
        <div className="fcr-shell fcr-header-inner">
          <Brand />
          <nav aria-label="Electrical demo navigation">
            <a href="#/demo/tims-electrical" onClick={(event) => scrollToSection(event, "tims-how-it-works")}>How it helps</a>
            <a href="#/demo/tims-electrical" onClick={(event) => scrollToSection(event, "tims-live-demo")}>Interactive call</a>
          </nav>
          <a className="fcr-header-button" href="#/signup">Start Your Free Trial</a>
        </div>
      </header>

      <section className="fcr-hero tims-hero">
        <div className="fcr-hero-glow one" /><div className="fcr-hero-glow two" />
        <div className="fcr-shell fcr-hero-grid">
          <div className="fcr-hero-copy">
            <span className="fcr-eyebrow">Interactive case study · My AI PA × Tim&apos;s Electrical</span>
            <h1>Service calls answered. Job details organized. <em>The team gets the text.</em></h1>
            <p className="fcr-hero-pain">A missed call should not become a missed electrical job.</p>
            <p>See how My AI PA handles installation, repair, maintenance, follow-up, urgent, and immediate-danger conversations without diagnosing or making promises.</p>
            <div className="fcr-hero-actions">
              <a className="fcr-primary-button" href="#/demo/tims-electrical" onClick={(event) => scrollToSection(event, "tims-live-demo")}><Icon name="play" size={17} /> Start the simulated call</a>
              <a className="fcr-secondary-button" href="#/">Return to My AI PA</a>
            </div>
            <div className="fcr-hero-proof"><span><Icon name="check" size={16} /> One question at a time</span><span><Icon name="check" size={16} /> No diagnosis or price promises</span><span><Icon name="check" size={16} /> Owner and customer text previews</span></div>
          </div>
          <div className="fcr-property-visual tims-electric-visual" aria-label="Illustration of an organized electrical service call">
            <div className="tims-panel"><span className="tims-panel-bolt"><Icon name="bolt" size={64} /></span><i /><i /><i /><i /><i /><i /></div>
            <div className="fcr-inquiry-card"><span className="fcr-kicker">NEW INSTALLATION</span><strong>Hot tub wiring request</strong><p>St. Catharines · after 5 p.m.</p><div><Icon name="check" size={15} /> Ready for team review</div></div>
            <div className="fcr-callback-card"><Icon name="message" /><div><strong>Two clear text previews</strong><span>Owner summary + caller confirmation</span></div></div>
          </div>
        </div>
      </section>

      <section className="fcr-section" id="tims-how-it-works">
        <div className="fcr-shell">
          <div className="fcr-section-heading"><span className="fcr-kicker">What happens when the team cannot answer</span><h2>The caller explains the job. My AI PA organizes the next step.</h2><p>The assistant gathers practical electrical-service details, separates routine and urgent calls, and stops ordinary intake when danger is reported.</p></div>
          <div className="fcr-flow-grid">{timsElectricalFlowCards.map((flow, index) => <article key={flow.title}><span className="fcr-flow-number">0{index + 1}</span><span className="fcr-flow-icon"><Icon name={flow.icon} /></span><h3>{flow.title}</h3><p>{flow.text}</p></article>)}</div>
        </div>
      </section>

      <TimsElectricalLiveDemo />

      <section className="fcr-section fcr-knowledge-section">
        <div className="fcr-shell fcr-knowledge-grid">
          <div><span className="fcr-kicker">Useful without overpromising</span><h2>Helpful intake that stays inside safe boundaries.</h2><p>The receptionist captures what the caller says and makes the handoff useful while leaving technical advice, pricing, availability, and scheduling to the electrical business.</p><div className="fcr-source-list">{timsElectricalKnowledge.map((item) => <div key={item.label}><Icon name="check" size={16} /><span><strong>{item.label}</strong>{item.value}</span></div>)}</div></div>
          <div className="fcr-confirm-card"><div className="fcr-confirm-heading"><Icon name="shield" /><div><strong>Team confirmation required</strong><span>Before the receptionist may promise it</span></div></div>{timsElectricalConfirmations.map((item) => <div className="fcr-listing-row" key={item.label}><span><strong>{item.label}</strong>{item.text}</span><b>CONFIRM</b></div>)}</div>
        </div>
      </section>

      <section className="fcr-boundary-section"><div className="fcr-shell"><div className="fcr-boundary-card"><div><span className="fcr-kicker">Built-in call protection</span><h2>Safe intake without pretending to be an electrician.</h2></div><ul>{timsElectricalBoundaries.map((claim) => <li key={claim}><Icon name="check" size={16} />{claim}</li>)}</ul></div></div></section>

      <footer className="fcr-footer"><div className="fcr-shell"><Brand /><p>Interactive demonstration prepared by My AI PA. All names, telephone numbers, addresses, conversations, and messages are simulated and are not sent.</p><a href="#/">Return to My AI PA</a></div></footer>
    </main>
  );
}
