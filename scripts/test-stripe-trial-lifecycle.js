const Stripe = require("stripe");
const fs = require("node:fs");
const path = require("node:path");
const { loadProjectEnv, rootPath } = require("./_helpers");
const { scheduleTrialCancellation } = require("../server/stripeTrialBilling");

const apply = process.argv.includes("--apply");
const confirmation = process.argv.find((arg) => arg.startsWith("--confirm="))?.slice(10) || "";
const confirmationPhrase = "RUN_STRIPE_TEST_CLOCKS";
let priceId = "";
const cycleCount = Number(process.argv.find((arg) => arg.startsWith("--cycles="))?.slice(9) || 5);

function check(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitForClock(stripe, clockId, timeoutMs = 45000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const clock = await stripe.testHelpers.testClocks.retrieve(clockId);
    if (clock.status === "ready") return clock;
    await new Promise((resolve) => setTimeout(resolve, 900));
  }
  throw new Error(`Stripe test clock ${clockId} did not become ready.`);
}

async function createTrial(stripe, label, { paymentMethod = "", clocks } = {}) {
  const frozenTime = Math.floor(Date.now() / 1000);
  const clock = await stripe.testHelpers.testClocks.create({ frozen_time: frozenTime, name: `My AI PA ${label}` });
  clocks.push(clock.id); // Save identity before a later customer/subscription request can fail.
  const customer = await stripe.customers.create({
    email: `stripe-test-${Date.now()}@example.invalid`,
    test_clock: clock.id,
    metadata: { source: "my-ai-pa-stripe-test" },
  });
  if (paymentMethod) {
    await stripe.paymentMethods.attach(paymentMethod, { customer: customer.id });
    await stripe.customers.update(customer.id, { invoice_settings: { default_payment_method: paymentMethod } });
  }
  const subscription = await stripe.subscriptions.create({
    customer: customer.id,
    items: [{ price: priceId }],
    trial_end: frozenTime + 14 * 86400,
    default_payment_method: paymentMethod || undefined,
    trial_settings: { end_behavior: { missing_payment_method: "pause" } },
    metadata: { source: "my-ai-pa-signup", testScenario: label },
  });
  return { clock, customer, subscription, frozenTime };
}

async function advancePastTrial(stripe, scenario) {
  await stripe.testHelpers.testClocks.advance(scenario.clock.id, { frozen_time: scenario.frozenTime + 14 * 86400 + 120 });
  await waitForClock(stripe, scenario.clock.id);
  return stripe.subscriptions.retrieve(scenario.subscription.id);
}

async function attachCardAndResume(stripe, scenario) {
  await stripe.paymentMethods.attach("pm_card_visa", { customer: scenario.customer.id });
  await stripe.customers.update(scenario.customer.id, { invoice_settings: { default_payment_method: "pm_card_visa" } });
  await stripe.subscriptions.update(scenario.subscription.id, { default_payment_method: "pm_card_visa" });
  let resumed = await stripe.subscriptions.resume(scenario.subscription.id, { billing_cycle_anchor: "now" });
  if (resumed.status === "paused" && resumed.latest_invoice) {
    await stripe.invoices.pay(typeof resumed.latest_invoice === "string" ? resumed.latest_invoice : resumed.latest_invoice.id);
    resumed = await stripe.subscriptions.retrieve(scenario.subscription.id);
  }
  return resumed;
}

