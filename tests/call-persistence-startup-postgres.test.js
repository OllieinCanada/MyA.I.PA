const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const enabled = process.env.RUN_DATABASE_INTEGRATION === '1';

test('PostgreSQL recovers first-query expiry without repeating a Call write', { skip: !enabled, timeout: 20000 }, async () => {
  const { PrismaClient } = require('@prisma/client');
  const { persistCall, mergeCallData } = require('../server/callPersistence');
  const prisma = new PrismaClient();
  const suffix = crypto.randomUUID();
  let business, caller;
  let attempts = 0, reads = 0, writes = 0;
  const failures = [];
  try {
    business = await prisma.business.create({ data: { name: `CI startup ${suffix}`, phone: `ci-business-${suffix}`, timezone: 'America/Toronto' } });
    caller = await prisma.caller.create({ data: { phone: `ci-caller-${suffix}` } });
    const identity = { businessId: business.id, callerId: caller.id, externalProvider: 'vapi', externalId: `ci-startup-${suffix}` };
    const data = { ...identity, startedAt: new Date(), status: 'COMPLETED', durationSec: 60, endedReason: 'customer-ended-call' };
    const db = { $transaction: (fn, options) => {
      const attempt = ++attempts;
      assert.deepEqual(options, { maxWait: 500, timeout: 3000 });
      return prisma.$transaction(async tx => {
        if (attempt === 1) await delay(3250);
        return fn({ $queryRaw: tx.$queryRaw.bind(tx), call: {
          findMany: (...args) => { reads++; return tx.call.findMany(...args); },
          create: (...args) => { writes++; return tx.call.create(...args); },
        } });
      }, options).catch(error => { failures.push(error); throw error; });
    } };
    const saved = await persistCall({ db, identity, createData: data, updateData: row => mergeCallData(row, data) });
    assert.equal(failures.length, 1);
    assert.equal(failures[0].code, 'P2028');
    assert.match(failures[0].meta.error, /expired transaction/i);
    assert.equal(attempts, 2);
    assert.equal(reads, 1);
    assert.equal(writes, 1);
    assert.equal(saved.status, 'COMPLETED');
    assert.equal(saved.endedReason, 'customer-ended-call');
    assert.equal(await prisma.call.count({ where: { externalProvider: 'vapi', externalId: identity.externalId } }), 1);
  } finally {
    if (business) await prisma.business.delete({ where: { id: business.id } });
    if (caller) await prisma.caller.delete({ where: { id: caller.id } });
    await prisma.$disconnect();
  }
});
