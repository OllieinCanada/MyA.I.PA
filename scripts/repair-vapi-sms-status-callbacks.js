const crypto = require("crypto");
const { loadProjectEnv } = require("./_helpers");
const { isManagedIsolatedTool } = require("../server/vapiIsolatedSmsProvisioning");

const CALLBACK_ENV_NAME = "TWILIO_STATUS_CALLBACK_URL";
const CALLBACK_URL = "https://api.myaipa.ca/api/webhooks/twilio/message-status";
const CONFIRMATION_PHRASE = "SET_VAPI_SMS_STATUS_CALLBACKS_V1";
const TOOL_LIST_LIMIT = 1000;
const REQUEST_TIMEOUT_MS = 15_000;

function listFrom(value, keys = []) {
  if (Array.isArray(value)) return value;
  for (const key of ["data", "results", ...keys]) {
    if (Array.isArray(value?.[key])) return value[key];
  }
  return [];
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])])
  );
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function shortHash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 12);
}

function configurationHash(value) {
  return shortHash(stableJson(value));
}

function toolName(tool) {
  return String(tool?.function?.name || tool?.name || "").trim();
}

function isManagedSummaryTool(tool) {
  return /^send_call_summaries_/i.test(toolName(tool)) && isManagedIsolatedTool(tool);
}

function looksMasked(value) {
  const text = String(value ?? "").trim();
  return /^\*{3,}/.test(text)
    || /\bredacted\b/i.test(text)
    || /^<?masked>?$/i.test(text)
    || /^x{6,}$/i.test(text);
}

function withoutVolatileFields(tool) {
  const output = {};
  for (const [key, value] of Object.entries(tool || {})) {
    if (key === "environmentVariables" || key === "updatedAt") continue;
    output[key] = value;
  }
  return output;
}

function replaceStatusCallback(environmentVariables, callbackUrl = CALLBACK_URL) {
  if (!Array.isArray(environmentVariables)) {
    throw new Error("A managed Vapi tool has no readable environment-variable array.");
  }
  const callbackIndexes = [];
  environmentVariables.forEach((entry, index) => {
    if (!entry || typeof entry !== "object" || !String(entry.name || "").trim()) {
      throw new Error("A managed Vapi tool contains a malformed environment variable.");
    }
    if (String(entry.name).trim() === CALLBACK_ENV_NAME) callbackIndexes.push(index);
    if (looksMasked(entry.value)) {
      throw new Error("A managed Vapi tool contains a masked value and cannot be rewritten safely.");
    }
  });
  if (callbackIndexes.length > 1) {
    throw new Error("A managed Vapi tool contains duplicate status-callback variables.");
  }
  const output = environmentVariables.map((entry) => ({ ...entry }));
  if (callbackIndexes.length === 1) {
    const index = callbackIndexes[0];
    output[index] = { ...output[index], value: callbackUrl };
  } else {
    output.push({ name: CALLBACK_ENV_NAME, value: callbackUrl });
  }
  return output;
}

function inspectReadback(before, after, desiredEnvironmentVariables, callbackUrl = CALLBACK_URL) {
  const afterEnvironment = Array.isArray(after?.environmentVariables) ? after.environmentVariables : [];
  const callbackEntries = afterEnvironment.filter((entry) => String(entry?.name || "").trim() === CALLBACK_ENV_NAME);
  const checks = {
    sameTool: String(before?.id || "") === String(after?.id || "") && Boolean(String(after?.id || "")),
    stillManaged: isManagedSummaryTool(after),
    callbackExact: callbackEntries.length === 1 && String(callbackEntries[0]?.value || "") === callbackUrl,
    environmentExact: stableJson(afterEnvironment) === stableJson(desiredEnvironmentVariables),
    otherConfigurationExact: stableJson(withoutVolatileFields(after)) === stableJson(withoutVolatileFields(before)),
  };
  return { ok: Object.values(checks).every(Boolean), checks };
}

function buildToolPlan(tool, callbackUrl = CALLBACK_URL) {
  const id = String(tool?.id || "").trim();
  if (!id) throw new Error("A managed Vapi tool has no readable identifier.");
  if (!isManagedSummaryTool(tool)) throw new Error("A non-managed Vapi tool reached the repair planner.");
  const desiredEnvironmentVariables = replaceStatusCallback(tool.environmentVariables, callbackUrl);
  const needsChange = stableJson(desiredEnvironmentVariables) !== stableJson(tool.environmentVariables);
  const desiredTool = { ...tool, environmentVariables: desiredEnvironmentVariables };
  return {
    id,
    toolHash: shortHash(id),
    originalEnvironmentVariables: tool.environmentVariables.map((entry) => ({ ...entry })),
    desiredEnvironmentVariables,
    needsChange,
    beforeConfigurationHash: configurationHash(tool),
    desiredConfigurationHash: configurationHash(desiredTool),
  };
}

