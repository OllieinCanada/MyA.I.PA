import {
  timsElectricalBoundaries,
  timsElectricalScenarios,
} from "./timsElectricalDemoData";

describe("Tim's Electrical interactive demo", () => {
  test("covers the six useful electrical call paths", () => {
    expect(timsElectricalScenarios.map((scenario) => scenario.id)).toEqual([
      "new-installation",
      "repair-request",
      "maintenance",
      "unresolved-concern",
      "urgent-outage",
      "safety-redirect",
    ]);
  });

  test("includes the requested unresolved-concern situation", () => {
    const scenario = timsElectricalScenarios.find((item) => item.id === "unresolved-concern");
    expect(scenario.title).toBe("Customer asks to discuss an unresolved concern");
    expect(scenario.collected).toContain("Previously discussed");
  });

  test.each(timsElectricalScenarios)("$id provides both text previews", (scenario) => {
    expect(scenario.ownerText).toBeTruthy();
    expect(scenario.customerText).toBeTruthy();
    expect(scenario.transcript.length).toBeGreaterThan(1);
    expect(scenario.stages).toHaveLength(4);
  });

  test("the installation scenario uses natural intake and captures preferred timing", () => {
    const scenario = timsElectricalScenarios.find((item) => item.id === "new-installation");
    const transcript = scenario.transcript.map((line) => line.text).join(" ");
    expect(transcript).toMatch(/How can I help you today/i);
    expect(transcript).toMatch(/When are you hoping to have the work done/i);
    expect(scenario.collected).toContain("Preferred start · Next week");
    expect(scenario.customerText).toMatch(/details and next steps/i);
  });

  test("the immediate-danger scenario stops intake and directs the caller to 911", () => {
    const scenario = timsElectricalScenarios.find((item) => item.id === "safety-redirect");
    const assistantText = scenario.transcript.filter((line) => line.speaker === "assistant").map((line) => line.text).join(" ");
    expect(assistantText).toMatch(/leave the area/i);
    expect(assistantText).toMatch(/call 911/i);
    expect(assistantText).toMatch(/cannot provide emergency dispatch/i);
    expect(scenario.route).toMatch(/^911/);
  });

  test("safe operating boundaries forbid diagnosis and unsupported promises", () => {
    expect(timsElectricalBoundaries.join(" ")).toMatch(/Never diagnose/i);
    expect(timsElectricalBoundaries.join(" ")).toMatch(/Never guarantee a price, appointment, response time/i);
  });
});
