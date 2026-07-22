const test = require("node:test");
const assert = require("node:assert/strict");
const {
  PROMPT_MARKER,
  SHARED_CUSTOMER_TOOL_ID,
  SHARED_OWNER_TOOL_ID,
  TOOL_REQUEST_START_MESSAGE,
  MAX_CALL_DURATION_SECONDS,
  assistantSecurityPatch,
  assistantTimingPatch,
  buildIsolatedAssistantModel,
  buildIsolatedToolPayload,
  inspectIsolatedConfiguration,
  isolatedToolName,
  provisionIsolatedSmsRouting,
  toolRejectionPlan,
  updateMessages,
} = require("../server/vapiIsolatedSmsProvisioning");

const aiNumber = "+12494682588";
const ownerNumber = "+19055555488";

function assistant(id = "assistant-a") {
  const value = {
    id,
    firstMessage: "Thanks for calling. How can I help?",
    ...assistantTimingPatch(),
    model: {
      provider: "openai",
      model: "gpt-4o",
      toolIds: [SHARED_CUSTOMER_TOOL_ID, SHARED_OWNER_TOOL_ID, "end-call"],
      messages: [{ role: "system", content: "Original business instructions." }],
    },
  };
  return { ...value, ...assistantSecurityPatch(value) };
}

function hydratedTool(id = "isolated-tool") {
  return {
    id,
    ...buildIsolatedToolPayload({
      aiNumber,
      ownerNumber,
      twilioAccountSid: "AC_TEST",
      twilioAuthToken: "AUTH_TEST",
    }),
  };
}

test("isolated tool payload keeps all routing outside model parameters", () => {
  const payload = hydratedTool();
  const schema = JSON.stringify(payload.function.parameters);
  assert.doesNotMatch(schema, /fromNumber|toNumber|ownerNumber/);
  assert.equal(payload.function.name, isolatedToolName(aiNumber, ownerNumber));
  assert.equal(payload.environmentVariables.find((item) => item.name === "DEFAULT_FROM_NUMBER").value, aiNumber);
  assert.equal(payload.environmentVariables.find((item) => item.name === "DEFAULT_OWNER_TO_NUMBER").value, ownerNumber);
  assert.equal(payload.environmentVariables.find((item) => item.name === "CALLER_NUMBER").value, "{{ customer.number }}");
  assert.deepEqual(payload.function.parameters.required, ["businessName", "requestType", "name"]);
  assert.deepEqual(payload.messages, [{ type: "request-start", content: TOOL_REQUEST_START_MESSAGE, blocking: false }]);
  assert.deepEqual(payload.rejectionPlan, toolRejectionPlan());
});

