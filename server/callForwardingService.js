const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { normalizeSmsPhone } = require("./smsSuppression");
const {
  SETUP_VERSION,
  normalizeCarrier,
  normalizeLineType,
  resolveForwardingRule,
} = require("./callForwardingProvider");

const STATUS = Object.freeze({
  not_started: "NOT_STARTED",
  carrier_needed: "CARRIER_NEEDED",
  ready_to_activate: "READY_TO_ACTIVATE",
  dialer_opened: "DIALER_OPENED",
  verification_pending: "VERIFICATION_PENDING",
  active: "ACTIVE",
  verification_failed: "VERIFICATION_FAILED",
  manual_setup_required: "MANUAL_SETUP_REQUIRED",
});
const PUBLIC_STATUS = Object.fromEntries(Object.entries(STATUS).map(([key, value]) => [value, key]));
const ALLOWED = Object.freeze({
  NOT_STARTED: new Set(["CARRIER_NEEDED", "READY_TO_ACTIVATE", "MANUAL_SETUP_REQUIRED"]),
  CARRIER_NEEDED: new Set(["READY_TO_ACTIVATE", "MANUAL_SETUP_REQUIRED"]),
  READY_TO_ACTIVATE: new Set(["DIALER_OPENED", "VERIFICATION_PENDING", "MANUAL_SETUP_REQUIRED"]),
  DIALER_OPENED: new Set(["VERIFICATION_PENDING", "READY_TO_ACTIVATE", "MANUAL_SETUP_REQUIRED"]),
  VERIFICATION_PENDING: new Set(["ACTIVE", "VERIFICATION_FAILED"]),
  ACTIVE: new Set(["VERIFICATION_PENDING", "READY_TO_ACTIVATE", "MANUAL_SETUP_REQUIRED"]),
  VERIFICATION_FAILED: new Set(["VERIFICATION_PENDING", "READY_TO_ACTIVATE", "MANUAL_SETUP_REQUIRED"]),
  MANUAL_SETUP_REQUIRED: new Set(["VERIFICATION_PENDING", "READY_TO_ACTIVATE"]),
});

