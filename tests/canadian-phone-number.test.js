const test = require("node:test");
const assert = require("node:assert/strict");
const {
  inspectCanadianNumber,
  requireCanadianNumber,
  validateProvisionedCanadianNumber,
} = require("../server/canadianPhoneNumber");

test("Canadian provisioning accepts Ontario numbers and canonicalizes E.164", () => {
  assert.deepEqual(inspectCanadianNumber("(249) 503-3301"), {
    valid: true,
    e164: "+12495033301",
    areaCode: "249",
    country: "CA",
  });
  assert.equal(requireCanadianNumber("905-555-1234"), "+19055551234");
});

test("Puerto Rico 787 inventory is never accepted as Canadian", () => {
  assert.equal(inspectCanadianNumber("+1 (787) 398-6370").valid, false);
  assert.throws(() => requireCanadianNumber("+17873986370"), /valid Canadian/i);
});

test("a provisioned number must retain voice, SMS, and expected routing", () => {
  const record = {
    phone_number: "+12495033301",
    voice_url: "https://hook.us2.make.com/voice",
    capabilities: { voice: true, sms: true },
  };
  assert.equal(validateProvisionedCanadianNumber(record, { expectedVoiceUrl: record.voice_url }), "+12495033301");
  assert.throws(
    () => validateProvisionedCanadianNumber({ ...record, capabilities: { voice: false, sms: true } }),
    /not ready/i,
  );
  assert.throws(
    () => validateProvisionedCanadianNumber(record, { expectedVoiceUrl: "https://hook.us2.make.com/other" }),
    /not ready/i,
  );
});
