'use strict';

const PROVIDERS = ['twilio', 'vapi', 'make', 'render'];
const NAMES = { twilio: 'Twilio', vapi: 'Vapi', make: 'Make', render: 'Render' };
const FIELDS = ['balance', 'spendToday', 'spendMonth', 'rollingCredits', 'planPrice', 'monthlyEstimate', 'nextBillAt', 'budgetMonth', 'reserve', 'reloadThreshold', 'reloadAmount'];
const SOURCES = { twilio_balance_api: 'Twilio balance API', twilio_usage_api: 'Twilio usage API', make_subscription_api: 'Make subscription API', make_usage_api: 'Make usage API', saved_call_costs: 'Imported Vapi calls', dashboard_verified: 'Provider dashboard check' };
const validDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
function torontoDay(now) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(now));
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type).value).join('-');
}

function cleanMetric(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const out = {};
  for (const key of ['value', 'currency', 'source', 'observedAt', 'retrievedAt', 'periodStart', 'periodEnd', 'billingMonth', 'period', 'unit', 'kind', 'estimated', 'pricedCalls', 'savedCalls']) {
    if (['string', 'number', 'boolean'].includes(typeof value[key]) || value[key] === null) out[key] = value[key];
  }
  if (out.kind === 'date' ? !validDate(out.value) : out.value !== null && (typeof out.value !== 'number' || !Number.isFinite(out.value))) return null;
  if (!Object.hasOwn(SOURCES, out.source || '')) return null;
  return out;
}

function cleanMetrics(metrics) {
  return Object.fromEntries(FIELDS.flatMap(field => {
    const value = cleanMetric(metrics?.[field]);
    return value ? [[field, value]] : [];
  }));
}

function accountLabel(id, env) {
  if (id === 'twilio') return /^AC[a-f0-9]{32}$/i.test(env.TWILIO_ACCOUNT_SID || '') ? `Account ending ${env.TWILIO_ACCOUNT_SID.slice(-4)}` : 'Account not configured';
  if (id === 'make') return /^\d+$/.test(env.FINANCE_MAKE_ORGANIZATION_ID || '') ? `Organization ${env.FINANCE_MAKE_ORGANIZATION_ID} · ${env.FINANCE_MAKE_ZONE || 'us2'}` : 'Organization not configured';
  if (id === 'render') return env.RENDER_SERVICE_ID ? `Service ending ${String(env.RENDER_SERVICE_ID).slice(-6)}` : 'This application’s Render workspace';
  return env.VAPI_API_KEY ? 'Configured Vapi connection' : 'Vapi account not confirmed';
}

function decorate(snapshot, verified, now = Date.now(), env = {}) {
  const day = new Date(now).toISOString().slice(0, 10), month = day.slice(0, 7), estimateMonth = torontoDay(now).slice(0, 7);
  return PROVIDERS.map(id => {
    const metrics = cleanMetrics(snapshot?.providers?.[id]);
    const warnings = (snapshot?.errors?.[id] || []).filter(text => typeof text === 'string').map(text => text.slice(0, 200));
    for (const entry of verified.filter(row => row.provider === id)) {
      const value = cleanMetric(entry);
      if (value && FIELDS.includes(entry.field) && (!metrics[entry.field] || metrics[entry.field].source === 'dashboard_verified')) metrics[entry.field] = value;
    }
    for (const [field, value] of Object.entries(metrics)) {
      if (field === 'monthlyEstimate' && !value.billingMonth && validDate(value.observedAt)) value.billingMonth = torontoDay(value.observedAt).slice(0, 7);
      const previousPeriod = (field === 'spendToday' && value.periodStart !== day)
        || (field === 'spendMonth' && value.periodStart !== `${month}-01`)
        || (field === 'monthlyEstimate' && value.billingMonth !== estimateMonth);
      const maxAge = value.source === 'dashboard_verified' ? (field === 'balance' ? 86400000 : 30 * 86400000) : 15 * 60000;
      const pastBill = field === 'nextBillAt' && validDate(value.value) && value.value.slice(0, 10) < torontoDay(now);
      const stale = previousPeriod || pastBill || Boolean(snapshot?.errors?.[id]?.length) || !validDate(value.observedAt)
        || now - Date.parse(value.observedAt) > maxAge || Date.parse(value.observedAt) > now + 60000;
      const quality = value.value == null ? 'unknown' : stale ? 'outdated' : value.estimated ? 'estimated'
        : value.source === 'dashboard_verified' ? 'manually_checked' : 'provider_reported';
      metrics[field] = { ...value, stale, previousPeriod: Boolean(previousPeriod), quality,
        qualityLabel: { unknown: 'Unknown', outdated: 'Outdated', estimated: 'Estimated', manually_checked: 'Manually checked', provider_reported: 'Provider reported' }[quality],
        sourceLabel: SOURCES[value.source],
        periodLabel: value.billingMonth || (value.periodStart ? `${value.periodStart} to ${value.periodEnd || day} (UTC)` : value.unit === 'credits' ? 'Rolling 30 days · organization timezone' : value.period || null) };
    }
    const balance = metrics.balance, reserve = metrics.reserve || metrics.reloadThreshold;
    if (balance && reserve && !balance.stale && !reserve.stale && balance.currency === reserve.currency && balance.value != null && balance.value <= reserve.value) warnings.push('Balance is at or below the recorded reserve/trigger. Check the provider; this page cannot buy credits.');
    const spend = metrics.spendMonth || metrics.monthlyEstimate, budget = metrics.budgetMonth;
    if (spend && budget && !spend.stale && !budget.stale && spend.currency === budget.currency && spend.value != null && spend.value >= budget.value) warnings.push('Recorded cost has reached the warning budget. This never stops calls.');
    if (id === 'vapi') warnings.push('Imported call costs may be incomplete or overlap Twilio charges. They are not a wallet balance or invoice.');
    if (id === 'make') warnings.push('Rolling credits are not credits remaining in this billing cycle. Plan price is not a final taxed invoice.');
    if (id === 'render') warnings.push('Render amounts are dated dashboard checks, not a live billing feed.');
    return { id, name: NAMES[id], accountLabel: accountLabel(id, env), metrics, warnings };
  });
}

