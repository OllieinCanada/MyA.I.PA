const crypto = require("crypto");
const { prisma } = require("./prisma");
const { sendSmsViaVapi } = require("./vapiSms");

const ACK_TIMEOUT_MINUTES = positiveInt(process.env.LEAD_ACK_TIMEOUT_MINUTES, 10);
const RETRY_DELAY_MINUTES = positiveInt(process.env.LEAD_NOTIFICATION_RETRY_MINUTES, 2);
const MAX_RETRIES = Math.min(5, positiveInt(process.env.LEAD_NOTIFICATION_MAX_RETRIES, 2));
const ACK_TOKEN_TTL_HOURS = positiveInt(process.env.LEAD_ACK_TOKEN_TTL_HOURS, 72);

function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function getAcknowledgementSecret(env = process.env) {
  const secret = String(env.LEAD_ACK_SECRET || env.ADMIN_SESSION_SECRET || "").trim();
  if (!secret && String(env.NODE_ENV || "").toLowerCase() === "production") {
    const error = new Error("LEAD_ACK_SECRET or ADMIN_SESSION_SECRET is required for acknowledgement links.");
    error.statusCode = 503;
    throw error;
  }
  return secret || "local-development-acknowledgement-secret";
}

function signAcknowledgementKey(key, env = process.env) {
  return crypto.createHmac("sha256", getAcknowledgementSecret(env)).update(String(key)).digest("base64url");
}

function makeAcknowledgementToken(key, env = process.env) {
  return `${key}.${signAcknowledgementKey(key, env)}`;
}

function parseAcknowledgementToken(token, env = process.env) {
  const raw = String(token || "").trim();
  const separator = raw.lastIndexOf(".");
  if (separator < 1) return null;
  const key = raw.slice(0, separator);
  const provided = raw.slice(separator + 1);
  const expected = signAcknowledgementKey(key, env);
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  if (providedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(providedBuffer, expectedBuffer)) return null;
  return key;
}

function getAcknowledgementBaseUrl(env = process.env) {
  return String(
    env.LEAD_ACK_BASE_URL ||
    env.SIGNUP_VERIFICATION_BASE_URL ||
    env.PUBLIC_APP_URL ||
    `http://localhost:${env.PORT || 8787}`
  ).trim().replace(/\/+$/, "");
}

function buildAcknowledgementUrl(key, env = process.env) {
  const token = makeAcknowledgementToken(key, env);
  return `${getAcknowledgementBaseUrl(env)}/api/leads/acknowledge?token=${encodeURIComponent(token)}`;
}

function cleanLine(value, fallback = "") {
  return String(value || fallback).replace(/\s+/g, " ").trim();
}

function buildOwnerLeadMessage({ lead, acknowledgementUrl, prefix }) {
  const intent = cleanLine(lead.intent, "new").toLowerCase().replace(/_/g, " ");
  const name = cleanLine(lead.name, "A caller");
  const phone = cleanLine(lead.callbackNumber || lead.caller?.phone, "No callback number");
  const summary = cleanLine(lead.summary, `${intent} request`).slice(0, 650);
  const leadText = cleanLine(prefix) || `New ${intent} lead: ${name}, ${phone}. ${summary}`;
  return `${leadText}\nAcknowledge lead: ${acknowledgementUrl}`.slice(0, 1600);
}

function buildBackupMessage({ lead, acknowledgementUrl }) {
  const name = cleanLine(lead.name, "A caller");
  const phone = cleanLine(lead.callbackNumber || lead.caller?.phone, "No callback number");
  const summary = cleanLine(lead.summary, "New service request").slice(0, 550);
  return `Backup lead alert: the owner has not acknowledged this lead. ${name}, ${phone}. ${summary}\nAcknowledge lead: ${acknowledgementUrl}`.slice(0, 1600);
}

