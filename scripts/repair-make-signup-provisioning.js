const crypto = require("crypto");
const { loadProjectEnv } = require("./_helpers");

const env = loadProjectEnv();
const baseUrl = String(env.MAKE_API_BASE_URL || "https://us2.make.com/api/v2").replace(/\/+$/, "");
const token = String(env.MAKE_API_TOKEN || env.MAKE_TOKEN || env.MAKE_API_KEY || "").trim();
const scenarioId = String(env.MAKE_SCENARIO_ID || "3530157").trim();
const shouldApply = process.argv.includes("--apply");
const confirmation = String(
  process.argv.find((argument) => argument.startsWith("--confirm="))?.split("=")[1] || ""
).trim();
const EXPECTED_CONFIRMATION = "REPAIR_MAKE_SIGNUP";

function checksum(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Token ${token}`,
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = {}; }
  if (!response.ok) {
    throw new Error(`Make request failed with HTTP ${response.status}: ${String(body.message || body.error || "request failed").slice(0, 200)}`);
  }
  return body;
}

function getBlueprint(response) {
  const blueprint = response?.response?.blueprint || response?.blueprint || response;
  if (!blueprint || !Array.isArray(blueprint.flow)) throw new Error("Make did not return a valid scenario blueprint.");
  return blueprint;
}

function findModule(blueprint, id) {
  const module = blueprint.flow.find((item) => Number(item.id) === Number(id));
  if (!module) throw new Error(`Expected Make module ${id} was not found.`);
  return module;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function upsertHeader(headers, name, value) {
  const items = Array.isArray(headers) ? clone(headers) : [];
  const index = items.findIndex((item) => String(item.name || item.key || "").toLowerCase() === name.toLowerCase());
  const next = { name, value };
  if (index >= 0) items[index] = next;
  else items.push(next);
  return items;
}

function httpMapperFrom(module, { url, query }) {
  const headers = upsertHeader(
    module.mapper?.headers,
    "x-provisioning-token",
    "{{21.provisioning.authorizationToken}}"
  );
  return {
    ca: "",
    qs: query.map(([name, value]) => ({ name, value })),
    url,
    gzip: true,
    method: "post",
    headers,
    timeout: "",
    authPass: "",
    authUser: "",
    bodyType: "",
    shareCookies: false,
    parseResponse: true,
    followRedirect: true,
    useQuerystring: false,
    rejectUnauthorized: true,
  };
}

function legacyHttpMetadata(designer = {}) {
  return {
    designer: clone(designer),
    restore: {
      qs: { mode: "chose", items: [] },
      method: { mode: "chose", label: "POST" },
      headers: { mode: "chose", items: [] },
      bodyType: { label: "" },
    },
    parameters: [{
      name: "handleErrors",
      type: "boolean",
      label: "Evaluate all states as errors (except for 2xx and 3xx )",
      required: true,
    }],
    expect: [
      { name: "url", type: "url", label: "URL", required: true },
      { name: "method", type: "select", label: "Method", required: true, validate: { enum: ["get", "head", "post", "put", "patch", "delete"] } },
      { name: "headers", spec: [{ name: "name", type: "text", label: "Name", required: true }, { name: "value", type: "text", label: "Value" }], type: "array", label: "Headers", labels: { add: "Add a header", edit: "Edit a header" } },
      { name: "qs", spec: [{ name: "name", type: "text", label: "Name", required: true }, { name: "value", type: "text", label: "Value" }], type: "array", label: "Query String", labels: { add: "Add parameter", edit: "Edit parameter" } },
      { name: "bodyType", type: "select", label: "Body type", validate: { enum: ["raw", "x_www_form_urlencoded", "multipart_form_data"] } },
      { name: "parseResponse", type: "boolean", label: "Parse response", required: true },
      { name: "authUser", type: "text", label: "User name" },
      { name: "authPass", type: "password", label: "Password" },
      { name: "timeout", type: "uinteger", label: "Timeout", validate: { max: 300, min: 1 } },
      { name: "shareCookies", type: "boolean", label: "Share cookies with other HTTP modules", required: true },
      { name: "ca", type: "cert", label: "Self-signed certificate", multiline: true },
      { name: "rejectUnauthorized", type: "boolean", label: "Reject connections that are using unverified (self-signed) certificates", required: true },
      { name: "followRedirect", type: "boolean", label: "Follow redirect", required: true },
      { name: "useQuerystring", type: "boolean", label: "Disable serialization of multiple same query string keys as arrays", required: true },
      { name: "gzip", type: "boolean", label: "Request compressed content", required: true },
    ],
  };
}

function mutateBlueprint(current) {
  const blueprint = clone(current);
  const purchase = findModule(blueprint, 9);
  const assistant = findModule(blueprint, 25);
  const imported = findModule(blueprint, 28);
  const response = findModule(blueprint, 30);

  if (!["http:ActionSendData", "http:MakeRequest"].includes(purchase.module)
    || !["http:ActionSendData", "http:MakeRequest"].includes(imported.module)) {
    throw new Error("The expected Make HTTP modules have changed; refusing an unsafe automatic rewrite.");
  }
  if (!["vapi:makeApiCall2", "http:ActionSendData", "http:MakeRequest"].includes(assistant.module)) {
    throw new Error("The expected Vapi assistant module has changed; refusing an unsafe automatic rewrite.");
  }

  let existingJsonBody = {};
  try { existingJsonBody = JSON.parse(String(purchase.mapper?.jsonStringBodyContent || "{}")); } catch { existingJsonBody = {}; }
  const voiceUrl = String(
    (purchase.mapper?.qs || []).find((item) => item.name === "voiceUrl")?.value
      || existingJsonBody.voiceUrl
      || ""
  ).trim();
  if (!/^https:\/\/hook(?:\.[a-z0-9-]+)*\.make\.com\//i.test(voiceUrl)) {
    throw new Error("The existing trusted Make voice webhook URL could not be retained.");
  }

  purchase.mapper = httpMapperFrom(purchase, {
    url: "https://api.myaipa.ca/api/integrations/twilio/purchase-number",
    query: [
      ["areaCode", "{{21.provisioning.preferredAreaCode}}"],
      ["region", "{{21.provisioning.preferredRegion}}"],
      ["voiceUrl", voiceUrl],
      ["voiceMethod", "POST"],
      ["idempotencyKey", "{{21.provisioning.idempotencyKey}}"],
      ["contextHash", "{{21.provisioning.contextHash}}"],
    ],
  });

  purchase.module = "http:ActionSendData";
  purchase.version = 3;
  purchase.parameters = { handleErrors: false };
  purchase.metadata = legacyHttpMetadata(purchase.metadata?.designer || {});
  delete purchase.onerror;

  assistant.module = "http:ActionSendData";
  assistant.version = 3;
  assistant.parameters = { handleErrors: false };
  delete assistant.onerror;
  const assistantDesigner = clone(assistant.metadata?.designer || {});
  assistant.metadata = legacyHttpMetadata(assistantDesigner);
  assistant.mapper = httpMapperFrom(purchase, {
    url: "https://api.myaipa.ca/api/integrations/vapi/create-signup-assistant",
    query: [
      ["idempotencyKey", "{{21.provisioning.idempotencyKey}}"],
      ["contextHash", "{{21.provisioning.contextHash}}"],
      ["assignedPhone", "{{9.data.twilioPhoneNumber}}"],
    ],
  });

  imported.module = "http:ActionSendData";
  imported.version = 3;
  imported.parameters = { handleErrors: false };
  imported.metadata = legacyHttpMetadata(imported.metadata?.designer || {});
  delete imported.onerror;
  imported.mapper = httpMapperFrom(imported, {
    url: "https://api.myaipa.ca/api/integrations/vapi/import-twilio-number",
    query: [
      ["idempotencyKey", "{{21.provisioning.idempotencyKey}}"],
      ["contextHash", "{{21.provisioning.contextHash}}"],
      ["twilioPhoneNumber", "{{9.data.twilioPhoneNumber}}"],
      ["assistantId", "{{25.data.assistantId}}"],
    ],
  });
  imported.mapper.headers = (imported.mapper.headers || []).filter(
    (item) => String(item.name || item.key || "").toLowerCase() !== "x-signup-owner-email"
  );

  response.mapper.body = JSON.stringify({
    success: true,
    ok: true,
    message: "Setup complete",
    twilioPhoneNumber: "{{28.data.twilioPhoneNumber}}",
    vapiPhoneNumberId: "{{28.data.phoneNumberId}}",
    vapiAssistantId: "{{25.data.assistantId}}",
  }, null, 2);
  response.mapper.status = "200";
  response.mapper.headers = [{ key: "Content-Type", value: "application/json" }];

  if (blueprint.metadata?.scenario && typeof blueprint.metadata.scenario === "object") {
    // The backend owns per-signup idempotency and concurrency. Queuing an instant
    // webhook makes Make return its generic "Accepted" acknowledgement before the
    // final Webhook Response module can return the verified provisioning receipt.
    blueprint.metadata.scenario.sequential = false;
    blueprint.metadata.scenario.confidential = true;
  }
  return blueprint;
}

function verifyBlueprint(blueprint) {
  const purchase = findModule(blueprint, 9);
  const assistant = findModule(blueprint, 25);
  const imported = findModule(blueprint, 28);
  const response = findModule(blueprint, 30);
  const parseQuery = (module) => Object.fromEntries((module.mapper?.qs || []).map((item) => [item.name, item.value]));
  const purchaseQuery = parseQuery(purchase);
  const assistantQuery = parseQuery(assistant);
  const importQuery = parseQuery(imported);
  const responseText = String(response.mapper?.body || "");
  const responseHeaders = Array.isArray(response.mapper?.headers) ? response.mapper.headers : [];
  const hasToken = (module) => (module.mapper?.headers || []).some(
    (item) => String(item.name || item.key || "").toLowerCase() === "x-provisioning-token"
      && String(item.value || "").includes("provisioning.authorizationToken")
  );
  return {
    preferredAreaMapped: purchaseQuery.areaCode === "{{21.provisioning.preferredAreaCode}}",
    purchaseIdempotent: purchaseQuery.idempotencyKey === "{{21.provisioning.idempotencyKey}}" && hasToken(purchase),
    compatibleHttpModules: [purchase, assistant, imported].every((module) => module.module === "http:ActionSendData" && Number(module.version) === 3),
    nativeFailClosed: [purchase, assistant, imported].every((module) => !Array.isArray(module.onerror)
      || module.onerror.length === 0),
    assistantBackendOwned: assistant.module === "http:ActionSendData"
      && assistant.mapper?.url === "https://api.myaipa.ca/api/integrations/vapi/create-signup-assistant"
      && assistantQuery.assignedPhone === "{{9.data.twilioPhoneNumber}}"
      && (assistant.metadata?.expect || []).some((item) => item.name === "url")
      && !(assistant.metadata?.expect || []).some((item) => item.name === "relativeURL")
      && hasToken(assistant),
    importIdempotent: importQuery.idempotencyKey === "{{21.provisioning.idempotencyKey}}"
      && importQuery.assistantId === "{{25.data.assistantId}}"
      && hasToken(imported),
    responseCorrect: responseText.includes("{{28.data.twilioPhoneNumber}}")
      && responseText.includes("{{28.data.phoneNumberId}}")
      && responseText.includes("{{25.data.assistantId}}")
      && responseHeaders.some((item) => (
        String(item.key || item.name || "").trim().toLowerCase() === "content-type"
          && String(item.value || "").trim().toLowerCase() === "application/json"
      )),
    instantResponseEnabled: blueprint.metadata?.scenario?.sequential === false,
    noFixed249: purchaseQuery.areaCode !== "249",
  };
}

async function main() {
  if (!token) throw new Error("MAKE_API_TOKEN is not configured.");
  const before = getBlueprint(await request(`/scenarios/${encodeURIComponent(scenarioId)}/blueprint`));
  const beforeChecksum = checksum(before);
  const repaired = mutateBlueprint(before);
  const checks = verifyBlueprint(repaired);
  if (!Object.values(checks).every(Boolean)) throw new Error("The repaired Make blueprint failed its local safety checks.");

  console.log(JSON.stringify({
    mode: shouldApply ? "apply" : "dry-run",
    scenarioId,
    beforeChecksum,
    proposedChecksum: checksum(repaired),
    checks,
  }, null, 2));

  if (!shouldApply) {
    console.log(`Dry run only. Re-run with --apply --confirm=${EXPECTED_CONFIRMATION} after the backend is deployed.`);
    return;
  }
  if (confirmation !== EXPECTED_CONFIRMATION) {
    throw new Error(`Refusing to modify Make without --confirm=${EXPECTED_CONFIRMATION}.`);
  }

  await request(`/scenarios/${encodeURIComponent(scenarioId)}?confirmed=true`, {
    method: "PATCH",
    body: JSON.stringify({ blueprint: JSON.stringify(repaired) }),
  });
  const after = getBlueprint(await request(`/scenarios/${encodeURIComponent(scenarioId)}/blueprint`));
  const readBackChecks = verifyBlueprint(after);
  if (!Object.values(readBackChecks).every(Boolean)) {
    throw new Error("Make accepted the update, but semantic read-back verification failed.");
  }
  console.log(JSON.stringify({ changed: true, afterChecksum: checksum(after), normalizedByMake: checksum(after) !== checksum(repaired), checks: readBackChecks }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}

module.exports = {
  mutateBlueprint,
  verifyBlueprint,
};
