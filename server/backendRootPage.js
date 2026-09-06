function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function buildBackendRootPage({
  stripeConfigured = false,
  webhookConfigured = false,
  priceConfigured = false,
  trialDays = 14,
  planDisplay = "$79/month plus applicable tax",
  sandbox = false,
  testerConfigured = false,
} = {}) {
  const configured = stripeConfigured && webhookConfigured && priceConfigured;
  const status = configured ? "READY" : "NEEDS SETUP";
  const statusClass = configured ? "ready" : "warning";
  const mode = sandbox ? "Stripe test mode" : "Stripe mode";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>My AI PA Stripe Sandbox</title>
    <style>
      :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      * { box-sizing: border-box; }
      body { margin: 0; background: #f4f7fb; color: #0b1930; }
      main { width: min(920px, calc(100% - 32px)); margin: 32px auto 56px; }
      .hero { padding: 34px; border-radius: 24px; background: #071426; color: white; box-shadow: 0 20px 55px rgba(7, 20, 38, .18); }
      .eyebrow { margin: 0 0 10px; color: #ffb000; font-size: 14px; font-weight: 900; letter-spacing: .14em; text-transform: uppercase; }
      h1 { margin: 0; font-size: clamp(32px, 6vw, 54px); line-height: 1.02; }
      .hero-copy { max-width: 680px; margin: 16px 0 0; color: #c9d6e6; font-size: 18px; line-height: 1.55; }
      .status { display: inline-flex; align-items: center; gap: 8px; margin-top: 22px; padding: 10px 14px; border-radius: 999px; font-weight: 900; letter-spacing: .06em; }
      .status.ready { background: #dff7e8; color: #08713c; }
      .status.warning { background: #fff0cc; color: #7a4a00; }
      .panel { margin-top: 20px; padding: 26px; border: 1px solid #dce4ee; border-radius: 20px; background: white; box-shadow: 0 10px 30px rgba(25, 45, 75, .08); }
      h2 { margin: 0 0 18px; font-size: 25px; }
      .steps { display: grid; gap: 12px; margin: 0; padding: 0; list-style: none; }
      .step { display: grid; grid-template-columns: 42px 1fr auto; gap: 14px; align-items: center; padding: 17px; border: 1px solid #dfe7f0; border-radius: 14px; }
      .number { display: grid; place-items: center; width: 42px; height: 42px; border-radius: 50%; background: #ffb000; color: #071426; font-weight: 950; }
      .step strong { display: block; font-size: 17px; }
      .step p { margin: 4px 0 0; color: #53657a; line-height: 1.4; }
      .check { color: #078447; font-size: 22px; font-weight: 950; }
      .facts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
      .fact { padding: 18px; border-radius: 14px; background: #f4f7fb; }
      .fact span { display: block; color: #607087; font-size: 13px; font-weight: 800; text-transform: uppercase; }
      .fact strong { display: block; margin-top: 6px; font-size: 18px; }
      .note { margin: 18px 0 0; padding: 16px; border-left: 5px solid #ffb000; background: #fff8e7; line-height: 1.5; }
      .actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 20px; }
      .button { display: inline-block; padding: 14px 18px; border-radius: 12px; background: #1267d6; color: white; font-weight: 850; text-decoration: none; }
      .button.secondary { background: #e7edf5; color: #16283e; }
      footer { margin-top: 18px; color: #65758a; font-size: 13px; text-align: center; }
      @media (max-width: 650px) {
        main { width: min(100% - 20px, 920px); margin-top: 10px; }
        .hero, .panel { padding: 22px; border-radius: 17px; }
        .step { grid-template-columns: 38px 1fr; }
        .check { grid-column: 2; }
        .facts { grid-template-columns: 1fr; }
        .actions { display: grid; }
        .button { text-align: center; }
      }
    </style>
  </head>
  <body>
    <main>
      <section class="hero">
        <p class="eyebrow">My AI PA · Stripe sandbox</p>
        <h1>Billing system status</h1>
        <p class="hero-copy">This is the safe testing backend for the 14-day trial and customer billing workflow. It cannot charge a real card while test mode is active.</p>
        <div class="status ${statusClass}">● ${status}</div>
      </section>

      <section class="panel">
        <h2>What this system does</h2>
        <ol class="steps">
          <li class="step"><span class="number">1</span><div><strong>Creates and monitors subscriptions</strong><p>A verified signup receives its own Stripe customer and subscription.</p></div><span class="check">✓</span></li>
          <li class="step"><span class="number">2</span><div><strong>Receives secure Stripe webhooks</strong><p>Stripe reports trial, checkout, invoice, payment and subscription changes.</p></div><span class="check">${webhookConfigured ? "✓" : "!"}</span></li>
          <li class="step"><span class="number">3</span><div><strong>Pauses after ${escapeHtml(trialDays)} days without a card</strong><p>No card is collected during the trial. Calls pause safely if Checkout is not completed afterward.</p></div><span class="check">✓</span></li>
          <li class="step"><span class="number">4</span><div><strong>Creates customer-specific Checkout</strong><p>After the trial, the signed-in customer receives a secure Stripe Checkout session tied to their subscription.</p></div><span class="check">${stripeConfigured && priceConfigured ? "✓" : "!"}</span></li>
        </ol>
      </section>

      <section class="panel">
        <h2>Current sandbox settings</h2>
        <div class="facts">
          <div class="fact"><span>Mode</span><strong>${escapeHtml(mode)}</strong></div>
          <div class="fact"><span>Free trial</span><strong>${escapeHtml(trialDays)} days</strong></div>
          <div class="fact"><span>Plan afterward</span><strong>${escapeHtml(planDisplay)}</strong></div>
        </div>
        <p class="note"><strong>Why there is no checkout button here:</strong> Checkout is created only for a verified, signed-in customer after that customer’s trial ends. This status page never creates random billing records for visitors.</p>
        <div class="actions">
          ${testerConfigured ? '<a class="button" href="/stripe-sandbox-test">Open private trial tester</a>' : ""}
          <a class="button" href="https://www.myaipa.ca/">Open the customer website</a>
          <a class="button secondary" href="/api/health">Check backend health</a>
        </div>
      </section>
      <footer>Updated ${escapeHtml(new Date().toISOString())} · No API keys or customer information are shown.</footer>
    </main>
  </body>
</html>`;
}

module.exports = { buildBackendRootPage };
