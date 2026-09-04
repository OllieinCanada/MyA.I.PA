const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildTrialReminderSchedule,
  buildTrialPaymentCheckoutParams,
  completeTrialPaymentSetup,
  getTrialPaymentState,
  isTrialPaymentSetupSession,
} = require("../server/stripeTrialBilling");

test("trial reminders are scheduled exactly 7, 3, and 1 days before the end", () => {
  const end = Date.UTC(2026, 8, 20);
  const reminders = buildTrialReminderSchedule(end);
  assert.deepEqual(Object.values(reminders).map((item) => item.daysBefore), [7, 3, 1]);
  assert.equal(reminders["1-days"].dueAt, end - 86400000);
});

test("Stripe handoff uses hosted setup mode for the existing trial", () => {
  const params = buildTrialPaymentCheckoutParams({
    customerId: "cus_existing",
    subscriptionId: "sub_existing",
    successUrl: "https://www.myaipa.ca/#/dashboard?billing=ready",
    cancelUrl: "https://www.myaipa.ca/#/dashboard?billing=cancelled",
  });
  assert.equal(params.mode, "setup");
  assert.equal(params.customer, "cus_existing");
  assert.equal(params.metadata.subscriptionId, "sub_existing");
  assert.equal(params.metadata.purpose, "trial-payment-method");
  assert.equal("line_items" in params, false);
  assert.equal(isTrialPaymentSetupSession({ ...params, mode: "setup" }), true);
});

test("saved card attaches to the existing subscription and resumes a paused trial", async () => {
  const calls = [];
  const stripe = {
    setupIntents: { retrieve: async () => ({ id: "seti_1", status: "succeeded", customer: "cus_1", payment_method: "pm_1" }) },
    customers: { update: async (...args) => { calls.push(["customer", ...args]); } },
    subscriptions: {
      retrieve: async () => ({ id: "sub_1", customer: "cus_1", status: "paused" }),
      update: async (...args) => { calls.push(["subscription", ...args]); return { id: "sub_1", customer: "cus_1", status: "paused" }; },
      resume: async (...args) => { calls.push(["resume", ...args]); return { id: "sub_1", customer: "cus_1", status: "active", default_payment_method: "pm_1" }; },
    },
  };
  const result = await completeTrialPaymentSetup({
    stripe,
    session: { mode: "setup", customer: "cus_1", setup_intent: "seti_1", metadata: { purpose: "trial-payment-method", subscriptionId: "sub_1" } },
  });
  assert.equal(result.paymentReady, true);
  assert.equal(result.resumed, true);
  assert.deepEqual(calls.map(([kind]) => kind), ["customer", "subscription", "resume"]);
  assert.deepEqual(calls[1][2], { default_payment_method: "pm_1" });
});

test("trial payment states cover no card, declined payment, and paused service", () => {
  assert.deepEqual(getTrialPaymentState({ status: "trialing" }), {
    status: "trialing", paymentReady: false, paused: false, paymentFailed: false, canAddPaymentMethod: true,
  });
  assert.equal(getTrialPaymentState({ status: "past_due", default_payment_method: "pm_declined" }).paymentFailed, true);
  assert.equal(getTrialPaymentState({ status: "paused" }).paused, true);
  assert.equal(getTrialPaymentState({ status: "active", default_payment_method: "pm_valid" }).paymentReady, true);
});

test("Stripe setup rejects a customer/subscription mismatch", async () => {
  await assert.rejects(() => completeTrialPaymentSetup({
    stripe: {
      setupIntents: { retrieve: async () => ({ status: "succeeded", customer: "cus_1", payment_method: "pm_1" }) },
      subscriptions: { retrieve: async () => ({ id: "sub_1", customer: "cus_other", status: "trialing" }) },
    },
    session: { mode: "setup", customer: "cus_1", setup_intent: "seti_1", metadata: { purpose: "trial-payment-method", subscriptionId: "sub_1" } },
  }), /does not belong/);
});
