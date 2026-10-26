const { setupError } = require('./voiceCallReliability');

// The database remains authoritative. No in-memory quota bypass and no wait
// behind an unbounded advisory lock on the telephony answering path.
async function reserveCall({ db, signup, config, callId, key, callIndexKey, getUsedSeconds, getLifecycle, decide, limits, guard }) {
  guard?.check();
  const remaining = Math.floor(guard?.remainingMs() ?? 4500);
  if (remaining < 300) throw setupError('VOICE_ASSISTANT_REQUEST_DEADLINE');
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('statement_timeout', '700ms', true), set_config('lock_timeout', '200ms', true)`;
    const locks = await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(hashtext(${key})) AS acquired`;
    if (locks[0]?.acquired !== true) throw setupError('VOICE_TRIAL_RESERVATION_BUSY');
    guard?.check();
    const [row, usedSeconds] = await Promise.all([
      tx.runtimeStore.findUnique({ where: { key } }),
      getUsedSeconds(signup, Number(config.businessId), tx),
    ]);
    guard?.check();
    const data = row?.data && typeof row.data === 'object' ? row.data : {};
    const now = Date.now();
    const reservations = Object.fromEntries(Object.entries(data.reservations || {})
      .filter(([, entry]) => Number(entry?.expiresAt || 0) > now));
    const lifecycle = getLifecycle(signup);
    const reservedSeconds = Object.values(reservations)
      .reduce((total, entry) => total + Math.max(0, Number(entry?.allowanceSeconds || 0)), 0);
    // A replay cannot resurrect an expired/archived trial.
    if (reservations[callId] && lifecycle.state === 'trial') {
      const allowanceSeconds = Number(reservations[callId].allowanceSeconds || 0);
      return { action: allowanceSeconds < Number(config.assistantMaxSeconds || limits.maxCallSeconds)
        ? 'allow-transient' : 'allow-saved', allowanceSeconds, duplicateReservation: true };
    }
    const decision = decide({ lifecycle, usedSeconds, reservedSeconds,
      assistantMaxSeconds: config.assistantMaxSeconds || limits.maxCallSeconds,
      warningSeconds: limits.warningSeconds, limitSeconds: limits.limitSeconds,
      completionReserveSeconds: limits.completionReserveSeconds, minCallSeconds: limits.minCallSeconds });
    if (decision.action === 'block') {
      // Keep an immutable, database-backed explanation for terminal-event
      // retries. Releasing a call lease must not turn an intentional policy
      // hold into a false outage alert on the next delivery.
      const policyKey = `voice-call-policy:${callId}`;
      const policy = { callId, businessId: Number(config.businessId), decision: 'block',
        reason: decision.reason, createdAt: new Date(now).toISOString() };
      guard?.check();
      await tx.runtimeStore.upsert({ where: { key: policyKey }, update: {}, create: { key: policyKey, data: policy } });
      guard?.check();
      return decision;
    }
    if (!decision.action.startsWith('allow') || lifecycle.state === 'paid') return decision;
    reservations[callId] = { allowanceSeconds: decision.allowanceSeconds,
      createdAt: new Date(now).toISOString(),
      expiresAt: now + (decision.allowanceSeconds + limits.reservationGraceSeconds) * 1000 };
    const next = { ...data, reservations, updatedAt: new Date(now).toISOString() };
    guard?.check();
    await tx.runtimeStore.upsert({ where: { key }, update: { data: next }, create: { key, data: next } });
    guard?.check();
    const index = { reservationKey: key, callId, businessId: Number(config.businessId) };
    await tx.runtimeStore.upsert({ where: { key: callIndexKey }, update: { data: index }, create: { key: callIndexKey, data: index } });
    guard?.check();
    return decision;
  }, { maxWait: Math.min(300, remaining - 100), timeout: Math.min(1800, remaining - 100) });
}

module.exports = { reserveCall };
