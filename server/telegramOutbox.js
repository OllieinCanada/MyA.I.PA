const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { redactIncidentText } = require("./incidentAlerts");

const OUTBOX_VERSION = 2;
const MAX_OUTBOX_ITEMS = 500;
const MAX_BATCH_SIZE = 100;
const DEFAULT_BATCH_SIZE = 10;
const REQUEST_TIMEOUT_MS = 7_000;
const BASE_RETRY_MS = 60_000;
const MAX_RETRY_MS = 6 * 60 * 60 * 1000;
const MAX_DELIVERY_RECEIPTS = 500;
const ALLOWED_ADMIN_QUERY_KEYS = new Set(["tab", "incident"]);
const fileLocks = new Map();
const processingFiles = new Set();

function resolveFilePath(filePath) {
  const value = String(filePath || "").trim();
  if (!value) throw new TypeError("A Telegram outbox filePath is required.");
  return path.resolve(value);
}

function nowMs(value) {
  if (value instanceof Date) return value.getTime();
  if (value == null || value === "") return Date.now();
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function sanitizeButtonText(value) {
  return redactIncidentText(value, { maxLength: 40 }) || "Open exact issue";
}

function safeAdminParam(key, value) {
  if (!ALLOWED_ADMIN_QUERY_KEYS.has(String(key || "").toLowerCase())) return false;
  const text = String(value || "");
  if (!text || text.length > 100 || !/^[a-z0-9_.:-]+$/i.test(text)) return false;
  if (String(key).toLowerCase() === "incident" && !/^[a-f0-9]{24}$/i.test(text)) return false;
  return true;
}

function validateQueryParams(params) {
  for (const [key, value] of params) {
    if (!safeAdminParam(key, value)) return false;
  }
  return true;
}

function validateAdminUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.length > 2_048) return "";
  try {
    const url = new URL(raw);
    const localHttp = url.protocol === "http:"
      && ["localhost", "127.0.0.1", "::1"].includes(url.hostname.toLowerCase());
    if (url.protocol !== "https:" && !localHttp) return "";
    if (url.username || url.password) return "";
    if (!validateQueryParams(url.searchParams)) return "";

    const hash = String(url.hash || "");
    const hashQueryIndex = hash.indexOf("?");
    if (hashQueryIndex >= 0) {
      const fragmentParams = new URLSearchParams(hash.slice(hashQueryIndex + 1));
      if (!validateQueryParams(fragmentParams)) return "";
    }
    return url.toString();
  } catch (_error) {
    return "";
  }
}

function emptyOutbox() {
  return { version: OUTBOX_VERSION, items: [], deliveryReceipts: [] };
}

function normalizeDeliveryReceipt(receipt) {
  const id = /^[a-f0-9]{24}$/i.test(String(receipt?.id || ""))
    ? String(receipt.id).toLowerCase()
    : "";
  const dedupeHash = /^[a-f0-9]{64}$/i.test(String(receipt?.dedupeHash || ""))
    ? String(receipt.dedupeHash).toLowerCase()
    : "";
  const deliveredAt = Number(receipt?.deliveredAt);
  return id && Number.isFinite(deliveredAt)
    ? { id, deliveredAt, ...(dedupeHash ? { dedupeHash } : {}) }
    : null;
}

