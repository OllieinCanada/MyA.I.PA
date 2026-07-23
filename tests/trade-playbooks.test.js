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
