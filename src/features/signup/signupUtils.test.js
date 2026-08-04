import {
  buildSignupPayload,
  buildPricingPayload,
  extractPhoneFromText,
  getSignupSuccess,
  getTwilioPhoneNumber,
  parseApiResponse,
  validateBusinessDetails,
} from "./signupUtils";

const validDetails = {
  ownerName: "Morgan Taylor",
  businessName: "Taylor Electrical",
  phone: "905-788-5488",
  email: "morgan@taylorelectrical.ca",
  streetAddress: "23 Robb Street",
  city: "Hamilton",
  province: "ON",
  postalCode: "L8P 1A1",
};

test("signup validation accepts complete Canadian business details", () => {
  expect(validateBusinessDetails(validDetails)).toEqual({
    errors: {
      ownerName: "",
      businessName: "",
      phone: "",
      email: "",
      streetAddress: "",
      city: "",
      province: "",
      postalCode: "",
    },
    isValid: true,
  });
});

test("signup validation rejects placeholders and malformed contact details", () => {
  const result = validateBusinessDetails({
    ...validDetails,
    ownerName: "Jamie Smith",
    businessName: "Example Electrical",
    phone: "555-1234",
    email: "not-an-email",
  });
  expect(result.isValid).toBe(false);
  expect(result.errors.ownerName).toBeTruthy();
  expect(result.errors.businessName).toBeTruthy();
  expect(result.errors.phone).toBeTruthy();
  expect(result.errors.email).toBeTruthy();
});

test("the signup payload keeps owner, business, pricing, and agent fields aligned", () => {
  const payload = buildSignupPayload({
    details: validDetails,
    pricing: {
      offersServiceCalls: true,
      installationFreeEstimate: true,
      repairVisitFee: "125",
      repairHourlyRate: "95",
    },
    selectedAreas: ["Hamilton", "Burlington"],
    selectedTrade: {
      businessType: "Electrical",
      services: "Repairs\nInstallations",
      faq: "Do you provide estimates?",
    },
    selectedAgent: { value: "elliot", label: "My AI PA Agent", sampleSrc: "/sample.wav" },
    selectedDialogueText: "Hi, thanks for calling Taylor Electrical.",
    selectedSpecializationLabels: ["Residential", "Commercial"],
    specializationNotes: "Panel work only.",
    botTrap: "",
    captchaProvider: "turnstile",
    captchaToken: "verified-token",
    signupStartedAt: Date.now() - 12_000,
  });

  expect(payload.businessName).toBe(validDetails.businessName);
  expect(payload.ownerEmail).toBe(validDetails.email);
  expect(payload.businessProfile.address).toContain("Hamilton");
  expect(payload.setupDetails.ownerPhone).toBe(validDetails.phone);
  expect(payload.setupDetails.callForwardingNumber).toBe(validDetails.phone);
  expect(payload.setupDetails.pricing.repairVisitFee).toBe("125");
  expect(payload.setupDetails.offersServiceCalls).toBe(true);
  expect(payload.setupDetails.greetingScript).toContain("Taylor Electrical");
  expect(payload.security.turnstileToken).toBe("verified-token");
});

test("service-call pricing never inserts silent defaults", () => {
  const pricing = buildPricingPayload({
    offersServiceCalls: false,
    installationFreeEstimate: true,
    repairVisitFee: "",
    repairHourlyRate: "",
  });

  expect(pricing.offersServiceCalls).toBe(false);
  expect(pricing.repairVisitFee).toBe("");
  expect(pricing.repairHourlyRate).toBe("");
  expect(pricing.pricingScript).toContain("does not offer service calls");
  expect(pricing.pricingScript).not.toContain("100");
  expect(pricing.pricingScript).not.toContain("Would you like to continue?");
});

test("signup response helpers handle nested assigned numbers and explicit failures", () => {
  expect(extractPhoneFromText("Assigned +1 (249) 503-3301")).toBe("+1 (249) 503-3301");
  expect(getTwilioPhoneNumber({ setup: { assignedPhoneNumber: "+12495033301" } })).toBe("+12495033301");
  expect(getSignupSuccess({ ok: true })).toBe(true);
  expect(getSignupSuccess({ success: false, ok: true })).toBe(false);
});

test("API response parsing exposes a safe server error", async () => {
  const response = {
    ok: false,
    status: 429,
    text: async () => JSON.stringify({ error: "Wait and try again." }),
  };
  await expect(parseApiResponse(response, "Signup failed")).rejects.toThrow("Wait and try again.");
});
