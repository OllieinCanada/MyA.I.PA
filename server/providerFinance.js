'use strict';
const { scryptSync } = require('node:crypto');

// This module never changes a provider account, buys credits or sends messages.
// Keep it off the voice path. RuntimeStore holds only allowlisted financial facts.
const SNAPSHOT_KEY = 'provider-finance:v1:snapshot';
const PROVIDERS = ['twilio', 'vapi', 'make', 'render'];
const MANUAL_FIELDS = {
  twilio: ['budgetMonth', 'reserve', 'reloadThreshold', 'reloadAmount', 'nextBillAt'],
  vapi: ['balance', 'budgetMonth', 'reserve', 'reloadThreshold', 'reloadAmount', 'nextBillAt'],
  make: ['monthlyEstimate', 'budgetMonth', 'nextBillAt'],
  render: ['monthlyEstimate', 'budgetMonth', 'nextBillAt'],
};
const CURRENCIES = ['USD', 'CAD', 'EUR', 'GBP'];
const TTL = 5 * 60 * 1000;
const metric = (value, observedAt, source, extra = {}) => ({ value, observedAt, source, ...extra });
const numeric = value => ['number', 'string'].includes(typeof value) && String(value).trim() !== ''
  && Number.isFinite(Number(value)) ? Number(value) : null;
const validDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const manualKey = (provider, field) => `provider-finance:v1:verified:${provider}:${field}`;

function validateVerified(body, now = Date.now()) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some(key => !['provider', 'field', 'value', 'currency', 'observedAt'].includes(key))
    || !Object.hasOwn(MANUAL_FIELDS, body.provider) || !MANUAL_FIELDS[body.provider].includes(body.field)) throw new Error('Choose a supported provider and field.');
  if (!validDate(body.observedAt) || Date.parse(body.observedAt) > now + 60000) throw new Error('Enter when you actually checked it; future checks are not allowed.');
  const observedAt = new Date(body.observedAt).toISOString();
  if (body.field === 'nextBillAt') {
    if (!validDate(body.value) || body.currency) throw new Error('Enter a billing date, without a currency.');
    return { provider: body.provider, field: body.field, ...metric(new Date(body.value).toISOString(), observedAt, 'dashboard_verified', { kind: 'date' }) };
  }
  const value = numeric(body.value);
  const currency = String(body.currency || '').toUpperCase();
  if (value == null || value < 0 || value > 1000000 || !CURRENCIES.includes(currency)) throw new Error('Enter a non-negative amount and supported currency.');
  return { provider: body.provider, field: body.field, ...metric(value, observedAt, 'dashboard_verified', { currency,
    estimated: body.field === 'monthlyEstimate' }) };
}

function usageMetric(body, at) {
  // Twilio includes category subtotals: use exactly one parent total, never sum categories.
  const rows = body?.usage_records;
  if (!Array.isArray(rows) || body.next_page_uri) throw new Error('incomplete_usage');
  const totals = rows.filter(row => row.category === 'totalprice');
  if (totals.length !== 1 || numeric(totals[0].price) == null || !/^[A-Z]{3}$/.test(String(totals[0].price_unit).toUpperCase())) throw new Error('missing_usage_total');
  const row = totals[0];
  // Twilio's as_of is provider data freshness, not the time we downloaded it.
  if (!validDate(row.as_of)) throw new Error('missing_usage_timestamp');
  return metric(Number(row.price), new Date(row.as_of).toISOString(), 'twilio_usage_api', {
    currency: String(row.price_unit).toUpperCase(), retrievedAt: at,
  });
}

