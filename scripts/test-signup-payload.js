const { loadProjectEnv, rootPath } = require("./_helpers");
const fs = require("fs");

const env = loadProjectEnv();
const shouldPost = process.argv.includes("--post");
const reviewOnly = process.argv.includes("--review-only");
const outputPathIndex = process.argv.indexOf("--out");
const outputPath = outputPathIndex >= 0 ? process.argv[outputPathIndex + 1] : "";
const argValue = (name, fallback = "") => {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
};
const sandboxSuffix = Date.now();
const sampleBusinessName = argValue(
  "business-name",
  reviewOnly ? `My AI PA Sandbox Verification ${sandboxSuffix}` : "Sample Electrical Services"
);
const sampleBusinessPhone = argValue("business-phone", reviewOnly ? "19055550199" : "2495033301");
const sampleOwnerPhone = argValue("owner-phone", reviewOnly ? "19055550198" : sampleBusinessPhone);
const sampleOwnerEmail = argValue(
  "owner-email",
  reviewOnly ? `myaipa-sandbox-${sandboxSuffix}@mailinator.com` : "owner@example.com"
);
const defaultApiBase = "https://api.myaipa.ca";
const signupApiPath = "/api/integrations/signup-complete";
const configuredSignupEndpoint = env.MAKE_SIGNUP_WEBHOOK_URL || env.REACT_APP_MAKE_SIGNUP_WEBHOOK_URL || "";
const configuredApiBase = env.REACT_APP_API_BASE_URL || env.API_BASE_URL || defaultApiBase;
const endpoint = configuredSignupEndpoint || (
  /^https:\/\/hook\.[^/]+\.make\.com\//.test(configuredApiBase)
    ? configuredApiBase.replace(/\/+$/, "")
    : `${configuredApiBase.replace(/\/+$/, "")}${signupApiPath}`
);
const makeApiKey = env.MAKE_SIGNUP_WEBHOOK_API_KEY || env.REACT_APP_MAKE_SIGNUP_WEBHOOK_API_KEY || "";

