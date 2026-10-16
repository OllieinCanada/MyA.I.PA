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
  assert.equal(rule.timing.exactThreeRingsSupported, false);
  assert.match(rule.timing.customerCopy, /does not publish a fixed ring count/i);
});

test("selects separate Rogers Home Phone and Bell business rules", () => {
  const rogers = resolveForwardingRule({ carrier: "ROGERS", lineType: "LANDLINE", destination: "+19055550123" });
  const bell = resolveForwardingRule({ carrier: "Bell", lineType: "business phone", destination: "+19055550123" });
  assert.equal(rogers.activationDialString, "*92");
  assert.match(rogers.source, /rogers\.com/);
  assert.match(rogers.timing.customerCopy, /four rings/i);
  assert.equal(bell.key, "bell-business-no-answer-v1");
  assert.match(bell.warnings.join(" "), /Bell Mobility/);
  assert.match(bell.timing.adjustmentCopy, /will not guess/i);
});

test("builds Bell's documented mobile no-answer command with the closest practical three-ring delay", () => {
  const bell = resolveForwardingRule({ carrier: "bell", lineType: "mobile", destination: "+19055550123" });
  assert.equal(bell.key, "bell-mobile-no-answer-15-seconds-v1");
  assert.equal(bell.activationMethod, "DIAL_STRING");
  assert.equal(bell.activationDialString, "*61*9055550123*11*15#");
  assert.equal(bell.activationTelUri, "tel:*61*9055550123*11*15%23");
  assert.equal(bell.supported, true);
  assert.equal(bell.timing.exactThreeRingsSupported, false);
  assert.match(bell.timing.customerCopy, /15 seconds/i);
  assert.match(bell.timing.customerCopy, /about three rings/i);
  assert.match(bell.source, /bell\.ca/i);
});

test("TELUS and Rogers share verified activation but retain their different disable instructions", () => {
  const telus = resolveForwardingRule({ carrier: "telus", lineType: "mobile", destination: "+19055550123" });
  const rogers = resolveForwardingRule({ carrier: "rogers", lineType: "mobile", destination: "+19055550123" });
  assert.equal(telus.activationMethod, "DIAL_STRING");
  assert.equal(telus.activationDialString, rogers.activationDialString);
  assert.equal(telus.deactivationDialString, "#61#");
  assert.equal(rogers.deactivationDialString, "##61#");
  assert.equal(telus.timing.exactThreeRingsSupported, false);
  assert.match(telus.humanInstructions.join(" "), /test/i);
  assert.match(telus.source, /telus\.com/i);
});

test("never guesses for VoIP, other, or unknown combinations", () => {
  for (const [carrier, lineType] of [["telus", "landline"], ["rogers", "voip"], ["other", "landline"], ["not_sure", "not_sure"]]) {
    const rule = resolveForwardingRule({ carrier, lineType, destination: "+19055550123" });
    assert.equal(rule.supported, false);
    assert.equal(rule.activationMethod, "MANUAL");
    assert.equal(rule.activationDialString, "");
    assert.match(rule.warnings.join(" "), /will not guess/i);
  }
});

test('unknown mobile uses conditional phone settings, never a universal dial command',()=>{
 const rule=resolveForwardingRule({carrier:'not_sure',lineType:'mobile',destination:'+19055550123'});
 assert.equal(rule.activationDialString,'');assert.equal(rule.activationTelUri,'');assert.equal(rule.supported,false);
 assert.match(rule.humanInstructions.join(' '),/Always forward turned off/);
 assert.match(rule.humanInstructions.join(' '),/choose your provider/);
 assert.match(rule.humanInstructions.join(' '),/9055550123/);
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