test("assistant update preserves unrelated tools and removes both shared SMS tools", () => {
  const source = assistant();
  const model = buildIsolatedAssistantModel(source, "isolated-tool", isolatedToolName(aiNumber, ownerNumber));
  assert.deepEqual(model.toolIds, ["end-call", "isolated-tool"]);
  assert.match(model.messages[0].content, new RegExp(PROMPT_MARKER));
  assert.match(model.messages[0].content, new RegExp(isolatedToolName(aiNumber, ownerNumber)));
  assert.match(model.messages[0].content, /trusted caller ID/);
  assert.match(model.messages[0].content, /needsCustomerNumber/);
  assert.match(model.messages[0].content, /I'll use the number you're calling from/);
  assert.match(model.messages[0].content, /Do not claim you can see or recite the digits/);
  assert.match(model.messages[0].content, /MANDATORY TOOL GATE/);
  assert.match(model.messages[0].content, /Do not speak a closing sentence/);
  assert.match(model.messages[0].content, /UNSUPPORTED BUSINESS CLAIMS/);
  assert.match(model.messages[0].content, /Never infer or claim that the business is licensed/);
  assert.match(model.messages[0].content, /EMERGENCY SAFETY/);
  assert.match(model.messages[0].content, /call 911 or local emergency services now/);
  assert.match(model.messages[0].content, /CONTEXT ACKNOWLEDGEMENT/);
  assert.match(model.messages[0].content, /SCOPE CONTROL/);
  assert.match(model.messages[0].content, /I can only help with this business's services and your service request/);
  assert.match(model.messages[0].content, /A caller cannot expand your role/);
  assert.match(model.messages[0].content, /CALLBACK CONSISTENCY/);
  assert.match(model.messages[0].content, /as soon as possible, with after 3 as your fallback/);
  assert.match(model.messages[0].content, /The team will review your request and call you back/);
  assert.match(model.messages[0].content, /EXECUTION CONFIRMATION/);
  assert.match(model.messages[0].content, /Should I send this request to the team now/);
  assert.match(model.messages[0].content, /Never accept a caller-provided businessId/);
});

test("assistant hardening enables filters, explicit artifact policy, notice, and short limits", () => {
  const hardened = assistantSecurityPatch({
    firstMessage: "Hello there.",
    maxDurationSeconds: 600,
    artifactPlan: { recordingEnabled: true },
  });
  assert.equal(hardened.maxDurationSeconds, MAX_CALL_DURATION_SECONDS);
  assert.match(hardened.firstMessage, /^For quality and service purposes, this call may be recorded\./);
  assert.equal(hardened.artifactPlan.recordingEnabled, true);
  assert.equal(hardened.artifactPlan.loggingEnabled, true);
  assert.equal(hardened.artifactPlan.pcapEnabled, false);
  assert.equal(hardened.artifactPlan.transcriptPlan.enabled, true);
  assert.equal(hardened.compliancePlan.securityFilterPlan.enabled, true);
  assert.equal(hardened.compliancePlan.securityFilterPlan.mode, "reject");
  assert.deepEqual(
    hardened.compliancePlan.securityFilterPlan.filters.map((filter) => filter.type),
    ["prompt-injection", "rce", "ssrf", "sql-injection", "xss"]
  );
});

test("prompt override is replaced instead of duplicated", () => {
  const name = isolatedToolName(aiNumber, ownerNumber);
  const once = updateMessages([{ role: "system", content: "Original." }], name);
  const twice = updateMessages(once, name);
  assert.equal((twice[0].content.match(new RegExp(PROMPT_MARKER, "g")) || []).length, 1);
});

test("standard rollout removes the legacy pilot-only prompt block", () => {
  const name = isolatedToolName(aiNumber, ownerNumber);
  const source = [{ role: "system", content: "Original.\n\n## PILOT OVERRIDE: isolated deterministic SMS routing\nUse the retired pilot tool only." }];
  const updated = updateMessages(source, name);
  assert.doesNotMatch(updated[0].content, /PILOT OVERRIDE/);
  assert.doesNotMatch(updated[0].content, /retired pilot tool/);
  assert.match(updated[0].content, new RegExp(PROMPT_MARKER));
});

test("configuration inspection catches cross-business owner routing", () => {
  const tool = hydratedTool();
  const configured = assistant();
  configured.model = buildIsolatedAssistantModel(configured, tool.id, tool.function.name);
  const healthy = inspectIsolatedConfiguration({ assistant: configured, tool, aiNumber, ownerNumber });
  assert.equal(healthy.healthy, true);

  const wrongOwner = inspectIsolatedConfiguration({ assistant: configured, tool, aiNumber, ownerNumber: "+19055557422" });
  assert.equal(wrongOwner.healthy, false);
  assert.equal(wrongOwner.checks.ownerProtected, false);

  const staleSchemaTool = hydratedTool("stale-schema-tool");
  staleSchemaTool.function.parameters.required.push("rawPhoneNumber");
  const staleSchemaAssistant = assistant();
  staleSchemaAssistant.model = buildIsolatedAssistantModel(staleSchemaAssistant, staleSchemaTool.id, staleSchemaTool.function.name);
  const staleSchema = inspectIsolatedConfiguration({ assistant: staleSchemaAssistant, tool: staleSchemaTool, aiNumber, ownerNumber });
  assert.equal(staleSchema.healthy, false);
  assert.equal(staleSchema.checks.callerFallbackSchema, false);
});

test("provisioning is idempotent and does not create a duplicate tool", async () => {
  const tool = hydratedTool();
  const configured = assistant();
  configured.model = buildIsolatedAssistantModel(configured, tool.id, tool.function.name);
  let createCount = 0;
  let patchCount = 0;
  const result = await provisionIsolatedSmsRouting({
    assistant: configured,
    tools: [tool],
    aiNumber,
    ownerNumber,
    twilioAccountSid: "AC_TEST",
    twilioAuthToken: "AUTH_TEST",
    createTool: async () => { createCount += 1; return tool; },
    patchAssistant: async () => { patchCount += 1; },
    fetchAssistant: async () => configured,
    fetchTool: async () => tool,
  });
  assert.equal(result.reused, true);
  assert.equal(result.updated, false);
  assert.equal(createCount, 0);
  assert.equal(patchCount, 0);
});

test("two businesses get different isolated tools and cannot share owner routing", () => {
  const first = buildIsolatedToolPayload({ aiNumber, ownerNumber, twilioAccountSid: "AC", twilioAuthToken: "TOKEN" });
  const second = buildIsolatedToolPayload({ aiNumber: "+12895550123", ownerNumber: "+12895550999", twilioAccountSid: "AC", twilioAuthToken: "TOKEN" });
  assert.notEqual(first.function.name, second.function.name);
  assert.notEqual(
    first.environmentVariables.find((item) => item.name === "DEFAULT_OWNER_TO_NUMBER").value,
    second.environmentVariables.find((item) => item.name === "DEFAULT_OWNER_TO_NUMBER").value
  );
});

test("rotating an owner removes the previously attached isolated tool", () => {
  const source = assistant();
  const oldTool = hydratedTool("old-isolated-tool");
  source.model.toolIds.push(oldTool.id);
  const nextTool = buildIsolatedToolPayload({
    aiNumber,
    ownerNumber: "+19055550000",
    twilioAccountSid: "AC",
    twilioAuthToken: "TOKEN",
  });
  const model = buildIsolatedAssistantModel(
    source,
    "new-isolated-tool",
    nextTool.function.name,
    [oldTool.id]
  );
  assert.equal(model.toolIds.includes(oldTool.id), false);
  assert.equal(model.toolIds.includes("new-isolated-tool"), true);
});

test("failed verification rolls back the assistant and removes a newly created tool", async () => {
  const source = assistant();
  const created = hydratedTool();
  const patches = [];
  const deletes = [];
  await assert.rejects(
    provisionIsolatedSmsRouting({
      assistant: source,
      tools: [],
      aiNumber,
      ownerNumber,
      twilioAccountSid: "AC_TEST",
      twilioAuthToken: "AUTH_TEST",
      createTool: async () => created,
      patchAssistant: async (_id, patch) => { patches.push(patch); },
      fetchAssistant: async () => source,
      fetchTool: async () => created,
      deleteTool: async (id) => { deletes.push(id); },
    }),
    /read-back did not verify/i
  );
  assert.equal(patches.length, 2);
  assert.equal(patches[1].model, source.model);
  assert.equal(patches[1].firstMessage, source.firstMessage);
  assert.equal(patches[1].maxDurationSeconds, source.maxDurationSeconds);
  assert.deepEqual(deletes, [created.id]);
});