function forwardingError(message, statusCode, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function getSigningSecret(env = process.env) {
  const secret = String(env.FORWARDING_SETUP_SECRET || env.CUSTOMER_DASHBOARD_SESSION_SECRET || "").trim();
  if (secret.length < 32) throw forwardingError("Forwarding setup signing is not configured.", 503, "FORWARDING_SIGNING_NOT_CONFIGURED");
  return secret;
}

function signupKeyFor({ signupId, ownerEmail, existingBusinessNumber }) {
  const identity = [signupId, String(ownerEmail || "").trim().toLowerCase(), normalizeSmsPhone(existingBusinessNumber, "existingBusinessNumber")].join("|");
  return crypto.createHash("sha256").update(identity).digest("hex");
}

function createSetupToken(setup, env = process.env) {
  const ttl = Math.max(300, Math.min(Number(env.FORWARDING_SETUP_URL_TTL_SECONDS || 86400), 604800));
  return jwt.sign({ typ: "forwarding-setup", sid: setup.id, sk: setup.signupKey }, getSigningSecret(env), {
    algorithm: "HS256",
    expiresIn: ttl,
    issuer: "myaipa-api",
    audience: "myaipa-forwarding-setup",
  });
}

function verifySetupToken(token, env = process.env) {
  try {
    const decoded = jwt.verify(String(token || ""), getSigningSecret(env), {
      algorithms: ["HS256"], issuer: "myaipa-api", audience: "myaipa-forwarding-setup",
    });
    if (decoded.typ !== "forwarding-setup" || !decoded.sid || !decoded.sk) throw new Error("wrong token type");
    return decoded;
  } catch {
    throw forwardingError("This forwarding setup link is invalid or has expired. Open your dashboard for a new link.", 401, "FORWARDING_TOKEN_INVALID");
  }
}

function transitionStatus(current, requested) {
  const next = STATUS[String(requested || "").toLowerCase()] || String(requested || "").toUpperCase();
  if (!PUBLIC_STATUS[next]) throw forwardingError("Unknown forwarding status.", 400, "FORWARDING_STATUS_INVALID");
  if (current === next) return current;
  if (!ALLOWED[current]?.has(next)) throw forwardingError(`Cannot change forwarding from ${PUBLIC_STATUS[current]} to ${PUBLIC_STATUS[next]}.`, 409, "FORWARDING_TRANSITION_INVALID");
  return next;
}

function inferInitialStatus(carrier, lineType, rule) {
  if (carrier === "NOT_SURE" || lineType === "NOT_SURE") return "CARRIER_NEEDED";
  return rule.supported ? "READY_TO_ACTIVATE" : "MANUAL_SETUP_REQUIRED";
}

async function recordEvent(prismaClient, setupId, eventType, metadata = {}, idempotencyKey = "") {
  const key = idempotencyKey || `${setupId}:${eventType}:${crypto.randomUUID()}`;
  return prismaClient.callForwardingEvent.upsert({
    where: { idempotencyKey: key },
    update: {},
    create: { setupId, eventType, metadata, idempotencyKey: key },
  });
}

async function initializeForwardingSetup({ prismaClient, signupId, ownerEmail, businessId, existingBusinessNumber, carrier, lineType, assignedMyAiPaNumber, vapiPhoneNumberId }) {
  const existing = normalizeSmsPhone(existingBusinessNumber, "existingBusinessNumber");
  const assigned = normalizeSmsPhone(assignedMyAiPaNumber, "assignedMyAiPaNumber");
  if (existing === assigned) throw forwardingError("The business number and My AI PA number must be different.", 400, "FORWARDING_SAME_NUMBER");
  const normalizedCarrier = normalizeCarrier(carrier);
  const normalizedLineType = normalizeLineType(lineType);
  const signupKey = signupKeyFor({ signupId, ownerEmail, existingBusinessNumber: existing });
  const prior = await prismaClient.callForwardingSetup.findUnique({ where: { signupKey } });
  const sameAssignedNumber = prior?.assignedMyAiPaNumber === assigned;
  const effectiveCarrier = sameAssignedNumber && normalizedCarrier === "NOT_SURE" ? prior.carrier : normalizedCarrier;
  const effectiveLineType = sameAssignedNumber && normalizedLineType === "NOT_SURE" ? prior.lineType : normalizedLineType;
  const rule = resolveForwardingRule({ carrier: effectiveCarrier, lineType: effectiveLineType, destination: assigned });
  const status = sameAssignedNumber ? prior.status : inferInitialStatus(effectiveCarrier, effectiveLineType, rule);
  const setup = await prismaClient.callForwardingSetup.upsert({
    where: { signupKey },
    update: {
      businessId: businessId || undefined,
      existingBusinessNumber: existing,
      assignedMyAiPaNumber: assigned,
      vapiPhoneNumberId: String(vapiPhoneNumberId || prior?.vapiPhoneNumberId || "").trim() || undefined,
      carrier: effectiveCarrier,
      lineType: effectiveLineType,
      forwardingMode: "NO_ANSWER",
      status,
      forwardingVerifiedAt: sameAssignedNumber ? prior.forwardingVerifiedAt : null,
      lastRuleKey: rule.key,
      forwardingSetupVersion: SETUP_VERSION,
    },
    create: {
      signupKey, businessId: businessId || undefined, existingBusinessNumber: existing,
      assignedMyAiPaNumber: assigned, vapiPhoneNumberId: String(vapiPhoneNumberId || "").trim() || undefined, carrier: effectiveCarrier, lineType: effectiveLineType,
      forwardingMode: "NO_ANSWER", status, lastRuleKey: rule.key, forwardingSetupVersion: SETUP_VERSION,
    },
  });
  await recordEvent(prismaClient, setup.id, "assigned_number_created", { status: PUBLIC_STATUS[setup.status] }, `${setup.id}:assigned:${assigned}`);
  return setup;
}

function sanitizeSetup(setup) {
  const rule = resolveForwardingRule({ carrier: setup.carrier, lineType: setup.lineType, forwardingMode: setup.forwardingMode, destination: setup.assignedMyAiPaNumber });
  return {
    id: setup.id,
    existingBusinessNumber: setup.existingBusinessNumber,
    carrier: setup.carrier.toLowerCase(),
    lineType: setup.lineType.toLowerCase(),
    assignedMyAiPaNumber: setup.assignedMyAiPaNumber,
    forwardingMode: "no_answer",
    forwardingStatus: PUBLIC_STATUS[setup.status],
    forwardingVerifiedAt: setup.forwardingVerifiedAt,
    verificationAttempts: setup.verificationAttempts,
    forwardingSetupVersion: setup.forwardingSetupVersion,
    lastFailureReason: setup.lastFailureReason || "",
    rule,
  };
}

async function getSetupFromToken({ prismaClient, token, env = process.env }) {
  const claim = verifySetupToken(token, env);
  const setup = await prismaClient.callForwardingSetup.findUnique({ where: { id: claim.sid } });
  if (!setup || setup.signupKey !== claim.sk) throw forwardingError("Forwarding setup was not found.", 404, "FORWARDING_SETUP_NOT_FOUND");
  if (setup.status === "VERIFICATION_PENDING") {
    const attempt = await prismaClient.forwardingVerificationAttempt.findFirst({ where: { setupId: setup.id, status: { in: ["PENDING", "RINGING", "ANSWERED"] } }, orderBy: { startedAt: "desc" } });
    if (attempt && attempt.expiresAt <= new Date()) {
      const customerMessage = attempt.status === "ANSWERED"
        ? "The test call was answered before it could forward. Try again and let the business phone ring without answering."
        : "We didn't receive the forwarded call yet.";
      await prismaClient.forwardingVerificationAttempt.update({ where: { id: attempt.id }, data: { status: "EXPIRED", completedAt: new Date(), resultDetail: "No forwarded call arrived before timeout." } });
      const failed = await prismaClient.callForwardingSetup.update({ where: { id: setup.id }, data: { status: "VERIFICATION_FAILED", lastFailureReason: customerMessage } });
      await recordEvent(prismaClient, setup.id, "verification_failed", { attemptId: attempt.id, reason: attempt.status === "ANSWERED" ? "answered_before_forwarding" : "timeout" }, `${setup.id}:verification_failed:${attempt.id}`);
      return failed;
    }
  }
  return setup;
}

async function updateSelections({ prismaClient, setup, carrier, lineType }) {
  const normalizedCarrier = normalizeCarrier(carrier);
  const normalizedLineType = normalizeLineType(lineType);
  const rule = resolveForwardingRule({ carrier: normalizedCarrier, lineType: normalizedLineType, destination: setup.assignedMyAiPaNumber });
  const nextStatus = inferInitialStatus(normalizedCarrier, normalizedLineType, rule);
  const updated = await prismaClient.callForwardingSetup.update({ where: { id: setup.id }, data: { carrier: normalizedCarrier, lineType: normalizedLineType, status: nextStatus, lastRuleKey: rule.key, lastFailureReason: null } });
  await Promise.all([
    recordEvent(prismaClient, setup.id, "carrier_selected", { carrier: normalizedCarrier }),
    recordEvent(prismaClient, setup.id, "line_type_selected", { lineType: normalizedLineType }),
    ...(!rule.supported ? [recordEvent(prismaClient, setup.id, "manual_setup_required", { ruleKey: rule.key })] : []),
  ]);
  return updated;
}

async function markDialerOpened({ prismaClient, setup }) {
  const next = setup.status === "DIALER_OPENED" ? setup.status : transitionStatus(setup.status, "dialer_opened");
  const updated = await prismaClient.callForwardingSetup.update({ where: { id: setup.id }, data: { status: next, activationOpenedAt: new Date() } });
  await recordEvent(prismaClient, setup.id, "forwarding_activation_clicked", { ruleKey: setup.lastRuleKey });
  return updated;
}

async function startVerification({ prismaClient, setup, verificationCallerNumber, placeCall, statusCallbackUrl, now = new Date() }) {
  if (["NOT_STARTED", "CARRIER_NEEDED"].includes(setup.status)) {
    throw forwardingError("Choose the phone provider and phone type before testing.", 409, "FORWARDING_SELECTIONS_REQUIRED");
  }
  const since = new Date(now.getTime() - 60 * 60 * 1000);
  const recent = await prismaClient.forwardingVerificationAttempt.count({ where: { setupId: setup.id, startedAt: { gte: since } } });
  if (recent >= 5) throw forwardingError("Too many test calls were requested. Wait an hour and try again.", 429, "FORWARDING_VERIFY_RATE_LIMIT");
  const activeAttempt = await prismaClient.forwardingVerificationAttempt.findFirst({ where: { setupId: setup.id, status: { in: ["PENDING", "RINGING", "ANSWERED"] }, expiresAt: { gt: now } }, orderBy: { startedAt: "desc" } });
  if (activeAttempt) return { setup, attempt: activeAttempt, duplicate: true };
  const caller = normalizeSmsPhone(verificationCallerNumber, "verificationCallerNumber");
  const attempt = await prismaClient.forwardingVerificationAttempt.create({ data: { setupId: setup.id, verificationCallerNumber: caller, expectedDestination: setup.assignedMyAiPaNumber, expiresAt: new Date(now.getTime() + 180_000) } });
  try {
    const call = await placeCall({ to: setup.existingBusinessNumber, from: caller, statusCallbackUrl, attemptId: attempt.id });
    const [updatedAttempt, updatedSetup] = await prismaClient.$transaction([
      prismaClient.forwardingVerificationAttempt.update({ where: { id: attempt.id }, data: { outboundCallSid: call.sid } }),
      prismaClient.callForwardingSetup.update({ where: { id: setup.id }, data: { status: "VERIFICATION_PENDING", verificationAttempts: { increment: 1 }, lastFailureReason: null } }),
    ]);
    await recordEvent(prismaClient, setup.id, "verification_started", { attemptId: attempt.id }, `${setup.id}:verification_started:${attempt.id}`);
    return { setup: updatedSetup, attempt: updatedAttempt, duplicate: false };
  } catch (error) {
    await prismaClient.forwardingVerificationAttempt.update({ where: { id: attempt.id }, data: { status: "FAILED", completedAt: new Date(), resultDetail: String(error.code || error.message).slice(0, 240) } });
    await prismaClient.callForwardingSetup.update({ where: { id: setup.id }, data: { status: "VERIFICATION_FAILED", lastFailureReason: "The test call could not be started. Try again shortly." } });
    await recordEvent(prismaClient, setup.id, "verification_failed", { attemptId: attempt.id, reason: "provider_call_failed" }, `${setup.id}:verification_failed:${attempt.id}`);
    throw error;
  }
}

async function matchForwardedVerificationCall({ prismaClient, from, destination, phoneNumberId, vapiCallId }) {
  let caller;
  try { caller = normalizeSmsPhone(from, "from"); } catch { return null; }
  let assigned = "";
  try { assigned = normalizeSmsPhone(destination, "destination"); } catch {}
  const vapiPhoneId = String(phoneNumberId || "").trim();
  if (!assigned && !vapiPhoneId) return null;
  const duplicate = String(vapiCallId || "").trim()
    ? await prismaClient.forwardingVerificationAttempt.findUnique({ where: { inboundVapiCallId: String(vapiCallId).trim() }, include: { setup: true } })
    : null;
  if (duplicate) return { attempt: duplicate, setup: duplicate.setup, duplicate: true };
  const attempt = await prismaClient.forwardingVerificationAttempt.findFirst({
    where: {
      verificationCallerNumber: caller,
      ...(assigned ? { expectedDestination: assigned } : { setup: { is: { vapiPhoneNumberId: vapiPhoneId } } }),
      status: { in: ["PENDING", "RINGING", "ANSWERED"] },
      expiresAt: { gt: new Date() },
    },
    include: { setup: true }, orderBy: { startedAt: "desc" },
  });
  if (!attempt) return null;
  const now = new Date();
  const [, setup] = await prismaClient.$transaction([
    prismaClient.forwardingVerificationAttempt.update({ where: { id: attempt.id }, data: { status: "SUCCEEDED", inboundVapiCallId: String(vapiCallId || "") || undefined, receivedAt: now, completedAt: now, resultDetail: "Forwarded verification call reached the assigned My AI PA number." } }),
    prismaClient.callForwardingSetup.update({ where: { id: attempt.setupId }, data: { status: "ACTIVE", forwardingVerifiedAt: now, lastFailureReason: null } }),
  ]);
  await recordEvent(prismaClient, setup.id, "verification_succeeded", { attemptId: attempt.id }, `${setup.id}:verification_succeeded:${attempt.id}`);
  return { attempt, setup, duplicate: false };
}

async function applyVerificationStatusCallback({ prismaClient, callSid, callStatus, answeredBy }) {
  const attempt = await prismaClient.forwardingVerificationAttempt.findUnique({ where: { outboundCallSid: String(callSid || "") } });
  if (!attempt) return null;
  if (["SUCCEEDED", "FAILED", "EXPIRED"].includes(attempt.status)) return attempt;
  const status = String(callStatus || "").toLowerCase();
  const next = status === "ringing" ? "RINGING" : status === "in-progress" ? "ANSWERED" : attempt.status;
  return prismaClient.forwardingVerificationAttempt.update({ where: { id: attempt.id }, data: { status: next, answeredBy: String(answeredBy || "").slice(0, 80) || undefined } });
}

async function isForwardingVerificationCall({ prismaClient, vapiCallId }) {
  if (!String(vapiCallId || "").trim()) return false;
  return Boolean(await prismaClient.forwardingVerificationAttempt.findUnique({
    where: { inboundVapiCallId: String(vapiCallId).trim() },
    select: { id: true },
  }));
}

module.exports = {
  PUBLIC_STATUS,
  STATUS,
  applyVerificationStatusCallback,
  createSetupToken,
  getSetupFromToken,
  initializeForwardingSetup,
  isForwardingVerificationCall,
  markDialerOpened,
  matchForwardedVerificationCall,
  recordEvent,
  sanitizeSetup,
  signupKeyFor,
  startVerification,
  transitionStatus,
  updateSelections,
  verifySetupToken,
};
