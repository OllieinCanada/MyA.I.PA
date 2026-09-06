const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildMappingReadinessReport,
  classifyInventoryPurpose,
} = require("../scripts/audit-vapi-business-mappings");

test("classifies explicit canaries and demos separately from customer inventory", () => {
  assert.equal(
    classifyInventoryPurpose(
      "opaque-provider-name",
      "Thanks for calling My AI PA Controlled Provisioning Canary — Synthetic Test Only."
    ),
    "non_customer"
  );
  assert.equal(classifyInventoryPurpose("My AI PA — Tim's Recorded Demo"), "non_customer");
  assert.equal(classifyInventoryPurpose("Arscott Plumbing and Heating Inc.AI"), "customer_or_unknown");
});

test("synthetic unmapped inventory is visible but does not fail customer readiness", () => {
  const report = buildMappingReadinessReport({
    phones: [{
      id: "phone-canary-123456",
      number: "+12495550420",
      assistantId: "assistant-canary-123456",
      assistantName: "opaque-provider-name",
    }],
    assistants: [{
      id: "assistant-canary-123456",
      name: "opaque-provider-name",
      firstMessage: "Thanks for calling the controlled provisioning canary — synthetic test only.",
      phoneNumbers: ["+12495550420"],
    }],
  });

  assert.equal(report.ready, true);
  assert.equal(report.summary.unmappedCustomerPhones, 0);
  assert.equal(report.summary.unmappedNonCustomerPhones, 1);
  assert.equal(report.nonCustomerUnmappedPhones[0].phone, "•••0420");
});

test("an unknown attached customer assistant still fails closed when unmapped", () => {
  const report = buildMappingReadinessReport({
    phones: [{
      id: "phone-customer-123456",
      number: "+12495553161",
      assistantId: "assistant-customer-123456",
      assistantName: "Arscott Plumbing and Heating Inc.AI",
    }],
    assistants: [{
      id: "assistant-customer-123456",
      name: "Arscott Plumbing and Heating Inc.AI",
      firstMessage: "Thanks for calling Arscott Plumbing and Heating.",
      phoneNumbers: ["+12495553161"],
    }],
  });

  assert.equal(report.ready, false);
  assert.equal(report.summary.unmappedCustomerPhones, 1);
  assert.equal(report.summary.unmappedCustomerAssistants, 1);
  assert.equal(report.unmappedPhones[0].phone, "•••3161");
});

test("a mapped customer phone without an assistant still fails delivery readiness", () => {
  const report = buildMappingReadinessReport({
    phones: [{ id: "phone-1", number: "+19055550123", name: "Customer line" }],
    assistants: [],
    mappings: [{ matchValue: "phone-1", businessId: 7 }],
    businesses: [{ id: 7, name: "Customer business" }],
  });
  assert.equal(report.summary.unmappedCustomerPhones, 0);
  assert.equal(report.summary.customerPhonesWithoutAssistants, 1);
  assert.equal(report.customerPhonesWithoutAssistants.length, 1);
  assert.equal(report.ready, false);
});

test("a deliberately paused customer can keep its number detached without passing as active", () => {
  const report = buildMappingReadinessReport({
    phones: [{ id: "phone-1", number: "+19055550123", name: "Customer line", mappedBusiness: { id: 7, name: "Paused Plumbing" } }],
    assistants: [],
    mappings: [{ matchValue: "phone-1", businessId: 7 }],
    businesses: [{ id: 7, name: "Paused Plumbing" }],
    customerAccounts: [{ businessName: "Paused Plumbing", paymentStatus: "paused", setupStatus: "subscription_paused" }],
  });
  assert.equal(report.summary.customerPhonesWithoutAssistants, 0);
  assert.equal(report.summary.pausedCustomerPhonesWithoutAssistants, 1);
  assert.equal(report.pausedCustomerPhonesWithoutAssistants[0].serviceState, "paused");
});

test("a protected trial-gate route does not require a direct assistant attachment", () => {
  const report = buildMappingReadinessReport({
    phones: [{
      id: "phone-1",
      number: "+19055550123",
      name: "Customer line",
      routeMode: "trial_gate",
      mappedBusiness: { id: 7, name: "Trialing Electric" },
    }],
    assistants: [],
    mappings: [{ matchValue: "phone-1", businessId: 7 }],
    businesses: [{ id: 7, name: "Trialing Electric" }],
    customerAccounts: [{ businessName: "Trialing Electric", paymentStatus: "trialing", setupStatus: "agent_testing" }],
  });
  assert.equal(report.summary.customerPhonesWithoutAssistants, 0);
  assert.equal(report.summary.trialGatedCustomerPhones, 1);
  assert.equal(report.ready, true);
});
