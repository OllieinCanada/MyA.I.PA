const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { loadProjectEnv } = require("./_helpers");
const {
  callerNumberFallbackPrompt,
  getVapiCompositeToolDefinition,
  normalizeE164,
} = require("../server/compositeCallNotifications");

const env = loadProjectEnv();
const apiKey = String(env.VAPI_API_KEY || env.VAPI_KEY || env.VAPI_TOKEN || "").trim();
const apiBase = String(env.VAPI_API_BASE_URL || "https://api.vapi.ai").replace(/\/+$/, "");
const targetPhone = "+12494956809";
const expectedOwnerPhone = "+19059451055";
const toolName = "send_call_summaries_pilot_6809_v1";
const pilotMarker = "## PILOT OVERRIDE: isolated deterministic SMS routing";
const tailoredMarker = "## GRIMSBY ELECTRIC WEBSITE-TAILORED OVERRIDE v1";
const handoffOutputName = "Grimsby SMS Handoff v1";
const neutralTailoredInstruction = "It must send every notification channel currently enabled for this assistant. Do not say delivery succeeded unless the tool confirms success.";
const handoffDescription = "True only when every notification channel currently enabled for the tool completes successfully. A deliberately disabled owner channel does not count as a failure; the customer confirmation must still succeed. False for a failed enabled channel, duplicated call, or falsely claimed handoff.";
const apply = process.argv.includes("--apply");
const state = (process.argv.find((arg) => arg.startsWith("--state="))?.slice(8) || "disabled").toLowerCase();
const ownerSmsEnabled = state === "enabled";
const confirmation = process.argv.find((arg) => arg.startsWith("--confirm="))?.slice(10) || "";
const confirmationPhrase = `GRIMSBY-OWNER-SMS-${state.toUpperCase()}`;

function listFrom(value, keys = []) {
  if (Array.isArray(value)) return value;
  for (const key of ["data", "results", ...keys]) if (Array.isArray(value?.[key])) return value[key];
  return [];
}

function phoneNumber(record) {
  return normalizeE164(record?.number || record?.phoneNumber || record?.twilioPhoneNumber || record?.providerResourceId);
}

function hash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 12);
}

function environmentMap(tool) {
  return Object.fromEntries((tool?.environmentVariables || []).map((item) => [String(item?.name || ""), String(item?.value || "")]).filter(([name]) => name));
}

function upsertEnvironment(entries, name, value) {
  const output = (entries || []).filter((entry) => String(entry?.name || "") !== name);
  output.push({ name, value });
  return output;
}

function systemPrompt(assistant) {
  return (assistant?.model?.messages || []).find((message) => message?.role === "system")?.content || "";
}

function routingOverride() {
  return `${pilotMarker}
For this assistant only, do not call send_customer_sms_dynamic or send_owner_sms_dynamic.
${callerNumberFallbackPrompt(toolName, { ownerSmsEnabled })}
Never announce tool names, routing, or technical results to the caller. After the tool finishes, use the exact closing in the highest-priority instruction and end the call.`;
}

