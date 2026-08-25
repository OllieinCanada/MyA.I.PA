const assert = require("node:assert/strict");
const test = require("node:test");

const { evaluateScenario, summarize } = require("../scripts/audit-make-2026-readiness");

function webhookResponse(id = 99) {
  return { id, module: "gateway:WebhookRespond", version: 1, mapper: {} };
}

test("flags destructive provisioning without idempotency and a fixed area code", () => {
  const report = evaluateScenario({
    scenario: { id: "scenario-1", name: "Signup", isActive: false },
    hooks: [{ id: "hook-1" }],
    blueprint: {
      flow: [
        { id: 1, module: "gateway:CustomWebHook", version: 1 },
        { id: 2, module: "http:ActionSendData", version: 3, mapper: { url: "https://api.myaipa.ca/api/integrations/twilio/purchase-number", query: [{ name: "areaCode", value: "249" }] } },
        { id: 3, module: "vapi:makeApiCall2", version: 1 },
        webhookResponse(),
      ],
    },
  });

  assert.equal(report.workflow.provisionsPhone, true);
  assert.equal(report.workflow.hasVisibleIdempotencyStorage, false);
  assert.equal(report.workflow.hasHardcodedAreaCode, true);
  assert.equal(report.modules.legacyHttpV3, 1);
  assert.deepEqual(
    new Set(report.issues.filter((issue) => issue.level === "high").map((issue) => issue.key)),
    new Set(["inactive-with-hook", "provisioning-idempotency", "hardcoded-area-code"])
  );
});

test("does not mistake descriptive prompt text for durable idempotency", () => {
  const report = evaluateScenario({
    scenario: { id: "scenario-prompt", name: "Prompt only", isActive: true },
    blueprint: {
      flow: [
        { id: 1, module: "http:ActionSendData", version: 4, mapper: { url: "https://api.myaipa.ca/api/integrations/twilio/purchase-number", body: "Please make this request idempotent and replay-safe." } },
        webhookResponse(),
      ],
    },
  });
  assert.equal(report.workflow.hasVisibleIdempotencyStorage, false);
  assert.ok(report.issues.some((issue) => issue.key === "provisioning-idempotency"));
});

test("flags unauthenticated HTTP v4 requests carrying contact data", () => {
  const report = evaluateScenario({
    scenario: { id: "scenario-2", name: "Lookup", isActive: true },
    blueprint: {
      flow: [
        { id: 1, module: "http:ActionSendData", version: 4, mapper: { authenticationType: "noAuth", url: "https://service.example.com/lookup", body: "{\"callerPhone\":\"{{1.phone}}\"}" } },
        webhookResponse(),
      ],
    },
  });

  assert.equal(report.modules.externalUnauthenticatedPiiRequests.length, 1);
  assert.equal(report.modules.externalUnauthenticatedPiiRequests[0].host, "service.example.com");
  assert.ok(report.issues.some((issue) => issue.key === "unauthenticated-pii-http"));
});

test("requires Webhook response to be last", () => {
  const report = evaluateScenario({
    scenario: { id: "scenario-3", name: "Bad response order", isActive: true },
    blueprint: { flow: [webhookResponse(), { id: 2, module: "tools:SetVariable", version: 1 }] },
  });
  assert.equal(report.modules.webhookResponseLast, false);
  assert.ok(report.issues.some((issue) => issue.key === "webhook-response-order"));
});

test("summary counts high-risk gaps without leaking configuration values", () => {
  const reports = [
    evaluateScenario({
      scenario: { id: "scenario-4", name: "Safe", isActive: true },
      blueprint: { flow: [webhookResponse()] },
    }),
  ];
  const result = summarize(reports);
  assert.equal(result.scenarios, 1);
  assert.equal(result.active, 1);
  assert.equal(result.highRiskGaps, 0);
});
