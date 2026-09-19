const crypto = require("crypto");

const CALLBACK_PREFIX = "tg1";
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PURPOSES = Object.freeze({
  SIGNUP_REVIEW: {
    actions: Object.freeze({ a: "approve", r: "reject" }),
    labels: Object.freeze({ a: "Approve and continue", r: "Reject without provisioning" }),
    openLabel: "Open details",
  },
  INCIDENT_REVIEW: {
    actions: Object.freeze({ i: "investigate", d: "dismiss" }),
    labels: Object.freeze({ i: "Start safe investigation", d: "Dismiss" }),
    openLabel: "Open incident",
  },
  PR_LANDING: {
    actions: Object.freeze({ m: "merge", r: "reject" }),
    labels: Object.freeze({ m: "Approve merge & deploy", r: "Reject" }),
    openLabel: "Open PR",
  },
});

function timingSafeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function requireSigningSecret(value) {
  const secret = String(value || "");
  if (secret.length < 32) throw new TypeError("TELEGRAM_ACTION_SIGNING_SECRET must contain at least 32 characters.");
  return secret;
}

function validPublicId(value) {
  return /^[a-f0-9]{16}$/.test(String(value || "")) ? String(value) : "";
}

function validOpenUrl(value) {
  const raw = String(value || "").trim();
  if (!raw || raw.length > 2_048) return "";
  try {
    const url = new URL(raw);
    const local = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
    if (url.protocol !== "https:" && !local) return "";
    if (url.username || url.password) return "";
    return url.toString();
  } catch (_error) {
    return "";
  }
}

function sanitizeContext(purpose, value = {}) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const openUrl = validOpenUrl(input.openUrl);
  if (purpose === "SIGNUP_REVIEW") return { ...(openUrl ? { openUrl } : {}) };
  if (purpose === "INCIDENT_REVIEW") {
    const generation = Math.max(1, Math.min(999, Number(input.generation) || 1));
    return { generation, ...(openUrl ? { openUrl } : {}) };
  }
  if (purpose === "PR_LANDING") {
    const prNumber = Number(input.prNumber);
    const headSha = String(input.headSha || "").trim().toLowerCase();
    if (!Number.isSafeInteger(prNumber) || prNumber < 1 || !/^[a-f0-9]{40}$/.test(headSha)) {
      throw new TypeError("A valid pull-request number and exact 40-character head SHA are required.");
    }
    return { prNumber, headSha, ...(openUrl ? { openUrl } : {}) };
  }
  throw new TypeError("Unsupported Telegram approval purpose.");
}

function callbackSignature(publicId, actionCode, secret) {
  const safeId = validPublicId(publicId);
  if (!safeId || !/^[a-z]$/.test(String(actionCode || ""))) return "";
  return crypto
    .createHmac("sha256", requireSigningSecret(secret))
    .update(`${CALLBACK_PREFIX}|${safeId}|${actionCode}`)
    .digest("base64url")
    .slice(0, 18);
}

function buildCallbackData(publicId, actionCode, secret) {
  const signature = callbackSignature(publicId, actionCode, secret);
  if (!signature) throw new TypeError("A valid Telegram approval callback is required.");
  return `${CALLBACK_PREFIX}.${publicId}.${actionCode}.${signature}`;
}

function parseCallbackData(value) {
  const match = String(value || "").match(/^tg1\.([a-f0-9]{16})\.([a-z])\.([A-Za-z0-9_-]{18})$/);
  return match ? { publicId: match[1], actionCode: match[2], signature: match[3] } : null;
}

function verifyCallbackData(value, secret) {
  const parsed = parseCallbackData(value);
  if (!parsed) return null;
  const expected = callbackSignature(parsed.publicId, parsed.actionCode, secret);
  return timingSafeEqual(parsed.signature, expected) ? parsed : null;
}

function buildApprovalKeyboard(approval, signingSecret) {
  const purpose = PURPOSES[String(approval?.purpose || "")];
  const publicId = validPublicId(approval?.publicId);
  if (!purpose || !publicId) throw new TypeError("A valid Telegram approval is required.");
  const decisionButtons = Object.entries(purpose.actions).map(([code]) => ({
    text: purpose.labels[code],
    callback_data: buildCallbackData(publicId, code, signingSecret),
  }));
  const openUrl = validOpenUrl(approval?.context?.openUrl);
  return {
    inline_keyboard: [
      decisionButtons,
      ...(openUrl ? [[{ text: purpose.openLabel, url: openUrl }]] : []),
    ],
  };
}

