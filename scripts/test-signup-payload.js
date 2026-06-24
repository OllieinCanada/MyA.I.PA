const { loadProjectEnv, rootPath } = require("./_helpers");
const fs = require("fs");

const env = loadProjectEnv();
const shouldPost = process.argv.includes("--post");
const outputPathIndex = process.argv.indexOf("--out");
const outputPath = outputPathIndex >= 0 ? process.argv[outputPathIndex + 1] : "";
const endpoint =
  env.REACT_APP_MAKE_SIGNUP_WEBHOOK_URL ||
  env.REACT_APP_API_BASE_URL ||
  "https://hook.us2.make.com/bg30xcgcluakdcf3u2jtw1h9186gbq7m";

const payload = {
  country: "ca",
  businessName: "Sample Electrical Services",
  ownerName: "Oliver Slapinski",
  ownerEmail: "owner@example.com",
  email: "owner@example.com",
  businessPhone: "2495033301",
  phone: "2495033301",
  businessAddress: "277 Mud St E, Toronto, ON, L3M 4E7",
  streetAddress: "277 Mud St E",
  city: "Toronto",
  province: "ON",
  postalCode: "L3M 4E7",
  businessType: "Electrical",
  serviceArea: "Niagara Falls, Welland, Brampton",
  pricingScript:
    "Installations: Ask, \"Would you like us to come down and give you a free estimate?\"\nRepairs or maintenance: 100 dollars to come out and 100 dollars per hour after that.\nAsk, \"Would you like to continue?\"",
  selectedPlace: null,
  businessProfile: {
    businessName: "Sample Electrical Services",
    phone: "2495033301",
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
    ownerEmail: "owner@example.com",
    ownerPhone: "2495033301",
    businessAddress: "277 Mud St E, Toronto, ON, L3M 4E7",
    streetAddress: "277 Mud St E",
    city: "Toronto",
    province: "ON",
    postalCode: "L3M 4E7",
    businessType: "Electrical",
    serviceArea: "Niagara Falls, Welland, Brampton",
    callForwardingNumber: "2495033301",
    bookingPreference: "Text owner first",
    notificationPreference: "SMS",
    aiTone: "Professional",
    assistantVoice: "elliot",
    assistantVoiceLabel: "My AI PA Agent",
    openingDialogue: "Hi, thanks for calling. How can I help you today?",
    specializations: ["Residential", "Commercial", "Specialty"],
    specializationNotes: "",
    pricing: {
      installationFreeEstimate: true,
      repairVisitFee: "100",
      repairHourlyRate: "100",
    },
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
      ...(env.REACT_APP_MAKE_SIGNUP_WEBHOOK_API_KEY ? { "x-make-apikey": env.REACT_APP_MAKE_SIGNUP_WEBHOOK_API_KEY } : {}),
    },
    body: JSON.stringify(payload),
  })
    .then(async (response) => {
      const text = await response.text();
      console.log(`POST ${response.status} ${response.statusText}`);
      console.log(text || "(empty response)");
      if (!response.ok) process.exitCode = 1;
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
