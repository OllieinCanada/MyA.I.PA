'use strict';
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');

const failure = code => Object.assign(new Error('Telegram webhook state requires inspection.'), { code, stage: 'configuration_state' });
const HASH = /^[a-f0-9]{64}$/;
// A small metadata-only transaction: no provider I/O or retries. Leave room for
// ordinary startup contention without allowing an unbounded database wait.
const TRANSACTION_OPTIONS = Object.freeze({ maxWait: 2_000, timeout: 5_000 });
const STATE_CODES = new Set(['TELEGRAM_WEBHOOK_STATE_UNAVAILABLE', 'TELEGRAM_WEBHOOK_STATE_INVALID',
  'TELEGRAM_WEBHOOK_STATE_BUSY', 'TELEGRAM_WEBHOOK_STATE_CONFLICT', 'TELEGRAM_WEBHOOK_STATE_INSPECT_FIRST']);
const DATABASE_CODES = new Set(['P1000', 'P1001', 'P1002', 'P1008', 'P1010', 'P1011', 'P1017',
  'P2002', 'P2010', 'P2024', 'P2028', 'P2034']);

function stateFailure(error, operation, phase, started, transaction = false) {
  // Never attach the original error/cause/meta: they can contain credentials,
  // SQL, provider identifiers or connection strings. Phase is the last local
  // operation attempted, NOT proof of rollback or of a lost commit's outcome.
  return Object.assign(failure(STATE_CODES.has(error?.code) ? error.code : 'TELEGRAM_WEBHOOK_STATE_UNAVAILABLE'), {
    databaseOperation: operation,
    databasePhase: phase,
    elapsedMs: Math.max(0, Math.round(performance.now() - started)),
    ...(transaction ? { maxWaitMs: TRANSACTION_OPTIONS.maxWait, timeoutMs: TRANSACTION_OPTIONS.timeout } : {}),
    ...(DATABASE_CODES.has(error?.code) ? { databaseCode: error.code } : {}),
  });
}

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
  async function change(operation, work) {
    const started = performance.now();
    let phase = 'transaction_start';
    try {
      return await prisma.$transaction(async tx => {
        phase = 'lock';
        const rows = await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(hashtext(${key})) AS acquired`;
        if (rows?.length !== 1 || rows[0].acquired !== true) throw failure('TELEGRAM_WEBHOOK_STATE_BUSY');
        phase = 'read';
        const current = await readFrom(tx);
        phase = 'validate';
        const result = await work(current, async data => {
          phase = 'write';
          return save(tx, data);
        });
        phase = 'commit';
        return result;
      }, TRANSACTION_OPTIONS);
    } catch (error) {
      // No retries, including a lost database commit acknowledgement.
      throw stateFailure(error, operation, phase, started, true);
    }
  }
  const save = (tx, data) => tx.runtimeStore.upsert({ where: { key }, create: { key, data }, update: { data } });
  async function transition(operation, operationId, from, to) {
    return change(operation, async (current, persist) => {
      if (!current || current.fingerprint !== fingerprint || current.operationId !== operationId || current.status !== from)
        throw failure('TELEGRAM_WEBHOOK_STATE_CONFLICT');
      const data = { ...current, status: to, updatedAt: new Date().toISOString() };
      await persist(data);
      return data;
    });
  }
  return {
    fingerprint,
    async read() {
      const started = performance.now();
      try { return await readFrom(prisma); }
      catch (error) { throw stateFailure(error, 'read', 'read', started); }
    },
    async claim(expected) {
      return change('claim', async (current, persist) => {
        if (JSON.stringify(current) !== JSON.stringify(expected)) throw failure('TELEGRAM_WEBHOOK_STATE_CONFLICT');
        if (current && (current.status !== 'verified' || current.fingerprint === fingerprint))
          throw failure('TELEGRAM_WEBHOOK_STATE_INSPECT_FIRST');
        const data = { version: 1, fingerprint, operationId: crypto.randomUUID(), status: 'uncertain', updatedAt: new Date().toISOString() };
        // Intent commits BEFORE the network write. It never expires into retry
        // permission; a restart/second instance sees the same uncertainty fence.
        await persist(data);
        return data;
      });
    },
    acknowledge: operationId => transition('acknowledge', operationId, 'uncertain', 'acknowledged'),
    verify: operationId => transition('verify', operationId, 'acknowledged', 'verified'),
  };
}

module.exports = { createTelegramWebhookState, webhookIdentity };
