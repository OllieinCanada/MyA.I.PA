const { test } = require('node:test');
const assert = require('node:assert/strict');
const { collectFinance, usageMetric, validateVerified, decorate, createFinanceService, registerFinanceRoutes } = require('../server/providerFinance');
const NOW = Date.parse('2026-10-28T01:00:00Z'), at = new Date(NOW).toISOString();
const env = { TWILIO_ACCOUNT_SID: `AC${'1'.repeat(32)}`, TWILIO_AUTH_TOKEN: 'synthetic-test-token',
  VAPI_API_KEY: 'synthetic-vapi', MAKE_AUDIT_API_TOKEN: 'synthetic-make', FINANCE_MAKE_ORGANIZATION_ID: '123', FINANCE_MAKE_ZONE: 'us2' };
const costRow = { _sum: { vapiCost: 0 }, _count: { _all: 2, vapiCost: 1 }, _max: { costSyncedAt: new Date(NOW - 60000) } };
function memoryDb() {
  const rows = new Map();
  return { rows, call: { aggregate: async () => costRow }, runtimeStore: {
    findMany: async ({ where }) => where.key.in.filter(key => rows.has(key)).map(key => ({ key, data: structuredClone(rows.get(key)) })),
    upsert: async ({ where, create, update }) => { rows.set(where.key, structuredClone(rows.has(where.key) ? update.data : create.data)); },
  } };
}
const usage = { next_page_uri: null, usage_records: [{ category: 'totalprice', price: '4.2', price_unit: 'usd', as_of: at },
  { category: 'calls', price: '2', price_unit: 'usd', as_of: at }, { category: 'phonenumbers', price: '2.2', price_unit: 'usd', as_of: at }] };
