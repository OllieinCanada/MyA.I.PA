const crypto = require("crypto");

const { buildSignupAssistantConfig } = require("./signupAssistantTemplate");

function clean(value) {
  return String(value ?? "").replace(/\r\n/g, "\n").trim();
}

function normalizePhone(value) {
  const raw = clean(value);
  const digits = raw.replace(/\D/g, "");
  const normalized = raw.startsWith("+") ? `+${digits}` : digits.length === 10 ? `+1${digits}` : `+${digits}`;
  return /^\+[1-9]\d{7,14}$/.test(normalized) ? normalized : "";
}

function buildNormalizedPayloadFromSignupRecord(signup = {}) {
  const ownerPhone = normalizePhone(signup.ownerPhone || signup.businessPhone);
  const services = clean(signup.serviceSummary || signup.services);
  const serviceArea = clean(signup.serviceArea);
  return {
    businessProfile: {
      businessName: clean(signup.businessName),
      services,
    },
    owner: {
      phone: ownerPhone,
    },
    setupDetails: {
      businessType: clean(signup.businessType || signup.trade),
      serviceArea,
      services,
      ownerPhone,
      freeEstimateAnswer: clean(signup.freeEstimateAnswer || signup.installationFreeEstimateAnswer),
      offersServiceCalls: typeof signup.offersServiceCalls === "boolean" ? signup.offersServiceCalls : undefined,
      repairVisitFee: clean(signup.repairVisitFee),
      repairHourlyRate: clean(signup.repairHourlyRate),
    },
    pricing: {
      freeEstimateAnswer: clean(signup.freeEstimateAnswer || signup.installationFreeEstimateAnswer),
      offersServiceCalls: typeof signup.offersServiceCalls === "boolean" ? signup.offersServiceCalls : undefined,
      repairVisitFee: clean(signup.repairVisitFee),
      repairHourlyRate: clean(signup.repairHourlyRate),
      pricingScript: clean(signup.pricingScript),
    },
    specializations: Array.isArray(signup.specializations) ? signup.specializations : [],
    businessName: clean(signup.businessName),
    businessType: clean(signup.businessType || signup.trade),
    serviceArea,
    services,
    ownerPhone,
  };
}

function getSystemPrompt(assistant = {}) {
  const messages = Array.isArray(assistant?.model?.messages) ? assistant.model.messages : [];
  const prompt = clean(messages.find((message) => message?.role === "system")?.content);
  return prompt
    .replace(/\n+## MYAIPA ISOLATED SMS ROUTING[\s\S]*$/i, "")
    .replace(/\n+## MYAIPA PILOT SMS ROUTING[\s\S]*$/i, "")
    .trim();
}

function canonicalAssistantContent(assistant = {}) {
  return {
    name: clean(assistant.name),
    firstMessage: clean(assistant.firstMessage),
    systemPrompt: getSystemPrompt(assistant),
    model: {
      provider: clean(assistant?.model?.provider),
      model: clean(assistant?.model?.model),
      temperature: Number(assistant?.model?.temperature ?? 0),
    },
    voice: {
      provider: clean(assistant?.voice?.provider),
      voiceId: clean(assistant?.voice?.voiceId),
      version: Number(assistant?.voice?.version ?? 0),
    },
  };
}

function fingerprintAssistantContent(assistant = {}) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalAssistantContent(assistant))).digest("hex");
}

function assessSignupAssistantContent({ expectedConfig, liveAssistant } = {}) {
  const expectedFingerprint = fingerprintAssistantContent(expectedConfig);
  const liveFingerprint = fingerprintAssistantContent(liveAssistant);
  return {
    passed: expectedFingerprint === liveFingerprint,
    expectedFingerprint,
    liveFingerprint,
    expected: canonicalAssistantContent(expectedConfig),
    live: canonicalAssistantContent(liveAssistant),
  };
}

function buildExpectedSignupAssistantConfig(signup, { assignedPhone, resourceName } = {}) {
  return buildSignupAssistantConfig(buildNormalizedPayloadFromSignupRecord(signup), {
    assignedPhone: normalizePhone(assignedPhone || signup?.twilioPhoneNumber),
    resourceName: clean(resourceName || signup?.assistantName || "My AI PA Agent"),
  });
}

module.exports = {
  assessSignupAssistantContent,
  buildExpectedSignupAssistantConfig,
  buildNormalizedPayloadFromSignupRecord,
  canonicalAssistantContent,
  fingerprintAssistantContent,
  getSystemPrompt,
};
