require("dotenv").config();

const cors = require("cors");
const express = require("express");
const { prisma } = require("./prisma");
const {
  createLead,
  logCall,
  searchFaq,
  sendOwnerSms,
  createBooking,
  escalateToHuman,
} = require("./agentTools");

const app = express();
const PORT = Number(process.env.PORT || 8787);
const assistantRateLimit = new Map();
const ASSISTANT_MAX_CHARS = 2000;
const ASSISTANT_WINDOW_MS = 60 * 1000;
const ASSISTANT_MAX_REQUESTS_PER_WINDOW = 12;

app.use(cors());
app.use(express.json({ limit: "15mb" }));

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function parsePositiveInt(value, fallback) {
  if (value == null || value === "") return fallback;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function requireAdmin(req, res, next) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    return res.status(500).json({ error: "ADMIN_PASSWORD is not set on the backend." });
  }
  const supplied = req.headers["x-admin-password"] || req.body?.password || req.query.password;
  if (supplied !== expected) {
    return res.status(401).json({ error: "Invalid admin password." });
  }
  next();
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || "unknown";
}

function enforceAssistantRateLimit(req, res, next) {
  const ip = getClientIp(req);
  const now = Date.now();
  const existing = assistantRateLimit.get(ip) || [];
  const recent = existing.filter((ts) => now - ts < ASSISTANT_WINDOW_MS);

  if (recent.length >= ASSISTANT_MAX_REQUESTS_PER_WINDOW) {
    return res.status(429).json({
      error: "Too many assistant requests. Please wait a minute and try again.",
    });
  }

  recent.push(now);
  assistantRateLimit.set(ip, recent);

  // Lightweight cleanup to avoid unbounded growth.
  if (assistantRateLimit.size > 500) {
    for (const [key, timestamps] of assistantRateLimit.entries()) {
      const kept = timestamps.filter((ts) => now - ts < ASSISTANT_WINDOW_MS);
      if (kept.length === 0) assistantRateLimit.delete(key);
      else assistantRateLimit.set(key, kept);
    }
  }

  next();
}

async function getOpenAiAssistantReply(message) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const err = new Error("OPENAI_API_KEY is not configured on the server.");
    err.statusCode = 500;
    throw err;
  }

  const systemPrompt = [
    "You are “My AI PA”, a friendly, concise AI receptionist for small service businesses.",
    "Rules:",
    "- Ask 1 short question at a time.",
    "- Keep answers under 2-3 sentences.",
    "- Your goal is to capture: caller name, callback number, reason for calling, urgency, and preferred time.",
    "- If it’s an emergency, advise contacting local emergency services.",
    "- Never claim you performed actions you didn’t do.",
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_ASSISTANT_MODEL || "gpt-4o-mini",
      temperature: 0.4,
      max_tokens: 180,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message },
      ],
    }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const msg =
      data?.error?.message ||
      `OpenAI request failed (${response.status}).`;
    const err = new Error(msg);
    err.statusCode = 502;
    throw err;
  }

  const reply = data?.choices?.[0]?.message?.content;
  if (!reply || typeof reply !== "string") {
    const err = new Error("Assistant did not return a reply.");
    err.statusCode = 502;
    throw err;
  }

  return reply.trim();
}

async function getOpenAiTranscription({ audioBase64, mimeType, detailed = false }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const err = new Error("OPENAI_API_KEY is not configured on the server.");
    err.statusCode = 500;
    throw err;
  }

  const cleaned = String(audioBase64 || "").replace(/^data:.*;base64,/, "").trim();
  if (!cleaned) {
    const err = new Error("audioBase64 is required");
    err.statusCode = 400;
    throw err;
  }

  const buffer = Buffer.from(cleaned, "base64");
  if (!buffer.length) {
    const err = new Error("Audio payload could not be decoded.");
    err.statusCode = 400;
    throw err;
  }
  if (buffer.length > 8 * 1024 * 1024) {
    const err = new Error("Audio payload is too large (max 8MB).");
    err.statusCode = 400;
    throw err;
  }

  const type = String(mimeType || "audio/webm");
  const ext = type.includes("ogg") ? "ogg" : type.includes("mp4") || type.includes("mpeg") ? "mp3" : "webm";
  const fileBlob = new Blob([buffer], { type });
  const form = new FormData();
  form.append("file", fileBlob, `speech.${ext}`);
  form.append("model", process.env.OPENAI_TRANSCRIBE_MODEL || "whisper-1");
  form.append("language", process.env.OPENAI_TRANSCRIBE_LANGUAGE || "en");
  if (detailed) {
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "segment");
  }

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const msg = data?.error?.message || `OpenAI transcription failed (${response.status}).`;
    const err = new Error(msg);
    err.statusCode = 502;
    throw err;
  }

  const text = typeof data?.text === "string"
    ? data.text.trim()
    : typeof data?.output_text === "string"
      ? data.output_text.trim()
      : typeof data?.transcript === "string"
        ? data.transcript.trim()
        : "";
  if (!text) {
    const err = new Error("No speech was detected. Try speaking a little louder and record for 1-2 seconds.");
    err.statusCode = 502;
    throw err;
  }
  if (detailed) {
    const segments = Array.isArray(data?.segments)
      ? data.segments
          .map((seg) => ({
            id: seg?.id,
            start: Number(seg?.start ?? 0),
            end: Number(seg?.end ?? 0),
            text: typeof seg?.text === "string" ? seg.text.trim() : "",
          }))
          .filter((seg) => seg.text)
      : [];
    return { text, segments };
  }
  return text;
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "my-ai-pa-api", time: new Date().toISOString() });
});