function publicAttempt(attempt) {
  if (!attempt) return null;
  return {
    id: attempt.id,
    recipientRole: attempt.recipientRole,
    attemptNumber: attempt.attemptNumber,
    status: attempt.status,
    providerRequestId: attempt.providerRequestId,
    providerMessageId: attempt.providerMessageId,
    requestedAt: attempt.requestedAt,
    acceptedAt: attempt.acceptedAt,
    sentAt: attempt.sentAt,
    deliveredAt: attempt.deliveredAt,
    failedAt: attempt.failedAt,
    errorCode: attempt.errorCode,
  };
}

async function recordEvent({ handoffId, attemptId = null, providerEventId = null, status, source, details = null, occurredAt = new Date() }) {
  if (providerEventId) {
    const existing = await prisma.leadNotificationEvent.findUnique({ where: { providerEventId } });
    if (existing) return existing;
  }
  return prisma.leadNotificationEvent.create({
    data: { handoffId, attemptId, providerEventId, status, source, details, occurredAt },
  });
}

async function dispatchLeadHandoff(handoffId, recipientRole = "OWNER", options = {}) {
  const handoff = await prisma.leadHandoff.findUnique({
    where: { id: handoffId },
    include: { lead: { include: { caller: true } }, attempts: true },
  });
  if (!handoff) {
    const error = new Error("Lead handoff was not found.");
    error.statusCode = 404;
    throw error;
  }
  if (handoff.acknowledgedAt) return { handoff, skipped: true, reason: "already_acknowledged" };

  const role = recipientRole === "BACKUP" ? "BACKUP" : "OWNER";
  const recipientPhone = role === "BACKUP" ? handoff.backupPhone : handoff.ownerPhone;
  if (!recipientPhone) {
    await prisma.leadHandoff.update({
      where: { id: handoff.id },
      data: {
        status: role === "BACKUP" ? "ESCALATION_DUE" : "FAILED",
        nextActionAt: null,
        failedAt: role === "OWNER" ? new Date() : handoff.failedAt,
        lastErrorCode: role === "BACKUP" ? "BACKUP_PHONE_MISSING" : "OWNER_PHONE_MISSING",
        lastErrorMessage: role === "BACKUP" ? "Add an approved backup phone in Settings." : "Add an owner phone in Settings.",
      },
    });
    await recordEvent({
      handoffId: handoff.id,
      status: role === "BACKUP" ? "ESCALATION_BLOCKED" : "SEND_BLOCKED",
      source: "MYAIPA",
      details: { code: role === "BACKUP" ? "BACKUP_PHONE_MISSING" : "OWNER_PHONE_MISSING" },
    });
    return { handoff, skipped: true, reason: "recipient_phone_missing" };
  }

  const attemptNumber = handoff.attempts.filter((attempt) => attempt.recipientRole === role).length + 1;
  const attempt = await prisma.leadNotificationAttempt.create({
    data: { handoffId: handoff.id, recipientRole: role, recipientPhone, attemptNumber, status: "REQUESTED" },
  });
  await prisma.leadHandoff.update({ where: { id: handoff.id }, data: { status: "SEND_REQUESTED" } });
  await recordEvent({ handoffId: handoff.id, attemptId: attempt.id, status: "SEND_REQUESTED", source: "MYAIPA" });

  const acknowledgementUrl = buildAcknowledgementUrl(handoff.acknowledgementKey, options.env || process.env);
  const message = role === "BACKUP"
    ? buildBackupMessage({ lead: handoff.lead, acknowledgementUrl })
    : buildOwnerLeadMessage({ lead: handoff.lead, acknowledgementUrl, prefix: options.message });

  try {
    const result = await (options.sendSms || sendSmsViaVapi)({
      to: recipientPhone,
      message,
      env: options.env || process.env,
      fetchImpl: options.fetchImpl || global.fetch,
    });
    const acceptedAt = new Date();
    await prisma.leadNotificationAttempt.update({
      where: { id: attempt.id },
      data: {
        status: "ACCEPTED",
        acceptedAt,
        providerRequestId: result.requestId || null,
        providerMessageId: result.messageId || null,
      },
    });
    await prisma.leadHandoff.update({
      where: { id: handoff.id },
      data: role === "BACKUP"
        ? { status: "ESCALATED", escalatedAt: acceptedAt, nextActionAt: null, lastErrorCode: null, lastErrorMessage: null }
        : { status: "SENT", ownerAcceptedAt: acceptedAt, nextActionAt: new Date(acceptedAt.getTime() + ACK_TIMEOUT_MINUTES * 60 * 1000), lastErrorCode: null, lastErrorMessage: null },
    });
    await recordEvent({
      handoffId: handoff.id,
      attemptId: attempt.id,
      status: "VAPI_ACCEPTED",
      source: "VAPI_API",
      details: { requestId: result.requestId || null, messageId: result.messageId || null, mocked: Boolean(result.mocked) },
      occurredAt: acceptedAt,
    });
    return { handoffId: handoff.id, status: role === "BACKUP" ? "ESCALATED" : "SENT", attempt: publicAttempt({ ...attempt, ...result, acceptedAt, status: "ACCEPTED" }), result };
  } catch (error) {
    const failedAt = new Date();
    const retryCount = role === "OWNER" ? handoff.retryCount + 1 : handoff.retryCount;
    const retryDue = role === "OWNER" && retryCount <= handoff.maxRetries;
    const nextStatus = retryDue ? "RETRY_DUE" : (handoff.backupPhone ? "ESCALATION_DUE" : "FAILED");
    const errorCode = cleanLine(error.providerCode || error.code || "VAPI_SEND_FAILED").slice(0, 100);
    await prisma.leadNotificationAttempt.update({
      where: { id: attempt.id },
      data: { status: "FAILED", failedAt, errorCode, errorMessage: cleanLine(error.message).slice(0, 500) },
    });
    await prisma.leadHandoff.update({
      where: { id: handoff.id },
      data: {
        status: nextStatus,
        retryCount,
        failedAt,
        nextActionAt: retryDue ? new Date(failedAt.getTime() + RETRY_DELAY_MINUTES * 60 * 1000) : (nextStatus === "ESCALATION_DUE" ? failedAt : null),
        lastErrorCode: errorCode,
        lastErrorMessage: cleanLine(error.message).slice(0, 500),
      },
    });
    await recordEvent({ handoffId: handoff.id, attemptId: attempt.id, status: "SEND_FAILED", source: "VAPI_API", details: { code: errorCode }, occurredAt: failedAt });
    return { handoffId: handoff.id, status: nextStatus, attempt: publicAttempt({ ...attempt, failedAt, errorCode, status: "FAILED" }), error: cleanLine(error.message) };
  }
}

