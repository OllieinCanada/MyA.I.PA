const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { loadProjectEnv } = require("./_helpers");
const { isManagedIsolatedTool } = require("../server/vapiIsolatedSmsProvisioning");
const { deriveVapiWebhookSecret } = require("../server/vapiWebhookAuth");

const env = loadProjectEnv();
const apiKey = String(env.VAPI_API_KEY || env.VAPI_KEY || env.VAPI_TOKEN || "").trim();
const configuredSecret = String(env.VAPI_WEBHOOK_SECRET || "").trim();
const webhookSecret = configuredSecret || deriveVapiWebhookSecret(apiKey);
const baseUrl = String(env.VAPI_API_BASE_URL || "https://api.vapi.ai").replace(/\/+$/, "");
const webhookUrl = String(env.VAPI_WEBHOOK_URL || "https://api.myaipa.ca/api/webhooks/voice").trim();
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const probeOnly = args.includes("--probe-only");
const confirmation = args.find((arg) => arg.startsWith("--confirm="))?.slice("--confirm=".length) || "";
const phoneLast4Filter = args.find((arg) => arg.startsWith("--phone-last4="))?.slice("--phone-last4=".length) || "";
const confirmationPhrase = "APPLY_VAPI_WEBHOOK_SECURITY_V1";

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
  const attempts = method === "GET" ? 3 : 1;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}${endpoint}`, {
        method,
        signal: AbortSignal.timeout(15_000),
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await response.text();
      let payload = {};
      try { payload = text ? JSON.parse(text) : {}; } catch (_error) { payload = {}; }
      if (!response.ok) {
        throw new Error(`${method} ${endpoint} failed with HTTP ${response.status}: ${payload.message || payload.error || "request failed"}`);
      }
      return payload;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
  throw lastError;
}

function webhookStatus(assistant) {
  const server = assistant?.server && typeof assistant.server === "object" ? assistant.server : {};
  const messages = Array.isArray(assistant?.serverMessages) ? assistant.serverMessages.map(String) : [];
  return {
    urlCorrect: String(server.url || assistant?.serverUrl || "") === webhookUrl,
    authenticationConfigured: Boolean(server.credentialId || server.secret || assistant?.serverUrlSecret),
    endOfCallReportEnabled: messages.includes("end-of-call-report"),
    toolCallsEnabled: messages.includes("tool-calls"),
  };
}

function isWebhookCurrent(assistant) {
  return Object.values(webhookStatus(assistant)).every(Boolean);
}

async function probeBackend(assistantId) {
  const response = await fetch(webhookUrl, {
    method: "POST",
    signal: AbortSignal.timeout(15_000),
    headers: { "Content-Type": "application/json", "X-Vapi-Secret": webhookSecret },
    body: JSON.stringify({ eventType: "test.noop", call: { assistantId } }),
  });
  let payload = {};
  try { payload = await response.json(); } catch (_error) { payload = {}; }
  return {
    ok: response.status === 200 && payload.ok === true,
    status: response.status,
    code: String(payload.code || ""),
    mappingRequired: response.status === 422,
  };
}

async function main() {
  if (!apiKey) throw new Error("VAPI_API_KEY is not configured.");
  if (!webhookSecret) throw new Error("A Vapi webhook secret could not be resolved.");
  if (apply && confirmation !== confirmationPhrase) {
    throw new Error(`Apply mode requires --confirm=${confirmationPhrase}.`);
  }

  const [phonePayload, assistantPayload, toolPayload] = await Promise.all([
    request("/phone-number?limit=1000"),
    request("/assistant?limit=1000"),
    request("/tool?limit=1000"),
  ]);
  const phones = listFrom(phonePayload, ["phoneNumbers"]);
  const assistants = listFrom(assistantPayload, ["assistants"]);
  const tools = listFrom(toolPayload, ["tools"]);
  const managedToolIds = new Set(tools.filter(isManagedIsolatedTool).map((tool) => String(tool.id || "")));
  const phonesByAssistant = new Map();
  for (const phone of phones) {
    const assistantId = String(phone?.assistantId || phone?.assistant?.id || "");
    if (!assistantId) continue;
    const assigned = phonesByAssistant.get(assistantId) || [];
    assigned.push(phone);
    phonesByAssistant.set(assistantId, assigned);
  }

  const eligibleSummaries = assistants.filter((summary) => {
    const id = String(summary?.id || "");
    return id && phonesByAssistant.get(id)?.length === 1;
  });
  const detailed = await Promise.all(eligibleSummaries.map((summary) => request(`/assistant/${encodeURIComponent(summary.id)}`)));
  const candidates = detailed
    .filter((assistant) => {
      const toolIds = Array.isArray(assistant?.model?.toolIds) ? assistant.model.toolIds.map(String) : [];
      return toolIds.some((toolId) => managedToolIds.has(toolId));
    })
    .map((assistant) => {
      const phone = phoneNumber(phonesByAssistant.get(String(assistant.id))?.[0]);
      return { assistant, phone };
    })
    .filter((item) => !phoneLast4Filter || item.phone.endsWith(phoneLast4Filter));

  const inventory = candidates.map((item) => ({
    assistantIdHash: shortHash(item.assistant.id),
    name: String(item.assistant.name || ""),
    phoneLast4: item.phone.slice(-4),
    current: isWebhookCurrent(item.assistant),
    status: webhookStatus(item.assistant),
  }));
  console.log(JSON.stringify({
    mode: probeOnly ? "probe-only" : apply ? "apply" : "dry-run",
    secretSource: configuredSecret ? "explicit" : "derived-webhook-only",
    webhookUrl,
    candidates: inventory.length,
    current: inventory.filter((item) => item.current).length,
    inventory,
  }, null, 2));

  if (!apply && !probeOnly) return;
  const backupDir = path.join(process.cwd(), "diagnostics", "vapi-webhook-security");
  if (apply) fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const results = [];

  for (const item of candidates) {
    if (apply) {
      const backupPath = path.join(backupDir, `${item.phone.slice(-4)}-${shortHash(item.assistant.id)}-${stamp}.json`);
      fs.writeFileSync(backupPath, `${JSON.stringify({ createdAt: new Date().toISOString(), assistant: item.assistant }, null, 2)}\n`, { flag: "wx" });
      const existingServer = item.assistant?.server && typeof item.assistant.server === "object" ? item.assistant.server : {};
      const existingMessages = Array.isArray(item.assistant?.serverMessages) ? item.assistant.serverMessages.map(String) : [];
      await request(`/assistant/${encodeURIComponent(item.assistant.id)}`, {
        method: "PATCH",
        body: {
          server: { ...existingServer, url: webhookUrl, secret: webhookSecret },
          serverMessages: [...new Set([...existingMessages, "end-of-call-report", "tool-calls"])],
        },
      });
    }
    const verified = await request(`/assistant/${encodeURIComponent(item.assistant.id)}`);
    const probe = await probeBackend(item.assistant.id);
    results.push({
      assistantIdHash: shortHash(item.assistant.id),
      phoneLast4: item.phone.slice(-4),
      readback: webhookStatus(verified),
      probe,
      ok: isWebhookCurrent(verified) && probe.ok,
    });
  }

  console.log(JSON.stringify({
    processed: results.length,
    passed: results.filter((item) => item.ok).length,
    mappingFailures: results.filter((item) => item.probe.mappingRequired).map((item) => item.phoneLast4),
    results,
  }, null, 2));
  if (results.some((item) => !item.ok)) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
