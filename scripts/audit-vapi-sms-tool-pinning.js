const crypto = require("crypto");
const { loadProjectEnv } = require("./_helpers");
const { isManagedIsolatedTool } = require("../server/vapiIsolatedSmsProvisioning");

const INVENTORY_LIMIT = 1000;
const REQUEST_TIMEOUT_MS = 15_000;

function listFrom(value, keys = []) {
  if (Array.isArray(value)) return value;
  for (const key of ["data", "results", ...keys]) {
    if (Array.isArray(value?.[key])) return value[key];
  }
  return [];
}

function shortHash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 12);
}

function toolName(tool) {
  return String(tool?.function?.name || tool?.name || "").trim();
}

function isManagedSummaryTool(tool) {
  return /^send_call_summaries_/i.test(toolName(tool)) && isManagedIsolatedTool(tool);
}

function referenceKind(version) {
  const normalized = String(version ?? "").trim().toLowerCase();
  return !normalized || normalized === "latest" || normalized === "current" ? "latest" : "pinned";
}

function assistantReferences(assistant) {
  const references = [];
  const sources = [assistant?.model, assistant].filter((value) => value && typeof value === "object");
  for (const source of sources) {
    if (source.toolIds !== undefined && !Array.isArray(source.toolIds)) {
      throw new Error("A Vapi assistant has a malformed toolIds field.");
    }
    if (source.toolRefs !== undefined && !Array.isArray(source.toolRefs)) {
      throw new Error("A Vapi assistant has a malformed toolRefs field.");
    }
    for (const rawId of source.toolIds || []) {
      const toolId = String(rawId || "").trim();
      if (!toolId) throw new Error("A Vapi assistant has a blank tool reference.");
      references.push({ toolId, kind: "latest" });
    }
    for (const rawRef of source.toolRefs || []) {
      if (!rawRef || typeof rawRef !== "object" || Array.isArray(rawRef)) {
        throw new Error("A Vapi assistant has a malformed versioned tool reference.");
      }
      const toolId = String(rawRef.toolId || "").trim();
      if (!toolId) throw new Error("A Vapi assistant has a blank versioned tool reference.");
      references.push({ toolId, kind: referenceKind(rawRef.version) });
    }
  }
  const ids = references.map((reference) => reference.toolId);
  if (new Set(ids).size !== ids.length) {
    throw new Error("A Vapi assistant has duplicate or ambiguous tool references.");
  }
  return references;
}

function validateInventory(items, label) {
  if (items.length >= INVENTORY_LIMIT) {
    throw new Error(`${label} inventory reached the safety limit.`);
  }
  const ids = items.map((item) => String(item?.id || "").trim());
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) {
    throw new Error(`${label} inventory contains blank or duplicate identifiers.`);
  }
}

function auditToolPinning({ toolPayload, assistantPayload }) {
  const tools = listFrom(toolPayload, ["tools"]);
  const assistants = listFrom(assistantPayload, ["assistants"]);
  validateInventory(tools, "Vapi tool");
  validateInventory(assistants, "Vapi assistant");

  const managedTools = tools.filter(isManagedSummaryTool);
  const managedIds = new Set(managedTools.map((tool) => String(tool.id)));
  const referenceRows = [];
  for (const assistant of assistants) {
    const assistantId = String(assistant.id);
    for (const reference of assistantReferences(assistant)) {
      if (!managedIds.has(reference.toolId)) continue;
      referenceRows.push({ assistantId, ...reference });
    }
  }

  const latestRows = referenceRows.filter((row) => row.kind === "latest");
  const pinnedRows = referenceRows.filter((row) => row.kind === "pinned");
  const referencedIds = new Set(referenceRows.map((row) => row.toolId));
  const latestIds = new Set(latestRows.map((row) => row.toolId));
  const pinnedIds = new Set(pinnedRows.map((row) => row.toolId));

  return {
    mode: "read-only",
    liveConfigurationChanged: false,
    counts: {
      listedTools: tools.length,
      listedAssistants: assistants.length,
      managedTools: managedTools.length,
      referencedManagedTools: referencedIds.size,
      unreferencedManagedTools: managedTools.length - referencedIds.size,
      managedReferences: referenceRows.length,
      latestReferences: latestRows.length,
      pinnedReferences: pinnedRows.length,
      assistantsReferencingManagedTools: new Set(referenceRows.map((row) => row.assistantId)).size,
    },
    safeToPublishWithoutAssistantVersionChanges: pinnedRows.length === 0,
    managedToolHashes: [...managedIds].map(shortHash).sort(),
    latestToolHashes: [...latestIds].map(shortHash).sort(),
    pinnedToolHashes: [...pinnedIds].map(shortHash).sort(),
    referenceHashes: referenceRows
      .map((row) => shortHash(`${row.assistantId}:${row.toolId}:${row.kind}`))
      .sort(),
  };
}

function createReadOnlyVapiClient({ apiKey, apiBaseUrl, fetchImpl = globalThis.fetch }) {
  if (!String(apiKey || "").trim()) throw new Error("VAPI_API_KEY is not configured.");
  if (typeof fetchImpl !== "function") throw new Error("A fetch implementation is required.");
  const baseUrl = String(apiBaseUrl || "https://api.vapi.ai").trim().replace(/\/+$/, "");
  async function get(endpoint, label) {
    let response;
    try {
      response = await fetchImpl(`${baseUrl}${endpoint}`, {
        method: "GET",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: {
          Authorization: `Bearer ${String(apiKey).trim()}`,
          Accept: "application/json",
        },
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
    listTools: () => get(`/tool?limit=${INVENTORY_LIMIT}`, "Vapi tool inventory"),
    listAssistants: () => get(`/assistant?limit=${INVENTORY_LIMIT}`, "Vapi assistant inventory"),
  };
}

async function main() {
  const env = loadProjectEnv();
  const client = createReadOnlyVapiClient({
    apiKey: env.VAPI_API_KEY || env.VAPI_KEY || env.VAPI_TOKEN,
    apiBaseUrl: env.VAPI_API_BASE_URL,
  });
  const [toolPayload, assistantPayload] = await Promise.all([
    client.listTools(),
    client.listAssistants(),
  ]);
  console.log(JSON.stringify(auditToolPinning({ toolPayload, assistantPayload }), null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(String(error?.message || "Vapi tool-pinning audit failed.").slice(0, 500));
    process.exitCode = 1;
  });
}

module.exports = {
  INVENTORY_LIMIT,
  assistantReferences,
  auditToolPinning,
  createReadOnlyVapiClient,
  isManagedSummaryTool,
  listFrom,
  referenceKind,
  shortHash,
  validateInventory,
};