async function createAndDispatchLeadHandoff({ lead, businessId, callId = null, sourceEventId = null, message = "", env = process.env, sendSms, fetchImpl }) {
  if (!lead?.id) {
    const error = new Error("A saved lead is required before owner notification.");
    error.statusCode = 400;
    throw error;
  }
  const normalizedSourceEventId = cleanLine(sourceEventId).slice(0, 180) || null;
  const existing = normalizedSourceEventId
    ? await prisma.leadHandoff.findUnique({ where: { sourceEventId: normalizedSourceEventId } })
    : await prisma.leadHandoff.findUnique({ where: { leadId: lead.id } });
  if (existing) return { handoffId: existing.id, status: existing.status, duplicate: true };

  const settings = await prisma.settings.findUnique({ where: { businessId: Number(businessId || lead.businessId) } });
  const acknowledgementKey = crypto.randomBytes(24).toString("base64url");
  const now = new Date();
  const handoff = await prisma.leadHandoff.create({
    data: {
      sourceEventId: normalizedSourceEventId,
      leadId: lead.id,
      businessId: Number(businessId || lead.businessId),
      callId: callId || lead.callId || null,
      ownerPhone: cleanLine(settings?.ownerPhone),
      backupPhone: cleanLine(settings?.backupPhone) || null,
      acknowledgementKey,
      acknowledgementExpiresAt: new Date(now.getTime() + ACK_TOKEN_TTL_HOURS * 60 * 60 * 1000),
      maxRetries: MAX_RETRIES,
      nextActionAt: now,
    },
  });
  await recordEvent({ handoffId: handoff.id, status: "HANDOFF_CREATED", source: "MYAIPA" });
  return dispatchLeadHandoff(handoff.id, "OWNER", { message, env, sendSms, fetchImpl });
}