app.post(
  "/api/assistant",
  enforceAssistantRateLimit,
  asyncRoute(async (req, res) => {
    const body = req.body || {};
    const message = typeof body.message === "string" ? body.message.trim() : "";

    if (!message) {
      return res.status(400).json({ error: "message is required" });
    }

    if (message.length > ASSISTANT_MAX_CHARS) {
      return res.status(400).json({
        error: `message is too long (max ${ASSISTANT_MAX_CHARS} characters)`,
      });
    }

    const reply = await getOpenAiAssistantReply(message);
    res.json({ reply });
  })
);

app.post(
  "/api/assistant/transcribe",
  enforceAssistantRateLimit,
  asyncRoute(async (req, res) => {
    const body = req.body || {};
    const detailed = Boolean(body.detailed);
    const transcriptResult = await getOpenAiTranscription({
      audioBase64: body.audioBase64,
      mimeType: body.mimeType,
      detailed,
    });
    if (detailed) {
      return res.json({
        transcript: transcriptResult?.text || "",
        segments: transcriptResult?.segments || [],
      });
    }
    res.json({ transcript: transcriptResult });
  })
);

app.post(
  "/api/leads/create",
  asyncRoute(async (req, res) => {
    const lead = await createLead(req.body || {});
    res.status(201).json({ ok: true, leadId: lead.id, lead });
  })
);

app.post(
  "/api/calls/log",
  asyncRoute(async (req, res) => {
    const call = await logCall(req.body || {});
    res.status(201).json({ ok: true, callId: call.id, call });
  })
);

app.get(
  "/api/faqs/search",
  asyncRoute(async (req, res) => {
    const q = String(req.query.q || "");
    if (!q.trim()) {
      return res.status(400).json({ error: "q is required" });
    }
    const results = await searchFaq({
      q,
      businessId: parsePositiveInt(req.query.businessId, 1),
      limit: parsePositiveInt(req.query.limit, 10),
    });
    res.json({ ok: true, count: results.length, results });
  })
);

app.post(
  "/api/notify/owner-sms",
  asyncRoute(async (req, res) => {
    const payload = req.body || {};
    const result = await sendOwnerSms({
      businessId: payload.businessId || 1,
      to: payload.to,
      message: payload.message,
    });
    res.status(201).json({ ok: true, result });
  })
);

app.post(
  "/api/webhooks/voice",
  asyncRoute(async (req, res) => {
    const payload = req.body || {};
    const eventType = String(payload.eventType || payload.type || "unknown").toLowerCase();
    const toolResults = [];

    if (eventType === "call.started") {
      toolResults.push({ tool: "logCall", result: await logCall({ status: "STARTED", ...payload }) });
    } else if (eventType === "call.completed") {
      toolResults.push({ tool: "logCall", result: await logCall({ status: payload.status || "COMPLETED", ...payload }) });
      if (payload.lead) {
        toolResults.push({ tool: "createLead", result: await createLead({ businessId: payload.businessId || 1, ...payload.lead }) });
      }
    } else if (eventType === "faq.lookup") {
      toolResults.push({
        tool: "searchFaq",
        result: await searchFaq({ q: payload.q || payload.query || "", businessId: payload.businessId || 1, limit: payload.limit || 5 }),
      });
    } else if (eventType === "lead.capture") {
      const lead = await createLead({ businessId: payload.businessId || 1, ...payload });
      toolResults.push({ tool: "createLead", result: lead });
      if (payload.notifyOwner !== false) {
        toolResults.push({
          tool: "sendOwnerSms",
          result: await sendOwnerSms({
            businessId: payload.businessId || 1,
            message: payload.smsMessage || `New ${lead.intent} lead from ${lead.name} (${lead.callbackNumber}).`,
          }),
        });
      }
    } else if (eventType === "booking.request") {
      toolResults.push({ tool: "createBooking", result: await createBooking(payload) });
    } else if (eventType === "human.escalation") {
      toolResults.push({ tool: "escalateToHuman", result: await escalateToHuman(payload) });
    } else {
      toolResults.push({
        tool: "noop",
        result: { ok: true, stub: true, note: `No router action for eventType '${eventType}' yet.` },
      });
    }

    res.json({ ok: true, eventType, toolResults });
  })
);