function normalizeTelegramIdentity(value) {
  const text = String(value == null ? "" : value).trim();
  return /^-?[1-9][0-9]{0,19}$/.test(text) ? text : "";
}

function authorizeTelegramCallback(update, { chatId, userId } = {}) {
  const expectedChat = normalizeTelegramIdentity(chatId);
  const expectedUser = normalizeTelegramIdentity(userId);
  const actualChat = normalizeTelegramIdentity(update?.callback_query?.message?.chat?.id);
  const actualUser = normalizeTelegramIdentity(update?.callback_query?.from?.id);
  if (!expectedChat || !expectedUser) return { authorized: false, reason: "owner_identity_not_configured" };
  if (actualChat !== expectedChat || actualUser !== expectedUser) return { authorized: false, reason: "owner_identity_mismatch" };
  return { authorized: true, chatId: actualChat, userId: actualUser };
}

function verifyTelegramWebhookSecret(provided, configured) {
  const expected = String(configured || "");
  return expected.length >= 32 && timingSafeEqual(String(provided || ""), expected);
}

async function createTelegramApproval({
  prismaClient,
  purpose,
  targetType,
  targetId,
  context = {},
  dedupeKey,
  expiresInMs = DEFAULT_TTL_MS,
  now = new Date(),
} = {}) {
  if (!prismaClient?.telegramApprovalAction) throw new TypeError("Telegram approval persistence is unavailable.");
  if (!PURPOSES[purpose]) throw new TypeError("Unsupported Telegram approval purpose.");
  const safeTargetType = String(targetType || "").trim().toLowerCase();
  const safeTargetId = String(targetId || "").trim().toLowerCase();
  const safeDedupeKey = String(dedupeKey || "").trim().toLowerCase();
  if (!/^[a-z0-9_.:-]{1,40}$/.test(safeTargetType) || !/^[a-z0-9_.:-]{1,160}$/.test(safeTargetId)) {
    throw new TypeError("A valid Telegram approval target is required.");
  }
  if (!/^[a-z0-9_.:-]{1,220}$/.test(safeDedupeKey)) throw new TypeError("A valid Telegram approval dedupe key is required.");
  const createdAt = new Date(now);
  const ttl = Math.max(60_000, Math.min(MAX_TTL_MS, Number(expiresInMs) || DEFAULT_TTL_MS));
  const data = {
    publicId: crypto.randomBytes(8).toString("hex"),
    dedupeKey: safeDedupeKey,
    purpose,
    targetType: safeTargetType,
    targetId: safeTargetId,
    context: sanitizeContext(purpose, context),
    expiresAt: new Date(createdAt.getTime() + ttl),
  };
  try {
    return await prismaClient.telegramApprovalAction.create({ data });
  } catch (error) {
    if (error?.code !== "P2002") throw error;
    return prismaClient.telegramApprovalAction.findUnique({ where: { dedupeKey: safeDedupeKey } });
  }
}