function normalizeExternalSmsResult(payload = {}) {
  const owner = payload.owner && typeof payload.owner === "object" ? payload.owner : {};
  const backup = payload.backup && typeof payload.backup === "object" ? payload.backup : {};
  const ownerSent = owner.sent === true || cleanLine(owner.status).toUpperCase() === "SENT";
  const backupSent = backup.sent === true || cleanLine(backup.status).toUpperCase() === "SENT";
  return {
    status: ownerSent ? "SENT" : (backupSent ? "ESCALATED" : "FAILED"),
    owner: {
      sent: ownerSent,
      phone: cleanLine(owner.to || payload.ownerPhone),
      from: cleanLine(owner.from),
      messageId: cleanLine(owner.messageId || owner.sid),
      attemptCount: Math.max(1, positiveInt(owner.attemptCount, 1)),
      errorCode: cleanLine(owner.errorCode || owner.code).slice(0, 100),
      errorMessage: cleanLine(owner.errorMessage || owner.error).slice(0, 500),
    },
    backup: {
      sent: backupSent,
      phone: cleanLine(backup.to || payload.backupPhone),
      from: cleanLine(backup.from),
      messageId: cleanLine(backup.messageId || backup.sid),
      attemptCount: Math.max(1, positiveInt(backup.attemptCount, 1)),
      errorCode: cleanLine(backup.errorCode || backup.code).slice(0, 100),
      errorMessage: cleanLine(backup.errorMessage || backup.error).slice(0, 500),
    },
  };
}

