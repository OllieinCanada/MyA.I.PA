'use strict';
const { decorate, torontoDay } = require('./providerFinanceView');
const { createFinanceStore } = require('./providerFinanceStore');

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
const metric = (value, observedAt, source, extra = {}) => ({ value, observedAt, source, ...extra });
const numeric = value => ['number', 'string'].includes(typeof value) && String(value).trim() !== ''
  && Number.isFinite(Number(value)) ? Number(value) : null;
const validDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value));

function validateVerified(body, now = Date.now()) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some(key => !['provider', 'field', 'value', 'currency', 'observedAt', 'billingMonth'].includes(key))
    || !Object.hasOwn(MANUAL_FIELDS, body.provider) || !MANUAL_FIELDS[body.provider].includes(body.field)) throw new Error('Choose a supported provider and field.');
  if (!validDate(body.observedAt) || Date.parse(body.observedAt) > now + 60000) throw new Error('Enter when you actually checked it; future checks are not allowed.');
  const observedAt = new Date(body.observedAt).toISOString();
  if (body.billingMonth != null && (body.field !== 'monthlyEstimate' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(body.billingMonth))) throw new Error('Choose the month this estimate covers.');
  if (body.field === 'nextBillAt') {
    if (!validDate(body.value) || body.currency) throw new Error('Enter a billing date, without a currency.');
    return { provider: body.provider, field: body.field, ...metric(new Date(body.value).toISOString(), observedAt, 'dashboard_verified', { kind: 'date' }) };
  }
  const value = numeric(body.value);
  const currency = String(body.currency || '').toUpperCase();
  if (value == null || value < 0 || value > 1000000 || !CURRENCIES.includes(currency)) throw new Error('Enter a non-negative amount and supported currency.');
  return { provider: body.provider, field: body.field, ...metric(value, observedAt, 'dashboard_verified', { currency,
    estimated: body.field === 'monthlyEstimate', ...(body.field === 'monthlyEstimate' ? { billingMonth: body.billingMonth || torontoDay(observedAt).slice(0, 7) } : {}) }) };
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

function createFinanceService(options) {
  return createFinanceStore({ ...options, collect: options.collect || collectFinance, validateVerified, manualFields: MANUAL_FIELDS });
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
    try { res.json({ ok: true, entry: await service.save(req.body) }); }
    catch (_) { res.status(503).json({ error: 'The verified fact was not confirmed saved. Reload before trying again.' }); }
  });
  app.get('/api/admin/finances/history', requireAdmin, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!PROVIDERS.includes(req.query.provider)) return res.status(400).json({ error: 'Choose a supported provider.' });
    try { res.json({ ok: true, history: await service.history(req.query.provider), limit: 50 }); }
    catch (_) { res.status(503).json({ error: 'Finance history is unavailable. Current figures are not a substitute for missing history.' }); }
  });
}

module.exports = { createFinanceService, registerFinanceRoutes, collectFinance, usageMetric, validateVerified, decorate, SNAPSHOT_KEY, MANUAL_FIELDS };
