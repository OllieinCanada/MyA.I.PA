const { test } = require('node:test');
const assert = require('node:assert/strict');
const { collectFinance, usageMetric, validateVerified, decorate, createFinanceService, registerFinanceRoutes } = require('../server/providerFinance');
const NOW = Date.parse('2026-10-28T01:00:00Z'), at = new Date(NOW).toISOString();
const env = { TWILIO_ACCOUNT_SID: `AC${'1'.repeat(32)}`, TWILIO_AUTH_TOKEN: 'synthetic-test-token',
  VAPI_API_KEY: 'synthetic-vapi', MAKE_AUDIT_API_TOKEN: 'synthetic-make', FINANCE_MAKE_ORGANIZATION_ID: '123', FINANCE_MAKE_ZONE: 'us2' };
const costRow = { _sum: { vapiCost: 0 }, _count: { _all: 2, vapiCost: 1 }, _max: { costSyncedAt: new Date(NOW - 60000) } };
function memoryDb() {
  const rows = new Map(), created = new Map(); let sequence = 0;
  const db = { rows, call: { aggregate: async () => costRow }, runtimeStore: {
    findMany: async ({ where, orderBy, take }) => {
      let keys = [...rows.keys()].filter(key => where.key.in ? where.key.in.includes(key) : key.startsWith(where.key.startsWith));
      if (orderBy) keys.sort((a, b) => created.get(b) - created.get(a));
      if (take) keys = keys.slice(0, take);
      return keys.map(key => ({ key, data: structuredClone(rows.get(key)) }));
    },
    upsert: async ({ where, create, update }) => {
      if (!rows.has(where.key)) { created.set(where.key, ++sequence); rows.set(where.key, structuredClone(create.data)); }
      else if (update.data) rows.set(where.key, structuredClone(update.data));
    },
  } };
  db.$transaction = async work => {
    const before = structuredClone(rows);
    try { return await work(db); }
    catch (error) { rows.clear(); for (const [key, data] of before) rows.set(key, data); throw error; }
  };
  return db;
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
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '../server/providerFinanceStore.js'), 'utf8');
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
    assert.equal((await fetch(`${base}/history?provider=vapi`)).status, 401);
    assert.equal((await fetch(`${base}/verified`, { method: 'POST' })).status, 401);
    const headers = { 'x-test-admin': 'synthetic', 'content-type': 'application/json', origin: 'https://untrusted.invalid', 'x-myaipa-finance': '1' };
    const body = JSON.stringify({ provider: 'vapi', field: 'balance', value: 11.6, currency: 'USD', observedAt: new Date().toISOString() });
    assert.equal((await fetch(`${base}/verified`, { method: 'POST', headers, body })).status, 403);
    headers.origin = 'https://admin.example.invalid';
    assert.equal((await fetch(`${base}/verified`, { method: 'POST', headers, body })).status, 200);
    const response = await fetch(base, { headers: { 'x-test-admin': 'synthetic' } });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await response.json()).finances.providers[1].metrics.balance.value, 11.6);
    const history = await fetch(`${base}/history?provider=vapi`, { headers: { 'x-test-admin': 'synthetic' } });
    assert.equal(history.headers.get('cache-control'), 'no-store');
    assert.equal((await history.json()).history.find(row => row.type === 'verification').value.value, 11.6);
    assert.equal((await fetch(`${base}/history?provider=__proto__`, { headers: { 'x-test-admin': 'synthetic' } })).status, 400);
    assert.equal((await fetch(`${base}/verified`, { method: 'POST', headers, body: JSON.stringify({ ...JSON.parse(body), cardNumber: 'not-allowed' }) })).status, 400);
    await service.waitForRefresh();
  } finally { server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)); }
});

test('provider-specific records survive Make reconnection without sharing other accounts', async () => {
  const db = memoryDb(), collect = async () => ({ updates: {}, errors: {}, attemptedAt: at });
  const original = createFinanceService({ prisma: db, env, clock: () => NOW, collect });
  await original.save({ provider: 'render', field: 'monthlyEstimate', value: 17.75, currency: 'USD', observedAt: at, billingMonth: '2026-10' });
  await original.save({ provider: 'make', field: 'monthlyEstimate', value: 10.59, currency: 'CAD', observedAt: at });
  const switched = createFinanceService({ prisma: db, env: { ...env, FINANCE_MAKE_ORGANIZATION_ID: '456' }, clock: () => NOW, collect });
  const result = await switched.read(); await switched.waitForRefresh();
  assert.equal(result.providers[3].metrics.monthlyEstimate.value, 17.75);
  assert.equal(result.providers[2].metrics.monthlyEstimate, undefined);
  assert.equal((await switched.history('render')).find(row => row.type === 'verification').value.value, 17.75);
  assert.equal((await switched.history('make')).filter(row => row.type === 'verification').length, 0);
});