function normalizeStoredItem(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const id = /^[a-f0-9]{24}$/i.test(String(item.id || "")) ? String(item.id).toLowerCase() : "";
  const dedupeHash = /^[a-f0-9]{64}$/i.test(String(item.dedupeHash || ""))
    ? String(item.dedupeHash).toLowerCase()
    : "";
  const text = redactIncidentText(item.text, { multiline: true, maxLength: 3_900 });
  if (!id || !dedupeHash || !text) return null;
  const createdAt = Number.isFinite(Number(item.createdAt)) ? Number(item.createdAt) : Date.now();
  const nextAttemptAt = Number.isFinite(Number(item.nextAttemptAt)) ? Number(item.nextAttemptAt) : createdAt;
  const attempts = Math.max(0, Math.min(1_000, Number(item.attempts) || 0));
  const lastStatus = item.lastStatus != null && Number.isInteger(Number(item.lastStatus))
    ? Number(item.lastStatus)
    : null;
  return {
    id,
    dedupeHash,
    text,
    adminUrl: validateAdminUrl(item.adminUrl),
    buttonText: sanitizeButtonText(item.buttonText),
    createdAt,
    nextAttemptAt,
    attempts,
    ...(Number.isFinite(Number(item.lastAttemptAt)) ? { lastAttemptAt: Number(item.lastAttemptAt) } : {}),
    ...(lastStatus != null ? { lastStatus } : {}),
    ...(typeof item.lastFailure === "string" && /^[a-z0-9_]{1,40}$/i.test(item.lastFailure)
      ? { lastFailure: item.lastFailure.toLowerCase() }
      : {}),
  };
}

function readOutbox(filePath) {
  if (!fs.existsSync(filePath)) return emptyOutbox();
  const raw = fs.readFileSync(filePath, "utf8");
  if (!raw.trim()) return emptyOutbox();
  const parsed = JSON.parse(raw);
  const items = (Array.isArray(parsed?.items) ? parsed.items : [])
    .map(normalizeStoredItem)
    .filter(Boolean)
    .slice(-MAX_OUTBOX_ITEMS);
  const deliveryReceipts = (Array.isArray(parsed?.deliveryReceipts) ? parsed.deliveryReceipts : [])
    .map(normalizeDeliveryReceipt)
    .filter(Boolean)
    .slice(-MAX_DELIVERY_RECEIPTS);
  return { version: OUTBOX_VERSION, items, deliveryReceipts };
}

