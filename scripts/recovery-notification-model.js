// Pure, versioned recovery-notice ledger. No I/O, credentials or live transport.
const crypto = require('node:crypto');
const CHANNELS = ['telegram', 'email'];
const SEVERITIES = ['healthy', 'warning', 'critical'];
const STATUSES = ['not_attempted', 'superseded_without_attempt', 'started_outcome_unconfirmed', 'outcome_unconfirmed', 'accepted_not_recipient_receipt', 'rejected_requires_review'];
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const fail = code => { throw Object.assign(new Error(code), { code }); };
const clone = value => structuredClone(value);
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) fail('RECOVERY_NOTIFICATION_STATE_INVALID');
}
function normalizeReport(report) {
  if (!report || !SEVERITIES.includes(report.severity) || !iso(report.checkedAt) || !Array.isArray(report.issues)) fail('RECOVERY_NOTIFICATION_REPORT_INVALID');
  const codes = report.issues.map(issue => issue?.code);
  if (codes.some(code => typeof code !== 'string' || !/^[A-Z][A-Z0-9_]{0,127}$/.test(code)) || new Set(codes).size !== codes.length || (report.severity === 'healthy') !== (codes.length === 0)) fail('RECOVERY_NOTIFICATION_REPORT_INVALID');
  codes.sort();
  return { checkedAt: report.checkedAt, severity: report.severity, codes, fingerprint: hash([report.severity, codes]) };
}
function createInitialState(monitorId, storeId = crypto.randomUUID()) {
  if (typeof monitorId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(monitorId) || !UUID.test(storeId)) fail('RECOVERY_NOTIFICATION_STORE_ID_INVALID');
  return { schemaVersion: 2, monitorId, storeId, revision: 0, episodeSequence: 0, eventSequence: 0, observation: null, events: [] };
}
function validateState(state) {
  if (state?.schemaVersion !== 2) fail('RECOVERY_NOTIFICATION_LEGACY_OR_UNKNOWN_STATE_REQUIRES_REVIEW');
  exact(state, ['schemaVersion', 'monitorId', 'storeId', 'revision', 'episodeSequence', 'eventSequence', 'observation', 'events']);
  createInitialState(state.monitorId, state.storeId);
  for (const key of ['revision', 'episodeSequence', 'eventSequence']) if (!Number.isSafeInteger(state[key]) || state[key] < 0) fail('RECOVERY_NOTIFICATION_STATE_INVALID');
  if (!Array.isArray(state.events) || state.events.length !== state.eventSequence || state.events.length > 1000) fail('RECOVERY_NOTIFICATION_HISTORY_REVIEW_REQUIRED');
  let episode = 0, severity = 'healthy', fingerprint = null, previousAt = null;
  for (let index = 0; index < state.events.length; index++) {
    const event = state.events[index];
    exact(event, ['id', 'sequence', 'episodeId', 'fingerprint', 'severity', 'codes', 'observedAt', 'attempts']);
    const report = normalizeReport({ severity: event.severity, checkedAt: event.observedAt, issues: Array.isArray(event.codes) ? event.codes.map(code => ({ code })) : null });
    if (event.sequence !== index + 1 || event.id !== `${state.storeId}:event:${index + 1}` || !DIGEST.test(event.fingerprint) || event.fingerprint !== report.fingerprint || JSON.stringify(event.codes) !== JSON.stringify(report.codes)) fail('RECOVERY_NOTIFICATION_STATE_INVALID');
    if ((previousAt && event.observedAt <= previousAt) || event.fingerprint === fingerprint || (event.severity === 'healthy' && severity === 'healthy')) fail('RECOVERY_NOTIFICATION_TRANSITION_INVALID');
    if (event.severity !== 'healthy' && severity === 'healthy') episode++;
    if (event.episodeId !== `${state.storeId}:episode:${episode}`) fail('RECOVERY_NOTIFICATION_EPISODE_INVALID');
    exact(event.attempts, CHANNELS);
    for (const channel of CHANNELS) {
      const attempt = event.attempts[channel];
      exact(attempt, ['status', 'token', 'startedAt', 'completedAt']);
      if (!STATUSES.includes(attempt.status)) fail('RECOVERY_NOTIFICATION_ATTEMPT_INVALID');
      const attempted = !['not_attempted', 'superseded_without_attempt'].includes(attempt.status);
      if (attempted ? !UUID.test(attempt.token) || !iso(attempt.startedAt) : Object.keys(attempt).some(key => key !== 'status')) fail('RECOVERY_NOTIFICATION_ATTEMPT_INVALID');
      if (attempt.status === 'started_outcome_unconfirmed') {
        if (attempt.completedAt !== undefined) fail('RECOVERY_NOTIFICATION_ATTEMPT_INVALID');
      } else if (attempted && (!iso(attempt.completedAt) || attempt.completedAt < attempt.startedAt)) fail('RECOVERY_NOTIFICATION_ATTEMPT_INVALID');
    }
    severity = event.severity; fingerprint = event.fingerprint; previousAt = event.observedAt;
  }
  if (state.episodeSequence !== episode) fail('RECOVERY_NOTIFICATION_EPISODE_INVALID');
  if (state.observation === null) {
    if (state.eventSequence !== 0 || state.episodeSequence !== 0) fail('RECOVERY_NOTIFICATION_STATE_INVALID');
  } else {
    exact(state.observation, ['checkedAt', 'severity', 'fingerprint', 'eventId']);
    const observation = state.observation;
    if (!iso(observation.checkedAt) || !SEVERITIES.includes(observation.severity) || !DIGEST.test(observation.fingerprint)) fail('RECOVERY_NOTIFICATION_STATE_INVALID');
    if (state.events.length ? observation.eventId !== state.events.at(-1).id || observation.fingerprint !== fingerprint || observation.severity !== severity || observation.checkedAt < previousAt : observation.eventId !== null || observation.severity !== 'healthy' || observation.fingerprint !== hash(['healthy', []])) fail('RECOVERY_NOTIFICATION_STATE_INVALID');
  }
  return state;
}
function assertAdvance(previous, next) {
  validateState(previous); validateState(next);
  if (next.monitorId !== previous.monitorId || next.storeId !== previous.storeId || next.revision !== previous.revision || next.eventSequence < previous.eventSequence || next.eventSequence > previous.eventSequence + 1 || next.episodeSequence < previous.episodeSequence) fail('RECOVERY_NOTIFICATION_STALE_WRITE');
  if (previous.observation && (!next.observation || next.observation.checkedAt < previous.observation.checkedAt || (next.observation.checkedAt === previous.observation.checkedAt && next.observation.fingerprint !== previous.observation.fingerprint))) fail('RECOVERY_NOTIFICATION_STALE_WRITE');
  for (let index = 0; index < previous.events.length; index++) {
    const before = previous.events[index], after = next.events[index];
    const { attempts: oldAttempts, ...oldEvent } = before, { attempts: newAttempts, ...newEvent } = after;
    if (JSON.stringify(oldEvent) !== JSON.stringify(newEvent)) fail('RECOVERY_NOTIFICATION_HISTORY_REWRITE');
    for (const channel of CHANNELS) {
      const oldAttempt = oldAttempts[channel], newAttempt = newAttempts[channel];
      if (oldAttempt.status === 'not_attempted') {
        if (!['not_attempted', 'started_outcome_unconfirmed', 'superseded_without_attempt'].includes(newAttempt.status) || (newAttempt.status === 'superseded_without_attempt' && next.eventSequence === previous.eventSequence)) fail('RECOVERY_NOTIFICATION_ATTEMPT_REWRITE');
        continue;
      }
      if (oldAttempt.status === 'started_outcome_unconfirmed') {
        if (!['started_outcome_unconfirmed', 'outcome_unconfirmed', 'accepted_not_recipient_receipt', 'rejected_requires_review'].includes(newAttempt.status) || newAttempt.token !== oldAttempt.token || newAttempt.startedAt !== oldAttempt.startedAt) fail('RECOVERY_NOTIFICATION_ATTEMPT_REWRITE');
      } else if (JSON.stringify(oldAttempt) !== JSON.stringify(newAttempt)) fail('RECOVERY_NOTIFICATION_ATTEMPT_REWRITE');
    }
  }
}
function observeReport(state, report) {
  validateState(state);
  const health = normalizeReport(report), previous = state.observation;
  if (previous && health.checkedAt < previous.checkedAt) fail('RECOVERY_NOTIFICATION_OBSERVATION_STALE');
  if (previous && health.checkedAt === previous.checkedAt && health.fingerprint !== previous.fingerprint) fail('RECOVERY_NOTIFICATION_OBSERVATION_ORDER_CONFLICT');
  const next = clone(state), transition = previous?.fingerprint !== health.fingerprint;
  let eventId = previous?.eventId || null;
  if (transition && (health.severity !== 'healthy' || (previous && previous.severity !== 'healthy'))) {
    for (const event of next.events) for (const channel of CHANNELS) if (event.attempts[channel].status === 'not_attempted') event.attempts[channel] = { status: 'superseded_without_attempt' };
    if (health.severity !== 'healthy' && (!previous || previous.severity === 'healthy')) next.episodeSequence++;
    next.eventSequence++;
    eventId = `${next.storeId}:event:${next.eventSequence}`;
    next.events.push({ id: eventId, sequence: next.eventSequence, episodeId: `${next.storeId}:episode:${next.episodeSequence}`, fingerprint: health.fingerprint, severity: health.severity, codes: health.codes, observedAt: health.checkedAt, attempts: Object.fromEntries(CHANNELS.map(channel => [channel, { status: 'not_attempted' }])) });
  }
  next.observation = { checkedAt: health.checkedAt, severity: health.severity, fingerprint: health.fingerprint, eventId };
  validateState(next);
  return { state: next, changed: JSON.stringify(next) !== JSON.stringify(state), transition: eventId !== previous?.eventId && eventId !== null };
}
function notificationPlan(report, state = {}) {
  const health = normalizeReport(report);
  if (state && Object.keys(state).length === 0) return { action: 'explicit-state-initialization-required', fingerprint: health.fingerprint, eventId: null, episodeId: null, channels: [], sendAllowed: false };
  const observed = observeReport(state, report), event = observed.state.events.find(item => item.id === observed.state.observation.eventId);
  if (!event) return { action: 'quiet', fingerprint: health.fingerprint, eventId: null, episodeId: null, channels: [], sendAllowed: false };
  const channels = CHANNELS.filter(channel => event.attempts[channel].status === 'not_attempted');
  const uncertain = CHANNELS.some(channel => ['started_outcome_unconfirmed', 'outcome_unconfirmed'].includes(event.attempts[channel].status));
  const action = observed.transition ? health.severity === 'healthy' ? 'recovery-notice' : 'new-or-changed-incident' : channels.length ? 'complete-unattempted-channels' : uncertain ? 'hold-uncertain-no-repeat' : health.severity === 'healthy' ? 'quiet' : 'quiet-unchanged';
  return { action, fingerprint: health.fingerprint, eventId: event.id, episodeId: event.episodeId, channels, sendAllowed: false };
}
module.exports = { CHANNELS, clone, fail, iso, hash, createInitialState, normalizeReport, validateState, assertAdvance, observeReport, notificationPlan };
