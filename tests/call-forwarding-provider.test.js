const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  encodeDialStringToTelUri,
  normalizeCarrier,
  normalizeLineType,
  resolveForwardingRule,
} = require("../server/callForwardingProvider");

test("selects the official Rogers mobile no-answer rule and encodes service characters", () => {
  const rule = resolveForwardingRule({ carrier: "rogers", lineType: "cell phone", destination: "+1 (289) 555-0123" });
  assert.equal(rule.key, "rogers-mobile-no-answer-v1");
  assert.equal(rule.activationDialString, "*61*2895550123#");
  assert.equal(rule.activationTelUri, "tel:*61*2895550123%23");
  assert.equal(rule.deactivationTelUri, "tel:%23%2361%23");
  assert.equal(rule.forwardingType, "NO_ANSWER");
  assert.equal(rule.supported, true);
});

test("selects separate Rogers Home Phone and Bell business rules", () => {
  const rogers = resolveForwardingRule({ carrier: "ROGERS", lineType: "LANDLINE", destination: "+19055550123" });
  const bell = resolveForwardingRule({ carrier: "Bell", lineType: "business phone", destination: "+19055550123" });
  assert.equal(rogers.activationDialString, "*92");
  assert.match(rogers.source, /rogers\.com/);
  assert.equal(bell.key, "bell-business-no-answer-v1");
  assert.match(bell.warnings.join(" "), /Bell Mobility/);
});

test("never guesses for TELUS, Bell mobile, VoIP, other, or unknown combinations", () => {
  for (const [carrier, lineType] of [["telus", "mobile"], ["bell", "mobile"], ["rogers", "voip"], ["other", "landline"], ["not_sure", "not_sure"]]) {
    const rule = resolveForwardingRule({ carrier, lineType, destination: "+19055550123" });
    assert.equal(rule.supported, false);
    assert.equal(rule.activationMethod, "MANUAL");
    assert.equal(rule.activationDialString, "");
    assert.match(rule.warnings.join(" "), /will not guess/i);
  }
});

test("normalizes signup choices and validates the forwarding destination", () => {
  assert.equal(normalizeCarrier("Not sure"), "NOT_SURE");
  assert.equal(normalizeLineType("cloud phone"), "VOIP");
  assert.equal(encodeDialStringToTelUri("##61#"), "tel:%23%2361%23");
  assert.throws(() => resolveForwardingRule({ carrier: "rogers", lineType: "mobile", destination: "123" }), /E\.164/);
});

test("carrier service codes remain centralized outside frontend components", () => {
  const sourceRoot = path.join(__dirname, "..", "src");
  const stack = [sourceRoot];
  const files = [];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(absolute);
      else if (/\.(js|jsx|ts|tsx)$/.test(entry.name)) files.push(absolute);
    }
  }
  const frontend = files.map((file) => fs.readFileSync(file, "utf8")).join("\n");
  assert.doesNotMatch(frontend, /\*61\*|\*92|\*93|##61/);
});
