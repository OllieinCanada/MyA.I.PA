const REQUEST_TIMEOUT_MS = 7_000;
const { performance } = require('node:perf_hooks');
const { webhookIdentity } = require('./telegramWebhookState');
const { noticeRequest } = require('./telegramNotice');
const { redactIncidentText, buildIncidentTelegramAlert } = require('./incidentAlerts');

function safeBotToken(value) {
  return String(value || "").trim();
}

async function telegramBotRequest(method, payload, { token, fetchImpl = fetch } = {}) {
  const botToken = safeBotToken(token);
  if (!botToken) return { ok: false, skipped: true, reason: "telegram_not_configured" };
  const started = performance.now();
  let phase = 'awaiting_headers';
  try {
    const response = await fetchImpl(`https://api.telegram.org/bot${botToken}/${method}`, {
      method: "POST",
      ...(method === 'sendPhoto' ? noticeRequest(payload.text, { chatId: payload.chat_id, replyMarkup: payload.reply_markup })
        : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload || {}) }),
      signal: typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
        ? AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        : undefined,
    });
    phase = 'response_body';
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
  } catch (cause) {
    // Never retain the raw fetch error: it can embed the credential-bearing URL.
    const error = new Error('Telegram request did not complete.');
    error.name = ['TimeoutError', 'AbortError'].includes(cause?.name) ? cause.name : 'Error';
    error.code = cause?.code === 'TELEGRAM_ACTION_RESPONSE_FAILED' ? cause.code : 'TELEGRAM_REQUEST_FAILED';
    if (cause?.code === 'TELEGRAM_ACTION_RESPONSE_FAILED') error.statusCode = 502;
    error.phase = phase;
    error.elapsedMs = Math.max(0, Math.round(performance.now() - started));
    const networkCode = cause?.cause?.code || cause?.code;
    if (['ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT',
      'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT'].includes(networkCode)) error.networkCode = networkCode;
    throw error;
  }
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
  if (url.protocol !== "https:" || url.username || url.password || url.hash || !/^[A-Za-z0-9_-]{32,256}$/.test(secret)) {
    throw new TypeError("Telegram guarded actions require a credential-free HTTPS URL and a 32-character webhook secret.");
  }
  const state = options.stateStore;
  const expected = webhookIdentity({ token: options.token, webhookUrl: url.toString(), webhookSecret: secret });
  if (!state || state.fingerprint !== expected.fingerprint ||
      ['read', 'claim', 'acknowledge', 'verify'].some(name => typeof state[name] !== 'function')) {
    throw Object.assign(new Error('Durable Telegram webhook state is required.'),
      { code: 'TELEGRAM_WEBHOOK_STATE_UNAVAILABLE', stage: 'configuration_state' });
  }
  // No retry: a timed-out configuration request may already have completed.
  async function stageRequest(stage, payload) {
    try { return await telegramBotRequest(stage, payload, options); } catch (cause) {
      const timeout = ['TimeoutError', 'AbortError'].includes(cause?.name);
      const error = new Error('Telegram webhook request did not complete verification.');
      error.code = timeout ? 'TELEGRAM_WEBHOOK_REQUEST_TIMEOUT'
        : cause?.code === 'TELEGRAM_ACTION_RESPONSE_FAILED' ? cause.code : 'TELEGRAM_WEBHOOK_REQUEST_FAILED';
      error.stage = stage;
      error.phase = cause?.phase;
      error.elapsedMs = cause?.elapsedMs;
      error.networkCode = cause?.networkCode;
      throw error;
    }
  }
  const matches = info => info?.url === url.toString() && Array.isArray(info.allowed_updates) &&
    info.allowed_updates.length === 1 && info.allowed_updates[0] === 'callback_query';
  const inspectFirst = () => Object.assign(new Error('Inspect saved Telegram configuration before changing it.'),
    { code: 'TELEGRAM_WEBHOOK_STATE_INSPECT_FIRST', stage: 'configuration_state' });
  const success = reused => ({ configured: true, url: url.toString(), reused,
    configurationAcknowledged: true, liveCallbackVerified: false });

  // A failed read is not permission to overwrite an unknown configuration.
  const before = await stageRequest('getWebhookInfo', {});
  const prior = await state.read();
  if (prior) {
    if (prior.status === 'uncertain') throw inspectFirst();
    if (prior.fingerprint === expected.fingerprint) {
      if (!matches(before.result)) throw inspectFirst();
      if (prior.status === 'acknowledged') await state.verify(prior.operationId);
      return success(true);
    }
    if (prior.status !== 'verified') throw inspectFirst();
  }
  const attempt = await state.claim(prior);
  let configured;
  try {
    configured = await stageRequest("setWebhook", {
      url: url.toString(),
      secret_token: secret,
      allowed_updates: ["callback_query"],
      drop_pending_updates: false,
    });
  } catch (error) {
    // Read-only readback, never a second setWebhook. URL/update visibility does
    // not establish acceptance of the unobservable secret after a lost reply.
    try {
      const after = await stageRequest('getWebhookInfo', {});
      error.readback = matches(after.result) ? 'matches_public_configuration' : 'configuration_mismatch';
    } catch { error.readback = 'unavailable'; }
    throw error;
  }
  if (configured.result !== true) {
    const error = new Error("Telegram did not accept the guarded-actions webhook.");
    error.code = "TELEGRAM_WEBHOOK_CONFIGURATION_FAILED";
    error.stage = 'setWebhook';
    throw error;
  }
  await state.acknowledge(attempt.operationId);
  const verified = await stageRequest("getWebhookInfo", {});
  if (!matches(verified.result)) {
    const error = new Error("Telegram did not retain the guarded-actions webhook URL.");
    error.code = "TELEGRAM_WEBHOOK_VERIFICATION_FAILED";
    error.stage = 'getWebhookInfo';
    throw error;
  }
  await state.verify(attempt.operationId);
  return success(false);
}

