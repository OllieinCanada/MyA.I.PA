const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildSignupConfirmationSummary,
  classifySignupAssistantPlaybook,
  formatCanadianPostalCodeForSpeech,
  formatEmailForSpeech,
  formatPhoneForSpeech,
  isExplicitDemoSmsRequest,
} = require("../server/signupVoiceQuality");

test("verbalizes Canadian postal codes without unit-word ambiguity", () => {
  const spoken = formatCanadianPostalCodeForSpeech("L3M 4E7");
  assert.equal(spoken, "L, 3, M — 4, E, 7");
  assert.doesNotMatch(spoken, /meter|metre|millimeter/i);
});

test("verbalizes email and phone fields deterministically", () => {
  assert.equal(formatEmailForSpeech("ollie.test+pilot@example.ca"), "ollie dot test + pilot at example dot ca");
  assert.equal(formatPhoneForSpeech("+1 (905) 788-5488"), "9, 0, 5, 7, 8, 8, 5, 4, 8, 8");
});

test("creates a fixed-order signup read-back with no duplicated labels", () => {
  const summary = buildSignupConfirmationSummary({
    ownerName: "Ollie Example", ownerEmail: "ollie@example.ca", ownerPhone: "+19057885488",
    businessName: "Personal Chatbots", businessPhone: "+19057885488", streetAddress: "27 Mud Street",
    city: "Grimsby", province: "ON", postalCode: "L3M4E7", businessType: "Personal chatbots",
    serviceArea: "Niagara and Hamilton", services: "Personal chatbot setup",
  });
  for (const label of ["Owner:", "Email:", "Owner mobile:", "Business:", "Business phone:", "Address:", "Business type:", "Service area:", "Main services:"]) {
    assert.equal(summary.split(label).length - 1, 1);
  }
  assert.match(summary, /L, 3, M — 4, E, 7/);
});

test("requires an explicit affirmative demo text request", () => {
  assert.equal(isExplicitDemoSmsRequest("Yes, text the demo details to my phone"), true);
  assert.equal(isExplicitDemoSmsRequest("Don't text me anything"), false);
  assert.equal(isExplicitDemoSmsRequest("sounds good"), false);
});

test("selects a safe general playbook for non-contractors", () => {
  assert.equal(classifySignupAssistantPlaybook({ businessType: "Personal chatbots", services: "Custom chat assistants" }), "general");
  assert.equal(classifySignupAssistantPlaybook({ businessType: "Electrical contractor" }), "contractor");
});
