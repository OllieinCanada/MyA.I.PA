'use strict';
const crypto = require('node:crypto');

const failure = code => Object.assign(new Error('Telegram webhook state requires inspection.'), { code, stage: 'configuration_state' });
const HASH = /^[a-f0-9]{64}$/;

function webhookIdentity({ token, webhookUrl, webhookSecret }) {
  const credential = String(token || '').trim();
  const botId = credential.match(/^([1-9][0-9]*):[A-Za-z0-9_-]+$/)?.[1];
  if (!botId) throw failure('TELEGRAM_WEBHOOK_STATE_UNAVAILABLE');
  return {
    // Stable across credential rotation for the SAME bot: an uncertain old
    // attempt must not be bypassed by replacing either credential or secret.
    key: 'telegram-webhook-state:v1:' + crypto.createHash('sha256').update(botId).digest('hex'),
    fingerprint: crypto.createHmac('sha256', webhookSecret)
      .update(JSON.stringify(['telegram-webhook:v1', credential, webhookUrl, ['callback_query']])).digest('hex'),
  };
}

function validateState(value) {
  if (value === null) return null;
  if (!value || value.version !== 1 || !HASH.test(value.fingerprint) ||
      !/^[a-f0-9-]{36}$/.test(value.operationId) ||
      !['uncertain', 'acknowledged', 'verified'].includes(value.status) ||
      !Number.isFinite(Date.parse(value.updatedAt))) throw failure('TELEGRAM_WEBHOOK_STATE_INVALID');
  return value;
}

// Only cooperating application writers are coordinated here. An administrator
// changing Telegram directly can change the secret without a visible URL change.
// This receipt proves an API acknowledgement, NOT a live authenticated callback.
function createTelegramWebhookState({ prisma, token, webhookUrl, webhookSecret }) {
  const { key, fingerprint } = webhookIdentity({ token, webhookUrl, webhookSecret });
  const readFrom = async db => validateState((await db.runtimeStore.findUnique({ where: { key } }))?.data ?? null);
  async function change(work) {
    try {
      return await prisma.$transaction(async tx => {
        const rows = await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(hashtext(${key})) AS acquired`;
        if (rows?.length !== 1 || rows[0].acquired !== true) throw failure('TELEGRAM_WEBHOOK_STATE_BUSY');
        return work(tx, await readFrom(tx));
      }, { maxWait: 1_000, timeout: 2_000 });
    } catch (error) {
      // No retries, including a lost database commit acknowledgement.
      if (String(error?.code || '').startsWith('TELEGRAM_WEBHOOK_STATE_')) throw error;
      throw failure('TELEGRAM_WEBHOOK_STATE_UNAVAILABLE');
    }
  }
  const save = (tx, data) => tx.runtimeStore.upsert({ where: { key }, create: { key, data }, update: { data } });
  async function transition(operationId, from, to) {
    return change(async (tx, current) => {
      if (!current || current.fingerprint !== fingerprint || current.operationId !== operationId || current.status !== from)
        throw failure('TELEGRAM_WEBHOOK_STATE_CONFLICT');
      const data = { ...current, status: to, updatedAt: new Date().toISOString() };
      await save(tx, data);
      return data;
    });
  }
  return {
    fingerprint,
    async read() {
      try { return await readFrom(prisma); }
      catch (error) { throw failure(error?.code === 'TELEGRAM_WEBHOOK_STATE_INVALID' ? error.code : 'TELEGRAM_WEBHOOK_STATE_UNAVAILABLE'); }
    },
    async claim(expected) {
      return change(async (tx, current) => {
        if (JSON.stringify(current) !== JSON.stringify(expected)) throw failure('TELEGRAM_WEBHOOK_STATE_CONFLICT');
        if (current && (current.status !== 'verified' || current.fingerprint === fingerprint))
          throw failure('TELEGRAM_WEBHOOK_STATE_INSPECT_FIRST');
        const data = { version: 1, fingerprint, operationId: crypto.randomUUID(), status: 'uncertain', updatedAt: new Date().toISOString() };
        // Intent commits BEFORE the network write. It never expires into retry
        // permission; a restart/second instance sees the same uncertainty fence.
        await save(tx, data);
        return data;
      });
    },
    acknowledge: operationId => transition(operationId, 'uncertain', 'acknowledged'),
    verify: operationId => transition(operationId, 'acknowledged', 'verified'),
  };
}

module.exports = { createTelegramWebhookState, webhookIdentity };
