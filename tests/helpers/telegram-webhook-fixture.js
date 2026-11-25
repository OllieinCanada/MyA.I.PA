'use strict';
const assert = require('node:assert/strict');
const { createTelegramWebhookState } = require('../../server/telegramWebhookState');
const config = { webhookUrl: 'https://example.invalid/callback', webhookSecret: 'w'.repeat(32) };
const token = '123456:synthetic_token';
const info = { url: config.webhookUrl, allowed_updates: ['callback_query'] };

// Synthetic Prisma protocol fixture, NOT PostgreSQL proof. Transactions can
// roll back or lose their acknowledgement after commit; no external I/O.
function database() {
  const rows = new Map(), fault = { busy: false, read: false, write: false, rollback: false, lostCommit: false };
  let locked = false;
  const store = source => ({
    async findUnique({ where }) {
      if (fault.read) throw Error('PRIVATE database URL');
      return source.has(where.key) ? { key: where.key, data: structuredClone(source.get(where.key)) } : null;
    },
    async upsert({ where, create, update }) {
      if (fault.write) throw Error('PRIVATE database URL');
      const data = structuredClone(source.has(where.key) ? update.data : create.data);
      source.set(where.key, data); return { key: where.key, data };
    },
  });
  const prisma = {
    runtimeStore: store(rows),
    async $transaction(work, options) {
      assert.deepEqual(options, { maxWait: 1000, timeout: 2000 });
      const staged = new Map(structuredClone([...rows])); let ownsLock = false;
      try {
        const value = await work({ runtimeStore: store(staged), async $queryRaw(strings) {
          assert.match(strings.join('?'), /pg_try_advisory_xact_lock/);
          if (locked || fault.busy) return [{ acquired: false }];
          locked = ownsLock = true; return [{ acquired: true }];
        } });
        if (fault.rollback) { fault.rollback = false; throw Error('PRIVATE rollback'); }
        rows.clear(); for (const [key, data] of staged) rows.set(key, data);
        if (fault.lostCommit) { fault.lostCommit = false; throw Error('PRIVATE lost commit reply'); }
        return value;
      } finally { if (ownsLock) locked = false; }
    },
  };
  return { prisma, rows, fault };
}

function fixture({ db = database(), settings = config, credential = token, handle } = {}) {
  const calls = [];
  const stateStore = createTelegramWebhookState({ prisma: db.prisma, token: credential, ...settings });
  const fetchImpl = async (url, request) => {
    const method = url.split('/').pop(), body = JSON.parse(request.body);
    assert.ok(['getWebhookInfo', 'setWebhook'].includes(method), 'No send or getUpdates allowed');
    calls.push({ method, body });
    const result = handle ? await handle(method, body, calls.length) : method === 'setWebhook' ? true : info;
    return { ok: true, status: 200, json: async () => ({ ok: true, result }) };
  };
  return { db, calls, settings, options: { token: credential, stateStore, fetchImpl }, methods: () => calls.map(call => call.method) };
}
module.exports = { config, token, info, database, fixture };
