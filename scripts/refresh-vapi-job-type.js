const { loadProjectEnv } = require("./_helpers");
const { isDeepStrictEqual } = require("node:util");
const { getVapiCompositeToolDefinition } = require("../server/compositeCallNotifications");
const { updateMessages } = require("../server/vapiIsolatedSmsProvisioning");
const { assistantReferences, auditToolPinning, isManagedSummaryTool, listFrom, shortHash } = require("./audit-vapi-sms-tool-pinning");

// Content-only migration: never create/delete resources or rewrite routing secrets.
function toolPatch(tool) {
  const definition = getVapiCompositeToolDefinition();
  const envNames = new Set((tool.environmentVariables || []).map((entry) => entry.name));
  // Older tools use Auth Token credentials. Do not add/replace credentials or
  // policy variables merely to satisfy Vapi's static environment validator.
  let code = definition.code;
  for (const name of ["TWILIO_API_KEY_SID", "TWILIO_API_KEY_SECRET", "OWNER_SMS_ENABLED", "PRICING_SUMMARY_OPTIONS"]) {
    if (!envNames.has(name)) code = code.replaceAll(`env.${name}`, '""');
  }
  return { function: { ...tool.function, description: definition.function.description,
    parameters: definition.function.parameters }, code };
}

function modelPatch(assistant, tool) {
  if (!assistant.model || !Array.isArray(assistant.model.messages)) throw new Error("Assistant model is incomplete.");
  const { tools: _expandedTools, ...model } = assistant.model;
  return { ...model, messages: updateMessages(model.messages, tool.function.name) };
}

async function refreshJobTypes({ request, apply = false }) {
  const [toolPayload, assistantPayload] = await Promise.all([request("/tool?limit=1000"), request("/assistant?limit=1000")]);
  const pinning = auditToolPinning({ toolPayload, assistantPayload });
  if (!pinning.safeToPublishWithoutAssistantVersionChanges) throw new Error("Pinned managed tool versions require a separate release; no changes made.");
  const tools = listFrom(toolPayload, ["tools"]).filter(isManagedSummaryTool);
  const toolIds = new Set(tools.map((tool) => tool.id));
  const candidates = listFrom(assistantPayload, ["assistants"]).map((assistant) => ({ assistant,
    references: assistantReferences(assistant).filter((reference) => toolIds.has(reference.toolId)) }))
    .filter(({ references }) => references.length);
  if (candidates.some(({ references }) => references.length !== 1)) throw new Error("Ambiguous managed tools on an assistant; no changes made.");
  const plans = [];
  for (const { assistant, references } of candidates) {
    const [liveAssistant, liveTool] = await Promise.all([request(`/assistant/${assistant.id}`), request(`/tool/${references[0].toolId}`)]);
    if (!isManagedSummaryTool(liveTool)) throw new Error("Managed tool changed during inventory; no changes made.");
    const liveReferences = assistantReferences(liveAssistant).filter((reference) => toolIds.has(reference.toolId));
    if (liveReferences.length !== 1 || liveReferences[0].kind !== "latest" || liveReferences[0].toolId !== liveTool.id) throw new Error("Assistant references changed during inventory; no changes made.");
    plans.push({ assistant: liveAssistant, tool: liveTool, toolPatch: toolPatch(liveTool), model: modelPatch(liveAssistant, liveTool) });
  }
  const report = { mode: apply ? "apply" : "read-only", assistants: plans.length, tools: new Set(plans.map((plan) => plan.tool.id)).size,
    numbersCreated: 0, billingChanged: false, routingChanged: false, results: [] };
  if (!apply) return report;
  const originals = new Map();
  const touchedAssistants = [];
  try {
    for (const plan of plans) {
      if (!originals.has(plan.tool.id)) {
        originals.set(plan.tool.id, { function: plan.tool.function, code: plan.tool.code });
        await request(`/tool/${plan.tool.id}`, { method: "PATCH", body: plan.toolPatch });
      }
      touchedAssistants.push(plan.assistant);
      await request(`/assistant/${plan.assistant.id}`, { method: "PATCH", body: { model: plan.model } });
      const [assistant, tool] = await Promise.all([request(`/assistant/${plan.assistant.id}`), request(`/tool/${plan.tool.id}`)]);
      const references = assistantReferences(assistant);
      const checks = { code: tool.code === plan.toolPatch.code,
        schema: isDeepStrictEqual(tool.function.parameters, plan.toolPatch.function.parameters),
        prompt: isDeepStrictEqual(assistant.model.messages, plan.model.messages),
        reference: references.some((reference) => reference.toolId === plan.tool.id && reference.kind === "latest") };
      if (!Object.values(checks).every(Boolean)) {
        throw new Error(`Read-back did not verify the job-type update: ${JSON.stringify(checks)}.`);
      }
      report.results.push({ assistant: shortHash(plan.assistant.id), tool: shortHash(plan.tool.id), verified: true });
    }
    return report;
  } catch (error) {
    let rollbackFailed = false;
    for (const assistant of touchedAssistants.reverse()) {
      const { tools: _expandedTools, ...model } = assistant.model;
      await request(`/assistant/${assistant.id}`, { method: "PATCH", body: { model } }).catch(() => { rollbackFailed = true; });
    }
    for (const [id, body] of originals) await request(`/tool/${id}`, { method: "PATCH", body }).catch(() => { rollbackFailed = true; });
    throw new Error(`${error.message} Rollback ${rollbackFailed ? "needs review" : "completed"}.`);
  }
}

async function main() {
  const env = loadProjectEnv();
  const apiKey = env.VAPI_API_KEY;
  if (!apiKey) throw new Error("VAPI_API_KEY is required.");
  const base = String(env.VAPI_API_BASE_URL || "https://api.vapi.ai").replace(/\/+$/, "");
  const request = async (endpoint, { method = "GET", body } = {}) => {
    const response = await fetch(`${base}${endpoint}`, { method, signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      const messages = Array.isArray(error.message) ? error.message : [error.message];
      const validation = messages.filter((message) => typeof message === "string")
        .map((message) => message.replace(/"[^"]*"|'[^']*'/g, "[value]").slice(0, 180)).join("; ").slice(0, 500);
      throw new Error(`Vapi ${method} ${endpoint.split("/")[1]} returned HTTP ${response.status}. ${validation}`);
    }
    return response.json();
  };
  console.log(JSON.stringify(await refreshJobTypes({ request, apply: process.argv.includes("--apply") }), null, 2));
}
if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { toolPatch, modelPatch, refreshJobTypes };
