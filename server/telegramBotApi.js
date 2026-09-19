const REQUEST_TIMEOUT_MS = 7_000;

function safeBotToken(value) {
  return String(value || "").trim();
}

async function telegramBotRequest(method, payload, { token, fetchImpl = fetch } = {}) {
  const botToken = safeBotToken(token);
  if (!botToken) return { ok: false, skipped: true, reason: "telegram_not_configured" };
  const response = await fetchImpl(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {}),
    signal: typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
      ? AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      : undefined,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok !== true) {
    const error = new Error(`Telegram ${method} was not accepted (${response.status}).`);
    error.code = "TELEGRAM_ACTION_RESPONSE_FAILED";
    error.statusCode = 502;
    throw error;
  }
  return { ok: true, result: body.result };
}

function answerTelegramCallback(callbackQueryId, text, options = {}) {
  const id = String(callbackQueryId || "").trim();
  if (!id) return Promise.resolve({ ok: false, skipped: true, reason: "callback_id_missing" });
  return telegramBotRequest("answerCallbackQuery", {
    callback_query_id: id,
    text: String(text || "").replace(/[\r\n]+/g, " ").slice(0, 180),
    show_alert: false,
  }, options);
}

function clearTelegramApprovalButtons({ chatId, messageId } = {}, options = {}) {
  if (!String(chatId || "").trim() || !Number.isSafeInteger(Number(messageId))) {
    return Promise.resolve({ ok: false, skipped: true, reason: "message_identity_missing" });
  }
  return telegramBotRequest("editMessageReplyMarkup", {
    chat_id: String(chatId),
    message_id: Number(messageId),
    reply_markup: { inline_keyboard: [] },
  }, options);
}

function sendTelegramOwnerStatus({ chatId, text, openUrl = "", openLabel = "Open details" } = {}, options = {}) {
  const url = String(openUrl || "").trim();
  return telegramBotRequest("sendMessage", {
    chat_id: String(chatId || "").trim(),
    text: String(text || "").slice(0, 3_900),
    disable_web_page_preview: true,
    ...(url.startsWith("https://") ? {
      reply_markup: { inline_keyboard: [[{ text: String(openLabel || "Open details").slice(0, 40), url }]] },
    } : {}),
  }, options);
}

async function ensureTelegramActionWebhook({ webhookUrl, webhookSecret } = {}, options = {}) {
  const secret = String(webhookSecret || "");
  let url;
  try {
    url = new URL(String(webhookUrl || "").trim());
  } catch (_error) {
    throw new TypeError("A valid Telegram webhook URL is required.");
  }
  if (url.protocol !== "https:" || url.username || url.password || secret.length < 32) {
    throw new TypeError("Telegram guarded actions require a credential-free HTTPS URL and a 32-character webhook secret.");
  }
  const configured = await telegramBotRequest("setWebhook", {
    url: url.toString(),
    secret_token: secret,
    allowed_updates: ["callback_query"],
    drop_pending_updates: false,
  }, options);
  if (configured.result !== true) {
    const error = new Error("Telegram did not accept the guarded-actions webhook.");
    error.code = "TELEGRAM_WEBHOOK_CONFIGURATION_FAILED";
    throw error;
  }
  const verified = await telegramBotRequest("getWebhookInfo", {}, options);
  if (String(verified.result?.url || "") !== url.toString()) {
    const error = new Error("Telegram did not retain the guarded-actions webhook URL.");
    error.code = "TELEGRAM_WEBHOOK_VERIFICATION_FAILED";
    throw error;
  }
  return { configured: true, url: url.toString() };
}

module.exports = {
  answerTelegramCallback,
  clearTelegramApprovalButtons,
  ensureTelegramActionWebhook,
  sendTelegramOwnerStatus,
  telegramBotRequest,
};
