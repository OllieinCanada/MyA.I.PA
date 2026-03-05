const { prisma } = require("./prisma");

function assertString(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    const err = new Error(`${field} is required`);
    err.statusCode = 400;
    throw err;
  }
  return value.trim();
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
    update: name ? { name: String(name).trim() } : {},
    create: {
      phone: normalizedPhone,
      name: name ? String(name).trim() : null,
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
  const startedAt = payload.startedAt ? new Date(payload.startedAt) : new Date();
  const endedAt = payload.endedAt ? new Date(payload.endedAt) : null;

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
          transcript: payload.transcript == null ? existing.transcript : String(payload.transcript),
          recordingUrl: payload.recordingUrl == null ? existing.recordingUrl : String(payload.recordingUrl),
          callerId: caller.id,
          businessId: business.id,
        },
        include: { caller: true },
      });
      return updated;
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
      transcript: payload.transcript ? String(payload.transcript) : null,
      recordingUrl: payload.recordingUrl ? String(payload.recordingUrl) : null,
    },
    include: { caller: true },
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
  const summary = assertString(payload.summary, "summary");
  const callbackNumber = assertString(payload.callbackNumber || caller.phone, "callbackNumber");
  const name = assertString(payload.name || caller.name || "Unknown Caller", "name");

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
