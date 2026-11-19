// Saved evidence only: this controller can issue GETs, never setup/provider actions.
function createSavedEvidencePoller({ url, validate, onData, onState, intervalMs = 5000,
  auto = true, timeoutMs = 10000, fetchImpl = (...args) => fetch(...args),
  visible = () => true, online = () => true, now = Date.now,
  schedule = setTimeout, cancel = clearTimeout }) {
  let stopped = false, paused = false, authRequired = false, attempted = false, flight = null, timer = null, failures = 0;
  let state = { phase: 'checking', busy: false, lastSuccessAt: null, nextAttemptAt: null, reason: null };
  const emit = patch => { state = { ...state, ...patch }; onState({ ...state }); };
  const clear = () => { if (timer !== null) cancel(timer); timer = null; };
  const halt = phase => {
    clear();
    const previous = flight; flight = null;
    if (previous) { cancel(previous.deadline); previous.controller.abort(); }
    emit({ phase, busy: false, nextAttemptAt: null, ...(phase === 'offline' ? { reason: { code: 'offline', status: null } } : {}) });
  };
  const queue = delay => {
    if (stopped || paused || authRequired || !auto) return;
    emit({ nextAttemptAt: now() + delay });
    timer = schedule(() => { timer = null; attempt(false); }, delay);
  };
  async function attempt(manual) {
    if (stopped || flight) return;
    clear();
    if (paused || !visible() || !online()) {
      emit({ phase: !online() ? 'offline' : 'paused', busy: false, nextAttemptAt: null,
        ...(!online() ? { reason: { code: 'offline', status: null } } : {}) }); return;
    }
    if (authRequired && !manual) return;
    if (manual) authRequired = false;
    attempted = true;
    const request = { controller: new AbortController(), deadline: null };
    flight = request;
    emit({ phase: 'checking', busy: true, nextAttemptAt: null });
    try {
      const read = (async () => {
        const response = await fetchImpl(url, { method: 'GET', credentials: 'include', cache: 'no-store', signal: request.controller.signal });
        if (!response.ok) {
          const error = new Error('read_failed');
          error.reason = response.status === 401 || response.status === 403 ? 'auth' : response.status === 429 ? 'rate_limit' : 'server';
          error.status = response.status;
          const retry = Number(response.headers?.get('retry-after'));
          error.retryMs = Number.isFinite(retry) && retry > 0 ? Math.min(60000, retry * 1000) : 0;
          throw error;
        }
        let body;
        try { body = await response.json(); } catch { throw Object.assign(new Error('invalid_response'), { reason: 'invalid' }); }
        if (!validate(body)) throw Object.assign(new Error('invalid_response'), { reason: 'invalid' });
        return body;
      })();
      const deadline = new Promise((_, reject) => {
        request.deadline = schedule(() => {
          request.controller.abort(); reject(Object.assign(new Error('read_timeout'), { reason: 'timeout' }));
        }, timeoutMs);
      });
      const body = await Promise.race([read, deadline]);
      if (stopped || flight !== request) return;
      failures = 0;
      onData(body);
      emit({ phase: 'connected', busy: false, lastSuccessAt: now(), reason: null });
      queue(intervalMs);
    } catch (error) {
      if (stopped || flight !== request) return;
      failures++;
      authRequired = error?.reason === 'auth';
      emit({ phase: authRequired ? 'auth_required' : 'retrying', busy: false,
        reason: { code: error?.reason || 'network', status: error?.status || null } });
      queue(Math.max(error?.retryMs || 0, Math.min(60000, intervalMs * 2 ** Math.min(failures - 1, 5))));
    } finally {
      cancel(request.deadline);
      if (flight === request) flight = null;
    }
  }
  return {
    start: () => attempt(false),
    refresh: () => attempt(true),
    sync: () => {
      if (stopped) return;
      if (!auto && attempted) return;
      if (paused || !visible() || !online()) halt(!online() ? 'offline' : 'paused');
      else return attempt(false);
    },
    pause: () => { paused = true; halt('paused'); },
    resume: () => { paused = false; return attempt(false); },
    stop: () => { stopped = true; clear(); if (flight) { cancel(flight.deadline); flight.controller.abort(); flight = null; } },
  };
}

function matchesSignupView(row, filter, now = Date.now()) {
  if (filter === 'all') return true;
  if (filter === 'watching') return row.active || row.mode === 'ready'
    && Number.isFinite(Date.parse(row.lastProgressAt)) && now - Date.parse(row.lastProgressAt) >= 0
    && now - Date.parse(row.lastProgressAt) <= 24 * 60 * 60 * 1000;
  return filter === 'active' ? row.active : filter === 'stalled' ? row.stalled : row.mode === filter;
}

module.exports = { createSavedEvidencePoller, matchesSignupView };
