const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const copy = require("../src/features/onboarding/onboardingCopy");

const read = file => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const source = read("src/ForwardingSetup.js");
const wizard = read("src/features/onboarding/OnboardingWizard.js");
const api = read("src/features/onboarding/onboardingApi.js");
const editor = read("src/features/onboarding/BusinessDetailsEditor.js");
const dashboard = read("src/CustomerDashboard.js");

test("signed setup entry uses the same approved three-stage wizard", () => {
  assert.match(source, /<OnboardingWizard/);
  assert.match(source, /readWizardLocation/);
  assert.deepEqual(copy.steps, ["Test your receptionist", "Going live", "Reminders"]);
  assert.match(wizard, /step === 1/);
  assert.match(wizard, /step === 2/);
  assert.match(wizard, /step === 3/);
  assert.doesNotMatch(wizard, /needsChoices|Cellphone or landline\?|LINE_TYPES/);
  assert.match(wizard, /onboarding-instructions/);
  assert.match(wizard, /Optional: change this if your phone company rejects the instructions/);
});

test("the number is dynamic and its all-caps label precedes immediate practice", () => {
  assert.match(wizard, /assignedMyAiPaNumber/);
  assert.ok(wizard.indexOf('className="onboarding-number-value"') < wizard.indexOf("{copy.numberLabel}"));
  assert.ok(wizard.indexOf("{copy.numberLabel}") < wizard.indexOf("{copy.testTitle}"));
  assert.equal(copy.numberLabel, "THIS IS YOUR NEW RECEPTIONIST PHONE NUMBER");
  assert.match(copy.practice, /comfortable with the dialog\./);
  assert.doesNotMatch(wizard, /289\) 512-9460|Practice is optional|After your call, look for both texts/);
});

test("short and long capability links stay in the fragment without browser storage", () => {
  assert.match(read("src/index.js"), /route\.startsWith\("f\/"\)/);
  assert.match(api, /decodeURIComponent\(shortMatch\[1\]\)/);
  assert.match(api, /\.get\("token"\)/);
  assert.doesNotMatch(api + wizard + editor, /localStorage|sessionStorage/);
});

test("carrier-specific instructions qualify the requested four-ring action", () => {
  assert.equal(copy.forwardingAction, "Click here to forward your missed calls to your assistant after 4 rings");
  assert.match(copy.timing, /where supported/);
  assert.match(copy.timing, /timing may differ/);
  assert.match(wizard, /rule\.timing\.customerCopy/);
  assert.doesNotMatch(wizard, /exactly three rings/i);
});

test("browser activation is a real tel gesture, never silently confirmed", () => {
  assert.match(wizard, /href=\{dialUri\}/);
  assert.match(wizard, /\/setup\/activation-opened/);
  assert.equal(copy.confirmation, "Then press Call / Send and wait for your phone company’s confirmation.");
  assert.match(copy.activationBoundary, /does not confirm forwarding is active/);
  assert.match(wizard, /will not guess a command/);
});

test("returning from the dialer never arms or places an outbound callback", () => {
  assert.doesNotMatch(source + wizard + api, /myaipa-forwarding-auto-test|startTest|\/setup\/verify|Test My Setup|Test Again|Do not answer the test call/);
  assert.doesNotMatch(wizard, /visibilitychange|pageshow/);
  assert.match(wizard, /onClick=\{\(\) => moveTo\(3\)\}/);
  assert.doesNotMatch(wizard, /<input[^>]+checkbox/);
});

test("active customers can still reach safe disable guidance", () => {
  assert.match(wizard, /Turn off \/ view disable instructions/);
  assert.match(wizard, /We will not guess a disable command/);
});

test("reminders preserve the complete original wording in the approved order", () => {
  assert.equal(copy.finalCall, "Call your business phone # from another phone to experience first hand the reception callers will receive.");
  assert.equal(copy.finalMessages, "Don’t forget to look for the instant text messages sent to both the caller (Thanks for calling) (friendly reminder) and your phone.");
  assert.equal(copy.finalReport, "Listing caller information / job information clean organized and within a touch of your phone for easy follow up.");
  const stage = wizard.slice(wizard.indexOf('{step === 3'));
  const positions = ["{copy.finalTitle}", "{copy.finalCall}", "{copy.finalMessages}", "{copy.finalReportTitle}", "{copy.finalReport}", "<OnboardingSupport footer final", "{copy.finalReassurance}"].map(text => stage.indexOf(text));
  assert.ok(positions.every(position => position >= 0));
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
  assert.doesNotMatch(stage, /Open my dashboard|Back to forwarding|checkbox/);
});

test("editing uses owner authentication and the same content-only endpoint", () => {
  assert.match(editor, /\/api\/customer\/dashboard\/business-details/);
  assert.match(editor, /request-code/);
  assert.match(editor, /verify-code/);
  assert.match(editor, /expectedRevision/);
  assert.match(editor, /pendingSave/);
  assert.doesNotMatch(editor, /signup-complete|\/assistant\b|\/incoming-phone-numbers/);
  assert.match(copy.testScope, /forwarding only/);
});

test("dashboard setup access remains independent of practice-test success", () => {
  assert.match(dashboard, /aiNumber \? <ForwardingSetupGuide/);
  assert.doesNotMatch(dashboard, /aiNumber && agentTesting\.passed \? <ForwardingSetupGuide/);
});
