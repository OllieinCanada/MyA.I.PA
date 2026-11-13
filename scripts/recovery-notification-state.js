// Injected transports only. No token loading, HTTP client or live CLI dispatch.
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { validatePolicy } = require('./approved-recovery-policy');
const model = require('./recovery-notification-model');
const { isNotificationStore } = require('./recovery-notification-store');
// Retry only a lock refusal that occurs before the receipt transaction starts.
// Never replay transport, steal locks, or retry an ambiguous write/commit error.
async function persistOutcome(transaction) {
  const deadline = performance.now() + 1000;
  let lastBusy;
  for (let attempt = 0; attempt < 20; attempt++) {
    if (attempt && performance.now() >= deadline) throw lastBusy;
    try { return transaction(); }
    catch (error) {
      if (error?.code !== 'RECOVERY_NOTIFICATION_LOCKED_REQUIRES_REVIEW_OR_LATER_SAMPLE') throw error;
      lastBusy = error;
      const remaining = deadline - performance.now();
      if (attempt === 19 || remaining <= 0) throw error;
      await new Promise(resolve => setTimeout(resolve, Math.min(25, remaining)));
    }
  }
}
async function dispatchPrepared(report, { state = {}, store, transports = {}, approvedActivation = false, preparationPolicy, transportTimeoutMs = 10000 } = {}) {
  model.normalizeReport(report);
  if (approvedActivation !== true) return { ...model.notificationPlan(report, state), attempts: [], networkRequests: 0, activated: false };
  // This module has no real policy loader or live approval path. The explicit
  // fixture marker allows only the injected synthetic planning/test contract.
  validatePolicy(preparationPolicy);
  if (!isNotificationStore(store) || model.CHANNELS.some(channel => typeof transports[channel] !== 'function')) model.fail('EXPLICIT_EXCLUSIVE_DURABLE_STORE_AND_TWO_TRANSPORTS_REQUIRED');
  if (!Number.isSafeInteger(transportTimeoutMs) || transportTimeoutMs < 100 || transportTimeoutMs > 30000) model.fail('RECOVERY_NOTIFICATION_BOUNDED_TRANSPORT_REQUIRED');
  const plan = store.transaction((saved, commit) => {
    const proposal = model.notificationPlan(report, saved), observed = model.observeReport(saved, report);
    if (observed.changed) commit(observed.state, saved.revision);
    return proposal;
  });
  const results = [];
  for (const channel of plan.channels) {
    const claim = store.transaction((saved, commit) => {
      const event = saved.events.find(item => item.id === plan.eventId);
      if (!event || saved.observation.eventId !== event.id) return { status: 'held-superseded-event' };
      if (event.attempts[channel].status !== 'not_attempted') return { status: 'held-existing-attempt' };
      const token = crypto.randomUUID();
      event.attempts[channel] = { status: 'started_outcome_unconfirmed', token, startedAt: new Date().toISOString() };
      commit(saved, saved.revision);
      return { status: 'claimed', token, event: model.clone(event) };
    });
    if (claim.status !== 'claimed') { results.push({ channel, status: claim.status }); continue; }
    let outcome, timer, timedOut = false;
    const controller = new AbortController();
    const started = performance.now();
    const expire = () => { timedOut = true; controller.abort(); };
    const checkElapsed = () => { if (!timedOut && performance.now() - started >= transportTimeoutMs) expire(); };
    try {
      // Timers are cooperative: a synchronous adapter can block the event loop.
      // Check monotonic elapsed time after settlement as well, so an overdue
      // result cannot beat its delayed timer and become a claimed acceptance.
      const deadline = new Promise((_resolve, reject) => { timer = setTimeout(() => { expire(); reject(Object.assign(Error('RECOVERY_NOTIFICATION_TRANSPORT_TIMEOUT'), { name: 'TimeoutError' })); }, transportTimeoutMs); });
      const accepted = await Promise.race([deadline, Promise.resolve().then(() => transports[channel]({ severity: claim.event.severity, codes: claim.event.codes, fingerprint: claim.event.fingerprint,
        episodeId: claim.event.episodeId, eventId: claim.event.id, observedAt: claim.event.observedAt, idempotencyKey: `${claim.event.id}:${channel}` }, { signal: controller.signal }))]);
      const acceptedInResponse = accepted?.accepted === true;
      checkElapsed();
      outcome = !timedOut && acceptedInResponse ? 'accepted_not_recipient_receipt' : 'outcome_unconfirmed';
    } catch (error) {
      const definitelyRejected = error?.definiteRejection === true;
      checkElapsed();
      outcome = !timedOut && definitelyRejected ? 'rejected_requires_review' : 'outcome_unconfirmed';
    }
    finally { clearTimeout(timer); }
    await persistOutcome(() => store.transaction((saved, commit) => {
      const event = saved.events.find(item => item.id === claim.event.id), attempt = event?.attempts[channel];
      if (!attempt || attempt.token !== claim.token || attempt.status !== 'started_outcome_unconfirmed') model.fail('RECOVERY_NOTIFICATION_ATTEMPT_OWNERSHIP_LOST');
      event.attempts[channel] = { ...attempt, status: outcome, completedAt: new Date().toISOString() };
      commit(saved, saved.revision);
    }));
    results.push({ channel, status: outcome });
  }
  return { ...plan, attempts: results, state: store.readState(), activated: true, recipientReceiptProven: false };
}
module.exports = { dispatchPrepared };
