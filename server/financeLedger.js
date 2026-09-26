const SECONDS_PER_DAY = 24 * 60 * 60;
const DEFAULT_DAYS = 30;
const MAX_DAYS = 3660;
const DEFAULT_TRANSACTION_LIMIT = 2000;
const DEFAULT_PAYOUT_LIMIT = 1000;

function normalizeFinanceDays(value, fallback = DEFAULT_DAYS) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, MAX_DAYS);
}

function finiteInteger(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

function safeKey(value, fallback = "unknown") {
  const text = String(value || "").trim().toLowerCase();
  return text && /^[a-z0-9_-]+$/.test(text) ? text : fallback;
}

function getFinanceWindow({ days = DEFAULT_DAYS, now = new Date() } = {}) {
  const normalizedDays = normalizeFinanceDays(days);
  const end = new Date(now);
  if (!Number.isFinite(end.getTime())) throw new Error("A valid finance snapshot time is required.");
  const start = new Date(end.getTime() - normalizedDays * SECONDS_PER_DAY * 1000);
  return {
    days: normalizedDays,
    from: start.toISOString(),
    to: end.toISOString(),
    fromUnix: Math.floor(start.getTime() / 1000),
    toUnix: Math.floor(end.getTime() / 1000),
  };
}

function sanitizeProviderError(error, fallback) {
  const code = safeKey(error?.code || error?.type || "", "");
  return code ? `${fallback} (${code}).` : `${fallback}.`;
}

function sanitizeBalanceBuckets(buckets) {
  return (Array.isArray(buckets) ? buckets : [])
    .map((bucket) => ({
      currency: safeKey(bucket?.currency),
      amountMinor: finiteInteger(bucket?.amount),
    }))
    .sort((left, right) => left.currency.localeCompare(right.currency));
}

function addAggregate(map, key, seed, values) {
  const current = map.get(key) || { ...seed, count: 0, amountMinor: 0, feeMinor: 0, netMinor: 0 };
  current.count += 1;
  current.amountMinor += finiteInteger(values.amount);
  current.feeMinor += finiteInteger(values.fee);
  current.netMinor += finiteInteger(values.net);
  map.set(key, current);
}

function sortedAggregates(map, fields) {
  return [...map.values()].sort((left, right) => {
    for (const field of fields) {
      const compared = String(left[field] || "").localeCompare(String(right[field] || ""));
      if (compared) return compared;
    }
    return 0;
  });
}

function summarizeBalanceTransactions(records) {
  const byCurrency = new Map();
  const byCategory = new Map();
  const dailyLedger = new Map();

  for (const record of Array.isArray(records) ? records : []) {
    const currency = safeKey(record?.currency);
    const reportingCategory = safeKey(record?.reporting_category || record?.type);
    const type = safeKey(record?.type);
    const status = safeKey(record?.status);
    const created = new Date(finiteInteger(record?.created) * 1000);
    const date = Number.isFinite(created.getTime()) ? created.toISOString().slice(0, 10) : "unknown";
    const values = { amount: record?.amount, fee: record?.fee, net: record?.net };

    addAggregate(byCurrency, currency, { currency }, values);
    addAggregate(
      byCategory,
      `${currency}:${reportingCategory}:${type}`,
      { currency, reportingCategory, type },
      values
    );
    addAggregate(
      dailyLedger,
      `${date}:${currency}:${reportingCategory}:${type}:${status}`,
      { date, currency, reportingCategory, type, status },
      values
    );
  }

  return {
    totalsByCurrency: sortedAggregates(byCurrency, ["currency"]),
    categories: sortedAggregates(byCategory, ["currency", "reportingCategory", "type"]),
    dailyLedger: sortedAggregates(dailyLedger, ["date", "currency", "reportingCategory", "type", "status"]),
  };
}

function summarizePayouts(records) {
  const groups = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    const currency = safeKey(record?.currency);
    const status = safeKey(record?.status);
    const key = `${currency}:${status}`;
    const current = groups.get(key) || { currency, status, count: 0, amountMinor: 0 };
    current.count += 1;
    current.amountMinor += finiteInteger(record?.amount);
    groups.set(key, current);
  }
  return sortedAggregates(groups, ["currency", "status"]);
}

