import { getDefaultApiBaseUrl, isMakeWebhookUrl, normalizeApiBase } from "../../config/apiBase";

export const DEFAULT_SIGNUP_WEBHOOK_URL = "";
export const RAW_API_BASE = process.env.REACT_APP_API_BASE_URL || getDefaultApiBaseUrl();
export const RAW_CHECKOUT_API_BASE = process.env.REACT_APP_CHECKOUT_API_BASE_URL || "";
export const MAKE_SIGNUP_WEBHOOK_URL = process.env.REACT_APP_MAKE_SIGNUP_WEBHOOK_URL || "";
export const MAKE_SIGNUP_WEBHOOK_API_KEY = process.env.REACT_APP_MAKE_SIGNUP_WEBHOOK_API_KEY || "";
export const SIGNUP_API_PATH = "/api/integrations/signup-complete";
export const CHECKOUT_API_PATH = "/api/payments/create-checkout-session";
export const IS_MAKE_WEBHOOK = isMakeWebhookUrl(RAW_API_BASE);

export const API_BASE = normalizeApiBase(RAW_API_BASE);

export const SIGNUP_SUBMIT_URL = MAKE_SIGNUP_WEBHOOK_URL
  ? normalizeApiBase(MAKE_SIGNUP_WEBHOOK_URL)
  : IS_MAKE_WEBHOOK
    ? normalizeApiBase(RAW_API_BASE)
    : `${API_BASE}${SIGNUP_API_PATH}`;

export const CHECKOUT_API_BASE = normalizeApiBase(RAW_CHECKOUT_API_BASE || (IS_MAKE_WEBHOOK ? getDefaultApiBaseUrl() : API_BASE));
export const CHECKOUT_SESSION_URL = `${CHECKOUT_API_BASE}${CHECKOUT_API_PATH}`;

export const CAPTCHA_PROVIDER = "";
export const RECAPTCHA_SITE_KEY = "";
export const RECAPTCHA_MODE = "score";
export const USE_RECAPTCHA_ENTERPRISE = false;
export const TURNSTILE_SITE_KEY = "";

export const TRADE_OPTIONS = [
  {
    id: "electrician",
    label: "Electrician",
    businessType: "Electrical",
    accent: "from-blue-600 to-violet-500",
    icon: "bolt",
    services: "Panel upgrades\nBreaker issues\nLighting installs\nEV charger installs\nEmergency electrical service",
    faq: "Do you offer emergency electrical service?\nDo you handle panel upgrades?\nCan you install EV chargers?\nDo you provide estimates?",
    greeting: "Hi, thanks for calling {business}. How can I help you today?",
  },
  {
    id: "plumber",
    label: "Plumber",
    businessType: "Plumbing",
    accent: "from-sky-500 to-blue-600",
    icon: "drop",
    services: "Drain cleaning\nLeak repair\nWater heaters\nSump pumps\nEmergency plumbing",
    faq: "Do you offer emergency plumbing?\nDo you provide estimates?\nWhat areas do you serve?\nCan you help with water heaters?",
    greeting: "Hi, thanks for calling {business}. How can I help with your plumbing today?",
  },
  {
    id: "hvac",
    label: "HVAC",
    businessType: "HVAC",
    accent: "from-cyan-500 to-indigo-500",
    icon: "snow",
    services: "Furnace repair\nAir conditioning repair\nMaintenance calls\nThermostats\nEmergency no-heat calls",
    faq: "Do you offer emergency HVAC service?\nDo you service furnaces and AC units?\nDo you provide maintenance?\nWhat brands do you work on?",
    greeting: "Hi, thanks for calling {business}. Are you calling about heating, cooling, or maintenance?",
  },
  {
    id: "contractor",
    label: "Contractor",
    businessType: "Contractor",
    accent: "from-slate-700 to-blue-600",
    icon: "hammer",
    services: "Renovation calls\nEstimate requests\nProject questions\nSite visits\nCustomer follow-up",
    faq: "Do you provide estimates?\nWhat areas do you serve?\nCan you handle small jobs?\nWhen can someone call me back?",
    greeting: "Hi, thanks for calling {business}. What kind of project can we help with?",
  },
  {
    id: "roofer",
    label: "Roofer",
    businessType: "Roofing",
    accent: "from-indigo-500 to-slate-700",
    icon: "home",
    services: "Roof repair\nLeak repair\nShingle replacement\nStorm damage\nRoof inspections",
    faq: "Do you repair roof leaks?\nDo you provide inspections?\nCan you help after storm damage?\nDo you offer estimates?",
    greeting: "Hi, thanks for calling {business}. Are you calling about a roof repair, leak, or estimate?",
  },
  {
    id: "painter",
    label: "Painter",
    businessType: "Painting",
    accent: "from-purple-500 to-blue-600",
    icon: "roller",
    services: "Interior painting\nExterior painting\nCabinet painting\nTouch-ups\nEstimate requests",
    faq: "Do you provide painting estimates?\nDo you handle interior and exterior work?\nWhat areas do you serve?\nWhen can someone call me back?",
    greeting: "Hi, thanks for calling {business}. Are you looking for interior, exterior, or cabinet painting?",
  },
];