function updateMessages(messages) {
  let updated = false;
  const output = (messages || []).map((message) => {
    if (updated || message?.role !== "system") return message;
    const content = String(message.content || "");
    const pilotIndex = content.indexOf(pilotMarker);
    const tailoredIndex = content.indexOf(tailoredMarker);
    if (pilotIndex < 0 || tailoredIndex <= pilotIndex) throw new Error("The expected isolated-routing and Grimsby prompt markers were not found in a safe order.");
    const prefix = content.slice(0, pilotIndex).trimEnd();
    const tailored = content.slice(tailoredIndex)
      .replace("It must send the caller confirmation and owner lead summary. Do not say delivery succeeded unless the tool confirms success.", neutralTailoredInstruction)
      .replace("It must send the caller confirmation. Owner lead-summary SMS is temporarily disabled. Do not say delivery succeeded unless the tool confirms success.", neutralTailoredInstruction);
    updated = true;
    return { ...message, content: `${prefix}\n\n${routingOverride()}\n\n${tailored}` };
  });
  if (!updated) throw new Error("The Grimsby assistant has no system prompt to update.");
  return output;
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
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { text }; }
  if (!response.ok) {
    const detail = payload.message || payload.error || payload.text || "request failed";
    throw new Error(`${method} ${pathname} failed with HTTP ${response.status}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
  }
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
  if (!["enabled", "disabled"].includes(state)) throw new Error("--state must be enabled or disabled.");
  if (apply && confirmation !== confirmationPhrase) throw new Error(`Apply mode requires --confirm=${confirmationPhrase}.`);

  const phones = listFrom(await request("/phone-number?limit=1000"), ["phoneNumbers", "phone_numbers"]);
  const phone = phones.find((record) => phoneNumber(record) === targetPhone);
  const assistantId = String(phone?.assistantId || phone?.assistant?.id || "").trim();
  if (!phone || !assistantId) throw new Error("The dedicated Grimsby phone or assistant was not found.");
  const assignedPhones = phones.filter((record) => String(record?.assistantId || record?.assistant?.id || "").trim() === assistantId).map(phoneNumber).filter(Boolean);
  if (assignedPhones.length !== 1 || assignedPhones[0] !== targetPhone) throw new Error(`Refusing to patch a shared assistant: ${assignedPhones.join(", ") || "none"}.`);

  const [assistant, toolsPayload, outputsPayload] = await Promise.all([
    request(`/assistant/${encodeURIComponent(assistantId)}`),
    request("/tool?limit=1000"),
    request("/structured-output?limit=1000"),
  ]);
  const tools = listFrom(toolsPayload, ["tools"]);
  const toolSummaries = tools.filter((item) => String(item?.function?.name || item?.name || "") === toolName);
  if (toolSummaries.length !== 1) throw new Error(`Expected exactly one ${toolName}; found ${toolSummaries.length}.`);
  const toolId = String(toolSummaries[0]?.id || "").trim();
  const currentToolIds = (assistant?.model?.toolIds || []).map(String);
  if (!toolId || !currentToolIds.includes(toolId)) throw new Error("The dedicated Grimsby SMS tool is not attached to the assistant.");
  const tool = await request(`/tool/${encodeURIComponent(toolId)}`);
  const toolEnv = environmentMap(tool);
  if (normalizeE164(toolEnv.DEFAULT_FROM_NUMBER) !== targetPhone || normalizeE164(toolEnv.DEFAULT_OWNER_TO_NUMBER) !== expectedOwnerPhone) {
    throw new Error("The protected Grimsby sender or owner route does not match the expected phone numbers.");
  }
  if (toolEnv.CALLER_NUMBER !== "{{ customer.number }}" || toolEnv.CALL_ID !== "{{ call.id }}") throw new Error("The trusted caller-ID or call-ID routing is not intact.");

  const outputs = listFrom(outputsPayload, ["structuredOutputs", "structured_outputs"]);
  const handoffOutputs = outputs.filter((item) => item?.name === handoffOutputName);
  if (handoffOutputs.length !== 1) throw new Error(`Expected exactly one ${handoffOutputName}; found ${handoffOutputs.length}.`);
  const handoffOutput = handoffOutputs[0];
  if (!(assistant?.artifactPlan?.structuredOutputIds || []).includes(handoffOutput.id)) throw new Error("The Grimsby SMS handoff output is not attached to the assistant.");

  const prompt = systemPrompt(assistant);
  if (!prompt.includes(pilotMarker) || !prompt.includes(tailoredMarker)) throw new Error("The isolated or tailored Grimsby prompt marker is missing.");
  const currentOwnerSmsEnabled = String(toolEnv.OWNER_SMS_ENABLED ?? "true").trim().toLowerCase() !== "false";
  console.log(JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    targetPhoneLast4: targetPhone.slice(-4),
    ownerPhoneLast4: expectedOwnerPhone.slice(-4),
    assistantIdHash: hash(assistantId),
    toolIdHash: hash(toolId),
    assignedPhoneCount: assignedPhones.length,
    customerSmsCurrent: true,
    customerSmsTarget: true,
    ownerSmsCurrent: currentOwnerSmsEnabled,
    ownerSmsTarget: ownerSmsEnabled,
    otherAssistantsAffected: 0,
  }, null, 2));
  if (!apply) return;

  const backupDir = path.join(process.cwd(), "diagnostics", "vapi-grimsby-electric");
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(backupDir, `owner-sms-${state}-before-${stamp}.json`);
  const resultPath = path.join(backupDir, `owner-sms-${state}-result-${stamp}.json`);
  fs.writeFileSync(backupPath, `${JSON.stringify({ createdAt: new Date().toISOString(), state, phone, assistant, tool, handoffOutput }, null, 2)}\n`, { flag: "wx" });

  const definition = getVapiCompositeToolDefinition();
  const nextTool = {
    type: tool.type,
    function: {
      ...tool.function,
      description: ownerSmsEnabled
        ? definition.function.description
        : "After intake, send only the caller confirmation using trusted caller ID. Owner SMS is temporarily disabled for this assistant. If needsCustomerNumber is true, ask for and confirm a fallback mobile number, then retry once.",
      parameters: definition.function.parameters,
    },
    code: definition.code,
    environmentVariables: upsertEnvironment(tool.environmentVariables, "OWNER_SMS_ENABLED", ownerSmsEnabled ? "true" : "false"),
    messages: tool.messages,
    timeoutSeconds: tool.timeoutSeconds,
  };
  const { tools: _expandedTools, ...modelWithoutExpandedTools } = assistant.model || {};
  const nextModel = { ...modelWithoutExpandedTools, toolIds: currentToolIds, messages: updateMessages(assistant?.model?.messages || []) };
  const rollbackModel = { ...modelWithoutExpandedTools, toolIds: currentToolIds, messages: assistant?.model?.messages || [] };
  let toolPatched = false;
  let outputPatched = false;
  let assistantPatched = false;
  try {
    await request(`/tool/${encodeURIComponent(toolId)}`, { method: "PATCH", body: nextTool });
    toolPatched = true;
    await request(`/structured-output/${encodeURIComponent(handoffOutput.id)}`, { method: "PATCH", body: { description: handoffDescription } });
    outputPatched = true;
    await request(`/assistant/${encodeURIComponent(assistantId)}`, { method: "PATCH", body: { model: nextModel } });
    assistantPatched = true;

    const [verifiedAssistant, verifiedTool, verifiedOutput] = await Promise.all([
      request(`/assistant/${encodeURIComponent(assistantId)}`),
      request(`/tool/${encodeURIComponent(toolId)}`),
      request(`/structured-output/${encodeURIComponent(handoffOutput.id)}`),
    ]);
    const verifiedEnv = environmentMap(verifiedTool);
    const verifiedPrompt = systemPrompt(verifiedAssistant);
    const verifiedToolIds = (verifiedAssistant?.model?.toolIds || []).map(String);
    const checks = {
      ownerSmsState: (String(verifiedEnv.OWNER_SMS_ENABLED).toLowerCase() !== "false") === ownerSmsEnabled,
      customerSmsCodePresent: String(verifiedTool?.code || "").includes('order.push("customer")'),
      ownerPolicyCodePresent: String(verifiedTool?.code || "").includes("OWNER_SMS_ENABLED") && String(verifiedTool?.code || "").includes("disabled_by_policy"),
      customerOnlyPrompt: ownerSmsEnabled ? !verifiedPrompt.includes("Owner SMS is temporarily disabled by policy") : verifiedPrompt.includes("Owner SMS is temporarily disabled by policy"),
      neutralTailoredInstruction: verifiedPrompt.includes(neutralTailoredInstruction),
      tailoredPromptPreserved: verifiedPrompt.includes(tailoredMarker),
      routingPromptPreserved: verifiedPrompt.includes(pilotMarker) && verifiedPrompt.includes(toolName),
      toolIdsPreserved: JSON.stringify(currentToolIds.slice().sort()) === JSON.stringify(verifiedToolIds.slice().sort()),
      handoffOutputUpdated: verifiedOutput?.description === handoffDescription,
      scorecardLinkPreserved: (verifiedAssistant?.artifactPlan?.structuredOutputIds || []).includes(handoffOutput.id),
    };
    const healthy = Object.values(checks).every(Boolean);
    const result = { applied: true, verified: healthy, state, customerSmsEnabled: true, ownerSmsEnabled, otherAssistantsAffected: 0, assistantIdHash: hash(assistantId), toolIdHash: hash(toolId), checks, backupPath, resultPath };
    fs.writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
    console.log(JSON.stringify({ ...result, backupPath: path.relative(process.cwd(), backupPath), resultPath: path.relative(process.cwd(), resultPath) }, null, 2));
    if (!healthy) throw new Error("Live read-back did not verify the requested owner-SMS state.");
  } catch (error) {
    if (assistantPatched) await request(`/assistant/${encodeURIComponent(assistantId)}`, { method: "PATCH", body: { model: rollbackModel } }).catch(() => {});
    if (outputPatched) await request(`/structured-output/${encodeURIComponent(handoffOutput.id)}`, { method: "PATCH", body: { description: handoffOutput.description } }).catch(() => {});
    if (toolPatched) await request(`/tool/${encodeURIComponent(toolId)}`, { method: "PATCH", body: mutableToolPayload(tool) }).catch(() => {});
    throw error;
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
