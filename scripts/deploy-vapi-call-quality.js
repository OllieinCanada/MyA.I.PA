const crypto = require("crypto");
const { loadProjectEnv } = require("./_helpers");
const {
  SHARED_CUSTOMER_TOOL_ID,
  SHARED_OWNER_TOOL_ID,
  isManagedIsolatedTool,
  provisionIsolatedSmsRouting,
} = require("../server/vapiIsolatedSmsProvisioning");
const { normalizeE164 } = require("../server/compositeCallNotifications");

const env = loadProjectEnv();
const apiKey = String(env.VAPI_API_KEY || env.VAPI_KEY || env.VAPI_TOKEN || "").trim();
const apiBaseUrl = String(env.VAPI_API_BASE_URL || "https://api.vapi.ai").replace(/\/+$/, "");
const suppressionCheckUrl = String(env.SMS_SUPPRESSION_CHECK_URL || "https://api.myaipa.ca/api/integrations/sms/suppression/check").trim();
const suppressionApiKey = String(env.SMS_SUPPRESSION_API_KEY || "").trim();
const apply = process.argv.slice(2).includes("--apply");

function shortHash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 12);
}

function listFrom(value, keys = []) {
  if (Array.isArray(value)) return value;
  for (const key of ["data", "results", ...keys]) {
    if (Array.isArray(value?.[key])) return value[key];
  }
  return [];
}

function phoneNumber(record) {
  return normalizeE164(record?.number || record?.phoneNumber || record?.twilioPhoneNumber || record?.providerResourceId);
}

function assistantId(record) {
  return String(record?.assistantId || record?.assistant?.id || "").trim();
}

function toolName(tool) {
  return String(tool?.function?.name || tool?.name || "").trim();
}

function environmentMap(tool) {
  const entries = Array.isArray(tool?.environmentVariables) ? tool.environmentVariables : [];
  return Object.fromEntries(entries.map((item) => [String(item?.name || ""), String(item?.value || "")]).filter(([name]) => name));
}

function usableSecret(value) {
  const text = String(value || "").trim();
  return Boolean(text && !/^\*+$/.test(text) && !/^\[?redacted\]?$/i.test(text));
}

async function request(path, { method = "GET", body } = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = {}; }
  if (!response.ok) throw new Error(`${method} ${path} failed with HTTP ${response.status}: ${payload.message || payload.error || "request failed"}`);
  return payload;
}

function mutableToolPayload(tool) {
  return {
    type: tool.type,
    function: tool.function,
    code: tool.code,
    environmentVariables: tool.environmentVariables,
    messages: tool.messages,
    timeoutSeconds: tool.timeoutSeconds,
  };
}

