const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { loadProjectEnv } = require("./_helpers");

const env = loadProjectEnv();
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const confirmation = args.find((arg) => arg.startsWith("--confirm="))?.slice("--confirm=".length) || "";
const confirmationPhrase = "SET_RENDER_VAPI_PREVIEW";
const serviceId = String(env.RENDER_SERVICE_ID || "").trim();
const assistantId = String(env.VAPI_PREVIEW_ASSISTANT_ID || "").trim();
const maxDurationSeconds = 60;
const renderConfigPath = path.join(process.env.USERPROFILE || process.env.HOME || "", ".render", "cli.yaml");

function hash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 12);
}

function stripYamlValue(value) {
  const text = String(value || "").trim();
  if (
    (text.startsWith("\"") && text.endsWith("\""))
    || (text.startsWith("'") && text.endsWith("'"))
  ) {
    return text.slice(1, -1);
  }
  return text;
}

function readRenderCredentials() {
  const source = fs.readFileSync(renderConfigPath, "utf8");
  const apiBlock = source.match(/(?:^|\r?\n)api:\s*\r?\n([\s\S]*?)(?=\r?\n\S|\s*$)/);
  if (!apiBlock) throw new Error("The signed-in Render CLI profile does not contain an API section.");
  const key = stripYamlValue(apiBlock[1].match(/^\s+key:\s*(.+)$/m)?.[1]);
  const host = stripYamlValue(apiBlock[1].match(/^\s+host:\s*(.+)$/m)?.[1]).replace(/\/+$/, "");
  if (!key || !host) throw new Error("The signed-in Render CLI profile is incomplete.");
  return { key, host };
}

async function renderRequest(credentials, endpoint, options = {}) {
  const response = await fetch(`${credentials.host}${endpoint}`, {
    ...options,
    headers: {
      authorization: `Bearer ${credentials.key}`,
      accept: "application/json",
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  if (!response.ok) throw new Error(`Render request failed with HTTP ${response.status}.`);
  return payload;
}

function envValue(payload) {
  return String(payload?.value ?? payload?.envVar?.value ?? "").trim();
}

async function main() {
  if (!serviceId) throw new Error("RENDER_SERVICE_ID is not configured.");
  if (!/^[0-9a-f-]{36}$/i.test(assistantId)) {
    throw new Error("VAPI_PREVIEW_ASSISTANT_ID must be configured with a valid assistant ID.");
  }

  console.log(JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    serviceId,
    keys: ["VAPI_PREVIEW_ASSISTANT_ID", "VAPI_PREVIEW_MAX_DURATION_SECONDS"],
    assistantIdHash: hash(assistantId),
    maxDurationSeconds,
  }, null, 2));

  if (!apply) {
    console.log(`Dry run only. Re-run with --apply --confirm=${confirmationPhrase}.`);
    return;
  }
  if (confirmation !== confirmationPhrase) {
    throw new Error(`Refusing to update Render without --confirm=${confirmationPhrase}.`);
  }

  const credentials = readRenderCredentials();
  const assistantEndpoint = `/services/${encodeURIComponent(serviceId)}/env-vars/VAPI_PREVIEW_ASSISTANT_ID`;
  const durationEndpoint = `/services/${encodeURIComponent(serviceId)}/env-vars/VAPI_PREVIEW_MAX_DURATION_SECONDS`;
  await renderRequest(credentials, assistantEndpoint, {
    method: "PUT",
    body: JSON.stringify({ value: assistantId }),
  });
  await renderRequest(credentials, durationEndpoint, {
    method: "PUT",
    body: JSON.stringify({ value: String(maxDurationSeconds) }),
  });
  const storedAssistantId = envValue(await renderRequest(credentials, assistantEndpoint));
  const storedDuration = envValue(await renderRequest(credentials, durationEndpoint));
  if (storedAssistantId !== assistantId || storedDuration !== String(maxDurationSeconds)) {
    throw new Error("Render did not return the expected preview environment values.");
  }
  const deploy = await renderRequest(
    credentials,
    `/services/${encodeURIComponent(serviceId)}/deploys`,
    {
      method: "POST",
      body: JSON.stringify({ deployMode: "deploy_only" }),
    }
  );

  console.log(JSON.stringify({
    ok: true,
    serviceId,
    keys: ["VAPI_PREVIEW_ASSISTANT_ID", "VAPI_PREVIEW_MAX_DURATION_SECONDS"],
    valuesVerified: true,
    assistantIdHash: hash(assistantId),
    maxDurationSeconds,
    deployId: deploy?.id || deploy?.deploy?.id || "",
    deployStatus: deploy?.status || deploy?.deploy?.status || "requested",
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exitCode = 1;
});