async function main() {
  const env = loadProjectEnv();
  const secretKey = String(env.STRIPE_TEST_SECRET_KEY || "").trim();
  priceId = String(env.STRIPE_TEST_PRICE_ID || "").trim();
  if (!apply) {
    console.log(`Dry run only: zero provider requests. An authorized execution runs ${cycleCount} temporary trial, pause, card, paid renewal and actual cancellation cycles plus a declined-card check.`);
    console.log(`Test secret configured: ${secretKey.startsWith("sk_test_") ? "yes" : "no"}; test Price configured: ${/^price_/.test(priceId) ? "yes" : "no"}.`);
    console.log(`Run with --apply --confirm=${confirmationPhrase}`);
    return;
  }
  check(secretKey.startsWith("sk_test_"), "A Stripe test secret is required. Production keys are refused.");
  check(/^price_/.test(priceId), "Set STRIPE_TEST_PRICE_ID to a recurring Stripe test Price.");
  check(confirmation === confirmationPhrase, `Apply mode requires --confirm=${confirmationPhrase}.`);
  check(Number.isInteger(cycleCount) && cycleCount >= 1 && cycleCount <= 10, "--cycles must be an integer from 1 to 10.");
  const releaseCommit = process.argv.find(arg => arg.startsWith("--commit="))?.slice(9) || "";
  check(/^[a-f0-9]{40}$/.test(releaseCommit), "Apply mode requires an exact --commit.");

  const stripe = new Stripe(secretKey);
  const clocks = [];
  const results = { cycles: [] };
  let failed = false;
  try {
    const price = await stripe.prices.retrieve(priceId);
    check(price.livemode === false && Boolean(price.recurring), "A recurring test-mode Price is required.");
    for (let index = 1; index <= cycleCount; index += 1) {
      const scenario = await createTrial(stripe, `trial-to-payment-${index}`, { clocks });
      const ended = await advancePastTrial(stripe, scenario);
      check(ended.status === "paused", `Cycle ${index}: expected no-card trial to pause; received ${ended.status}.`);
      const resumed = await attachCardAndResume(stripe, scenario);
      check(resumed.status === "active", `Cycle ${index}: expected secure card setup to resume service; received ${resumed.status}.`);
      const terminal = await renewAndCancel(stripe, scenario, resumed);
      results.cycles.push({ cycle: index, afterTrial: ended.status, afterCard: resumed.status,
        renewalPaid: true, cancellation: true, afterCancellation: terminal.status });
    }

    const declined = await createTrial(stripe, "declined-card", { paymentMethod: "pm_card_chargeCustomerFail", clocks });
    const declinedEnded = await advancePastTrial(stripe, declined);
    results.declinedCard = declinedEnded.status;
    check(["past_due", "unpaid", "paused"].includes(declinedEnded.status), `Expected declined card to stop healthy service; received ${declinedEnded.status}.`);

  } catch (_) {
    failed = true;
  } finally {
    const cleanup = await cleanupTestClocks(stripe, clocks);
    const report = { schemaVersion: 1, checkedAt: new Date().toISOString(), releaseCommit,
      mode: "stripe-test-clocks", scope: "provider-api-test-only", liveMode: false, realPaymentsAttempted: 0,
      consecutivePasses: results.cycles.length, results: results.cycles, cleanup,
      cleanupConfirmed: cleanup.length > 0 && cleanup.every(item => item.confirmed),
      declinedCardRejected: ["past_due", "unpaid", "paused"].includes(results.declinedCard),
      hostedCheckoutExercised: false, applicationWebhooksExercised: false,
      ...(failed ? { failureCode: "LIFECYCLE_ASSERTION_OR_PROVIDER_REQUEST_FAILED" } : {}),
    };
    report.ready = !failed && report.consecutivePasses === cycleCount && report.declinedCardRejected && report.cleanupConfirmed;
    const output = rootPath("diagnostics/shipping-readiness/stripe-trial-gate.json");
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
    console.log(JSON.stringify(report, null, 2));
    if (!report.ready) process.exitCode = 1;
  }
}

function periodEnd(subscription) {
  const end = Number(subscription.current_period_end || subscription.items?.data?.[0]?.current_period_end);
  check(Number.isFinite(end) && end > 0, "Stripe did not return a verifiable billing period end.");
  return end;
}
async function advanceTo(stripe, scenario, frozenTime) {
  await stripe.testHelpers.testClocks.advance(scenario.clock.id, { frozen_time: frozenTime });
  await waitForClock(stripe, scenario.clock.id);
  return stripe.subscriptions.retrieve(scenario.subscription.id);
}
async function renewAndCancel(stripe, scenario, resumed) {
  const renewed = await advanceTo(stripe, scenario, periodEnd(resumed) + 120);
  const invoiceId = typeof renewed.latest_invoice === "string" ? renewed.latest_invoice : renewed.latest_invoice?.id;
  check(renewed.status === "active" && invoiceId, "Renewal did not return active service and an invoice.");
  check((await stripe.invoices.retrieve(invoiceId)).status === "paid", "Renewal invoice was not paid.");
  const canceled = await scheduleTrialCancellation({ stripe, customerId: scenario.customer.id, subscriptionId: scenario.subscription.id });
  check(canceled.cancel_at_period_end === true, "Cancellation at period end was not saved.");
  const terminal = await advanceTo(stripe, scenario, periodEnd(canceled) + 120);
  check(terminal.status === "canceled", "Subscription did not cancel at period end.");
  return terminal;
}
async function cleanupTestClocks(stripe, clocks) {
  const results = [];
  for (const id of clocks) {
    try { results.push({ confirmed: (await stripe.testHelpers.testClocks.del(id))?.deleted === true }); }
    catch (_) { results.push({ confirmed: false }); }
  }
  return results;
}
if (require.main === module) main().catch(() => {
  console.error("Stripe test lifecycle blocked; verify explicit test-only configuration, exact commit and confirmation. No successful gate was recorded.");
  process.exitCode = 1;
});
module.exports = { renewAndCancel, cleanupTestClocks, periodEnd };