async function recordExternalOwnerSmsResult({ lead, businessId, callId = null, sourceEventId, payload = {} }) {
  if (!lead?.id) {
    const error = new Error("A saved lead is required before recording an owner SMS result.");
    error.statusCode = 400;
    throw error;
  }
  const normalizedSourceEventId = cleanLine(sourceEventId).slice(0, 180);
  if (!normalizedSourceEventId) {
    const error = new Error("eventId is required for idempotent SMS result recording.");
    error.statusCode = 400;
    throw error;
  }
  const existing = await prisma.leadHandoff.findUnique({ where: { sourceEventId: normalizedSourceEventId } });
  if (existing) return { handoffId: existing.id, status: existing.status, duplicate: true };

  const resolvedBusinessId = Number(businessId || lead.businessId);
  const settings = await prisma.settings.findUnique({ where: { businessId: resolvedBusinessId } });
  const result = normalizeExternalSmsResult(payload);
  const now = new Date();
  const acknowledgementKey = crypto.randomBytes(24).toString("base64url");
  const ownerPhone = result.owner.phone || cleanLine(settings?.ownerPhone);
  const backupPhone = result.backup.phone || cleanLine(settings?.backupPhone) || null;
  const ownerErrorCode = result.owner.errorCode || (result.owner.sent ? null : "OWNER_SMS_FAILED");
  const ownerErrorMessage = result.owner.errorMessage || null;

  const handoff = await prisma.leadHandoff.create({
    data: {
      sourceEventId: normalizedSourceEventId,
      leadId: lead.id,
      businessId: resolvedBusinessId,
      callId: callId || lead.callId || null,
      provider: "VAPI_TOOL",
      status: result.status,
      ownerPhone,
      backupPhone,
      acknowledgementRequired: false,
      acknowledgementKey,
      acknowledgementExpiresAt: new Date(now.getTime() + ACK_TOKEN_TTL_HOURS * 60 * 60 * 1000),
      ownerAcceptedAt: result.owner.sent ? now : null,
      failedAt: result.owner.sent ? null : now,
      escalatedAt: result.status === "ESCALATED" ? now : null,
      retryCount: Math.max(0, result.owner.attemptCount - 1),
      maxRetries: MAX_RETRIES,
      nextActionAt: null,
      lastErrorCode: result.status === "FAILED" ? ownerErrorCode : null,
      lastErrorMessage: result.status === "FAILED" ? ownerErrorMessage : null,
    },
  });

  const ownerAttempt = await prisma.leadNotificationAttempt.create({
    data: {
      handoffId: handoff.id,
      recipientRole: "OWNER",
      recipientPhone: ownerPhone,
      attemptNumber: 1,
      status: result.owner.sent ? "ACCEPTED" : "FAILED",
      providerMessageId: result.owner.messageId || null,
      acceptedAt: result.owner.sent ? now : null,
      failedAt: result.owner.sent ? null : now,
      errorCode: result.owner.sent ? null : ownerErrorCode,
      errorMessage: result.owner.sent ? null : ownerErrorMessage,
    },
  });
  await recordEvent({
    handoffId: handoff.id,
    attemptId: ownerAttempt.id,
    providerEventId: `${normalizedSourceEventId}:owner`,
    status: result.owner.sent ? "OWNER_SMS_ACCEPTED" : "OWNER_SMS_FAILED",
    source: "VAPI_CODE_TOOL",
    details: { messageId: result.owner.messageId || null, attemptCount: result.owner.attemptCount, errorCode: ownerErrorCode || null },
    occurredAt: now,
  });

  if (result.backup.sent || result.backup.errorCode || result.backup.errorMessage) {
    const backupAttempt = await prisma.leadNotificationAttempt.create({
      data: {
        handoffId: handoff.id,
        recipientRole: "BACKUP",
        recipientPhone: backupPhone || "not-configured",
        attemptNumber: 1,
        status: result.backup.sent ? "ACCEPTED" : "FAILED",
        providerMessageId: result.backup.messageId || null,
        acceptedAt: result.backup.sent ? now : null,
        failedAt: result.backup.sent ? null : now,
        errorCode: result.backup.sent ? null : (result.backup.errorCode || "BACKUP_SMS_FAILED"),
        errorMessage: result.backup.sent ? null : (result.backup.errorMessage || null),
      },
    });
    await recordEvent({
      handoffId: handoff.id,
      attemptId: backupAttempt.id,
      providerEventId: `${normalizedSourceEventId}:backup`,
      status: result.backup.sent ? "BACKUP_SMS_ACCEPTED" : "BACKUP_SMS_FAILED",
      source: "VAPI_CODE_TOOL",
      details: { messageId: result.backup.messageId || null, attemptCount: result.backup.attemptCount, errorCode: result.backup.errorCode || null },
      occurredAt: now,
    });
  }

  return { handoffId: handoff.id, status: handoff.status, duplicate: false };
}

async function acknowledgeLeadByToken({ token, ip = "unknown", env = process.env }) {
  const key = parseAcknowledgementToken(token, env);
  if (!key) return { ok: false, code: "INVALID", statusCode: 400 };
  const handoff = await prisma.leadHandoff.findUnique({ where: { acknowledgementKey: key }, include: { lead: true } });
  if (!handoff) return { ok: false, code: "INVALID", statusCode: 404 };
  if (handoff.acknowledgedAt) return { ok: true, alreadyAcknowledged: true, acknowledgedAt: handoff.acknowledgedAt, handoffId: handoff.id };
  if (handoff.acknowledgementExpiresAt.getTime() < Date.now()) return { ok: false, code: "EXPIRED", statusCode: 410 };

  const acknowledgedAt = new Date();
  const ipHash = crypto.createHash("sha256").update(`${getAcknowledgementSecret(env)}:${ip}`).digest("hex");
  await prisma.leadHandoff.update({
    where: { id: handoff.id },
    data: { status: "ACKNOWLEDGED", acknowledgedAt, acknowledgedIpHash: ipHash, nextActionAt: null, lastErrorCode: null, lastErrorMessage: null },
  });
  await recordEvent({ handoffId: handoff.id, status: "OWNER_ACKNOWLEDGED", source: "OWNER_LINK", occurredAt: acknowledgedAt });
  return { ok: true, alreadyAcknowledged: false, acknowledgedAt, handoffId: handoff.id };
}

