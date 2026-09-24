const crypto = require("crypto");

const { redactIncidentText } = require("./incidentAlerts");
const {
  MAX_OUTBOX_ITEMS,
  normalizeInlineKeyboard,
  postTelegramItem,
  retryDelayMs,
  sanitizeButtonText,
  validateAdminUrl,
} = require("./telegramOutbox");

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function publicItem(row) {
  return {
    id: row.id,
    dedupeHash: row.dedupeHash,
    text: row.text,
    adminUrl: row.adminUrl || "",
    buttonText: row.buttonText || "",
    ...(row.inlineKeyboard ? { inlineKeyboard: row.inlineKeyboard } : {}),
    createdAt: row.createdAt.getTime(),
    nextAttemptAt: row.nextAttemptAt.getTime(),
    attempts: row.attempts,
  };
}

async function enqueueTelegramMessageDb(prismaClient, {
  text,
  adminUrl = "",
  buttonText = "",
  dedupeKey = "",
  inlineKeyboard = null,
  now = Date.now(),
} = {}) {
  const safeText = redactIncidentText(text, { multiline: true, maxLength: 3_900 });
  if (!safeText) throw new TypeError("A redacted Telegram message is required.");
  const safeAdminUrl = validateAdminUrl(adminUrl);
  const safeButtonText = sanitizeButtonText(buttonText);
  const safeInlineKeyboard = normalizeInlineKeyboard(inlineKeyboard);
  const dedupeHash = sha256(dedupeKey || `${safeText}\n${safeAdminUrl}\n${safeButtonText}\n${JSON.stringify(safeInlineKeyboard || {})}`);
  const duplicate = await prismaClient.telegramOutboxMessage.findUnique({ where: { dedupeHash } });
  if (duplicate) {
    return { queued: false, duplicate: true, delivered: duplicate.status === "DELIVERED", id: duplicate.id };
  }
  const pending = await prismaClient.telegramOutboxMessage.count({ where: { status: { in: ["PENDING", "RETRY", "PROCESSING"] } } });
  if (pending >= MAX_OUTBOX_ITEMS) return { queued: false, duplicate: false, overflow: true, pending };
  try {
    const row = await prismaClient.telegramOutboxMessage.create({
      data: {
        id: crypto.randomBytes(12).toString("hex"),
        dedupeHash,
        text: safeText,
        adminUrl: safeAdminUrl || null,
        buttonText: safeButtonText || null,
        inlineKeyboard: safeInlineKeyboard || undefined,
        nextAttemptAt: new Date(now),
      },
    });
    return { queued: true, duplicate: false, id: row.id, pending: pending + 1 };
  } catch (error) {
    if (String(error?.code || "") === "P2002") {
      const row = await prismaClient.telegramOutboxMessage.findUnique({ where: { dedupeHash } });
      return { queued: false, duplicate: true, delivered: row?.status === "DELIVERED", id: row?.id || "" };
    }
    throw error;
  }
}

async function getTelegramDeliveryReceiptDb(prismaClient, itemId) {
  const id = /^[a-f0-9]{24}$/i.test(String(itemId || "")) ? String(itemId).toLowerCase() : "";
  if (!id) return null;
  const row = await prismaClient.telegramOutboxMessage.findFirst({ where: { id, status: "DELIVERED" } });
  return row ? { id, dedupeHash: row.dedupeHash, deliveredAt: row.deliveredAt?.getTime(), providerMessageId: row.providerMessageId } : null;
}

async function processTelegramOutboxDb(prismaClient, {
  token,
  chatId,
  fetchImpl = fetch,
  now = Date.now(),
  maxBatch = 10,
} = {}) {
  const safeToken = String(token || "").trim();
  const safeChatId = String(chatId || "").trim();
  if (!safeToken || !safeChatId) return { processed: 0, sent: 0, retried: 0, permanentFailures: 0, skipped: true, reason: "telegram_not_configured" };
  const timestamp = Number(now || Date.now());
  const due = await prismaClient.telegramOutboxMessage.findMany({
    where: {
      OR: [
        { status: { in: ["PENDING", "RETRY"] }, nextAttemptAt: { lte: new Date(timestamp) } },
        { status: "PROCESSING", leaseExpiresAt: { lte: new Date(timestamp) } },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: Math.max(1, Math.min(100, Number(maxBatch) || 10)),
  });
  const result = { processed: 0, sent: 0, sentItemIds: [], retried: 0, permanentFailures: 0, busy: false };
  for (const candidate of due) {
    const claimToken = crypto.randomBytes(18).toString("base64url");
    const claimed = await prismaClient.telegramOutboxMessage.updateMany({
      where: {
        id: candidate.id,
        OR: [
          { status: { in: ["PENDING", "RETRY"] }, nextAttemptAt: { lte: new Date(timestamp) } },
          { status: "PROCESSING", leaseExpiresAt: { lte: new Date(timestamp) } },
        ],
      },
      data: { status: "PROCESSING", claimToken, leaseExpiresAt: new Date(timestamp + 60_000) },
    });
    if (claimed.count !== 1) continue;
    const delivery = await postTelegramItem(publicItem(candidate), { token: safeToken, chatId: safeChatId, fetchImpl });
    result.processed += 1;
    if (delivery.success) {
      await prismaClient.telegramOutboxMessage.updateMany({
        where: { id: candidate.id, claimToken, status: "PROCESSING" },
        data: { status: "DELIVERED", deliveredAt: new Date(timestamp), providerMessageId: delivery.providerMessageId, claimToken: null, leaseExpiresAt: null },
      });
      result.sent += 1;
      result.sentItemIds.push(candidate.id);
      continue;
    }
    const attempts = candidate.attempts + 1;
    await prismaClient.telegramOutboxMessage.updateMany({
      where: { id: candidate.id, claimToken, status: "PROCESSING" },
      data: {
        status: delivery.retry ? "RETRY" : "FAILED",
        attempts,
        lastAttemptAt: new Date(timestamp),
        lastStatus: delivery.status || null,
        lastFailure: String(delivery.code || "telegram_error").slice(0, 40),
        nextAttemptAt: new Date(timestamp + retryDelayMs(attempts, delivery.retryAfter)),
        claimToken: null,
        leaseExpiresAt: null,
      },
    });
    if (delivery.retry) result.retried += 1;
    else result.permanentFailures += 1;
  }
  result.remaining = await prismaClient.telegramOutboxMessage.count({ where: { status: { in: ["PENDING", "RETRY", "PROCESSING"] } } });
  const oldDelivered = await prismaClient.telegramOutboxMessage.findMany({ where: { status: "DELIVERED" }, orderBy: { deliveredAt: "desc" }, skip: 500, select: { id: true } });
  if (oldDelivered.length) await prismaClient.telegramOutboxMessage.deleteMany({ where: { id: { in: oldDelivered.map((row) => row.id) } } });
  return result;
}

module.exports = {
  enqueueTelegramMessageDb,
  getTelegramDeliveryReceiptDb,
  processTelegramOutboxDb,
};
