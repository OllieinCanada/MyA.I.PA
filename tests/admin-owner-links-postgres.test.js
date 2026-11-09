const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const { registerOwnerLinkRoutes, issueOwnerLink, REDEEM_PATH, RECEIPT_PREFIX } = require('../server/adminOwnerLinks');

test('real PostgreSQL claim is one-use across independent clients, app reinitialization and uncertain acknowledgements', {
  skip: process.env.RUN_ADMIN_OWNER_LINKS_POSTGRES !== '1', timeout: 30000,
}, async t => {
  const url = new URL(process.env.DATABASE_URL);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname));
  assert.ok((process.env.GITHUB_ACTIONS === 'true' && url.pathname === '/ci') || /^\/myaipa_recovery_drill_[a-z0-9_]+$/.test(url.pathname));
  const { PrismaClient } = require('@prisma/client');
  const clients = [new PrismaClient(), new PrismaClient()];
  const scope = RECEIPT_PREFIX + 'fixture-' + crypto.randomUUID() + ':', servers = [];
  const config = { adminPassword: 'fixture-owner-password', sessionSecret: 'fixture-owner-secret-more-than-32-characters' };
  let sessions = 0, loseAck = false;
  const runtime = client => ({ create: async ({ data }) => {
    const result = await client.runtimeStore.create({ data: { ...data, key: scope + data.key.slice(RECEIPT_PREFIX.length) } });
    if (loseAck) throw new Error('Synthetic acknowledgement lost after real commit');
    return result;
  } });
  async function start(client) {
    const app = express(); app.use(express.json());
    registerOwnerLinkRoutes({ app, prisma: { runtimeStore: runtime(client) }, getConfig: () => config,
      setSession: res => { sessions++; res.setHeader('Set-Cookie', 'fixture=session; HttpOnly'); } });
    const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    servers.push(server); return `http://127.0.0.1:${server.address().port}`;
  }
  t.after(async () => {
    try {
      for (const server of servers) await new Promise(resolve => server.close(resolve));
      await clients[0].runtimeStore.deleteMany({ where: { key: { startsWith: scope } } });
    } finally { await Promise.all(clients.map(client => client.$disconnect())); }
  });
  const bases = await Promise.all(clients.map(start));
  const token = () => new URL(issueOwnerLink({ config }).url).hash.slice(1);
  const redeem = (base, value) => fetch(base + REDEEM_PATH, { method: 'POST',
    headers: { origin: 'https://api.myaipa.ca', 'content-type': 'application/json', 'x-myaipa-owner-link': '1' }, body: JSON.stringify({ token: value }) });
  const value = token();
  const responses = await Promise.all(Array.from({ length: 12 }, (_, i) => redeem(bases[i % 2], value)));
  assert.equal(responses.filter(r => r.status === 200).length, 1); assert.equal(sessions, 1);
  assert.ok(responses.filter(r => r.status !== 200).every(r => r.status === 401 && !r.headers.get('set-cookie')));
  const records = await clients[0].runtimeStore.findMany({ where: { key: { startsWith: scope } } });
  assert.equal(records.length, 1); assert.ok(!JSON.stringify(records).includes(value));
  await clients[1].$disconnect();
  // Reconnect and register a fresh app: no in-memory replay protection involved.
  const restarted = await start(clients[1]); assert.equal((await redeem(restarted, value)).status, 401); assert.equal(sessions, 1);
  loseAck = true; const uncertain = token();
  const failed = await redeem(bases[0], uncertain); assert.equal(failed.status, 503); assert.equal(failed.headers.get('set-cookie'), null);
  loseAck = false; assert.equal((await redeem(restarted, uncertain)).status, 401); assert.equal(sessions, 1);
});
