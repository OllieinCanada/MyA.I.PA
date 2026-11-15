'use strict';
const VERSION = 'toronto-day15-v1';
const TIME_ZONE = 'America/Toronto';
const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE, calendar: 'iso8601', numberingSystem: 'latn',
  year: 'numeric', month: '2-digit', day: '2-digit',
});
function dateKey(timestamp) {
  const parts = Object.fromEntries(formatter.formatToParts(timestamp).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function startOfLocalDay(key) {
  const [year, month, day] = key.split('-').map(Number);
  const utc = Date.UTC(year, month - 1, day);
  // Locate the first millisecond of the requested Toronto date. Calendar-day
  // comparisons avoid assuming every day has 24 hours across DST transitions.
  let low = utc - 86400000, high = utc + 86400000;
  while (low < high) {
    const mid = low + Math.floor((high - low) / 2);
    if (dateKey(mid) < key) low = mid + 1;
    else high = mid;
  }
  if (dateKey(low) !== key) throw new Error('TRIAL_CALENDAR_BOUNDARY_UNAVAILABLE');
  return low;
}
function addCalendarDays(key, days) {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}
function calendarForAnchor({ trialStartAt } = {}) {
  // Require an unambiguous instant, not a local date or implementation-defined
  // Date.parse input. This tool does not decide when a real trial should start.
  if (typeof trialStartAt !== 'string'
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(trialStartAt)) {
    throw new Error('EXACT_TRIAL_START_REQUIRED');
  }
  const start = Date.parse(trialStartAt);
  if (!Number.isFinite(start) || new Date(start).toISOString().slice(0, 10) !== trialStartAt.slice(0, 10)
      || new Date(start).getUTCFullYear() < 2000 || new Date(start).getUTCFullYear() > 2099) {
    throw new Error('INVALID_TRIAL_START');
  }
  const day1 = dateKey(start);
  const day14 = addCalendarDays(day1, 13);
  const day15 = addCalendarDays(day1, 14);
  const day16 = addCalendarDays(day1, 15);
  const iso = key => new Date(startOfLocalDay(key)).toISOString();
  return {
    schemaVersion: 1, policy: VERSION, timeZone: TIME_ZONE,
    trialStartAt: new Date(start).toISOString(),
    countingConvention: 'The Toronto calendar date containing trial start is day 1.',
    day14ReminderWindow: { opensAt: iso(day14), closesAtExclusive: iso(day15) },
    completeGraceDay15: { opensAt: iso(day15), closesAtExclusive: iso(day16) },
    serviceCutoffAt: iso(day16),
  };
}
function invalid() { return Object.assign(new Error('Trial calendar enrollment proof is invalid.'), {code:'TRIAL_CALENDAR_PROOF_INVALID'}); }
function enrollmentKey(businessKey) {
  if (!/^[a-f0-9]{64}$/.test(businessKey || '')) throw invalid();
  return `trial-calendar:${businessKey}`;
}
async function prepareEnrollment({ db, businessKey, priceId, now = Date.now() }) {
  const key = enrollmentKey(businessKey);
  if (!priceId || !db?.$transaction || !Number.isSafeInteger(now)) throw invalid();
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))::text AS lock_result`;
    const row = await tx.runtimeStore.findUnique({where:{key}});
    const plan = row ? row.data : { version:VERSION, businessKey, priceId,
      anchorAt:new Date(Math.floor(now / 1000) * 1000).toISOString() };
    if (!plan || typeof plan !== 'object' || Array.isArray(plan)
        || plan.version !== VERSION || plan.businessKey !== businessKey || plan.priceId !== priceId) throw invalid();
    const calendar = calendarForAnchor({trialStartAt:plan.anchorAt});
    // A stale creation attempt must not silently shorten a later customer's
    // trial or invent a fresh request under an existing Stripe idempotency key.
    // Existing subscriptions are reconciled before this enrollment function.
    if (now - Date.parse(plan.anchorAt) > 5 * 60000) {
      throw Object.assign(new Error('The saved trial enrollment requires inspection before another create attempt.'),
        {code:'TRIAL_CALENDAR_ENROLLMENT_STALE'});
    }
    if (Date.parse(calendar.serviceCutoffAt) <= now + 60000) throw invalid();
    if (!row) await tx.runtimeStore.create({data:{key,data:plan}});
    return calendar;
  }, {maxWait:1000,timeout:3000});
}
function metadataForCalendar(calendar) {
  if (calendar?.policy !== VERSION) throw invalid();
  return {trialCalendarVersion:VERSION,trialCalendarAnchor:calendar.trialStartAt,
    trialCalendarCutoff:String(Date.parse(calendar.serviceCutoffAt) / 1000)};
}
function policyFromSubscription(subscription) {
  const m = subscription?.metadata || {};
  if (!m.trialCalendarVersion) return null;
  if (m.trialCalendarVersion !== VERSION || m.source !== 'my-ai-pa-signup'
      || m.trialType !== 'no-card' || !/^[a-f0-9]{64}$/.test(m.businessKey || '') || !subscription.id) throw invalid();
  const p = calendarForAnchor({trialStartAt:m.trialCalendarAnchor});
  const end = Date.parse(p.serviceCutoffAt) / 1000;
  if (String(end) !== m.trialCalendarCutoff || Number(subscription.trial_end) !== end) throw invalid();
  return {...p,subscriptionId:subscription.id,businessKey:m.businessKey};
}
function policyFromSignup(signup) {
  const p = signup?.trialCalendarPolicy;
  if (!p) return null;
  const {signupBusinessKey} = require('./signupBusinessIdentity');
  if (signupBusinessKey(signup) !== p.businessKey || signup.subscriptionId !== p.subscriptionId) throw invalid();
  return policyFromSubscription({id:signup.subscriptionId,trial_end:Number(signup.trialEndAt) / 1000,
    metadata:{source:'my-ai-pa-signup',trialType:'no-card',businessKey:p.businessKey,
      trialCalendarVersion:p.policy,trialCalendarAnchor:p.trialStartAt,
      trialCalendarCutoff:String(Date.parse(p.serviceCutoffAt) / 1000)}});
}
function subscriptionPolicyFields(subscription) {
  if (!subscription?.metadata?.trialCalendarVersion) return {};
  try {return {trialCalendarPolicy:policyFromSubscription(subscription),trialCalendarProofStatus:'verified'};}
  catch (_) {return {trialCalendarPolicy:null,trialCalendarProofStatus:'invalid'};}
}
function calendarTrialCopy(policy, {paymentDue = false} = {}) {
  const expected = calendarForAnchor({trialStartAt:policy.trialStartAt});
  if (policy.policy !== VERSION || expected.serviceCutoffAt !== policy.serviceCutoffAt) throw invalid();
  const format = value => new Intl.DateTimeFormat('en-CA', {timeZone:TIME_ZONE,year:'numeric',month:'long',day:'numeric'}).format(value);
  const day15 = format(Date.parse(expected.serviceCutoffAt) - 1);
  const day16 = format(Date.parse(expected.serviceCutoffAt));
  return {
    subject: paymentDue ? 'Your My AI PA trial has ended' : 'Your My AI PA trial: one extra day to complete payment',
    description: paymentDue
      ? `Your trial access ended at midnight starting ${day16}, Toronto time. New AI calls are paused unless paid service is active.`
      : `Today is day 14 of your trial. Service continues through the end of day 15, ${day15}, Toronto time.`,
    paymentMessage: paymentDue
      ? 'Open your dashboard to complete secure Stripe payment setup. Service resumes only after Stripe confirms an eligible subscription.'
      : `You can add a payment method securely from your dashboard now. No paid period begins before midnight starting ${day16}, Toronto time. If payment is not completed, new AI calls stop at that cutoff.`,
    disclosure: `Your 14-day trial includes access through the end of day 15 (${day15}, Toronto time). You can add a payment method from day 14; the paid period cannot begin before midnight starting ${day16}.`,
  };
}
module.exports = {VERSION,TIME_ZONE,calendarForAnchor,prepareEnrollment,metadataForCalendar,policyFromSubscription,policyFromSignup,subscriptionPolicyFields,enrollmentKey,calendarTrialCopy};
