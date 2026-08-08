import {
  buildConstituentComplaint,
  classifyConstituentConcern,
  containsSensitiveConstituentData,
  getDeanDemoProgress,
  getMissingConstituentFields,
} from "./deanAllisonDemoLogic";

const completeForm = {
  name: "Jordan Lee",
  city: "Grimsby",
  callback: "905-555-0123",
  category: "Federal program or department delay",
  department: "Employment Insurance",
  description: "I submitted the requested documents six weeks ago and have not received an update.",
  requestedAction: "Please call me and explain whether the office can request a status update.",
  callbackTime: "Weekday afternoon",
  textConsent: true,
};

test("emergency language stops ordinary constituency intake", () => {
  const result = buildConstituentComplaint({ ...completeForm, description: "Someone is threatening me right now." });
  expect(result.ok).toBe(false);
  expect(result.safety.level).toBe("emergency_redirect");
  expect(result.safety.instruction).toMatch(/call 911/i);
});

test("sensitive government identifiers are rejected before a summary is built", () => {
  for (const value of ["My SIN is ready", "Passport number", "My UCI", "Immigration file number", "Bank account details"]) {
    expect(containsSensitiveConstituentData(value)).toBe(true);
  }
  const result = buildConstituentComplaint({ ...completeForm, description: "My SIN is 123 and my case is delayed." });
  expect(result.ok).toBe(false);
  expect(result.privacyWarning).toMatch(/must not retain or transmit/i);
});

test("complete ordinary complaints produce an unofficial unsent preview", () => {
  const result = buildConstituentComplaint(completeForm);
  expect(result.ok).toBe(true);
  expect(result.request.officialOfficeAuthorized).toBe(false);
  expect(result.request.deliveryStatus).toMatch(/not sent to Dean Allison/i);
  expect(result.request.textConsent).toBe(true);
});

test("required complaint fields are reported without requiring sensitive identifiers", () => {
  const missing = getMissingConstituentFields({});
  expect(missing).toEqual(expect.arrayContaining(["Caller name", "City or community", "Callback number", "Concern description"]));
  expect(missing.join(" ")).not.toMatch(/SIN|passport|case number/i);
});

test("scenario progress is capped and deterministic", () => {
  const scenario = { transcript: [{}, {}, {}, {}] };
  expect(getDeanDemoProgress(scenario, 0)).toBe(0);
  expect(getDeanDemoProgress(scenario, 2)).toBe(50);
  expect(getDeanDemoProgress(scenario, 10)).toBe(100);
});

test("ordinary federal-service complaints remain standard review", () => {
  expect(classifyConstituentConcern("I have waited six weeks for an EI update.").level).toBe("standard_review");
});
