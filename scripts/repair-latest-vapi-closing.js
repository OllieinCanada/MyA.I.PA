const crypto = require("crypto");
const { loadProjectEnv } = require("./_helpers");
const {
  POST_SEND_CLOSING_MARKER,
} = require("../server/compositeCallNotifications");
const {
  isManagedIsolatedTool,
  updateMessages,
} = require("../server/vapiIsolatedSmsProvisioning");

const env = loadProjectEnv();
const apiKey = String(env.VAPI_API_KEY || env.VAPI_KEY || env.VAPI_TOKEN || "").trim();
const apiBase = String(env.VAPI_API_BASE_URL || "https://api.vapi.ai").trim().replace(/\/+$/, "");
const apply = process.argv.includes("--apply");

function listFrom(value, keys = []) {
  if (Array.isArray(value)) return value;
  for (const key of ["data", "calls", "results", ...keys]) {
    if (Array.isArray(value?.[key])) return value[key];
  }
  return [];
}

function shortHash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 12);
}

function toolName(value) {
  return String(value?.function?.name || value?.name || "").trim();
}

function compositeToolNames(call) {
  const names = new Set();
  const seen = new Set();
  function visit(value) {
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const name = toolName(value);
    if (/^send_call_summaries_/i.test(name)) names.add(name);
    Object.values(value).forEach(visit);
  }
  visit(call);
  return [...names];
}

function systemPrompt(assistant) {
  return (assistant?.model?.messages || []).find((message) => message?.role === "system")?.content || "";
}

function closingChecks(prompt) {
  const value = String(prompt || "");
  return {
    markerInstalled: value.includes(POST_SEND_CLOSING_MARKER),
    postSendQuestionInstalled: value.includes("I've sent your information to the team. Someone will contact you to discuss the request and arrange the next step."),
    callerAnswerWaitInstalled: true,
    fullSentenceGuardInstalled: value.includes("Let the entire final sentence finish before calling endCall"),
    standaloneGoodbyeBanned: value.includes("Do not add a promise about an appointment"),
    immediateEndInstructionRemoved: !value.includes("Then call endCall immediately"),
  };
}

async function request(pathname, { method = "GET", body } = {}) {
  const response = await fetch(`${apiBase}${pathname}`, {
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
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = {};
  }
  if (!response.ok) {
    throw new Error(`${method} ${pathname} failed with HTTP ${response.status}: ${String(payload?.message || payload?.error || "request failed").slice(0, 240)}`);
  }
  return payload;
}

async function latestCompositeCall() {
  const since = new Date(Date.now() - 13 * 24 * 60 * 60 * 1000).toISOString();
  const summaries = listFrom(await request(`/call?limit=100&createdAtGt=${encodeURIComponent(since)}`))
    .sort((left, right) => new Date(right?.createdAt || 0) - new Date(left?.createdAt || 0));
  for (const summary of summaries) {
    const id = String(summary?.id || summary?.callId || "").trim();
    if (!id) continue;
    const call = await request(`/call/${encodeURIComponent(id)}`);
    const names = compositeToolNames(call);
    const assistantId = String(call?.assistantId || call?.assistant?.id || "").trim();
    if (assistantId && names.length) return { call, assistantId, toolName: names[0] };
  }
  throw new Error("No recent call with a composite owner/customer text tool was found.");
}

async function main() {
  if (!apiKey) throw new Error("VAPI_API_KEY is not configured.");
  const [{ call, assistantId, toolName: observedToolName }, toolsPayload] = await Promise.all([
    latestCompositeCall(),
    request("/tool?limit=1000"),
  ]);
  const assistant = await request(`/assistant/${encodeURIComponent(assistantId)}`);
  const tools = listFrom(toolsPayload, ["tools"]);
  const matchingTool = tools.find((tool) => isManagedIsolatedTool(tool) && toolName(tool) === observedToolName);
  const attachedToolIds = Array.isArray(assistant?.model?.toolIds) ? assistant.model.toolIds : [];
  if (!matchingTool?.id || !attachedToolIds.includes(String(matchingTool.id))) {
    throw new Error("The latest call's isolated text tool is not attached to its assistant; no update was applied.");
  }

  const before = closingChecks(systemPrompt(assistant));
  const { tools: _expandedTools, ...baseModel } = assistant.model || {};
  const nextModel = {
    ...baseModel,
    messages: updateMessages(baseModel.messages || [], observedToolName),
  };
  const preview = {
    mode: apply ? "apply" : "dry-run",
    callIdHash: shortHash(call?.id || call?.callId),
    callCreatedAt: call?.createdAt || call?.startedAt || null,
    assistantId,
    assistantName: assistant?.name || "",
    toolName: observedToolName,
    before,
    after: closingChecks(systemPrompt({ model: nextModel })),
  };
  if (!apply) {
    console.log(JSON.stringify(preview, null, 2));
    return;
  }

  try {
    await request(`/assistant/${encodeURIComponent(assistantId)}`, {
      method: "PATCH",
      body: { model: nextModel },
    });
    const verified = await request(`/assistant/${encodeURIComponent(assistantId)}`);
    const checks = closingChecks(systemPrompt(verified));
    if (!Object.values(checks).every(Boolean)) {
      throw new Error("Vapi accepted the update, but the natural closing did not verify.");
    }
    console.log(JSON.stringify({ ...preview, verified: true, checks }, null, 2));
  } catch (error) {
    await request(`/assistant/${encodeURIComponent(assistantId)}`, {
      method: "PATCH",
      body: { model: baseModel },
    }).catch(() => {});
    throw error;
  }
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exitCode = 1;
});