async function collectFinance({ prisma, env, fetchImpl = fetch, now = new Date() }) {
  const at = now.toISOString(), day = at.slice(0, 10), month = `${day.slice(0, 7)}-01`;
  const updates = {}, errors = {};
  const get = async (url, headers) => {
    // No redirects carrying credentials, no retries or provider writes.
    const response = await fetchImpl(url, { method: 'GET', headers, redirect: 'error', signal: AbortSignal.timeout(4000) });
    if (!response.ok) throw new Error(`http_${response.status}`);
    return response.json();
  };
  const job = async (provider, name, run) => {
    try { Object.assign(updates[provider] ||= {}, await run()); }
    catch (error) {
      const detail = /^http_\d{3}$/.test(error?.message || '') ? ` (HTTP ${error.message.slice(5)})`
        : ['TimeoutError', 'AbortError'].includes(error?.name) ? ' (timed out)' : '';
      (errors[provider] ||= []).push(`${name} unavailable${detail}; last known values, if any, are retained.`);
    }
  };
  const tasks = [];
  if (/^AC[a-f0-9]{32}$/i.test(env.TWILIO_ACCOUNT_SID || '') && env.TWILIO_AUTH_TOKEN) {
    const base = `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}`;
    const auth = { Authorization: `Basic ${Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64')}` };
    tasks.push(job('twilio', 'Credit balance', async () => {
      const b = await get(`${base}/Balance.json`, auth);
      if (numeric(b.balance) == null || !/^[A-Z]{3}$/.test(String(b.currency).toUpperCase())) throw new Error('invalid_balance');
      return { balance: metric(Number(b.balance), at, 'twilio_balance_api', { currency: b.currency.toUpperCase() }) };
    }));
    for (const [field, start] of [['spendToday', day], ['spendMonth', month]]) tasks.push(job('twilio', field, async () => ({
      [field]: { ...usageMetric(await get(`${base}/Usage/Records.json?StartDate=${start}&EndDate=${day}&PageSize=1000`, auth), at), periodStart: start, periodEnd: day },
    })));
  } else errors.twilio = ['Twilio billing read credentials are not configured.'];
  tasks.push(job('vapi', 'Saved call-cost estimate', async () => {
    const start = new Date(`${month}T00:00:00Z`), today = new Date(`${day}T00:00:00Z`);
    const query = since => prisma.call.aggregate({ where: { startedAt: { gte: since, lte: now }, externalProvider: 'vapi' },
      _sum: { vapiCost: true }, _count: { _all: true, vapiCost: true }, _max: { costSyncedAt: true } });
    const [daily, monthly] = await Promise.all([query(today), query(start)]);
    const convert = (row, since) => {
      const count = row?._count?._all, priced = row?._count?.vapiCost, value = numeric(row?._sum?.vapiCost);
      const checked = row?._max?.costSyncedAt;
      // No imported calls is not proof of zero account spending.
      return metric(priced > 0 ? value : null, checked ? new Date(checked).toISOString() : null, 'saved_call_costs', {
        currency: 'USD', estimated: true, pricedCalls: priced ?? null, savedCalls: count ?? null,
        periodStart: since.toISOString().slice(0, 10), periodEnd: day, retrievedAt: at,
      });
    };
    return { spendToday: convert(daily, today), spendMonth: convert(monthly, start) };
  }));
  const makeToken = env.MAKE_AUDIT_API_TOKEN || env.MAKE_API_TOKEN;
  const org = String(env.FINANCE_MAKE_ORGANIZATION_ID || '');
  const zone = String(env.FINANCE_MAKE_ZONE || 'us2');
  if (makeToken && /^\d+$/.test(org) && ['us1', 'us2', 'eu1', 'eu2'].includes(zone)) {
    const base = `https://${zone}.make.com/api/v2/organizations/${org}`, auth = { Authorization: `Token ${makeToken}` };
    tasks.push(job('make', 'Subscription', async () => {
      const body = await get(`${base}/subscription`, auth), p = body.product, result = {};
      if (!p) throw new Error('missing_subscription');
      if (validDate(p.nextBill)) result.nextBillAt = metric(new Date(p.nextBill).toISOString(), at, 'make_subscription_api', { kind: 'date' });
      if (numeric(p.price?.price) != null && /^[A-Z]{3}$/.test(String(p.price.currencyCode).toUpperCase())) {
        result.planPrice = metric(Number(p.price.price), at, 'make_subscription_api', { currency: p.price.currencyCode.toUpperCase(), period: String(p.price.period || 'unspecified').slice(0, 30), estimated: true });
      }
      if (!Object.keys(result).length) throw new Error('missing_subscription_fields');
      return result;
    }));
    tasks.push(job('make', '30-day credits', async () => {
      const body = await get(`${base}/usage?organizationTimezone=true`, auth);
      if (!Array.isArray(body.data) || !body.data.length || body.data.some(r => numeric(r.centicredits) == null || Number(r.centicredits) < 0)) throw new Error('incomplete_usage');
      return { rollingCredits: metric(body.data.reduce((sum, r) => sum + Number(r.centicredits) / 100, 0), at, 'make_usage_api', { unit: 'credits' }) };
    }));
  } else errors.make = ['Make read access and finance organization ID must be configured; not a zero balance.'];
  await Promise.all(tasks);
  return { updates, errors, attemptedAt: at, day, month };
}

