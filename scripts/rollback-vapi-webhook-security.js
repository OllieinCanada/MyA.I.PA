const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { loadProjectEnv } = require("./_helpers");

const env = loadProjectEnv();
const apiKey = String(env.VAPI_API_KEY || env.VAPI_KEY || env.VAPI_TOKEN || "").trim();
const baseUrl = String(env.VAPI_API_BASE_URL || "https://api.vapi.ai").replace(/\/+$/, "");
const args = process.argv.slice(2);
const backupStamp = args.find((arg) => arg.startsWith("--backup-stamp="))?.slice("--backup-stamp=".length) || "";
const excludeLast4 = new Set(
  String(args.find((arg) => arg.startsWith("--exclude-last4="))?.slice("--exclude-last4=".length) || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
);
const confirmation = args.find((arg) => arg.startsWith("--confirm="))?.slice("--confirm=".length) || "";
const confirmationPhrase = "ROLLBACK_UNMAPPED_VAPI_WEBHOOKS";

function shortHash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 12);
}

async function request(endpoint, { method = "GET", body } = {}) {
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
}

function normalizedServerUrl(assistant) {
  return String(assistant?.server?.url || assistant?.serverUrl || "");
}

function normalizedMessages(assistant) {
  return [...new Set(Array.isArray(assistant?.serverMessages) ? assistant.serverMessages.map(String) : [])].sort();
}

async function main() {
  if (!apiKey) throw new Error("VAPI_API_KEY is not configured.");
  if (!backupStamp) throw new Error("--backup-stamp is required.");
  if (!/^[0-9TZ-]+$/.test(backupStamp)) throw new Error("--backup-stamp has an invalid format.");
  if (confirmation !== confirmationPhrase) throw new Error(`Rollback requires --confirm=${confirmationPhrase}.`);

  const backupDir = path.join(process.cwd(), "diagnostics", "vapi-webhook-security");
  const backupFiles = fs.readdirSync(backupDir)
    .filter((name) => name.endsWith(`${backupStamp}.json`))
    .filter((name) => !excludeLast4.has(name.slice(0, 4)))
    .sort();
  if (!backupFiles.length) throw new Error("No matching webhook backups were found.");

  const results = [];
  for (const fileName of backupFiles) {
    const backup = JSON.parse(fs.readFileSync(path.join(backupDir, fileName), "utf8"));
    const assistant = backup?.assistant;
    const assistantId = String(assistant?.id || "");
    const phoneLast4 = fileName.slice(0, 4);
    if (!assistantId) throw new Error(`Backup ${fileName} has no assistant id.`);
    const originalMessages = normalizedMessages(assistant);
    await request(`/assistant/${encodeURIComponent(assistantId)}`, {
      method: "PATCH",
      body: {
        server: assistant?.server || null,
        serverMessages: originalMessages,
      },
    });
    const verified = await request(`/assistant/${encodeURIComponent(assistantId)}`);
    const urlRestored = normalizedServerUrl(verified) === normalizedServerUrl(assistant);
    const messagesRestored = JSON.stringify(normalizedMessages(verified)) === JSON.stringify(originalMessages);
    results.push({
      assistantIdHash: shortHash(assistantId),
      phoneLast4,
      urlRestored,
      messagesRestored,
      ok: urlRestored && messagesRestored,
    });
  }

  console.log(JSON.stringify({
    backupStamp,
    excludedLast4: [...excludeLast4],
    processed: results.length,
    passed: results.filter((result) => result.ok).length,
    results,
  }, null, 2));
  if (results.some((result) => !result.ok)) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
