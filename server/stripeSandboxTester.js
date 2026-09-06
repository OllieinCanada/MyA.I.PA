const crypto = require("crypto");

const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const SCENARIO_TTL_MS = 4 * 60 * 60 * 1000;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function signPayload(secret, purpose, payload) {
  return crypto.createHmac("sha256", secret).update(`${purpose}:${payload}`).digest("hex");
}

function createSignedToken(secret, purpose, value, ttlMs, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ v: 1, exp: now + ttlMs, value })).toString("base64url");
  return `${payload}.${signPayload(secret, purpose, payload)}`;
}

function readSignedToken(secret, purpose, token, now = Date.now()) {
  if (!secret || !token || !token.includes(".")) return null;
  const [payload, suppliedSignature] = String(token).split(".");
  if (!payload || !suppliedSignature) return null;
  const expectedSignature = signPayload(secret, purpose, payload);
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (parsed?.v !== 1 || Number(parsed.exp || 0) <= now) return null;
    return parsed.value || null;
  } catch (_error) {
    return null;
  }
}

function createSandboxSessionToken(secret, now) {
  return createSignedToken(secret, "stripe-sandbox-session", { authenticated: true }, SESSION_TTL_MS, now);
}

function hasValidSandboxSession(secret, token, now) {
  return readSignedToken(secret, "stripe-sandbox-session", token, now)?.authenticated === true;
}

function createSandboxScenarioToken(secret, scenario, now) {
  return createSignedToken(secret, "stripe-sandbox-scenario", scenario, SCENARIO_TTL_MS, now);
}

function readSandboxScenarioToken(secret, token, now) {
  const scenario = readSignedToken(secret, "stripe-sandbox-scenario", token, now);
  if (!scenario || !/^clock_/.test(String(scenario.clockId || ""))) return null;
  if (!/^cus_/.test(String(scenario.customerId || ""))) return null;
  if (!/^sub_/.test(String(scenario.subscriptionId || ""))) return null;
  return scenario;
}