function decorate(snapshot, verified, now = Date.now()) {
  const day = new Date(now).toISOString().slice(0, 10), month = `${day.slice(0, 7)}-01`;
  return PROVIDERS.map(id => {
    const metrics = { ...(snapshot?.providers?.[id] || {}) }, warnings = [...(snapshot?.errors?.[id] || [])];
    for (const entry of verified.filter(row => row.provider === id)) {
      // API-reported billing dates win; do not replace them silently with manual dates.
      if (!metrics[entry.field]) metrics[entry.field] = entry;
      else if (metrics[entry.field].source === 'dashboard_verified') metrics[entry.field] = entry;
    }
    for (const [field, value] of Object.entries(metrics)) {
      const maxAge = value.source === 'dashboard_verified' ? (field === 'balance' ? 86400000 : 30 * 86400000) : TTL * 3;
      metrics[field] = { ...value, stale: Boolean(snapshot?.errors?.[id]?.length) || !value.observedAt || !validDate(value.observedAt) || now - Date.parse(value.observedAt) > maxAge || Date.parse(value.observedAt) > now + 60000,
        previousPeriod: (field === 'spendToday' && value.periodStart !== day) || (field === 'spendMonth' && value.periodStart !== month) };
    }
    const balance = metrics.balance, reserve = metrics.reserve || metrics.reloadThreshold;
    if (balance && reserve && balance.currency === reserve.currency && balance.value <= reserve.value) warnings.push('Balance is at or below the recorded reserve/trigger. Check the provider; this page cannot buy credits.');
    const spend = metrics.spendMonth || metrics.monthlyEstimate, budget = metrics.budgetMonth;
    if (spend && budget && !spend.previousPeriod && spend.currency === budget.currency && spend.value != null && spend.value >= budget.value) warnings.push(`${metrics.spendMonth ? 'Recorded month-to-date usage' : 'The monthly estimate'} has reached the budget. This warning never stops calls.`);
    if (id === 'vapi') warnings.push('Saved call costs are estimates, not a complete Vapi invoice. They may include costs billed by Twilio or other providers; do not add them to Twilio totals.');
    if (id === 'make') warnings.push('30-day credits are not the billing-cycle remaining balance. Plan price is not the final taxed invoice.');
    if (id === 'render') warnings.push('Render billing is dashboard-verified, not live. Record the monthly estimate and next billing date after checking Render.');
    return { id, name: { twilio: 'Twilio', vapi: 'Vapi', make: 'Make', render: 'Render' }[id], metrics, warnings };
  });
}

