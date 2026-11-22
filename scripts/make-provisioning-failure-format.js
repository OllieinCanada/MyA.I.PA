"use strict";

const { isDeepStrictEqual } = require("node:util");

const STAGES = Object.freeze({
  9: Object.freeze({ stage: "number_purchase", failedStage: "TWILIO_NUMBER_PURCHASE", provider: "TWILIO", path: "twilio/purchase-number" }),
  25: Object.freeze({ stage: "assistant_creation", failedStage: "VAPI_ASSISTANT_CREATE", provider: "VAPI", path: "vapi/create-signup-assistant" }),
  28: Object.freeze({ stage: "number_binding", failedStage: "VAPI_NUMBER_IMPORT", provider: "VAPI", path: "vapi/import-twilio-number" }),
});

// Keep the established code allowlist and precedence. No raw provider data is returned.
const CODE_CASES = Object.freeze([
  ["UND_ERR_SOCKET", "UND_ERR_SOCKET"],
  ["UND_ERR_CONNECT_TIMEOUT", "UND_ERR_CONNECT_TIMEOUT"],
  ["ECONNRESET", "ECONNRESET"],
  ["PROVISIONING_RECONCILIATION_REQUIRED", "PROVISIONING_RECONCILIATION_REQUIRED"],
  ["SIGNUP_ARCHIVED_RESOURCES_STILL_OWNED", "SIGNUP_ARCHIVED_RESOURCES_STILL_OWNED"],
  ["SIGNUP_ARCHIVED_RESOURCES_UNVERIFIED", "SIGNUP_ARCHIVED_RESOURCES_UNVERIFIED"],
  ["SIGNUP_BUSINESS_MIGRATION_REQUIRED", "SIGNUP_BUSINESS_MIGRATION_REQUIRED"],
  ["SIGNUP_CLOSED", "SIGNUP_CLOSED"],
  ["LOCAL_CANADIAN_NUMBER_INVENTORY_UNAVAILABLE", "LOCAL_CANADIAN_NUMBER_INVENTORY_UNAVAILABLE"],
  ["PROVISIONING_INVENTORY_CONTEXT_MISMATCH", "PROVISIONING_INVENTORY_CONTEXT_MISMATCH"],
  ["PROVISIONING_ALREADY_IN_PROGRESS", "PROVISIONING_ALREADY_IN_PROGRESS"],
  ["PROVISIONING_RESULT_STALE", "PROVISIONING_RESULT_STALE"],
  ["registered signup context", "PROVISIONING_CONTEXT_NOT_REGISTERED"],
  ["Invalid provisioning key", "PROVISIONING_AUTH_INVALID"],
  ["Invalid signed provisioning request", "PROVISIONING_AUTHORIZATION_INVALID"],
].map((entry) => Object.freeze(entry)));

function stageFor(moduleId) {
  if (typeof moduleId !== "number" || !Object.hasOwn(STAGES, moduleId)) {
    throw new Error("MAKE_FAILURE_MODULE_UNSUPPORTED");
  }
  return STAGES[moduleId];
}

function buildSafeFailureCodeMapping(moduleId) {
  stageFor(moduleId);
  let expression = '"PROVIDER_REQUEST_FAILED"';
  for (let index = CODE_CASES.length - 1; index >= 0; index -= 1) {
    const [needle, code] = CODE_CASES[index];
    expression = `if(contains(${moduleId}.error.message; "${needle}"); "${code}"; ${expression})`;
  }
  return `{{${expression}}}`;
}

function failureEnvelope(moduleId, providerCode) {
  const { stage, failedStage, provider } = stageFor(moduleId);
  return {
    ok: false, success: false,
    error: "Signup provisioning stopped at a provider request.",
    code: "MAKE_PROVISIONING_STAGE_FAILED", stage, failedStage, provider,
    providerCode, retryable: false,
  };
}

function buildFailureBody(moduleId) {
  const marker = "__MYAIPA_FIXED_FAILURE_CODE_MAPPING__";
  // JSON-escape static values first; then insert trusted IML verbatim. Make evaluates
  // the expression before JSON parsing. Escaping its quotes here breaks the response.
  return JSON.stringify(failureEnvelope(moduleId, marker))
    .replace(marker, buildSafeFailureCodeMapping(moduleId));
}

function inspectFailureBodyTemplate(body, moduleId) {
  // This validates an exact fixed template, not arbitrary IML and not live execution.
  // The template is deliberately not JSON until Make evaluates its mapping.
  if (typeof body !== "string" || body !== buildFailureBody(moduleId)) return null;
  return JSON.parse(body.replace(buildSafeFailureCodeMapping(moduleId), "PROVIDER_REQUEST_FAILED"));
}

function isKnownLegacyBody(body, moduleId) {
  // Bind the known generator's exact legacy bytes, not merely parsed values:
  // duplicate keys, extra mappings or another operator's edits require review.
  return typeof body === "string"
    && body === JSON.stringify(failureEnvelope(moduleId, buildSafeFailureCodeMapping(moduleId)));
}

function repairFailureBodiesOnly(current) {
  if (!Array.isArray(current?.flow)
    || !isDeepStrictEqual(current.flow.map((module) => module.id), [16, 21, 9, 25, 28, 30])) {
    throw new Error("MAKE_FAILURE_FLOW_CHANGED");
  }
  const repaired = structuredClone(current);
  for (const moduleId of [9, 25, 28]) {
    const module = repaired.flow.find((item) => item.id === moduleId);
    const expected = stageFor(moduleId);
    const handler = module.onerror?.[0];
    const headers = handler?.mapper?.headers;
    if (module.module !== "http:ActionSendData" || module.version !== 3
      || module.mapper?.url !== `https://api.myaipa.ca/api/integrations/${expected.path}`
      || module.parameters?.handleErrors !== true || module.routes
      || !Array.isArray(module.onerror) || module.onerror.length !== 1
      || handler?.module !== "gateway:WebhookRespond" || handler.version !== 1
      || String(handler.mapper?.status) !== "200" || handler.routes || handler.onerror
      || !Array.isArray(headers) || headers.length !== 1
      || String(headers[0].key || headers[0].name).toLowerCase() !== "content-type"
      || String(headers[0].value).toLowerCase() !== "application/json") {
      throw new Error("MAKE_FAILURE_HANDLER_CHANGED");
    }
    const body = handler.mapper.body;
    if (!inspectFailureBodyTemplate(body, moduleId) && !isKnownLegacyBody(body, moduleId)) {
      // Do not log the unexpected body: it may contain confidential provider data.
      throw new Error("MAKE_FAILURE_BODY_UNRECOGNIZED");
    }
    handler.mapper.body = buildFailureBody(moduleId);
  }
  return repaired;
}

module.exports = {
  buildFailureBody,
  buildSafeFailureCodeMapping,
  inspectFailureBodyTemplate,
  repairFailureBodiesOnly,
};
