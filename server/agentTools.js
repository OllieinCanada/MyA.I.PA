const { prisma } = require("./prisma");

const STORE_CALL_TRANSCRIPTS = /^(1|true|yes|on)$/i.test(String(process.env.STORE_CALL_TRANSCRIPTS || ""));
const STORE_CALL_RECORDING_URLS = /^(1|true|yes|on)$/i.test(String(process.env.STORE_CALL_RECORDING_URLS || ""));
const MAX_STORED_TRANSCRIPT_CHARS = Math.max(0, Math.min(20000, Number(process.env.MAX_STORED_TRANSCRIPT_CHARS || 4000) || 4000));
const MAX_LEAD_SUMMARY_CHARS = Math.max(100, Math.min(4000, Number(process.env.MAX_LEAD_SUMMARY_CHARS || 1000) || 1000));

function assertString(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    const err = new Error(`${field} is required`);
    err.statusCode = 400;
    throw err;
  }
  return value.trim();
}

function optionalString(value, maxLength) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  return maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

function sanitizeTranscript(value) {
  if (!STORE_CALL_TRANSCRIPTS) return null;
  return optionalString(value, MAX_STORED_TRANSCRIPT_CHARS);
}

function sanitizeRecordingUrl(value) {
  if (!STORE_CALL_RECORDING_URLS) return null;
  const raw = optionalString(value, 2000);
  if (!raw) return null;
  return /^https?:\/\//i.test(raw) ? raw : null;
}

function toEnum(value, allowed, fallback, field) {
  if (value == null || value === "") return fallback;
  const normalized = String(value).trim().toUpperCase();
  if (!allowed.includes(normalized)) {
    const err = new Error(`${field} must be one of: ${allowed.join(", ")}`);
    err.statusCode = 400;
    throw err;
  }
  return normalized;
}

