import {
  buildComplaintRequest,
  classifyTenantConcern,
  containsSensitiveApplicationData,
  getMissingComplaintFields,
  getScenarioProgress,
} from "./firstClassRentalsLogic";
import { demoScenarios, listingKnowledge } from "./firstClassRentalsData";

describe("First Class Rentals demo safety and intake logic", () => {
  test.each([
    "There is smoke and fire by the outlet",
    "My carbon monoxide alarm is sounding",
    "I smell a gas leak in the hallway",
    "The basement is flooding around the electrical panel",
  ])("redirects immediate danger: %s", (description) => {
    expect(classifyTenantConcern(description).level).toBe("emergency_redirect");
  });

  test("marks a no-heat complaint for priority review without promising dispatch", () => {
    const result = classifyTenantConcern("There is no heat in my unit");
    expect(result.level).toBe("priority_review");
    expect(result.instruction).toMatch(/without promising a response time/i);
  });

  test.each([
    "My SIN is 123 456 789",
    "Here is my driver's licence number",
    "I want to provide my banking information",
    "Take my credit-card number",
  ])("detects sensitive application data: %s", (value) => {
    expect(containsSensitiveApplicationData(value)).toBe(true);
  });

  test("requires the practical fields Dave needs for a callback", () => {
    expect(getMissingComplaintFields({ category: "Other concern" })).toEqual([
      "Tenant name",
      "Property address and unit",
      "Callback number",
      "Description",
      "Preferred callback time",
    ]);
  });

  test("builds a private complaint request without claiming delivery", () => {
    const result = buildComplaintRequest({
      name: "Priya Shah",
      address: "18 George Street, Unit 2",
      callback: "905-555-0177",
      category: "Maintenance not resolved",
      occurred: "Last Thursday",
      description: "The hallway light still goes out.",
      resolution: "Please call me with an inspection update.",
      callbackTime: "After 5 p.m.",
      ongoing: true,
      textConsent: true,
    });

    expect(result.ok).toBe(true);
    expect(result.request.recipient).toBe("Dave");
    expect(result.request.deliveryStatus).toMatch(/not sent/i);
    expect(result.request.textConsent).toBe(true);
  });

  test("does not prepare an ordinary complaint when immediate danger is described", () => {
    const result = buildComplaintRequest({
      name: "Tenant",
      address: "1 Example Street, Unit 1",
      callback: "905-555-0100",
      category: "Property condition",
      description: "There are sparks and smoke coming from the outlet.",
      callbackTime: "Now",
    });

    expect(result.ok).toBe(true);
    expect(result.safety.level).toBe("emergency_redirect");
  });

  test("keeps all scraped listing availability and pricing behind confirmation", () => {
    for (const listing of listingKnowledge) {
      expect(listing.availability).toBe("requires_confirmation");
      expect(listing.pricing).toBe("requires_confirmation");
    }
  });

  test("includes rental, application, maintenance, complaint, and safety demos", () => {
    expect(demoScenarios.map((scenario) => scenario.id)).toEqual([
      "rental-inquiry",
      "application-help",
      "maintenance",
      "complaint",
      "emergency",
    ]);
  });

  test("reports deterministic call progress", () => {
    const scenario = demoScenarios[0];
    expect(getScenarioProgress(scenario, 0)).toBe(0);
    expect(getScenarioProgress(scenario, scenario.transcript.length)).toBe(100);
  });
});