app.post(
  "/api/admin/login",
  requireAdmin,
  asyncRoute(async (_req, res) => {
    res.json({ ok: true });
  })
);

app.get(
  "/api/admin/leads",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const where = {};
    if (req.query.status) where.status = String(req.query.status).toUpperCase();
    if (req.query.intent) where.intent = String(req.query.intent).toUpperCase();
    if (req.query.urgency) where.urgency = String(req.query.urgency).toUpperCase();
    const leads = await prisma.lead.findMany({
      where,
      include: { caller: true, call: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    res.json({ ok: true, leads });
  })
);

app.get(
  "/api/admin/calls",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const where = {};
    if (req.query.status) where.status = String(req.query.status).toUpperCase();
    if (req.query.minDuration) {
      const minDuration = Math.max(0, Number(req.query.minDuration) || 0);
      where.durationSec = { gte: minDuration };
    }
    const calls = await prisma.call.findMany({
      where,
      include: { caller: true, business: true },
      orderBy: { startedAt: "desc" },
      take: 200,
    });
    res.json({ ok: true, calls });
  })
);

app.get(
  "/api/admin/faqs",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const businessId = parsePositiveInt(req.query.businessId, 1);
    const faqs = await prisma.fAQ.findMany({
      where: { businessId },
      orderBy: { updatedAt: "desc" },
      take: 300,
    });
    res.json({ ok: true, faqs });
  })
);

app.post(
  "/api/admin/faqs",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const body = req.body || {};
    if (!body.question || !body.answer) {
      return res.status(400).json({ error: "question and answer are required" });
    }
    const faq = await prisma.fAQ.create({
      data: {
        businessId: parsePositiveInt(body.businessId, 1),
        question: String(body.question).trim(),
        answer: String(body.answer).trim(),
        tags: String(body.tags || "").trim(),
      },
    });
    res.status(201).json({ ok: true, faq });
  })
);

app.put(
  "/api/admin/faqs/:id",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const id = parsePositiveInt(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid FAQ id" });
    const body = req.body || {};
    const faq = await prisma.fAQ.update({
      where: { id },
      data: {
        question: body.question == null ? undefined : String(body.question).trim(),
        answer: body.answer == null ? undefined : String(body.answer).trim(),
        tags: body.tags == null ? undefined : String(body.tags).trim(),
      },
    });
    res.json({ ok: true, faq });
  })
);

app.delete(
  "/api/admin/faqs/:id",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const id = parsePositiveInt(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid FAQ id" });
    await prisma.fAQ.delete({ where: { id } });
    res.json({ ok: true });
  })
);

app.get(
  "/api/admin/settings",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const businessId = parsePositiveInt(req.query.businessId, 1);
    let settings = await prisma.settings.findUnique({ where: { businessId } });
    if (!settings) {
      const business = await prisma.business.findUnique({ where: { id: businessId } });
      if (!business) return res.status(404).json({ error: "Business not found" });
      settings = await prisma.settings.create({
        data: {
          businessId,
          answerAfterRings: 3,
          afterHoursMode: "AI_ALWAYS_ON",
          ownerPhone: business.phone,
          bookingLink: null,
        },
      });
    }
    res.json({ ok: true, settings });
  })
);

app.put(
  "/api/admin/settings",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const body = req.body || {};
    const businessId = parsePositiveInt(body.businessId, 1);
    const answerAfterRings = Math.min(10, Math.max(1, Number(body.answerAfterRings || 3)));
    const allowedModes = ["AI_ALWAYS_ON", "AI_BUSINESS_HOURS_ONLY", "VOICEMAIL_ONLY", "FORWARD_TO_OWNER"];
    const afterHoursMode = allowedModes.includes(String(body.afterHoursMode || "").toUpperCase())
      ? String(body.afterHoursMode).toUpperCase()
      : "AI_ALWAYS_ON";

    const settings = await prisma.settings.upsert({
      where: { businessId },
      update: {
        answerAfterRings,
        afterHoursMode,
        ownerPhone: String(body.ownerPhone || "").trim(),
        bookingLink: body.bookingLink ? String(body.bookingLink).trim() : null,
      },
      create: {
        businessId,
        answerAfterRings,
        afterHoursMode,
        ownerPhone: String(body.ownerPhone || "").trim(),
        bookingLink: body.bookingLink ? String(body.bookingLink).trim() : null,
      },
    });

    res.json({ ok: true, settings });
  })
);

app.use((err, _req, res, _next) => {
  const status = err.statusCode || 500;
  const message = err.message || "Internal server error";
  if (status >= 500) {
    console.error(err);
  }
  res.status(status).json({ error: message });
});

app.listen(PORT, () => {
  console.log(`My AI PA API listening on http://localhost:${PORT}`);
});