function overview(providers, now = Date.now(), persistenceWarning = null) {
  const actions = [], renewals = [], plans = [], balances = [];
  const add = (provider, field, title, detail, priority = 2) => actions.push({ id: `${provider}:${field}:${title}`, provider, field, title, detail, priority });
  for (const provider of providers) {
    const { id, name, metrics } = provider;
    if (id === 'twilio' || id === 'vapi') {
      const balance = metrics.balance;
      balances.push({ provider: id, name, metric: balance || null });
      if (!balance || balance.value == null) add(id, 'balance', `Verify ${name} funding`, 'Wallet balance is unknown; imported call costs do not prove available credit.', 1);
      else if (balance.stale) add(id, 'balance', `Recheck ${name} funding`, 'The last balance is outdated, not a current funding confirmation.', 1);
      else if (balance.value <= 0) add(id, 'balance', `Review ${name} balance`, 'The reported balance is zero or negative. Check the provider before assuming service is funded.', 0);
      const reserve = metrics.reserve || metrics.reloadThreshold;
      if (balance && reserve && !balance.stale && !reserve.stale && balance.currency === reserve.currency && balance.value != null && balance.value <= reserve.value) add(id, 'balance', `Check ${name} reserve`, 'The balance is at or below your recorded warning threshold.', 0);
    }
    const candidates = [metrics.planPrice?.period === 'month' ? metrics.planPrice : null, metrics.monthlyEstimate].filter(Boolean);
    const plan = candidates.find(item => !item.stale && item.value != null) || candidates[0];
    if (id === 'make' || id === 'render') {
      if (plan && !plan.stale && plan.value != null) plans.push({ provider: id, name, metric: plan });
      else add(id, 'monthlyEstimate', `Check ${name} monthly cost`, plan?.previousPeriod ? 'The saved estimate belongs to another month. Check the current period.' : 'A current monthly plan or verified estimate is missing.');
    }
    const bill = metrics.nextBillAt;
    if (bill && validDate(bill.value)) {
      // Calendar comparison avoids calling a date "overdue" halfway through that date.
      const days = Math.round((Date.parse(bill.value.slice(0, 10)) - Date.parse(torontoDay(now))) / 86400000);
      renewals.push({ id: `${id}:billing`, provider: id, name, at: bill.value, days, metric: bill, estimated: false });
      if (bill.stale || days < 0) add(id, 'nextBillAt', `Recheck ${name} billing date`, 'This date is old or has passed. It is not proof a payment failed.');
    } else add(id, 'nextBillAt', `Confirm ${name} billing date`, 'No verified upcoming billing date is recorded.', 3);
    if (provider.warnings.some(text => /unavailable|not configured|must be configured/i.test(text))) add(id, null, `Check ${name} connection`, 'One or more reads could not be confirmed. Existing figures remain last-known values.', 1);
    const cost = metrics.spendMonth || plan, budget = metrics.budgetMonth;
    if (cost && budget && !cost.stale && !budget.stale && cost.value != null && cost.currency === budget.currency && cost.value >= budget.value) add(id, 'budgetMonth', `Review ${name} warning budget`, 'Recorded usage or the monthly estimate has reached your warning budget. This does not stop calls.', 1);
    for (const [field, value] of Object.entries(metrics)) {
      const label = { planPrice: 'plan price', reserve: 'reserve', reloadThreshold: 'reload trigger', reloadAmount: 'reload amount', budgetMonth: 'warning budget' }[field] || 'usage';
      if (value.stale && !['balance', 'monthlyEstimate', 'nextBillAt'].includes(field)) add(id, field, `Recheck ${name} ${label}`, 'This figure is outdated or belongs to an earlier period.');
    }
  }
  const totals = Object.entries(plans.reduce((out, row) => {
    const currency = row.metric.currency;
    if (/^[A-Z]{3}$/.test(currency || '')) out[currency] = (out[currency] || 0) + row.metric.value;
    return out;
  }, {})).map(([currency, value]) => ({ currency, value: Math.round(value * 10000) / 10000 }));
  if (persistenceWarning) add(null, null, 'Check finance storage', 'The latest records are not confirmed durable. Refresh before saving again.', 0);
  return { balances, plans, planTotals: totals, planCoverage: `${plans.length} of 2 monthly plan sources`,
    planLimit: 'Make and Render only. Excludes Twilio/Vapi usage, tax and unconfirmed charges; not total operating cost.',
    actions: actions.sort((a, b) => a.priority - b.priority || a.title.localeCompare(b.title)),
    renewals: renewals.sort((a, b) => a.at.localeCompare(b.at)), calculatedAt: new Date(now).toISOString() };
}

module.exports = { PROVIDERS, NAMES, FIELDS, cleanMetric, cleanMetrics, accountLabel, decorate, overview, torontoDay };
