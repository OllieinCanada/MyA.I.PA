'use strict';
const { scryptSync, randomUUID } = require('node:crypto');
const { PROVIDERS, cleanMetric, cleanMetrics, decorate, overview, torontoDay } = require('./providerFinanceView');

function scopesFor(env) {
  const derive = value => scryptSync(JSON.stringify(value), 'myaipa-provider-finance-provider-scope:v2', 20, { N: 16384, r: 8, p: 1 }).toString('hex');
  return {
    twilio: derive(['twilio', env.TWILIO_ACCOUNT_SID || '']),
    vapi: derive(['vapi', env.FINANCE_VAPI_ORGANIZATION_ID || env.VAPI_API_KEY || '']),
    make: derive(['make', env.FINANCE_MAKE_ORGANIZATION_ID || '', env.FINANCE_MAKE_ZONE || 'us2']),
    render: derive(['render', env.FINANCE_RENDER_WORKSPACE_ID || env.RENDER_SERVICE_ID || 'this-application']),
  };
}
function legacyScopeFor(env) {
  return scryptSync(JSON.stringify([env.TWILIO_ACCOUNT_SID || '', env.VAPI_API_KEY || '', env.FINANCE_MAKE_ORGANIZATION_ID || '', env.FINANCE_MAKE_ZONE || '', env.RENDER_SERVICE_ID || '']),
    'myaipa-provider-finance-cache-scope:v1', 20, { N: 16384, r: 8, p: 1 }).toString('hex');
}