function safeReport({ mode, listedCount, plans, applied = [], verified = [], rolledBack = [], failed = [] }) {
  const changes = plans.filter((plan) => plan.needsChange);
  return {
    mode,
    callbackUrlHash: shortHash(CALLBACK_URL),
    counts: {
      listed: listedCount,
      managed: plans.length,
      alreadyCorrect: plans.length - changes.length,
      planned: changes.length,
      applied: applied.length,
      verified: verified.length,
      rolledBack: rolledBack.length,
      failed: failed.length,
    },
    managedToolHashes: plans.map((plan) => plan.toolHash).sort(),
    plannedToolHashes: changes.map((plan) => plan.toolHash).sort(),
    appliedToolHashes: [...applied].sort(),
    verifiedToolHashes: [...verified].sort(),
    rolledBackToolHashes: [...rolledBack].sort(),
    failedToolHashes: [...failed].sort(),
    beforeConfigurationHashes: plans.map((plan) => plan.beforeConfigurationHash).sort(),
    desiredConfigurationHashes: plans.map((plan) => plan.desiredConfigurationHash).sort(),
  };
}

function createVapiClient({ apiKey, apiBaseUrl, fetchImpl = globalThis.fetch }) {
  if (!String(apiKey || "").trim()) throw new Error("VAPI_API_KEY is not configured.");
  if (typeof fetchImpl !== "function") throw new Error("A fetch implementation is required.");
  const baseUrl = String(apiBaseUrl || "https://api.vapi.ai").trim().replace(/\/+$/, "");
  async function request(endpoint, { method = "GET", body, label = "Vapi request" } = {}) {
    let response;
    try {
      response = await fetchImpl(`${baseUrl}${endpoint}`, {
        method,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: {
          Authorization: `Bearer ${String(apiKey).trim()}`,
          Accept: "application/json",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (_error) {
      throw new Error(`${label} could not be completed.`);
    }
    const text = await response.text();
    let payload = {};
    try { payload = text ? JSON.parse(text) : {}; } catch (_error) { payload = {}; }
    if (!response.ok) throw new Error(`${label} failed with HTTP ${response.status}.`);
    return payload;
  }
  return {
    listTools: () => request(`/tool?limit=${TOOL_LIST_LIMIT}`, { label: "Vapi tool inventory" }),
    getTool: (id) => request(`/tool/${encodeURIComponent(id)}`, { label: "Vapi tool readback" }),
    patchToolEnvironment: (id, environmentVariables) => request(`/tool/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: { environmentVariables },
      label: "Vapi tool update",
    }),
  };
}

async function rollbackChangedTools(client, changedPlans) {
  const rolledBack = [];
  const failed = [];
  for (const plan of [...changedPlans].reverse()) {
    try {
      await client.patchToolEnvironment(plan.id, plan.originalEnvironmentVariables);
      const readback = await client.getTool(plan.id);
      const check = inspectReadback(
        { ...readback, environmentVariables: plan.originalEnvironmentVariables },
        readback,
        plan.originalEnvironmentVariables,
        plan.originalEnvironmentVariables.find((entry) => String(entry?.name || "").trim() === CALLBACK_ENV_NAME)?.value || ""
      );
      const rootExact = stableJson(withoutVolatileFields(readback)) === stableJson(withoutVolatileFields(plan.originalTool));
      const environmentExact = stableJson(readback.environmentVariables) === stableJson(plan.originalEnvironmentVariables);
      if (!rootExact || !environmentExact || !check.checks.sameTool || !check.checks.stillManaged) {
        throw new Error("Rollback readback did not match the original tool.");
      }
      rolledBack.push(plan.toolHash);
    } catch (_error) {
      failed.push(plan.toolHash);
    }
  }
  return { rolledBack, failed };
}

async function repairStatusCallbacks({
  client,
  apply = false,
  confirmation = "",
  callbackUrl = CALLBACK_URL,
} = {}) {
  if (!client || typeof client.listTools !== "function" || typeof client.getTool !== "function" || typeof client.patchToolEnvironment !== "function") {
    throw new Error("A complete Vapi repair client is required.");
  }
  if (callbackUrl !== CALLBACK_URL) throw new Error("The production callback URL is fixed and cannot be overridden.");
  if (apply && confirmation !== CONFIRMATION_PHRASE) {
    throw new Error(`Apply mode requires --confirm=${CONFIRMATION_PHRASE}.`);
  }

  const inventoryPayload = await client.listTools();
  const summaries = listFrom(inventoryPayload, ["tools"]);
  if (summaries.length >= TOOL_LIST_LIMIT) {
    throw new Error("Vapi tool inventory reached the safety limit; no updates were attempted.");
  }
  const managedSummaries = summaries.filter(isManagedSummaryTool);
  const ids = managedSummaries.map((tool) => String(tool?.id || "").trim());
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) {
    throw new Error("Vapi managed-tool inventory is incomplete or duplicated; no updates were attempted.");
  }
  if (apply && managedSummaries.length === 0) {
    throw new Error("No managed Vapi SMS tools were found; no updates were attempted.");
  }

  const details = [];
  for (const summary of managedSummaries) {
    const detail = await client.getTool(summary.id);
    if (String(detail?.id || "").trim() !== String(summary.id)) {
      throw new Error("Vapi managed-tool detail did not match its inventory entry; no updates were attempted.");
    }
    details.push(detail);
  }
  const plans = details.map((tool) => ({ ...buildToolPlan(tool, callbackUrl), originalTool: tool }));
  if (new Set(plans.map((plan) => plan.id)).size !== plans.length) {
    throw new Error("Vapi managed-tool readback is duplicated; no updates were attempted.");
  }
  if (!apply) return safeReport({ mode: "dry-run", listedCount: summaries.length, plans });

  const applied = [];
  const verified = [];
  const changedPlans = [];
  let failedPlan = null;
  try {
    for (const plan of plans.filter((item) => item.needsChange)) {
      failedPlan = plan;
      changedPlans.push(plan);
      await client.patchToolEnvironment(plan.id, plan.desiredEnvironmentVariables);
      applied.push(plan.toolHash);
      const readback = await client.getTool(plan.id);
      const check = inspectReadback(plan.originalTool, readback, plan.desiredEnvironmentVariables, callbackUrl);
      if (!check.ok) throw new Error("Vapi readback did not verify an isolated callback-only update.");
      verified.push(plan.toolHash);
      failedPlan = null;
    }
  } catch (_error) {
    const rollback = await rollbackChangedTools(client, changedPlans);
    const report = safeReport({
      mode: "apply-failed",
      listedCount: summaries.length,
      plans,
      applied,
      verified,
      rolledBack: rollback.rolledBack,
      failed: [...new Set([...(failedPlan ? [failedPlan.toolHash] : []), ...rollback.failed])],
    });
    const error = new Error(rollback.failed.length
      ? "Vapi callback repair failed and one or more rollback readbacks also failed."
      : "Vapi callback repair failed; verified updates were rolled back.");
    error.safeReport = report;
    throw error;
  }

  return safeReport({
    mode: "apply",
    listedCount: summaries.length,
    plans,
    applied,
    verified,
  });
}

function parseArgs(args) {
  const allowed = args.every((arg) => arg === "--apply" || arg.startsWith("--confirm="));
  if (!allowed) throw new Error("Unsupported command-line argument.");
  return {
    apply: args.includes("--apply"),
    confirmation: args.find((arg) => arg.startsWith("--confirm="))?.slice("--confirm=".length) || "",
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = loadProjectEnv();
  const client = createVapiClient({
    apiKey: env.VAPI_API_KEY || env.VAPI_KEY || env.VAPI_TOKEN,
    apiBaseUrl: env.VAPI_API_BASE_URL,
  });
  const report = await repairStatusCallbacks({ client, ...args });
  console.log(JSON.stringify(report, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    if (error?.safeReport) console.error(JSON.stringify(error.safeReport, null, 2));
    console.error(String(error?.message || "Vapi callback repair failed."));
    process.exitCode = 1;
  });
}

module.exports = {
  CALLBACK_ENV_NAME,
  CALLBACK_URL,
  CONFIRMATION_PHRASE,
  buildToolPlan,
  configurationHash,
  createVapiClient,
  inspectReadback,
  isManagedSummaryTool,
  parseArgs,
  repairStatusCallbacks,
  replaceStatusCallback,
  shortHash,
  stableJson,
  withoutVolatileFields,
};
