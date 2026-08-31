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
  const mapper = clone(module.mapper || {});
  mapper.url = url;
  mapper.method = "post";
  mapper.qs = query.map(([name, value]) => ({ name, value }));
  mapper.headers = upsertHeader(
    mapper.headers,
    "x-provisioning-token",
    "{{21.provisioning.authorizationToken}}"
  );
  mapper.bodyType = "multipart_form_data";
  mapper.formDataFields = [];
  mapper.parseResponse = "true";
  mapper.followRedirect = "true";
  mapper.rejectUnauthorized = "true";
  return mapper;
}

function mutateBlueprint(current) {
  const blueprint = clone(current);
  const purchase = findModule(blueprint, 9);
  const assistant = findModule(blueprint, 25);
  const imported = findModule(blueprint, 28);
  const response = findModule(blueprint, 30);

  if (purchase.module !== "http:ActionSendData" || imported.module !== "http:ActionSendData") {
    throw new Error("The expected Make HTTP modules have changed; refusing an unsafe automatic rewrite.");
  }
  if (assistant.module !== "vapi:makeApiCall2" && assistant.module !== "http:ActionSendData") {
    throw new Error("The expected Vapi assistant module has changed; refusing an unsafe automatic rewrite.");
  }

  const voiceUrl = String((purchase.mapper?.qs || []).find((item) => item.name === "voiceUrl")?.value || "").trim();
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

  assistant.module = "http:ActionSendData";
  assistant.version = 3;
  assistant.parameters = clone(purchase.parameters || {});
  const assistantDesigner = clone(assistant.metadata?.designer || {});
  assistant.metadata = clone(purchase.metadata || {});
  assistant.metadata.designer = assistantDesigner;
  assistant.mapper = httpMapperFrom(purchase, {
    url: "https://api.myaipa.ca/api/integrations/vapi/create-signup-assistant",
    query: [
      ["idempotencyKey", "{{21.provisioning.idempotencyKey}}"],
      ["contextHash", "{{21.provisioning.contextHash}}"],
      ["assignedPhone", "{{9.data.twilioPhoneNumber}}"],
    ],
  });

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
  const purchaseQuery = Object.fromEntries((purchase.mapper?.qs || []).map((item) => [item.name, item.value]));
  const assistantQuery = Object.fromEntries((assistant.mapper?.qs || []).map((item) => [item.name, item.value]));
  const importQuery = Object.fromEntries((imported.mapper?.qs || []).map((item) => [item.name, item.value]));
  const responseText = String(response.mapper?.body || "");
  const responseHeaders = Array.isArray(response.mapper?.headers) ? response.mapper.headers : [];
  const hasToken = (module) => (module.mapper?.headers || []).some(
    (item) => String(item.name || item.key || "").toLowerCase() === "x-provisioning-token"
      && String(item.value || "").includes("provisioning.authorizationToken")
  );
  return {
    preferredAreaMapped: purchaseQuery.areaCode === "{{21.provisioning.preferredAreaCode}}",
    purchaseIdempotent: purchaseQuery.idempotencyKey === "{{21.provisioning.idempotencyKey}}" && hasToken(purchase),
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

  await request(`/scenarios/${encodeURIComponent(scenarioId)}`, {
    method: "PATCH",
    body: JSON.stringify({ blueprint: JSON.stringify(repaired) }),
  });
  const after = getBlueprint(await request(`/scenarios/${encodeURIComponent(scenarioId)}/blueprint`));
  const readBackChecks = verifyBlueprint(after);
  if (!Object.values(readBackChecks).every(Boolean) || checksum(after) !== checksum(repaired)) {
    throw new Error("Make accepted the update, but exact read-back verification failed.");
  }
  console.log(JSON.stringify({ changed: true, afterChecksum: checksum(after), checks: readBackChecks }, null, 2));
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
