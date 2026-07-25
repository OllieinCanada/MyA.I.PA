const crypto = require("crypto");
const fs = require("fs");
const { normalizeE164 } = require("../server/compositeCallNotifications");

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const confirmation = valueFor("confirm");
const confirmationPhrase = "ATTACH_CALENDAR_TOOL_2588";
const envFile = valueFor("env-file");
const targetPhone = normalizeE164(valueFor("phone") || "+12494682588");
const apiBase = String(process.env.VAPI_API_BASE_URL || "https://api.vapi.ai").replace(/\/+$/, "");
const apiKeyNames = ["VAPI_API_KEY", "VAPI_KEY", "VAPI_TOKEN"];
const apiKey = String(
  process.env.VAPI_API_KEY
    || process.env.VAPI_KEY
    || process.env.VAPI_TOKEN
    || envValueFromFile(envFile, apiKeyNames)
    || ""
).trim();

const toolName = "request_appointment";
const promptMarker = "## CALENDAR BOOKING TOOL: request_appointment";

function valueFor(name) {
  const prefix = `--${name}=`;
  const item = args.find((value) => value.startsWith(prefix));
  return item ? item.slice(prefix.length).trim() : "";
}

function envValueFromFile(filePath, names) {
  if (!filePath || !fs.existsSync(filePath)) return "";
  const wanted = new Set(names);
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || !wanted.has(match[1])) continue;
    return match[2].trim().replace(/^['"]|['"]$/g, "");
  }
  return "";
}

function listFrom(value, keys = []) {
  if (Array.isArray(value)) return value;
  for (const key of ["data", "results", ...keys]) {
    if (Array.isArray(value?.[key])) return value[key];
  }
  return [];
}

function shortId(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 12);
}

function phoneNumber(record) {
  return normalizeE164(record?.number || record?.phoneNumber || record?.twilioPhoneNumber || record?.providerResourceId);
}

function functionName(tool) {
  return String(tool?.function?.name || tool?.name || "").trim();
}

function systemPrompt(assistant) {
  return String((assistant?.model?.messages || []).find((message) => message?.role === "system")?.content || "");
}

function withCalendarPrompt(messages = []) {
  const override = `${promptMarker}
- Only offer booking after recording consent has been handled under the existing consent rules and the caller explicitly asks to book.
- Collect the caller's name, callback phone number, requested service, requested date and time, and optional email/address. Use America/Toronto unless the caller clearly gives another timezone. Use 60 minutes when no duration is stated.
- Read the proposed date and time back and get an explicit yes before calling the tool.
- After confirmation, call request_appointment exactly once with customerName, customerPhone, customerEmail when given, service, address when given, requestedStart as ISO 8601 with a UTC offset, durationMinutes, and timezone.
- The tool-call turn must contain the tool call only. Never invent availability.
- Treat the tool result as authoritative. Say the appointment is confirmed only when the result status is CONFIRMED. If it is PENDING, say the request was sent but is not confirmed.`;
  let foundSystem = false;
  const next = messages.map((message) => {
    if (message?.role !== "system") return message;
    foundSystem = true;
    const content = String(message.content || "");
    const markerIndex = content.indexOf(promptMarker);
    return {
      ...message,
      content: `${markerIndex >= 0 ? content.slice(0, markerIndex).trimEnd() : content.trimEnd()}\n\n${override}`,
    };
  });
  if (!foundSystem) next.unshift({ role: "system", content: override });
  return next;
}

function toolPayload() {
  return {
    type: "function",
    function: {
      name: toolName,
      description: "Create a real appointment request after the caller explicitly confirms the collected booking details. The My AI PA backend checks weekly hours, buffers, existing appointments, and the connected owner calendar. It returns CONFIRMED only when automatic booking succeeds; otherwise it returns PENDING.",
      parameters: {
        type: "object",
        properties: {
          customerName: {
            type: "string",
            description: "The caller's full name.",
          },
          customerPhone: {
            type: "string",
            description: "The caller's callback phone number in E.164 format when possible.",
          },
          customerEmail: {
            type: "string",
            description: "The caller's email address, only when provided.",
          },
          service: {
            type: "string",
            description: "The service, work, or reason for the appointment.",
          },
          address: {
            type: "string",
            description: "The service address, only when relevant and provided.",
          },
          requestedStart: {
            type: "string",
            description: "The explicitly confirmed appointment start in ISO 8601 format with a UTC offset, for example 2026-07-27T10:00:00-04:00.",
          },
          durationMinutes: {
            type: "integer",
            minimum: 15,
            maximum: 480,
            description: "Appointment duration in minutes. Use 60 when the caller does not specify a duration.",
          },
          timezone: {
            type: "string",
            description: "IANA timezone. Use America/Toronto unless the caller clearly specifies another timezone.",
          },
        },
        required: ["customerName", "customerPhone", "service", "requestedStart", "durationMinutes", "timezone"],
      },
    },
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
    throw new Error(`${method} ${pathname} failed with HTTP ${response.status}: ${String(payload.message || payload.error || "request failed").slice(0, 240)}`);
  }
  return payload;
}

async function safeDeleteTool(toolId) {
  if (!toolId) return;
  await request(`/tool/${encodeURIComponent(toolId)}`, { method: "DELETE" }).catch(() => {});
}

