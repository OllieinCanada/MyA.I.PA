const { loadProjectEnv } = require("./_helpers");

const env = loadProjectEnv();
const shouldPost = process.argv.includes("--post");
const apiBase = String(env.REACT_APP_API_BASE_URL || env.API_BASE_URL || "https://api.myaipa.ca").replace(/\/+$/, "");
const endpoint = `${apiBase}/api/integrations/signup-complete`;

const services = [
  "Electrical maintenance",
  "Commercial electrical services",
  "Industrial electrical services",
  "Residential electrical services",
  "Panel upgrades",
  "New home build wiring",
  "Lighting upgrades",
  "Machine safety",
  "Network cabling and equipment",
  "Camera systems",
  "ESafe certification",
];

const serviceAreas = [
  "Grimsby",
  "Lincoln",
  "St. Catharines",
  "Welland",
  "Fort Erie",
  "Niagara Falls",
  "Hamilton",
  "Wellandport",
  "Dunnville",
  "Pelham",
  "Fonthill",
  "Vineland",
  "Stoney Creek",
  "Beamsville",
  "Smithville",
  "Caistor Centre",
  "Port Colborne",
  "the Greater Niagara Area",
  "Southern Ontario",
];

const noQuotePolicy = [
  "Do not provide, estimate, or imply prices, service-call fees, hourly rates, discounts, or free estimates.",
  "Explain that pricing depends on the scope, site conditions, and materials, and that Ron or the Grimsby Electric team will review the request and follow up.",
  "Never claim that a callback time, site visit, appointment, start date, or emergency dispatch is confirmed.",
].join(" ");

const intakeQuestions = [
  "May I get your name?",
  "What is the best phone number to reach you?",
  "What is the service address, including the city?",
  "Is this residential, commercial, or industrial work?",
  "Please describe the electrical work or problem.",
  "Is there sparking, smoke, fire, a downed wire, exposed live wiring, or another immediate safety concern?",
  "When would you prefer the work to begin?",
  "What is the best time for the team to call you back?",
].join("\n");

const faq = [
  "Grimsby Electric has served the Greater Niagara Area and Southern Ontario since 1982.",
  "The company handles residential, commercial, and industrial electrical work.",
  `Published services include: ${services.join(", ")}.`,
  `Published service areas include: ${serviceAreas.join(", ")}.`,
  "The published ECRA/ESA licence number is 7001754, and the website states that a master electrician is on staff.",
  "Online business listings tied to 905-945-1055 show normal hours as Monday through Friday, 8:00 AM to 5:00 PM, with Saturday and Sunday closed. Treat these hours as listing-derived and let the team confirm holiday or special hours.",
  noQuotePolicy,
].join("\n");

const aiGoals = [
  "Act as Grimsby Electric's professional virtual telephone assistant.",
  "Sound calm, respectful, concise, and practical. Do not pretend to be Ron or a licensed electrician.",
  "Answer only from the approved business facts in this setup, collect a complete lead, and send a clear summary for follow-up.",
  "If a caller asks about an unlisted service, say the team can review the request; do not claim it is offered.",
  "For immediate hazards involving fire, smoke, sparking, downed power lines, or exposed live electrical equipment, tell the caller to move to safety and contact 911 or the appropriate electrical utility. Do not troubleshoot dangerous electrical work.",
  noQuotePolicy,
].join(" ");

