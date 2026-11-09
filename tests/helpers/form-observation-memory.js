const copy = value => JSON.parse(JSON.stringify(value));
module.exports = function memory() {
  const rows = new Map(); return { rows, get: async key => copy(rows.get(key) || null),
    createIfExpired: async (key, record, cutoff) => { const old = rows.get(key); if (old && old.createdAt > cutoff) return false; rows.set(key, copy(record)); return true; },
    compareSwap: async (key, previous, next) => { if (JSON.stringify(rows.get(key)) !== JSON.stringify(previous)) return false; rows.set(key, copy(next)); return true; },
    list: async (cutoff, limit) => [...rows.values()].filter(r => r.createdAt > cutoff).sort((a,b) => (b.lastObservedAt || b.createdAt) - (a.lastObservedAt || a.createdAt)).slice(0, limit).map(copy),
    listByAttempt: async (attemptId, cutoff) => [...rows.values()].filter(r => r.createdAt > cutoff && r.linkedAttemptId === attemptId).sort((a,b) => (b.lastObservedAt || 0) - (a.lastObservedAt || 0)).slice(0, 2).map(copy),
    purgeExpired: async cutoff => { for (const [key, row] of rows) if (key.startsWith('signup-form-observation:v1:') && row.createdAt <= cutoff) rows.delete(key); },
  };
};
