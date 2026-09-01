const test = require("node:test");
const assert = require("node:assert/strict");

const { buildSignupAssistantConfig } = require("../server/signupAssistantTemplate");

const normalizedPayload = {
  businessProfile: {
    businessName: "Example Electric",
  },
  setupDetails: {
    businessType: "Electrical contractor",
    serviceArea: "Hamilton and Burlington",
    ownerPhone: "+19055550199",
  },
  pricing: {
    freeEstimateAnswer: "yes we do",
    repairVisitFee: "89",
    repairHourlyRate: "129",
  },
  freeEstimateAnswer: "legacy yes",
  repairVisitFee: "79",
  repairHourlyRate: "119",
};

test("builds the current production Vapi assistant with resolved signup values", () => {
  const config = buildSignupAssistantConfig(normalizedPayload, {
    assignedPhone: "+12895550123",
  });
  const prompt = config.model.messages[0].content;

  assert.equal(config.name, "My AI PA Agent");
  assert.equal(config.firstMessage, "Hi, thanks for calling Example Electric. How are you today?");
  assert.equal(config.model.provider, "openai");
  assert.equal(config.model.model, "gpt-4o");
  assert.equal(config.model.temperature, 0.1);
  assert.deepEqual(config.model.toolIds, [
    "baf9269b-6f71-4694-aaec-859209fb77a5",
    "a2b67aee-f59e-4056-bff5-bf60dbc97ab0",
    "1bf11961-f731-43b7-9f97-d765acdb51cd",
  ]);
  assert.deepEqual(config.voice, {
    provider: "vapi",
    voiceId: "Jess",
    version: 2,
  });
  assert.deepEqual(config.transcriber, {
    provider: "deepgram",
    model: "nova-3",
    language: "en",
    numerals: false,
    endpointing: 450,
  });
  assert.match(prompt, /Business name: Example Electric/);
  assert.match(prompt, /Business type: Electrical contractor/);
  assert.match(prompt, /Service area: Hamilton and Burlington/);
  assert.match(prompt, /Signup installation estimate answer: yes we do/);
  assert.match(prompt, /Signup repair visit fee: 89 dollars/);
  assert.match(prompt, /Signup repair hourly rate: 129 dollars per hour/);
  assert.match(prompt, /Legacy fallback repair visit fee: 79 dollars/);
  assert.match(prompt, /Assigned AI\/Twilio sender number: \+12895550123/);
  assert.match(prompt, /Owner notification number: \+19055550199/);
  assert.match(prompt, /send_customer_sms_dynamic/);
  assert.match(prompt, /send_owner_sms_dynamic/);
  assert.match(prompt, /endCall/);
  assert.doesNotMatch(JSON.stringify(config), /\{\{[^}]*\}\}/);
});

test("uses a caller-supplied resource name without changing the voice stack", () => {
  const config = buildSignupAssistantConfig(normalizedPayload, {
    assignedPhone: "+12895550123",
    resourceName: "signup-42-example-electric",
  });

  assert.equal(config.name, "signup-42-example-electric");
  assert.equal(config.model.model, "gpt-4o");
  assert.equal(config.voice.voiceId, "Jess");
  assert.equal(config.transcriber.model, "nova-3");
});

test("accepts the canonical business, owner, and aiAssistant payload shape", () => {
  const config = buildSignupAssistantConfig({
    business: { name: "Canonical Electric" },
    owner: { phone: "+14165550144" },
    aiAssistant: {
      businessType: "Electrician",
      serviceArea: "Toronto",
    },
    pricing: {},
  }, {
    assignedPhone: "+16475550155",
  });

  assert.match(config.firstMessage, /Canonical Electric/);
  assert.match(config.model.messages[0].content, /Owner notification number: \+14165550144/);
  assert.doesNotMatch(config.model.messages[0].content, /:\s+dollars/);
  assert.doesNotMatch(JSON.stringify(config), /\{\{[^}]*\}\}/);
});

test("uses a general intake playbook for non-contractor businesses", () => {
  const config = buildSignupAssistantConfig({
    business: { name: "Personal Chatbots", services: "Personal chatbot setup and support" },
    owner: { phone: "+19057885488" },
    aiAssistant: { businessType: "Personal chatbots", serviceArea: "Niagara and Hamilton" },
  }, { assignedPhone: "+12892780752" });
  const prompt = config.model.messages[0].content;

  assert.match(prompt, /how you can help/i);
  assert.match(prompt, /Personal chatbot setup and support/);
  assert.doesNotMatch(prompt, /new installation, a repair, maintenance/i);
  assert.doesNotMatch(prompt, /repair visit fee|dollars per hour/i);
  assert.match(prompt, /call endCall/i);
});

test("rejects missing required runtime values", () => {
  const cases = [
    [{ ...normalizedPayload, businessProfile: {} }, { assignedPhone: "+12895550123" }, "businessProfile.businessName"],
    [{ ...normalizedPayload, setupDetails: { ...normalizedPayload.setupDetails, businessType: "" } }, { assignedPhone: "+12895550123" }, "setupDetails.businessType"],
    [{ ...normalizedPayload, setupDetails: { ...normalizedPayload.setupDetails, serviceArea: "" } }, { assignedPhone: "+12895550123" }, "setupDetails.serviceArea"],
    [{ ...normalizedPayload, setupDetails: { ...normalizedPayload.setupDetails, ownerPhone: "" } }, { assignedPhone: "+12895550123" }, "setupDetails.ownerPhone"],
    [normalizedPayload, {}, "assignedPhone"],
  ];

  for (const [payload, options, field] of cases) {
    assert.throws(
      () => buildSignupAssistantConfig(payload, options),
      (error) => error.code === "SIGNUP_ASSISTANT_CONFIG_INVALID" && error.field === field
    );
  }
});

test("rejects unresolved template syntax supplied as business data", () => {
  assert.throws(
    () => buildSignupAssistantConfig({
      ...normalizedPayload,
      businessProfile: { businessName: "{{21.businessProfile.businessName}}" },
    }, {
      assignedPhone: "+12895550123",
    }),
    (error) => error.code === "SIGNUP_ASSISTANT_CONFIG_INVALID"
      && error.field === "businessProfile.businessName"
  );
});