function createFinanceService({ prisma, env = process.env, fetchImpl, clock = () => Date.now(), collect = collectFinance, timeoutMs = 4500 }) {
  let snapshot = null, inFlight = null, lastAttempt = 0, persistenceWarning = null;
  // Never reuse another account's balances after a provider-account/configuration switch.
  // Derive the opaque namespace once at startup, never on the call or refresh path.
  // Use a dedicated slow KDF even for high-entropy API credentials; no raw key or
  // fast credential hash is persisted. This is not an authentication verifier.
  const scope = scryptSync(JSON.stringify([env.TWILIO_ACCOUNT_SID || '', env.VAPI_API_KEY || '',
    env.FINANCE_MAKE_ORGANIZATION_ID || '', env.FINANCE_MAKE_ZONE || '', env.RENDER_SERVICE_ID || '']),
  'myaipa-provider-finance-cache-scope:v1', 20, { N: 16384, r: 8, p: 1 }).toString('hex');
  const scopedKey = key => `${key}:${scope}`;
  const bounded = async promise => {
    let timer;
    try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('finance_storage_timeout')), timeoutMs); })]); }
    finally { clearTimeout(timer); }
  };
  async function refresh() {
    if (inFlight || clock() - lastAttempt < TTL) return inFlight;
    lastAttempt = clock();
    inFlight = (async () => {
      const result = await bounded(collect({ prisma, env, fetchImpl, now: new Date(clock()) }));
      const providers = { ...(snapshot?.providers || {}) };
      for (const id of PROVIDERS) providers[id] = { ...providers[id], ...result.updates[id] };
      snapshot = { providers, errors: result.errors, attemptedAt: result.attemptedAt };
      try {
        const key = scopedKey(SNAPSHOT_KEY);
        await bounded(prisma.runtimeStore.upsert({ where: { key }, create: { key, data: snapshot }, update: { data: snapshot } }));
        persistenceWarning = null;
      } catch (_) { persistenceWarning = 'The latest snapshot could not be confirmed saved. It may not survive a server restart.'; }
    })().catch(() => { persistenceWarning = 'Finance refresh failed. Previous values are retained; missing values are unknown.'; }).finally(() => { inFlight = null; });
    return inFlight;
  }
  return {
    async read() {
      const keys = PROVIDERS.flatMap(id => MANUAL_FIELDS[id].map(field => scopedKey(manualKey(id, field))));
      const rows = await bounded(prisma.runtimeStore.findMany({ where: { key: { in: [scopedKey(SNAPSHOT_KEY), ...keys] } } }));
      if (!snapshot) snapshot = rows.find(row => row.key === scopedKey(SNAPSHOT_KEY))?.data || null;
      if (!lastAttempt && snapshot?.attemptedAt) lastAttempt = Date.parse(snapshot.attemptedAt) || 0;
      void refresh(); // Return last-known data immediately; never wait for provider APIs here.
      const verified = rows.filter(row => row.key !== scopedKey(SNAPSHOT_KEY)).map(row => row.data);
      return { checkedAt: new Date(clock()).toISOString(), refreshing: Boolean(inFlight), refreshEverySeconds: TTL / 1000,
        persistenceWarning, providers: decorate(snapshot, verified, clock()), manualFields: MANUAL_FIELDS,
        billingDayTimezone: 'UTC', snapshotAt: snapshot?.attemptedAt || null };
    },
    async save(body) {
      const entry = validateVerified(body, clock());
      const key = scopedKey(manualKey(entry.provider, entry.field));
      await bounded(prisma.runtimeStore.upsert({ where: { key }, create: { key, data: entry }, update: { data: entry } }));
      return entry;
    },
    // For deterministic tests/shutdown only; not exposed as a production write endpoint.
    waitForRefresh: () => inFlight,
  };
}

function registerFinanceRoutes({ app, requireAdmin, isAllowedOrigin, service }) {
  app.get('/api/admin/finances', requireAdmin, async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    try { res.json({ ok: true, finances: await service.read() }); }
    catch (_) { res.status(503).json({ error: 'Finance storage is unavailable. No balance or cost is assumed to be zero.' }); }
  });
  app.post('/api/admin/finances/verified', requireAdmin, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    // Session cookies are cross-site for the API domain. Require a trusted Origin AND a non-simple header.
    if (!req.headers.origin || !isAllowedOrigin(req.headers.origin) || req.headers['x-myaipa-finance'] !== '1') return res.status(403).json({ error: 'Open the signed-in admin page to record a verified fact.' });
    try { validateVerified(req.body); }
    catch (error) { return res.status(400).json({ error: error.message }); }
    try { await service.save(req.body); res.json({ ok: true }); }
    catch (_) { res.status(503).json({ error: 'The verified fact was not confirmed saved. Reload before trying again.' }); }
  });
}

module.exports = { createFinanceService, registerFinanceRoutes, collectFinance, usageMetric, validateVerified, decorate, SNAPSHOT_KEY, MANUAL_FIELDS };
