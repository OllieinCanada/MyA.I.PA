const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const enabled = process.env.RUN_DATABASE_INTEGRATION === '1';

async function fixture(t) {
  const url = new URL(process.env.DATABASE_URL);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname));
  assert.match(url.pathname, /^\/myaipa_recovery_drill_[a-z0-9_]+$/);
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  const suffix = crypto.randomUUID();
  const business = await prisma.business.create({ data: { name: `Synthetic persistence ${suffix}`, phone: `fixture-${suffix}`, timezone: 'America/Toronto' } });
  const caller = await prisma.caller.create({ data: { phone: `fixture-caller-${suffix}` } });
  t.after(async () => {
    await prisma.business.delete({ where: { id: business.id } });
    await prisma.caller.delete({ where: { id: caller.id } });
    await prisma.$disconnect();
  });
  const identity = { businessId: business.id, callerId: caller.id, externalProvider: 'vapi', externalId: suffix };
  const data = { ...identity, startedAt: new Date(), status: 'COMPLETED', durationSec: 42,
    structuredData: { confirmed: 'synthetic latest value' }, toolCallSummary: { count: 0 } };
  return { prisma, identity, data };
}

test('three bounded database round trips fit the original transaction budget with injected latency', { skip: !enabled, timeout: 15000 }, async t => {
  const { prisma, identity, data } = await fixture(t);
  const { persistCall, mergeCallData } = require('../server/callPersistence');
  await prisma.call.create({ data });
  let roundTrips = 0;
  const db = { $transaction: (fn, options) => {
    assert.deepEqual(options, { maxWait: 500, timeout: 3000 });
    return prisma.$transaction(tx => fn({
      $queryRaw: async (...args) => { roundTrips++; await delay(550); return tx.$queryRaw(...args); },
      call: {
        update: async args => {
          assert.equal(args.include, undefined);
          roundTrips++; await delay(550); return tx.call.update(args);
        },
        findMany: () => assert.fail('no extra unlocked ORM read'),
        findUnique: () => assert.fail('no relation round trips inside the lock'),
      },
    }), options);
  } };
  const saved = await persistCall({ db, identity, createData: data,
    updateData: row => mergeCallData(row, { ...data, aiSummary: 'Synthetic latest summary' }) });
  assert.equal(roundTrips, 3);
  assert.equal(saved.aiSummary, 'Synthetic latest summary');
  assert.deepEqual(saved.structuredData, data.structuredData);
  assert.equal(await prisma.call.count({ where: { externalId: identity.externalId } }), 1);
});

test('a busy call-row lock fails within its bound without retrying or changing the record', { skip: !enabled, timeout: 15000 }, async t => {
  const { prisma, identity, data } = await fixture(t);
  const { Client } = require('pg');
  const { persistCall, mergeCallData } = require('../server/callPersistence');
  const saved = await prisma.call.create({ data });
  const blocker = new Client({ connectionString: process.env.DATABASE_URL });
  let attempts = 0;
  try {
    await blocker.connect(); await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM "Call" WHERE id = $1 FOR UPDATE', [saved.id]);
    const db = { $transaction: (fn, options) => { attempts++; return prisma.$transaction(fn, options); } };
    await assert.rejects(persistCall({ db, identity, createData: data,
      updateData: row => mergeCallData(row, { aiSummary: 'Must not be committed' }) }),
    error => error.code === 'P2010' && error.meta?.code === '55P03');
    assert.equal(attempts, 1);
    assert.equal((await prisma.call.findUnique({ where: { id: saved.id } })).aiSummary, null);
  } finally { await blocker.query('ROLLBACK').catch(() => {}); await blocker.end(); }
});
