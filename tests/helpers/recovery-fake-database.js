// Serialized transactions model the production advisory lock. Provider fakes
// remain separate so tests can simulate a create succeeding before a crash.
function recoveryFakeDatabase() {
  const rows = new Map();
  let tail = Promise.resolve();
  const runtimeStore = {
    async findUnique({ where }) { return rows.has(where.key) ? { key: where.key, data: structuredClone(rows.get(where.key)) } : null; },
    async upsert({ where, create, update }) { const data = structuredClone(rows.has(where.key) ? update.data : create.data); rows.set(where.key, data); return { key: where.key, data }; },
  };
  const prisma = { runtimeStore, signupAttempt: { findUnique: async () => ({ status: "processing" }) },
    $transaction(work) {
      const next = tail.then(() => work({ runtimeStore, $queryRaw: async () => [] }));
      tail = next.catch(() => {});
      return next;
    },
  };
  return { prisma, rows };
}
module.exports = { recoveryFakeDatabase };