function createFinanceStore({ prisma, env = process.env, collect, fetchImpl, validateVerified, manualFields, clock = () => Date.now(), timeoutMs = 4500 }) {
  const scopes = scopesFor(env), legacyScope = legacyScopeFor(env), states = {};
  const key = (id, suffix) => `provider-finance:v2:${id}:${scopes[id]}:${suffix}`;
  const legacyKey = suffix => `${suffix}:${legacyScope}`;
  const manualSuffix = field => `verified:${field}`;
  const oldManual = (id, field) => `provider-finance:v1:verified:${id}:${field}`;
  const historyPrefix = id => key(id, 'history:');
  let inFlight = null, lastAttempt = 0, persistenceWarning = null;
  const bounded = async promise => {
    let timer;
    try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('finance_storage_timeout')), timeoutMs); })]); }
    finally { clearTimeout(timer); }
  };
  const transaction = work => bounded(prisma.$transaction
    ? prisma.$transaction(tx => work(tx), { isolationLevel: 'Serializable', timeout: Math.max(1000, timeoutMs) })
    : work(prisma));
  const put = (store, recordKey, data, immutable = false) => store.runtimeStore.upsert({ where: { key: recordKey }, create: { key: recordKey, data }, update: immutable ? {} : { data } });
  const manualEntry = (id, field, data) => {
    const metric = cleanMetric(data);
    if (!metric || data.provider !== id || data.field !== field) return null;
    return { ...metric, provider: id, field, ...(field === 'monthlyEstimate' ? { billingMonth: metric.billingMonth || (metric.observedAt && Number.isFinite(Date.parse(metric.observedAt)) ? torontoDay(metric.observedAt).slice(0, 7) : null) } : {}) };
  };

  async function load() {
    const keys = [legacyKey('provider-finance:v1:snapshot')];
    for (const id of PROVIDERS) {
      keys.push(key(id, 'snapshot'));
      for (const field of manualFields[id]) keys.push(key(id, manualSuffix(field)), legacyKey(oldManual(id, field)));
    }
    const rows = await bounded(prisma.runtimeStore.findMany({ where: { key: { in: keys } } }));
    const records = new Map(rows.map(row => [row.key, row.data]));
    const old = records.get(legacyKey('provider-finance:v1:snapshot'));
    const verified = [], migrations = [];
    for (const id of PROVIDERS) {
      const saved = records.get(key(id, 'snapshot'));
      const fallback = old && { metrics: cleanMetrics(old.providers?.[id]), errors: old.errors?.[id] || [], attemptedAt: old.attemptedAt };
      if (!states[id] || (Date.parse(saved?.attemptedAt || '') || 0) > (Date.parse(states[id]?.attemptedAt || '') || 0)) states[id] = saved || fallback || { metrics: {}, errors: [], attemptedAt: null };
      if (!saved && fallback) migrations.push([key(id, 'snapshot'), fallback]);
      for (const field of manualFields[id]) {
        const recordKey = key(id, manualSuffix(field));
        const entry = manualEntry(id, field, records.get(recordKey) || records.get(legacyKey(oldManual(id, field))) || {});
        if (entry) {
          verified.push(entry);
          if (!records.has(recordKey)) {
            migrations.push([recordKey, entry]);
            migrations.push([key(id, `history:baseline:${field}`), { type: 'baseline', provider: id, field, value: entry,
              recordedAt: new Date(clock()).toISOString(), note: 'Existing current-account record imported; original check time retained.' }]);
          }
        }
      }
    }
    if (migrations.length) {
      try { await transaction(async store => { for (const [recordKey, data] of migrations) await put(store, recordKey, data, true); }); }
      catch (_) { persistenceWarning = 'Existing records are visible, but their provider-specific migration is not confirmed saved.'; }
    }
    if (!lastAttempt && PROVIDERS.every(id => states[id]?.attemptedAt)) lastAttempt = Math.min(...PROVIDERS.map(id => Date.parse(states[id].attemptedAt) || 0));
    return verified;
  }

  async function refresh() {
    if (inFlight || clock() - lastAttempt < 5 * 60000) return inFlight;
    lastAttempt = clock();
    inFlight = (async () => {
      const result = await bounded(collect({ prisma, env, fetchImpl, now: new Date(clock()) }));
      const at = result.attemptedAt;
      for (const id of PROVIDERS) states[id] = { metrics: { ...cleanMetrics(states[id]?.metrics), ...cleanMetrics(result.updates?.[id]) },
        errors: (result.errors?.[id] || []).filter(value => typeof value === 'string'), attemptedAt: at };
      try {
        await transaction(async store => {
          for (const id of PROVIDERS) {
            await put(store, key(id, 'snapshot'), states[id]);
            // One immutable sample per UTC hour. This is sampled history, not continuous uptime proof.
            await put(store, key(id, `history:snapshot:${at.slice(0, 13)}`), { type: 'snapshot', provider: id, recordedAt: at, metrics: states[id].metrics, warnings: states[id].errors }, true);
          }
        });
        persistenceWarning = null;
      } catch (_) { persistenceWarning = 'The latest snapshot could not be confirmed saved. It may not survive a server restart.'; }
    })().catch(() => { persistenceWarning = 'Finance refresh failed. Previous values are retained; missing values are unknown.'; }).finally(() => { inFlight = null; });
    return inFlight;
  }

  return {
    async read() {
      const verified = await load();
      void refresh();
      const snapshot = { providers: {}, errors: {} };
      for (const id of PROVIDERS) { snapshot.providers[id] = states[id]?.metrics || {}; snapshot.errors[id] = states[id]?.errors || []; }
      const providers = decorate(snapshot, verified, clock(), env);
      return { checkedAt: new Date(clock()).toISOString(), refreshing: Boolean(inFlight), refreshEverySeconds: 300,
        persistenceWarning, providers, manualFields, overview: overview(providers, clock(), persistenceWarning),
        billingDayTimezone: 'UTC', displayTimezone: 'America/Toronto',
        snapshotAt: Object.values(states).map(value => value.attemptedAt).filter(Boolean).sort().at(-1) || null };
    },
    async save(body) {
      const entry = validateVerified(body, clock());
      await load(); // Migrate only the exact legacy/current account; never scan other accounts.
      const recordKey = key(entry.provider, manualSuffix(entry.field));
      await transaction(async store => {
        const rows = await store.runtimeStore.findMany({ where: { key: { in: [recordKey] } } });
        const previous = manualEntry(entry.provider, entry.field, rows[0]?.data || {});
        if (previous && JSON.stringify(previous) === JSON.stringify(manualEntry(entry.provider, entry.field, entry))) return;
        await put(store, recordKey, entry);
        await put(store, key(entry.provider, `history:verification:${randomUUID()}`), { type: 'verification', provider: entry.provider,
          field: entry.field, previous, value: entry, recordedAt: new Date(clock()).toISOString(), actor: 'Signed-in administrator' }, true);
      });
      return entry;
    },
    async history(provider) {
      if (!PROVIDERS.includes(provider)) throw new Error('Choose a supported provider.');
      await load();
      const rows = await bounded(prisma.runtimeStore.findMany({ where: { key: { startsWith: historyPrefix(provider) } }, orderBy: { createdAt: 'desc' }, take: 50 }));
      return rows.map(row => {
        const data = row.data || {};
        return { type: ['snapshot', 'verification', 'baseline'].includes(data.type) ? data.type : 'snapshot', provider,
          recordedAt: typeof data.recordedAt === 'string' && Number.isFinite(Date.parse(data.recordedAt)) ? data.recordedAt : null, field: manualFields[provider].includes(data.field) ? data.field : null,
          metrics: cleanMetrics(data.metrics), value: cleanMetric(data.value), previous: cleanMetric(data.previous),
          warnings: Array.isArray(data.warnings) ? data.warnings.filter(value => typeof value === 'string').map(value => value.slice(0, 200)) : [],
          note: data.type === 'baseline' ? 'Imported baseline; original check time retained.' : undefined };
      });
    },
    waitForRefresh: () => inFlight,
  };
}

module.exports = { createFinanceStore, scopesFor, legacyScopeFor };