test('legacy migration is exact-account only and preserves the original check time', async () => {
  const { legacyScopeFor } = require('../server/providerFinanceStore');
  const db = memoryDb(), scope = legacyScopeFor(env), checked = '2026-10-20T12:00:00.000Z';
  db.rows.set(`provider-finance:v1:verified:render:monthlyEstimate:${scope}`, { provider: 'render', field: 'monthlyEstimate', value: 17.75, currency: 'USD', source: 'dashboard_verified', observedAt: checked, estimated: true });
  db.rows.set('provider-finance:v1:verified:vapi:balance:unrelated-account', { provider: 'vapi', field: 'balance', value: 99999, currency: 'USD', source: 'dashboard_verified', observedAt: at });
  const service = createFinanceService({ prisma: db, env, clock: () => NOW, collect: async () => ({ updates: {}, errors: {}, attemptedAt: at }) });
  const result = await service.read(); await service.waitForRefresh();
  assert.equal(result.providers[3].metrics.monthlyEstimate.observedAt, checked);
  assert.equal(result.providers[1].metrics.balance, undefined);
  const baseline = (await service.history('render')).find(row => row.type === 'baseline');
  assert.equal(baseline.value.observedAt, checked); assert.equal(baseline.value.billingMonth, '2026-10');
  assert.ok(db.rows.has(`provider-finance:v1:verified:render:monthlyEstimate:${scope}`));
});

test('manual corrections retain before/after values; identical submissions do not duplicate history', async () => {
  const db = memoryDb(), service = createFinanceService({ prisma: db, env, clock: () => NOW });
  const fact = { provider: 'render', field: 'monthlyEstimate', value: 17.75, currency: 'USD', observedAt: at, billingMonth: '2026-10' };
  await service.save(fact); await service.save(fact);
  assert.equal((await service.history('render')).length, 1);
  await service.save({ ...fact, value: 18.25 });
  const history = await service.history('render');
  assert.equal(history.length, 2); assert.equal(history[0].previous.value, 17.75); assert.equal(history[0].value.value, 18.25);
  assert.equal(history[1].value.value, 17.75); assert.equal(history[0].value.observedAt, at);
});

test('current value and correction history commit atomically', async () => {
  const db = memoryDb(), service = createFinanceService({ prisma: db, env, clock: () => NOW });
  const fact = { provider: 'vapi', field: 'balance', value: 12, currency: 'USD', observedAt: at };
  await service.save(fact); const upsert = db.runtimeStore.upsert;
  db.runtimeStore.upsert = async args => { if (args.where.key.includes('history:')) throw Error('synthetic database failure'); return upsert(args); };
  await assert.rejects(service.save({ ...fact, value: 13 }));
  assert.equal((await service.history('vapi')).length, 1);
  const current = [...db.rows].find(([key]) => key.endsWith('verified:balance'))[1];
  assert.equal(current.value, 12);
});

test('hourly snapshots are immutable, restart-safe, and retain source timestamps on failed reads', async () => {
  let clock = NOW, value = 12;
  const db = memoryDb(), collect = async () => ({ updates: { twilio: { balance: { value, currency: 'USD', source: 'twilio_balance_api', observedAt: at } } }, errors: {}, attemptedAt: new Date(clock).toISOString() });
  let service = createFinanceService({ prisma: db, env, clock: () => clock, collect });
  await service.read(); await service.waitForRefresh();
  value = 13; clock += 6 * 60000; await service.read(); await service.waitForRefresh();
  assert.equal((await service.history('twilio')).length, 1); assert.equal((await service.history('twilio'))[0].metrics.balance.value, 12);
  clock += 3600000; service = createFinanceService({ prisma: db, env, clock: () => clock, collect });
  await service.read(); await service.waitForRefresh();
  const history = await service.history('twilio'); assert.equal(history.length, 2); assert.equal(history[0].metrics.balance.value, 13);
  assert.equal(history[0].metrics.balance.observedAt, at);
});

test('monthly estimates expire on month rollover, and summary never mixes currencies or usage overlap', () => {
  const { overview } = require('../server/providerFinanceView');
  const entry = { provider: 'render', field: 'monthlyEstimate', value: 17.75, currency: 'USD', observedAt: at, billingMonth: '2026-10' };
  const verified = validateVerified(entry, NOW); assert.equal(verified.billingMonth, '2026-10');
  assert.throws(() => validateVerified({ ...entry, billingMonth: '2026-13' }, NOW));
  assert.throws(() => validateVerified({ ...entry, field: 'budgetMonth' }, NOW));
  const snapshot = { providers: { make: { planPrice: { value: 10, currency: 'CAD', source: 'make_subscription_api', observedAt: at, period: 'month', estimated: true } },
    twilio: { spendMonth: { value: 55, currency: 'USD', source: 'twilio_usage_api', periodStart: '2026-10-01', observedAt: at } } } };
  const providers = decorate(snapshot, [verified], NOW);
  const result = overview(providers, NOW);
  assert.deepEqual(result.planTotals, [{ currency: 'CAD', value: 10 }, { currency: 'USD', value: 17.75 }]);
  assert.equal(result.balances[0].metric, null); assert.equal(result.actions[0].title, 'Verify Twilio funding');
  const later = decorate(snapshot, [verified], Date.parse('2026-11-01T05:00:00Z'));
  assert.equal(later[3].metrics.monthlyEstimate.quality, 'outdated'); assert.equal(later[3].metrics.monthlyEstimate.previousPeriod, true);
  assert.deepEqual(overview(later).planTotals, []);
});

