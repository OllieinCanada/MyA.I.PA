const assert = require("node:assert/strict");
const { buildSignupAssistantConfig } = require("../server/signupAssistantTemplate");
const { buildSignupConfirmationSummary, isExplicitDemoSmsRequest } = require("../server/signupVoiceQuality");

const scenarios = [
  {
    name: "Personal chatbots signup",
    payload: {
      business: { name: "Personal Chatbots", services: "Personal chatbot setup and support" },
      owner: { phone: "+19057885488" },
      aiAssistant: { businessType: "Personal chatbots", serviceArea: "Niagara and Hamilton" },
    },
    forbidden: /new installation, a repair, maintenance|dollars per hour/i,
  },
  {
    name: "Electrical contractor signup",
    payload: {
      business: { name: "Tim's Electrical", services: "Electrical installation and repair" },
      owner: { phone: "+19057885488" },
      aiAssistant: { businessType: "Electrical contractor", serviceArea: "Hamilton" },
      pricing: { freeEstimateAnswer: "yes", repairVisitFee: "89", repairHourlyRate: "129" },
    },
    required: /new installation, a repair, maintenance/i,
  },
];

const results = scenarios.map((scenario) => {
  const config = buildSignupAssistantConfig(scenario.payload, { assignedPhone: "+12892780752" });
  const prompt = config.model.messages[0].content;
  if (scenario.forbidden) assert.doesNotMatch(prompt, scenario.forbidden);
  if (scenario.required) assert.match(prompt, scenario.required);
  assert.ok(config.model.toolIds.includes("1bf11961-f731-43b7-9f97-d765acdb51cd"));
  assert.match(prompt, /L, three, M — four, E, seven/);
  assert.match(prompt, /call endCall/i);
  return { scenario: scenario.name, assistantPlaybook: scenario.forbidden ? "general" : "contractor", passed: true };
});

const readback = buildSignupConfirmationSummary({
  ownerName: "Ollie Example", ownerEmail: "ollie@example.ca", ownerPhone: "+19057885488",
  businessName: "Personal Chatbots", businessPhone: "+19057885488", streetAddress: "27 Mud Street",
  city: "Grimsby", province: "ON", postalCode: "L3M4E7", businessType: "Personal chatbots",
  serviceArea: "Niagara and Hamilton", services: "Personal chatbot setup and support",
});
assert.doesNotMatch(readback, /meter|metre|millimeter/i);
assert.equal(isExplicitDemoSmsRequest("yes"), false);
assert.equal(isExplicitDemoSmsRequest("please text the demo link to me"), true);

console.log(JSON.stringify({ ok: true, mode: "offline-safe", scenarios: results, readback, guardedDemoSms: true }, null, 2));
