const REQUEST_TIMEOUT_MS = 7_000;
const { noticeRequest } = require('./telegramNotice');
const { redactIncidentText, buildIncidentTelegramAlert } = require('./incidentAlerts');

function safeBotToken(value) {
  return String(value || "").trim();
}

async function telegramBotRequest(method, payload, { token, fetchImpl = fetch } = {}) {
  const botToken = safeBotToken(token);
  if (!botToken) return { ok: false, skipped: true, reason: "telegram_not_configured" };
  const response = await fetchImpl(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    ...(method === 'sendPhoto' ? noticeRequest(payload.text, { chatId: payload.chat_id, replyMarkup: payload.reply_markup })
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload || {}) }),
    signal: typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
      ? AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      : undefined,
  });
  const body = await response.json().catch(error => {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') throw error;
    return {};
  });
  if (!response.ok || body?.ok !== true || (method === 'sendPhoto' && (!Number.isSafeInteger(body?.result?.message_id) || body.result.message_id <= 0))) {
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
  const reasonCode = String(text || '').match(/Action stopped safely[\s\S]*Reason:\s*([A-Z0-9_]+)/)?.[1];
  const message = reasonCode ? buildIncidentTelegramAlert({
    title: 'Action stopped', reasonCode,
    impact: 'Completion was not confirmed. No automatic retry.',
    nextAction: 'Open details. Check the saved failure before retrying.',
  }) : text;
  return telegramBotRequest("sendPhoto", {
    chat_id: String(chatId || "").trim(),
    text: redactIncidentText(message, { multiline: true, maxLength: 3_900 }),
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
  // No retry: a timed-out configuration request may already have completed.
  async function stageRequest(stage, payload) {
    try { return await telegramBotRequest(stage, payload, options); } catch (cause) {
      const timeout = cause?.name === 'TimeoutError';
      const error = new Error('Telegram webhook request did not complete verification.');
      error.code = timeout ? 'TELEGRAM_WEBHOOK_REQUEST_TIMEOUT'
        : cause?.code === 'TELEGRAM_ACTION_RESPONSE_FAILED' ? cause.code : 'TELEGRAM_WEBHOOK_REQUEST_FAILED';
      error.stage = stage;
      throw error;
    }
  }
  const configured = await stageRequest("setWebhook", {
    url: url.toString(),
    secret_token: secret,
    allowed_updates: ["callback_query"],
    drop_pending_updates: false,
  });
  if (configured.result !== true) {
    const error = new Error("Telegram did not accept the guarded-actions webhook.");
    error.code = "TELEGRAM_WEBHOOK_CONFIGURATION_FAILED";
    error.stage = 'setWebhook';
    throw error;
  }
  const verified = await stageRequest("getWebhookInfo", {});
  if (String(verified.result?.url || "") !== url.toString()) {
    const error = new Error("Telegram did not retain the guarded-actions webhook URL.");
    error.code = "TELEGRAM_WEBHOOK_VERIFICATION_FAILED";
    error.stage = 'getWebhookInfo';
    throw error;
  }
  return { configured: true, url: url.toString() };
}

function telegramWebhookFailureDiagnostics(error) {
  const stage = ['setWebhook', 'getWebhookInfo'].includes(error?.stage) ? error.stage : 'configuration_validation';
  const codes = ['TELEGRAM_WEBHOOK_REQUEST_TIMEOUT', 'TELEGRAM_WEBHOOK_REQUEST_FAILED',
    'TELEGRAM_ACTION_RESPONSE_FAILED', 'TELEGRAM_WEBHOOK_CONFIGURATION_FAILED', 'TELEGRAM_WEBHOOK_VERIFICATION_FAILED'];
  return {
    code: codes.includes(error?.code) ? error.code : 'TELEGRAM_WEBHOOK_CONFIGURATION_FAILED',
    stage,
    outcome: stage === 'setWebhook' ? 'configuration_unconfirmed'
      : stage === 'getWebhookInfo' ? 'verification_unavailable' : 'not_requested',
    automaticRetry: false,
  };
}

module.exports = {
  answerTelegramCallback,
  clearTelegramApprovalButtons,
  ensureTelegramActionWebhook,
  sendTelegramOwnerStatus,
  telegramBotRequest,
  telegramWebhookFailureDiagnostics,
};
