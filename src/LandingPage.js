import React, { useEffect, useMemo, useRef, useState } from "react";

const API_BASE = (process.env.REACT_APP_API_BASE_URL || "http://localhost:8787").replace(/\/+$/, "");

const coreBullets = [
  "• Answers call when you can’t",
  "• talk to customers",
  "• Answers any FAQs",
  "• Collects details of the call and texts them to your phone for easy call back.",
];

const benefitBullets = [
  "• Answer phone 24/7",
  "• Takes call after 3 Rings",
  "• Sends a thank you text to the caller",
];

const heroRotatingHighlights = [
  { label: "Answers calls 24/7.", icon: "clock", tone: "bg-cyan-100 text-cyan-700" },
  { label: "Picks up after 3 rings.", icon: "phone", tone: "bg-blue-100 text-blue-700" },
  { label: "Filters time-wasters.", icon: "filter", tone: "bg-indigo-100 text-indigo-700" },
  { label: "Sets up easy callbacks.", icon: "callback", tone: "bg-emerald-100 text-emerald-700" },
  { label: "Cuts hangups, boosts sales.", icon: "growth", tone: "bg-amber-100 text-amber-700" },
  { label: "Handles FAQs instantly.", icon: "faq", tone: "bg-violet-100 text-violet-700" },
  { label: "Texts call details fast.", icon: "text", tone: "bg-sky-100 text-sky-700" },
  { label: "Sends caller reminders.", icon: "bell", tone: "bg-teal-100 text-teal-700" },
  { label: "Prioritizes urgent callers.", icon: "growth", tone: "bg-rose-100 text-rose-700" },
];

function NavButton({ onClick, children, primary }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "rounded-full px-5 py-3 text-sm font-black uppercase tracking-[0.14em] transition " +
        (primary
          ? "bg-gradient-to-r from-emerald-700 to-amber-500 text-white shadow-[0_18px_30px_-18px_rgba(16,185,129,0.85)]"
          : "border border-white/25 bg-white/5 text-white/80 hover:bg-white/10")
      }
    >
      {children}
    </button>
  );
}

function ChatBubble({ role, children }) {
  const isUser = role === "user";
  return (
    <div className={"flex " + (isUser ? "justify-end" : "justify-start")}>
      <div
        className={
          "max-w-[92%] rounded-2xl px-4 py-3 text-sm font-semibold leading-snug " +
          (isUser
            ? "bg-gradient-to-r from-emerald-700 to-amber-500 text-white"
            : "border border-white/10 bg-black/25 text-white/85")
        }
      >
        {children}
      </div>
    </div>
  );
}

function SourceBadge({ children }) {
  return (
    <span className="inline-flex items-center rounded-full border border-emerald-200/20 bg-emerald-200/10 px-2 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-emerald-100/85">
      {children}
    </span>
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function formatClock(totalSeconds) {
  const safe = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const minutes = Math.floor(safe / 60);
  const seconds = String(safe % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function buildSpectrumPath(values, width = 1200, height = 120, baseline = 65) {
  const points = (values || []).map((v, i) => {
    const x = (i / Math.max(1, values.length - 1)) * width;
    const amp = clamp(v, 0, 1) * 34;
    const y = baseline - amp + Math.sin(i * 0.9) * 6;
    return [x, y];
  });
  if (!points.length) return `M0,${baseline} L${width},${baseline}`;

  let d = `M ${points[0][0].toFixed(2)},${points[0][1].toFixed(2)}`;
  for (let i = 1; i < points.length; i += 1) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    const cx = ((x0 + x1) / 2).toFixed(2);
    d += ` Q ${cx},${y0.toFixed(2)} ${x1.toFixed(2)},${y1.toFixed(2)}`;
  }
  return d;
}

function buildWaveAreaPath(values, width = 1200, height = 120, centerY = 60, scale = 38) {
  if (!values?.length) {
    return `M 0,${centerY} L ${width},${centerY} L ${width},${centerY} L 0,${centerY} Z`;
  }
  const top = values.map((v, i) => {
    const x = (i / Math.max(1, values.length - 1)) * width;
    const amp = clamp(v, 0, 1) * scale;
    return [x, centerY - amp];
  });
  const bottom = values
    .map((v, i) => {
      const x = (i / Math.max(1, values.length - 1)) * width;
      const amp = clamp(v, 0, 1) * scale;
      return [x, centerY + amp];
    })
    .reverse();

  const pts = [...top, ...bottom];
  let d = `M ${pts[0][0].toFixed(2)},${pts[0][1].toFixed(2)}`;
  for (let i = 1; i < pts.length; i += 1) {
    d += ` L ${pts[i][0].toFixed(2)},${pts[i][1].toFixed(2)}`;
  }
  d += " Z";
  return d;
}

function estimateSpeechDurationSec(text, speaker) {
  const normalized = String(text || "").trim();
  if (!normalized) return 1.2;
  if (speaker === "SYSTEM") return 1.6;
  const words = normalized.split(/\s+/).filter(Boolean).length;
  const commas = (normalized.match(/,/g) || []).length;
  const sentenceStops = (normalized.match(/[.!?]/g) || []).length;
  // Intentionally conservative pace so transcript does not jump ahead of speech.
  // AI voice lines in the sample audio speak slower than casual reading speed.
  const isAi = speaker === "AI";
  const isCaller = speaker === "CALLER";
  const secondsPerWord = isAi ? 0.46 : isCaller ? 0.43 : 0.34;
  const base = 1.2 + words * secondsPerWord + commas * 0.22 + sentenceStops * 0.38;
  const tailHold = isAi ? 0.55 : isCaller ? 0.45 : 0.2;
  const minHold = isAi ? 2.5 : isCaller ? 2.4 : 1.4;
  return Math.max(minHold, Math.min(base + tailHold, 20));
}

function ConciergeWidget({ sections, mode = "floating", onFocusChange, onClose }) {
  const [input, setInput] = useState("");
  const [autoSpeak, setAutoSpeak] = useState(true);
  const [agentStatus, setAgentStatus] = useState("Ready");
  const [isBusy, setIsBusy] = useState(false);
  const [faqHealth, setFaqHealth] = useState("unknown");
  const [messages, setMessages] = useState([
    {
      id: 1,
      role: "assistant",
      text: "I can find anything on this page for you and jump to it. Ask about pricing, benefits, setup, admin, or call handling.",
    },
  ]);

  const sectionIndex = useMemo(() => {
    return sections.map((section) => ({
      ...section,
      haystack: `${section.title} ${section.summary} ${section.keywords.join(" ")}`.toLowerCase(),
    }));
  }, [sections]);

  const performAction = (action) => {
    if (!action) return;
    if (action.sectionId && onFocusChange) {
      const focused = sections.find((s) => s.id === action.sectionId);
      if (focused) onFocusChange(focused, { reason: "action" });
    }
    if (action.type === "scroll" && action.ref?.current) {
      action.ref.current.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (action.type === "route" && action.hash) {
      window.location.hash = action.hash;
    }
  };

  const answerQuery = (raw) => {
    const q = String(raw || "").trim();
    if (!q) return null;
    const query = q.toLowerCase();

    if (query.includes("signup") || query.includes("sign up") || query.includes("setup")) {
      return {
        text: "I can take you straight to the setup flow where you search your Google Business Profile and continue onboarding.",
        focusSectionId: "setup",
        actions: [{ label: "Open setup flow", action: { type: "route", hash: "/signup", sectionId: "setup" } }],
      };
    }

    if (query.includes("admin") || query.includes("dashboard")) {
      return {
        text: "The admin dashboard is for reviewing leads/calls, editing FAQs, and changing answering settings.",
        focusSectionId: "data",
        actions: [{ label: "Open admin dashboard", action: { type: "route", hash: "/admin", sectionId: "data" } }],
      };
    }

    const matches = sectionIndex
      .map((section) => ({ section, score: scoreSectionMatch(section, query) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);

    if (matches.length > 0) {
      const best = matches[0].section;
      return {
        text: best.summary,
        focusSectionId: best.id,
        actions: [
          { label: `Jump to ${best.title}`, action: { type: "scroll", ref: best.ref, sectionId: best.id } },
          ...(best.extraActions || []),
        ],
      };
    }

    return {
      text: "I couldn’t find an exact match yet. Try asking about benefits, call handling, tools, data storage, setup, or admin.",
      focusSectionId: "overview",
      actions: [
        { label: "Show benefits", action: { type: "scroll", ref: sections.find((s) => s.id === "benefits")?.ref, sectionId: "benefits" } },
        { label: "Show call flow", action: { type: "scroll", ref: sections.find((s) => s.id === "call-flow")?.ref, sectionId: "call-flow" } },
      ].filter((x) => x.action.ref),
    };
  };

  const searchFaqBackend = async (q) => {
    try {
      const response = await fetch(`${API_BASE}/api/faqs/search?q=${encodeURIComponent(q)}&businessId=1&limit=3`);
      if (!response.ok) {
        setFaqHealth("offline");
        return { error: `FAQ service returned ${response.status}` };
      }
      const data = await response.json();
      setFaqHealth("connected");
      const result = data?.results?.[0];
      if (!result) return { noMatch: true };
      return {
        text: `I found an FAQ answer: ${result.answer}`,
        source: "faq",
        focusSectionId: "overview",
        actions: [
          { label: "Jump to overview", action: { type: "scroll", ref: sections.find((s) => s.id === "overview")?.ref, sectionId: "overview" } },
          { label: "Open admin dashboard", action: { type: "route", hash: "/admin", sectionId: "data" } },
        ].filter((x) => x.action.type === "route" || x.action.ref),
      };
    } catch (_err) {
      setFaqHealth("offline");
      return { error: "FAQ service unavailable" };
    }
  };

  const buildReply = async (q) => {
    const localReply = answerQuery(q);
    const lower = String(q || "").toLowerCase();
    const faqLike =
      lower.includes("?") ||
      lower.includes("hours") ||
      lower.includes("estimate") ||
      lower.includes("book") ||
      lower.includes("price");

    if (faqLike) {
      const faqReply = await searchFaqBackend(q);
      if (faqReply?.source === "faq") return faqReply;
      if (faqReply?.error) {
        return {
          text: `I tried to check the FAQ service but it is unavailable right now (${faqReply.error}). I can still guide you through the page.`,
          focusSectionId: "overview",
          actions: [
            { label: "Show benefits", action: { type: "scroll", ref: sections.find((s) => s.id === "benefits")?.ref, sectionId: "benefits" } },
            { label: "Open admin dashboard", action: { type: "route", hash: "/admin", sectionId: "data" } },
          ].filter((x) => x.action.type === "route" || x.action.ref),
        };
      }
      if (faqReply?.noMatch) {
        return {
          text: "I checked the FAQ data but did not find a direct answer for that question yet. You can add it in the FAQ Editor.",
          focusSectionId: "data",
          actions: [
            { label: "Open admin dashboard", action: { type: "route", hash: "/admin", sectionId: "data" } },
            { label: "Jump to overview", action: { type: "scroll", ref: sections.find((s) => s.id === "overview")?.ref, sectionId: "overview" } },
          ].filter((x) => x.action.type === "route" || x.action.ref),
        };
      }
    }

    if (localReply?.text?.includes("I couldn’t find an exact match yet.")) {
      const faqReply = await searchFaqBackend(q);
      if (faqReply?.source === "faq") return faqReply;
    }

    return localReply;
  };

  const streamAssistantText = async (messageId, fullText) => {
    const chars = Array.from(fullText || "");
    let current = "";
    for (let i = 0; i < chars.length; i += 1) {
      current += chars[i];
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, text: current } : m)));
      if (i < chars.length - 1) await sleep(i < 50 ? 9 : 5);
    }
  };

  const submit = async (value) => {
    const q = String(value || "").trim();
    if (!q || isBusy) return;
    setIsBusy(true);
    const userId = Date.now();
    const assistantId = userId + 1;
    setMessages((prev) => [
      ...prev,
      { id: userId, role: "user", text: q },
      { id: assistantId, role: "assistant", text: "...", actions: [], isTyping: true, source: null },
    ]);
    setInput("");
    setAgentStatus("Searching page");
    await sleep(150);
    const reply = await buildReply(q);
    setAgentStatus("Updating screen");
    if (reply?.focusSectionId && onFocusChange) {
      const focused = sections.find((s) => s.id === reply.focusSectionId);
      if (focused) onFocusChange(focused, { reason: "query", query: q, replyText: reply.text });
    }
    await sleep(120);
    setAgentStatus("Typing response");
    setMessages((prev) =>
      prev.map((m) =>
        m.id === assistantId ? { ...m, text: "", actions: reply.actions || [], isTyping: false, source: reply.source || null } : m
      )
    );
    await streamAssistantText(assistantId, reply.text || "");
    setAgentStatus("Done");
    setTimeout(() => setAgentStatus("Ready"), 800);
    setIsBusy(false);
  };

  const isFloating = mode === "floating";
  const latestAssistantMessage =
    [...messages].reverse().find((message) => message.role === "assistant")?.text ||
    "Hi, I’m My AI PA. Tell me what you need and I’ll help one step at a time.";
  const chatStatus = isBusy ? "Busy" : "Idle";
  const charCount = input.length;

  return (
    <div
      className={
        (isFloating
          ? "fixed bottom-5 right-5 z-40 w-[min(420px,calc(100vw-24px))]"
          : "relative w-full") + ""
      }
    >
      <div
        className={
          (isFloating
            ? "overflow-hidden rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(8,10,16,0.97),rgba(6,8,14,0.99))] shadow-[0_35px_90px_-45px_rgba(0,0,0,0.95)] ring-1 ring-black/20 backdrop-blur"
            : "rounded-[20px] border border-white/12 bg-[linear-gradient(180deg,rgba(12,14,20,0.6),rgba(10,12,18,0.78))] p-4 shadow-[0_20px_50px_-35px_rgba(0,0,0,0.85)] backdrop-blur-sm") + ""
        }
      >
        <div className="flex items-start justify-between gap-3 px-4 py-3">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.32em] text-white/55">MY AI PA</div>
            <div className="text-3xl leading-none font-extrabold text-white">Website Assistant</div>
          </div>
          <div className="flex items-center gap-2">
            <div className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm leading-none font-medium text-white/90">{chatStatus}</div>
            {onClose ? (
              <button
                type="button"
                onClick={onClose}
                className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-black uppercase tracking-[0.14em] text-white/80 hover:bg-white/10"
                aria-label="Close assistant chat"
              >
                ×
              </button>
            ) : null}
          </div>
        </div>
        <div className="h-px bg-white/10" />

        <div className="px-4 py-3">
          <div className="rounded-[22px] border border-white/10 bg-white/5 px-4 py-3 text-[16px] leading-relaxed text-white/95">
            {latestAssistantMessage}
          </div>
        </div>

        <div className="h-px bg-white/10" />

        <div className="px-4 py-3">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="rounded-full border border-emerald-300/25 bg-emerald-300/12 px-4 py-2 text-sm leading-none text-emerald-100"
            >
              Website sync on
            </button>
            <button
              type="button"
              onClick={() => setAutoSpeak((v) => !v)}
              className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm leading-none text-white/85"
            >
              <span
                className={
                  "grid h-5 w-5 place-items-center rounded " +
                  (autoSpeak ? "bg-emerald-500 text-white" : "bg-white/10 text-white/55")
                }
              >
                ✓
              </span>
              Auto-speak replies
            </button>
          </div>

          <form
            className="flex items-center gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              submit(input);
            }}
          >
            <input
              type="text"
              value={input}
              maxLength={2000}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask My AI PA..."
              disabled={isBusy}
              className="w-full rounded-[16px] border border-white/10 bg-black/45 px-4 py-4 text-[32px] leading-none text-white placeholder:text-white/35 outline-none focus:border-emerald-300/30 disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={isBusy || !input.trim()}
              className="rounded-[16px] bg-gradient-to-r from-emerald-700 to-amber-500 px-6 py-4 text-[32px] leading-none font-semibold text-white disabled:opacity-45"
            >
              Send
            </button>
          </form>

          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              className="rounded-[14px] border border-white/15 bg-white/6 px-4 py-3 text-[20px] leading-none font-semibold text-white/95"
            >
              Record
            </button>
            <button
              type="button"
              className="rounded-[14px] border border-white/15 bg-white/6 px-4 py-3 text-[20px] leading-none text-white/90"
            >
              Stop speaking
            </button>
          </div>

          <p className="mt-4 text-base leading-tight text-white/55">
            Firefox fallback mode: record, transcribe, then send automatically.
          </p>
          <p className="mt-3 text-sm leading-none text-white/50">{charCount}/2000 characters</p>
        </div>
      </div>
    </div>
  );
}

function scoreSectionMatch(section, query) {
  const haystack =
    typeof section?.haystack === "string"
      ? section.haystack
      : `${section?.title || ""} ${section?.summary || ""} ${Array.isArray(section?.keywords) ? section.keywords.join(" ") : ""}`.toLowerCase();
  const stopWords = new Set([
    "what",
    "are",
    "is",
    "the",
    "a",
    "an",
    "your",
    "you",
    "do",
    "does",
    "how",
    "to",
    "me",
    "show",
    "tell",
    "about",
    "tomorrow",
  ]);
  let score = 0;
  if (haystack.includes(query)) score += 10;
  for (const word of query.split(/\s+/).filter(Boolean)) {
    if (word.length < 2) continue;
    if (stopWords.has(word)) continue;
    if (haystack.includes(word)) score += 1;
  }
  return score;
}

function AgentFocusPanel({ focus, onJump }) {
  if (!focus) return null;
  return (
    <div className="mt-6 rounded-2xl border border-white/25 bg-white/10 px-4 py-4 shadow-[0_20px_50px_-36px_rgba(0,0,0,0.45)] backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-white/55">Agent Focus</p>
          <p className="mt-1 text-lg font-extrabold text-white">{focus.displayTitle}</p>
        </div>
        <button
          type="button"
          onClick={onJump}
          className="rounded-full border border-white/30 bg-white/15 px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-white hover:bg-white/20"
        >
          Show This
        </button>
      </div>
      <p className="mt-2 text-sm font-semibold leading-snug text-white/85">{focus.summary}</p>
      {focus.lastUserPrompt ? (
        <div className="mt-3 rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-xs font-semibold text-white/75">
          Based on: "{focus.lastUserPrompt}"
        </div>
      ) : null}
    </div>
  );
}

