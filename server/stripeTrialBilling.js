const TRIAL_PAYMENT_PURPOSE = "trial-payment-method";

function idOf(value) {
  if (!value) return "";
  return typeof value === "string" ? value : String(value.id || "");
}

function hasPaymentMethod(subscription) {
  return Boolean(idOf(subscription?.default_payment_method) || idOf(subscription?.default_source));
}

function isSubscriptionEnding(subscription) {
  return Boolean(subscription?.cancel_at_period_end) || Number(subscription?.cancel_at || 0) > 0
    || ["canceled", "incomplete_expired"].includes(String(subscription?.status || "").toLowerCase());
}

function getTrialPaymentState(subscription, { now = Date.now() } = {}) {
  const status = String(subscription?.status || "").toLowerCase();
  const paymentFailed = ["past_due", "unpaid", "incomplete", "incomplete_expired"].includes(status);
  const paymentReady = hasPaymentMethod(subscription) && ["active", "trialing"].includes(status);
  const trialEndAt = Number(subscription?.trial_end || 0) * 1000;
  const trialEnded = Boolean(trialEndAt && trialEndAt <= Number(now));
  const requiresPayment = ["paused", "past_due", "unpaid", "incomplete"].includes(status);
  const checkoutAvailable = !paymentReady && !isSubscriptionEnding(subscription)
    && (trialEnded || requiresPayment) && ["trialing", "active", "paused", "past_due", "unpaid", "incomplete"].includes(status);
  return {
    status,
    paymentReady,
    trialEnded,
    checkoutAvailable,
    paused: status === "paused",
    paymentFailed,
    canAddPaymentMethod: checkoutAvailable,
  };
}

function getStoredTrialPaymentState(signup, options) {
  return getTrialPaymentState({
    status: signup.subscriptionStatus || "",
    default_payment_method: signup.paymentMethodReady ? "stored" : "",
    trial_end: signup.trialEndAt ? Math.floor(Number(signup.trialEndAt) / 1000) : 0,
    cancel_at_period_end: Boolean(signup.cancelAtPeriodEnd),
    cancel_at: signup.cancelAt ? Math.floor(Number(signup.cancelAt) / 1000) : 0,
  }, options);
}
function hasActiveStoredSubscription(signup) {
  return Boolean(String(signup?.subscriptionId || '').trim())
    && ['active', 'trialing'].includes(String(signup?.subscriptionStatus || '').toLowerCase());
}

function buildTrialReminderSchedule(trialEndAt, existing = {}) {
  const end = Number(trialEndAt || 0);
  if (!Number.isFinite(end) || end <= 0) return {};
  return Object.fromEntries([7, 3, 1, 0].map((daysBefore) => {
    const key = daysBefore === 0 ? "payment-due" : `${daysBefore}-days`;
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
  if (isSubscriptionEnding(subscription)) throw new Error("This subscription has ended or is scheduled to cancel; payment setup was not applied.");
  if (!["active", "trialing", "paused", "past_due", "unpaid", "incomplete"].includes(String(subscription.status || "").toLowerCase())) {
    throw new Error("Stripe has not confirmed an eligible subscription state.");
  }

  await stripe.customers.update(customerId, {
    invoice_settings: { default_payment_method: paymentMethodId },
  });
  subscription = await stripe.subscriptions.update(subscriptionId, {
    default_payment_method: paymentMethodId,
  });
  if (isSubscriptionEnding(subscription)) throw new Error("Cancellation was scheduled during payment setup; service was not resumed.");

  if (String(subscription.status || "").toLowerCase() === "paused") {
    subscription = await stripe.subscriptions.resume(subscriptionId, { billing_cycle_anchor: "now" });
    if (isSubscriptionEnding(subscription)) throw new Error("Cancellation was scheduled during resumption; no invoice payment was attempted.");

    // Stripe can create a resumption invoice without attempting payment in the
    // resume request. Pay it explicitly so a successfully saved card actually
    // moves the subscription out of `paused`.
    if (String(subscription.status || "").toLowerCase() === "paused") {
      const invoiceId = idOf(subscription.latest_invoice);
      if (!invoiceId) throw new Error("Stripe did not create the resumption invoice.");
      const invoice = await stripe.invoices.pay(invoiceId);
      if (String(invoice?.status || "").toLowerCase() !== "paid") {
        throw new Error("Stripe could not confirm payment of the resumption invoice.");
      }
      subscription = await stripe.subscriptions.retrieve(subscriptionId);
    }
  }

  if (idOf(subscription.customer) !== customerId || isSubscriptionEnding(subscription)
    || !["active", "trialing"].includes(String(subscription.status || "").toLowerCase())) {
    throw new Error("Stripe has not confirmed active or trialing service after payment setup.");
  }
  return {
    customerId,
    subscriptionId,
    paymentMethodId,
    paymentReady: true,
    resumed: ["active", "trialing"].includes(String(subscription.status || "").toLowerCase()),
    subscription,
  };
}

async function scheduleTrialCancellation({ stripe, subscriptionId, customerId }) {
  if (!stripe || !subscriptionId || !customerId) throw new Error("An existing Stripe customer and subscription are required.");
  const existing = await stripe.subscriptions.retrieve(subscriptionId);
  if (idOf(existing.customer) !== customerId) {
    const error = new Error("Stripe subscription ownership validation failed.");
    error.statusCode = 409;
    throw error;
  }
  // Preserve an already scheduled/finished cancellation; retries must not
  // change its date or attempt to update a terminal Stripe subscription.
  if (isSubscriptionEnding(existing)) return existing;
  const subscription = await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true });
  if (idOf(subscription.customer) !== customerId || !isSubscriptionEnding(subscription)) {
    throw new Error("Stripe did not confirm the subscription cancellation.");
  }
  return subscription;
}

module.exports = {
  TRIAL_PAYMENT_PURPOSE,
  buildTrialReminderSchedule,
  buildTrialPaymentCheckoutParams,
  completeTrialPaymentSetup,
  getTrialPaymentState,
  getStoredTrialPaymentState,
  hasActiveStoredSubscription,
  hasPaymentMethod,
  isSubscriptionEnding,
  isTrialPaymentSetupSession,
  scheduleTrialCancellation,
};
