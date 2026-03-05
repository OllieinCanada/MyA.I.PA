import React from "react";

const MAX_VISIBLE_MESSAGES = 10;
const MAX_INPUT_CHARS = 2000;
const API_BASE =
  process.env.REACT_APP_API_BASE_URL ||
  (typeof window !== "undefined" && /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname)
    ? "http://localhost:8787"
    : "");

function getStatusClasses(status) {
  if (status === "Listening") return "bg-emerald-500/20 text-emerald-200 border-emerald-400/40";
  if (status === "Thinking") return "bg-amber-500/20 text-amber-100 border-amber-300/40";
  if (status === "Speaking") return "bg-sky-500/20 text-sky-100 border-sky-300/40";
  return "bg-white/5 text-white/80 border-white/10";
}

function AudioWave({ active = false, tone = "speaking" }) {
  const barColor =
    tone === "listening"
      ? "bg-emerald-300/90"
      : "bg-sky-300/90";

  return (
    <div className="inline-flex items-end gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-1">
      {[0, 1, 2, 3, 4].map((idx) => (
        <span
          key={idx}
          className={
            `inline-block w-1 rounded-full ${barColor} transition-all duration-300 ` +
            (active ? "animate-pulse" : "opacity-40")
          }
          style={{
            height: active ? `${8 + ((idx % 3) + 1) * 4}px` : "6px",
            animationDelay: `${idx * 120}ms`,
          }}
        />
      ))}
    </div>
  );
}

async function parseApiResponse(response, fallbackLabel) {
  const rawText = await response.text();
  let data = {};
  try {
    data = rawText ? JSON.parse(rawText) : {};
  } catch (_err) {
    data = {};
  }

  if (!response.ok) {
    const readableText =
      data?.error ||
      (rawText && !rawText.trim().startsWith("<") ? rawText.trim() : "") ||
      `${fallbackLabel} (${response.status})`;
    throw new Error(readableText);
  }

  return data;
}