function AiOpsPanel({ callFlowRef, toolsRef, dataRef, floating = false }) {
  const [open, setOpen] = useState(!floating);
  const wrapperClass = floating
    ? "fixed bottom-5 left-5 z-40 w-[min(420px,calc(100vw-24px))]"
    : "relative";

  return (
    <div className={wrapperClass}>
      {floating ? (
        <div className="mb-3 flex justify-start">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="rounded-full border border-white/20 bg-[linear-gradient(180deg,rgba(10,12,18,0.86),rgba(8,10,16,0.95))] px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-white/85 shadow-[0_18px_36px_-24px_rgba(0,0,0,0.9)]"
          >
            {open ? "Hide How It Works" : "How It Works"}
          </button>
        </div>
      ) : null}
      {open ? (
        <>
          <div className="pointer-events-none absolute -inset-3 rounded-[34px] bg-[radial-gradient(60%_70%_at_20%_10%,rgba(255,255,255,0.35),transparent_70%)] opacity-70" />
          <div className="relative overflow-hidden rounded-[32px] border border-white/25 bg-[linear-gradient(180deg,rgba(10,12,18,0.78),rgba(8,10,16,0.92))] p-6 shadow-[0_45px_120px_-60px_rgba(0,0,0,0.85)] ring-1 ring-black/25">
            <div className="rounded-[22px] border border-white/10 bg-white/5 p-5">
              <p className="text-xs font-bold uppercase tracking-[0.28em] text-white/60">How Calls Get Handled</p>
              <div className="mt-4 space-y-4">
                <div ref={callFlowRef} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/50">Caller Experience</p>
                  <p className="mt-2 text-sm font-semibold text-white/85">
                    Calls are answered quickly, common questions get handled, and urgent requests are captured cleanly.
                  </p>
                </div>
                <div ref={toolsRef} className="rounded-2xl border border-emerald-300/20 bg-emerald-200/10 p-4">
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-100/80">Owner Experience</p>
                  <ul className="mt-2 space-y-1 text-sm font-semibold text-emerald-50/90">
                    <li>Lead details are captured automatically</li>
                    <li>Important calls can be flagged by urgency</li>
                    <li>Follow-up info is ready for quick callbacks</li>
                    <li>FAQ answers stay consistent</li>
                  </ul>
                </div>
                <div ref={dataRef} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/50">What You See In Admin</p>
                  <p className="mt-2 text-sm font-semibold text-white/80">
                    Calls, leads, FAQs, and settings are all managed in one dashboard so you can monitor and improve performance.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

function DemoModal({ open, onClose, onStartSetup }) {
  const [scenario, setScenario] = useState("emergency");
  const [messages, setMessages] = useState([]);
  const [running, setRunning] = useState(false);

  const scripts = {
    emergency: [
      { role: "caller", text: "Hi, I have a leaking water heater and need help tonight." },
      { role: "assistant", text: "I can help. Is water actively leaking right now and causing damage?" },
      { role: "caller", text: "Yes, it is." },
      { role: "assistant", text: "Got it. I marked this urgent, captured your callback details, and sent the lead to the owner right now." },
    ],
    faq: [
      { role: "caller", text: "What are your hours tomorrow and can I book?" },
      { role: "assistant", text: "I can help with that. I can answer the basics and collect your info for a callback booking." },
      { role: "caller", text: "Please have someone call me in the morning." },
      { role: "assistant", text: "Done. Your request is captured and the owner has been notified." },
    ],
  };

  const runDemo = async () => {
    if (running) return;
    setRunning(true);
    setMessages([]);
    for (const line of scripts[scenario]) {
      await sleep(420);
      setMessages((prev) => [...prev, line]);
    }
    setRunning(false);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-4 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-[28px] border border-white/20 bg-[linear-gradient(180deg,rgba(10,12,18,0.92),rgba(8,10,16,0.97))] p-5 shadow-[0_60px_140px_-60px_rgba(0,0,0,0.95)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-white/55">Demo Call Simulation</p>
            <h3 className="mt-2 text-2xl font-extrabold text-white">CALL THE DEMO</h3>
            <p className="mt-2 text-sm font-semibold text-white/70">
              Simulate how the AI answers, handles questions, and captures a lead before you start setup.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/15 bg-white/5 px-3 py-2 text-xs font-black uppercase tracking-[0.14em] text-white/80"
          >
            Close
          </button>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {[
            ["emergency", "Urgent Service Call"],
            ["faq", "FAQ + Lead Capture"],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setScenario(key)}
              className={
                "rounded-full px-3 py-2 text-xs font-bold " +
                (scenario === key ? "bg-gradient-to-r from-emerald-700 to-amber-500 text-white" : "border border-white/10 bg-white/5 text-white/75")
              }
            >
              {label}
            </button>
          ))}
        </div>

        <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={runDemo}
              disabled={running}
              className="rounded-full bg-gradient-to-r from-emerald-700 to-amber-500 px-5 py-3 text-sm font-black uppercase tracking-[0.14em] text-white disabled:opacity-50"
            >
              {running ? "Running..." : "Run Demo"}
            </button>
            <button
              type="button"
              onClick={onStartSetup}
              className="rounded-full border border-white/15 bg-white/5 px-4 py-3 text-sm font-bold text-white/85"
            >
              Start setup after demo
            </button>
          </div>

          <div className="mt-4 space-y-3 rounded-xl border border-white/10 bg-[#090b10] p-4">
            {messages.length === 0 ? (
              <p className="text-sm font-semibold text-white/55">Pick a scenario and run the demo to see a simulated caller conversation.</p>
            ) : null}
            {messages.map((m, idx) => (
              <div key={`${m.role}-${idx}`} className={"flex " + (m.role === "caller" ? "justify-start" : "justify-end")}>
                <div
                  className={
                    "max-w-[85%] rounded-2xl px-4 py-3 text-sm font-semibold " +
                    (m.role === "caller" ? "border border-white/10 bg-white/5 text-white/85" : "bg-gradient-to-r from-emerald-700 to-amber-500 text-white")
                  }
                >
                  <div className="mb-1 text-[10px] font-black uppercase tracking-[0.16em] opacity-75">
                    {m.role === "caller" ? "Caller" : "AI Assistant"}
                  </div>
                  {m.text}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LandingPage() {
  const heroRef = useRef(null);
  const setupSectionRef = useRef(null);
  const pricingRef = useRef(null);
  const proofRef = useRef(null);
  const complianceRef = useRef(null);
  const industryRef = useRef(null);
  const infoRef = useRef(null);
  const comparisonRef = useRef(null);
  const overviewRef = useRef(null);
  const benefitsRef = useRef(null);
  const callFlowRef = useRef(null);
  const toolsRef = useRef(null);
  const dataRef = useRef(null);
  const heroAudioRef = useRef(null);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const audioSourceRef = useRef(null);
  const audioRafRef = useRef(null);
  const spectrumDataRef = useRef(new Array(40).fill(0.08));
  const resumeDemoAfterTextRef = useRef(false);
  const [agentFocus, setAgentFocus] = useState({
    id: "overview",
    displayTitle: "Quick overview",
    summary: "Ask the concierge a question and this panel will update with the exact part of the page that matters.",
    lastUserPrompt: "",
    ref: overviewRef,
  });
  const [demoOpen, setDemoOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [showTopHeader, setShowTopHeader] = useState(false);
  const [heroAudioPlaying, setHeroAudioPlaying] = useState(false);
  const [heroAudioStarted, setHeroAudioStarted] = useState(false);
  const [heroAudioTime, setHeroAudioTime] = useState(0);
  const [heroAudioDurationSec, setHeroAudioDurationSec] = useState(0);
  const [showDemoTextsSide, setShowDemoTextsSide] = useState(false);
  const [spectrumValues, setSpectrumValues] = useState(() => new Array(40).fill(0.08));
  const [heroHighlightPageIdx, setHeroHighlightPageIdx] = useState(0);
  const [heroHighlightPaused, setHeroHighlightPaused] = useState(false);
  const [skepticOpenIdx, setSkepticOpenIdx] = useState(0);
  const [roiMissedCalls, setRoiMissedCalls] = useState(8);
  const [roiCloseRate, setRoiCloseRate] = useState(35);
  const [roiJobValue, setRoiJobValue] = useState(450);
  const heroHighlightPageCount = Math.ceil(heroRotatingHighlights.length / 3);
  const visibleHeroHighlights = useMemo(
    () => {
      const start = heroHighlightPageIdx * 3;
      return heroRotatingHighlights.slice(start, start + 3);
    },
    [heroHighlightPageIdx]
  );
  const heroHighlightsFrozen = heroHighlightPaused || heroAudioPlaying;
  const monthlyOpportunityLoss = Math.max(
    0,
    Math.round((Number(roiMissedCalls) || 0) * ((Number(roiCloseRate) || 0) / 100) * (Number(roiJobValue) || 0) * 4.3)
  );
  const skepticFaqs = useMemo(
    () => [
      {
        q: "What exactly is included in the $19.99/month Light Version?",
        a: "Light Version includes live call answering, FAQ handling, lead capture, and instant owner text summaries. It is designed to replace missed-call voicemail with real-time call handling and clear follow-up details.",
      },
      {
        q: "Do I need a credit card to start, and am I locked into a contract?",
        a: "No credit card is required to start your 14-day free trial. There are no long-term obligations, and you can cancel easily if it is not a fit.",
      },
      {
        q: "Are there setup fees or hidden charges after I go live?",
        a: "No setup-fee surprises. Plan pricing is clear before launch, and usage-related costs are shown upfront so you can make a confident decision before publishing.",
      },
      {
        q: "Can I keep my current business number?",
        a: "Yes. You can keep your current number and route calls so My AI PA answers when your team is unavailable, then sends your follow-up details right away.",
      },
      {
        q: "What happens if a caller is urgent or the conversation is too complex?",
        a: "You set clear escalation rules. My AI PA can transfer or route calls to your team when needed, while still handling routine questions and intake automatically.",
      },
      {
        q: "Can it handle after-hours and multiple calls at the same time?",
        a: "Yes. It is built for 24/7 coverage and can handle overlapping inbound calls, so you are not forced into voicemail during busy periods.",
      },
      {
        q: "Is this just another software bill, or can it actually recover revenue?",
        a: "The goal is faster lead response and fewer missed opportunities. My AI PA answers immediately, captures intent and urgency, and texts callback-ready details so your team can respond with context instead of starting from zero.",
      },
      {
        q: "How quickly can I prove this works before committing long term?",
        a: "Run the 14-day free trial on real calls and track callback speed, lead quality, and conversion lift. Most owners can quickly tell whether it is outperforming voicemail.",
      },
      {
        q: "How do you handle privacy, security, and Canadian compliance?",
        a: "My AI PA uses PIPEDA-aware workflow controls, encryption in transit and at rest, and role-based admin access controls, with clear visibility into transcript and lead data access.",
      },
    ],
    []
  );
  const industryScrollerItems = useMemo(
    () => [
      {
        name: "Electricians",
        body: "Capture urgent outage calls, filter quote requests, and route high-priority jobs quickly.",
        icon: "⚡",
      },
      {
        name: "HVAC",
        body: "Handle after-hours no-heat/no-cool calls and collect equipment and issue details for dispatch.",
        icon: "❄",
      },
      {
        name: "Plumbing",
        body: "Prioritize leak emergencies, gather location details, and text owners actionable summaries.",
        icon: "🔧",
      },
      {
        name: "Roofing",
        body: "Capture storm-damage inquiries fast and route urgent leak calls before jobs are lost.",
        icon: "🏠",
      },
      {
        name: "Landscaping",
        body: "Handle estimate requests, seasonal service calls, and maintenance follow-up without voicemail backlog.",
        icon: "🌿",
      },
      {
        name: "Pest Control",
        body: "Triage urgent infestations and collect site details so technicians arrive prepared.",
        icon: "🛡",
      },
      {
        name: "Auto Repair",
        body: "Capture breakdown and booking requests while your team is on the shop floor.",
        icon: "🚗",
      },
      {
        name: "Cleaning Services",
        body: "Qualify residential or commercial requests and send clear service notes for scheduling.",
        icon: "🧼",
      },
      {
        name: "Property Management",
        body: "Route tenant maintenance calls by urgency and keep owner communication organized.",
        icon: "🏢",
      },
      {
        name: "Carpentry Contractors",
        body: "Capture renovation leads while crews are on-site and send callback-ready project details.",
        icon: "🪚",
      },
      {
        name: "Physiotherapy Clinics",
        body: "Handle appointment inquiries and callback requests when staff are with patients.",
        icon: "🩺",
      },
      {
        name: "Dental Clinics",
        body: "Answer after-hours appointment requests and collect patient call context for front desk follow-up.",
        icon: "🦷",
      },
    ],
    []
  );

  useEffect(() => {
    const onScroll = () => {
      setShowTopHeader((window.scrollY || 0) > 20);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (heroHighlightsFrozen) return undefined;
    const timer = setInterval(() => {
      setHeroHighlightPageIdx((prev) => (prev + 1) % heroHighlightPageCount);
    }, 4800);
    return () => clearInterval(timer);
  }, [heroHighlightsFrozen, heroHighlightPageCount]);

  const sections = useMemo(
    () => [
      {
        id: "hero",
        title: "top section",
        summary: "This section explains the main value: an AI telephone assistant that prevents missed calls and lost revenue.",
        keywords: ["top", "headline", "hero", "missed calls", "what is this", "telephone assistant"],
        ref: heroRef,
      },
      {
        id: "overview",
        title: "overview",
        summary: "This section outlines what the assistant does: handle calls, talk to customers, answer FAQs, and send call details for callback.",
        keywords: ["overview", "what does it do", "features", "faq", "call details"],
        ref: overviewRef,
      },
      {
        id: "benefits",
        title: "benefits",
        summary: "This section shows benefits like 24/7 answering, answering after three rings, and sending a thank-you text.",
        keywords: ["benefits", "24/7", "three rings", "thank you text", "advantages"],
        ref: benefitsRef,
      },
      {
        id: "pricing",
        title: "pricing",
        summary: "This section compares starter, growth, and pro plans and explains the pilot-first approach.",
        keywords: ["pricing", "plans", "cost", "monthly", "pilot", "trial"],
        ref: pricingRef,
      },
      {
        id: "proof",
        title: "customer proof",
        summary: "This section shows customer proof, testimonial quotes, and operational outcomes.",
        keywords: ["testimonial", "proof", "results", "case study", "reviews"],
        ref: proofRef,
      },
      {
        id: "security",
        title: "security and reliability",
        summary: "This section explains data protection, access control, and call handling reliability.",
        keywords: ["security", "privacy", "reliability", "encryption", "compliance"],
        ref: complianceRef,
      },
      {
        id: "industries",
        title: "industries",
        summary: "This section shows how My AI PA is used for electricians, HVAC, and plumbing businesses.",
        keywords: ["industry", "electrician", "hvac", "plumbing", "use cases"],
        ref: industryRef,
      },
      {
        id: "call-flow",
        title: "call flow",
        summary: "This section shows the voice-first workflow from voice webhook to FAQ search, lead capture, and owner notification.",
        keywords: ["call flow", "how does it work", "workflow", "webhook", "notification"],
        ref: callFlowRef,
      },
      {
        id: "tools",
        title: "tools",
        summary: "This section lists the master tools available to the AI system, including lead creation, FAQ search, and notifications.",
        keywords: ["tools", "functions", "lead", "log call", "search faq", "owner sms"],
        ref: toolsRef,
      },
      {
        id: "data",
        title: "data storage",
        summary: "This section explains that business, settings, callers, calls, leads, and FAQs are stored in SQLite using Prisma.",
        keywords: ["data", "database", "sqlite", "prisma", "storage"],
        ref: dataRef,
        extraActions: [{ label: "Open admin dashboard", action: { type: "route", hash: "/admin" } }],
      },
      {
        id: "setup",
        title: "setup flow",
        summary: "The setup flow lets you search your Google Business Profile and configure the AI assistant onboarding.",
        keywords: ["setup", "signup", "onboarding", "google business", "register"],
        ref: setupSectionRef,
        extraActions: [{ label: "Open setup flow", action: { type: "route", hash: "/signup" } }],
      },
    ],
    []
  );

  const sectionById = useMemo(() => Object.fromEntries(sections.map((s) => [s.id, s])), [sections]);

  const focusViews = useMemo(
    () => ({
      overview: {
        eyebrow: "Agent View",
        title: "What this does for a business owner",
        body: "This setup answers missed calls, handles common questions, and captures the caller details you need for a fast callback.",
        bullets: [
          "Keeps calls from falling through when you are busy",
          "Handles common questions consistently",
          "Collects caller details and reason for calling",
        ],
        sideTitle: "Best next step",
        sideBody: "Use the concierge on the right to ask about benefits, setup, or call handling. The left side will keep updating.",
        ctaHint: "Ask the concierge anything and this page will adapt to the answer.",
      },
      benefits: {
        eyebrow: "Agent View",
        title: "Why the benefits matter day-to-day",
        body: "The biggest win is consistency: calls get answered quickly, customers get information, and you get a clean lead to follow up.",
        bullets: [
          "24/7 coverage reduces missed opportunities",
          "Answering after 3 rings feels responsive",
          "Thank-you texts improve caller confidence",
        ],
        sideTitle: "What to review",
        sideBody: "Check the benefits section and compare it to your current missed-call process. Then test the setup flow.",
        ctaHint: "This is the outcome-focused view business owners usually care about first.",
      },
      pricing: {
        eyebrow: "Agent View",
        title: "Pricing built for risk-conscious owners",
        body: "Plans are structured so you can start with one line, validate results, and only scale once call quality and lead capture prove out.",
        bullets: [
          "Starter, Growth, and Pro tiers",
          "Transparent monthly base pricing",
          "Pilot-first rollout before full commitment",
        ],
        sideTitle: "Decision shortcut",
        sideBody: "Compare monthly plan fit, then run one demo call and verify setup before you publish.",
        ctaHint: "Use pricing to qualify budget quickly, then move to setup.",
      },
      proof: {
        eyebrow: "Agent View",
        title: "Proof that addresses buyer skepticism",
        body: "This section reinforces trust with testimonial voice, operational visibility, and practical outcomes owners care about.",
        bullets: [
          "Named customer testimonial",
          "Transcript and lead visibility",
          "Operational impact framing",
        ],
        sideTitle: "What to validate",
        sideBody: "Confirm the testimonial language, then add your own performance snapshots as more accounts go live.",
        ctaHint: "Proof removes doubt more effectively than feature lists.",
      },
      security: {
        eyebrow: "Agent View",
        title: "How reliability and data protection are handled",
        body: "This section gives buyers confidence that call handling and customer data are managed with clear safeguards.",
        bullets: [
          "Encryption for data transfer and storage",
          "Role-based admin access",
          "Audit-friendly logging and fallback paths",
        ],
        sideTitle: "Buyer concern addressed",
        sideBody: "Security and reliability are typically final blockers. This section handles those blockers directly.",
        ctaHint: "Keep this section concise and specific so it feels credible.",
      },
      industries: {
        eyebrow: "Agent View",
        title: "Industry-fit messaging",
        body: "Vertical examples help visitors quickly see themselves in the product and picture their own call scenarios.",
        bullets: [
          "Electrician emergency calls",
          "HVAC after-hours triage",
          "Plumbing leak and dispatch capture",
        ],
        sideTitle: "Best next upgrade",
        sideBody: "Turn each card into a dedicated landing page once you have vertical-specific proof and scripts.",
        ctaHint: "Industry relevance increases conversion quality.",
      },
      "call-flow": {
        eyebrow: "Agent View",
        title: "How the assistant handles a call",
        body: "A call is answered, common questions are handled, and the important details are captured so the owner can respond fast.",
        bullets: [
          "Quick pickup experience for the caller",
          "Question handling before escalation",
          "Lead details captured for follow-up",
        ],
        sideTitle: "What to ask next",
        sideBody: "Ask the concierge about urgent calls, after-hours behavior, or how leads show up in admin.",
        ctaHint: "Great topic for demos because people can picture the caller experience immediately.",
      },
      setup: {
        eyebrow: "Agent View",
        title: "What setup looks like",
        body: "Setup starts by finding the business, then configuring how calls should be handled and where leads should be routed.",
        bullets: [
          "Search the business from Google",
          "Confirm details and preferences",
          "Set owner phone and call handling rules",
        ],
        sideTitle: "Fast action",
        sideBody: "Use the primary CTA to go to setup. The onboarding flow is where the demo becomes practical.",
        ctaHint: "Ready to try it? Use Call The Demo or ask the concierge to open setup.",
      },
      data: {
        eyebrow: "Agent View",
        title: "What you can monitor after launch",
        body: "You can review captured calls and leads, refine FAQs, and tune settings so the assistant gets better over time.",
        bullets: [
          "Leads and calls in one dashboard",
          "FAQ edits improve future conversations",
          "Settings control answer timing and routing",
        ],
        sideTitle: "Where this lives",
        sideBody: "Open Admin to review stored leads, transcripts, and settings from one place.",
        ctaHint: "This is the operations side of the product, useful after the first demo.",
      },
      tools: {
        eyebrow: "Agent View",
        title: "How this helps you operate faster",
        body: "Behind the scenes, the system is built to capture, organize, and route the information you need from each call.",
        bullets: [
          "Lead capture stays structured",
          "Responses stay consistent",
          "Follow-up actions are easier to trigger",
        ],
        sideTitle: "Business takeaway",
        sideBody: "You do not need to manage technical details. The value is faster response and fewer missed opportunities.",
        ctaHint: "Use the concierge to jump between business outcomes and setup steps.",
      },
      hero: {
        eyebrow: "Agent View",
        title: "Start with the core value",
        body: "This page is built to show one thing clearly: missed calls cost money, and the assistant exists to stop that.",
        bullets: [
          "Immediate positioning and problem statement",
          "Single primary CTA to drive action",
          "Concierge helps visitors navigate without scrolling",
        ],
        sideTitle: "Suggested next step",
        sideBody: "Ask about benefits or setup to see the page adapt to your question.",
        ctaHint: "Try the concierge on the right and watch the left side switch context.",
      },
    }),
    []
  );

  const heroModes = useMemo(
    () => ({
      overview: {
        heading: "My A.I PA",
        descriptor: "Artificial Intelligence Telephone Answering Assistant",
        underlineHeading: true,
        subline: "STOP MISSING CALLS TODAY!",
        warningSubline: true,
      },
      benefits: {
        heading: "24/7 call coverage that protects your revenue",
        subline: "Faster answers = more chances to win the job",
      },
      "call-flow": {
        heading: "A better caller experience from the first ring",
        subline: "Handled questions. Captured details. Faster follow-up.",
      },
      setup: {
        heading: "Set up your AI phone assistant in a guided flow",
        subline: "Connect your business details and get ready to take calls",
      },
      data: {
        heading: "See every lead and call in one dashboard",
        subline: "Monitor performance and improve how calls are handled",
      },
      tools: {
        heading: "Built to capture, organize, and route call details",
        subline: "Less manual back-and-forth after every missed call",
      },
      hero: {
        heading: "My A.I PA",
        descriptor: "Artificial Intelligence Telephone Answering Assistant",
        underlineHeading: true,
        subline: "STOP MISSING CALLS TODAY!",
        warningSubline: true,
      },
    }),
    []
  );

  const applyAgentFocus = (section, meta = {}) => {
    if (!section) return;
    setAgentFocus({
      id: section.id,
      displayTitle: section.title.charAt(0).toUpperCase() + section.title.slice(1),
      summary: meta.replyText || section.summary,
      lastUserPrompt: meta.query || "",
      ref: section.ref,
    });
  };

  useEffect(() => {
    const handleVoiceQuery = (event) => {
      const q = String(event?.detail?.query || "").trim();
      if (!q) return;
      const query = q.toLowerCase();

      let nextSection = null;

      if (query.includes("setup") || query.includes("sign up") || query.includes("signup") || query.includes("google business")) {
        nextSection = sectionById.setup;
      } else if (query.includes("benefit") || query.includes("24/7") || query.includes("thank you text") || query.includes("three ring")) {
        nextSection = sectionById.benefits;
      } else if (
        query.includes("admin") ||
        query.includes("dashboard") ||
        query.includes("lead") ||
        query.includes("calls table")
      ) {
        nextSection = sectionById.data;
      } else if (
        query.includes("call flow") ||
        query.includes("how does it handle calls") ||
        query.includes("how it works") ||
        (query.includes("call") && (query.includes("handle") || query.includes("work")))
      ) {
        nextSection = sectionById["call-flow"];
      } else if (query.includes("tool") || query.includes("function") || query.includes("faq search")) {
        nextSection = sectionById.tools;
      } else {
        const matches = sections
          .map((section) => ({ section, score: scoreSectionMatch(section, query) }))
          .filter((x) => x.score > 0)
          .sort((a, b) => b.score - a.score);
        nextSection = matches[0]?.section || sectionById.overview;
      }

      applyAgentFocus(nextSection, { reason: "voice-widget", query: q, replyText: nextSection.summary });
      window.dispatchEvent(
        new CustomEvent("myaipa:voice-focus-result", {
          detail: {
            query: q,
            sectionId: nextSection.id,
            title: nextSection.title,
            summary: nextSection.summary,
          },
        })
      );
    };

    window.addEventListener("myaipa:voice-query", handleVoiceQuery);
    return () => window.removeEventListener("myaipa:voice-query", handleVoiceQuery);
  }, [applyAgentFocus, sectionById, sections]);

  const activeFocusView = focusViews[agentFocus?.id] || focusViews.overview;
  const activeHeroMode = heroModes[agentFocus?.id] || heroModes.overview;
  const studioScenarios = useMemo(
    () => ({
      overview: {
        caller: "Hello. I'm just wondering about your hours of operation.",
        transcript: [
          ["AI", "Hello. Thank you for contacting Tim's Electrical Services. We handle residential and commercial electrical work. How are you today?"],
          ["CALLER", "Hello. I'm doing good. How are you?"],
          ["AI", "I'm doing well. Thank you for asking. Are you looking for new installation, repairs or maintenance today?"],
          ["CALLER", "I'm just wondering about your hours of operation."],
          ["AI", "Tim's hours of operation is from 9 a.m. to 6 p.m. Are you looking for new installation, repairs or maintenance today?"],
          ["CALLER", "Well, what type of services does Tim Electrical provide?"],
          ["AI", "We do residential, commercial and specialty. Everything related to electrical including office, building wiring and maintenance, ceiling fan installation and smart home device setup."],
          ["SYSTEM", "Intent detected: maintenance inquiry"],
          ["AI", "Hi. My name is Claire and I'll be your virtual assistant on this call. May I ask you for your first name?"],
          ["CALLER", "Brian."],
          ["AI", "Now since you said maintenance, Brian, what type of electrical work do you need done specifically?"],
          ["CALLER", "I have a few light bulbs flickering. I need some maintenance done on it."],
          ["AI", "Okay. You need to have maintenance done on flickering light bulbs. What is the address where the work needs to be completed?"],
          ["CALLER", "The offices are over at 63 York Street."],
          ["AI", "When would you like the work to be completed?"],
          ["CALLER", "Sometime next week, November 12th."],
          ["AI", "What is the best phone number to reach you at?"],
          ["CALLER", "905-123-4567."],
          ["AI", "What is the best time of day to reach you at?"],
          ["CALLER", "Around this time, 7 o'clock p.m."],
          ["SYSTEM", "Lead captured + owner/service team message sent"],
        ],
        timedTranscript: [
          { t: 0, end: 10, speaker: "AI", text: "Hello. Thank you for contacting Tim's Electrical Services. We handle residential and commercial electrical work. How are you today?" },
          { t: 10, end: 13, speaker: "CALLER", text: "Hello. I'm doing good. How are you?" },
          { t: 13, end: 21, speaker: "AI", text: "I'm doing well. Thank you for asking. Are you looking for new installation, repairs or maintenance today?" },
          { t: 21, end: 25, speaker: "CALLER", text: "I'm just wondering about your hours of operation." },
          { t: 26, end: 30, speaker: "AI", text: "Tim's hours of operation is from 9 a.m. to 6 p.m." },
          { t: 30, end: 34, speaker: "AI", text: "Are you looking for new installation, repairs or maintenance today?" },
          { t: 34, end: 39, speaker: "CALLER", text: "Well, what type of services does Tim Electrical provide?" },
          { t: 41, end: 44, speaker: "AI", text: "We do residential, commercial and specialty." },
          { t: 44, end: 52, speaker: "AI", text: "Everything related to electrical including office, building wiring and maintenance, ceiling fan installation and smart home device setup." },
          { t: 52, end: 56, speaker: "AI", text: "Are you looking for new installation, repairs or maintenance today?" },
          { t: 56, end: 59, speaker: "CALLER", text: "Now that you mention it, I need some maintenance done." },
          { t: 61, end: 64, speaker: "AI", text: "Maintenance. Did I understand that correctly?" },
          { t: 64, end: 65, speaker: "CALLER", text: "Yes." },
          { t: 68, end: 75, speaker: "AI", text: "Hi. My name is Claire and I'll be your virtual assistant on this call. May I ask you for your first name?" },
          { t: 75, end: 76, speaker: "CALLER", text: "Brian." },
          { t: 76, end: 83, speaker: "AI", text: "Hi Brian. Now since you said maintenance, Brian, what type of electrical work do you need done specifically?" },
          { t: 83, end: 87, speaker: "CALLER", text: "I have a few light bulbs flickering. I need some maintenance done on it." },
          { t: 90, end: 97, speaker: "AI", text: "Okay. You need to have maintenance done on flickering light bulbs. What is the address where the work needs to be completed?" },
          { t: 97, end: 101, speaker: "CALLER", text: "The offices are over at 63 York Street." },
          { t: 101, end: 104, speaker: "AI", text: "63 York Street. Did I get that right?" },
          { t: 104, end: 105, speaker: "CALLER", text: "Yes." },
          { t: 108, end: 111, speaker: "AI", text: "When would you like the work to be completed?" },
          { t: 111, end: 114, speaker: "CALLER", text: "Sometime next week, November 12th." },
          { t: 116, end: 119, speaker: "AI", text: "What is the best phone number to reach you at?" },
          { t: 119, end: 125, speaker: "CALLER", text: "905-123-4567." },
          { t: 125, end: 130, speaker: "AI", text: "905-123-4567." },
          { t: 133, end: 138, speaker: "AI", text: "905-123-4567. Is that correct?" },
          { t: 138, end: 139, speaker: "CALLER", text: "Correct." },
          { t: 141, end: 144, speaker: "AI", text: "What is the best time of day to reach you at?" },
          { t: 144, end: 147, speaker: "CALLER", text: "Around this time, 7 o'clock p.m." },
          { t: 148, end: 155, speaker: "AI", text: "Thanks for calling Tim's Electrical. A message has been sent to our service team outlining the key points to this call." },
          { t: 155, end: 162, speaker: "AI", text: "A message has also been sent to your phone confirming the follow-up call to finalize details and to list pricing." },
          { t: 162, end: 169, speaker: "AI", text: "Please visit our website at www.timselectricalservices.ca. Have a great day." },
          { t: 169, end: 171, speaker: "CALLER", text: "Thanks. You too." },
          { t: 177, end: 180, speaker: "AI", text: "www.timselectricalservices.ca" },
        ],
        timingCalibration: {
          anchor: 76,
          offset: 0.42,
          scale: 1.004,
          speakerOffsets: { AI: 0.1, CALLER: 0.02, SYSTEM: 0.04 },
          phases: [
            {
              anchor: 90,
              offset: 1.35,
              scale: 1.024,
            },
          ],
        },
        lead: { intent: "Electrical Maintenance", urgency: "Normal", callback: "905-123-4567", nextStep: "Send owner text summary" },
      },
      benefits: {
        caller: "Do you answer after hours, and will I get a text back?",
        transcript: [
          ["CALLER", "I’m calling late. Can this still be handled?"],
          ["AI", "Yes. Calls can be answered anytime and common questions can be handled."],
          ["SYSTEM", "FAQ matched + after-hours response"],
          ["AI", "I can collect your details and send them to the owner for follow-up."],
        ],
        lead: { intent: "FAQ + Lead", urgency: "Low", callback: "Requested", nextStep: "Queue thank-you text" },
      },
      "call-flow": {
        caller: "How does the call actually get handled from start to finish?",
        transcript: [
          ["CALLER", "I need to understand the call workflow."],
          ["AI", "I’ll answer what I can and collect key details for the owner."],
          ["SYSTEM", "Call received -> FAQ search -> lead capture"],
          ["AI", "If this is urgent, I can flag it right away."],
        ],
        lead: { intent: "Call Flow Demo", urgency: "Medium", callback: "Optional", nextStep: "Show admin lead record" },
      },
      setup: {
        caller: "Can you help me set this up for my business today?",
        transcript: [
          ["CALLER", "I want to get started."],
          ["AI", "Great. The setup starts by finding your Google Business Profile."],
          ["SYSTEM", "Routing user to onboarding flow"],
          ["AI", "Then you set answering rules and where leads should go."],
        ],
        lead: { intent: "Onboarding", urgency: "High", callback: "Immediate", nextStep: "Open setup flow" },
      },
      data: {
        caller: "Where do I see the calls and lead details after launch?",
        transcript: [
          ["CALLER", "I want to see what gets captured."],
          ["AI", "Calls and leads are stored so you can review them in one admin dashboard."],
          ["SYSTEM", "Prepared route: /admin"],
          ["AI", "You can also update FAQs and settings there."],
        ],
        lead: { intent: "Admin Review", urgency: "Low", callback: "N/A", nextStep: "Open admin dashboard" },
      },
      tools: {
        caller: "What does the AI do behind the scenes during a call?",
        transcript: [
          ["CALLER", "What happens in the system while it talks?"],
          ["AI", "It can search FAQs, capture a lead, and route key information."],
          ["SYSTEM", "Tool chain ready: FAQ, lead, notify"],
          ["AI", "The owner gets a clean summary for quick follow-up."],
        ],
        lead: { intent: "System Demo", urgency: "Normal", callback: "Optional", nextStep: "Highlight workflow tools" },
      },
      hero: {
        caller: "What happens if I miss a call while I’m working?",
        transcript: [
          ["CALLER", "I miss calls when I’m on jobs."],
          ["AI", "I can answer, collect details, and prepare a callback summary."],
          ["SYSTEM", "Missed-call recovery mode"],
          ["AI", "You stay focused while the caller still gets a response."],
        ],
        lead: { intent: "Missed Call Recovery", urgency: "Normal", callback: "Captured", nextStep: "Text owner summary" },
      },
    }),
    []
  );
  const activeStudio = studioScenarios[agentFocus?.id] || studioScenarios.overview;
  const timedStudioRows = Array.isArray(activeStudio?.timedTranscript) ? activeStudio.timedTranscript : null;
  const timedStudioCalibration = activeStudio?.timingCalibration || null;
  const hasTimedStudio = Boolean(timedStudioRows);
  const useTimedStudioPlayback = Boolean(timedStudioRows && heroAudioPlaying);
  const timedStudioWindows = useMemo(() => {
    if (!timedStudioRows) return null;
    const calibrateTime = (time, speaker) => {
      const t = Number(time ?? 0);
      if (!timedStudioCalibration || !Number.isFinite(t)) return t;
      const anchor = Number(timedStudioCalibration.anchor ?? 0);
      const offset = Number(timedStudioCalibration.offset ?? 0);
      const scale = Number(timedStudioCalibration.scale ?? 1);
      const speakerOffset = Number(timedStudioCalibration.speakerOffsets?.[speaker] ?? 0);
      let adjusted = t;
      if (t >= anchor) {
        adjusted = anchor + (t - anchor) * scale + offset + speakerOffset;
      }
      const phases = Array.isArray(timedStudioCalibration.phases) ? timedStudioCalibration.phases : [];
      for (const phase of phases) {
        const phaseAnchor = Number(phase?.anchor ?? NaN);
        if (!Number.isFinite(phaseAnchor) || t < phaseAnchor) continue;
        const phaseOffset = Number(phase?.offset ?? 0);
        const phaseScale = Number(phase?.scale ?? 1);
        adjusted += phaseOffset + (t - phaseAnchor) * (phaseScale - 1);
      }
      return adjusted;
    };
    return timedStudioRows.map((row, idx) => {
      const rawNextStart = timedStudioRows[idx + 1]?.t ?? Number.POSITIVE_INFINITY;
      const hasExactEnd = Number.isFinite(row.end);
      const estimatedEnd = hasExactEnd ? Number(row.end) : row.t + estimateSpeechDurationSec(row.text, row.speaker);
      const overrunCap =
        row.speaker === "AI" ? 0.9 : row.speaker === "CALLER" ? 0.55 : 0.25;
      const start = calibrateTime(row.t, row.speaker);
      const nextStart = Number.isFinite(rawNextStart)
        ? calibrateTime(rawNextStart, timedStudioRows[idx + 1]?.speaker)
        : Number.POSITIVE_INFINITY;
      const exactEnd = hasExactEnd ? calibrateTime(estimatedEnd, row.speaker) : estimatedEnd;
      return {
        ...row,
        start,
        end:
          hasExactEnd
            ? exactEnd
            : idx === timedStudioRows.length - 1
            ? exactEnd + 0.4
            : Math.min(Math.max(nextStart, exactEnd), nextStart + overrunCap),
      };
    });
  }, [timedStudioRows, timedStudioCalibration]);
  const activeTimedStudioIndex = useTimedStudioPlayback
    ? ((timedStudioWindows || []).findIndex((row) => heroAudioTime >= row.start && heroAudioTime < row.end) >= 0
      ? (timedStudioWindows || []).findIndex((row) => heroAudioTime >= row.start && heroAudioTime < row.end)
      : (timedStudioWindows || []).length
        ? (timedStudioWindows || []).reduce((acc, row, idx) => (heroAudioTime >= row.start ? idx : acc), -1)
        : -1)
    : -1;
  const activeTimedStudioRow = activeTimedStudioIndex >= 0 ? timedStudioWindows[activeTimedStudioIndex] : null;
  const timedPlaceholderText =
    heroAudioStarted && heroAudioTime > 0.05
      ? "Click the play button to resume the live example transcript"
      : "Click the play button to hear a live example transcript";
  const studioTranscriptRows = (() => {
    if (activeTimedStudioRow) return [[activeTimedStudioRow.speaker, activeTimedStudioRow.text]];
    if (hasTimedStudio) {
      if (!heroAudioStarted || heroAudioTime <= 0.05) return [["SYSTEM", timedPlaceholderText]];
      return [["SYSTEM", "Playback paused. Press play to continue the live transcript."]];
    }
    return activeStudio.transcript?.length ? [activeStudio.transcript[0]] : [["SYSTEM", timedPlaceholderText]];
  })();
  const activeStudioRowIndex = 0;
  const syncedCallerLine = activeTimedStudioRow?.speaker === "CALLER"
    ? activeTimedStudioRow.text
    : activeStudio.caller;
  const heroAudioDuration = (() => {
    const fromState = Number(heroAudioDurationSec || 0);
    if (Number.isFinite(fromState) && fromState > 0) return fromState;
    const fromRef = Number(heroAudioRef.current?.duration || 0);
    if (Number.isFinite(fromRef) && fromRef > 0) return fromRef;
    return 180;
  })();
  const playbackProgress = Math.max(0, Math.min(1, heroAudioTime / Math.max(1, heroAudioDuration)));
  const formattedHeroAudioTime = formatClock(heroAudioTime);
  const formattedHeroAudioDuration = formatClock(heroAudioDuration);
  const showHeroDemoCover = !heroAudioStarted;
  const liveSpeaker = activeTimedStudioRow?.speaker || "SYSTEM";
  const processSteps = ["Answered", "FAQ", "Captured", "Texted"];
  const processStepIndex = (() => {
    const t = heroAudioTime;
    if (t < 25) return 0;
    if (t < 70) return 1;
    if (t < 148) return 2;
    return 3;
  })();

  useEffect(() => {
    return () => {
      if (audioRafRef.current) cancelAnimationFrame(audioRafRef.current);
      if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
        audioCtxRef.current.close().catch(() => {});
      }
    };
  }, []);

  const stopSpectrumLoop = () => {
    if (audioRafRef.current) {
      cancelAnimationFrame(audioRafRef.current);
      audioRafRef.current = null;
    }
  };

  const startSpectrumLoop = () => {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const timeData = new Uint8Array(analyser.fftSize);

    const tick = () => {
      const audioEl = heroAudioRef.current;
      if (audioEl && !Number.isNaN(audioEl.currentTime)) {
        setHeroAudioTime(audioEl.currentTime);
      }
      analyser.getByteTimeDomainData(timeData);
      const next = new Array(40).fill(0).map((_, i) => {
        const start = Math.floor((i / 40) * timeData.length);
        const end = Math.max(start + 1, Math.floor(((i + 1) / 40) * timeData.length));
        let sum = 0;
        for (let j = start; j < end; j += 1) {
          const centered = (timeData[j] - 128) / 128;
          sum += Math.abs(centered);
        }
        const avgAmp = sum / (end - start);
        const eased = 0.06 + clamp(avgAmp * 2.3, 0, 1) * 0.94;
        return clamp(eased, 0.06, 1);
      });

      // light smoothing so it feels like a demo waveform, not jittery bars
      const smoothed = next.map((v, i) => {
        const prev = spectrumDataRef.current[i] ?? 0.08;
        return prev * 0.65 + v * 0.35;
      });
      spectrumDataRef.current = smoothed;
      setSpectrumValues(smoothed);
      audioRafRef.current = requestAnimationFrame(tick);
    };

    stopSpectrumLoop();
    audioRafRef.current = requestAnimationFrame(tick);
  };

  const resetSpectrum = () => {
    const base = new Array(40).fill(0).map((_, i) => 0.04 + (Math.sin(i * 0.7) + 1) * 0.012);
    spectrumDataRef.current = base;
    setSpectrumValues(base);
  };

  const startHeroSampleAudio = async () => {
    try {
      const audioEl = heroAudioRef.current;
      if (!audioEl) return;

      if (!audioCtxRef.current) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        audioCtxRef.current = new Ctx();
      }
      if (audioCtxRef.current.state === "suspended") {
        await audioCtxRef.current.resume();
      }

      if (!audioSourceRef.current) {
        audioSourceRef.current = audioCtxRef.current.createMediaElementSource(audioEl);
        analyserRef.current = audioCtxRef.current.createAnalyser();
        analyserRef.current.fftSize = 1024;
        analyserRef.current.smoothingTimeConstant = 0.82;
        audioSourceRef.current.connect(analyserRef.current);
        analyserRef.current.connect(audioCtxRef.current.destination);
      }

      audioEl.currentTime = 0;
      await audioEl.play();
      setHeroAudioPlaying(true);
      startSpectrumLoop();
    } catch (_err) {
      // If playback is blocked, keep the static visual.
    }
  };

  const playHeroSampleAudio = async () => {
    try {
      const audioEl = heroAudioRef.current;
      if (!audioEl) return;
      if (audioEl.currentTime <= 0.01 || audioEl.ended) {
        await startHeroSampleAudio();
        return;
      }
      if (audioCtxRef.current?.state === "suspended") {
        await audioCtxRef.current.resume();
      }
      await audioEl.play();
      setHeroAudioPlaying(true);
      startSpectrumLoop();
    } catch (_err) {
      // no-op
    }
  };

  const pauseHeroSampleAudio = () => {
    const audioEl = heroAudioRef.current;
    if (!audioEl) return;
    audioEl.pause();
    setHeroAudioPlaying(false);
    setHeroAudioTime(audioEl.currentTime || 0);
    // Keep currentTime / started state so play resumes exactly where it was paused.
    stopSpectrumLoop();
  };

  const stopHeroSampleAudio = () => {
    const audioEl = heroAudioRef.current;
    if (!audioEl) return;
    audioEl.pause();
    audioEl.currentTime = 0;
    setHeroAudioPlaying(false);
    setHeroAudioStarted(false);
    setHeroAudioTime(0);
    stopSpectrumLoop();
    resetSpectrum();
  };

  const seekHeroSampleAudio = (nextTimeSeconds) => {
    const audioEl = heroAudioRef.current;
    if (!audioEl) return;
    const duration = Number(audioEl.duration || heroAudioDurationSec || 0);
    const maxTime = Number.isFinite(duration) && duration > 0 ? duration : Math.max(1, heroAudioDuration);
    const nextTime = clamp(Number(nextTimeSeconds) || 0, 0, maxTime);
    audioEl.currentTime = nextTime;
    setHeroAudioTime(nextTime);
    if (nextTime > 0.05) setHeroAudioStarted(true);
    if (heroAudioPlaying) startSpectrumLoop();
  };

  const toggleHeroSampleAudio = () => {
    if (heroAudioPlaying) {
      pauseHeroSampleAudio();
      return;
    }
    playHeroSampleAudio();
  };

  const toggleDemoTextsSide = () => {
    if (!showDemoTextsSide) {
      resumeDemoAfterTextRef.current = heroAudioPlaying;
      if (heroAudioPlaying) pauseHeroSampleAudio();
      setShowDemoTextsSide(true);
      return;
    }
    setShowDemoTextsSide(false);
    if (resumeDemoAfterTextRef.current) {
      resumeDemoAfterTextRef.current = false;
      playHeroSampleAudio();
    }
  };

  const renderHeroHighlightIcon = (icon) => {
    switch (icon) {
      case "clock":
        return (
          <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" aria-hidden="true">
            <circle cx="10" cy="10" r="6.1" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M10 10V6.9M10 10l2.5 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        );
      case "phone":
        return (
          <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" aria-hidden="true">
            <path d="M6.2 4.8 8 6.6l-2 2a1.2 1.2 0 0 0 0 1.7l3.6 3.6a1.2 1.2 0 0 0 1.7 0l2-2 1.8 1.8-2.1 2.1a2 2 0 0 1-2.8 0L4.1 9.7a2 2 0 0 1 0-2.8Z" fill="currentColor" />
            <path d="M12.2 4.3h3.6v3.6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M15.8 4.3 11.7 8.4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        );
      case "filter":
        return (
          <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" aria-hidden="true">
            <path d="M3.8 5h12.4l-4.6 5v4.2l-2.8 1.6V10z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
          </svg>
        );
      case "callback":
        return (
          <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" aria-hidden="true">
            <path d="M14.8 6.2V3.8h-2.4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M14.8 3.8 10.7 7.9" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M6.2 4.8 8 6.6l-2 2a1.2 1.2 0 0 0 0 1.7l3.6 3.6a1.2 1.2 0 0 0 1.7 0l2-2 1.8 1.8-2.1 2.1a2 2 0 0 1-2.8 0L4.1 9.7a2 2 0 0 1 0-2.8Z" fill="currentColor" />
          </svg>
        );
      case "growth":
        return (
          <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" aria-hidden="true">
            <path d="M4 14.6h12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            <path d="M5.1 12.6 8.1 9.7l2.2 1.9 4.6-4.7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M13.5 6.9h2.7v2.7" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        );
      case "faq":
        return (
          <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" aria-hidden="true">
            <path d="M3.4 5.6h13.2v8.2H9.4l-3.2 2.4v-2.4h-2.8z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
            <path d="M9 8.1a1.8 1.8 0 1 1 2.6 1.6c-.7.3-1 .7-1 1.4" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            <circle cx="10.6" cy="12.8" r=".7" fill="currentColor" />
          </svg>
        );
      case "text":
        return (
          <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" aria-hidden="true">
            <path d="M3.4 5.6h13.2v8.2H9.4l-3.2 2.4v-2.4h-2.8z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
            <path d="M6.1 8.5h7.8M6.1 10.8h5.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        );
      case "bell":
        return (
          <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" aria-hidden="true">
            <path d="M10 4.9a3.3 3.3 0 0 0-3.3 3.3v2.1L5.2 12v1.1h9.6V12l-1.5-1.7V8.2A3.3 3.3 0 0 0 10 4.9Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
            <path d="M8.5 14.2a1.5 1.5 0 0 0 3 0" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        );
      default:
        return null;
    }
  };

  const llamaHeroLayers = [
    { w: 520, h: 180, x: -210, color: "rgba(255,255,255,0.16)", blur: 0, delay: "0s", z: 1 },
    { w: 450, h: 168, x: -145, color: "rgba(15,23,42,0.35)", blur: 0, delay: "0.25s", z: 2 },
    { w: 392, h: 156, x: -86, color: "rgba(15,23,42,0.52)", blur: 0, delay: "0.5s", z: 3 },
    { w: 336, h: 146, x: -25, color: "rgba(255,255,255,0.90)", blur: 0, delay: "0.75s", glow: true, z: 6 },
    { w: 302, h: 140, x: 38, color: "rgba(251,146,60,0.78)", blur: 0, delay: "1s", z: 7 },
    { w: 260, h: 134, x: 102, color: "rgba(217,70,239,0.92)", blur: 0, delay: "1.25s", z: 8 },
    { w: 230, h: 128, x: 158, color: "rgba(147,51,234,0.86)", blur: 0, delay: "1.5s", z: 9 },
  ];
  const scrollToSection = (sectionRef) => {
    if (!sectionRef?.current) return;
    sectionRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const headerNavItems = [
    { label: "Main", ref: heroRef },
    { label: "Info", ref: infoRef },
    { label: "Comparsion", ref: comparisonRef },
    { label: "Pricing", ref: pricingRef },
    { label: "Testimonials", ref: proofRef },
    { label: "Privacy", ref: complianceRef },
    { label: "How it Works", ref: callFlowRef },
    { label: "Set Up Flow", ref: setupSectionRef },
  ];

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#93a3b8] text-white">
      <div className="relative min-h-screen">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(880px_520px_at_12%_8%,rgba(59,130,246,0.10),transparent_62%)]" />
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(188,200,216,0.78),rgba(147,163,184,0.97))]" />
        <div className="pointer-events-none absolute inset-0 opacity-[0.05] [background-image:linear-gradient(to_right,rgba(0,0,0,0.25)_1px,transparent_1px),linear-gradient(to_bottom,rgba(0,0,0,0.16)_1px,transparent_1px)] [background-size:42px_42px]" />

        {showTopHeader ? (
          <div className="fixed left-0 right-0 top-0 z-50 overflow-hidden border border-cyan-100/45 bg-white shadow-[0_18px_40px_-28px_rgba(0,0,0,0.28)]">
            <div className="relative border-b border-cyan-200/35 bg-[linear-gradient(90deg,#06213f_0%,#0a3a73_46%,#0e5da1_100%)] px-4 py-2">
              <div className="relative flex flex-wrap items-center justify-center gap-3 text-center text-xs font-black tracking-[0.05em] text-cyan-50 sm:text-sm">
                <span>All plans include unlimited minutes</span>
                <span className="text-cyan-200/70">|</span>
                <span className="inline-flex items-center gap-2">
                  <span>Call Our AI Now:</span>
                  <a
                    href="tel:3656012472"
                    className="rounded-full border border-cyan-100/45 bg-cyan-300/15 px-3 py-1 font-black tracking-[0.03em] text-white shadow-[0_12px_24px_-18px_rgba(34,211,238,0.85)] transition hover:bg-cyan-300/25"
                    aria-label="Call 365-601-AIPA-2472"
                  >
                    365-601-AIPA(2472)
                  </a>
                </span>
              </div>
            </div>

            <div className="px-4 py-1">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center border-r border-black/10 pr-4">
                  <img
                    src="/MyAIPA_logo.png"
                    alt="MyAIPA logo"
                    className="h-14 w-auto object-contain sm:h-16 lg:h-20"
                    loading="eager"
                    decoding="async"
                  />
                </div>
                <div className="hidden flex-1 items-center gap-6 px-4 text-sm font-semibold text-black/90 lg:flex">
                  {headerNavItems.map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      onClick={() => scrollToSection(item.ref)}
                      className="whitespace-nowrap transition hover:text-cyan-700"
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2 sm:gap-3">
                  <button
                    type="button"
                    onClick={() => setDemoOpen(true)}
                    className="border border-black/10 bg-white px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-black sm:px-5 sm:text-sm"
                  >
                    Call The Demo
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      window.location.hash = "/signup";
                    }}
                    className="bg-black px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-white sm:px-5 sm:text-sm"
                  >
                    See Setup Flow
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        <section ref={heroRef} className="relative z-10 w-full px-0 pt-0 pb-12 sm:pb-16 lg:pb-20">
          <div className="relative">
            <div className="pointer-events-none absolute -left-20 top-[-20%] h-72 w-72 rounded-full bg-[radial-gradient(circle,rgba(255,244,205,0.45),rgba(255,244,205,0)_72%)]" />
            <div className="pointer-events-none absolute right-[-8%] top-[8%] h-80 w-80 rounded-full bg-[radial-gradient(circle,rgba(17,24,39,0.22),rgba(17,24,39,0)_70%)]" />
            <div className="pointer-events-none absolute inset-0 opacity-[0.08] [background-image:radial-gradient(rgba(255,255,255,0.95)_0.8px,transparent_0.8px)] [background-size:14px_14px]" />

            <div className="relative grid gap-16 border border-black/10 bg-white px-6 py-6 lg:grid-cols-[minmax(0,1fr)_40rem] lg:items-start lg:gap-10 lg:px-8 lg:py-8 xl:grid-cols-[minmax(0,1fr)_44rem] xl:gap-14">
              <div
                className={
                  "pointer-events-none absolute inset-y-0 left-0 hidden transition-opacity duration-300 lg:block lg:right-[40rem] xl:right-[44rem] " +
                  (heroAudioPlaying ? "bg-slate-950/28 opacity-100" : "bg-slate-950/0 opacity-0")
                }
              />
              <div
                className="relative mx-auto mt-[-14px] w-full min-w-0 max-w-6xl space-y-8 text-center lg:mx-0 lg:mt-[-28px] lg:max-w-none lg:pt-0 lg:text-left"
              >
                <div className="relative px-1 py-1 sm:px-2 sm:py-2 lg:px-2 lg:py-2">
                  <div className="mx-auto flex w-full max-w-[31rem] items-center justify-start gap-1.5 rounded-full border border-black/10 bg-white px-2 py-1 shadow-[0_10px_24px_-18px_rgba(0,0,0,0.2)] sm:px-2.5 lg:mx-0">
                    <div className="flex -space-x-1.5">
                      {[
                        { id: "a1", src: "https://i.pravatar.cc/80?img=12", alt: "Customer avatar 1" },
                        { id: "a2", src: "https://i.pravatar.cc/80?img=32", alt: "Customer avatar 2" },
                        { id: "a3", src: "https://i.pravatar.cc/80?img=47", alt: "Customer avatar 3" },
                        { id: "a4", src: "https://i.pravatar.cc/80?img=56", alt: "Customer avatar 4" },
                        { id: "a5", src: "https://i.pravatar.cc/80?img=68", alt: "Customer avatar 5" },
                      ].map((avatar) => (
                        <img
                          key={avatar.id}
                          src={avatar.src}
                          alt={avatar.alt}
                          className="h-6 w-6 rounded-full border-2 border-white object-cover shadow-[0_8px_14px_-10px_rgba(0,0,0,0.45)]"
                          loading="lazy"
                          decoding="async"
                          referrerPolicy="no-referrer"
                          onError={(e) => {
                            e.currentTarget.src = "/NiceCaller.png";
                          }}
                        />
                      ))}
                    </div>
                    <div className="min-w-0 text-left leading-tight">
                      <div className="flex items-center gap-1 text-blue-600">
                        {["★", "★", "★", "★", "★"].map((star, idx) => (
                          <span key={idx} className="text-[11px] leading-none sm:text-xs">
                            {star}
                          </span>
                        ))}
                      </div>
                      <p className="mt-0.5 text-xs font-semibold text-slate-700 sm:text-sm">
                        Trusted by businesses across North America
                      </p>
                    </div>
                  </div>

                  <div className="relative pt-1 sm:pt-3">
                    <h1
                      className={
                        "relative mx-auto max-w-6xl text-balance text-[62px] font-black leading-[0.88] tracking-[-0.06em] text-[#090b10] transition-all duration-300 sm:text-[96px] lg:mx-0 lg:max-w-4xl lg:text-[118px] xl:text-[132px] " +
                        (agentFocus?.id && agentFocus.id !== "overview" ? "drop-shadow-[0_14px_34px_rgba(0,0,0,0.2)]" : "")
                      }
                    >
                      {activeHeroMode.heading === "My A.I PA" ? (
                          <span className="inline-block">
                            <span className="text-[#090b10]">My </span>
                            <span className="bg-[linear-gradient(95deg,#22d3ee_0%,#38bdf8_26%,#3b82f6_58%,#4f46e5_100%)] bg-clip-text text-transparent drop-shadow-[0_10px_28px_rgba(37,99,235,0.28)]">
                              A.I PA
                            </span>
                          </span>
                      ) : (
                        <span className={activeHeroMode.underlineHeading ? "underline decoration-white/45 decoration-[2px] underline-offset-[14px]" : ""}>
                          {activeHeroMode.heading}
                        </span>
                      )}
                    </h1>
                    {activeHeroMode.descriptor ? (
                      <p className="mx-auto mt-10 max-w-5xl text-xl font-medium leading-[1.35] tracking-[-0.02em] text-slate-700 sm:text-[1.9rem] lg:mx-0 lg:max-w-3xl lg:text-[1.55rem]">
                        {activeHeroMode.descriptor}
                      </p>
                    ) : null}
                    <p
                      className={
                        "mx-auto mt-8 max-w-4xl text-2xl font-semibold leading-snug tracking-[-0.02em] sm:text-3xl lg:mx-0 lg:max-w-3xl lg:text-[2rem] transition-all duration-300 " +
                        (activeHeroMode.warningSubline
                          ? "font-black bg-gradient-to-r from-emerald-700 via-green-600 to-lime-600 bg-clip-text text-transparent [-webkit-text-stroke:0.5px_rgba(6,95,70,0.55)] drop-shadow-[0_10px_24px_rgba(16,185,129,0.45)]"
                          : "text-[#111827]")
                      }
                    >
                      {activeHeroMode.subline}
                    </p>

                    <div className="mt-8 flex flex-col items-center gap-3 lg:flex-row lg:items-start lg:justify-start">
                      <div className="flex flex-wrap items-center justify-center gap-4 lg:justify-start">
                        <button
                          type="button"
                          onClick={() => {
                            setDemoOpen(true);
                          }}
                          className="rounded-full bg-gradient-to-r from-cyan-400 via-blue-500 to-indigo-500 px-10 py-5 text-base font-black uppercase tracking-[0.14em] text-white shadow-[0_24px_44px_-20px_rgba(59,130,246,0.65)] ring-1 ring-white/15 transition hover:scale-[1.01] sm:text-lg"
                        >
                          Call The Demo
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setupSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                          }}
                          className="rounded-full border border-slate-300/80 bg-slate-100 px-8 py-5 text-[1.05rem] font-extrabold text-slate-900 shadow-[0_14px_28px_-18px_rgba(0,0,0,0.26)] transition hover:bg-white sm:px-10"
                        >
                          See Setup Flow
                        </button>
                      </div>
                      <div className="w-full max-w-xl text-left lg:mt-4 lg:max-w-[23rem]">
                        <p className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">Privacy and compliance</p>
                        <div className="mt-2 space-y-2">
                          {[
                            "PIPEDA-aware workflow controls",
                            "Encryption in transit and at rest",
                            "Role-based admin access controls",
                          ].map((line) => (
                            <div key={line} className="flex items-start gap-2.5 text-sm font-semibold text-slate-800">
                              <span className="mt-[2px] inline-flex h-5 w-5 items-center justify-center rounded-full bg-violet-100 text-violet-700">
                                {renderHeroHighlightIcon("filter")}
                              </span>
                              <span>{line}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                    <style>{`
                      @keyframes heroHighlightsSwap {
                        0% { opacity: 0; transform: translateY(6px); }
                        100% { opacity: 1; transform: translateY(0); }
                      }
                    `}</style>
                    <div
                      className="mx-auto mt-5 w-full max-w-6xl overflow-hidden rounded-2xl border border-black/10 bg-white/85 px-4 py-4 text-xs font-semibold text-slate-800 shadow-[0_20px_45px_-35px_rgba(0,0,0,0.18)] backdrop-blur sm:text-sm lg:mx-0 lg:max-w-none"
                      onMouseEnter={() => setHeroHighlightPaused(true)}
                      onMouseLeave={() => setHeroHighlightPaused(false)}
                    >
                      <div
                        key={heroHighlightPageIdx}
                        className="grid w-full grid-cols-[max-content_auto_max-content_auto_max-content] items-center justify-center gap-x-2"
                        style={{ animation: "heroHighlightsSwap 420ms ease" }}
                      >
                        {visibleHeroHighlights.map((item, idx) => (
                          <React.Fragment key={item.label}>
                            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                              <span className={`inline-flex h-4 w-4 items-center justify-center rounded-full ${item.tone}`}>{renderHeroHighlightIcon(item.icon)}</span>
                              <span>{item.label}</span>
                            </span>
                            {idx < visibleHeroHighlights.length - 1 ? <span className="text-black/20">/</span> : null}
                          </React.Fragment>
                        ))}
                      </div>
                    </div>

                    <audio
                      ref={heroAudioRef}
                      src="/MyAIPA-Website_public_voice.m4a"
                      preload="auto"
                      className="hidden"
                      onEnded={() => {
                        setHeroAudioPlaying(false);
                        setHeroAudioStarted(false);
                        setHeroAudioTime(0);
                        stopSpectrumLoop();
                        resetSpectrum();
                      }}
                      onPause={() => {
                        setHeroAudioPlaying(false);
                        stopSpectrumLoop();
                      }}
                      onTimeUpdate={(e) => {
                        setHeroAudioTime(e.currentTarget.currentTime || 0);
                      }}
                      onLoadedMetadata={(e) => {
                        const duration = Number(e.currentTarget.duration || 0);
                        if (Number.isFinite(duration) && duration > 0) {
                          setHeroAudioDurationSec(duration);
                        }
                      }}
                      onPlay={() => {
                        setHeroAudioPlaying(true);
                        setHeroAudioStarted(true);
                      }}
                    />

                    <p className="mx-auto mt-4 max-w-5xl text-center text-xl font-medium leading-relaxed text-slate-700 sm:text-2xl lg:mx-0 lg:max-w-3xl lg:text-left">
                      My AI PA uses{" "}
                      <span className="inline-flex items-center rounded-full border border-slate-300/80 bg-[linear-gradient(180deg,#f8fafc_0%,#e2e8f0_100%)] px-2.5 py-0.5 text-[0.88em] font-semibold tracking-[0.01em] text-slate-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_1px_3px_rgba(15,23,42,0.08)]">
                        OpenAI-powered
                      </span>{" "}
                      voice AI to answer missed calls, handle customer conversations professionally, and text you key caller details for fast follow-up.{" "}
                      <span className="inline-block bg-gradient-to-r from-cyan-500 via-blue-500 to-indigo-600 bg-clip-text font-extrabold text-transparent drop-shadow-[0_6px_18px_rgba(37,99,235,0.35)]">
                        Get the AI Advantage today!
                      </span>
                    </p>

                  </div>
                </div>

                <AgentFocusPanel
                  focus={agentFocus}
                  onJump={() => {
                    if (agentFocus?.ref?.current) {
                      agentFocus.ref.current.scrollIntoView({ behavior: "smooth", block: "start" });
                    }
                  }}
                />
              </div>

              <div className="relative isolate mx-auto w-full max-w-6xl space-y-5 sm:px-3 lg:mx-0 lg:-mt-6 lg:w-[40rem] lg:max-w-none lg:justify-self-end xl:-mt-8 xl:w-[44rem]">
                <div className="relative overflow-hidden rounded-[38px] border border-cyan-300/20 bg-[linear-gradient(180deg,rgba(15,23,42,0.9),rgba(2,6,23,0.97))] p-5 shadow-[0_55px_120px_-72px_rgba(0,0,0,0.95)] ring-1 ring-cyan-200/10 sm:p-6">
                  <div className="pointer-events-none absolute inset-0 opacity-[0.08] [background-image:radial-gradient(rgba(255,255,255,0.85)_0.8px,transparent_0.8px)] [background-size:16px_16px]" />
                  <style>{`
                    @keyframes heroPlayPulse {
                      0% { box-shadow: 0 0 0 0 rgba(56,189,248,0.42); }
                      70% { box-shadow: 0 0 0 18px rgba(56,189,248,0); }
                      100% { box-shadow: 0 0 0 0 rgba(56,189,248,0); }
                    }
                    .hero-demo-slider {
                      -webkit-appearance: none;
                      appearance: none;
                      height: 6px;
                      border-radius: 999px;
                      outline: none;
                    }
                    .hero-demo-slider::-webkit-slider-thumb {
                      -webkit-appearance: none;
                      appearance: none;
                      width: 14px;
                      height: 14px;
                      border-radius: 999px;
                      background: #22d3ee;
                      border: 2px solid #0f172a;
                      box-shadow: 0 0 0 2px rgba(255,255,255,0.2);
                      cursor: pointer;
                    }
                    .hero-demo-slider::-moz-range-thumb {
                      width: 14px;
                      height: 14px;
                      border-radius: 999px;
                      background: #22d3ee;
                      border: 2px solid #0f172a;
                      box-shadow: 0 0 0 2px rgba(255,255,255,0.2);
                      cursor: pointer;
                    }
                    .hero-demo-flip-scene {
                      perspective: 1800px;
                    }
                    .hero-demo-flip-inner {
                      position: relative;
                      min-height: 392px;
                      transform-style: preserve-3d;
                      transition: transform 720ms cubic-bezier(0.22, 0.61, 0.36, 1);
                    }
                    .hero-demo-flip-inner.is-flipped {
                      transform: rotateY(180deg);
                    }
                    .hero-demo-face {
                      position: absolute;
                      inset: 0;
                      -webkit-backface-visibility: hidden;
                      backface-visibility: hidden;
                      border-radius: 14px;
                      overflow: hidden;
                    }
                    .hero-demo-face-back {
                      transform: rotateY(180deg);
                    }
                    @media (min-width: 640px) {
                      .hero-demo-flip-inner {
                        min-height: 440px;
                      }
                    }
                  `}</style>
                  <div className="relative">
                    <div className="mb-4 flex items-start justify-between gap-3">
                      <div className="min-w-0 pr-2">
                        <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-100/92 sm:text-sm">Live Call Demo Studio</p>
                        <p className="mt-1 text-[11px] font-semibold text-white/62 sm:text-xs">
                          {showHeroDemoCover
                            ? "Press play to launch the demo and watch transcript + lead stages update in real time."
                            : "Playback is synced to transcript and stage progress so owners can see the full flow."}
                        </p>
                      </div>
                      <div className="ml-2 flex shrink-0 items-center gap-2">
                        <span
                          className={
                            "rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] sm:text-xs " +
                            (showDemoTextsSide
                              ? "border-violet-300/45 bg-violet-300/16 text-violet-100"
                              : heroAudioPlaying
                                ? "border-emerald-300/40 bg-emerald-300/14 text-emerald-100"
                                : showHeroDemoCover
                                  ? "border-cyan-300/30 bg-cyan-300/10 text-cyan-100/90"
                                  : "border-white/15 bg-white/5 text-white/75")
                          }
                        >
                          {showDemoTextsSide ? "Text view" : heroAudioPlaying ? "Live now" : showHeroDemoCover ? "Ready to play" : "Paused"}
                        </span>
                        <button
                          type="button"
                          onClick={toggleDemoTextsSide}
                          className={
                            "inline-flex h-11 w-28 items-center justify-center rounded-full border px-2 text-center text-[10px] font-black uppercase leading-[1.05] tracking-[0.08em] transition sm:text-[10px] " +
                            (showDemoTextsSide
                              ? "border-violet-300/35 bg-violet-300/12 text-violet-100 hover:bg-violet-300/20"
                              : "border-cyan-300/35 bg-cyan-300/12 text-cyan-100 hover:bg-cyan-300/20")
                          }
                          aria-label={showDemoTextsSide ? "Back to live chat board" : "Go to text board"}
                        >
                          {showDemoTextsSide ? "Back to live chat board" : "Go to text board"}
                        </button>
                      </div>
                    </div>

                    <div className="hero-demo-flip-scene relative w-full overflow-hidden rounded-2xl border border-cyan-200/15 bg-[linear-gradient(180deg,rgba(4,9,21,0.88),rgba(5,10,24,0.95))] p-3 sm:p-4">
                      <div className={"hero-demo-flip-inner " + (showDemoTextsSide ? "is-flipped" : "")}>
                        <div className="hero-demo-face hero-demo-face-front">
                          <div className="relative h-full">
                            <div className={"transition-all duration-500 " + (showHeroDemoCover ? "scale-[0.995] opacity-25 blur-[1px]" : "scale-100 opacity-100 blur-0")}>
                              <div className="relative h-20 overflow-hidden rounded-xl border border-cyan-200/15 bg-[linear-gradient(180deg,#040915,#070d1f)] sm:h-24">
                                <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-cyan-200/25" />
                                <svg viewBox="0 0 1200 120" className="h-full w-full" preserveAspectRatio="none" aria-hidden="true">
                                  <defs>
                                    <linearGradient id="pulseLayerA" x1="0%" y1="0%" x2="100%" y2="0%">
                                      <stop offset="0%" stopColor="rgba(56,189,248,0)" />
                                      <stop offset="22%" stopColor="rgba(56,189,248,0.45)" />
                                      <stop offset="50%" stopColor="rgba(37,99,235,0.6)" />
                                      <stop offset="78%" stopColor="rgba(45,212,191,0.42)" />
                                      <stop offset="100%" stopColor="rgba(56,189,248,0)" />
                                    </linearGradient>
                                    <linearGradient id="pulseLayerB" x1="0%" y1="0%" x2="100%" y2="0%">
                                      <stop offset="0%" stopColor="rgba(59,130,246,0)" />
                                      <stop offset="26%" stopColor="rgba(14,165,233,0.35)" />
                                      <stop offset="54%" stopColor="rgba(30,64,175,0.6)" />
                                      <stop offset="82%" stopColor="rgba(6,182,212,0.34)" />
                                      <stop offset="100%" stopColor="rgba(59,130,246,0)" />
                                    </linearGradient>
                                    <linearGradient id="pulseStrokeHeroBoard" x1="0%" y1="0%" x2="100%" y2="0%">
                                      <stop offset="0%" stopColor="rgba(56,189,248,0)" />
                                      <stop offset="20%" stopColor="#22d3ee" />
                                      <stop offset="50%" stopColor="#60a5fa" />
                                      <stop offset="80%" stopColor="#2dd4bf" />
                                      <stop offset="100%" stopColor="rgba(56,189,248,0)" />
                                    </linearGradient>
                                  </defs>
                                  <path d={buildWaveAreaPath(spectrumValues.map((v, i) => clamp(v * (1 + Math.sin(i * 0.24) * 0.22), 0, 1)), 1200, 120, 60, 30)} fill="url(#pulseLayerA)" />
                                  <path d={buildWaveAreaPath(spectrumValues.map((v, i) => clamp(v * (0.78 + Math.cos(i * 0.31) * 0.18), 0, 1)), 1200, 120, 60, 24)} fill="url(#pulseLayerB)" />
                                  <path
                                    d={buildSpectrumPath(spectrumValues.map((v, i) => clamp(v * (0.86 + Math.sin(i * 0.42) * 0.1), 0, 1)), 1200, 120, 60)}
                                    fill="none"
                                    stroke="url(#pulseStrokeHeroBoard)"
                                    strokeWidth="2.4"
                                    strokeLinecap="round"
                                  />
                                </svg>
                              </div>

                              <div className="mt-5 grid gap-4 lg:grid-cols-[1.7fr_0.9fr]">
                                <div className="rounded-2xl border border-white/10 bg-black/20 p-4 sm:p-5">
                                  <p className="mb-3 text-xs font-black uppercase tracking-[0.16em] text-white/55">Live Transcript Lane</p>
                                  <div className="space-y-2.5">
                                    {(studioTranscriptRows || []).map((row, idx) => {
                                      const speaker = row?.[0] || row?.speaker || "SYSTEM";
                                      const text = row?.[1] || row?.text || "";
                                      const isAi = speaker === "AI";
                                      const isCaller = speaker === "CALLER";
                                      return (
                                        <div
                                          key={`${speaker}-${idx}-${text.slice(0, 24)}`}
                                          className={
                                            "rounded-xl px-3 py-2 text-sm font-semibold leading-snug sm:text-base " +
                                            (isAi
                                              ? "ml-8 bg-blue-500/20 text-blue-100"
                                              : isCaller
                                                ? "mr-8 bg-white/10 text-white/90"
                                                : "bg-black/30 text-white/65")
                                          }
                                        >
                                          <span className="mr-2 text-[10px] font-black uppercase tracking-[0.14em] text-white/45">{speaker === "AI" ? "MY AI PA" : speaker}</span>
                                          {text}
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>

                                <div className="space-y-4">
                                  <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                                    <p className="mb-2 text-xs font-black uppercase tracking-[0.16em] text-white/55">Stage Progress</p>
                                    <div className="space-y-2">
                                      {processSteps.map((stage, idx) => {
                                        const active = idx <= processStepIndex;
                                        return (
                                          <div
                                            key={stage}
                                            className={
                                              "rounded-lg border px-3 py-2 text-sm font-bold " +
                                              (active
                                                ? "border-cyan-300/35 bg-cyan-300/12 text-cyan-100"
                                                : "border-white/10 bg-white/5 text-white/55")
                                            }
                                          >
                                            {stage}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>

                            {showHeroDemoCover && !showDemoTextsSide ? (
                              <div className="absolute inset-0 z-20 flex items-center justify-center">
                                <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(56,189,248,0.24),rgba(2,6,23,0.94)_72%)]" />
                                <div className="relative mx-auto max-w-md px-4 text-center">
                                  <span className="inline-flex rounded-full border border-cyan-200/30 bg-cyan-300/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.15em] text-cyan-100/90 sm:text-xs">
                                    Interactive demo
                                  </span>
                                  <p className="mt-4 text-xl font-black tracking-[-0.02em] text-white sm:text-2xl">Hear how My AI PA handles a real missed call.</p>
                                  <p className="mt-2 text-sm font-semibold text-white/70 sm:text-base">Play to reveal live transcript and stage progress in sync with the audio.</p>
                                  <button
                                    type="button"
                                    onClick={playHeroSampleAudio}
                                    className="mt-6 inline-flex items-center gap-3 rounded-full border border-cyan-300/40 bg-gradient-to-r from-cyan-400 to-blue-500 px-5 py-3 text-sm font-black uppercase tracking-[0.14em] text-white shadow-[0_24px_40px_-22px_rgba(56,189,248,0.75)] transition hover:brightness-105 sm:px-6"
                                    aria-label="Play live call demo"
                                  >
                                    <span
                                      className="grid h-10 w-10 place-items-center rounded-full bg-[#0b1328] text-cyan-200"
                                      style={{ animation: "heroPlayPulse 2s infinite" }}
                                    >
                                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
                                        <path d="M8 6.2v11.6a.8.8 0 0 0 1.2.69l9.2-5.8a.8.8 0 0 0 0-1.36L9.2 5.51A.8.8 0 0 0 8 6.2z" />
                                      </svg>
                                    </span>
                                    Play demo
                                  </button>
                                </div>
                              </div>
                            ) : null}
                          </div>
                        </div>

                        <div className="hero-demo-face hero-demo-face-back border border-violet-300/20 bg-[linear-gradient(180deg,rgba(20,12,35,0.94),rgba(8,6,20,0.96))] p-3 sm:p-4">
                          <div className="h-full rounded-xl border border-white/12 bg-black/25 p-3 sm:p-4">
                            <div className="flex items-center justify-between gap-2">
                              <p className="text-xs font-black uppercase tracking-[0.18em] text-violet-100/90 sm:text-sm">Text Delivery Preview</p>
                              <span className="rounded-full border border-violet-300/35 bg-violet-300/12 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-violet-100/90">
                                Sent instantly
                              </span>
                            </div>
                            <p className="mt-1 text-xs font-semibold text-white/65 sm:text-sm">
                              Customer receives a confirmation text. Owner receives the lead summary with contact details.
                            </p>
                            <div className="mt-3 grid gap-3 sm:grid-cols-2">
                              <figure className="overflow-hidden rounded-xl border border-white/10 bg-[#060a17] p-2">
                                <figcaption className="mb-2 text-[11px] font-black uppercase tracking-[0.14em] text-cyan-100/85">Customer text</figcaption>
                                <img
                                  src="/customer_text.png"
                                  alt="Customer text message preview"
                                  className="h-56 w-full rounded-lg object-contain sm:h-64"
                                  loading="lazy"
                                  decoding="async"
                                />
                              </figure>
                              <figure className="overflow-hidden rounded-xl border border-white/10 bg-[#060a17] p-2">
                                <figcaption className="mb-2 text-[11px] font-black uppercase tracking-[0.14em] text-emerald-100/85">Owner text</figcaption>
                                <img
                                  src="/owner_text.png"
                                  alt="Owner text message summary preview"
                                  className="h-56 w-full rounded-lg object-contain sm:h-64"
                                  loading="lazy"
                                  decoding="async"
                                />
                              </figure>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className={"mt-10 w-full rounded-xl border border-white/12 bg-black/45 px-3 py-3 transition sm:mt-12 " + (showDemoTextsSide ? "opacity-85" : "")}>
                      <div className="flex items-center gap-2 sm:gap-3">
                        <button
                          type="button"
                          onClick={toggleHeroSampleAudio}
                          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/8 text-white/95 transition hover:bg-white/14"
                          aria-label={heroAudioPlaying ? "Pause live demo audio" : "Play live demo audio"}
                        >
                          {heroAudioPlaying ? (
                            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
                              <path d="M7 5h3v14H7zm7 0h3v14h-3z" />
                            </svg>
                          ) : (
                            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
                              <path d="M8 6.2v11.6a.8.8 0 0 0 1.2.69l9.2-5.8a.8.8 0 0 0 0-1.36L9.2 5.51A.8.8 0 0 0 8 6.2z" />
                            </svg>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={stopHeroSampleAudio}
                          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/8 text-white/85 transition hover:bg-white/14 hover:text-white"
                          aria-label="Stop and reset live demo audio"
                        >
                          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
                            <rect x="7" y="7" width="10" height="10" rx="1.5" />
                          </svg>
                        </button>
                        <span className="min-w-[94px] shrink-0 text-[11px] font-bold tabular-nums text-white/70 sm:text-xs">
                          {formattedHeroAudioTime} / {formattedHeroAudioDuration}
                        </span>
                        <div className="flex-1">
                          <input
                            type="range"
                            min={0}
                            max={Math.max(1, heroAudioDuration)}
                            step={0.1}
                            value={Math.min(heroAudioTime, Math.max(1, heroAudioDuration))}
                            onChange={(e) => seekHeroSampleAudio(Number(e.target.value))}
                            className="hero-demo-slider w-full cursor-pointer"
                            aria-label="Seek live demo audio"
                            style={{
                              background: `linear-gradient(to right, #22d3ee 0%, #22d3ee ${Math.round(playbackProgress * 100)}%, rgba(255,255,255,0.16) ${Math.round(playbackProgress * 100)}%, rgba(255,255,255,0.16) 100%)`,
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="hidden grid gap-4 sm:grid-cols-2">
                  <div className="rounded-[24px] border border-white/25 bg-white/10 p-4 backdrop-blur">
                    <p className="text-xs font-black uppercase tracking-[0.22em] text-white/55">What are the benefits?</p>
                    <div className="mt-3 space-y-2 text-sm font-semibold text-white/90">
                      {benefitBullets.map((line) => (
                        <div key={line}>{line}</div>
                      ))}
                    </div>
                    <p className="mt-4 border-t border-white/15 pt-3 text-sm font-extrabold text-white/95">
                      Every call captured. Every lead texted to you.
                    </p>
                  </div>

                  <div className="rounded-[24px] border border-white/20 bg-[linear-gradient(180deg,rgba(10,12,18,0.72),rgba(8,10,16,0.86))] p-4 shadow-[0_24px_60px_-36px_rgba(0,0,0,0.8)] ring-1 ring-black/20">
                    <p className="text-xs font-bold uppercase tracking-[0.28em] text-white/60">{activeFocusView.sideTitle}</p>
                    <p className="mt-3 text-sm font-semibold leading-snug text-white/85">{activeFocusView.sideBody}</p>
                    <div className="mt-4 grid gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          applyAgentFocus(sectionById.benefits, { reason: "quick", query: "benefits" });
                          benefitsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                        }}
                        className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-bold text-white/85 hover:bg-white/10"
                      >
                        Show benefits mode
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          applyAgentFocus(sectionById.setup, { reason: "quick", query: "setup" });
                        }}
                        className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-bold text-white/85 hover:bg-white/10"
                      >
                        Show setup mode
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (agentFocus?.ref?.current) {
                            agentFocus.ref.current.scrollIntoView({ behavior: "smooth", block: "start" });
                          }
                        }}
                        className="rounded-xl border border-emerald-300/20 bg-emerald-300/10 px-3 py-2 text-sm font-bold text-emerald-50 hover:bg-emerald-300/15"
                      >
                        Jump to focused section
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>


            <div className="hidden relative mt-6 grid gap-5 lg:grid-cols-[1.12fr_0.88fr]">
              <div
                ref={overviewRef}
                className={
                  "overflow-hidden rounded-[28px] border border-white/20 bg-[linear-gradient(180deg,rgba(10,12,18,0.78),rgba(8,10,16,0.9))] p-6 shadow-[0_40px_110px_-65px_rgba(0,0,0,0.9)] ring-1 ring-black/20 backdrop-blur " +
                  (agentFocus?.id === "overview" ? "ring-2 ring-emerald-300/35 border-emerald-200/25" : "")
                }
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.28em] text-white/60">{activeFocusView.eyebrow}</p>
                    <p className="mt-3 text-2xl font-extrabold text-white sm:text-3xl">{activeFocusView.title}</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                    <p className="text-sm font-extrabold text-white">The future of customer service</p>
                    <p className="mt-1 text-sm font-bold text-white/85">Our AI telephone assistant</p>
                  </div>
                </div>
                <p className="mt-4 text-base font-semibold leading-snug text-white/85">{activeFocusView.body}</p>

                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  {activeFocusView.bullets.map((line, idx) => (
                    <div key={line} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white/85">
                      <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full border border-white/10 bg-black/20 text-xs font-black text-white/80">
                        {idx + 1}
                      </span>
                      {line}
                    </div>
                  ))}
                </div>

                <div className="mt-5 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (agentFocus?.ref?.current) {
                        agentFocus.ref.current.scrollIntoView({ behavior: "smooth", block: "start" });
                      }
                    }}
                    className="rounded-full border border-white/15 bg-white/5 px-3 py-2 text-xs font-bold text-white/85 hover:bg-white/10"
                  >
                    Jump to focused section
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      applyAgentFocus(sectionById.overview, { reason: "manual-reset" });
                    }}
                    className="rounded-full border border-white/15 bg-white/5 px-3 py-2 text-xs font-bold text-white/75 hover:bg-white/10"
                  >
                    Reset view
                  </button>
                  <NavButton
                    onClick={() => {
                      window.location.hash = "/admin";
                    }}
                  >
                    Open Admin
                  </NavButton>
                  <NavButton
                    onClick={() => {
                      window.location.hash = "/legacy";
                    }}
                  >
                    View Current Demo
                  </NavButton>
                </div>
              </div>

              <div
                ref={benefitsRef}
                className={
                  "rounded-[28px] border border-white/25 bg-white/10 p-6 shadow-[0_28px_70px_-42px_rgba(0,0,0,0.6)] backdrop-blur " +
                  (agentFocus?.id === "benefits" ? "ring-2 ring-emerald-300/35 border-emerald-200/25" : "")
                }
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-lg font-black text-white sm:text-xl">Outcome Snapshot</p>
                  <div className="rounded-full border border-white/15 bg-black/15 px-3 py-2 text-xs font-black uppercase tracking-[0.14em] text-white/80">
                    {agentFocus?.displayTitle || "Overview"}
                  </div>
                </div>
                <p className="mt-3 text-base font-semibold leading-snug text-white/90">{activeFocusView.sideBody}</p>

                <div className="mt-5 space-y-3">
                  <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
                    <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/55">Core value delivered</p>
                    <div className="mt-3 space-y-2 text-sm font-semibold text-white/90">
                      {coreBullets.map((line) => (
                        <div key={line}>{line}</div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-emerald-300/15 bg-emerald-300/5 p-4">
                    <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-100/70">Best next prompt</p>
                    <p className="mt-2 text-sm font-semibold text-white/90">
                      Ask the assistant a real customer question and watch the page switch context automatically.
                    </p>
                  </div>
                </div>
              </div>
            </div>

          </div>
        </section>
        <section ref={infoRef} className="relative z-10 w-full pb-14 sm:pb-16 lg:pb-20">
          <style>{`
            @keyframes builtWithTicker {
              0% { transform: translateX(0%); }
              100% { transform: translateX(-50%); }
            }
          `}</style>
          <div className="relative overflow-hidden rounded-[26px] border border-white/10 bg-[linear-gradient(90deg,#0a0b10_0%,#0b0d13_50%,#0a0b10_100%)] px-5 py-10 shadow-[0_30px_90px_-62px_rgba(0,0,0,0.75)] sm:px-7 sm:py-12 lg:px-10 lg:py-14">
            <div className="pointer-events-none absolute inset-0 opacity-[0.06] [background-image:linear-gradient(to_right,rgba(255,255,255,0.7)_1px,transparent_1px)] [background-size:88px_100%]" />
            <div className="relative mx-auto w-full max-w-6xl">
              <p className="text-center text-xs font-black uppercase tracking-[0.22em] text-white/48 sm:text-sm">
                Built with trusted infrastructure
              </p>
              <p className="mx-auto mt-3 max-w-3xl text-center text-lg font-semibold text-white/60 sm:text-xl">
                My AI PA runs on reliable providers and tools we use every day.
              </p>

              <div className="mt-9 mx-auto w-full max-w-4xl overflow-hidden rounded-lg border border-white/5 bg-black/10">
                <div className="flex w-max items-center gap-4 px-4 py-3" style={{ animation: "builtWithTicker 32s linear infinite" }}>
                  {[
                    {
                      name: "Twilio",
                      logoUrl: "https://brandslogos.com/wp-content/uploads/images/large/twilio-logo.png",
                      fallbackLogoUrl: "https://cdn.simpleicons.org/twilio/B7BDC8",
                      accent: "#F22F46",
                    },
                    {
                      name: "OpenAI",
                      logoUrl: "https://upload.wikimedia.org/wikipedia/commons/4/4d/OpenAI_Logo.svg",
                      fallbackLogoUrl: "https://upload.wikimedia.org/wikipedia/commons/4/4d/OpenAI_Logo.svg",
                      hideTextLabel: true,
                      accent: "#10A37F",
                    },
                    { name: "Stripe", logo: "stripe", accent: "#635BFF", iconHex: "635BFF" },
                    { name: "Google Cloud", logo: "googlecloud", accent: "#4285F4", iconHex: "4285F4" },
                    { name: "Node.js", logo: "nodedotjs", accent: "#5FA04E", iconHex: "5FA04E" },
                    { name: "React", logo: "react", accent: "#61DAFB", iconHex: "61DAFB" },
                    { name: "Cloudflare", logo: "cloudflare", accent: "#F38020", iconHex: "F38020" },
                  ].concat([
                    {
                      name: "Twilio",
                      logoUrl: "https://brandslogos.com/wp-content/uploads/images/large/twilio-logo.png",
                      fallbackLogoUrl: "https://cdn.simpleicons.org/twilio/B7BDC8",
                      accent: "#F22F46",
                    },
                    {
                      name: "OpenAI",
                      logoUrl: "https://upload.wikimedia.org/wikipedia/commons/4/4d/OpenAI_Logo.svg",
                      fallbackLogoUrl: "https://upload.wikimedia.org/wikipedia/commons/4/4d/OpenAI_Logo.svg",
                      hideTextLabel: true,
                      accent: "#10A37F",
                    },
                    { name: "Stripe", logo: "stripe", accent: "#635BFF", iconHex: "635BFF" },
                    { name: "Google Cloud", logo: "googlecloud", accent: "#4285F4", iconHex: "4285F4" },
                    { name: "Node.js", logo: "nodedotjs", accent: "#5FA04E", iconHex: "5FA04E" },
                    { name: "React", logo: "react", accent: "#61DAFB", iconHex: "61DAFB" },
                    { name: "Cloudflare", logo: "cloudflare", accent: "#F38020", iconHex: "F38020" },
                  ]).map((item, idx) => (
                    <div
                      key={`${item.name}-${idx}`}
                      className="flex h-12 shrink-0 items-center justify-center gap-3 rounded-md border px-4 py-2 text-center font-black text-white/65 transition"
                      style={{
                        borderColor: `${item.accent}33`,
                        background: `linear-gradient(180deg, ${item.accent}12, rgba(255,255,255,0.02))`,
                        boxShadow: `0 0 0 1px ${item.accent}14 inset, 0 12px 30px -24px ${item.accent}66`,
                      }}
                    >
                      <img
                        src={item.logoUrl || `https://cdn.simpleicons.org/${item.logo}/${item.iconHex || "64748B"}`}
                        alt={`${item.name} logo`}
                        className={
                          (item.hideTextLabel ? "h-8 w-24 " : "h-5 w-8 ") +
                          "object-contain opacity-85 " +
                          (item.name === "OpenAI" ? "invert brightness-125 contrast-125" : "")
                        }
                        loading="lazy"
                        decoding="async"
                        referrerPolicy="no-referrer"
                        onError={(e) => {
                          if (item.fallbackLogoUrl && e.currentTarget.src !== item.fallbackLogoUrl) {
                            e.currentTarget.src = item.fallbackLogoUrl;
                          }
                        }}
                      />
                      {!item.hideTextLabel ? (
                        <span className="text-[1.1rem] tracking-[-0.01em] sm:text-[1.2rem]" style={{ color: item.accent }}>
                          {item.name}
                        </span>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>
        <section data-section="owner-questions-third" className="relative z-10 w-full pb-14 sm:pb-16 lg:pb-20">
          <div className="relative overflow-hidden rounded-[28px] border border-black/10 bg-white px-6 py-10 shadow-[0_28px_80px_-56px_rgba(0,0,0,0.24)] sm:px-8 sm:py-12 lg:px-10 lg:py-14">
            <div className="pointer-events-none absolute inset-0 opacity-[0.05] [background-image:radial-gradient(rgba(0,0,0,0.85)_0.8px,transparent_0.8px)] [background-size:14px_14px]" />
            <div className="relative mx-auto w-full max-w-6xl">
              <h3 className="mt-3 max-w-4xl text-3xl font-black leading-tight tracking-[-0.03em] text-[#0b1324] sm:text-4xl">
                Questions every careful business owner asks before spending money.
              </h3>
              <p className="mt-4 max-w-4xl text-lg font-semibold leading-relaxed text-slate-600 sm:text-xl">
                If you are skeptical, that is good. Here is the practical view: cost clarity, control, reliability, and measurable return.
              </p>

              <div className="mt-8 grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
                <div className="space-y-3">
                  {skepticFaqs.map((item, idx) => {
                    const open = idx === skepticOpenIdx;
                    return (
                      <div key={item.q} className="rounded-2xl border border-slate-200 bg-slate-50/80">
                        <button
                          type="button"
                          onClick={() => setSkepticOpenIdx(open ? -1 : idx)}
                          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                        >
                          <span className="text-sm font-black text-slate-900 sm:text-base">{item.q}</span>
                          <span className="text-lg font-black text-slate-500">{open ? "−" : "+"}</span>
                        </button>
                        {open ? <p className="border-t border-slate-200 px-4 py-3 text-sm font-semibold leading-relaxed text-slate-600 sm:text-base">{item.a}</p> : null}
                      </div>
                    );
                  })}
                </div>

                <div className="space-y-4">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50/90 p-4">
                    <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Quick ROI Reality Check</p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-3">
                      <label className="text-xs font-bold text-slate-600">
                        Missed calls/week
                        <input
                          type="number"
                          min="0"
                          value={roiMissedCalls}
                          onChange={(e) => setRoiMissedCalls(e.target.value)}
                          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm font-bold text-slate-900"
                        />
                      </label>
                      <label className="text-xs font-bold text-slate-600">
                        Close rate (%)
                        <input
                          type="number"
                          min="0"
                          max="100"
                          value={roiCloseRate}
                          onChange={(e) => setRoiCloseRate(e.target.value)}
                          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm font-bold text-slate-900"
                        />
                      </label>
                      <label className="text-xs font-bold text-slate-600">
                        Avg job value ($)
                        <input
                          type="number"
                          min="0"
                          value={roiJobValue}
                          onChange={(e) => setRoiJobValue(e.target.value)}
                          className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm font-bold text-slate-900"
                        />
                      </label>
                    </div>
                    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-black text-amber-900">
                      Potential monthly opportunity loss: ${monthlyOpportunityLoss.toLocaleString()}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50/90 p-4">
                    <p className="text-sm font-black uppercase tracking-[0.12em] text-slate-900">Risk Reversal</p>
                    <p className="mt-2 text-sm font-semibold leading-relaxed text-slate-600">
                      Start with one phone line and evaluate real calls before scaling. Keep control over tone, routing, and escalation from day one.
                    </p>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50/90 p-4">
                    <p className="text-sm font-black uppercase tracking-[0.12em] text-slate-900">Control & Safety</p>
                    <p className="mt-2 text-sm font-semibold leading-relaxed text-slate-600">
                      Script guardrails, transfer rules, and transcript logging are all visible so you can trust what happens on every call.
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => setDemoOpen(true)}
                      className="rounded-full bg-gradient-to-r from-cyan-500 via-blue-500 to-indigo-500 px-6 py-3 text-xs font-black uppercase tracking-[0.14em] text-white shadow-[0_18px_30px_-18px_rgba(59,130,246,0.6)] sm:text-sm"
                    >
                      Call The Demo
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        window.location.hash = "/signup";
                      }}
                      className="rounded-full border border-slate-300 bg-white px-6 py-3 text-xs font-black uppercase tracking-[0.14em] text-slate-900 shadow-[0_12px_24px_-18px_rgba(0,0,0,0.2)] sm:text-sm"
                    >
                      See Setup Flow
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
        <section ref={comparisonRef} className="relative z-10 w-full pb-14 sm:pb-16 lg:pb-20">
          <style>{`
            @keyframes whyGridShift {
              0% { transform: translateY(0px); }
              50% { transform: translateY(-6px); }
              100% { transform: translateY(0px); }
            }
            @keyframes compareGlow {
              0%, 100% { opacity: 0.35; }
              50% { opacity: 0.72; }
            }
          `}</style>
          <div className="relative overflow-hidden rounded-[34px] border border-sky-100/35 bg-[linear-gradient(180deg,#8fd5ef_0%,#7aa8e7_42%,#b194ef_100%)] px-6 py-12 sm:px-8 sm:py-14 lg:px-10 lg:py-16">
            <div className="pointer-events-none absolute inset-0 opacity-35 [background-image:linear-gradient(to_right,rgba(255,255,255,0.16)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.12)_1px,transparent_1px)] [background-size:68px_100%,100%_68px]" style={{ animation: "whyGridShift 8s ease-in-out infinite" }} />
            <div className="pointer-events-none absolute inset-x-0 top-0 h-[26%] bg-white/10" />
            <div className="pointer-events-none absolute left-[-8%] top-[18%] h-44 w-44 rounded-full bg-cyan-100/35 blur-3xl" />
            <div className="pointer-events-none absolute right-[-6%] bottom-[8%] h-52 w-52 rounded-full bg-indigo-200/35 blur-3xl" />

            <div className="relative mx-auto w-full max-w-6xl text-[#081223]">
              <p className="inline-flex rounded-full border border-[#0f203f]/15 bg-white/55 px-4 py-2 text-xs font-black uppercase tracking-[0.18em] text-[#11244a]">
                My AI PA vs Voicemail
              </p>
              <h2 className="mt-5 max-w-4xl text-4xl font-black leading-[1.02] tracking-[-0.04em] sm:text-5xl lg:text-[3.4rem]">
                See the difference between live AI call handling and traditional voicemail.
              </h2>
              <p className="mt-5 max-w-3xl text-base font-semibold leading-relaxed text-[#1a2b4f]/85 sm:text-lg">
                Voicemail stores messages. My AI PA qualifies leads, routes urgency, and helps your team respond faster.
              </p>

              <div className="relative mt-8 overflow-hidden rounded-[26px] border border-white/35 bg-[#0a1631]/70 backdrop-blur">
                <div
                  className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_72%_18%,rgba(70,170,255,0.28),rgba(70,170,255,0)_48%)]"
                  style={{ animation: "compareGlow 3.8s ease-in-out infinite" }}
                />

                <div className="relative hidden border-b border-white/15 md:grid md:grid-cols-[1.1fr_1fr_1fr]">
                  <div className="px-6 py-4 text-xs font-black uppercase tracking-[0.16em] text-slate-300/85">Comparison Point</div>
                  <div className="border-l border-white/10 bg-emerald-400/10 px-6 py-4 text-xs font-black uppercase tracking-[0.16em] text-emerald-200">
                    My AI PA
                  </div>
                  <div className="border-l border-white/10 px-6 py-4 text-xs font-black uppercase tracking-[0.16em] text-slate-300/85">Voicemail</div>
                </div>

                <div className="relative space-y-3 p-3 sm:p-4">
                  {[
                    {
                      label: "Response when a customer calls",
                      ai: "Answers in seconds with a professional greeting, 24/7.",
                      vm: "Plays a recording and asks the caller to leave a message.",
                    },
                    {
                      label: "Lead qualification quality",
                      ai: "Captures service type, urgency, and callback details in a structured format.",
                      vm: "Caller leaves an unstructured message, often missing key details.",
                    },
                    {
                      label: "Owner follow-up speed",
                      ai: "Sends callback-ready SMS summaries right after each call.",
                      vm: "Team must listen, decode, and sort messages before responding.",
                    },
                    {
                      label: "Escalation & live handoff",
                      ai: "Can transfer urgent or complex calls to your team using your rules.",
                      vm: "No live triage or transfer path from the voicemail prompt.",
                    },
                    {
                      label: "Risk to get started",
                      ai: "14-day free trial, no credit card required, cancel anytime.",
                      vm: "No trial decision needed, but missed-call loss continues unchanged.",
                    },
                    {
                      label: "Visibility & optimization",
                      ai: "Transcript and call data show what to improve and where leads are lost.",
                      vm: "Limited insight beyond raw audio messages.",
                    },
                  ].map((item) => (
                    <div
                      key={item.label}
                      className="overflow-hidden rounded-2xl border border-white/12 bg-white/[0.04] shadow-[0_18px_36px_-26px_rgba(4,9,22,0.85)]"
                    >
                      <div className="grid gap-3 p-4 md:grid-cols-[1.1fr_1fr_1fr] md:items-center md:gap-0 md:p-0">
                        <div className="md:px-6 md:py-4">
                          <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-300/70 md:hidden">Comparison Point</p>
                          <p className="mt-1 text-base font-black text-white md:mt-0">{item.label}</p>
                        </div>
                        <div className="rounded-xl border border-emerald-300/22 bg-emerald-400/10 p-3 md:rounded-none md:border-y-0 md:border-l md:border-r md:border-white/10 md:bg-emerald-400/8 md:px-6 md:py-4">
                          <p className="text-[10px] font-black uppercase tracking-[0.14em] text-emerald-200/90 md:hidden">My AI PA</p>
                          <p className="mt-1 text-sm font-semibold leading-relaxed text-emerald-100 md:mt-0 md:text-[0.95rem]">{item.ai}</p>
                        </div>
                        <div className="md:px-6 md:py-4">
                          <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-300/70 md:hidden">Voicemail</p>
                          <p className="mt-1 text-sm font-semibold leading-relaxed text-slate-200/90 md:mt-0 md:text-[0.95rem]">{item.vm}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>
        <section className="relative z-10 w-full pb-14 sm:pb-16 lg:pb-20">
          <div className="relative overflow-hidden rounded-[26px] border border-cyan-200/35 bg-[linear-gradient(120deg,#0c1c3b_0%,#10234a_45%,#0f2a54_100%)] px-6 py-8 shadow-[0_35px_80px_-55px_rgba(14,30,68,0.85)] sm:px-8 sm:py-10">
            <div className="pointer-events-none absolute inset-0 opacity-[0.08] [background-image:linear-gradient(to_right,rgba(255,255,255,0.7)_1px,transparent_1px)] [background-size:72px_100%]" />
            <div className="relative mx-auto flex w-full max-w-6xl flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
              <div className="max-w-3xl">
                <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-100/75">Risk Reversal</p>
                <h3 className="mt-2 text-2xl font-black leading-tight tracking-[-0.02em] text-white sm:text-3xl">
                  Start with a 14-day free trial before committing long term.
                </h3>
                <p className="mt-3 text-base font-semibold leading-relaxed text-cyan-100/80 sm:text-lg">
                  No obligations, easy cancellation after 14 days. No credit card required.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => setDemoOpen(true)}
                  className="rounded-full bg-gradient-to-r from-cyan-500 via-blue-500 to-indigo-500 px-7 py-3 text-xs font-black uppercase tracking-[0.14em] text-white shadow-[0_20px_34px_-18px_rgba(59,130,246,0.65)] sm:text-sm"
                >
                  Call The Demo
                </button>
                <button
                  type="button"
                  onClick={() => {
                    window.location.hash = "/signup";
                  }}
                  className="rounded-full border border-cyan-200/40 bg-white/10 px-7 py-3 text-xs font-black uppercase tracking-[0.14em] text-white sm:text-sm"
                >
                  See Setup Flow
                </button>
              </div>
            </div>
          </div>
        </section>
        <section ref={pricingRef} className="relative z-10 w-full pb-14 sm:pb-16 lg:pb-20">
          <div className="relative overflow-hidden rounded-[28px] border border-black/10 bg-white px-6 py-10 shadow-[0_28px_80px_-56px_rgba(0,0,0,0.24)] sm:px-8 sm:py-12 lg:px-10 lg:py-14">
            <div className="pointer-events-none absolute inset-0 opacity-[0.05] [background-image:radial-gradient(rgba(0,0,0,0.85)_0.8px,transparent_0.8px)] [background-size:14px_14px]" />
            <div className="relative mx-auto w-full max-w-6xl">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">Pricing Preview</p>
              <h3 className="mt-3 max-w-4xl text-3xl font-black leading-tight tracking-[-0.03em] text-[#0b1324] sm:text-4xl">
                Clear plans so owners can decide fast.
              </h3>
              <p className="mt-4 max-w-4xl text-lg font-semibold leading-relaxed text-slate-600 sm:text-xl">
                Start small, prove value with real calls, then scale when the results are obvious.
              </p>

              <div className="mt-8 grid gap-4 md:grid-cols-2">
                {[
                  {
                    name: "Light Version",
                    price: "$19.99/mo",
                    subtitle: "Available now",
                    points: ["Live call answering", "Lead summary SMS to owner", "Basic FAQs", "Great for getting started quickly"],
                    featured: true,
                  },
                  {
                    name: "Premium",
                    price: "$29.99/mo",
                    subtitle: "Coming soon",
                    points: ["Advanced call routing", "Priority lead tagging + urgency", "Expanded FAQ + script controls", "Enhanced owner notifications"],
                    comingSoon: true,
                  },
                ].map((plan) => (
                  <div
                    key={plan.name}
                    className={
                      "rounded-2xl border p-5 " +
                      (plan.comingSoon
                        ? "border-dashed border-slate-300 bg-slate-100/75"
                        : plan.featured
                        ? "border-cyan-300 bg-cyan-50/70 shadow-[0_24px_45px_-34px_rgba(59,130,246,0.45)]"
                        : "border-slate-200 bg-slate-50/80")
                    }
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-black uppercase tracking-[0.14em] text-slate-900">{plan.name}</p>
                        <p className="mt-1 text-sm font-semibold text-slate-500">{plan.subtitle}</p>
                      </div>
                      {plan.featured ? <span className="rounded-full bg-cyan-500 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-white">Live Now</span> : null}
                      {plan.comingSoon ? <span className="rounded-full border border-slate-400 bg-slate-200 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-slate-700">Coming Soon</span> : null}
                    </div>
                    <p className="mt-5 text-4xl font-black tracking-[-0.03em] text-[#0b1324]">{plan.price}</p>
                    <p className="mt-1 text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
                      {plan.comingSoon ? "premium package preview" : "No obligations. No credit card required."}
                    </p>
                    <div className="mt-5 space-y-2">
                      {plan.points.map((point) => (
                        <p key={point} className="text-sm font-semibold text-slate-700">
                          {point}
                        </p>
                      ))}
                    </div>
                    {!plan.comingSoon ? (
                      <button
                        type="button"
                        onClick={() => {
                          window.location.hash = "/signup";
                        }}
                        className="mt-5 rounded-full bg-gradient-to-r from-cyan-500 via-blue-500 to-indigo-500 px-5 py-2.5 text-xs font-black uppercase tracking-[0.14em] text-white shadow-[0_16px_28px_-18px_rgba(59,130,246,0.6)] sm:text-sm"
                      >
                        Start Free Trial for Light Version
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
              <p className="mt-5 text-sm font-semibold text-slate-500">
                Current live package is $19.99/month. Premium package at $29.99/month is coming soon.
              </p>
            </div>
          </div>
        </section>
        <section ref={proofRef} className="relative z-10 w-full pb-14 sm:pb-16 lg:pb-20">
          <div className="relative overflow-hidden rounded-[28px] border border-black/10 bg-white px-6 py-10 shadow-[0_28px_80px_-56px_rgba(0,0,0,0.24)] sm:px-8 sm:py-12 lg:px-10 lg:py-14">
            <div className="pointer-events-none absolute inset-0 opacity-[0.05] [background-image:radial-gradient(rgba(0,0,0,0.85)_0.8px,transparent_0.8px)] [background-size:14px_14px]" />
            <div className="relative mx-auto w-full max-w-6xl">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">Proof</p>
              <h3 className="mt-3 max-w-4xl text-3xl font-black leading-tight tracking-[-0.03em] text-[#0b1324] sm:text-4xl">
                Real owner concerns answered with practical proof.
              </h3>

              <div className="mt-8 grid gap-4 lg:grid-cols-[1.2fr_0.8fr_0.8fr]">
                <div className="rounded-2xl border border-slate-200 bg-slate-50/85 p-5">
                  <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Customer Testimonial</p>
                  <p className="mt-4 text-lg font-bold leading-relaxed text-slate-800">
                    "Before My AI PA, evening rental inquiries kept going to voicemail. Now callers get an immediate response, and we get clean lead details by text so follow-up is faster the next morning."
                  </p>
                  <p className="mt-4 text-sm font-black text-slate-900">David A, First Class Rentals, St. Catharines</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50/85 p-5">
                  <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Customer Testimonial</p>
                  <p className="mt-3 text-sm font-semibold leading-relaxed text-slate-700">
                    "I am often in treatment sessions and cannot stop to answer the phone. My AI PA greets callers professionally, gathers the reason for the call, and texts me clear notes so I can return calls between clients."
                  </p>
                  <p className="mt-4 text-sm font-black text-slate-900">Lisa P, Occupational Therapist</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50/85 p-5">
                  <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Customer Testimonial</p>
                  <p className="mt-3 text-sm font-semibold leading-relaxed text-slate-700">
                    "When I am on-site doing carpentry work, I miss calls. My AI PA now screens and captures serious leads, records urgency, and sends me callback-ready details so I can quote faster and stop losing jobs to voicemail."
                  </p>
                  <p className="mt-4 text-sm font-black text-slate-900">Mark S, Carpentry Contractor</p>
                </div>
              </div>
            </div>
          </div>
        </section>
        <section ref={complianceRef} className="relative z-10 w-full pb-14 sm:pb-16 lg:pb-20">
          <div className="relative overflow-hidden rounded-[28px] border border-cyan-200/35 bg-[linear-gradient(130deg,#0a1630_0%,#0f2547_52%,#103253_100%)] px-6 py-9 shadow-[0_32px_80px_-58px_rgba(8,20,44,0.95)] sm:px-8 sm:py-11 lg:px-10 lg:py-12">
            <div className="pointer-events-none absolute inset-0 opacity-[0.08] [background-image:linear-gradient(to_right,rgba(255,255,255,0.8)_1px,transparent_1px)] [background-size:72px_100%]" />
            <div className="pointer-events-none absolute inset-0 opacity-[0.06] [background-image:radial-gradient(rgba(255,255,255,0.95)_0.8px,transparent_0.8px)] [background-size:16px_16px]" />
            <div className="relative mx-auto w-full max-w-6xl">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-100/75">Canadian Security & Privacy</p>
              <h3 className="mt-3 max-w-4xl text-3xl font-black leading-tight tracking-[-0.03em] text-white sm:text-4xl">
                Built with Canadian privacy requirements in mind.
              </h3>
              <p className="mt-4 max-w-4xl text-base font-semibold leading-relaxed text-cyan-100/80 sm:text-lg">
                My AI PA is designed to support{" "}
                <span className="font-black text-cyan-100">PIPEDA (Personal Information Protection and Electronic Documents Act)</span>,{" "}
                CASL messaging controls, and provincial privacy expectations such as Québec Law 25 and BC/Alberta PIPA.
              </p>

              <div className="mt-5 flex flex-wrap gap-2">
                {[
                  { label: "PIPEDA", note: "Federal private-sector privacy law" },
                  { label: "CASL", note: "Commercial electronic message rules" },
                  { label: "Québec Law 25", note: "Modernized privacy obligations" },
                  { label: "BC/AB PIPA", note: "Provincial private-sector privacy" },
                  { label: "PHIPA-ready", note: "Healthcare workflow controls" },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="inline-flex items-center gap-2 rounded-full border border-cyan-200/30 bg-cyan-200/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.12em] text-cyan-50 sm:text-xs"
                    title={item.note}
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-cyan-200" />
                    {item.label}
                  </div>
                ))}
              </div>

              <div className="mt-8">
                <div className="grid gap-4 md:grid-cols-2">
                  {[
                    {
                      icon: "faq",
                      title: "PIPEDA-aligned data handling",
                      body: "Encryption in transit and at rest, least-privilege access, and configurable retention windows for operational records.",
                    },
                    {
                      icon: "text",
                      title: "CASL-aware messaging controls",
                      body: "Owner and caller SMS workflows can include consent language, opt-out handling, and delivery traceability.",
                    },
                    {
                      icon: "callback",
                      title: "Audit-ready activity trail",
                      body: "Call transcripts, lead capture actions, and admin changes are logged for review and operational accountability.",
                    },
                    {
                      icon: "filter",
                      title: "Role-based admin controls",
                      body: "Permission tiers keep sensitive lead and transcript access limited to authorized staff members.",
                    },
                    {
                      icon: "growth",
                      title: "Reliability and fallback paths",
                      body: "Configurable escalation and backup routing help prevent dropped opportunities during busy periods.",
                    },
                    {
                      icon: "bell",
                      title: "Incident visibility and alerts",
                      body: "Operational notifications and review workflows help teams respond quickly to exceptions or delivery issues.",
                    },
                  ].map((item) => (
                    <div key={item.title} className="rounded-2xl border border-white/12 bg-white/[0.08] p-4 shadow-[0_18px_36px_-28px_rgba(3,8,20,0.95)]">
                      <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-200/35 bg-cyan-300/14 text-cyan-100">
                        {renderHeroHighlightIcon(item.icon)}
                      </div>
                      <p className="mt-3 text-sm font-black uppercase tracking-[0.12em] text-white">{item.title}</p>
                      <p className="mt-2 text-sm font-semibold leading-relaxed text-cyan-100/75">{item.body}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-6 rounded-2xl border border-cyan-200/25 bg-cyan-200/10 px-4 py-3 text-sm font-semibold leading-relaxed text-cyan-50/95">
                Compliance note: these controls are built to support Canadian privacy obligations. Final legal compliance depends on your configured workflows, policies, and legal review.
              </div>
            </div>
          </div>
        </section>
        <section ref={industryRef} className="relative z-10 w-full pb-14 sm:pb-16 lg:pb-20">
          <style>{`
            @keyframes industryTickerRight {
              0% { transform: translateX(-50%); }
              100% { transform: translateX(0%); }
            }
          `}</style>
          <div className="relative overflow-hidden rounded-[28px] border border-black/10 bg-white px-6 py-10 shadow-[0_28px_80px_-56px_rgba(0,0,0,0.24)] sm:px-8 sm:py-12 lg:px-10 lg:py-14">
            <div className="pointer-events-none absolute inset-0 opacity-[0.05] [background-image:radial-gradient(rgba(0,0,0,0.85)_0.8px,transparent_0.8px)] [background-size:14px_14px]" />
            <div className="relative mx-auto w-full max-w-6xl">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">By Industry</p>
              <h3 className="mt-3 max-w-4xl text-3xl font-black leading-tight tracking-[-0.03em] text-[#0b1324] sm:text-4xl">
                Built for service businesses that cannot afford missed calls.
              </h3>
              <p className="mt-4 max-w-3xl text-base font-semibold leading-relaxed text-slate-600 sm:text-lg">
                Potential business types that use My AI PA, scrolling live from left to right.
              </p>

              <div className="mt-8 overflow-hidden rounded-3xl border border-slate-200 bg-slate-50/70 p-3 sm:p-4">
                <div
                  className="flex w-max items-stretch gap-4"
                  style={{ animation: "industryTickerRight 46s linear infinite" }}
                >
                  {industryScrollerItems.concat(industryScrollerItems).map((item, idx) => (
                    <div key={`${item.name}-${idx}`} className="w-[260px] shrink-0 rounded-2xl border border-slate-200 bg-white/90 p-5 sm:w-[300px]">
                      <div className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-cyan-100 text-lg text-cyan-700">{item.icon}</div>
                      <p className="mt-3 text-lg font-black text-slate-900">{item.name}</p>
                      <p className="mt-2 text-sm font-semibold leading-relaxed text-slate-600">{item.body}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>
        <section ref={callFlowRef} className="relative z-10 w-full pb-14 sm:pb-16 lg:pb-20">
          <div className="relative overflow-hidden rounded-[28px] border border-black/10 bg-white px-6 py-10 shadow-[0_28px_80px_-56px_rgba(0,0,0,0.24)] sm:px-8 sm:py-12 lg:px-10 lg:py-14">
            <div className="pointer-events-none absolute inset-0 opacity-[0.05] [background-image:radial-gradient(rgba(0,0,0,0.85)_0.8px,transparent_0.8px)] [background-size:14px_14px]" />
            <div className="relative mx-auto w-full max-w-6xl">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">How It Works</p>
              <h3 className="mt-3 max-w-3xl text-3xl font-black leading-tight tracking-[-0.03em] text-[#0b1324] sm:text-4xl">
                From incoming call to owner follow-up in four clear steps.
              </h3>
              <p className="mt-4 max-w-3xl text-lg font-semibold leading-relaxed text-slate-600 sm:text-xl">
                My AI PA answers immediately, handles the conversation professionally, captures key details, and sends a summary so you can call back fast.
              </p>

              <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                {[
                  {
                    title: "1. Customer calls",
                    body: "Your business line rings and My AI PA picks up quickly so opportunities are not missed.",
                    icon: "📞",
                    iconTone: "bg-cyan-100 text-cyan-700",
                  },
                  {
                    title: "2. AI assistant answers",
                    body: "It greets the caller, asks qualifying questions, and handles common FAQs in a natural tone.",
                    icon: "🤝",
                    iconTone: "bg-blue-100 text-blue-700",
                  },
                  {
                    title: "3. Lead details captured",
                    body: "Intent, urgency, and callback details are structured automatically during the call.",
                    icon: "🧾",
                    iconTone: "bg-indigo-100 text-indigo-700",
                  },
                  {
                    title: "4. Instant owner text",
                    body: "A concise summary is texted to you so you can prioritize and return the call confidently.",
                    icon: "💬",
                    iconTone: "bg-emerald-100 text-emerald-700",
                  },
                ].map((step) => (
                  <div key={step.title} className="rounded-2xl border border-slate-200 bg-slate-50/80 p-5">
                    <div className="mb-3 flex items-center gap-2">
                      <span className={`inline-flex h-8 w-8 items-center justify-center rounded-xl text-lg ${step.iconTone}`}>{step.icon}</span>
                      <span className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Step</span>
                    </div>
                    <p className="text-sm font-black uppercase tracking-[0.12em] text-slate-900">{step.title}</p>
                    <p className="mt-3 text-sm font-semibold leading-relaxed text-slate-600 sm:text-base">{step.body}</p>
                  </div>
                ))}
              </div>

              <div className="mt-8">
                <button
                  type="button"
                  onClick={() => {
                    setDemoOpen(true);
                  }}
                  className="rounded-full bg-gradient-to-r from-cyan-500 via-blue-500 to-indigo-500 px-8 py-4 text-sm font-black uppercase tracking-[0.14em] text-white shadow-[0_20px_34px_-18px_rgba(59,130,246,0.6)] sm:text-base"
                >
                  Call The Demo
                </button>
              </div>
            </div>
          </div>
        </section>
        <section ref={setupSectionRef} className="relative z-10 w-full pb-14 sm:pb-16 lg:pb-20">
          <div className="relative overflow-hidden rounded-[28px] border border-black/10 bg-white px-6 py-10 shadow-[0_28px_80px_-56px_rgba(0,0,0,0.28)] sm:px-8 sm:py-12 lg:px-10 lg:py-14">
            <div className="pointer-events-none absolute inset-0 opacity-[0.05] [background-image:radial-gradient(rgba(0,0,0,0.85)_0.8px,transparent_0.8px)] [background-size:14px_14px]" />
            <div className="relative mx-auto w-full max-w-6xl">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">Setup Flow</p>
              <h3 className="mt-3 max-w-3xl text-3xl font-black leading-tight tracking-[-0.03em] text-[#0b1324] sm:text-4xl">
                How to get My AI PA live in a few guided steps.
              </h3>
              <p className="mt-4 max-w-3xl text-lg font-semibold leading-relaxed text-slate-600 sm:text-xl">
                Search your business profile, confirm call-handling preferences, and publish your assistant so it can start answering calls.
              </p>

              <div className="mt-8 grid gap-4 md:grid-cols-3">
                {[
                  {
                    title: "1. Find your business",
                    body: "Use Google Business Profile or enter your business details manually to get started quickly.",
                    icon: "🏢",
                    iconTone: "bg-cyan-100 text-cyan-700",
                  },
                  {
                    title: "2. Configure call behavior",
                    body: "Set greeting tone, FAQ behavior, escalation rules, and where callback details should be delivered.",
                    icon: "🎛",
                    iconTone: "bg-indigo-100 text-indigo-700",
                  },
                  {
                    title: "3. Go live",
                    body: "Publish the setup and test one call to confirm transcript quality, lead capture, and text delivery.",
                    icon: "🚀",
                    iconTone: "bg-emerald-100 text-emerald-700",
                  },
                ].map((step) => (
                  <div key={step.title} className="rounded-2xl border border-slate-200 bg-slate-50/80 p-5">
                    <div className="mb-3 flex items-center gap-2">
                      <span className={`inline-flex h-8 w-8 items-center justify-center rounded-xl text-lg ${step.iconTone}`}>{step.icon}</span>
                      <span className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Step</span>
                    </div>
                    <p className="text-sm font-black uppercase tracking-[0.12em] text-slate-900">{step.title}</p>
                    <p className="mt-3 text-sm font-semibold leading-relaxed text-slate-600 sm:text-base">{step.body}</p>
                  </div>
                ))}
              </div>

              <div className="mt-8">
                <button
                  type="button"
                  onClick={() => {
                    window.location.hash = "/signup";
                  }}
                  className="rounded-full border border-slate-300 bg-white px-8 py-4 text-sm font-black uppercase tracking-[0.14em] text-slate-900 shadow-[0_12px_24px_-18px_rgba(0,0,0,0.2)] sm:text-base"
                >
                  See Setup Flow
                </button>
              </div>
            </div>
          </div>
        </section>
        <section className="relative z-10 w-full pb-14 sm:pb-16 lg:pb-20">
          <div className="relative overflow-hidden rounded-[28px] border border-black/10 bg-white px-6 py-10 shadow-[0_28px_80px_-56px_rgba(0,0,0,0.24)] sm:px-8 sm:py-12 lg:px-10 lg:py-14">
            <div className="pointer-events-none absolute inset-0 opacity-[0.05] [background-image:radial-gradient(rgba(0,0,0,0.85)_0.8px,transparent_0.8px)] [background-size:14px_14px]" />
            <div className="relative mx-auto flex w-full max-w-6xl flex-col items-start justify-between gap-6 lg:flex-row lg:items-center">
              <div>
                <h3 className="max-w-3xl text-3xl font-black leading-tight tracking-[-0.03em] text-[#0b1324] sm:text-4xl">
                  Wait are you waiting for
                </h3>
                <p className="mt-3 max-w-2xl text-base font-semibold leading-relaxed text-slate-600 sm:text-lg">
                  Run one call demo first, then launch when you are confident with the script and lead capture.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => setDemoOpen(true)}
                  className="rounded-full bg-gradient-to-r from-cyan-500 via-blue-500 to-indigo-500 px-8 py-4 text-sm font-black uppercase tracking-[0.14em] text-white shadow-[0_20px_34px_-18px_rgba(59,130,246,0.6)] sm:text-base"
                >
                  Call The Demo
                </button>
                <button
                  type="button"
                  onClick={() => {
                    window.location.hash = "/signup";
                  }}
                  className="rounded-full border border-slate-300 bg-white px-8 py-4 text-sm font-black uppercase tracking-[0.14em] text-slate-900 shadow-[0_12px_24px_-18px_rgba(0,0,0,0.2)] sm:text-base"
                >
                  See Setup Flow
                </button>
              </div>
            </div>
          </div>
        </section>
        <footer className="relative z-10 w-full pb-10">
          <div className="mx-auto w-full max-w-6xl border-t border-slate-200/90 pt-5">
            <div className="flex flex-col gap-3 text-sm font-semibold text-slate-500 sm:flex-row sm:items-center sm:justify-between">
              <p>© MyAIPA All rights reserved. Made in Canada</p>
              <div className="flex items-center gap-6">
                <a href="#/privacy" className="transition hover:text-slate-700">
                  Privacy Policy
                </a>
                <a href="#/terms" className="transition hover:text-slate-700">
                  Terms of Service
                </a>
              </div>
            </div>
          </div>
        </footer>
        {!chatOpen ? (
          <button
            type="button"
            onClick={() => setChatOpen(true)}
            className="fixed bottom-5 right-5 z-40 rounded-full bg-gradient-to-r from-emerald-700 to-amber-500 px-5 py-3 text-sm font-black uppercase tracking-[0.14em] text-white shadow-[0_25px_45px_-20px_rgba(0,0,0,0.65)]"
          >
            Chat
          </button>
        ) : null}
        {chatOpen ? (
          <ConciergeWidget
            sections={sections}
            mode="floating"
            onClose={() => setChatOpen(false)}
            onFocusChange={(section, meta) => {
              applyAgentFocus(sectionById[section.id] || section, meta);
            }}
          />
        ) : null}
        {false ? <AiOpsPanel callFlowRef={callFlowRef} toolsRef={toolsRef} dataRef={dataRef} floating /> : null}
        <DemoModal
          open={demoOpen}
          onClose={() => setDemoOpen(false)}
          onStartSetup={() => {
            setDemoOpen(false);
            window.location.hash = "/signup";
          }}
        />
      </div>
    </main>
  );
}
