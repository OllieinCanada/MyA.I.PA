const crypto = require("crypto");
const { loadProjectEnv } = require("./_helpers");
const { callerNumberFallbackPrompt, getVapiCompositeToolDefinition, normalizeE164 } = require("../server/compositeCallNotifications");
const { TOOL_REQUEST_START_MESSAGE, assistantTimingPatch, inspectAssistantTiming } = require("../server/vapiIsolatedSmsProvisioning");

const env = loadProjectEnv();
const apiKey = String(env.VAPI_API_KEY || env.VAPI_KEY || env.VAPI_TOKEN || "").trim();
const apiBaseUrl = String(env.VAPI_API_BASE_URL || "https://api.vapi.ai").replace(/\/+$/, "");
const SHARED_CUSTOMER_TOOL_ID = "baf9269b-6f71-4694-aaec-859209fb77a5";
const SHARED_OWNER_TOOL_ID = "a2b67aee-f59e-4056-bff5-bf60dbc97ab0";
const PILOT_PROMPT_MARKER = "## PILOT OVERRIDE: isolated deterministic SMS routing";

function argument(name, fallback = "") {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length).trim() : fallback;
}

function hasFlag(name) {
  return process.argv.slice(2).includes(`--${name}`);
}

function shortId(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 12);
}

function listFrom(value, keys = []) {
  if (Array.isArray(value)) return value;
  for (const key of ["data", "results", ...keys]) {
    if (Array.isArray(value?.[key])) return value[key];
  }
  return [];
}

async function request(path, options = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = {};
  }
  if (!response.ok) {
    const message = String(payload.message || payload.error || `HTTP ${response.status}`).slice(0, 300);
    throw new Error(`${options.label || path} failed: ${message}`);
  }
  return payload;
}

function phoneNumber(record) {
  return normalizeE164(record?.number || record?.phoneNumber || record?.twilioPhoneNumber || record?.providerResourceId);
}

function envMap(tool) {
  const entries = Array.isArray(tool?.environmentVariables) ? tool.environmentVariables : [];
  return Object.fromEntries(entries.map((item) => [String(item?.name || ""), String(item?.value || "")]).filter(([name]) => name));
}

function usableSecret(value) {
  const text = String(value || "").trim();
  return Boolean(text && !/^\*+$/.test(text) && !/^\[?redacted\]?$/i.test(text));
}

function systemPrompt(assistant) {
  return (assistant?.model?.messages || []).find((message) => message.role === "system")?.content || "";
}

function promptOverride(toolName) {
  return `${PILOT_PROMPT_MARKER}
For this assistant only, do not call send_customer_sms_dynamic or send_owner_sms_dynamic.
${callerNumberFallbackPrompt(toolName)}
Never announce tool names, routing, or technical results to the caller. After the tool finishes, use the exact closing in the highest-priority instruction and end the call.`;
}

function withPromptOverride(messages, toolName) {
  let found = false;
  const updated = (messages || []).map((message) => {
    if (message.role !== "system" || found) return message;
    found = true;
    const current = String(message.content || "");
    const withoutOldPilotOverride = current.split(`\n\n${PILOT_PROMPT_MARKER}`)[0].trimEnd();
    return { ...message, content: `${withoutOldPilotOverride}\n\n${promptOverride(toolName)}` };
  });
  if (!found) throw new Error("The pilot assistant has no system prompt to update safely.");
  return updated;
}

