const crypto = require("crypto");
const { callerNumberFallbackPrompt, getVapiCompositeToolDefinition, normalizeE164 } = require("./compositeCallNotifications");

const SHARED_CUSTOMER_TOOL_ID = "baf9269b-6f71-4694-aaec-859209fb77a5";
const SHARED_OWNER_TOOL_ID = "a2b67aee-f59e-4056-bff5-bf60dbc97ab0";
const PROMPT_MARKER = "## MYAIPA ISOLATED SMS ROUTING";

function shortHash(value, length = 8) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, length);
}

function isolatedToolName(aiNumber, ownerNumber) {
  const aiPhone = normalizeE164(aiNumber);
  const ownerPhone = normalizeE164(ownerNumber);
  if (!aiPhone || !ownerPhone) throw new Error("Valid AI and owner phone numbers are required.");
  return `send_call_summaries_${aiPhone.slice(-4)}_${shortHash(`${aiPhone}:${ownerPhone}`)}_v2`;
}

function environmentMap(tool) {
  const entries = Array.isArray(tool?.environmentVariables) ? tool.environmentVariables : [];
  return Object.fromEntries(entries.map((item) => [String(item?.name || ""), String(item?.value || "")]).filter(([name]) => name));
}

function isManagedIsolatedTool(tool) {
  const name = String(tool?.function?.name || tool?.name || "");
  return /^send_call_summaries_(?:pilot_)?\d{4}(?:_[a-f0-9]{8})?_v\d+$/i.test(name);
}