function writeOutboxAtomic(filePath, outbox) {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  const safeOutbox = {
    version: OUTBOX_VERSION,
    items: (Array.isArray(outbox?.items) ? outbox.items : [])
      .map(normalizeStoredItem)
      .filter(Boolean)
      .slice(-MAX_OUTBOX_ITEMS),
    deliveryReceipts: (Array.isArray(outbox?.deliveryReceipts) ? outbox.deliveryReceipts : [])
      .map(normalizeDeliveryReceipt)
      .filter(Boolean)
      .slice(-MAX_DELIVERY_RECEIPTS),
  };
  const tempPath = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(tempPath, `${JSON.stringify(safeOutbox, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    fs.renameSync(tempPath, filePath);
  } finally {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  }
}

async function withFileLock(filePath, task) {
  const key = resolveFilePath(filePath).toLowerCase();
  const previous = fileLocks.get(key);
  let release;
  const turn = new Promise((resolve) => { release = resolve; });
  fileLocks.set(key, turn);
  if (previous) await previous;
  try {
    return await task();
  } finally {
    release();
    if (fileLocks.get(key) === turn) fileLocks.delete(key);
  }
}

async function enqueueTelegramMessage({
  filePath,
  text,
  adminUrl = "",
  buttonText = "",
  dedupeKey = "",
  now,
} = {}) {
  const resolvedPath = resolveFilePath(filePath);
  const safeText = redactIncidentText(text, { multiline: true, maxLength: 3_900 });
  if (!safeText) throw new TypeError("A redacted Telegram message is required.");
  const safeAdminUrl = validateAdminUrl(adminUrl);
  const safeButtonText = sanitizeButtonText(buttonText);
  const dedupeHash = sha256(dedupeKey || `${safeText}\n${safeAdminUrl}\n${safeButtonText}`);
  const timestamp = nowMs(now);

  return withFileLock(resolvedPath, async () => {
    const outbox = readOutbox(resolvedPath);
    const duplicate = outbox.items.find((item) => item.dedupeHash === dedupeHash);
    if (duplicate) {
      return {
        queued: false,
        duplicate: true,
        id: duplicate.id,
        pending: outbox.items.length,
      };
    }
    const deliveredDuplicate = outbox.deliveryReceipts.find((receipt) => receipt.dedupeHash === dedupeHash);
    if (deliveredDuplicate) {
      return {
        queued: false,
        duplicate: true,
        delivered: true,
        id: deliveredDuplicate.id,
        pending: outbox.items.length,
      };
    }
    if (outbox.items.length >= MAX_OUTBOX_ITEMS) {
      return {
        queued: false,
        duplicate: false,
        overflow: true,
        pending: outbox.items.length,
      };
    }
    const item = {
      id: sha256(`${dedupeHash}:${timestamp}:${crypto.randomBytes(8).toString("hex")}`).slice(0, 24),
      dedupeHash,
      text: safeText,
      adminUrl: safeAdminUrl,
      buttonText: safeButtonText,
      createdAt: timestamp,
      nextAttemptAt: timestamp,
      attempts: 0,
    };
    outbox.items.push(item);
    writeOutboxAtomic(resolvedPath, outbox);
    return {
      queued: true,
      duplicate: false,
      id: item.id,
      pending: outbox.items.length,
    };
  });
}

function retryDelayMs(attempts, retryAfterSeconds = 0) {
  const exponent = Math.max(0, Math.min(16, Number(attempts) - 1));
  const exponential = Math.min(MAX_RETRY_MS, BASE_RETRY_MS * (2 ** exponent));
  const providerDelay = Math.max(0, Number(retryAfterSeconds) || 0) * 1000;
  return Math.min(MAX_RETRY_MS, Math.max(exponential, providerDelay));
}

function failureKind({ response, body, error }) {
  if (error) {
    const timedOut = ["AbortError", "TimeoutError"].includes(String(error.name || ""))
      || /timeout|timed out/i.test(String(error.message || ""));
    return { retry: true, code: timedOut ? "timeout" : "network_error", status: null, retryAfter: 0 };
  }
  const status = Number(response?.status) || 0;
  // Telegram also uses HTTP 400 for repairable configuration problems such as
  // an incorrect chat id. Preserve every 4xx incident so correcting the bot or
  // chat configuration can recover it instead of silently deleting it.
  const retryAfter = status === 429 ? Number(body?.parameters?.retry_after) || 0 : 0;
  if (status === 429) return { retry: true, code: "http_429", status, retryAfter };
  if (status >= 400 && status < 500) return { retry: true, code: `http_${status}`, status, retryAfter: 0 };
  if (status >= 500) return { retry: true, code: `http_${status}`, status, retryAfter: 0 };
  if (!response?.ok) return { retry: true, code: status ? `http_${status}` : "http_error", status: status || null, retryAfter: 0 };
  return { retry: true, code: "telegram_not_ok", status: status || null, retryAfter: 0 };
}

async function postTelegramItem(item, { token, chatId, fetchImpl }) {
  const body = {
    chat_id: chatId,
    text: item.text,
    disable_web_page_preview: true,
    ...(item.adminUrl ? {
      reply_markup: {
        inline_keyboard: [[{ text: item.buttonText, url: item.adminUrl }]],
      },
    } : {}),
  };
  let response;
  let data = {};
  try {
    response = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
        ? AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        : undefined,
    });
    data = await response.json().catch(() => ({}));
  } catch (error) {
    return { success: false, ...failureKind({ error }) };
  }
  if (response.ok && data?.ok === true) {
    return { success: true, status: Number(response.status) || 200 };
  }
  return { success: false, ...failureKind({ response, body: data }) };
}

async function mutateItem(filePath, itemId, mutation) {
  return withFileLock(filePath, async () => {
    const outbox = readOutbox(filePath);
    const index = outbox.items.findIndex((item) => item.id === itemId);
    if (index < 0) return { found: false, remaining: outbox.items.length };
    mutation(outbox.items, index);
    writeOutboxAtomic(filePath, outbox);
    return { found: true, remaining: outbox.items.length };
  });
}

async function markItemDelivered(filePath, itemId, deliveredAt) {
  return withFileLock(filePath, async () => {
    const outbox = readOutbox(filePath);
    const index = outbox.items.findIndex((item) => item.id === itemId);
    if (index < 0) return { found: false, remaining: outbox.items.length };
    const [deliveredItem] = outbox.items.splice(index, 1);
    outbox.deliveryReceipts = [
      ...(Array.isArray(outbox.deliveryReceipts) ? outbox.deliveryReceipts : []),
      { id: itemId, dedupeHash: deliveredItem.dedupeHash, deliveredAt },
    ].slice(-MAX_DELIVERY_RECEIPTS);
    writeOutboxAtomic(filePath, outbox);
    return { found: true, remaining: outbox.items.length };
  });
}

function hasTelegramDeliveryReceipt(filePath, itemId) {
  const id = /^[a-f0-9]{24}$/i.test(String(itemId || "")) ? String(itemId).toLowerCase() : "";
  if (!id) return false;
  try {
    return readOutbox(resolveFilePath(filePath)).deliveryReceipts.some((receipt) => receipt.id === id);
  } catch (_error) {
    return false;
  }
}

async function processTelegramOutbox({
  filePath,
  token,
  chatId,
  fetchImpl = fetch,
  now,
  maxBatch = DEFAULT_BATCH_SIZE,
} = {}) {
  const resolvedPath = resolveFilePath(filePath);
  const guardKey = resolvedPath.toLowerCase();
  if (processingFiles.has(guardKey)) {
    return { processed: 0, sent: 0, retried: 0, permanentFailures: 0, busy: true };
  }
  const safeToken = String(token || "").trim();
  const safeChatId = String(chatId || "").trim();
  if (!safeToken || !safeChatId) {
    return {
      processed: 0,
      sent: 0,
      retried: 0,
      permanentFailures: 0,
      skipped: true,
      reason: "telegram_not_configured",
    };
  }

  processingFiles.add(guardKey);
  const timestamp = nowMs(now);
  const batchSize = Math.max(1, Math.min(MAX_BATCH_SIZE, Number(maxBatch) || DEFAULT_BATCH_SIZE));
  const result = {
    processed: 0,
    sent: 0,
    sentItemIds: [],
    retried: 0,
    permanentFailures: 0,
    busy: false,
  };
  try {
    const dueItems = await withFileLock(resolvedPath, async () => readOutbox(resolvedPath).items
      .filter((item) => item.nextAttemptAt <= timestamp)
      .slice(0, batchSize));

    for (const item of dueItems) {
      const delivery = await postTelegramItem(item, { token: safeToken, chatId: safeChatId, fetchImpl });
      const attemptedAt = now == null || now === "" ? Date.now() : timestamp;
      result.processed += 1;
      if (delivery.success) {
        await markItemDelivered(resolvedPath, item.id, attemptedAt);
        result.sent += 1;
        result.sentItemIds.push(item.id);
        continue;
      }
      if (!delivery.retry) {
        await mutateItem(resolvedPath, item.id, (items, index) => items.splice(index, 1));
        result.permanentFailures += 1;
        continue;
      }
      await mutateItem(resolvedPath, item.id, (items, index) => {
        const attempts = Math.max(0, Number(items[index].attempts) || 0) + 1;
        items[index] = {
          ...items[index],
          attempts,
          lastAttemptAt: attemptedAt,
          lastStatus: delivery.status,
          lastFailure: delivery.code,
          nextAttemptAt: attemptedAt + retryDelayMs(attempts, delivery.retryAfter),
        };
      });
      result.retried += 1;
    }
    result.remaining = await withFileLock(resolvedPath, async () => readOutbox(resolvedPath).items.length);
    return result;
  } finally {
    processingFiles.delete(guardKey);
  }
}

function resetTelegramOutboxLocksForTests() {
  fileLocks.clear();
  processingFiles.clear();
}

module.exports = {
  MAX_OUTBOX_ITEMS,
  enqueueTelegramMessage,
  hasTelegramDeliveryReceipt,
  processTelegramOutbox,
  resetTelegramOutboxLocksForTests,
  validateAdminUrl,
};