export default function VoiceAssistant({ placement = "bottom-right" }) {
  const [messages, setMessages] = React.useState([
    {
      id: 1,
      role: "assistant",
      content: "Hi, I’m My AI PA. Tell me what you need and I’ll help one step at a time.",
    },
  ]);
  const [input, setInput] = React.useState("");
  const [status, setStatus] = React.useState("Idle");
  const [autoSpeak, setAutoSpeak] = React.useState(true);
  const [micSupported, setMicSupported] = React.useState(false);
  const [micMode, setMicMode] = React.useState("none"); // speech-recognition | media-recorder | none
  const [isListening, setIsListening] = React.useState(false);
  const [isSending, setIsSending] = React.useState(false);
  const [isTranscribing, setIsTranscribing] = React.useState(false);
  const [micError, setMicError] = React.useState("");
  const recognitionRef = React.useRef(null);
  const mediaRecorderRef = React.useRef(null);
  const mediaStreamRef = React.useRef(null);
  const mediaChunksRef = React.useRef([]);
  const speechUtteranceRef = React.useRef(null);
  const nextIdRef = React.useRef(2);
  const chatLogRef = React.useRef(null);
  const unmountedRef = React.useRef(false);
  const latestPageFocusRef = React.useRef(null);

  const appendMessage = React.useCallback((role, content, meta = {}) => {
    const next = {
      id: nextIdRef.current,
      role,
      content,
      ...meta,
    };
    nextIdRef.current += 1;
    setMessages((prev) => [...prev, next]);
    return next;
  }, []);

  const syncWebsiteFocus = React.useCallback((query) => {
    if (typeof window === "undefined") return;
    const clean = String(query || "").trim();
    if (!clean) return;
    window.dispatchEvent(
      new CustomEvent("myaipa:voice-query", {
        detail: {
          query: clean,
          source: "voice-assistant",
        },
      })
    );
  }, []);

  React.useEffect(() => {
    const SpeechRecognitionCtor =
      window.SpeechRecognition || window.webkitSpeechRecognition || null;
    const canRecordFallback =
      typeof window.MediaRecorder !== "undefined" &&
      !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

    if (!SpeechRecognitionCtor) {
      if (canRecordFallback) {
        setMicSupported(true);
        setMicMode("media-recorder");
      } else {
        setMicSupported(false);
        setMicMode("none");
      }
      return undefined;
    }

    setMicSupported(true);
    setMicMode("speech-recognition");

    const recognition = new SpeechRecognitionCtor();
    recognition.lang = "en-US";
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      if (unmountedRef.current) return;
      setMicError("");
      setIsListening(true);
      setStatus("Listening");
    };

    recognition.onerror = (event) => {
      if (unmountedRef.current) return;
      setMicError(event?.error ? `Mic error: ${event.error}` : "Mic error");
      setIsListening(false);
      setStatus((prev) => (prev === "Listening" ? "Idle" : prev));
    };

    recognition.onend = () => {
      if (unmountedRef.current) return;
      setIsListening(false);
      setStatus((prev) => (prev === "Listening" ? "Idle" : prev));
    };

    recognition.onresult = (event) => {
      let finalText = "";
      let interimText = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const transcript = event.results[i][0]?.transcript || "";
        if (event.results[i].isFinal) finalText += transcript;
        else interimText += transcript;
      }
      if (finalText.trim()) setInput(finalText.trim());
      else if (interimText.trim()) setInput(interimText.trim());
    };

    recognitionRef.current = recognition;

    return () => {
      recognition.onstart = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.onresult = null;
      recognitionRef.current = null;
    };
  }, []);

  React.useEffect(() => {
    const handleFocusResult = (event) => {
      latestPageFocusRef.current = {
        query: String(event?.detail?.query || "").trim().toLowerCase(),
        sectionId: String(event?.detail?.sectionId || ""),
        title: String(event?.detail?.title || ""),
        summary: String(event?.detail?.summary || ""),
        ts: Date.now(),
      };
    };
    window.addEventListener("myaipa:voice-focus-result", handleFocusResult);
    return () => window.removeEventListener("myaipa:voice-focus-result", handleFocusResult);
  }, []);

  React.useEffect(() => {
    const el = chatLogRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  React.useEffect(() => {
    return () => {
      unmountedRef.current = true;
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (_err) {
          // no-op
        }
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        try {
          mediaRecorderRef.current.stop();
        } catch (_err) {
          // no-op
        }
      }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
      }
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const stopSpeaking = React.useCallback(() => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    speechUtteranceRef.current = null;
    setStatus((prev) => (prev === "Speaking" ? (isListening ? "Listening" : "Idle") : prev));
  }, [isListening]);

  const speakText = React.useCallback(
    (text) => {
      if (!autoSpeak || !window.speechSynthesis || !text) return;
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1;
      utterance.pitch = 1;
      utterance.onstart = () => {
        if (!unmountedRef.current) setStatus("Speaking");
      };
      const handleEnd = () => {
        if (unmountedRef.current) return;
        speechUtteranceRef.current = null;
        setStatus((prev) => (prev === "Speaking" ? (isListening ? "Listening" : "Idle") : prev));
      };
      utterance.onend = handleEnd;
      utterance.onerror = handleEnd;
      speechUtteranceRef.current = utterance;
      window.speechSynthesis.speak(utterance);
    },
    [autoSpeak, isListening]
  );

  const transcribeAudioBlob = React.useCallback(async (blob) => {
    const audioBase64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(typeof reader.result === "string" ? reader.result : "");
      reader.onerror = () => reject(new Error("Unable to read recorded audio."));
      reader.readAsDataURL(blob);
    });

    const response = await fetch(`${API_BASE}/api/assistant/transcribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        audioBase64,
        mimeType: blob.type || "audio/webm",
      }),
    });

    const data = await parseApiResponse(response, "Transcription failed");
    const transcript = typeof data.transcript === "string" ? data.transcript.trim() : "";
    if (!transcript) throw new Error("Transcription returned empty text.");
    return transcript;
  }, []);

  const sendMessage = React.useCallback(
    async (overrideMessage) => {
      const message =
        typeof overrideMessage === "string" ? overrideMessage.trim() : input.trim();
      if (!message || isSending) return;

      if (message.length > MAX_INPUT_CHARS) {
        appendMessage("assistant", `Please keep messages under ${MAX_INPUT_CHARS} characters.`, {
          isError: true,
        });
        return;
      }

      stopSpeaking();
      setMicError("");
      setInput("");
      appendMessage("user", message);
      syncWebsiteFocus(message);
      const pageFocus = latestPageFocusRef.current;
      if (
        pageFocus &&
        pageFocus.query === message.toLowerCase() &&
        Date.now() - pageFocus.ts < 3000 &&
        pageFocus.summary
      ) {
        appendMessage(
          "assistant",
          `I pulled up the ${pageFocus.title} section on the left: ${pageFocus.summary}`,
          { isPageContext: true }
        );
      }
      setIsSending(true);
      setStatus("Thinking");

      try {
        const response = await fetch(`${API_BASE}/api/assistant`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message }),
        });
        const data = await parseApiResponse(response, "Assistant request failed");
        const reply = typeof data.reply === "string" ? data.reply.trim() : "";
        if (!reply) throw new Error("Assistant returned an empty reply.");
        appendMessage("assistant", reply);
        speakText(reply);
      } catch (err) {
        appendMessage("assistant", err?.message || "Something went wrong. Please try again.", {
          isError: true,
        });
        setStatus(isListening ? "Listening" : "Idle");
      } finally {
        setIsSending(false);
        setStatus((prev) => (prev === "Thinking" ? (isListening ? "Listening" : "Idle") : prev));
      }
    },
    [appendMessage, input, isListening, isSending, speakText, stopSpeaking, syncWebsiteFocus]
  );

  const handleKeyDown = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  };

  const startRecorderFlow = React.useCallback(async () => {
    stopSpeaking();
    setMicError("");
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaStreamRef.current = stream;
    mediaChunksRef.current = [];

    const preferredType =
      window.MediaRecorder?.isTypeSupported?.("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : window.MediaRecorder?.isTypeSupported?.("audio/ogg;codecs=opus")
          ? "audio/ogg;codecs=opus"
          : "";
    const recorder = preferredType ? new MediaRecorder(stream, { mimeType: preferredType }) : new MediaRecorder(stream);
    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        mediaChunksRef.current.push(event.data);
      }
    };
    recorder.onerror = (event) => {
      setMicError(event?.error?.message || "Recording error");
      setIsListening(false);
      setStatus("Idle");
    };
    recorder.onstart = () => {
      setIsListening(true);
      setStatus("Listening");
    };
    recorder.onstop = async () => {
      const chunks = mediaChunksRef.current.slice();
      mediaChunksRef.current = [];
      setIsListening(false);
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
      }
      if (!chunks.length) {
        setStatus("Idle");
        setMicError("No audio recorded. Please try again.");
        return;
      }

      try {
        setIsTranscribing(true);
        setStatus("Thinking");
        const audioBlob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        const transcript = await transcribeAudioBlob(audioBlob);
        setInput(transcript);
        await sendMessage(transcript);
      } catch (err) {
        setMicError(err?.message || "Unable to transcribe audio");
        setStatus("Idle");
      } finally {
        setIsTranscribing(false);
        setStatus((prev) => (prev === "Thinking" ? "Idle" : prev));
      }
    };

    recorder.start();
  }, [sendMessage, stopSpeaking, transcribeAudioBlob]);

  const toggleListening = () => {
    if (!micSupported) return;
    setMicError("");

    if (micMode === "media-recorder") {
      if (isListening) {
        const recorder = mediaRecorderRef.current;
        if (recorder && recorder.state !== "inactive") {
          try {
            recorder.stop();
          } catch (_err) {
            // no-op
          }
        }
        return;
      }
      startRecorderFlow().catch((err) => {
        setMicError(err?.message || "Unable to start microphone");
        setStatus("Idle");
      });
      return;
    }

    if (!recognitionRef.current) return;
    if (isListening) {
      try {
        recognitionRef.current.stop();
      } catch (_err) {
        // no-op
      }
      return;
    }

    try {
      stopSpeaking();
      recognitionRef.current.start();
    } catch (err) {
      setMicError(err?.message || "Unable to start microphone");
    }
  };

  const visibleMessages = messages.slice(-MAX_VISIBLE_MESSAGES);
  const waveTone = status === "Listening" ? "listening" : "speaking";
  const waveActive = status === "Listening" || status === "Speaking";
  const placementClass =
    placement === "top-left"
      ? "pointer-events-none fixed inset-x-0 bottom-0 z-[70] sm:inset-x-auto sm:left-4 sm:top-4 sm:bottom-auto"
      : placement === "right-middle"
        ? "pointer-events-none fixed inset-x-0 bottom-0 z-[70] sm:inset-x-auto sm:bottom-auto sm:right-12 md:right-16 lg:right-24 xl:right-32 sm:top-28"
        : "pointer-events-none fixed inset-x-0 bottom-0 z-[70] sm:inset-x-auto sm:bottom-4 sm:right-4";

  return (
    <div className={placementClass}>
      <div className="pointer-events-auto mx-2 mb-2 rounded-2xl border border-white/10 bg-neutral-950/95 shadow-2xl shadow-black/40 backdrop-blur sm:mx-0 sm:mb-0 sm:w-[380px]">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/60">My AI PA</p>
            <p className="text-sm font-semibold text-white">Website Assistant</p>
          </div>
          <div className="flex items-center gap-2">
            {waveActive ? <AudioWave active={waveActive} tone={waveTone} /> : null}
            <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${getStatusClasses(status)}`}>
              {status}
            </span>
          </div>
        </div>

        <div ref={chatLogRef} className="max-h-72 space-y-2 overflow-y-auto px-3 py-3 sm:max-h-80">
          {visibleMessages.map((msg) => {
            const isUser = msg.role === "user";
            return (
              <div key={msg.id} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[88%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                    isUser
                      ? "bg-gradient-to-r from-emerald-600 to-amber-500 text-white"
                      : msg.isError
                        ? "border border-red-400/30 bg-red-500/10 text-red-100"
                        : msg.isPageContext
                          ? "border border-sky-300/20 bg-sky-300/10 text-sky-50"
                        : "border border-white/10 bg-white/5 text-white"
                  }`}
                >
                  {msg.content}
                </div>
              </div>
            );
          })}
        </div>

        <div className="space-y-3 border-t border-white/10 px-3 py-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-white/70">
            <span className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1.5 text-emerald-100/85">
              Website sync on
            </span>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
              <input
                type="checkbox"
                className="h-3.5 w-3.5 accent-emerald-500"
                checked={autoSpeak}
                onChange={(e) => setAutoSpeak(e.target.checked)}
              />
              Auto-speak replies
            </label>
          </div>

          {micError ? <p className="text-xs text-red-300">{micError}</p> : null}

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[auto_1fr_auto] sm:items-end">
            <button
              type="button"
              onClick={toggleListening}
              disabled={!micSupported || isSending || isTranscribing}
              className={`h-10 shrink-0 rounded-xl border px-3 text-sm font-semibold ${
                !micSupported
                  ? "cursor-not-allowed border-white/10 bg-white/5 text-white/40"
                  : isListening
                    ? "border-emerald-400/40 bg-emerald-500/20 text-emerald-100"
                    : "border-white/10 bg-white/5 text-white hover:bg-white/10"
              }`}
              aria-label={isListening ? "Stop microphone" : "Start microphone"}
              title={
                micSupported
                  ? isListening
                    ? "Stop microphone"
                    : micMode === "media-recorder"
                      ? "Record with microphone"
                      : "Start microphone"
                  : "Speech recognition / recording is not supported"
              }
            >
              {isListening ? "Stop Mic" : isTranscribing ? "..." : micMode === "media-recorder" ? "Record" : "Mic"}
            </button>

            <div className="space-y-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value.slice(0, MAX_INPUT_CHARS))}
                onKeyDown={handleKeyDown}
                rows={2}
                placeholder="Ask My AI PA..."
                className="min-h-[40px] w-full resize-none rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/40 focus:border-emerald-400/40 focus:outline-none"
              />
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={stopSpeaking}
                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/10"
                >
                  Stop speaking
                </button>
                {waveActive ? (
                  <span className="text-[11px] font-semibold text-white/65">
                    {status === "Speaking" ? "Speaking response..." : "Listening..."}
                  </span>
                ) : null}
              </div>
            </div>

            <button
              type="button"
              onClick={() => sendMessage()}
              disabled={isSending || isTranscribing || !input.trim()}
              className="h-10 shrink-0 rounded-xl bg-gradient-to-r from-emerald-600 to-amber-500 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 sm:self-start"
            >
              {isSending || isTranscribing ? "..." : "Send"}
            </button>
          </div>

          {micMode === "media-recorder" ? (
            <p className="text-[11px] text-white/45">Firefox fallback mode: record, transcribe, then send automatically.</p>
          ) : null}
          <p className="text-[11px] text-white/40">{input.length}/{MAX_INPUT_CHARS} characters</p>
        </div>
      </div>
    </div>
  );
}
