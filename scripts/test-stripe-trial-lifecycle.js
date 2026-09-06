const Stripe = require("stripe");
const { loadProjectEnv } = require("./_helpers");

const env = loadProjectEnv();
const apply = process.argv.includes("--apply");
const confirmation = process.argv.find((arg) => arg.startsWith("--confirm="))?.slice(10) || "";
const confirmationPhrase = "RUN_STRIPE_TEST_CLOCKS";
const secretKey = String(env.STRIPE_TEST_SECRET_KEY || env.STRIPE_SECRET_KEY || "").trim();
const priceId = String(env.STRIPE_TEST_PRICE_ID || env.STRIPE_PRICE_ID || "").trim();

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

async function createTrial(stripe, label, { paymentMethod = "" } = {}) {
  const frozenTime = Math.floor(Date.now() / 1000);
  const clock = await stripe.testHelpers.testClocks.create({ frozen_time: frozenTime, name: `My AI PA ${label}` });
  const customer = await stripe.customers.create({
    email: `stripe-test-${Date.now()}@example.com`,
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

async function main() {
  if (!apply) {
    console.log("Dry run only. This will create temporary Stripe Test Clock customers/subscriptions for: valid card, no card, declined card, add-card-after-pause, and cancellation.");
    console.log(`Test secret configured: ${secretKey.startsWith("sk_test_") ? "yes" : "no"}; test Price configured: ${/^price_/.test(priceId) ? "yes" : "no"}.`);
    console.log(`Run with --apply --confirm=${confirmationPhrase}`);
    return;
  }
  check(secretKey.startsWith("sk_test_"), "A Stripe test secret is required. Production keys are refused.");
  check(/^price_/.test(priceId), "Set STRIPE_TEST_PRICE_ID to a recurring Stripe test Price.");
  check(confirmation === confirmationPhrase, `Apply mode requires --confirm=${confirmationPhrase}.`);

  const stripe = new Stripe(secretKey);
  const clocks = [];
  const results = {};
  try {
    const noCard = await createTrial(stripe, "no-card");
    clocks.push(noCard.clock.id);
    const noCardEnded = await advancePastTrial(stripe, noCard);
    results.noCard = noCardEnded.status;
    check(noCardEnded.status === "paused", `Expected no-card trial to pause; received ${noCardEnded.status}.`);

    const valid = await createTrial(stripe, "valid-card", { paymentMethod: "pm_card_visa" });
    clocks.push(valid.clock.id);
    const validEnded = await advancePastTrial(stripe, valid);
    results.validCard = validEnded.status;
    check(validEnded.status === "active", `Expected valid card to activate; received ${validEnded.status}.`);

    const declined = await createTrial(stripe, "declined-card", { paymentMethod: "pm_card_chargeCustomerFail" });
    clocks.push(declined.clock.id);
    const declinedEnded = await advancePastTrial(stripe, declined);
    results.declinedCard = declinedEnded.status;
    check(["past_due", "unpaid", "paused"].includes(declinedEnded.status), `Expected declined card to stop healthy service; received ${declinedEnded.status}.`);

    await stripe.paymentMethods.attach("pm_card_visa", { customer: noCard.customer.id });
    await stripe.customers.update(noCard.customer.id, { invoice_settings: { default_payment_method: "pm_card_visa" } });
    await stripe.subscriptions.update(noCard.subscription.id, { default_payment_method: "pm_card_visa" });
    let resumed = await stripe.subscriptions.resume(noCard.subscription.id, { billing_cycle_anchor: "now" });
    if (resumed.status === "paused" && resumed.latest_invoice) {
      await stripe.invoices.pay(typeof resumed.latest_invoice === "string" ? resumed.latest_invoice : resumed.latest_invoice.id);
      resumed = await stripe.subscriptions.retrieve(noCard.subscription.id);
    }
    results.afterPause = resumed.status;
    check(resumed.status === "active", `Expected after-pause card setup to resume; received ${resumed.status}.`);

    const cancelled = await createTrial(stripe, "cancel-before-charge");
    clocks.push(cancelled.clock.id);
    const cancelResult = await stripe.subscriptions.update(cancelled.subscription.id, { cancel_at_period_end: true });
    results.cancellation = cancelResult.cancel_at_period_end;
    check(cancelResult.cancel_at_period_end === true, "Expected cancellation at period end to be saved.");

    console.log(JSON.stringify({ ok: true, mode: "Stripe test clocks", results, duplicateWebhook: "covered by backend replay tests" }, null, 2));
  } finally {
    for (const clockId of clocks) {
      await stripe.testHelpers.testClocks.del(clockId).catch(() => {});
    }
  }
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exitCode = 1;
});