async function processDueLeadHandoffs() {
  const now = new Date();
  const due = await prisma.leadHandoff.findMany({
    where: {
      acknowledgedAt: null,
      nextActionAt: { lte: now },
      OR: [
        { status: { in: ["RETRY_DUE", "ESCALATION_DUE"] } },
        { acknowledgementRequired: true, status: { in: ["SENT", "DELIVERED"] } },
      ],
    },
    orderBy: { nextActionAt: "asc" },
    take: 50,
  });
  const results = [];
  for (const handoff of due) {
    if (handoff.status === "RETRY_DUE" && handoff.retryCount <= handoff.maxRetries) {
      results.push(await dispatchLeadHandoff(handoff.id, "OWNER"));
      continue;
    }
    if (handoff.backupPhone) {
      results.push(await dispatchLeadHandoff(handoff.id, "BACKUP"));
    } else {
      await prisma.leadHandoff.update({ where: { id: handoff.id }, data: { status: "ESCALATION_DUE", nextActionAt: null, lastErrorCode: "BACKUP_PHONE_MISSING", lastErrorMessage: "Add an approved backup phone in Settings." } });
      await recordEvent({ handoffId: handoff.id, status: "ESCALATION_BLOCKED", source: "MYAIPA", details: { code: "BACKUP_PHONE_MISSING" } });
      results.push({ handoffId: handoff.id, status: "ESCALATION_DUE", skipped: true });
    }
  }
  return { checked: due.length, results };
}

async function applyProviderEvent(payload = {}) {
  const providerEventId = cleanLine(payload.eventId || payload.id);
  const status = cleanLine(payload.status).toUpperCase();
  const allowed = ["ACCEPTED", "SENT", "DELIVERED", "FAILED"];
  if (!providerEventId || !allowed.includes(status)) {
    const error = new Error("eventId and a supported status are required.");
    error.statusCode = 400;
    throw error;
  }
  const existing = await prisma.leadNotificationEvent.findUnique({ where: { providerEventId } });
  if (existing) return { duplicate: true, event: existing };

  const attempt = payload.attemptId
    ? await prisma.leadNotificationAttempt.findUnique({ where: { id: cleanLine(payload.attemptId) }, include: { handoff: true } })
    : await prisma.leadNotificationAttempt.findFirst({
        where: payload.providerMessageId ? { providerMessageId: cleanLine(payload.providerMessageId) } : { providerRequestId: cleanLine(payload.providerRequestId) },
        include: { handoff: true },
        orderBy: { createdAt: "desc" },
      });
  if (!attempt) {
    const error = new Error("Notification attempt was not found.");
    error.statusCode = 404;
    throw error;
  }

  const occurredAt = payload.occurredAt && !Number.isNaN(new Date(payload.occurredAt).getTime()) ? new Date(payload.occurredAt) : new Date();
  const attemptData = { status };
  const handoffData = {};
  if (status === "ACCEPTED") attemptData.acceptedAt = occurredAt;
  if (status === "SENT") { attemptData.sentAt = occurredAt; if (!attempt.handoff.acknowledgedAt) handoffData.status = "SENT"; }
  if (status === "DELIVERED") { attemptData.deliveredAt = occurredAt; if (!attempt.handoff.acknowledgedAt) handoffData.status = "DELIVERED"; handoffData.deliveredAt = occurredAt; }
  if (status === "FAILED") {
    attemptData.failedAt = occurredAt;
    attemptData.errorCode = cleanLine(payload.errorCode || "VAPI_DELIVERY_FAILED").slice(0, 100);
    const retryCount = attempt.recipientRole === "OWNER" ? attempt.handoff.retryCount + 1 : attempt.handoff.retryCount;
    const retryDue = attempt.recipientRole === "OWNER" && retryCount <= attempt.handoff.maxRetries;
    handoffData.status = retryDue ? "RETRY_DUE" : (attempt.handoff.backupPhone && attempt.recipientRole === "OWNER" ? "ESCALATION_DUE" : "FAILED");
    handoffData.retryCount = retryCount;
    handoffData.nextActionAt = retryDue
      ? new Date(occurredAt.getTime() + RETRY_DELAY_MINUTES * 60 * 1000)
      : (handoffData.status === "ESCALATION_DUE" ? occurredAt : null);
    handoffData.failedAt = occurredAt;
    handoffData.lastErrorCode = attemptData.errorCode;
  }
  await prisma.leadNotificationAttempt.update({ where: { id: attempt.id }, data: attemptData });
  if (Object.keys(handoffData).length) await prisma.leadHandoff.update({ where: { id: attempt.handoffId }, data: handoffData });
  const event = await recordEvent({ handoffId: attempt.handoffId, attemptId: attempt.id, providerEventId, status: `PROVIDER_${status}`, source: "VAPI_WEBHOOK", details: { errorCode: attemptData.errorCode || null }, occurredAt });
  return { duplicate: false, event };
}

