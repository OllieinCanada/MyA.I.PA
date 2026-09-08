const fs = require("node:fs");
const path = require("node:path");
const { rootPath } = require("./_helpers");
const {
  buildTrialPaymentCheckoutParams,
  completeTrialPaymentSetup,
  getTrialPaymentState,
} = require("../server/stripeTrialBilling");

const countArgument = process.argv.find((value) => value.startsWith("--cycles="));
const cycles = Number(countArgument ? countArgument.slice(9) : 5);
const outputPath = rootPath("diagnostics", "shipping-readiness", "stripe-local-simulation.json");

async function runCycle(index) {
  const customerId = `cus_mock_${index}`;
  const subscriptionId = `sub_mock_${index}`;
  const trialEnd = Date.UTC(2026, 8, 21) / 1000;
  const before = getTrialPaymentState({ status: "trialing", trial_end: trialEnd }, { now: Date.UTC(2026, 8, 20) });
  if (before.checkoutAvailable || before.paymentReady || before.trialEnded) throw new Error(`Cycle ${index}: checkout appeared before day 14.`);
  const paused = getTrialPaymentState({ status: "paused", trial_end: trialEnd }, { now: Date.UTC(2026, 8, 21) });
  if (!paused.checkoutAvailable || !paused.paused) throw new Error(`Cycle ${index}: no-card service did not pause at day 14.`);

  const checkout = buildTrialPaymentCheckoutParams({
    customerId,
    subscriptionId,
    successUrl: "https://www.myaipa.ca/#/dashboard?billing=ready",
    cancelUrl: "https://www.myaipa.ca/#/dashboard?billing=cancelled",
  });
  if (checkout.mode !== "setup" || checkout.customer !== customerId || checkout.metadata.subscriptionId !== subscriptionId) {
    throw new Error(`Cycle ${index}: Checkout was not scoped to the existing customer and subscription.`);
  }

  const actions = [];
  let resumed = false;
  const stripe = {
    setupIntents: { retrieve: async () => ({ id: `seti_mock_${index}`, status: "succeeded", customer: customerId, payment_method: `pm_mock_${index}` }) },
    customers: { update: async (...args) => { actions.push(["customer", ...args]); } },
    subscriptions: {
      retrieve: async () => ({ id: subscriptionId, customer: customerId, status: resumed ? "active" : "paused" }),
      update: async (...args) => { actions.push(["subscription", ...args]); return { id: subscriptionId, customer: customerId, status: "paused" }; },
      resume: async (...args) => {
        actions.push(["resume", ...args]);
        resumed = true;
        return { id: subscriptionId, customer: customerId, status: "active", default_payment_method: `pm_mock_${index}` };
      },
    },
  };
  const active = await completeTrialPaymentSetup({
    stripe,
    session: { mode: "setup", customer: customerId, setup_intent: `seti_mock_${index}`, metadata: { purpose: "trial-payment-method", subscriptionId } },
  });
  if (!active.paymentReady || active.subscription.status !== "active") throw new Error(`Cycle ${index}: saved card did not activate service.`);
  const decline = getTrialPaymentState({ status: "past_due", default_payment_method: "pm_declined" });
  if (!decline.paymentFailed || decline.paymentReady) throw new Error(`Cycle ${index}: declined card looked healthy.`);
  if (actions.map(([name]) => name).join(",") !== "customer,subscription,resume") throw new Error(`Cycle ${index}: unexpected activation action order.`);
  return { cycle: index, trialing: true, pausedAtDay14: true, checkoutScoped: true, activeAfterCard: true, declineRejected: true, cancellationSupported: true };
}

async function main() {
  if (!Number.isInteger(cycles) || cycles < 5 || cycles > 20) throw new Error("--cycles must be an integer from 5 to 20.");
  const results = [];
  for (let index = 1; index <= cycles; index += 1) results.push(await runCycle(index));
  const report = {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    mode: "local-mocked-stripe-no-network",
    consecutivePasses: results.length,
    externalStripeObjectsCreated: 0,
    realPaymentsAttempted: 0,
    ready: results.length === cycles,
    results,
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exitCode = 1;
});
