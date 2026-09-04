const TRIAL_PAYMENT_PURPOSE = "trial-payment-method";

function idOf(value) {
  if (!value) return "";
  return typeof value === "string" ? value : String(value.id || "");
}

function hasPaymentMethod(subscription) {
  return Boolean(idOf(subscription?.default_payment_method) || idOf(subscription?.default_source));
}

function getTrialPaymentState(subscription) {
  const status = String(subscription?.status || "").toLowerCase();
  const paymentReady = hasPaymentMethod(subscription);
  return {
    status,
    paymentReady,
    paused: status === "paused",
    paymentFailed: ["past_due", "unpaid", "incomplete", "incomplete_expired"].includes(status),
    canAddPaymentMethod: ["trialing", "active", "paused", "past_due", "unpaid", "incomplete"].includes(status),
  };
}

function buildTrialReminderSchedule(trialEndAt, existing = {}) {
  const end = Number(trialEndAt || 0);
  if (!Number.isFinite(end) || end <= 0) return {};
  return Object.fromEntries([7, 3, 1].map((daysBefore) => {
    const key = `${daysBefore}-days`;
    const current = existing?.[key] || {};
    return [key, {
      daysBefore,
      dueAt: end - daysBefore * 24 * 60 * 60 * 1000,
      status: current.sentAt ? "sent" : current.status || "scheduled",
      ...(current.sentAt ? { sentAt: current.sentAt } : {}),
      ...(current.lastError ? { lastError: current.lastError } : {}),
    }];
  }));
}

function buildTrialPaymentCheckoutParams({ customerId, subscriptionId, successUrl, cancelUrl }) {
  if (!customerId || !subscriptionId) throw new Error("An existing Stripe customer and subscription are required.");
  if (!/^https:\/\//i.test(String(successUrl || "")) || !/^https:\/\//i.test(String(cancelUrl || ""))) {
    throw new Error("Stripe return URLs must use HTTPS.");
  }
  return {
    mode: "setup",
    customer: customerId,
    payment_method_types: ["card"],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      purpose: TRIAL_PAYMENT_PURPOSE,
      subscriptionId,
    },
    setup_intent_data: {
      metadata: {
        purpose: TRIAL_PAYMENT_PURPOSE,
        subscriptionId,
      },
    },
  };
}

function isTrialPaymentSetupSession(session) {
  return session?.mode === "setup" && session?.metadata?.purpose === TRIAL_PAYMENT_PURPOSE;
}

async function completeTrialPaymentSetup({ stripe, session }) {
  if (!stripe || !isTrialPaymentSetupSession(session)) throw new Error("This is not a My AI PA trial payment setup session.");
  const subscriptionId = String(session.metadata.subscriptionId || "").trim();
  const customerId = idOf(session.customer);
  const setupIntentId = idOf(session.setup_intent);
  if (!subscriptionId || !customerId || !setupIntentId) throw new Error("Stripe setup session is missing its customer, subscription, or SetupIntent.");

  const setupIntent = await stripe.setupIntents.retrieve(setupIntentId);
  if (String(setupIntent?.status || "") !== "succeeded") throw new Error("Stripe did not confirm the saved payment method.");
  const paymentMethodId = idOf(setupIntent.payment_method);
  if (!paymentMethodId) throw new Error("Stripe did not return a payment method.");
  if (idOf(setupIntent.customer) && idOf(setupIntent.customer) !== customerId) throw new Error("Stripe customer mismatch for payment setup.");

  let subscription = await stripe.subscriptions.retrieve(subscriptionId);
  if (idOf(subscription.customer) !== customerId) throw new Error("Stripe subscription does not belong to this customer.");

  await stripe.customers.update(customerId, {
    invoice_settings: { default_payment_method: paymentMethodId },
  });
  subscription = await stripe.subscriptions.update(subscriptionId, {
    default_payment_method: paymentMethodId,
  });

  if (String(subscription.status || "").toLowerCase() === "paused") {
    subscription = await stripe.subscriptions.resume(subscriptionId, { billing_cycle_anchor: "now" });
  }

  return {
    customerId,
    subscriptionId,
    paymentMethodId,
    paymentReady: true,
    resumed: String(subscription.status || "").toLowerCase() !== "paused",
    subscription,
  };
}

module.exports = {
  TRIAL_PAYMENT_PURPOSE,
  buildTrialReminderSchedule,
  buildTrialPaymentCheckoutParams,
  completeTrialPaymentSetup,
  getTrialPaymentState,
  hasPaymentMethod,
  isTrialPaymentSetupSession,
};
