'use strict';
// Database-independent breadcrumbs only. Never import storage, provider SDKs or
// senders here. No bodies, URLs, headers, credentials or error messages are logged.
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const ROUTES = new Set([
  '/api/integrations/twilio/purchase-number',
  '/api/integrations/vapi/create-signup-assistant',
  '/api/integrations/vapi/import-twilio-number',
]);
const STEPS = new Set(['context_load', 'lifecycle_check', 'provisioning_step',
  'provider_dispatch', 'provider_reconcile', 'routing_setup', 'delivery_check', 'context_complete']);
const CHECKPOINTS = new Set(['connection_verified', 'signature_verified', 'context_verified',
  'context_validation_completed', 'preferences_verified', 'prerequisites_verified']);
const CONTEXT_CHECKPOINTS = new Set(['context_transaction_wait', 'context_transaction_admitted',
  'context_lock_wait', 'context_lock_acquired', 'context_read_started', 'context_read_completed',
  'context_update_started', 'context_update_completed', 'context_transaction_completed']);
const CODES = new Set(['P1001', 'P1002', 'P1008', 'P1017', 'P2002', 'P2010', 'P2024', 'P2028', 'P2034',
  '20003', 'PROVISIONING_STAGE_DEPENDENCY_MISSING', 'PROVISIONING_STAGE_RESULT_MISMATCH',
  'PROVISIONING_ATTEMPT_BINDING_INVALID', 'SIGNUP_BUSINESS_MAPPING_BUSY', 'SIGNUP_BUSINESS_LOCK_UNVERIFIED',
  'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT',
  'PROVISIONING_AUTH_INVALID', 'PROVISIONING_AUTHORIZATION_INVALID', 'PROVISIONING_AUTH_NOT_CONFIGURED',
  'PROVISIONING_SIGNING_NOT_CONFIGURED', 'PROVISIONING_CONTEXT_NOT_REGISTERED', 'PROVISIONING_CONTEXT_AUTHORIZATION_FAILED',
  'PROVISIONING_INVENTORY_CONTEXT_MISMATCH', 'PROVISIONING_ALREADY_IN_PROGRESS', 'PROVISIONING_RECONCILIATION_REQUIRED',
  'PROVISIONING_RESULT_STALE', 'LOCAL_CANADIAN_NUMBER_INVENTORY_UNAVAILABLE', 'SIGNUP_CLOSED',
  'SIGNUP_BUSINESS_MIGRATION_REQUIRED', 'SIGNUP_ARCHIVED_RESOURCES_STILL_OWNED', 'SIGNUP_ARCHIVED_RESOURCES_UNVERIFIED',
  'ASSIGNED_PHONE_REQUIRED', 'MAKE_SIGNUP_TIMEOUT', 'MAKE_SIGNUP_UNREACHABLE', 'MAKE_SIGNUP_REJECTED', 'SIGNUP_JOB_LEASE_LOST']);
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
function proofFingerprint(input) {
  try {
    const key = input?.idempotencyKey, context = input?.contextHash;
    return typeof key === 'string' && typeof context === 'string'
      && /^[a-f0-9]{64}$/i.test(key) && /^[a-f0-9]{64}$/i.test(context)
      ? sha('provisioning-trace-proof-v1\0' + key.toLowerCase() + '\0' + context.toLowerCase()) : null;
  } catch (_) { return null; }
}
function signupFingerprint(attemptId) {
  return typeof attemptId === 'string' && /^signup_[a-f0-9]{32}$/.test(attemptId)
    ? sha('provisioning-trace-signup-v1\0' + attemptId) : null;
}
function safeError(error) {
  let code = 'UNCLASSIFIED', providerStatus = null;
  try {
    if (error?.type === 'entity.parse.failed') code = 'INVALID_JSON';
    else for (const candidate of [error?.code, error?.providerCode, error?.cause?.code]) {
      if (CODES.has(candidate)) { code = candidate; break; }
    }
    const status = error?.providerStatus ?? error?.upstreamStatus;
    if (Number.isInteger(status) && status >= 400 && status <= 599) providerStatus = status;
  } catch (_) { /* Hostile error getters must not change the original failure. */ }
  return { code, providerStatus };
}
function canonicalRoute(req) {
  try { return typeof req?.path === 'string' ? req.path.toLowerCase().replace(/\/$/, '') : ''; }
  catch (_) { return ''; }
}
function createProvisioningRequestTrace({
  write = event => console.info('[provisioning-http]', JSON.stringify(event)),
  now = () => performance.now(), getRelease = () => process.env.RENDER_GIT_COMMIT,
} = {}) {
  const active = new WeakMap();
  let windowStart = 0, admitted = 0, dropped = 0;
  function emit(event) {
    try { const pending = write(event); if (pending && typeof pending.catch === 'function') pending.catch(() => {}); }
    catch (_) { /* Logging is best effort; no database fallback or logging retry. */ }
  }
  function newState(route, method) {
    const time = now();
    if (time - windowStart >= 60000) {
      if (dropped) emit({ version: 1, phase: 'coverage_gap', droppedRequests: dropped });
      windowStart = time; admitted = 0; dropped = 0;
    }
    // At most 120 bounded request/handoff traces per minute across all clients.
    if (admitted >= 120) { dropped = Math.min(dropped + 1, Number.MAX_SAFE_INTEGER); return null; }
    admitted++;
    let release = null;
    try { const value = getRelease(); if (typeof value === 'string' && /^[a-f0-9]{40}$/.test(value)) release = value; } catch (_) {}
    return { traceId: crypto.randomUUID(), route, method, release, started: time,
      proofHash: null, signatureVerified: false, signupHash: null, lastCheckpoint: null, seen: new Set(), failed: false };
  }
  function record(state, phase, details = {}) {
    if (!state) return;
    emit({ version: 1, traceId: state.traceId, release: state.release, route: state.route, method: state.method,
      proofHash: state.proofHash, signatureVerified: state.signatureVerified,
      signupHash: state.signupHash, signupIdentityVerified: state.signupHash !== null,
      phase, lastCheckpoint: state.lastCheckpoint,
      elapsedMs: Math.max(0, Math.min(3600000, Math.round(now() - state.started))), ...details });
  }
  function mark(state, checkpoint) {
    if (!state || state.seen.has(checkpoint)) return;
    state.seen.add(checkpoint); state.lastCheckpoint = checkpoint; record(state, 'checkpoint');
  }
  function failed(state, error) {
    if (!state || state.failed) return;
    state.failed = true; record(state, 'failed', safeError(error));
  }
  function observeProof(req, input) {
    try { const state = active.get(req); if (state && !state.signatureVerified) state.proofHash = proofFingerprint(input); } catch (_) {}
  }
  function middleware(req, res, next) {
    const route = canonicalRoute(req);
    if (!ROUTES.has(route)) return next();
    try {
      const state = newState(route, req.method === 'POST' ? 'POST' : 'OTHER');
      if (!state) return next();
      active.set(req, state);
      // Query-carried proof is available even before body parsing. It is NOT
      // authenticated identity; caller-supplied attempt IDs are never accepted.
      observeProof(req, req.query);
      res.setHeader('X-MyAIPA-Provisioning-Trace', state.traceId);
      function terminal(phase) {
        if (state.terminated) return;
        state.terminated = true;
        // Keep the weakly-held state for work that finishes after disconnect.
        // A closed response is not proof that an in-flight purchase was aborted.
        req.removeListener('aborted', aborted); res.removeListener('finish', finish); res.removeListener('close', close);
        const details = { responseFinished: res.writableFinished === true };
        if (phase === 'finished' && Number.isInteger(res.statusCode) && res.statusCode >= 100 && res.statusCode <= 599) details.statusCode = res.statusCode;
        record(state, phase, details);
      }
      const aborted = () => terminal('request_aborted');
      const finish = () => terminal('finished');
      const close = () => terminal('closed_before_response');
      req.once('aborted', aborted); res.once('finish', finish); res.once('close', close);
      record(state, 'received');
    } catch (_) { /* Trace setup must not reject or delay admission. */ }
    return next();
  }
  function checkpoint(req, name) {
    try { if (CHECKPOINTS.has(name)) mark(active.get(req), name); } catch (_) {}
  }
  function contextCheckpoint(req, name) {
    // Inside an interactive transaction, update memory only. Do not add stdout,
    // storage or async work to the critical section. Failure/close emits it.
    try { const state = active.get(req); if (state && CONTEXT_CHECKPOINTS.has(name)) state.lastCheckpoint = name; } catch (_) {}
  }
  function verifiedProof(req, input) {
    try { const state = active.get(req), fingerprint = proofFingerprint(input); if (!state || !fingerprint) return;
      state.proofHash = fingerprint; state.signatureVerified = true; mark(state, 'signature_verified'); } catch (_) {}
  }
  function bindSignup(req, attemptId) {
    try { const state = active.get(req), fingerprint = signupFingerprint(attemptId);
      if (state?.signatureVerified && fingerprint) { state.signupHash = fingerprint; mark(state, 'context_verified'); } } catch (_) {}
  }
  function failure(req, error) {
    try { failed(active.get(req), error); } catch (_) {}
    // Suppress arbitrary raw error dumps even when trace capacity was exceeded.
    return ROUTES.has(canonicalRoute(req));
  }
  async function step(req, name, work) {
    try { if (STEPS.has(name)) mark(active.get(req), name + '_started'); } catch (_) {}
    try {
      const result = await work();
      try { if (STEPS.has(name)) mark(active.get(req), name + '_completed'); } catch (_) {}
      return result;
    } catch (error) { failure(req, error); throw error; }
  }
  function startHandoff(attemptId, proof) {
    let state;
    try {
      state = newState('make-signup-handoff', 'POST');
      if (state) { state.proofHash = proofFingerprint(proof); state.signupHash = signupFingerprint(attemptId);
        state.signatureVerified = Boolean(state.proofHash); record(state, 'dispatch_started'); }
    } catch (_) {}
    let finished = false;
    return { finish(statusCode) { if (finished) return; finished = true;
      try { record(state, 'response_received', { statusCode: Number.isInteger(statusCode) && statusCode >= 100 && statusCode <= 599 ? statusCode : null }); } catch (_) {} },
    failure(error) { if (finished) return; finished = true; try { failed(state, error); } catch (_) {} } };
  }
  return { middleware, observeProof, checkpoint, contextCheckpoint, verifiedProof, bindSignup, failure, step, startHandoff };
}
module.exports = { createProvisioningRequestTrace, proofFingerprint, signupFingerprint, safeError };