function fixtureFetch(requests = []) {
  return async (url, options) => {
    requests.push({ url, ...options });
    let body;
    if (url.includes('Balance.json')) body = { balance: '0', currency: 'USD', secret: 'must-not-escape' };
    else if (url.includes('/Usage/')) body = usage;
    else if (url.includes('/subscription')) body = { product: { nextBill: '2026-11-01T00:00:00Z', price: { price: 10.59, currencyCode: 'CAD', period: 'month' } }, customer: { email: 'private@example.invalid' } };
    else body = { data: [{ centicredits: 125 }, { centicredits: 0 }] };
    return { ok: true, json: async () => body };
  };
}
test('collectors are bounded GET-only, redact provider payloads and retain zero as a real amount', async () => {
  const requests = [], result = await collectFinance({ prisma: memoryDb(), env, fetchImpl: fixtureFetch(requests), now: new Date(NOW) });
  assert.equal(requests.length, 5);
  for (const r of requests) { assert.equal(r.method, 'GET'); assert.equal(r.redirect, 'error'); assert.ok(r.signal); }
  assert.equal(result.updates.twilio.balance.value, 0);
  assert.equal(result.updates.vapi.spendMonth.value, 0);
  assert.equal(result.updates.vapi.spendMonth.pricedCalls, 1);
  assert.equal(result.updates.make.rollingCredits.value, 1.25);
  assert.equal(result.updates.make.planPrice.currency, 'CAD');
  assert.equal(result.updates.twilio.spendMonth.value, 4.2); // not parent + children
  assert.ok(!JSON.stringify(result).includes('must-not-escape'));
  assert.ok(!JSON.stringify(result).includes('private@example'));
  assert.ok(!JSON.stringify(result).includes('synthetic-'));
});
test('usage refuses partial pagination, duplicated totals, unknown prices and missing freshness', () => {
  for (const body of [{ ...usage, next_page_uri: '/next' }, { usage_records: [...usage.usage_records, usage.usage_records[0]] },
    { usage_records: [{ category: 'totalprice', price: null }] }, { usage_records: [{ category: 'totalprice', price: 0, price_unit: 'usd' }] }]) assert.throws(() => usageMetric(body, at));
});
test('unconfigured, failed and empty sources are unknown, never invented zero balances', async () => {
  const db = memoryDb(); db.call.aggregate = async () => ({ _sum: { vapiCost: null }, _count: { _all: 0, vapiCost: 0 }, _max: { costSyncedAt: null } });
  const result = await collectFinance({ prisma: db, env: {}, fetchImpl: () => { throw Error('unexpected'); }, now: new Date(NOW) });
  assert.ok(result.errors.twilio); assert.ok(result.errors.make);
  assert.equal(result.updates.vapi.spendMonth.value, null);
  assert.equal(result.updates.vapi.spendMonth.observedAt, null);
  const denied = await collectFinance({ prisma: db, env, fetchImpl: async () => ({ ok: false, status: 401 }), now: new Date(NOW) });
  assert.ok(denied.errors.make); assert.equal(Object.keys(denied.updates.make || {}).length, 0);
});
test('verified facts reject extra fields, coercion, future checks, invalid currencies and negative values', () => {
  const valid = { provider: 'vapi', field: 'balance', value: 11.6, currency: 'USD', observedAt: at };
  assert.equal(validateVerified(valid, NOW).value, 11.6);
  for (const changes of [{ value: null }, { value: '' }, { value: [] }, { value: true }, { value: -1 }, { value: Infinity }, { value: 1000001 },
    { currency: 'ZZZ' }, { observedAt: new Date(NOW + 120000).toISOString() }, { secret: 'no' }, { provider: 'unknown' }, { provider: '__proto__' }, { provider: 'constructor' }, { field: 'autoRecharge' }]) {
    assert.throws(() => validateVerified({ ...valid, ...changes }, NOW));
  }
});
test('refresh is single-flight, cached and durable across service restarts', async () => {
  const db = memoryDb(); let clock = NOW, calls = 0, release;
  const collect = async () => { calls++; await new Promise(resolve => { release = resolve; }); return { updates: { twilio: { balance: { value: 12, currency: 'USD', source: 'twilio_balance_api', observedAt: at } } }, errors: {}, attemptedAt: at }; };
  const service = createFinanceService({ prisma: db, env, clock: () => clock, collect });
  const first = await service.read(); assert.equal(first.refreshing, true);
  await service.read(); assert.equal(calls, 1); release(); await service.waitForRefresh();
  assert.equal((await service.read()).providers[0].metrics.balance.value, 12);
  const restarted = createFinanceService({ prisma: db, env, clock: () => clock, collect });
  assert.equal((await restarted.read()).providers[0].metrics.balance.value, 12); assert.equal(calls, 1);
  const switched = createFinanceService({ prisma: db, env: { ...env, TWILIO_ACCOUNT_SID: `AC${'2'.repeat(32)}` }, clock: () => clock, collect });
  assert.equal((await switched.read()).providers[0].metrics.balance, undefined); release(); await switched.waitForRefresh();
  clock += 301000; await service.read(); release(); await service.waitForRefresh(); assert.equal(calls, 3);
});
test('provider errors retain previous values with stale warnings, including previous-period costs', async () => {
  const metric = { value: 4.2, currency: 'USD', source: 'twilio_usage_api', observedAt: at, periodStart: '2026-10-01' };
  const providers = decorate({ providers: { twilio: { spendMonth: metric } }, errors: { twilio: ['usage unavailable'] } }, [], NOW);
  assert.equal(providers[0].metrics.spendMonth.value, 4.2); assert.equal(providers[0].metrics.spendMonth.stale, true);
  assert.equal(decorate({ providers: { twilio: { spendMonth: metric } } }, [], Date.parse('2026-11-01T01:00:00Z'))[0].metrics.spendMonth.previousPeriod, true);
});
test('manual verification persists with original timestamp; currencies never mix in budget warnings', async () => {
  const db = memoryDb(), service = createFinanceService({ prisma: db, env, clock: () => NOW, collect: async () => ({ updates: {}, errors: {}, attemptedAt: at }) });
  await service.save({ provider: 'vapi', field: 'balance', value: 11.6, currency: 'USD', observedAt: at });
  const page = await service.read(); await service.waitForRefresh();
  assert.equal(page.providers[1].metrics.balance.value, 11.6); assert.equal(page.providers[1].metrics.balance.source, 'dashboard_verified');
  assert.equal(page.providers[1].metrics.balance.observedAt, at);
  assert.ok(!JSON.stringify([...db.rows.keys()]).includes(env.VAPI_API_KEY));
  const providers = decorate({ providers: { twilio: { balance: { value: 5, currency: 'USD', observedAt: at }, reserve: { value: 100, currency: 'CAD', observedAt: at } } } }, [], NOW);
  assert.equal(providers[0].warnings.length, 0);
});
test('routes protect every read/write, reject CSRF and safely classify a storage failure', async () => {
  const routes = {}, admin = () => {}, app = { get: (path, ...handlers) => { routes[path] = handlers; }, post: (path, ...handlers) => { routes[path] = handlers; } };
  let saves = 0;
  registerFinanceRoutes({ app, requireAdmin: admin, isAllowedOrigin: origin => origin === 'https://example.invalid', service: { read: async () => { throw Error('secret db message'); }, save: async () => { saves++; } } });
  assert.equal(routes['/api/admin/finances'][0], admin); assert.equal(routes['/api/admin/finances/verified'][0], admin);
  const response = () => ({ code: 200, set(name, value) { this[name] = value; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; } });
  let res = response(); await routes['/api/admin/finances'].at(-1)({}, res); assert.equal(res.code, 503); assert.equal(res['Cache-Control'], 'no-store'); assert.ok(!JSON.stringify(res.body).includes('secret db'));
  res = response(); await routes['/api/admin/finances/verified'].at(-1)({ headers: {}, body: {} }, res); assert.equal(res.code, 403); assert.equal(saves, 0);
  res = response(); await routes['/api/admin/finances/verified'].at(-1)({ headers: { origin: 'https://example.invalid', 'x-myaipa-finance': '1' }, body: { provider: 'vapi', field: 'balance', value: 0, currency: 'USD', observedAt: new Date(Date.now() - 60000).toISOString() } }, res);
  assert.equal(res.code, 200); assert.equal(saves, 1);
});
test('a hung refresh is bounded, and storage failures do not masquerade as durable snapshots', async () => {
  const db = memoryDb();
  const hung = createFinanceService({ prisma: db, env, clock: () => NOW, timeoutMs: 20, collect: () => new Promise(() => {}) });
  await hung.read(); await hung.waitForRefresh();
  const failed = await hung.read(); assert.equal(failed.refreshing, false); assert.match(failed.persistenceWarning, /refresh failed/);
  db.runtimeStore.upsert = async () => { throw Error('database failure secret'); };
  const service = createFinanceService({ prisma: db, env, clock: () => NOW,
    collect: async () => ({ updates: { twilio: { balance: { value: 12, currency: 'USD', source: 'twilio_balance_api', observedAt: at } } }, errors: {}, attemptedAt: at }) });
  await service.read(); await service.waitForRefresh(); const result = await service.read();
  assert.equal(result.providers[0].metrics.balance.value, 12); assert.match(result.persistenceWarning, /not be confirmed saved/);
  assert.ok(!JSON.stringify(result).includes('failure secret'));
});
test('partial collector failures preserve old per-provider observations rather than a false successful refresh', async () => {
  const db = memoryDb(); let clock = NOW, fail = false;
  const service = createFinanceService({ prisma: db, env, clock: () => clock, collect: async () => fail
    ? { updates: {}, errors: { twilio: ['Credit balance unavailable'] }, attemptedAt: new Date(clock).toISOString() }
    : { updates: { twilio: { balance: { value: 15, currency: 'USD', observedAt: at, source: 'twilio_balance_api' } } }, errors: {}, attemptedAt: at } });
  await service.read(); await service.waitForRefresh(); fail = true; clock += 301000;
  await service.read(); await service.waitForRefresh(); const result = await service.read();
  assert.equal(result.providers[0].metrics.balance.value, 15);
  assert.equal(result.providers[0].metrics.balance.observedAt, at);
  assert.equal(result.providers[0].metrics.balance.stale, true);
});
test('credential-derived namespaces use a slow KDF and never reuse a different Vapi account namespace', async () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '../server/providerFinance.js'), 'utf8');
  assert.match(source, /scryptSync/); assert.doesNotMatch(source, /createHash/);
  const db = memoryDb();
  const collect = async () => ({ updates: {}, errors: {}, attemptedAt: at });
  const original = createFinanceService({ prisma: db, env, clock: () => NOW, collect });
  await original.save({ provider: 'vapi', field: 'balance', value: 12, currency: 'USD', observedAt: at });
  const switched = createFinanceService({ prisma: db, env: { ...env, VAPI_API_KEY: 'different-synthetic-vapi-key' }, clock: () => NOW, collect });
  const result = await switched.read(); await switched.waitForRefresh();
  assert.equal(result.providers[1].metrics.balance, undefined);
  const persisted = JSON.stringify([...db.rows]);
  assert.ok(!persisted.includes('different-synthetic-vapi-key'));
  assert.ok(!persisted.includes(env.VAPI_API_KEY));
});
test('actual HTTP routes enforce admin access and reject cross-origin submissions', async () => {
  const express = require('express'), app = express(); app.use(express.json());
  const db = memoryDb(), service = createFinanceService({ prisma: db, env, collect: async () => ({ updates: {}, errors: {}, attemptedAt: new Date().toISOString() }) });
  registerFinanceRoutes({ app, service, requireAdmin: (req, res, next) => req.headers['x-test-admin'] === 'synthetic' ? next() : res.status(401).json({ error: 'Unauthorized' }), isAllowedOrigin: origin => origin === 'https://admin.example.invalid' });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/admin/finances`;
  try {
    assert.equal((await fetch(base)).status, 401);
    assert.equal((await fetch(`${base}/verified`, { method: 'POST' })).status, 401);
    const headers = { 'x-test-admin': 'synthetic', 'content-type': 'application/json', origin: 'https://untrusted.invalid', 'x-myaipa-finance': '1' };
    const body = JSON.stringify({ provider: 'vapi', field: 'balance', value: 11.6, currency: 'USD', observedAt: new Date().toISOString() });
    assert.equal((await fetch(`${base}/verified`, { method: 'POST', headers, body })).status, 403);
    headers.origin = 'https://admin.example.invalid';
    assert.equal((await fetch(`${base}/verified`, { method: 'POST', headers, body })).status, 200);
    const response = await fetch(base, { headers: { 'x-test-admin': 'synthetic' } });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await response.json()).finances.providers[1].metrics.balance.value, 11.6);
    assert.equal((await fetch(`${base}/verified`, { method: 'POST', headers, body: JSON.stringify({ ...JSON.parse(body), cardNumber: 'not-allowed' }) })).status, 400);
    await service.waitForRefresh();
  } finally { server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)); }
});
