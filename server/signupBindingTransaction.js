'use strict';
const { performance } = require('node:perf_hooks');
const LOCK = 'signup-business-bindings:v1';
const busy = () => Object.assign(new Error('Business mapping is busy. Inspect saved state before recovery.'),
  { code: 'SIGNUP_BUSINESS_MAPPING_BUSY', statusCode: 503, signupDiagnosticStage: 'business-mapping' });

// All binding/registry writers retain the SAME cross-process lock. Contention
// waits outside transactions, rather than consuming Prisma's transaction clock.
// Only a confirmed false try-lock result permits another DB-only admission.
// Never retry a transaction error, callback, commit, or provider operation.
// Admission waits have a 20s budget; admitted work gets a fresh 10s transaction
// allowance, not a few milliseconds left over from waiting for another signup.
function createBindingTransaction({ now = () => performance.now(), sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), random = Math.random } = {}) {
  return async function bindingTransaction(prisma, work) {
    const deadline = now() + 20_000;
    for (let attempt = 0; attempt < 200; attempt++) {
      const remaining = Math.floor(deadline - now());
      if (remaining <= 0) throw busy();
      let result;
      try {
        result = await prisma.$transaction(async tx => {
          const rows = await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(hashtext(${LOCK})) AS acquired`;
          if (rows?.length !== 1 || typeof rows[0].acquired !== 'boolean') {
            throw Object.assign(new Error('Business mapping lock proof unavailable.'), { code: 'SIGNUP_BUSINESS_LOCK_UNVERIFIED', statusCode: 503 });
          }
          if (!rows[0].acquired) return { acquired: false };
          if (now() >= deadline) throw busy();
          return { acquired: true, value: await work(tx) };
        }, { maxWait: Math.min(2_000, remaining), timeout: 10_000 });
      } catch (error) {
        // Server-owned checkpoint, not an assertion of rollback or retry safety.
        try { error.signupDiagnosticStage = 'business-mapping'; }
        catch { /* A frozen/non-object failure must retain its original outcome. */ }
        throw error;
      }
      if (result.acquired) return result.value;
      // Back off instead of hammering the pool; jitter separates concurrent
      // signups. No backoff path has admitted the mapping callback yet.
      const delay = Math.min(100 * 2 ** Math.min(attempt, 3) + Math.floor(random() * 100), deadline - now());
      if (delay > 0) await sleep(delay);
    }
    throw busy();
  };
}
const bindingTransaction = createBindingTransaction();
module.exports = { bindingTransaction, createBindingTransaction, LOCK };
