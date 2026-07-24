const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { loadProjectEnv } = require("./_helpers");
const { isManagedIsolatedTool } = require("../server/vapiIsolatedSmsProvisioning");
const { buildTradePlaybookPrompt, getTradePlaybook } = require("../server/tradePlaybooks");

const env = loadProjectEnv();
const apiKey = String(env.VAPI_API_KEY || env.VAPI_KEY || env.VAPI_TOKEN || "").trim();
const baseUrl = String(env.VAPI_API_BASE_URL || "https://api.vapi.ai").replace(/\/+$/, "");
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const confirmation = args.find((arg) => arg.startsWith("--confirm="))?.slice("--confirm=".length) || "";
const confirmationPhrase = "APPLY_ELECTRICIAN_PLAYBOOK_V1";
const beginMarker = "BEGIN MYAIPA ELECTRICIAN PLAYBOOK";
const endMarker = "END MYAIPA ELECTRICIAN PLAYBOOK";
const playbook = getTradePlaybook("electrician-v1");
const promptBlock = `${beginMarker}\n${buildTradePlaybookPrompt(playbook)}\n${endMarker}`;

function listFrom(value, keys = []) {
  if (Array.isArray(value)) return value;
  for (const key of ["data", "results", ...keys]) if (Array.isArray(value?.[key])) return value[key];
  return [];
}

function shortHash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 12);
}

function phoneNumber(record) {
  const digits = String(record?.number || record?.phoneNumber || record?.twilioPhoneNumber || "").replace(/\D/g, "");
  return digits ? `+${digits}` : "";
}

async function request(endpoint, { method = "GET", body } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= (method === "GET" ? 3 : 1); attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}${endpoint}`, {
        method,
        signal: AbortSignal.timeout(15_000),
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await response.text();
      let payload = {};
      try { payload = text ? JSON.parse(text) : {}; } catch (_error) { payload = {}; }
      if (!response.ok) throw new Error(`${method} ${endpoint} failed with HTTP ${response.status}: ${payload.message || payload.error || "request failed"}`);
      return payload;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
  throw lastError;
}

function systemPrompt(assistant) {
  return (assistant?.model?.messages || []).filter((message) => message?.role === "system").map((message) => String(message.content || "")).join("\n\n");
}

function webhookStatus(assistant) {
  const server = assistant?.server && typeof assistant.server === "object" ? assistant.server : {};
  const messages = Array.isArray(assistant?.serverMessages) ? assistant.serverMessages.map(String) : [];
  return {
    serverUrl: String(server.url || assistant?.serverUrl || ""),
    credentialConfigured: Boolean(server.credentialId),
    legacySecretConfigured: Boolean(server.secret || assistant?.serverUrlSecret),
    endOfCallReportEnabled: messages.includes("end-of-call-report"),
  };
}

function withPlaybook(messages) {
  let replaced = false;
  const next = (messages || []).map((message) => {
    if (message?.role !== "system" || replaced) return message;
    replaced = true;
    const current = String(message.content || "");
    const pattern = new RegExp(`\\n*${beginMarker}[\\s\\S]*?${endMarker}`, "g");
    return { ...message, content: `${current.replace(pattern, "").trimEnd()}\n\n${promptBlock}` };
  });
  if (!replaced) throw new Error("Assistant has no system message to patch safely.");
  return next;
}

async function main() {
  if (!apiKey) throw new Error("VAPI_API_KEY is not configured.");
  if (apply && confirmation !== confirmationPhrase) throw new Error(`Apply mode requires --confirm=${confirmationPhrase}.`);
  const [phonePayload, assistantPayload, toolPayload] = await Promise.all([
    request("/phone-number?limit=1000"), request("/assistant?limit=1000"), request("/tool?limit=1000"),
  ]);
  const phones = listFrom(phonePayload, ["phoneNumbers"]);
  const assistants = listFrom(assistantPayload, ["assistants"]);
  const tools = listFrom(toolPayload, ["tools"]);
  const managedToolIds = new Set(tools.filter(isManagedIsolatedTool).map((tool) => String(tool.id || "")));
  const phoneCountByAssistant = new Map();
  for (const phone of phones) {
    const id = String(phone?.assistantId || phone?.assistant?.id || "");
    if (!id) continue;
    phoneCountByAssistant.set(id, (phoneCountByAssistant.get(id) || 0) + 1);
  }

  const eligibleSummaries = assistants.filter((summary) => {
    const id = String(summary?.id || "");
    return id && phoneCountByAssistant.get(id) === 1;
  });
  const detailedAssistants = await Promise.all(eligibleSummaries.map((summary) => request(`/assistant/${encodeURIComponent(summary.id)}`)));
  const candidates = [];
  for (const assistant of detailedAssistants) {
    const id = String(assistant?.id || "");
    const toolIds = Array.isArray(assistant?.model?.toolIds) ? assistant.model.toolIds.map(String) : [];
    const prompt = systemPrompt(assistant);
    if (!toolIds.some((toolId) => managedToolIds.has(toolId))) continue;
    if (/\b(?:plumb|heating|hvac|roof|drain|furnace)\w*/i.test(String(assistant.name || ""))) continue;
    if (!/electri/i.test(`${assistant.name || ""}\n${prompt}`)) continue;
    const phone = phones.find((item) => String(item?.assistantId || item?.assistant?.id || "") === id);
    candidates.push({ assistant, phone: phoneNumber(phone), alreadyCurrent: prompt.includes(`${playbook.id} (${playbook.version})`) });
  }

  console.log(JSON.stringify({
    mode: apply ? "apply" : "dry-run", playbook: { id: playbook.id, version: playbook.version },
    candidates: candidates.map((item) => ({
      assistantIdHash: shortHash(item.assistant.id),
      name: item.assistant.name || "",
      phoneLast4: item.phone.slice(-4),
      alreadyCurrent: item.alreadyCurrent,
      webhook: webhookStatus(item.assistant),
    })),
  }, null, 2));
  if (!apply) return;

  const backupDir = path.join(process.cwd(), "diagnostics", "vapi-electrician-playbook");
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const results = [];
  for (const item of candidates) {
    const backupPath = path.join(backupDir, `${item.phone.slice(-4)}-${shortHash(item.assistant.id)}-${stamp}.json`);
    fs.writeFileSync(backupPath, `${JSON.stringify({ createdAt: new Date().toISOString(), assistant: item.assistant }, null, 2)}\n`, { flag: "wx" });
    const { tools: _expandedTools, ...model } = item.assistant.model || {};
    await request(`/assistant/${encodeURIComponent(item.assistant.id)}`, {
      method: "PATCH",
      body: { model: { ...model, messages: withPlaybook(model.messages || []) } },
    });
    const verified = await request(`/assistant/${encodeURIComponent(item.assistant.id)}`);
    const prompt = systemPrompt(verified);
    results.push({
      assistantIdHash: shortHash(item.assistant.id), phoneLast4: item.phone.slice(-4),
      ok: prompt.includes(`${playbook.id} (${playbook.version})`) && prompt.includes(beginMarker) && prompt.includes(endMarker),
    });
  }
  console.log(JSON.stringify({ applied: results.length, passed: results.filter((item) => item.ok).length, results }, null, 2));
  if (results.some((item) => !item.ok)) process.exitCode = 2;
}

main().catch((error) => { console.error(error.message || error); process.exitCode = 1; });