async function main() {
  if (!apiKey) throw new Error("VAPI_API_KEY is not configured.");
  if (!targetPhone) throw new Error("--phone must be a valid E.164 phone number.");
  if (apply && confirmation !== confirmationPhrase) {
    throw new Error(`Apply mode requires --confirm=${confirmationPhrase}.`);
  }

  const phones = listFrom(await request("/phone-number?limit=1000"), ["phoneNumbers", "phone_numbers"]);
  const phone = phones.find((record) => phoneNumber(record) === targetPhone);
  if (!phone) throw new Error(`Vapi phone ending ${targetPhone.slice(-4)} was not found.`);

  const assistantId = String(phone?.assistantId || phone?.assistant?.id || "").trim();
  if (!assistantId) throw new Error("The target phone has no assigned assistant.");
  const assignedPhones = phones
    .filter((record) => String(record?.assistantId || record?.assistant?.id || "").trim() === assistantId)
    .map(phoneNumber)
    .filter(Boolean);
  if (assignedPhones.length !== 1 || assignedPhones[0] !== targetPhone) {
    throw new Error(`Refusing to patch a shared assistant; it is assigned to ${assignedPhones.length} phone numbers.`);
  }

  const [assistant, toolPage] = await Promise.all([
    request(`/assistant/${encodeURIComponent(assistantId)}`),
    request("/tool?limit=1000"),
  ]);
  const accountTools = listFrom(toolPage, ["tools"]);
  const matchingTools = accountTools.filter((tool) => functionName(tool).toLowerCase() === toolName);
  if (matchingTools.length > 1) throw new Error(`Refusing to continue: ${matchingTools.length} ${toolName} tools already exist.`);

  const originalModel = assistant.model || {};
  const originalToolIds = Array.isArray(originalModel.toolIds) ? originalModel.toolIds.map(String) : [];
  const existingTool = matchingTools[0] || null;
  const existingAttached = Boolean(existingTool?.id && originalToolIds.includes(existingTool.id));
  const promptAlreadyConfigured = systemPrompt(assistant).includes(promptMarker);

  console.log(JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    phoneEnding: targetPhone.slice(-4),
    assistantIdHash: shortId(assistantId),
    assignedPhoneCount: assignedPhones.length,
    currentToolCount: originalToolIds.length,
    appointmentToolExists: Boolean(existingTool),
    appointmentToolAttached: existingAttached,
    calendarPromptConfigured: promptAlreadyConfigured,
    plannedActions: [
      ...(!existingTool ? ["create appointment tool"] : []),
      ...(!existingAttached ? ["attach appointment tool while preserving existing tools"] : []),
      ...(!promptAlreadyConfigured ? ["install guarded calendar booking prompt"] : []),
    ],
  }, null, 2));

  if (!apply || (existingAttached && promptAlreadyConfigured)) return;

  let createdTool = null;
  let assistantPatched = false;
  try {
    const tool = existingTool || await request("/tool", { method: "POST", body: toolPayload() });
    if (!existingTool) createdTool = tool;
    const toolId = String(tool?.id || "").trim();
    if (!toolId) throw new Error("Vapi did not return an appointment tool ID.");

    const { tools: _expandedTools, ...modelWithoutExpandedTools } = originalModel;
    const nextModel = {
      ...modelWithoutExpandedTools,
      toolIds: [...new Set([...originalToolIds, toolId])],
      messages: withCalendarPrompt(originalModel.messages || []),
    };

    await request(`/assistant/${encodeURIComponent(assistantId)}`, {
      method: "PATCH",
      body: { model: nextModel },
    });
    assistantPatched = true;

    const [verifiedAssistant, verifiedTool] = await Promise.all([
      request(`/assistant/${encodeURIComponent(assistantId)}`),
      request(`/tool/${encodeURIComponent(toolId)}`),
    ]);
    const verifiedToolIds = Array.isArray(verifiedAssistant?.model?.toolIds)
      ? verifiedAssistant.model.toolIds.map(String)
      : [];
    const checks = {
      originalToolsPreserved: originalToolIds.every((id) => verifiedToolIds.includes(id)),
      appointmentToolAttached: verifiedToolIds.includes(toolId),
      appointmentToolNamedCorrectly: functionName(verifiedTool) === toolName,
      guardedPromptInstalled: systemPrompt(verifiedAssistant).includes(promptMarker),
      assistantStillIsolated: assignedPhones.length === 1 && assignedPhones[0] === targetPhone,
    };
    if (!Object.values(checks).every(Boolean)) throw new Error("Live Vapi read-back did not pass every calendar-tool check.");

    console.log(JSON.stringify({
      applied: true,
      verified: true,
      assistantIdHash: shortId(assistantId),
      toolIdHash: shortId(toolId),
      createdTool: Boolean(createdTool),
      attachedToolCount: verifiedToolIds.length,
      checks,
    }, null, 2));
  } catch (error) {
    if (assistantPatched) {
      await request(`/assistant/${encodeURIComponent(assistantId)}`, {
        method: "PATCH",
        body: { model: originalModel },
      }).catch(() => {});
    }
    if (createdTool?.id) await safeDeleteTool(createdTool.id);
    throw error;
  }
}

main().catch((error) => {
  console.error(`Vapi calendar tool configuration failed: ${error.message || error}`);
  process.exitCode = 1;
});