const payload = {
  country: "ca",
  businessName: sampleBusinessName,
  ownerName: "Oliver Slapinski",
  ownerEmail: sampleOwnerEmail,
  email: sampleOwnerEmail,
  businessPhone: sampleBusinessPhone,
  phone: sampleBusinessPhone,
  businessAddress: "277 Mud St E, Toronto, ON, L3M 4E7",
  streetAddress: "277 Mud St E",
  city: "Toronto",
  province: "ON",
  postalCode: "L3M 4E7",
  businessType: "Electrical",
  serviceArea: "Niagara Falls, Welland, Brampton",
  specializations: ["Residential", "Commercial", "Industrial", "Agricultural", "Specialty"],
  specializationList: "Residential, Commercial, Industrial, Agricultural, Specialty",
  specialityList: "Residential, Commercial, Industrial, Agricultural, Specialty",
  specialtyList: "Residential, Commercial, Industrial, Agricultural, Specialty",
  pricing: {
    installationFreeEstimate: true,
    freeEstimateAnswer: "yes we do",
    repairVisitFee: "100",
    repairHourlyRate: "100",
    repairVisitFeeText: "100 dollars",
    repairHourlyRateText: "100 dollars per hour",
    pricingScript:
      "Installations: Ask, \"Would you like us to come down and give you a free estimate?\"\nRepairs or maintenance: 100 dollars to come out and 100 dollars per hour after that.\nAsk, \"Would you like to continue?\"",
  },
  installationFreeEstimate: true,
  freeEstimateAnswer: "yes we do",
  repairVisitFee: "100",
  repairHourlyRate: "100",
  pricingScript:
    "Installations: Ask, \"Would you like us to come down and give you a free estimate?\"\nRepairs or maintenance: 100 dollars to come out and 100 dollars per hour after that.\nAsk, \"Would you like to continue?\"",
  selectedPlace: null,
  businessProfile: {
    businessName: sampleBusinessName,
    phone: sampleBusinessPhone,
    address: "277 Mud St E, Toronto, ON, L3M 4E7",
    streetAddress: "277 Mud St E",
    city: "Toronto",
    province: "ON",
    postalCode: "L3M 4E7",
    website: "",
    hours: "Monday-Friday 9:00 AM-5:00 PM",
    services: "Panel upgrades\nBreaker issues\nLighting installs\nEV charger installs\nEmergency electrical service",
  },
  setupDetails: {
    ownerName: "Oliver Slapinski",
    ownerEmail: sampleOwnerEmail,
    ownerPhone: sampleOwnerPhone,
    businessAddress: "277 Mud St E, Toronto, ON, L3M 4E7",
    streetAddress: "277 Mud St E",
    city: "Toronto",
    province: "ON",
    postalCode: "L3M 4E7",
    businessType: "Electrical",
    serviceArea: "Niagara Falls, Welland, Brampton",
    callForwardingNumber: sampleBusinessPhone,
    bookingPreference: "Text owner first",
    notificationPreference: "SMS",
    aiTone: "Professional",
    assistantVoice: "elliot",
    assistantVoiceLabel: "My AI PA Agent",
    openingDialogue: "Hi, thanks for calling. How can I help you today?",
    specializations: ["Residential", "Commercial", "Industrial", "Agricultural", "Specialty"],
    specializationList: "Residential, Commercial, Industrial, Agricultural, Specialty",
    specialityList: "Residential, Commercial, Industrial, Agricultural, Specialty",
    specialtyList: "Residential, Commercial, Industrial, Agricultural, Specialty",
    specializationNotes: "",
    pricing: {
      installationFreeEstimate: true,
      freeEstimateAnswer: "yes we do",
      repairVisitFee: "100",
      repairHourlyRate: "100",
      repairVisitFeeText: "100 dollars",
      repairHourlyRateText: "100 dollars per hour",
      pricingScript:
        "Installations: Ask, \"Would you like us to come down and give you a free estimate?\"\nRepairs or maintenance: 100 dollars to come out and 100 dollars per hour after that.\nAsk, \"Would you like to continue?\"",
    },
    installationFreeEstimate: true,
    freeEstimateAnswer: "yes we do",
    repairVisitFee: "100",
    repairHourlyRate: "100",
    pricingScript:
      "Installations: Ask, \"Would you like us to come down and give you a free estimate?\"\nRepairs or maintenance: 100 dollars to come out and 100 dollars per hour after that.\nAsk, \"Would you like to continue?\"",
    faq: "Do you offer emergency electrical service?\nDo you handle panel upgrades?\nCan you install EV chargers?\nDo you provide estimates?",
    greetingScript: "Hi, thanks for calling. How can I help you today?",
    emergencyAfterHoursAvailable: true,
    emergencyRules: "Escalate urgent safety or service requests to the owner.",
  },
  security: {
    companyWebsite: "",
    clientElapsedMs: 12000,
    captchaProvider: "",
    captchaToken: "",
    recaptchaToken: "",
    turnstileToken: "",
    timezone: "America/Toronto",
    pageUrl: "https://www.myaipa.ca/#/signup",
  },
};

const json = JSON.stringify(payload, null, 2);

if (outputPath) {
  const finalPath = rootPath(outputPath);
  fs.writeFileSync(finalPath, json);
  console.log(`Wrote sample payload to ${finalPath}`);
} else {
  console.log(json);
}

if (shouldPost) {
  fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(makeApiKey ? { "x-make-apikey": makeApiKey } : {}),
    },
    body: JSON.stringify(payload),
  })
    .then(async (response) => {
      const text = await response.text();
      console.log(`POST ${response.status} ${response.statusText}`);
      console.log(text || "(empty response)");
      if (!response.ok) {
        process.exitCode = 1;
        return;
      }
      if (reviewOnly) {
        let result = {};
        try {
          result = text ? JSON.parse(text) : {};
        } catch {
          throw new Error("Sandbox response was not valid JSON.");
        }
        const externalResourceCreated = Boolean(
          result.twilioPhoneNumber
          || result.stripeCustomerId
          || result.subscriptionId
          || result.vapiAssistantId
        );
        if (response.status !== 202 || result.reviewRequired !== true || externalResourceCreated) {
          throw new Error("Sandbox safety assertion failed: expected review-only response with no external resources.");
        }
        console.log("Sandbox safety verified: complete signup stored for review; no Twilio, Stripe, or Vapi resource was created.");
      }
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
