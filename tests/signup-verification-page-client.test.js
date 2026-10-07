const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");
const { verificationPageClientScript } = require("../server/signupVerificationPageClient");
const tick = () => new Promise(resolve => setTimeout(resolve, 20));
function page({ automatic = true, visible = true, fetchImpl }) {
  return new JSDOM(`<main><h1 id="verification-title">Verify</h1><p id="verification-description"></p><p id="setup-progress" hidden></p><form id="signup-verification-form" action="/api/integrations/verify-signup-contact" method="post"><input name="token" value="synthetic-token"><input name="channelProof" value="synthetic-proof"><input name="confirmation" value="VERIFY_AND_CONTINUE"><button>Verify and continue</button></form><a href="tel:+19055550111">Support</a></main>${verificationPageClientScript({ automaticSmsConfirmation: automatic })}`, {
    url: "https://api.myaipa.test/api/integrations/verify-signup-contact?token=synthetic-token", runScripts: "dangerously", pretendToBeVisual: visible,
    beforeParse(window) { window.fetch = fetchImpl; },
  });
}
const resultHtml = '<!doctype html><main><h1>Your number is assigned</h1><section aria-label="Assigned My AI PA number"><p>+1 (289) 555-0112</p><a href="tel:+12895550112">Call the number</a><button id="copy-number">Copy number</button></section><a href="https://www.myaipa.test/#/forwarding-setup?token=synthetic">Continue</a></main>';
const response = html => ({ headers: { get: () => "text/html; charset=utf-8" }, text: async () => html });

test("one SMS tap shows progress, then number and actions at the same URL", async () => {
  let finish; const requests = [];
  const dom = page({ fetchImpl: (url, options) => { requests.push({ url, options }); return new Promise(resolve => { finish = resolve; }); } });
  try {
    assert.equal(requests.length, 1);
    assert.equal(requests[0].options.method, "POST");
    assert.equal(requests[0].options.redirect, "error");
    assert.equal(new URLSearchParams(requests[0].options.body).get("confirmation"), "VERIFY_AND_CONTINUE");
    assert.equal(dom.window.document.querySelector("#setup-progress").hidden, false);
    assert.equal(dom.window.document.querySelector("section"), null, "No assigned number invented during provisioning");
    finish(response(resultHtml)); await tick();
    assert.match(dom.window.document.body.textContent, /289.*555-0112/);
    assert.equal(dom.window.document.querySelector('a[href="tel:+12895550112"]').textContent, "Call the number");
    assert.equal(dom.window.document.querySelector("#copy-number").textContent, "Copy number");
    assert.equal(dom.window.location.pathname, "/api/integrations/verify-signup-contact");
    assert.equal(requests.length, 1);
  } finally { dom.window.close(); }
});
test("hidden previews do not submit and repeated visibility events cannot submit twice", async () => {
  let count = 0;
  const dom = page({ visible: false, fetchImpl: async () => { count++; return new Promise(() => {}); } });
  try {
    await tick(); assert.equal(count, 0);
    Object.defineProperty(dom.window.document, "visibilityState", { value: "visible", configurable: true });
    dom.window.document.dispatchEvent(new dom.window.Event("visibilitychange"));
    dom.window.document.dispatchEvent(new dom.window.Event("visibilitychange"));
    assert.equal(count, 1);
  } finally { dom.window.close(); }
});
test("email confirmation stays explicit, then uses the same progress flow", async () => {
  let count = 0;
  const dom = page({ automatic: false, fetchImpl: async () => { count++; return response(resultHtml); } });
  try {
    await tick(); assert.equal(count, 0);
    dom.window.document.querySelector("form").dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
    await tick(); assert.equal(count, 1);
    assert.match(dom.window.document.body.textContent, /555-0112/);
  } finally { dom.window.close(); }
});
test("review/error result is shown instead of inventing a number or redirecting", async () => {
  const dom = page({ fetchImpl: async () => response('<main><h1>Contact verified, setup needs attention</h1><p>Please contact support.</p></main>') });
  try { await tick(); assert.match(dom.window.document.body.textContent, /needs attention/); assert.equal(dom.window.document.querySelector("#copy-number"), null); }
  finally { dom.window.close(); }
});
test("lost response gives a useful message without resending or claiming success", async () => {
  let count = 0;
  const dom = page({ fetchImpl: async () => { count++; throw Error("network timeout"); } });
  try { await tick(); assert.match(dom.window.document.body.textContent, /couldn’t confirm setup/); assert.match(dom.window.document.body.textContent, /don’t submit another/); assert.equal(count, 1); assert.equal(dom.window.document.querySelector("form").hidden, true); }
  finally { dom.window.close(); }
});
test("backend stays on the number page and forwarding is an explicit Continue link", () => {
  const fs = require("node:fs");
  const source = fs.readFileSync(require.resolve("../server/index.js"), "utf8");
  const route = source.slice(source.indexOf('["/api/integrations/verify-signup-contact"'), source.indexOf('"/api/payments/create-checkout-session"'));
  assert.doesNotMatch(route, /res\.redirect\(303, forwardingSetup\.setupUrl\)/);
  assert.match(route, /assignedPhone: twilioPhoneNumber/);
  assert.match(route, /setupReady \? "Continue"/);
  assert.match(route, /verificationPageClientScript\(\{ automaticSmsConfirmation \}\)/);
});
