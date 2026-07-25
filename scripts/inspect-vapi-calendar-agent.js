const crypto = require("crypto");
const fs = require("fs");
const { normalizeE164 } = require("../server/compositeCallNotifications");

const args = process.argv.slice(2);
const envFileArg = args.find((value) => value.startsWith("--env-file="));
const envFile = envFileArg ? envFileArg.slice("--env-file=".length).trim() : "";

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

const apiKeyNames = ["VAPI_API_KEY", "VAPI_KEY", "VAPI_TOKEN"];
const apiKey = String(
  process.env.VAPI_API_KEY
    || process.env.VAPI_KEY
    || process.env.VAPI_TOKEN
    || envValueFromFile(envFile, apiKeyNames)
    || ""
).trim();
const apiBase = String(process.env.VAPI_API_BASE_URL || "https://api.vapi.ai").replace(/\/+$/, "");
const targetPhoneArg = args.find((value) => !value.startsWith("--"));
const targetPhone = normalizeE164(targetPhoneArg || "+12494682588");

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

function serverHost(value) {
  const url = String(value || "").trim();
  if (!url) return "";
  try {
    return new URL(url).host;
  } catch {
    return "(invalid URL)";
  }
}

async function request(pathname) {
  const response = await fetch(`${apiBase}${pathname}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
  });
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = {};
  }
  if (!response.ok) {
    throw new Error(`GET ${pathname} failed with HTTP ${response.status}: ${String(payload.message || payload.error || "request failed").slice(0, 200)}`);
  }
  return payload;
}

async function main() {
  if (!apiKey) throw new Error("VAPI_API_KEY is not configured.");
  if (!targetPhone) throw new Error("A valid target phone number is required.");

  const phones = listFrom(await request("/phone-number?limit=1000"), ["phoneNumbers", "phone_numbers"]);
  const phone = phones.find((record) => phoneNumber(record) === targetPhone);
  if (!phone) throw new Error(`No Vapi phone number ending ${targetPhone.slice(-4)} was found.`);

  const assistantId = String(phone?.assistantId || phone?.assistant?.id || "").trim();
  if (!assistantId) throw new Error(`The Vapi number ending ${targetPhone.slice(-4)} has no assistant.`);

  const assistant = await request(`/assistant/${encodeURIComponent(assistantId)}`);
  const toolIds = Array.isArray(assistant?.model?.toolIds) ? assistant.model.toolIds : [];
  const storedTools = await Promise.all(toolIds.map((id) => request(`/tool/${encodeURIComponent(id)}`)));
  const inlineTools = Array.isArray(assistant?.model?.tools) ? assistant.model.tools : [];
  const tools = [...storedTools, ...inlineTools];
  const accountToolPage = await request("/tool?limit=1000");
  const accountTools = listFrom(accountToolPage, ["tools"]);

  const toolSummaries = tools.map((tool) => {
    const parameters = tool?.function?.parameters || {};
    const properties = parameters?.properties && typeof parameters.properties === "object"
      ? Object.keys(parameters.properties)
      : [];
    return {
      idHash: tool?.id ? shortId(tool.id) : "",
      name: functionName(tool),
      type: String(tool?.type || ""),
      required: Array.isArray(parameters.required) ? parameters.required : [],
      properties,
      serverHost: serverHost(tool?.server?.url),
    };
  });

  const appointmentTools = toolSummaries.filter((tool) =>
    ["request_appointment", "create_appointment_request"].includes(tool.name.toLowerCase())
  );
  const accountAppointmentTools = accountTools
    .filter((tool) => ["request_appointment", "create_appointment_request"].includes(functionName(tool).toLowerCase()))
    .map((tool) => {
      const parameters = tool?.function?.parameters || {};
      return {
        idHash: shortId(tool.id),
        name: functionName(tool),
        type: String(tool?.type || ""),
        required: Array.isArray(parameters.required) ? parameters.required : [],
        properties: parameters?.properties && typeof parameters.properties === "object"
          ? Object.keys(parameters.properties)
          : [],
        serverHost: serverHost(tool?.server?.url),
      };
    });
  const systemPrompt = String(
    (assistant?.model?.messages || []).find((message) => message?.role === "system")?.content || ""
  );

  console.log(JSON.stringify({
    targetPhoneEnding: targetPhone.slice(-4),
    phoneIdHash: shortId(phone.id),
    assistantIdHash: shortId(assistantId),
    assistantName: String(assistant?.name || ""),
    assistantServerHost: serverHost(assistant?.server?.url),
    assistantPromptMentionsBooking: /\b(?:appointment|book(?:ing)?|calendar|schedule)\b/i.test(systemPrompt),
    assistantPromptNamesAppointmentTool: /\b(?:request_appointment|create_appointment_request)\b/i.test(systemPrompt),
    assistantPromptRequestsBookingDetails: [
      /\b(?:customer|caller|your)\s+name\b/i,
      /\b(?:phone|callback)\b/i,
      /\b(?:service|reason|work)\b/i,
      /\b(?:date|day)\b/i,
      /\btime\b/i,
    ].every((pattern) => pattern.test(systemPrompt)),
    toolCount: toolSummaries.length,
    appointmentToolCount: appointmentTools.length,
    appointmentTools,
    accountAppointmentToolCount: accountAppointmentTools.length,
    accountAppointmentTools,
    tools: toolSummaries.map(({ required, properties, ...tool }) => tool),
  }, null, 2));

  if (!appointmentTools.length && !accountAppointmentTools.length) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