function scoreCallQuality(payload) {
  const text = [
    payload.summary,
    payload.aiSummary,
    payload.transcript,
    payload.outcome,
    payload.status,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  let score = 35;
  if (payload.durationSec && Number(payload.durationSec) >= 60) score += 15;
  if (/\b(book|appointment|schedule|quote|estimate|repair|install|service|emergency|urgent)\b/.test(text)) score += 25;
  if (/\b(address|phone|email|name|tomorrow|today|callback|call back)\b/.test(text)) score += 15;
  if (/\b(spam|wrong number|telemarketer|sales call|not interested)\b/.test(text)) score -= 45;
  if (String(payload.status || "").toUpperCase() === "MISSED") score -= 15;
  return Math.max(0, Math.min(100, Number(payload.qualityScore ?? score)));
}

async function ensureBusiness(businessId) {
  const id = Number(businessId || 1);
  if (!Number.isInteger(id) || id <= 0) {
    const err = new Error("businessId must be a positive integer");
    err.statusCode = 400;
    throw err;
  }
  const business = await prisma.business.findUnique({ where: { id } });
  if (!business) {
    const err = new Error(`Business ${id} not found`);
    err.statusCode = 404;
    throw err;
  }
  return business;
}

async function upsertCaller({ phone, name }) {
  const normalizedPhone = assertString(phone, "caller phone");
  return prisma.caller.upsert({
    where: { phone: normalizedPhone },
    update: name ? { name: optionalString(name, 120) } : {},
    create: {
      phone: normalizedPhone,
      name: optionalString(name, 120),
    },
  });
}

async function logCall(payload) {
  const business = await ensureBusiness(payload.businessId);
  const caller = await upsertCaller({
    phone: payload.callerPhone || payload.phone,
    name: payload.callerName || payload.name,
  });

  const status = toEnum(payload.status, ["STARTED", "COMPLETED", "MISSED", "ABANDONED", "FAILED"], "STARTED", "status");
  const outcome = toEnum(payload.outcome, ["UNREVIEWED", "BOOKED", "QUOTE_NEEDED", "EMERGENCY", "SPAM", "FOLLOW_UP", "NOT_A_LEAD"], "UNREVIEWED", "outcome");
  const startedAt = payload.startedAt ? new Date(payload.startedAt) : new Date();
  const endedAt = payload.endedAt ? new Date(payload.endedAt) : null;
  const externalProvider = optionalString(payload.externalProvider, 80);
  const externalId = optionalString(payload.externalId, 180);
  const qualityScore = scoreCallQuality(payload);

  if (Number.isNaN(startedAt.getTime()) || (endedAt && Number.isNaN(endedAt.getTime()))) {
    const err = new Error("Invalid startedAt or endedAt");
    err.statusCode = 400;
    throw err;
  }

  if (payload.callId) {
    const id = Number(payload.callId);
    const existing = await prisma.call.findUnique({ where: { id } });
    if (existing) {
      const updated = await prisma.call.update({
        where: { id },
        data: {
          status,
          startedAt,
          endedAt,
          durationSec: payload.durationSec == null ? existing.durationSec : Number(payload.durationSec),
          transcript: payload.transcript == null ? existing.transcript : sanitizeTranscript(payload.transcript),
          recordingUrl: payload.recordingUrl == null ? existing.recordingUrl : sanitizeRecordingUrl(payload.recordingUrl),
          externalProvider: externalProvider == null ? existing.externalProvider : externalProvider,
          externalId: externalId == null ? existing.externalId : externalId,
          outcome,
          qualityScore,
          aiSummary: payload.aiSummary == null ? existing.aiSummary : optionalString(payload.aiSummary, 2000),
          followUpNeeded: Boolean(payload.followUpNeeded ?? existing.followUpNeeded),
          twilioCallSid: payload.twilioCallSid == null ? existing.twilioCallSid : optionalString(payload.twilioCallSid, 120),
          twilioPrice: payload.twilioPrice == null ? existing.twilioPrice : Number(payload.twilioPrice),
          twilioPriceUnit: payload.twilioPriceUnit == null ? existing.twilioPriceUnit : optionalString(payload.twilioPriceUnit, 16),
          vapiCost: payload.vapiCost == null ? existing.vapiCost : Number(payload.vapiCost),
          vapiCostBreakdown: payload.vapiCostBreakdown == null ? existing.vapiCostBreakdown : payload.vapiCostBreakdown,
          totalInternalCost: payload.totalInternalCost == null ? existing.totalInternalCost : Number(payload.totalInternalCost),
          costSyncedAt: payload.costSyncedAt == null ? existing.costSyncedAt : new Date(payload.costSyncedAt),
          callerId: caller.id,
          businessId: business.id,
        },
        include: { caller: true, business: true },
      });
      return updated;
    }
  }

  if (externalProvider && externalId) {
    const existingExternal = await prisma.call.findUnique({
      where: { externalProvider_externalId: { externalProvider, externalId } },
    });
    if (existingExternal) {
      return prisma.call.update({
        where: { id: existingExternal.id },
        data: {
          businessId: business.id,
          callerId: caller.id,
          startedAt,
          endedAt,
          durationSec: payload.durationSec == null ? existingExternal.durationSec : Number(payload.durationSec),
          status,
          transcript: payload.transcript == null ? existingExternal.transcript : sanitizeTranscript(payload.transcript),
          recordingUrl: payload.recordingUrl == null ? existingExternal.recordingUrl : sanitizeRecordingUrl(payload.recordingUrl),
          outcome,
          qualityScore,
          aiSummary: payload.aiSummary == null ? existingExternal.aiSummary : optionalString(payload.aiSummary, 2000),
          followUpNeeded: Boolean(payload.followUpNeeded ?? existingExternal.followUpNeeded),
          twilioCallSid: payload.twilioCallSid == null ? existingExternal.twilioCallSid : optionalString(payload.twilioCallSid, 120),
          twilioPrice: payload.twilioPrice == null ? existingExternal.twilioPrice : Number(payload.twilioPrice),
          twilioPriceUnit: payload.twilioPriceUnit == null ? existingExternal.twilioPriceUnit : optionalString(payload.twilioPriceUnit, 16),
          vapiCost: payload.vapiCost == null ? existingExternal.vapiCost : Number(payload.vapiCost),
          vapiCostBreakdown: payload.vapiCostBreakdown == null ? existingExternal.vapiCostBreakdown : payload.vapiCostBreakdown,
          totalInternalCost: payload.totalInternalCost == null ? existingExternal.totalInternalCost : Number(payload.totalInternalCost),
          costSyncedAt: payload.costSyncedAt == null ? existingExternal.costSyncedAt : new Date(payload.costSyncedAt),
        },
        include: { caller: true, business: true },
      });
    }
  }

  const created = await prisma.call.create({
    data: {
      businessId: business.id,
      callerId: caller.id,
      startedAt,
      endedAt,
      durationSec: payload.durationSec == null ? null : Number(payload.durationSec),
      status,
      transcript: sanitizeTranscript(payload.transcript),
      recordingUrl: sanitizeRecordingUrl(payload.recordingUrl),
      externalProvider,
      externalId,
      outcome,
      qualityScore,
      aiSummary: optionalString(payload.aiSummary, 2000),
      followUpNeeded: Boolean(payload.followUpNeeded),
      twilioCallSid: optionalString(payload.twilioCallSid, 120),
      twilioPrice: payload.twilioPrice == null ? null : Number(payload.twilioPrice),
      twilioPriceUnit: optionalString(payload.twilioPriceUnit, 16),
      vapiCost: payload.vapiCost == null ? null : Number(payload.vapiCost),
      vapiCostBreakdown: payload.vapiCostBreakdown || undefined,
      totalInternalCost: payload.totalInternalCost == null ? null : Number(payload.totalInternalCost),
      costSyncedAt: payload.costSyncedAt ? new Date(payload.costSyncedAt) : null,
    },
    include: { caller: true, business: true },
  });

  return created;
}

async function createLead(payload) {
  const business = await ensureBusiness(payload.businessId);
  const caller = await upsertCaller({
    phone: payload.callerPhone || payload.callbackNumber,
    name: payload.callerName || payload.name,
  });

  let call = null;
  if (payload.callId) {
    call = await prisma.call.findUnique({ where: { id: Number(payload.callId) } });
  } else if (payload.call) {
    call = await logCall({
      businessId: business.id,
      callerPhone: caller.phone,
      callerName: caller.name,
      ...payload.call,
    });
  }

  const intent = toEnum(payload.intent, ["GENERAL", "BOOKING", "QUOTE", "SUPPORT", "EMERGENCY", "OTHER"], "GENERAL", "intent");
  const urgency = toEnum(payload.urgency, ["LOW", "MEDIUM", "HIGH", "URGENT"], "MEDIUM", "urgency");
  const status = toEnum(payload.status, ["NEW", "REVIEWED", "CONTACTED", "WON", "LOST", "ARCHIVED"], "NEW", "status");
  const summary = assertString(payload.summary, "summary").slice(0, MAX_LEAD_SUMMARY_CHARS);
  const callbackNumber = assertString(payload.callbackNumber || caller.phone, "callbackNumber").slice(0, 40);
  const name = assertString(payload.name || caller.name || "Unknown Caller", "name").slice(0, 120);

  const lead = await prisma.lead.create({
    data: {
      businessId: business.id,
      callerId: caller.id,
      callId: call ? call.id : null,
      intent,
      urgency,
      summary,
      callbackNumber,
      name,
      qualityScore: payload.qualityScore == null ? null : Math.max(0, Math.min(100, Number(payload.qualityScore) || 0)),
      outcomeTag: optionalString(payload.outcomeTag, 80),
      status,
    },
    include: {
      caller: true,
      call: true,
    },
  });

  return lead;
}

async function searchFaq({ q, businessId = 1, limit = 10 }) {
  const query = assertString(q, "q");
  await ensureBusiness(businessId);
  const take = Math.max(1, Math.min(50, Number(limit) || 10));

  const faqs = await prisma.fAQ.findMany({
    where: {
      businessId: Number(businessId),
      OR: [
        { question: { contains: query } },
        { answer: { contains: query } },
        { tags: { contains: query } },
      ],
    },
    take,
    orderBy: { updatedAt: "desc" },
  });

  return faqs;
}

async function sendOwnerSms(payload) {
  const business = await ensureBusiness(payload.businessId);
  const settings = await prisma.settings.findUnique({ where: { businessId: business.id } });
  const to = payload.to || settings?.ownerPhone || null;
  const message = assertString(payload.message, "message");
  const result = {
    mocked: true,
    provider: "console",
    to,
    from: process.env.OWNER_SMS_FROM || process.env.TWILIO_FROM_NUMBER || null,
    message,
    createdAt: new Date().toISOString(),
  };
  console.log("[mock-owner-sms]", result);
  return result;
}

async function createBooking(payload) {
  return {
    ok: true,
    stub: true,
    bookingLink: payload.bookingLink || null,
    requestedAt: new Date().toISOString(),
    note: "Integrate with Calendly/Google Calendar later.",
  };
}

async function escalateToHuman(payload) {
  return {
    ok: true,
    stub: true,
    reason: payload.reason || "manual escalation requested",
    requestedAt: new Date().toISOString(),
    note: "Connect to transfer/forwarding workflow later.",
  };
}

module.exports = {
  createLead,
  logCall,
  searchFaq,
  sendOwnerSms,
  createBooking,
  escalateToHuman,
};
