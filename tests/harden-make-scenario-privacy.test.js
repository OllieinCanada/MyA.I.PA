const test = require("node:test");
const assert = require("node:assert/strict");

const {
  immutableFingerprint,
  parseScenarioIds,
  scenarioBlueprint,
  withConfidentialHistory,
} = require("../scripts/harden-make-scenario-privacy");

test("enables confidential execution history without changing scenario flow", () => {
  const before = {
    flow: [{ id: 1, module: "gateway:Webhook", mapper: { value: "private" } }],
    metadata: { scenario: { confidential: false, sequential: false }, version: 3 },
  };
  const after = withConfidentialHistory(before);
  assert.equal(after.metadata.scenario.confidential, true);
  assert.equal(immutableFingerprint(after), immutableFingerprint(before));
  assert.equal(before.metadata.scenario.confidential, false);
});

test("reads wrapped Make blueprints and rejects malformed responses", () => {
  const blueprint = { flow: [], metadata: {} };
  assert.equal(scenarioBlueprint({ response: { blueprint } }), blueprint);
  assert.throws(() => scenarioBlueprint({ blueprint: {} }), /valid scenario blueprint/i);
});

test("scenario selection is explicit, numeric, and deduplicated", () => {
  assert.deepEqual(parseScenarioIds(["--scenarios=4482406,3559448,4482406"]), ["4482406", "3559448"]);
  assert.throws(() => parseScenarioIds([]), /numeric Make scenario IDs/i);
  assert.throws(() => parseScenarioIds(["--scenarios=4482406,bad"]), /numeric Make scenario IDs/i);
});
