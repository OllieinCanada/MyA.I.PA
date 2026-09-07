const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "..", "src", "ForwardingSetup.js"), "utf8");
const dashboard = fs.readFileSync(path.join(__dirname, "..", "src", "CustomerDashboard.js"), "utf8");

test("forwarding screen includes every customer-visible state and recovery action", () => {
  for (const text of [
    "carrier_needed", "verification_pending", "active", "verification_failed", "manual_setup_required",
    "Protect My Missed Calls", "Test My Setup", "Test Again", "Change Setup", "Turn off / view disable instructions",
    "We didn’t receive the forwarded call yet", "Choose Different Carrier or Phone Type",
  ]) assert.match(source, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
});

test("the UI explains the carrier boundary and never claims silent browser activation", () => {
  assert.match(source, /carrier completes the change|Press Call or Send/i);
  assert.match(source, /will not guess one/i);
  assert.doesNotMatch(source, /automatically enables forwarding|silent(?:ly)? activate/i);
});

test("supported mobile setup arms an automatic verification test on return", () => {
  assert.match(source, /myaipa-forwarding-auto-test/);
  assert.match(source, /visibilitychange/);
  assert.match(source, /We’ll test it automatically/);
  assert.match(source, /Test My Setup/);
});

test("verified customers can always find safe disable guidance", () => {
  assert.match(source, /Turn off \/ view disable instructions/);
  assert.match(source, /We will not guess a disable command/);
});

test("dashboard presents forwarding setup whenever an AI number exists", () => {
  assert.match(dashboard, /aiNumber \? <ForwardingSetupGuide/);
  assert.doesNotMatch(dashboard, /aiNumber && agentTesting\.passed \? <ForwardingSetupGuide/);
});