function createToolPayload({ toolName, twilioAccountSid, twilioAuthToken, aiPhone, ownerPhone, statusCallback }) {
  const definition = getVapiCompositeToolDefinition();
  const environmentVariables = [
    { name: "TWILIO_ACCOUNT_SID", value: twilioAccountSid },
    { name: "TWILIO_AUTH_TOKEN", value: twilioAuthToken },
    { name: "DEFAULT_FROM_NUMBER", value: aiPhone },
    { name: "DEFAULT_OWNER_TO_NUMBER", value: ownerPhone },
    { name: "CALLER_NUMBER", value: "{{ customer.number }}" },
    { name: "CALL_ID", value: "{{ call.id }}" },
    { name: "TWILIO_STATUS_CALLBACK_URL", value: /^https:\/\//i.test(statusCallback || "") ? statusCallback : "" },
  ];
  return {
    type: "code",
    function: {
      name: toolName,
      description: definition.function.description,
      parameters: definition.function.parameters,
    },
    code: definition.code,
    environmentVariables,
    messages: [
      { type: "request-start", content: TOOL_REQUEST_START_MESSAGE, blocking: false },
    ],
    timeoutSeconds: 20,
  };
}

async function main() {
  if (!apiKey) throw new Error("VAPI_API_KEY is not configured in .env.local.");
  const apply = hasFlag("apply");
  const aiPhone = normalizeE164(argument("phone", "+12494682588"));
  const ownerPhone = normalizeE164(argument("owner-phone", env.MYAIPA_TEST_OWNER_PHONE || ""));
  if (!aiPhone) throw new Error("--phone must be a valid E.164 phone number.");
  if (!ownerPhone) throw new Error("--owner-phone must be a valid E.164 phone number.");
  const toolName = `send_call_summaries_pilot_${aiPhone.slice(-4)}_v1`;

  const phoneList = listFrom(await request("/phone-number?limit=1000", { label: "List phone numbers" }), ["phoneNumbers"]);
  const pilotPhone = phoneList.find((record) => phoneNumber(record) === aiPhone);
  if (!pilotPhone) throw new Error(`No Vapi phone number ending ${aiPhone.slice(-4)} was found.`);
  const assistantId = String(pilotPhone.assistantId || pilotPhone.assistant?.id || "").trim();
  if (!assistantId) throw new Error("The pilot Vapi phone number has no assistant assigned.");

  const [assistant, customerTool, ownerTool, toolListPayload] = await Promise.all([
    request(`/assistant/${encodeURIComponent(assistantId)}`, { label: "Fetch pilot assistant" }),
    request(`/tool/${SHARED_CUSTOMER_TOOL_ID}`, { label: "Fetch shared customer tool" }),
    request(`/tool/${SHARED_OWNER_TOOL_ID}`, { label: "Fetch shared owner tool" }),
    request("/tool?limit=1000", { label: "List tools" }),
  ]);
  const customerEnv = envMap(customerTool);
  const ownerEnv = envMap(ownerTool);
  const twilioAccountSid = customerEnv.TWILIO_ACCOUNT_SID || ownerEnv.TWILIO_ACCOUNT_SID;
  const twilioAuthToken = customerEnv.TWILIO_AUTH_TOKEN || ownerEnv.TWILIO_AUTH_TOKEN;
  const statusCallback = customerEnv.TWILIO_STATUS_CALLBACK_URL || ownerEnv.TWILIO_STATUS_CALLBACK_URL || "";
  if (!usableSecret(twilioAccountSid) || !usableSecret(twilioAuthToken)) {
    throw new Error("Vapi did not return usable Twilio credentials from the existing tools; no live change was made.");
  }

  const currentToolIds = Array.isArray(assistant?.model?.toolIds) ? assistant.model.toolIds : [];
  const toolList = listFrom(toolListPayload, ["tools"]);
  const existingPilotTool = toolList.find((tool) => tool?.name === toolName || tool?.function?.name === toolName);
  const existingPilotDetail = existingPilotTool?.id
    ? await request(`/tool/${encodeURIComponent(existingPilotTool.id)}`, { label: "Fetch isolated pilot tool" })
    : null;
  const pilotEnv = envMap(existingPilotDetail);
  const pilotConfigurationValid = Boolean(existingPilotDetail
    && existingPilotDetail?.function?.name === toolName
    && normalizeE164(pilotEnv.DEFAULT_FROM_NUMBER) === aiPhone
    && normalizeE164(pilotEnv.DEFAULT_OWNER_TO_NUMBER) === ownerPhone
    && pilotEnv.CALLER_NUMBER === "{{ customer.number }}"
    && pilotEnv.CALL_ID === "{{ call.id }}");
  const report = {
    mode: apply ? "apply" : "dry-run",
    aiLast4: aiPhone.slice(-4),
    ownerLast4: ownerPhone.slice(-4),
    assistantIdHash: shortId(assistantId),
    assistantName: String(assistant.name || "(unnamed)").slice(0, 120),
    sharedCustomerAttached: currentToolIds.includes(SHARED_CUSTOMER_TOOL_ID),
    sharedOwnerAttached: currentToolIds.includes(SHARED_OWNER_TOOL_ID),
    existingPilotTool: Boolean(existingPilotTool),
    pilotToolAttached: Boolean(existingPilotTool?.id && currentToolIds.includes(existingPilotTool.id)),
    pilotConfigurationValid,
    twilioCredentialsAvailable: true,
    protectedCallerRouting: true,
    protectedOwnerRouting: true,
  };
  console.log(JSON.stringify(report, null, 2));
  if (!apply) {
    console.log("Dry run only. Rerun with --apply to create or safely refresh the isolated pilot configuration.");
    return;
  }
  if (existingPilotTool) {
    if (!pilotConfigurationValid) {
      throw new Error("The existing pilot tool does not match the protected routing configuration. Refusing to modify the assistant.");
    }
    const existingToolId = String(existingPilotTool.id || "").trim();
    const originalTool = existingPilotDetail;
    const toolPayload = createToolPayload({ toolName, twilioAccountSid, twilioAuthToken, aiPhone, ownerPhone, statusCallback });
    const originalModel = assistant.model;
    const { tools: _expandedTools, ...modelWithoutExpandedTools } = originalModel || {};
    const nextModel = {
      ...modelWithoutExpandedTools,
      toolIds: [...new Set(currentToolIds
        .filter((id) => ![SHARED_CUSTOMER_TOOL_ID, SHARED_OWNER_TOOL_ID].includes(id))
        .concat(existingToolId))],
      messages: withPromptOverride(originalModel?.messages || [], toolName),
    };
    let assistantPatched = false;
    let toolPatched = false;
    try {
      await request(`/tool/${encodeURIComponent(existingToolId)}`, {
        method: "PATCH",
        body: toolPayload,
        label: "Refresh isolated pilot tool",
      });
      toolPatched = true;
      await request(`/assistant/${encodeURIComponent(assistantId)}`, {
        method: "PATCH",
        body: { model: nextModel, ...assistantTimingPatch() },
        label: "Refresh isolated pilot prompt",
      });
      assistantPatched = true;
      const verified = await request(`/assistant/${encodeURIComponent(assistantId)}`, { label: "Verify refreshed pilot assistant" });
      const verifiedToolIds = Array.isArray(verified?.model?.toolIds) ? verified.model.toolIds : [];
      const verifiedPrompt = systemPrompt(verified);
      const verifiedTool = await request(`/tool/${encodeURIComponent(existingToolId)}`, { label: "Verify refreshed pilot tool" });
      const requestStart = (Array.isArray(verifiedTool?.messages) ? verifiedTool.messages : []).find((message) => message?.type === "request-start");
      const verificationChecks = {
        pilotToolAttached: verifiedToolIds.includes(existingToolId),
        sharedCustomerRemoved: !verifiedToolIds.includes(SHARED_CUSTOMER_TOOL_ID),
        sharedOwnerRemoved: !verifiedToolIds.includes(SHARED_OWNER_TOOL_ID),
        promptMarkerInstalled: verifiedPrompt.includes(PILOT_PROMPT_MARKER),
        toolNameInstalled: verifiedPrompt.includes(toolName),
        callerAcknowledgementInstalled: verifiedPrompt.includes("I'll use the number you're calling from"),
        callerDigitsGuardInstalled: verifiedPrompt.includes("Do not claim you can see or recite the digits"),
        mandatoryToolGateInstalled: verifiedPrompt.includes("MANDATORY TOOL GATE") && verifiedPrompt.includes("Do not speak a closing sentence"),
        unsupportedClaimsGuardInstalled: verifiedPrompt.includes("UNSUPPORTED BUSINESS CLAIMS"),
        callbackConsistencyGuardInstalled: verifiedPrompt.includes("CALLBACK CONSISTENCY"),
        deterministicToolMessageInstalled: requestStart?.content === TOOL_REQUEST_START_MESSAGE && requestStart?.blocking === false,
        ...inspectAssistantTiming(verified),
      };
      const valid = Object.values(verificationChecks).every(Boolean);
      if (!valid) console.error(JSON.stringify({ verificationChecks }, null, 2));
      if (!valid) throw new Error("Live verification did not confirm the refreshed caller-ID acknowledgement prompt.");
      console.log(JSON.stringify({
        applied: true,
        verified: true,
        existingToolReused: true,
        assistantIdHash: shortId(assistantId),
        toolIdHash: shortId(existingToolId),
        toolName,
        attachedToolCount: verifiedToolIds.length,
        sharedSmsToolsRemoved: true,
        callerAcknowledgementInstalled: true,
        mandatoryToolGateInstalled: true,
        unsupportedClaimsGuardInstalled: true,
        callbackConsistencyGuardInstalled: true,
        deterministicToolMessageInstalled: true,
        timingPlanInstalled: true,
      }, null, 2));
      return;
    } catch (error) {
      if (assistantPatched) {
        await request(`/assistant/${encodeURIComponent(assistantId)}`, {
          method: "PATCH",
          body: { model: originalModel },
          label: "Rollback refreshed pilot assistant",
        }).catch(() => {});
      }
      if (toolPatched && originalTool) {
        await request(`/tool/${encodeURIComponent(existingToolId)}`, {
          method: "PATCH",
          body: {
            type: originalTool.type,
            function: originalTool.function,
            code: originalTool.code,
            environmentVariables: originalTool.environmentVariables,
            messages: originalTool.messages,
            timeoutSeconds: originalTool.timeoutSeconds,
          },
          label: "Rollback refreshed pilot tool",
        }).catch(() => {});
      }
      throw error;
    }
  }

  const toolPayload = createToolPayload({ toolName, twilioAccountSid, twilioAuthToken, aiPhone, ownerPhone, statusCallback });
  let createdTool = null;
  let assistantPatched = false;
  const originalModel = assistant.model;
  try {
    createdTool = await request("/tool", { method: "POST", body: toolPayload, label: "Create isolated pilot tool" });
    const createdToolId = String(createdTool.id || "").trim();
    if (!createdToolId) throw new Error("Vapi created the pilot tool without returning its ID.");
    const nextToolIds = [...new Set(currentToolIds.filter((id) => ![SHARED_CUSTOMER_TOOL_ID, SHARED_OWNER_TOOL_ID].includes(id)).concat(createdToolId))];
    const { tools: _expandedTools, ...modelWithoutExpandedTools } = originalModel || {};
    const nextModel = {
      ...modelWithoutExpandedTools,
      toolIds: nextToolIds,
      messages: withPromptOverride(originalModel?.messages || [], toolName),
    };
    await request(`/assistant/${encodeURIComponent(assistantId)}`, {
      method: "PATCH",
      body: { model: nextModel, ...assistantTimingPatch() },
      label: "Attach isolated pilot tool",
    });
    assistantPatched = true;

    const verified = await request(`/assistant/${encodeURIComponent(assistantId)}`, { label: "Verify pilot assistant" });
    const verifiedToolIds = Array.isArray(verified?.model?.toolIds) ? verified.model.toolIds : [];
    const verifiedPrompt = systemPrompt(verified);
    const valid = verifiedToolIds.includes(createdToolId)
      && !verifiedToolIds.includes(SHARED_CUSTOMER_TOOL_ID)
      && !verifiedToolIds.includes(SHARED_OWNER_TOOL_ID)
      && verifiedPrompt.includes(PILOT_PROMPT_MARKER)
      && verifiedPrompt.includes(toolName);
    if (!valid) throw new Error("Live verification did not confirm the isolated routing configuration.");
    console.log(JSON.stringify({
      applied: true,
      verified: true,
      assistantIdHash: shortId(assistantId),
      toolIdHash: shortId(createdToolId),
      toolName,
      attachedToolCount: verifiedToolIds.length,
      sharedSmsToolsRemoved: true,
      promptOverrideInstalled: true,
    }, null, 2));
  } catch (error) {
    if (assistantPatched) {
      await request(`/assistant/${encodeURIComponent(assistantId)}`, {
        method: "PATCH",
        body: { model: originalModel },
        label: "Rollback pilot assistant",
      }).catch(() => {});
    }
    if (createdTool?.id) {
      await request(`/tool/${encodeURIComponent(createdTool.id)}`, {
        method: "DELETE",
        label: "Remove failed pilot tool",
      }).catch(() => {});
    }
    throw error;
  }
}

main().catch((error) => {
  console.error(`Pilot Vapi SMS repair failed: ${error.message || error}`);
  process.exitCode = 1;
});