const payload = {
  country: "ca",
  businessName: "Grimsby Electric",
  ownerName: "Ron Cournoyer",
  ownerEmail: "shop@grimsbyelectric.com",
  email: "shop@grimsbyelectric.com",
  businessPhone: "+19059451055",
  phone: "+19059451055",
  businessAddress: "PO Box 361, Grimsby, ON, L3M 4H8",
  streetAddress: "PO Box 361",
  city: "Grimsby",
  province: "ON",
  postalCode: "L3M 4H8",
  businessType: "Electrical",
  serviceArea: serviceAreas.join(", "),
  specializations: ["Residential", "Commercial", "Industrial", "Specialty"],
  specializationList: "Residential, Commercial, Industrial, Specialty",
  specialityList: "Residential, Commercial, Industrial, Specialty",
  specialtyList: "Residential, Commercial, Industrial, Specialty",
  pricing: {
    installationFreeEstimate: false,
    freeEstimateAnswer: "The team will confirm estimate and pricing details.",
    repairVisitFee: "",
    repairHourlyRate: "",
    pricingScript: noQuotePolicy,
  },
  installationFreeEstimate: false,
  freeEstimateAnswer: "The team will confirm estimate and pricing details.",
  repairVisitFee: "",
  repairHourlyRate: "",
  pricingScript: noQuotePolicy,
  selectedPlace: null,
  businessProfile: {
    businessName: "Grimsby Electric",
    phone: "+19059451055",
    address: "PO Box 361, Grimsby, ON, L3M 4H8",
    streetAddress: "PO Box 361",
    city: "Grimsby",
    province: "ON",
    postalCode: "L3M 4H8",
    website: "https://grimsbyelectric.com/",
    hours: "Monday-Friday 8:00 AM-5:00 PM; Saturday-Sunday closed (online listing; team confirms holidays and exceptions)",
    services: services.join("\n"),
  },
  setupDetails: {
    ownerName: "Ron Cournoyer",
    ownerEmail: "shop@grimsbyelectric.com",
    ownerPhone: "+19059451055",
    businessAddress: "PO Box 361, Grimsby, ON, L3M 4H8",
    streetAddress: "PO Box 361",
    city: "Grimsby",
    province: "ON",
    postalCode: "L3M 4H8",
    businessType: "Electrical",
    serviceArea: serviceAreas.join(", "),
    callForwardingNumber: "+19059451055",
    bookingPreference: "Capture the request; Ron or the team confirms all appointments and timing",
    notificationPreference: "SMS",
    aiTone: "Professional, respectful, calm, concise",
    assistantVoice: "elliot",
    assistantVoiceLabel: "Grimsby Electric Virtual Assistant",
    openingDialogue: "Thank you for calling Grimsby Electric. This is the virtual assistant. How can I help you today?",
    specializations: ["Residential", "Commercial", "Industrial", "Specialty"],
    specializationList: "Residential, Commercial, Industrial, Specialty",
    specialityList: "Residential, Commercial, Industrial, Specialty",
    specialtyList: "Residential, Commercial, Industrial, Specialty",
    specializationNotes: services.join("; "),
    pricing: {
      installationFreeEstimate: false,
      freeEstimateAnswer: "The team will confirm estimate and pricing details.",
      repairVisitFee: "",
      repairHourlyRate: "",
      pricingScript: noQuotePolicy,
    },
    installationFreeEstimate: false,
    freeEstimateAnswer: "The team will confirm estimate and pricing details.",
    repairVisitFee: "",
    repairHourlyRate: "",
    pricingScript: noQuotePolicy,
    aiGoals,
    faq,
    greetingScript: "Thank you for calling Grimsby Electric. This is the virtual assistant. How can I help you today?",
    intakeQuestions,
    emergencyAfterHoursAvailable: false,
    emergencyRules: "Do not promise emergency or after-hours dispatch. For immediate danger, direct the caller to move to safety and contact 911 or the appropriate electrical utility. Otherwise capture the request for team follow-up.",
    escalationRules: "Flag immediate safety concerns, service outages affecting essential operations, and time-sensitive commercial or industrial requests as high priority, without promising response time.",
    doNotHandle: "Do not give electrical troubleshooting instructions, quote prices, guarantee availability, book appointments, promise dispatch, claim insurance coverage, or expand services beyond the approved facts.",
  },
  security: {
    companyWebsite: "",
    clientElapsedMs: 15000,
    captchaProvider: "",
    captchaToken: "",
    recaptchaToken: "",
    turnstileToken: "",
    timezone: "America/Toronto",
    pageUrl: "https://www.myaipa.ca/#/signup",
  },
};

if (!shouldPost) {
  console.log(JSON.stringify({ mode: "dry-run", endpoint, payload }, null, 2));
  process.exit(0);
}

fetch(endpoint, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
})
  .then(async (response) => {
    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text }; }
    console.log(JSON.stringify({ status: response.status, ok: response.ok, data }, null, 2));
    if (!response.ok) process.exitCode = 1;
  })
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
