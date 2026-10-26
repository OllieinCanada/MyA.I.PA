const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../server/index.js'), 'utf8').replace(/\r\n/g, '\n');

test('editor mutations require owner session and exact forwarding scope, trusted origin, JSON and editor header', () => {
  const helper = source.slice(source.indexOf('async function requireBusinessEditor('), source.indexOf('async function assertBusinessEditorLifecycle('));
  assert.match(helper, /getCustomerDashboardSessionLookupHash\(req\)/);
  assert.match(helper, /requireForwardingSetup\(req\)/);
  assert.match(helper, /businessEditorIdentity\(signup, setup\)/);
  assert.match(helper, /vapiBusinessMapping\.findMany/);
  assert.match(helper, /isAllowedOrigin/); assert.match(helper, /x-myaipa-editor/); assert.match(helper, /application/);
  const routes = source.slice(source.indexOf("app.get('/api/customer/dashboard/business-details'"), source.indexOf('app.get(\n  "/api/forwarding/setup"'));
  assert.match(routes, /app\.patch/); assert.match(routes, /assertBusinessEditorRequest\(req\)/);
  assert.match(routes, /requireBusinessEditor\(req\)/); assert.match(routes, /enforcePublicRouteRateLimit/);
  assert.doesNotMatch(routes, /createSignupVapiAssistant|importTwilioPhone|provisionIsolated|sendSms|makeSignup|createTrial/);
});
test('ready server page uses approved helper only after canonical-number readiness; confirmation and progress stay gated', () => {
  const page = source.slice(source.indexOf('function renderVerificationPage('), source.indexOf('async function renderSavedProgress('));
  assert.match(page, /const setupReady = ok && Boolean\(canonicalPhone && displayPhone\)/);
  assert.match(page, /if \(setupReady\) return res\.status\(200\)\.send\(renderOnboardingReadyPage/);
  assert.match(page, /verificationProgressScript/); assert.match(page, /createVerificationConfirmationProof/);
});
test('resumed signup status only includes setup access in ready state after ownership resolution', () => {
  const route = source.slice(source.indexOf('"/api/signup/status/:attemptId"'), source.indexOf('"/api/integrations/signup-complete"'));
  assert.match(route, /signupAttempts\.authenticate/); assert.match(route, /resolveSignupResume/);
  assert.match(route, /if \(signup.state === 'ready'\)/); assert.match(route, /ownedReadyForwardingSetupUrl/);
  assert.match(route, /signup: target\.record/); assert.match(route, /assignedPhone: signup\.assignedPhone/);
});
test('dashboard projects current revision for readiness rather than claiming old samples prove new content', () => {
  assert.match(source, /currentContentSignup = readinessSignupForRevision\(signup, publishedDetails\)/);
  assert.match(source, /agentTesting: \{ \.\.\.buildAgentReadiness\(\{ signup: currentContentSignup, business \}\)/);
  assert.match(source, /historicalRoutingTestPassed/);
});