async function collectAsyncRecords(iterable, limit) {
  const records = [];
  for await (const record of iterable) {
    records.push(record);
    if (records.length >= limit) break;
  }
  return records;
}

async function getStripeFinanceSnapshot({
  stripeClient,
  days = DEFAULT_DAYS,
  now = new Date(),
  transactionLimit = DEFAULT_TRANSACTION_LIMIT,
  payoutLimit = DEFAULT_PAYOUT_LIMIT,
} = {}) {
  const window = getFinanceWindow({ days, now });
  const readOnlyOperations = [
    "balance.retrieve",
    "balanceTransactions.list",
    "payouts.list",
  ];

  if (!stripeClient) {
    return {
      configured: false,
      fetchedAt: window.to,
      window,
      readOnly: true,
      readOnlyOperations,
      mutationsPerformed: 0,
      balance: { available: [], pending: [] },
      balanceTransactions: {
        count: 0,
        resultLimit: transactionLimit,
        resultLimitReached: false,
        totalsByCurrency: [],
        categories: [],
        dailyLedger: [],
      },
      payouts: { count: 0, resultLimit: payoutLimit, resultLimitReached: false, groups: [] },
      warnings: ["Stripe financial activity is unavailable because the server Stripe client is not configured."],
    };
  }

  const warnings = [];
  let balance = null;
  let balanceTransactions = [];
  let payouts = [];

  const [balanceResult, transactionResult, payoutResult] = await Promise.allSettled([
    Promise.resolve().then(() => stripeClient.balance.retrieve()),
    Promise.resolve().then(() => collectAsyncRecords(
      stripeClient.balanceTransactions.list({
        created: { gte: window.fromUnix, lte: window.toUnix },
        limit: 100,
      }),
      transactionLimit
    )),
    Promise.resolve().then(() => collectAsyncRecords(
      stripeClient.payouts.list({
        created: { gte: window.fromUnix, lte: window.toUnix },
        limit: 100,
      }),
      payoutLimit
    )),
  ]);

  if (balanceResult.status === "fulfilled") balance = balanceResult.value;
  else warnings.push(sanitizeProviderError(balanceResult.reason, "Stripe balance read failed"));

  if (transactionResult.status === "fulfilled") balanceTransactions = transactionResult.value;
  else warnings.push(sanitizeProviderError(transactionResult.reason, "Stripe balance-transaction read failed"));

  if (payoutResult.status === "fulfilled") payouts = payoutResult.value;
  else warnings.push(sanitizeProviderError(payoutResult.reason, "Stripe payout read failed"));

  const transactionSummary = summarizeBalanceTransactions(balanceTransactions);
  return {
    configured: true,
    fetchedAt: window.to,
    window,
    readOnly: true,
    readOnlyOperations,
    mutationsPerformed: 0,
    balance: {
      available: sanitizeBalanceBuckets(balance?.available),
      pending: sanitizeBalanceBuckets(balance?.pending),
      connectReserved: sanitizeBalanceBuckets(balance?.connect_reserved),
    },
    balanceTransactions: {
      count: balanceTransactions.length,
      resultLimit: transactionLimit,
      resultLimitReached: balanceTransactions.length >= transactionLimit,
      ...transactionSummary,
    },
    payouts: {
      count: payouts.length,
      resultLimit: payoutLimit,
      resultLimitReached: payouts.length >= payoutLimit,
      groups: summarizePayouts(payouts),
    },
    warnings,
  };
}

module.exports = {
  collectAsyncRecords,
  getFinanceWindow,
  getStripeFinanceSnapshot,
  normalizeFinanceDays,
  sanitizeBalanceBuckets,
  summarizeBalanceTransactions,
  summarizePayouts,
};