async function main() {
  if (!apiKey) throw new Error("VAPI_API_KEY is not configured.");
  if (apply && (!/^https:\/\//i.test(suppressionCheckUrl) || !usableSecret(suppressionApiKey))) {
    throw new Error("SMS_SUPPRESSION_CHECK_URL and SMS_SUPPRESSION_API_KEY are required before applying call-quality updates.");
  }
  const [phonePayload, assistantPayload, toolPayload] = await Promise.all([
    request("/phone-number?limit=1000"),
    request("/assistant?limit=1000"),
    request("/tool?limit=1000"),
  ]);
  const phones = listFrom(phonePayload, ["phoneNumbers", "phone_numbers"]);
  const assistants = listFrom(assistantPayload, ["assistants"]);
  const tools = listFrom(toolPayload, ["tools"]);
  const managedSummaries = tools.filter(isManagedIsolatedTool);
  const toolSummaryById = new Map(tools.map((tool) => [String(tool.id || ""), tool]));
  const hydratedToolById = new Map();
  async function hydrateTool(id) {
    const key = String(id || "");
    if (!key) return null;
    if (!hydratedToolById.has(key)) hydratedToolById.set(key, await request(`/tool/${encodeURIComponent(key)}`));
    return hydratedToolById.get(key);
  }
  const assistantById = new Map(assistants.map((assistant) => [String(assistant.id || ""), assistant]));
  const phoneGroups = new Map();
  for (const phone of phones) {
    const id = assistantId(phone);
    const number = phoneNumber(phone);
    if (!id || !number) continue;
    if (!phoneGroups.has(id)) phoneGroups.set(id, []);
    phoneGroups.get(id).push(number);
  }

  const candidates = [];
  const skipped = [];
  for (const [id, assignedNumbers] of phoneGroups.entries()) {
    if (assignedNumbers.length !== 1) {
      skipped.push({ assistantIdHash: shortHash(id), reason: "assistant_has_multiple_phone_numbers", phoneLast4: assignedNumbers.map((number) => number.slice(-4)) });
      continue;
    }
    const assistantSummary = assistantById.get(id);
    const assistant = await request(`/assistant/${encodeURIComponent(id)}`);
    const attachedIds = Array.isArray(assistant?.model?.toolIds) ? assistant.model.toolIds : [];
    const attachedManagedSummaries = managedSummaries.filter((tool) => attachedIds.includes(String(tool.id || "")));
    const legacySharedIds = [SHARED_CUSTOMER_TOOL_ID, SHARED_OWNER_TOOL_ID].filter((toolId) => attachedIds.includes(toolId));
    if (!attachedManagedSummaries.length && !legacySharedIds.length) {
      skipped.push({ assistantIdHash: shortHash(id), assistantName: assistantSummary?.name || assistant?.name || "", phoneLast4: assignedNumbers[0].slice(-4), reason: "no_sms_notification_tool" });
      continue;
    }
    const hydratedManaged = await Promise.all(attachedManagedSummaries.map((tool) => hydrateTool(tool.id)));
    const matchingTool = hydratedManaged.find((tool) => normalizeE164(environmentMap(tool).DEFAULT_FROM_NUMBER) === assignedNumbers[0]);
    const hydratedLegacy = await Promise.all(legacySharedIds.map(hydrateTool));
    const legacyRouting = Object.assign({}, ...hydratedLegacy.map(environmentMap));
    const routing = matchingTool ? environmentMap(matchingTool) : legacyRouting;
    const ownerNumber = normalizeE164(
      routing.DEFAULT_OWNER_TO_NUMBER
      || routing.OWNER_TO_NUMBER
      || routing.DEFAULT_TO_NUMBER
      || routing.TO_NUMBER
    );
    if (!ownerNumber || !usableSecret(routing.TWILIO_ACCOUNT_SID) || !usableSecret(routing.TWILIO_AUTH_TOKEN)) {
      skipped.push({
        assistantIdHash: shortHash(id),
        assistantName: assistant.name || "",
        phoneLast4: assignedNumbers[0].slice(-4),
        reason: matchingTool ? "protected_routing_incomplete" : "legacy_routing_could_not_be_verified",
      });
      continue;
    }
    candidates.push({
      assistant,
      aiNumber: assignedNumbers[0],
      ownerNumber,
      routing,
      sourceTool: matchingTool || hydratedLegacy.find((tool) => String(tool?.id || "") === SHARED_OWNER_TOOL_ID) || hydratedLegacy[0],
      legacyMigration: !matchingTool,
      statusCallbackUrl: routing.TWILIO_STATUS_CALLBACK_URL || "",
    });
  }

  if (!apply) {
    console.log(JSON.stringify({
      mode: "dry-run",
      candidates: candidates.length,
      legacyMigrations: candidates.filter((item) => item.legacyMigration).length,
      skipped: skipped.length,
      candidateAssistants: candidates.map((item) => ({ assistantIdHash: shortHash(item.assistant.id), assistantName: item.assistant.name || "", phoneLast4: item.aiNumber.slice(-4), ownerLast4: item.ownerNumber.slice(-4), sourceTool: toolName(item.sourceTool), legacyMigration: item.legacyMigration })),
      skippedAssistants: skipped,
    }, null, 2));
    return;
  }

  const results = [];
  for (const candidate of candidates) {
    const routing = candidate.routing;
    try {
      const result = await provisionIsolatedSmsRouting({
        assistant: candidate.assistant,
        tools: managedSummaries,
        aiNumber: candidate.aiNumber,
        ownerNumber: candidate.ownerNumber,
        twilioAccountSid: routing.TWILIO_ACCOUNT_SID,
        twilioAuthToken: routing.TWILIO_AUTH_TOKEN,
        statusCallbackUrl: candidate.statusCallbackUrl,
        suppressionCheckUrl,
        suppressionApiKey,
        createTool: (payload) => request("/tool", { method: "POST", body: payload }),
        patchTool: (id, payload) => request(`/tool/${encodeURIComponent(id)}`, { method: "PATCH", body: payload }),
        patchAssistant: (id, payload) => request(`/assistant/${encodeURIComponent(id)}`, { method: "PATCH", body: payload }),
        fetchAssistant: (id) => request(`/assistant/${encodeURIComponent(id)}`),
        fetchTool: (id) => request(`/tool/${encodeURIComponent(id)}`),
        deleteTool: (id) => request(`/tool/${encodeURIComponent(id)}`, { method: "DELETE" }),
      });
      results.push({ assistantIdHash: shortHash(candidate.assistant.id), assistantName: candidate.assistant.name || "", phoneLast4: candidate.aiNumber.slice(-4), legacyMigration: candidate.legacyMigration, ok: result.audit?.healthy === true, created: result.created, reused: result.reused, updated: result.updated, checks: result.audit?.checks || {} });
    } catch (error) {
      results.push({ assistantIdHash: shortHash(candidate.assistant.id), assistantName: candidate.assistant.name || "", phoneLast4: candidate.aiNumber.slice(-4), ok: false, error: String(error.message || error).slice(0, 300) });
    }
  }
  const failed = results.filter((result) => !result.ok);
  const refreshedAssistants = await Promise.all(Array.from(phoneGroups.keys()).map((id) => request(`/assistant/${encodeURIComponent(id)}`)));
  const referencedToolIds = new Set(refreshedAssistants.flatMap((assistant) => Array.isArray(assistant?.model?.toolIds) ? assistant.model.toolIds : []));
  const obsoletePilotTools = managedSummaries.filter((tool) => /send_call_summaries_pilot_/i.test(toolName(tool)) && !referencedToolIds.has(String(tool.id || "")));
  const cleanup = [];
  for (const tool of obsoletePilotTools) {
    try {
      await request(`/tool/${encodeURIComponent(tool.id)}`, { method: "DELETE" });
      cleanup.push({ toolName: toolName(tool), removed: true });
    } catch (error) {
      cleanup.push({ toolName: toolName(tool), removed: false, error: String(error.message || error).slice(0, 240) });
    }
  }
  if (cleanup.some((item) => !item.removed)) process.exitCode = 2;
  console.log(JSON.stringify({ mode: "apply", attempted: results.length, passed: results.length - failed.length, failed: failed.length, skipped: skipped.length, obsoletePilotCleanup: cleanup, results, skippedAssistants: skipped }, null, 2));
  if (failed.length) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
