const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "../server/index.js"), "utf8");
const start = source.indexOf("    function renderVerificationPage(");
const end = source.indexOf("\n    const hasChannelClaim", start);
assert.ok(start >= 0 && end > start);

function render(channel, method = "GET", options = {}) {
  let html;
  const req = { method, path: "/api/integrations/verify-signup-contact" };
  const res = { status() { return this; }, send(value) { html = value; } };
  const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const renderPage = new Function("req", "res", "verificationChannel", "token", "normalizePhoneForMatch", "formatAssignedPhone", "escapeHtml", "createVerificationChannelProof", "createVerificationConfirmationProof", "getAdminSessionSecret", "CUSTOMER_SUPPORT_PHONE", "FRONTEND_APP_URL",
    source.slice(start, end) + "\nreturn renderVerificationPage;");
  renderPage(req, res, channel, "test-token", (value) => value, (value) => value, escapeHtml, () => "channel-proof", () => "confirmation-proof", () => "test-secret", "+19055550123", "https://www.myaipa.ca")({
    ok: true, confirmation: true, title: "Setting up", body: "Wait", ...options,
  });
  return html;
}

test("SMS opens with an automatic signed POST and no visible second verification button", () => {
  const html = render("sms");
  assert.match(html, /name="confirmation" value="VERIFY_AND_CONTINUE"/);
  assert.match(html, /name="confirmationProof" value="confirmation-proof"/);
  assert.match(html, /name="channelProof" value="channel-proof"/);
  assert.match(html, /method="post"/);
  assert.doesNotMatch(html.replace(/<noscript>[\s\S]*?<\/noscript>/g, ""), /<button[^>]*>Verify and continue<\/button>/);
  assert.match(html, /requestSubmit/);
});

test("email confirmation and HEAD previews never auto-submit", () => {
  assert.doesNotMatch(render("email"), /requestSubmit/);
  assert.match(render("email"), />Verify and continue<\/button>/);
  assert.doesNotMatch(render("sms", "HEAD"), /requestSubmit/);
});

test("automatic verification waits for a visible page and submits only once", () => {
  const html = render("sms");
  const script = html.match(/<script>([\s\S]*?requestSubmit[\s\S]*?)<\/script>/)[1];
  let calls = 0;
  let visibilityListener;
  const document = {
    visibilityState: "hidden",
    addEventListener(_event, listener) { visibilityListener = listener; },
    getElementById() { return { requestSubmit() { calls += 1; } }; },
  };
  new Function("document", script)(document);
  assert.equal(calls, 0);
  document.visibilityState = "visible";
  visibilityListener();
  visibilityListener();
  assert.equal(calls, 1);
});

test("ready landing page displays the assigned number immediately", () => {
  const html = render("sms", "POST", { confirmation: false, assignedPhone: "+12895550123" });
  assert.match(html, /Your My AI PA number/);
  assert.match(html, /class="number-value">\+12895550123/);
  assert.doesNotMatch(html, /signup-verification-form/);
});