async function getLeadHandoffDashboard() {
  const [total, ownerNotified, awaitingAcknowledgement, delivered, acknowledged, retryDue, escalationDue, escalated, failed, recent] = await Promise.all([
    prisma.leadHandoff.count(),
    prisma.leadHandoff.count({ where: { ownerAcceptedAt: { not: null } } }),
    prisma.leadHandoff.count({ where: { acknowledgementRequired: true, acknowledgedAt: null, status: { in: ["SENT", "DELIVERED"] } } }),
    prisma.leadHandoff.count({ where: { deliveredAt: { not: null } } }),
    prisma.leadHandoff.count({ where: { status: "ACKNOWLEDGED" } }),
    prisma.leadHandoff.count({ where: { status: "RETRY_DUE" } }),
    prisma.leadHandoff.count({ where: { status: "ESCALATION_DUE" } }),
    prisma.leadHandoff.count({ where: { status: "ESCALATED" } }),
    prisma.leadHandoff.count({ where: { status: "FAILED" } }),
    prisma.leadHandoff.findMany({
      include: { lead: { select: { id: true, name: true, intent: true, summary: true, callbackNumber: true } }, attempts: { orderBy: { createdAt: "desc" }, take: 3 }, events: { orderBy: { occurredAt: "desc" }, take: 5 } },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);
  return {
    summary: {
      total,
      ownerNotified,
      delivered,
      acknowledged,
      awaitingAcknowledgement,
      retryDue,
      escalationDue,
      escalated,
      failed,
    },
    handoffs: recent.map((handoff) => ({
      id: handoff.id,
      status: handoff.status,
      provider: handoff.provider,
      createdAt: handoff.createdAt,
      ownerAcceptedAt: handoff.ownerAcceptedAt,
      deliveredAt: handoff.deliveredAt,
      acknowledgedAt: handoff.acknowledgedAt,
      acknowledgementRequired: handoff.acknowledgementRequired,
      escalatedAt: handoff.escalatedAt,
      retryCount: handoff.retryCount,
      nextActionAt: handoff.nextActionAt,
      lastErrorCode: handoff.lastErrorCode,
      lead: handoff.lead,
      attempts: handoff.attempts.map(publicAttempt),
      events: handoff.events,
    })),
  };
}

module.exports = {
  acknowledgeLeadByToken,
  applyProviderEvent,
  buildAcknowledgementUrl,
  buildOwnerLeadMessage,
  createAndDispatchLeadHandoff,
  dispatchLeadHandoff,
  getLeadHandoffDashboard,
  makeAcknowledgementToken,
  parseAcknowledgementToken,
  processDueLeadHandoffs,
  normalizeExternalSmsResult,
  recordExternalOwnerSmsResult,
};
