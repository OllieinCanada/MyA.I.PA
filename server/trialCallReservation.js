const { setupError, ASSISTANT_REQUEST_BUDGET_MS } = require('./voiceCallReliability');

// Reserve response/commit headroom inside the existing 4.5s answering budget.
// These are ceilings, not permission to run past the request's remaining time.
const RESERVATION_MAX_MS = 3200;
const RESERVATION_REPLY_MARGIN_MS = 250;
const RESERVATION_LOCK_MS = 600;
function reservationBudget(remainingMs) {
  const remaining = Math.floor(remainingMs);
  if (!Number.isFinite(remaining)) throw setupError('VOICE_ASSISTANT_REQUEST_DEADLINE');
  const maxWait = Math.min(300, Math.max(0, remaining - 650));
  const timeout = Math.min(RESERVATION_MAX_MS, remaining - maxWait - RESERVATION_REPLY_MARGIN_MS);
  if (!Number.isFinite(timeout) || timeout < 400) throw setupError('VOICE_ASSISTANT_REQUEST_DEADLINE');
  return { maxWait, timeout };
}

// Never log raw Prisma messages/SQL/values. These fixed categories distinguish
// lock contention, a statement timeout and an interactive-transaction failure.
function reservationFailure(error, stage) {
  const code = String(error?.code || '');
  const sqlState = String(error?.meta?.code || '');
  const category = sqlState === '55P03' ? 'lock_timeout'
    : sqlState === '57014' ? 'statement_timeout'
      : code === 'P2028' ? 'transaction_api_error' : 'database_error';
  const result = /^VOICE_/.test(code) ? error : setupError(
    category === 'lock_timeout' ? 'VOICE_TRIAL_RESERVATION_BUSY' : 'VOICE_TRIAL_RESERVATION_FAILED');
  result.reservationDiagnostic = { stage, category,
    databaseCode: /^P\d{4}$/.test(code) ? code : 'unknown',
    sqlState: /^(?:55P03|57014)$/.test(sqlState) ? sqlState : 'unknown' };
  return result;
}

// The database stays authoritative. Under one bounded transaction-scoped lock,
// read usage + leases together and write the lease + call index together.
async function reserveCall({ db, signup, config, callId, key, callIndexKey, getLifecycle, decide, limits, guard }) {
  guard?.check();
  const options = reservationBudget(guard?.remainingMs() ?? ASSISTANT_REQUEST_BUDGET_MS);
  let stage = 'acquire';
  const step = async (name, fn) => {
    stage = name;
    if (guard) return guard.stage('reservation.' + name, fn);
    return fn();
  };
  const prepareCommit = value => { stage = 'commit'; return value; };
  try {
    const decision = await db.$transaction(async (tx) => {
      // Set limits in a separate statement BEFORE taking a blocking lock.
      // They are local to this transaction and cannot change pool defaults.
      await step('limits', () => tx.$queryRaw`SELECT
        set_config('statement_timeout', ${Math.min(700, options.timeout - 100) + 'ms'}, true),
        set_config('lock_timeout', ${Math.min(RESERVATION_LOCK_MS, options.timeout - 150) + 'ms'}, true)`);
      await step('lock', () => tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))::text AS locked`);
      const window = getLifecycle(signup);
      const start = window.startAt ? new Date(window.startAt) : null;
      const end = window.endAt ? new Date(window.endAt) : null;
      const rows = await step('read', () => tx.$queryRaw`SELECT
        (SELECT "data" FROM "RuntimeStore" WHERE "key" = ${key}) AS data,
        (SELECT COALESCE(SUM("durationSec"), 0)::text FROM "Call"
          WHERE "businessId" = ${Number(config.businessId)} AND "externalProvider" = 'vapi'
          AND ${start}::timestamp IS NOT NULL AND "startedAt" >= ${start}::timestamp
          AND (${end}::timestamp IS NULL OR "startedAt" <= ${end}::timestamp)) AS "usedSeconds"`);
      if (rows.length !== 1 || !/^\d+$/.test(String(rows[0].usedSeconds))) {
        throw setupError('VOICE_TRIAL_USAGE_UNPROVEN');
      }
      const usedSeconds = Number(rows[0].usedSeconds);
      if (!Number.isSafeInteger(usedSeconds)) throw setupError('VOICE_TRIAL_USAGE_UNPROVEN');
      const data = rows[0].data && typeof rows[0].data === 'object' ? rows[0].data : {};
      const now = Date.now();
      const reservations = Object.fromEntries(Object.entries(data.reservations || {})
        .filter(([, entry]) => Number(entry?.expiresAt || 0) > now));
      const lifecycle = getLifecycle(signup); // Recheck expiration after DB waits.
      const reservedSeconds = Object.values(reservations)
        .reduce((total, entry) => total + Math.max(0, Number(entry?.allowanceSeconds || 0)), 0);
      if (reservations[callId] && lifecycle.state === 'trial') {
        const allowanceSeconds = Number(reservations[callId].allowanceSeconds || 0);
        return prepareCommit({ action: allowanceSeconds < Number(config.assistantMaxSeconds || limits.maxCallSeconds)
          ? 'allow-transient' : 'allow-saved', allowanceSeconds, duplicateReservation: true });
      }
      const result = decide({ lifecycle, usedSeconds, reservedSeconds,
        assistantMaxSeconds: config.assistantMaxSeconds || limits.maxCallSeconds,
        warningSeconds: limits.warningSeconds, limitSeconds: limits.limitSeconds,
        completionReserveSeconds: limits.completionReserveSeconds, minCallSeconds: limits.minCallSeconds });
      if (result.action === 'block') {
        const policy = { callId, businessId: Number(config.businessId), decision: 'block',
          reason: result.reason, createdAt: new Date(now).toISOString() };
        await step('policy', () => tx.$executeRaw`INSERT INTO "RuntimeStore" ("key", "data", "createdAt", "updatedAt")
          VALUES (${'voice-call-policy:' + callId}, ${JSON.stringify(policy)}::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          ON CONFLICT ("key") DO NOTHING`);
        return prepareCommit(result);
      }
      if (!result.action.startsWith('allow') || lifecycle.state === 'paid') return prepareCommit(result);
      reservations[callId] = { allowanceSeconds: result.allowanceSeconds,
        createdAt: new Date(now).toISOString(),
        expiresAt: now + (result.allowanceSeconds + limits.reservationGraceSeconds) * 1000 };
      const next = { ...data, reservations, updatedAt: new Date(now).toISOString() };
      const index = { reservationKey: key, callId, businessId: Number(config.businessId) };
      await step('write', () => tx.$executeRaw`INSERT INTO "RuntimeStore" ("key", "data", "createdAt", "updatedAt") VALUES
        (${key}, ${JSON.stringify(next)}::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
        (${callIndexKey}, ${JSON.stringify(index)}::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT ("key") DO UPDATE SET "data" = EXCLUDED."data", "updatedAt" = EXCLUDED."updatedAt"`);
      return prepareCommit(result);
    }, options);
    // A commit can cross a disconnect/deadline. The caller reconciles the exact
    // call lease; no response is allowed from a late/uncertain commit.
    stage = 'commit';
    guard?.check();
    return decision;
  } catch (error) { throw reservationFailure(error, stage); }
}

module.exports = { reserveCall, reservationBudget, reservationFailure };