export const AREA_OPTIONS = [
  "Niagara Falls",
  "Welland",
  "St. Catharines",
  "Thorold",
  "Port Colborne",
  "Fort Erie",
  "Grimsby",
  "Hamilton",
  "Burlington",
  "Oakville",
  "Milton",
  "Mississauga",
  "Brampton",
  "Toronto",
  "Vaughan",
  "Markham",
  "Richmond Hill",
  "Pickering",
  "Ajax",
  "Whitby",
  "Oshawa",
  "Kitchener",
  "Waterloo",
  "Cambridge",
  "Guelph",
  "Brantford",
  "London",
  "Barrie",
];

export const SETUP_STEPS = [
  { number: 1, label: "Your business" },
  { number: 2, label: "Hear voice" },
  { number: 3, label: "Review & launch" },
];

export const ASSISTANT_SAMPLE_AUDIO_SRC = `${process.env.PUBLIC_URL || ""}/Assistant_Testing.wav`;
export const ASSISTANT_AGENT = {
  value: "elliot",
  label: "My AI PA Agent",
  sampleSrc: ASSISTANT_SAMPLE_AUDIO_SRC,
};

export const SPECIALIZATION_OPTIONS = [
  { id: "residential", label: "Residential", icon: "home" },
  { id: "commercial", label: "Commercial", icon: "building" },
  { id: "industrial", label: "Industrial", icon: "factory" },
  { id: "agricultural", label: "Agricultural", icon: "leaf" },
  { id: "specialty", label: "Specialty", icon: "star" },
];

export const OPENING_DIALOGUE_OPTIONS = [
  {
    id: "help-today",
    text: "Hi, thanks for calling. How can I help you today?",
  },
  {
    id: "res-commercial",
    text: "Hello, and thanks for calling. We proudly serve both residential and commercial customers.",
  },
  {
    id: "community",
    text: "Good day, and thanks for calling. We've been helping the community for over 10 years.",
  },
  {
    id: "welcome",
    text: "Welcome, and thanks for calling. Please let me know what you need.",
  },
];

export const CANADIAN_PROVINCES = [
  { value: "AB", label: "Alberta" },
  { value: "BC", label: "British Columbia" },
  { value: "MB", label: "Manitoba" },
  { value: "NB", label: "New Brunswick" },
  { value: "NL", label: "Newfoundland and Labrador" },
  { value: "NS", label: "Nova Scotia" },
  { value: "NT", label: "Northwest Territories" },
  { value: "NU", label: "Nunavut" },
  { value: "ON", label: "Ontario" },
  { value: "PE", label: "Prince Edward Island" },
  { value: "QC", label: "Quebec" },
  { value: "SK", label: "Saskatchewan" },
  { value: "YT", label: "Yukon" },
];

export const BUSINESS_SLIDE_TABS = [
  { number: 1, label: "Trade" },
  { number: 2, label: "Area" },
  { number: 3, label: "Details" },
  { number: 4, label: "Pricing" },
  { number: 5, label: "Review" },
];

export const DEFAULT_DETAILS = {
  ownerName: "",
  businessName: "",
  phone: "",
  email: "",
  streetAddress: "",
  city: "",
  province: "ON",
  postalCode: "",
};

export const DEFAULT_PRICING = {
  installationFreeEstimate: true,
  repairVisitFee: "100",
  repairHourlyRate: "100",
};

export const SIGNUP_ATTEMPT_STORAGE_KEY = "myaipa_signup_attempts_v1";
export const SIGNUP_ATTEMPT_WINDOW_MS = 60 * 60 * 1000;
export const SIGNUP_ATTEMPT_LIMIT = 3;