function buildIsolatedToolPayload({ aiNumber, ownerNumber, twilioAccountSid, twilioAuthToken, statusCallbackUrl = "" }) {
  const aiPhone = normalizeE164(aiNumber);
  const ownerPhone = normalizeE164(ownerNumber);
  if (!aiPhone || !ownerPhone) throw new Error("Valid AI and owner phone numbers are required.");
  if (!String(twilioAccountSid || "").trim() || !String(twilioAuthToken || "").trim()) {
    throw new Error("Twilio credentials are required for isolated SMS routing.");
  }
  const definition = getVapiCompositeToolDefinition();
  const name = isolatedToolName(aiPhone, ownerPhone);
  return {
    type: "code",
    function: {
      name,
      description: definition.function.description,
      parameters: definition.function.parameters,
    },
    code: definition.code,
    environmentVariables: [
      { name: "TWILIO_ACCOUNT_SID", value: String(twilioAccountSid).trim() },
      { name: "TWILIO_AUTH_TOKEN", value: String(twilioAuthToken).trim() },
      { name: "DEFAULT_FROM_NUMBER", value: aiPhone },
      { name: "DEFAULT_OWNER_TO_NUMBER", value: ownerPhone },
      { name: "CALLER_NUMBER", value: "{{ customer.number }}" },
      { name: "CALL_ID", value: "{{ call.id }}" },
      { name: "TWILIO_STATUS_CALLBACK_URL", value: /^https:\/\//i.test(String(statusCallbackUrl || "")) ? String(statusCallbackUrl).trim() : "" },
    ],
    timeoutSeconds: 20,
  };
}

function promptOverride(toolName) {
  return `${PROMPT_MARKER}
For this assistant only, never call send_customer_sms_dynamic or send_owner_sms_dynamic.
${callerNumberFallbackPrompt(toolName)}
Never announce tool names, routing, or technical results. After the tool finishes, give a brief natural closing and end the call.
## END MYAIPA ISOLATED SMS ROUTING`;
}

function updateMessages(messages, toolName) {
  const start = PROMPT_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const end = "## END MYAIPA ISOLATED SMS ROUTING".replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let updatedSystem = false;
  const output = (messages || []).map((message) => {
    if (updatedSystem || message?.role !== "system") return message;
    updatedSystem = true;
    const content = String(message.content || "")
      .replace(new RegExp(`\\n*${start}[\\s\\S]*?${end}`, "g"), "")
      .trimEnd();
    return { ...message, content: `${content}\n\n${promptOverride(toolName)}` };
  });
  if (!updatedSystem) throw new Error("The Vapi assistant has no system prompt to update.");
  return output;
}

function buildIsolatedAssistantModel(assistant, toolId, toolName, removeToolIds = []) {
  if (!assistant?.model || typeof assistant.model !== "object") throw new Error("The Vapi assistant model is missing.");
  const currentToolIds = Array.isArray(assistant.model.toolIds) ? assistant.model.toolIds : [];
  const removed = new Set([SHARED_CUSTOMER_TOOL_ID, SHARED_OWNER_TOOL_ID, ...removeToolIds]);
  const nextToolIds = [...new Set(currentToolIds
    .filter((id) => !removed.has(id))
    .concat(toolId))];
  const { tools: _expandedTools, ...model } = assistant.model;
  return {
    ...model,
    toolIds: nextToolIds,
    messages: updateMessages(model.messages || [], toolName),
  };
}

function inspectIsolatedConfiguration({ assistant, tool, aiNumber, ownerNumber }) {
  const aiPhone = normalizeE164(aiNumber);
  const ownerPhone = normalizeE164(ownerNumber);
  const toolId = String(tool?.id || "");
  const toolName = String(tool?.function?.name || tool?.name || "");
  const env = environmentMap(tool);
  const toolIds = Array.isArray(assistant?.model?.toolIds) ? assistant.model.toolIds : [];
  const prompt = (assistant?.model?.messages || []).find((message) => message?.role === "system")?.content || "";
  const required = Array.isArray(tool?.function?.parameters?.required) ? tool.function.parameters.required : [];
  const code = String(tool?.code || "");
  const checks = {
    toolAttached: Boolean(toolId && toolIds.includes(toolId)),
    sharedCustomerRemoved: !toolIds.includes(SHARED_CUSTOMER_TOOL_ID),
    sharedOwnerRemoved: !toolIds.includes(SHARED_OWNER_TOOL_ID),
    senderProtected: normalizeE164(env.DEFAULT_FROM_NUMBER) === aiPhone,
    ownerProtected: normalizeE164(env.DEFAULT_OWNER_TO_NUMBER) === ownerPhone,
    callerProtected: env.CALLER_NUMBER === "{{ customer.number }}",
    callIdProtected: env.CALL_ID === "{{ call.id }}",
    callerFallbackSchema: !required.includes("rawPhoneNumber"),
    callerFallbackCode: code.includes("needsCustomerNumber") && code.includes("waiting_for_customer_number"),
    promptInstalled: Boolean(toolName && prompt.includes(PROMPT_MARKER) && prompt.includes(toolName)),
    callerFallbackInstalled: prompt.includes("trusted caller ID") && prompt.includes("needsCustomerNumber") && prompt.includes("unless complete is true"),
    callerAcknowledgementInstalled: prompt.includes("I'll use the number you're calling from") && prompt.includes("Do not claim you can see or recite the digits"),
    mandatoryToolGateInstalled: prompt.includes("MANDATORY TOOL GATE") && prompt.includes("Do not speak a closing sentence") && prompt.includes("call endCall before"),
  };
  return { healthy: Object.values(checks).every(Boolean), checks };
}

async function provisionIsolatedSmsRouting({
  assistant,
  tools,
  aiNumber,
  ownerNumber,
  twilioAccountSid,
  twilioAuthToken,
  statusCallbackUrl,
  createTool,
  patchAssistant,
  fetchAssistant,
  fetchTool,
  deleteTool,
}) {
  const payload = buildIsolatedToolPayload({ aiNumber, ownerNumber, twilioAccountSid, twilioAuthToken, statusCallbackUrl });
  const toolName = payload.function.name;
  const existingSummary = (tools || []).find((tool) => String(tool?.function?.name || tool?.name || "") === toolName);
  const existingTool = existingSummary?.id && fetchTool ? await fetchTool(existingSummary.id) : existingSummary;
  const managedToolIds = (tools || []).filter(isManagedIsolatedTool).map((tool) => String(tool?.id || "")).filter(Boolean);
  const attachedToolIds = Array.isArray(assistant?.model?.toolIds) ? assistant.model.toolIds : [];
  const otherManagedToolAttached = managedToolIds.some((id) => id !== existingTool?.id && attachedToolIds.includes(id));
  if (existingTool) {
    const existingAudit = inspectIsolatedConfiguration({ assistant, tool: existingTool, aiNumber, ownerNumber });
    if (existingAudit.healthy && !otherManagedToolAttached) {
      return { created: false, reused: true, updated: false, tool: existingTool, assistant, audit: existingAudit };
    }
  }

  let createdTool = existingTool || null;
  const originalModel = assistant.model;
  let assistantPatched = false;
  try {
    if (!createdTool) createdTool = await createTool(payload);
    const toolId = String(createdTool?.id || "").trim();
    if (!toolId) throw new Error("Vapi did not return an isolated tool ID.");
    const nextModel = buildIsolatedAssistantModel(assistant, toolId, toolName, managedToolIds);
    await patchAssistant(assistant.id, { model: nextModel });
    assistantPatched = true;
    const verifiedAssistant = await fetchAssistant(assistant.id);
    const verifiedTool = fetchTool ? await fetchTool(toolId) : createdTool;
    const audit = inspectIsolatedConfiguration({ assistant: verifiedAssistant, tool: verifiedTool, aiNumber, ownerNumber });
    if (!audit.healthy) throw new Error("Vapi read-back did not verify isolated SMS routing.");
    return {
      created: !existingTool,
      reused: Boolean(existingTool),
      updated: true,
      tool: verifiedTool,
      assistant: verifiedAssistant,
      audit,
    };
  } catch (error) {
    if (assistantPatched) await patchAssistant(assistant.id, { model: originalModel }).catch(() => {});
    if (!existingTool && createdTool?.id && deleteTool) await deleteTool(createdTool.id).catch(() => {});
    throw error;
  }
}

module.exports = {
  PROMPT_MARKER,
  SHARED_CUSTOMER_TOOL_ID,
  SHARED_OWNER_TOOL_ID,
  buildIsolatedAssistantModel,
  buildIsolatedToolPayload,
  inspectIsolatedConfiguration,
  isManagedIsolatedTool,
  isolatedToolName,
  provisionIsolatedSmsRouting,
  updateMessages,
};
