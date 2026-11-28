'use strict';
const crypto = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');

// Only digests live in this bounded, process-local optimization. A restart or
// expired entry performs the normal work again; this is never a provider receipt.
function canonical(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort()
    .filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])]));
  return value;
}
const digest = value => crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
function savedStamp(row) {
  if (!row) return null;
  // logCall returns a transient requestCapture result and differently included
  // relations. Compare every persisted Call field, plus the relevant caller.
  const { business, caller, requestCapture, ...fields } = row;
  return digest({ fields, caller: caller ? { id: caller.id, phone: caller.phone, name: caller.name } : null });
}
function terminal(call) {
  return call?.status === 'ended' && Boolean(call.endedAt || call.ended_at || call.completedAt);
}
function createCallSyncWorkload({ now = Date.now, wait = delay, pauseMs = 100,
  maxAgeMs = 60 * 60_000, maxEntries = 1000 } = {}) {
  for (const [value, min, max] of [[pauseMs, 1, 1000], [maxAgeMs, 1, 24 * 60 * 60_000], [maxEntries, 1, 1000]]) {
    if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error('Invalid bounded call-sync workload policy.');
  }
  const cache = new Map(), staged = new WeakMap();
  const id = call => String(call?.id || call?.callId || '').trim();
  return {
    pace: () => wait(pauseMs),
    invalidate: call => cache.delete(id(call)),
    unchanged(call, row) {
      const entry = cache.get(id(call));
      if (!entry || !terminal(call) || !row || row.externalProvider !== 'vapi' || row.externalId !== id(call)) return false;
      const age = now() - entry.at;
      return age >= 0 && age < maxAgeMs && entry.provider === digest(call) && entry.saved === savedStamp(row);
    },
    stage(call, row, result) {
      if (!id(call) || !terminal(call) || !row || row.externalProvider !== 'vapi' || row.externalId !== id(call)
        || !['COMPLETED', 'FAILED', 'MISSED', 'ABANDONED'].includes(row.status)
        || result.requestCapture?.errorCode || result.requestCapture?.state === 'unconfirmed') return;
      staged.set(result, { id: id(call), provider: digest(call), saved: savedStamp(row), at: now() });
    },
    // Called only after the associated trial-usage reconciliation succeeds.
    commit(result) {
      const entry = staged.get(result);
      if (!entry) return;
      staged.delete(result);
      cache.delete(entry.id);
      cache.set(entry.id, entry);
      while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
    },
  };
}
module.exports = { createCallSyncWorkload };
