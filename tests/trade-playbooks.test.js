const test = require("node:test");
const assert = require("node:assert/strict");
const { buildTradePlaybookPrompt, getTradePlaybook } = require("../server/tradePlaybooks");

test("electrician playbook contains safety, truth, scope, and structured intake rules", () => {
  const playbook = getTradePlaybook("electrician-v1");
  const prompt = buildTradePlaybookPrompt(playbook);
  assert.equal(playbook.trade, "ELECTRICAL");
  assert.match(prompt, /water contacting energized electrical equipment/i);
  assert.match(prompt, /VERIFIED TRUTH POLICY/);
  assert.match(prompt, /EV charger/i);
  assert.match(prompt, /Do not claim a text, booking, transfer, or dispatch succeeded/i);
});

test("an information question gets an answer without turning into a multi-question form", () => {
  const playbook = getTradePlaybook('electrician-v1');
  const prompt = buildTradePlaybookPrompt(playbook);
  assert.equal(playbook.version, '1.0.3');
  assert.match(prompt, /briefly explain the relevant details needed for their request, then ask exactly one missing field and wait/);
  assert.match(prompt, /answer briefly before asking the next missing field as one question/);
  assert.match(prompt, /Reuse details already given/);
  assert.match(prompt, /never request a list of contact, address, project, and timing fields in one message/);
  assert.doesNotMatch(prompt, /do not explain or list the intake fields|do not describe the intake checklist/);
  assert.match(prompt, /Confirm the request summary before any irreversible notification or booking action/);
  assert.match(prompt, /Do not claim a text, booking, transfer, or dispatch succeeded until the tool result confirms it/);
});