function telegramWebhookFailureDiagnostics(error) {
  const stage = ['setWebhook', 'getWebhookInfo', 'configuration_state'].includes(error?.stage) ? error.stage : 'configuration_validation';
  const codes = ['TELEGRAM_WEBHOOK_REQUEST_TIMEOUT', 'TELEGRAM_WEBHOOK_REQUEST_FAILED',
    'TELEGRAM_ACTION_RESPONSE_FAILED', 'TELEGRAM_WEBHOOK_CONFIGURATION_FAILED', 'TELEGRAM_WEBHOOK_VERIFICATION_FAILED',
    'TELEGRAM_WEBHOOK_STATE_UNAVAILABLE', 'TELEGRAM_WEBHOOK_STATE_INVALID', 'TELEGRAM_WEBHOOK_STATE_BUSY',
    'TELEGRAM_WEBHOOK_STATE_CONFLICT', 'TELEGRAM_WEBHOOK_STATE_INSPECT_FIRST'];
  return {
    code: codes.includes(error?.code) ? error.code : 'TELEGRAM_WEBHOOK_CONFIGURATION_FAILED',
    stage,
    outcome: stage === 'setWebhook' ? 'configuration_unconfirmed'
      : stage === 'getWebhookInfo' ? 'verification_unavailable' : stage === 'configuration_state' ? 'state_inspection_required' : 'not_requested',
    automaticRetry: false,
    ...(stage === 'configuration_state' ? {
      ...(['read', 'claim', 'acknowledge', 'verify'].includes(error?.databaseOperation) ? { databaseOperation: error.databaseOperation } : {}),
      ...(['transaction_start', 'lock', 'read', 'validate', 'write', 'commit'].includes(error?.databasePhase) ? { databasePhase: error.databasePhase } : {}),
      ...(['P1000', 'P1001', 'P1002', 'P1008', 'P1010', 'P1011', 'P1017', 'P2002', 'P2010', 'P2024', 'P2028', 'P2034'].includes(error?.databaseCode)
        ? { databaseCode: error.databaseCode } : {}),
      ...(error?.maxWaitMs === 2_000 && error?.timeoutMs === 5_000 ? { maxWaitMs: error.maxWaitMs, timeoutMs: error.timeoutMs } : {}),
    } : {}),
    ...(['awaiting_headers', 'response_body'].includes(error?.phase) ? { phase: error.phase } : {}),
    ...(Number.isSafeInteger(error?.elapsedMs) && error.elapsedMs >= 0 ? { elapsedMs: error.elapsedMs } : {}),
    ...(['matches_public_configuration', 'configuration_mismatch', 'unavailable'].includes(error?.readback) ? { readback: error.readback } : {}),
    ...(['ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT',
      'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT'].includes(error?.networkCode) ? { networkCode: error.networkCode } : {}),
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