async function claimTelegramApproval({
  prismaClient,
  callbackData,
  signingSecret,
  actorTelegramUserId,
  telegramChatId,
  telegramMessageId,
  now = new Date(),
} = {}) {
  const parsed = verifyCallbackData(callbackData, signingSecret);
  if (!parsed) return { claimed: false, reason: "invalid_callback" };
  const approval = await prismaClient.telegramApprovalAction.findUnique({ where: { publicId: parsed.publicId } });
  if (!approval) return { claimed: false, reason: "not_found" };
  const purpose = PURPOSES[approval.purpose];
  const action = purpose?.actions?.[parsed.actionCode];
  if (!action) return { claimed: false, reason: "action_not_allowed", approval };
  const timestamp = new Date(now);
  if (new Date(approval.expiresAt).getTime() <= timestamp.getTime()) {
    await prismaClient.telegramApprovalAction.updateMany({
      where: { id: approval.id, status: "PENDING" },
      data: { status: "EXPIRED", failureCode: "approval_expired" },
    });
    return { claimed: false, reason: "expired", approval: { ...approval, status: "EXPIRED" } };
  }
  const actor = normalizeTelegramIdentity(actorTelegramUserId);
  const chat = normalizeTelegramIdentity(telegramChatId);
  if (!actor || !chat) return { claimed: false, reason: "invalid_actor", approval };
  const update = await prismaClient.telegramApprovalAction.updateMany({
    where: { id: approval.id, status: "PENDING", decidedAction: null, expiresAt: { gt: timestamp } },
    data: {
      status: "PROCESSING",
      decidedAction: action,
      actorTelegramUserId: actor,
      telegramChatId: chat,
      telegramMessageId: telegramMessageId == null ? null : String(telegramMessageId).slice(0, 40),
      claimedAt: timestamp,
    },
  });
  if (update.count !== 1) {
    const latest = await prismaClient.telegramApprovalAction.findUnique({ where: { id: approval.id } });
    return { claimed: false, reason: "already_decided", approval: latest || approval };
  }
  const claimedApproval = await prismaClient.telegramApprovalAction.findUnique({ where: { id: approval.id } });
  return { claimed: true, action, approval: claimedApproval };
}

async function finishTelegramApproval(prismaClient, approvalId, { status, result = {}, failureCode = "", now = new Date() } = {}) {
  const terminal = ["COMPLETED", "REJECTED", "FAILED"].includes(String(status || "")) ? String(status) : "FAILED";
  const safeFailure = String(failureCode || "").trim().toLowerCase().replace(/[^a-z0-9_.:-]+/g, "_").slice(0, 100);
  return prismaClient.telegramApprovalAction.update({
    where: { id: String(approvalId || "") },
    data: {
      status: terminal,
      result: result && typeof result === "object" && !Array.isArray(result) ? result : {},
      failureCode: terminal === "FAILED" ? safeFailure || "action_failed" : null,
      decidedAt: new Date(now),
    },
  });
}

async function finalizeProcessingTelegramApproval(
  prismaClient,
  approvalId,
  { status, result = {}, failureCode = "", now = new Date() } = {}
) {
  const terminal = ["COMPLETED", "FAILED"].includes(String(status || "")) ? String(status) : "FAILED";
  const safeFailure = String(failureCode || "").trim().toLowerCase().replace(/[^a-z0-9_.:-]+/g, "_").slice(0, 100);
  const update = await prismaClient.telegramApprovalAction.updateMany({
    where: { id: String(approvalId || ""), status: "PROCESSING", decidedAction: "merge" },
    data: {
      status: terminal,
      result: result && typeof result === "object" && !Array.isArray(result) ? result : {},
      failureCode: terminal === "FAILED" ? safeFailure || "action_failed" : null,
      decidedAt: new Date(now),
    },
  });
  return { finalized: update.count === 1 };
}

async function bindTelegramMessage(prismaClient, approvalId, messageId) {
  const safeMessageId = String(messageId == null ? "" : messageId).trim();
  if (!safeMessageId) return null;
  return prismaClient.telegramApprovalAction.update({
    where: { id: String(approvalId || "") },
    data: { telegramMessageId: safeMessageId.slice(0, 40) },
  });
}

function prLandingAuthorization(payload = {}, secret = "") {
  const canonical = JSON.stringify({
    approval_id: validPublicId(payload.approval_id),
    pr_number: String(Number(payload.pr_number) || ""),
    head_sha: String(payload.head_sha || "").trim().toLowerCase(),
    approved_at: String(payload.approved_at || "").trim(),
  });
  return crypto.createHmac("sha256", requireSigningSecret(secret)).update(canonical).digest("hex");
}

module.exports = {
  CALLBACK_PREFIX,
  DEFAULT_TTL_MS,
  PURPOSES,
  authorizeTelegramCallback,
  bindTelegramMessage,
  buildApprovalKeyboard,
  buildCallbackData,
  claimTelegramApproval,
  createTelegramApproval,
  finalizeProcessingTelegramApproval,
  finishTelegramApproval,
  normalizeTelegramIdentity,
  parseCallbackData,
  prLandingAuthorization,
  sanitizeContext,
  validOpenUrl,
  verifyCallbackData,
  verifyTelegramWebhookSecret,
};
