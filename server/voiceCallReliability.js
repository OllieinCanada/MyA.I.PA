const { performance } = require('node:perf_hooks');

// Vapi's assistant-request has a fixed 7.5s end-to-end deadline. Leave room
// for both network legs; never authorize from a late or failed lookup.
const ASSISTANT_REQUEST_BUDGET_MS = 4500;
const CALL_SETUP_FAILURE_MESSAGE = 'We are unable to connect you to the receptionist right now. Please try calling again shortly.';
const ASSISTANT_REQUEST_FAILURES = Object.freeze([
  'assistant-request-failed', 'assistant-request-returned-error',
  'assistant-request-returned-unspeakable-error',
  'assistant-request-returned-invalid-assistant',
  'assistant-request-returned-no-assistant',
]);

function setupError(code, message = 'Call setup could not finish safely.') {
  return Object.assign(new Error(message), { code, statusCode: 503 });
}

function createAssistantRequestGuard({ budgetMs = ASSISTANT_REQUEST_BUDGET_MS, now = () => performance.now() } = {}) {
  const started = now();
  let expired = false;
  const stages = {};
  const guard = {
    stages,
    elapsedMs: () => Math.max(0, Math.round(now() - started)),
    remainingMs: () => Math.max(0, budgetMs - (now() - started)),
    expire: () => { expired = true; },
    check() {
      if (expired || guard.remainingMs() <= 0) throw setupError('VOICE_ASSISTANT_REQUEST_DEADLINE');
    },
    async stage(name, fn) {
      guard.check();
      const before = now();
      try { const result = await fn(); guard.check(); return result; }
      finally { stages[name] = Math.max(0, Math.round(now() - before)); }
    },
  };
  return guard;
}

async function runAssistantRequest({ resolve, budgetMs = ASSISTANT_REQUEST_BUDGET_MS, onFailure = () => {}, onComplete = () => {} }) {
  const guard = createAssistantRequestGuard({ budgetMs });
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(() => resolve(guard)),
      new Promise((_, reject) => {
        timer = setTimeout(() => { guard.expire(); reject(setupError('VOICE_ASSISTANT_REQUEST_DEADLINE')); }, budgetMs);
      }),
    ]);
  } catch (error) {
    guard.expire();
    // Reporting is not allowed to hold up answering or throw another failure.
    setImmediate(() => { try { Promise.resolve(onFailure(error, guard)).catch(() => {}); } catch {} });
    return { error: CALL_SETUP_FAILURE_MESSAGE };
  } finally {
    clearTimeout(timer);
    try { onComplete(guard); } catch {}
  }
}

function withCallSetupFailureHook(hooks = []) {
  // Preserve unrelated/user-owned hooks. A custom call.ending hook must not be
  // overwritten implicitly; the deployment check must review it separately.
  const current = Array.isArray(hooks) ? hooks : [];
  if (current.some((hook) => hook?.on === 'call.ending')) return current;
  return [...current, {
    on: 'call.ending',
    filters: [{ type: 'oneOf', key: 'call.endedReason', oneOf: [...ASSISTANT_REQUEST_FAILURES] }],
    do: { type: 'say', exact: CALL_SETUP_FAILURE_MESSAGE },
  }];
}

function mapCallStatus(status, endedReason = '') {
  const reason = String(endedReason || '').toLowerCase();
  if (/assistant-request-|call\.ending\.hook-executed-|(?:^|[.-])error(?:[.-]|$)|failed|not-found|not-valid/.test(reason)) return 'FAILED';
  const normalized = String(status || endedReason || '').trim().toLowerCase();
  if (/failed|error/.test(normalized)) return 'FAILED';
  if (/missed|no-answer|no_answer/.test(normalized)) return 'MISSED';
  if (['abandoned', 'canceled', 'cancelled'].includes(normalized)) return 'ABANDONED';
  if (/ended|hangup/.test(normalized) || ['completed', 'complete', 'success', 'successful'].includes(normalized)) return 'COMPLETED';
  return 'STARTED';
}

function shouldReportCallSetupFailure({ endedReason, callId, businessId, policy }) {
  if (!/^(?:assistant-request-|call\.ending\.hook-executed-)/.test(String(endedReason || ''))) return false;
  return !(policy?.decision === 'block' && policy.callId === callId && Number(policy.businessId) === Number(businessId));
}

module.exports = {
  ASSISTANT_REQUEST_BUDGET_MS, ASSISTANT_REQUEST_FAILURES,
  CALL_SETUP_FAILURE_MESSAGE, createAssistantRequestGuard,
  mapCallStatus, runAssistantRequest, setupError, shouldReportCallSetupFailure, withCallSetupFailureHook,
};
