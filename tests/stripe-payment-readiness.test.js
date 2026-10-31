const test = require('node:test');
const assert = require('node:assert/strict');
const { completeTrialPaymentSetup, getTrialPaymentState, getStoredTrialPaymentState, hasActiveStoredSubscription, scheduleTrialCancellation } = require('../server/stripeTrialBilling');

const session = { mode: 'setup', customer: 'cus_fixture', setup_intent: 'seti_fixture',
  metadata: { purpose: 'trial-payment-method', subscriptionId: 'sub_fixture' } };
function fixture(status, extra = {}) {
  const writes = [];
  const subscription = { id: 'sub_fixture', customer: 'cus_fixture', status, default_payment_method: 'pm_fixture', ...extra };
  return { writes, stripe: {
    setupIntents: { retrieve: async () => ({ status: 'succeeded', customer: 'cus_fixture', payment_method: 'pm_fixture' }) },
    customers: { update: async () => { writes.push('customer'); } },
    subscriptions: {
      retrieve: async () => ({ ...subscription }),
      update: async () => { writes.push('subscription'); return { ...subscription }; },
      resume: async () => { writes.push('resume'); return { ...subscription, latest_invoice: 'in_fixture' }; },
    },
    invoices: { pay: async () => { writes.push('invoice'); return { status: 'paid' }; } },
  } };
}

test('a saved card does not make paused, canceled, expired, failed or unknown service payment-ready', () => {
  for (const status of ['paused', 'canceled', 'incomplete_expired', 'past_due', 'unpaid', 'incomplete', 'unknown']) {
    assert.equal(getTrialPaymentState({ status, default_payment_method: 'pm_fixture' }).paymentReady, false, status);
  }
});

test('ended or cancellation-scheduled subscriptions never offer another trial setup', () => {
  for (const subscription of [
    { status: 'canceled' }, { status: 'incomplete_expired' },
    { status: 'paused', cancel_at_period_end: true },
  ]) {
    const state = getTrialPaymentState({ ...subscription, trial_end: 1 });
    assert.equal(state.checkoutAvailable, false);
    assert.equal(state.canAddPaymentMethod, false);
  }
});

test('dashboard projection preserves terminal status and cancellation dates despite a stored card', () => {
  assert.equal(getStoredTrialPaymentState({ subscriptionStatus: 'canceled', paymentMethodReady: true }).paymentReady, false);
  assert.equal(getStoredTrialPaymentState({ subscriptionStatus: 'paused', paymentMethodReady: true }).paymentReady, false);
  assert.equal(getStoredTrialPaymentState({ subscriptionStatus: 'active', paymentMethodReady: true }).paymentReady, true);
  for (const fields of [{ cancelAtPeriodEnd: true }, { cancelAt: Date.now() + 60000 }]) {
    assert.equal(getStoredTrialPaymentState({ subscriptionStatus: 'paused', trialEndAt: 1000, ...fields }).checkoutAvailable, false);
  }
});

test('admin readiness requires confirmed active/trialing status, not merely a subscription ID', () => {
  for (const subscriptionStatus of ['paused', 'canceled', 'incomplete_expired', 'past_due', 'unpaid', 'incomplete', 'unknown', '']) {
    assert.equal(hasActiveStoredSubscription({ subscriptionId: 'sub_fixture', subscriptionStatus }), false);
  }
  assert.equal(hasActiveStoredSubscription({ subscriptionId: 'sub_fixture', subscriptionStatus: 'trialing' }), true);
  assert.equal(hasActiveStoredSubscription({ subscriptionId: 'sub_fixture', subscriptionStatus: 'active' }), true);
  assert.equal(hasActiveStoredSubscription({ subscriptionStatus: 'active' }), false);
});

test('a late setup webhook cannot modify a canceled or cancellation-scheduled subscription', async () => {
  for (const [status, extra] of [['canceled', {}], ['incomplete_expired', {}], ['paused', { cancel_at_period_end: true }]]) {
    const { stripe, writes } = fixture(status, extra);
    await assert.rejects(completeTrialPaymentSetup({ stripe, session }), /end|cancel/i);
    assert.deepEqual(writes, []);
  }
});

test('a paid resumption invoice is not success when Stripe still reports paused service', async () => {
  const { stripe } = fixture('paused');
  await assert.rejects(completeTrialPaymentSetup({ stripe, session }), /confirm|active|ready/i);
});

test('cancellation observed during setup stops resumption or invoice payment immediately', async () => {
  const first = fixture('paused');
  first.stripe.subscriptions.update = async () => ({ customer: 'cus_fixture', status: 'paused', cancel_at_period_end: true });
  await assert.rejects(completeTrialPaymentSetup({ stripe: first.stripe, session }), /Cancellation/);
  assert.deepEqual(first.writes, ['customer']);
  const second = fixture('paused');
  second.stripe.subscriptions.resume = async () => ({ customer: 'cus_fixture', status: 'paused', cancel_at_period_end: true, latest_invoice: 'in_fixture' });
  await assert.rejects(completeTrialPaymentSetup({ stripe: second.stripe, session }), /Cancellation/);
  assert.deepEqual(second.writes, ['customer', 'subscription']);
});

test('cancellation is owner-scoped, retry-safe and does not update an already-ended subscription', async () => {
  let updates = 0;
  let subscription = { id: 'sub_fixture', customer: 'cus_fixture', status: 'active' };
  const stripe = { subscriptions: {
    retrieve: async () => ({ ...subscription }),
    update: async (_id, params) => { updates++; subscription = { ...subscription, ...params }; return { ...subscription }; },
  } };
  await assert.rejects(scheduleTrialCancellation({ stripe, subscriptionId: 'sub_fixture', customerId: 'cus_other' }), /ownership/);
  assert.equal(updates, 0);
  const params = { stripe, subscriptionId: 'sub_fixture', customerId: 'cus_fixture' };
  assert.equal((await scheduleTrialCancellation(params)).cancel_at_period_end, true);
  await scheduleTrialCancellation(params);
  subscription = { ...subscription, status: 'canceled' };
  await scheduleTrialCancellation(params);
  assert.equal(updates, 1);
});

test('local lifecycle simulation executes cancellation and rejects a late setup instead of setting an unsupported flag', async () => {
  const result = await require('../scripts/run-local-stripe-simulation').runCycle(1);
  for (const key of ['cancellationScheduledVerified', 'cancellationReplayNoMutation', 'canceledServiceNotPaymentReady', 'lateCheckoutRejected']) {
    assert.equal(result[key], true);
  }
  assert.equal('cancellationSupported' in result, false);
});
