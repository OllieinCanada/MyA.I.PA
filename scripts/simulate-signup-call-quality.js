const assert = require("node:assert/strict");
const { buildSignupAssistantConfig } = require("../server/signupAssistantTemplate");
const { buildSignupConfirmationSummary, isExplicitDemoSmsRequest } = require("../server/signupVoiceQuality");

const scenarios = [
  {
    name: "Invented studio signup",
    payload: {
      business: { name: "Invented Studio", services: "Portrait photography" },
      owner: { phone: "+19055550199" },
      aiAssistant: { businessType: "Photography studio", serviceArea: "Fixture Town" },
    },
    forbidden: /Are you looking for a new installation, service, or repair today\?|dollars per hour/i,
  },
  {
    name: "Electrical contractor signup",
    payload: {
      business: { name: "Invented Electric", services: "Electrical installation and repair" },
      owner: { phone: "+19055550199" },
      aiAssistant: { businessType: "Electrical contractor", serviceArea: "Fixture Town" },
      pricing: { freeEstimateAnswer: "yes", repairVisitFee: "89", repairHourlyRate: "129" },
    },
    required: /Only if the caller's request type is still unclear, briefly acknowledge what they said, then ask: "We handle local electrical work/,
  },
];

const results = scenarios.map((scenario) => {
  const config = buildSignupAssistantConfig(scenario.payload, { assignedPhone: "+12895550123" });
  const prompt = config.model.messages[0].content;
  if (scenario.forbidden) assert.doesNotMatch(prompt, scenario.forbidden);
  if (scenario.required) assert.match(prompt, scenario.required);
  assert.ok(config.model.toolIds.includes("1bf11961-f731-43b7-9f97-d765acdb51cd"));
  assert.match(prompt, /L, three, M — four, E, seven/);
  assert.match(prompt, /Finish with "Thank you for calling\. Goodbye\." before invoking endCall/);
  assert.match(prompt, /Acknowledge every opening request, substantive answer and correction/);
  assert.match(prompt, /Ask only the next missing or genuinely unclear field/);
  assert.doesNotMatch(prompt, /After the recording notice, say exactly:|Only then say exactly:/);
  return { scenario: scenario.name, assistantPlaybook: scenario.forbidden ? "general" : "contractor", passed: true };
});

const readback = buildSignupConfirmationSummary({
  ownerName: "Fixture Owner", ownerEmail: "owner@example.test", ownerPhone: "+19055550199",
  businessName: "Invented Studio", businessPhone: "+19055550199", streetAddress: "12 Fixture Lane",
  city: "Fixture Town", province: "ON", postalCode: "L3M4E7", businessType: "Photography studio",
  serviceArea: "Fixture Town", services: "Portrait photography",
});
assert.doesNotMatch(readback, /meter|metre|millimeter/i);
assert.equal(isExplicitDemoSmsRequest("yes"), false);
assert.equal(isExplicitDemoSmsRequest("please text the demo link to me"), true);

console.log(JSON.stringify({ ok: true, mode: "offline-safe", evidenceScope: "Generated prompt and summary contracts only; no model, audio or provider execution.", scenarios: results, readback, guardedDemoSms: true }, null, 2));
