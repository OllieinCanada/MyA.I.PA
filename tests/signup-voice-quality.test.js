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
  assert.equal(spoken, "letter L, number three, letter M — number four, letter E, number seven");
  assert.doesNotMatch(spoken, /meter|metre|millimeter/i);
});

test("verbalizes email and phone fields deterministically", () => {
  assert.equal(formatEmailForSpeech("ollie.test+pilot@example.ca"), "o, l, l, i, e, dot, t, e, s, t, plus, p, i, l, o, t, at example dot ca");
  assert.equal(formatPhoneForSpeech("+1 (905) 788-5488"), "nine, zero, five, seven, eight, eight, five, four, eight, eight");
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
  assert.match(summary, /letter L, number three, letter M — number four, letter E, number seven/);
});

test("recreates the latest failure shape with synthetic fields and no invented or duplicated text", () => {
  const summary = buildSignupConfirmationSummary({
    ownerName: "Example Dave",
    ownerEmail: "exampledave99@example.com",
    ownerPhone: "9055557422",
    businessName: "Example Dave's Electrical",
    businessPhone: "9055557422",
    streetAddress: "42 Example Street",
    city: "Mississauga",
    province: "ON",
    postalCode: "L2S3P5",
    businessType: "Electrical",
    serviceArea: "Mississauga",
    services: "new installations, upgrades, troubleshooting",
  });
  assert.equal(summary, "Owner: Example Dave. Email: e, x, a, m, p, l, e, d, a, v, e, nine, nine, at example dot com. Owner mobile: nine, zero, five, five, five, five, seven, four, two, two. Business: Example Dave's Electrical. Business phone: nine, zero, five, five, five, five, seven, four, two, two. Address: 42 Example Street, Mississauga, ON, letter L, number two, letter S — number three, letter P, number five. Business type: Electrical. Service area: Mississauga. Main services: new installations, upgrades, troubleshooting.");
  assert.doesNotMatch(summary, /Lutchley|Indemir|metre|meter|millimetre|millimeter/i);
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