function pageShell(content, { refresh = false } = {}) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  ${refresh ? '<meta http-equiv="refresh" content="3">' : ""}
  <title>Private Stripe Trial Tester · My AI PA</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #f3f6fa; color: #09172b; }
    main { width: min(820px, calc(100% - 24px)); margin: 24px auto 60px; }
    .hero { padding: 30px; border-radius: 22px; background: #071426; color: white; box-shadow: 0 18px 50px rgba(7,20,38,.2); }
    .eyebrow { margin: 0 0 8px; color: #ffb000; font-size: 13px; font-weight: 900; letter-spacing: .14em; text-transform: uppercase; }
    h1 { margin: 0; font-size: clamp(30px, 7vw, 48px); line-height: 1.04; }
    .hero p:last-child { margin-bottom: 0; color: #c7d5e7; font-size: 17px; line-height: 1.5; }
    .card { margin-top: 18px; padding: 26px; border: 1px solid #dce5ef; border-radius: 18px; background: white; box-shadow: 0 8px 28px rgba(25,45,75,.07); }
    h2 { margin: 0 0 16px; font-size: 24px; }
    .timeline { display: grid; gap: 10px; margin: 0; padding: 0; list-style: none; }
    .timeline li { display: grid; grid-template-columns: 36px 1fr auto; gap: 12px; align-items: center; padding: 14px; border: 1px solid #dfe7f0; border-radius: 12px; }
    .n { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 50%; background: #eaf0f6; font-weight: 900; }
    .done .n { background: #dff7e8; color: #08713c; }
    .current { border-color: #ffb000 !important; background: #fffaf0; }
    .current .n { background: #ffb000; color: #071426; }
    .state { font-size: 12px; font-weight: 900; letter-spacing: .08em; color: #607087; }
    .status { display: inline-block; padding: 8px 12px; border-radius: 999px; background: #eaf0f6; font-weight: 900; text-transform: uppercase; }
    .status.active { background: #dff7e8; color: #08713c; }
    .status.paused { background: #fff0cc; color: #7a4a00; }
    form { margin: 18px 0 0; }
    label { display: block; margin-bottom: 7px; font-weight: 800; }
    input { width: 100%; padding: 14px; border: 1px solid #b9c6d5; border-radius: 11px; font: inherit; }
    button, .button { width: 100%; display: block; margin-top: 12px; padding: 15px 18px; border: 0; border-radius: 12px; background: #1267d6; color: white; font: inherit; font-weight: 900; text-align: center; text-decoration: none; cursor: pointer; }
    button.gold { background: #ffb000; color: #071426; }
    .notice { margin-top: 16px; padding: 15px; border-left: 5px solid #ffb000; background: #fff8e7; line-height: 1.5; }
    .success { border-left-color: #19a45b; background: #eaf9f1; }
    code { padding: 2px 6px; border-radius: 5px; background: #e9eef5; font-size: .95em; }
    .error { color: #a21f32; font-weight: 800; }
    .small { color: #607087; font-size: 14px; line-height: 1.5; }
    @media (max-width: 560px) { .hero, .card { padding: 20px; } .timeline li { grid-template-columns: 34px 1fr; } .state { grid-column: 2; } }
  </style>
</head>
<body><main>${content}</main></body>
</html>`;
}

function renderSandboxLogin({ configured, error = "" } = {}) {
  return pageShell(`
    <section class="hero"><p class="eyebrow">Private · Test mode only</p><h1>Stripe trial tester</h1><p>Safely prove the complete 14-day customer billing flow without a real charge.</p></section>
    <section class="card">
      <h2>${configured ? "Enter the private sandbox password" : "Tester needs configuration"}</h2>
      ${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
      ${configured ? `<form method="post" action="/stripe-sandbox-test/login"><label for="password">Sandbox password</label><input id="password" name="password" type="password" autocomplete="current-password" required><button type="submit">Open private tester</button></form>` : '<p class="notice">Set the sandbox-only access password before using this page. Live Stripe keys are refused.</p>'}
      <p class="small">No real card numbers should ever be entered here. Use Stripe’s published test card only.</p>
    </section>`);
}

function renderSandboxTestPage({ scenario, subscription, checkoutReturned = false, error = "" } = {}) {
  const status = String(subscription?.status || "not started").toLowerCase();
  const hasScenario = Boolean(scenario?.subscriptionId);
  const trialCreated = hasScenario;
  const trialEnded = ["paused", "active", "past_due", "unpaid"].includes(status);
  const active = status === "active";
  const waitingForWebhook = checkoutReturned && !active;
  return pageShell(`
    <section class="hero"><p class="eyebrow">Private · Stripe sandbox</p><h1>14-day trial checkout test</h1><p>Follow the steps in order. Stripe test clocks turn 14 days into a few seconds.</p></section>
    <section class="card">
      <h2>Test progress</h2>
      ${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
      <ol class="timeline">
        <li class="${trialCreated ? "done" : "current"}"><span class="n">1</span><strong>Create simulated trial</strong><span class="state">${trialCreated ? "DONE" : "NEXT"}</span></li>
        <li class="${trialEnded ? "done" : trialCreated ? "current" : ""}"><span class="n">2</span><strong>Advance to day 14</strong><span class="state">${trialEnded ? "DONE" : trialCreated ? "NEXT" : "WAITING"}</span></li>
        <li class="${active ? "done" : trialEnded ? "current" : ""}"><span class="n">3</span><strong>Add card securely</strong><span class="state">${active ? "DONE" : trialEnded ? "NEXT" : "WAITING"}</span></li>
        <li class="${active ? "done current" : ""}"><span class="n">4</span><strong>Confirm subscription active</strong><span class="state">${active ? "PASSED" : "WAITING"}</span></li>
      </ol>
      ${subscription ? `<p class="notice ${active ? "success" : ""}">Stripe subscription status: <span class="status ${escapeHtml(status)}">${escapeHtml(status)}</span>${waitingForWebhook ? "<br>Checkout returned successfully. Waiting for the signed webhook to finish activation; this page refreshes automatically." : ""}</p>` : ""}
      ${!trialCreated ? '<form method="post" action="/stripe-sandbox-test/start"><button type="submit">Create simulated 14-day trial</button></form>' : ""}
      ${trialCreated && !trialEnded ? '<form method="post" action="/stripe-sandbox-test/advance"><button class="gold" type="submit">Advance safely to day 14</button></form>' : ""}
      ${trialEnded && !active ? '<form method="post" action="/stripe-sandbox-test/checkout"><button type="submit">Add card securely</button></form><p class="small">On Stripe Checkout use <code>4242 4242 4242 4242</code>, any future expiry date, and any three-digit CVC.</p>' : ""}
      ${active ? '<p class="notice success"><strong>PASS:</strong> Stripe confirmed the customer-specific subscription is active. The card was saved through hosted Checkout and the paused service resumed.</p>' : ""}
      ${hasScenario ? '<form method="post" action="/stripe-sandbox-test/start"><button class="gold" type="submit">Start a fresh test</button></form>' : ""}
      <a class="button" href="/">Back to sandbox status</a>
    </section>`, { refresh: waitingForWebhook });
}

module.exports = {
  createSandboxScenarioToken,
  createSandboxSessionToken,
  hasValidSandboxSession,
  readSandboxScenarioToken,
  renderSandboxLogin,
  renderSandboxTestPage,
};