test('renewal countdown and estimate expiry follow Toronto calendar boundaries, including DST', () => {
  const { overview, torontoDay } = require('../server/providerFinanceView');
  const now = Date.parse('2026-11-01T00:30:00Z'); // Still October in Toronto.
  const fact = validateVerified({ provider: 'render', field: 'monthlyEstimate', value: 18, currency: 'USD', observedAt: new Date(now).toISOString() }, now);
  assert.equal(fact.billingMonth, '2026-10'); assert.equal(torontoDay(now), '2026-10-31');
  const providers = decorate({ providers: { make: { nextBillAt: { value: '2026-11-01T00:00:00Z', source: 'make_subscription_api', observedAt: new Date(now).toISOString(), kind: 'date' } } } }, [fact], now);
  assert.equal(providers[3].metrics.monthlyEstimate.previousPeriod, false);
  assert.equal(overview(providers, now).renewals[0].days, 1);
  assert.equal(torontoDay('2026-11-01T06:30:00Z'), '2026-11-01');
});

test('freshness, source quality and safe account labels are explicit', async () => {
  const service = createFinanceService({ prisma: memoryDb(), env, clock: () => NOW, fetchImpl: fixtureFetch() });
  await service.read(); await service.waitForRefresh(); const result = await service.read();
  assert.equal(result.providers[0].metrics.balance.quality, 'provider_reported');
  assert.equal(result.providers[1].metrics.spendMonth.quality, 'estimated');
  assert.equal(result.providers[2].metrics.planPrice.sourceLabel, 'Make subscription API');
  assert.equal(result.providers[0].accountLabel, 'Account ending 1111');
  const serialized = JSON.stringify(result) + JSON.stringify(await service.history('twilio'));
  assert.ok(!serialized.includes(env.TWILIO_ACCOUNT_SID)); assert.ok(!serialized.includes('synthetic-'));
});

test('a failed provider read is retained as failed-read evidence in the sampled history', async () => {
  let clock = NOW, failed = false;
  const service = createFinanceService({ prisma: memoryDb(), env, clock: () => clock, collect: async () => ({
    updates: failed ? {} : { twilio: { balance: { value: 12, currency: 'USD', observedAt: at, source: 'twilio_balance_api' } } },
    errors: failed ? { twilio: ['Credit balance unavailable (HTTP 503); last known values, if any, are retained.'] } : {}, attemptedAt: new Date(clock).toISOString(),
  }) });
  await service.read(); await service.waitForRefresh(); clock += 3600000; failed = true;
  await service.read(); await service.waitForRefresh();
  const latest = (await service.history('twilio'))[0];
  assert.equal(latest.metrics.balance.value, 12); assert.equal(latest.metrics.balance.observedAt, at);
  assert.match(latest.warnings[0], /HTTP 503/);
});

test('overview prefers a current provider monthly price, never divides annual prices, and surfaces budget warnings', () => {
  const { overview } = require('../server/providerFinanceView');
  const estimate = validateVerified({ provider: 'make', field: 'monthlyEstimate', value: 100, currency: 'USD', observedAt: '2026-09-01T12:00:00Z' }, NOW);
  const budget = validateVerified({ provider: 'make', field: 'budgetMonth', value: 5, currency: 'CAD', observedAt: at }, NOW);
  const snapshot = { providers: { make: { planPrice: { value: 10, currency: 'CAD', observedAt: at, source: 'make_subscription_api', period: 'month', estimated: true },
    nextBillAt: { value: '2026-10-01T12:00:00Z', observedAt: at, source: 'make_subscription_api', kind: 'date' } } } };
  let providers = decorate(snapshot, [estimate, budget], NOW), result = overview(providers, NOW);
  assert.deepEqual(result.planTotals, [{ currency: 'CAD', value: 10 }]);
  assert.ok(result.actions.some(row => row.title === 'Review Make warning budget'));
  assert.equal(providers[2].metrics.nextBillAt.quality, 'outdated');
  snapshot.providers.make.planPrice.period = 'year';
  providers = decorate(snapshot, [], NOW); result = overview(providers, NOW);
  assert.deepEqual(result.planTotals, []);
});
