const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { loadProjectEnv } = require("./_helpers");

const env = loadProjectEnv();
const baseUrl = String(env.MAKE_API_BASE_URL || "https://us2.make.com/api/v2").replace(/\/+$/, "");
const token = String(env.MAKE_API_TOKEN || env.MAKE_TOKEN || env.MAKE_API_KEY || "").trim();
const apply = process.argv.includes("--apply");
const confirmation = String(process.argv.find((arg) => arg.startsWith("--confirm="))?.split("=")[1] || "");
const EXPECTED = "HARDEN_LEGACY_MAKE";
const assistantRequestScenarioId = "4482406";
const retiredSpeechDemoScenarioId = "3559448";

async function request(endpoint, options = {}) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Token ${token}`,
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = {}; }
  if (!response.ok) throw new Error(`Make request failed with HTTP ${response.status}: ${String(body.message || body.error || "request failed").slice(0, 220)}`);
  return body;
}

function blueprintFrom(payload) {
  return payload?.response?.blueprint || payload?.blueprint || payload;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function checksum(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}

function hardenAssistantRequestBlueprint(current) {
  const blueprint = clone(current);
  const responses = [];
  const walk = (flow) => {
    for (const module of flow || []) {
      if (module.module === "gateway:WebhookRespond") {
        responses.push(module);
        const body = String(module.mapper?.body || "");
        module.mapper.body = body
          .replace(/\{\{26\.data\.results\[\]\.result\.customer\.name\}\}/g, "")
          .replace(/\{\{26\.data\.results\[\]\.result\.customer\.lastCallReason\}\}/g, "")
          .replace(/\{\{26\.data\.results\[\]\.result\.customer\.lastCallAt\}\}/g, "");
        module.mapper.headers = [{ key: "Content-Type", value: "application/json" }];
      }
      for (const route of module.routes || []) walk(route.flow || route);
    }
  };
  walk(blueprint.flow);
  if (!blueprint.flow.some((module) => module.module === "gateway:CustomWebHook") || !responses.length) throw new Error("The assistant-request scenario shape changed; refusing rewrite.");
  const assistantIds = [...new Set(responses.map((module) => String(module.mapper?.body || "").match(/\"assistantId\"\s*:\s*\"([^\"]+)\"/)?.[1]).filter(Boolean))];
  if (assistantIds.length !== 1 || !/^[0-9a-f-]{36}$/i.test(assistantIds[0])) throw new Error("Could not preserve one trusted assistant ID.");
  blueprint.flow = blueprint.flow.filter((module) => module.id !== 26);
  if (blueprint.metadata?.scenario) {
    blueprint.metadata.scenario.confidential = true;
    blueprint.metadata.scenario.dataloss = false;
    blueprint.metadata.scenario.maxErrors = 3;
  }
  return blueprint;
}

function verifyHardened(blueprint) {
  const flow = Array.isArray(blueprint?.flow) ? blueprint.flow : [];
  const text = JSON.stringify(flow.map((module) => ({
    id: module.id,
    module: module.module,
    mapper: module.mapper,
    parameters: module.parameters,
    routes: module.routes,
  })));
  const responseBodies = [];
  const walk = (items) => {
    for (const module of items || []) {
      if (module.module === "gateway:WebhookRespond") responseBodies.push(String(module.mapper?.body || ""));
      for (const route of module.routes || []) walk(route.flow || route);
    }
  };
  walk(flow);
  return {
    routingTopologyPreserved: flow.some((module) => module.module === "gateway:CustomWebHook")
      && flow.some((module) => module.module === "builtin:BasicRouter")
      && responseBodies.length === 3,
    noExternalPiiLookup: !text.includes("vapi-169594110784.us-central1.run.app") && !text.includes("{{26."),
    assistantPreserved: responseBodies.every((body) => /\"assistantId\"\s*:\s*\"[0-9a-f-]{36}\"/i.test(body)),
    confidential: blueprint?.metadata?.scenario?.confidential === true,
  };
}

async function main() {
  if (!token) throw new Error("MAKE_API_TOKEN is not configured.");
  if (apply && confirmation !== EXPECTED) throw new Error(`Apply mode requires --confirm=${EXPECTED}.`);
  const [assistantPayload, retiredPayload, retiredDetails] = await Promise.all([
    request(`/scenarios/${assistantRequestScenarioId}/blueprint`),
    request(`/scenarios/${retiredSpeechDemoScenarioId}/blueprint`),
    request(`/scenarios/${retiredSpeechDemoScenarioId}`),
  ]);
  const before = blueprintFrom(assistantPayload);
  const retiredBefore = blueprintFrom(retiredPayload);
  const hardened = hardenAssistantRequestBlueprint(before);
  const checks = verifyHardened(hardened);
  if (!Object.values(checks).every(Boolean)) throw new Error(`Hardened assistant-request blueprint failed checks: ${JSON.stringify(checks)}`);
  console.log(JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    assistantRequest: { beforeChecksum: checksum(before), proposedChecksum: checksum(hardened), checks },
    speechDemo: { active: Boolean((retiredDetails.scenario || retiredDetails).isActive), action: "deactivate-and-retain-for-rollback" },
  }, null, 2));
  if (!apply) return;

  const backupDir = path.join(process.cwd(), "diagnostics", "make-hardening");
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  fs.writeFileSync(path.join(backupDir, `before-${stamp}.json`), JSON.stringify({
    createdAt: new Date().toISOString(),
    scenarios: {
      [assistantRequestScenarioId]: before,
      [retiredSpeechDemoScenarioId]: retiredBefore,
    },
  }, null, 2), { encoding: "utf8", flag: "wx" });

  await request(`/scenarios/${assistantRequestScenarioId}`, {
    method: "PATCH",
    body: JSON.stringify({ blueprint: JSON.stringify(hardened) }),
  });
  if (Boolean((retiredDetails.scenario || retiredDetails).isActive)) {
    await request(`/scenarios/${retiredSpeechDemoScenarioId}/stop`, { method: "POST" });
  }
  const [afterPayload, retiredAfterPayload] = await Promise.all([
    request(`/scenarios/${assistantRequestScenarioId}/blueprint`),
    request(`/scenarios/${retiredSpeechDemoScenarioId}`),
  ]);
  const afterChecks = verifyHardened(blueprintFrom(afterPayload));
  const retired = retiredAfterPayload.scenario || retiredAfterPayload;
  if (!Object.values(afterChecks).every(Boolean) || retired.isActive) throw new Error("Make hardening read-back verification failed.");
  console.log(JSON.stringify({ ok: true, assistantRequestChecks: afterChecks, speechDemoActive: false, rollbackBackupCreated: true }, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});

module.exports = { hardenAssistantRequestBlueprint, verifyHardened };
