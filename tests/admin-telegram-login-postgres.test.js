const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto'), express = require('express');
const { registerTelegramLogin, PATH, POST_PATH, COOKIE, PREFIX } = require('../server/adminTelegramLogin');
test('actual PostgreSQL Telegram proof claim is one-use across clients and fresh browser challenges, including lost acknowledgements', {
  skip: process.env.RUN_ADMIN_TELEGRAM_POSTGRES !== '1', timeout: 30000,
}, async t => {
  const url = new URL(process.env.DATABASE_URL);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname));
  assert.ok((process.env.GITHUB_ACTIONS === 'true' && url.pathname === '/ci') || /^\/myaipa_recovery_drill_[a-z0-9_]+$/.test(url.pathname));
  const { PrismaClient } = require('@prisma/client'), clients = [new PrismaClient(), new PrismaClient()];
  const scope = PREFIX + 'fixture-' + crypto.randomUUID() + ':', servers = [];
  const config = { enabled: true, botToken: 'fixture-only-bot', ownerId: '1234567', chatId: '1234567', sessionSecret: 'fixture-session-secret-more-than-32-characters' };
  let sessions = 0, loseAck = false;
  const at = Date.now();
  function proof(offset) {
    const p = { id: config.ownerId, first_name: 'Fixture', auth_date: String(Math.floor((at - offset) / 1000)) };
    p.hash = crypto.createHmac('sha256', crypto.createHash('sha256').update(config.botToken).digest())
      .update(Object.keys(p).sort().map(k => k + '=' + p[k]).join('\n')).digest('hex'); return p;
  }
  async function start(client) {
    const app = express(); app.use(express.json());
    registerTelegramLogin({ app, getConfig: () => config,
      prisma: { runtimeStore: { create: async ({ data }) => {
        const result = await client.runtimeStore.create({ data: { ...data, key: scope + data.key.slice(PREFIX.length) } });
        if (loseAck) throw Error('Synthetic acknowledgement lost after commit'); return result;
      } } }, setSession: res => { sessions++; res.setHeader('Set-Cookie', 'fixture=session; HttpOnly'); },
    });
    const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); }); servers.push(server);
    return 'http://127.0.0.1:' + server.address().port;
  }
  t.after(async () => {
    try { for (const server of servers) await new Promise(resolve => server.close(resolve));
      await clients[0].runtimeStore.deleteMany({ where: { key: { startsWith: scope } } }); }
    finally { await Promise.all(clients.map(p => p.$disconnect())); }
  });
  const bases = await Promise.all(clients.map(start));
  async function access(base) { const r = await fetch(base + PATH); const cookie = r.headers.get('set-cookie').split(';')[0]; return { cookie, challenge: cookie.slice(COOKIE.length + 1) }; }
  async function redeem(base, browser, p) { return fetch(base + POST_PATH, { method: 'POST',
    headers: { origin: 'https://api.myaipa.ca', 'content-type': 'application/json', 'x-myaipa-telegram': '1', cookie: browser.cookie },
    body: JSON.stringify({ challenge: browser.challenge, proof: p, target: { tab: 'signups' } }) }); }
  const browsers = await Promise.all(bases.map(access)), p = proof(0);
  const responses = await Promise.all(Array.from({ length: 12 }, (_, i) => redeem(bases[i % 2], browsers[i % 2], p)));
  assert.equal(responses.filter(r => r.status === 200).length, 1); assert.equal(sessions, 1);
  assert.ok(responses.filter(r => r.status !== 200).every(r => r.status === 401 && !r.headers.get('set-cookie')));
  await clients[1].$disconnect(); const restarted = await start(clients[1]);
  assert.equal((await redeem(restarted, await access(restarted), p)).status, 401);
  loseAck = true; const uncertain = proof(1000), browser = await access(bases[0]);
  const lost = await redeem(bases[0], browser, uncertain); assert.equal(lost.status, 503); assert.equal(lost.headers.get('set-cookie'), null);
  loseAck = false; assert.equal((await redeem(restarted, await access(restarted), uncertain)).status, 401); assert.equal(sessions, 1);
  const rows = await clients[0].runtimeStore.findMany({ where: { key: { startsWith: scope } } });
  assert.equal(rows.length, 2); assert.ok(!JSON.stringify(rows).includes(p.hash));
  assert.ok(rows.every(r => Object.keys(r.data).sort().join(',') === 'expiresAt,usedAt'));
});
