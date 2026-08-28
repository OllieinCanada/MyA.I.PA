const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { loadProjectEnv } = require("./_helpers");

const env = loadProjectEnv();
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const rotateSigningSecret = args.includes("--rotate-signing-secret");
const confirmation = args.find((arg) => arg.startsWith("--confirm="))?.slice("--confirm=".length) || "";
const serviceId = (
  args.find((arg) => arg.startsWith("--service-id="))?.slice("--service-id=".length)
  || env.RENDER_SERVICE_ID
  || ""
).trim();
const manualApproval = (
  args.find((arg) => arg.startsWith("--manual-approval="))?.slice("--manual-approval=".length)
  || "true"
).trim().toLowerCase();
const confirmationPhrase = "SET_RENDER_SIGNUP_SAFETY";
const telegramBotToken = String(env.TELEGRAM_BOT_TOKEN || "").trim();
const telegramChatId = String(env.TELEGRAM_CHAT_ID || "").trim();
const localSigningSecret = String(env.PROVISIONING_SIGNING_SECRET || "").trim();
const twilioStatusCallbackUrl = "https://api.myaipa.ca/api/webhooks/twilio/message-status";
const signingSecret = rotateSigningSecret
  ? crypto.randomBytes(32).toString("hex")
  : localSigningSecret;
const renderConfigPath = path.join(
  process.env.USERPROFILE || process.env.HOME || "",
  ".render",
  "cli.yaml"
);

function stripYamlValue(value) {
  const text = String(value || "").trim();
  if (
    (text.startsWith('"') && text.endsWith('"'))
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
  if (!/^srv-[a-z0-9]+$/i.test(serviceId)) {
    throw new Error("Provide a valid Render service ID with --service-id=... or RENDER_SERVICE_ID.");
  }
  if (!telegramBotToken || !telegramChatId) {
    throw new Error("TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be configured locally.");
  }
  if (!["true", "false"].includes(manualApproval)) {
    throw new Error("--manual-approval must be true or false.");
  }
  if (rotateSigningSecret && localSigningSecret) {
    throw new Error("Refusing to rotate while a local PROVISIONING_SIGNING_SECRET is configured.");
  }

  const updates = new Map([
    ["TELEGRAM_BOT_TOKEN", telegramBotToken],
    ["TELEGRAM_CHAT_ID", telegramChatId],
    ["RUNTIME_TELEGRAM_ALERTS_ENABLED", "true"],
    ["SIGNUP_REQUIRE_MANUAL_APPROVAL", manualApproval],
    ["TWILIO_STATUS_CALLBACK_URL", twilioStatusCallbackUrl],
  ]);
  if (signingSecret) updates.set("PROVISIONING_SIGNING_SECRET", signingSecret);

  console.log(JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    serviceId,
    keys: [...updates.keys()],
    manualApproval,
    telegramCredentialsPresent: true,
    signingSecretAction: rotateSigningSecret
      ? "generate"
      : signingSecret
        ? "set-from-local"
        : "preserve-and-verify",
  }, null, 2));

  if (!apply) {
    console.log(`Dry run only. Re-run with --apply --confirm=${confirmationPhrase}.`);
    return;
  }
  if (confirmation !== confirmationPhrase) {
    throw new Error(`Refusing to update Render without --confirm=${confirmationPhrase}.`);
  }

  const credentials = readRenderCredentials();
  for (const [key, value] of updates) {
    await renderRequest(
      credentials,
      `/services/${encodeURIComponent(serviceId)}/env-vars/${encodeURIComponent(key)}`,
      { method: "PUT", body: JSON.stringify({ value }) }
    );
  }

  for (const [key, expected] of updates) {
    const stored = envValue(await renderRequest(
      credentials,
      `/services/${encodeURIComponent(serviceId)}/env-vars/${encodeURIComponent(key)}`
    ));
    if (stored !== expected) throw new Error(`Render did not verify the expected value for ${key}.`);
  }

  if (!updates.has("PROVISIONING_SIGNING_SECRET")) {
    const storedSigningSecret = envValue(await renderRequest(
      credentials,
      `/services/${encodeURIComponent(serviceId)}/env-vars/PROVISIONING_SIGNING_SECRET`
    ));
    if (storedSigningSecret.length < 32) {
      throw new Error("Render does not have a usable PROVISIONING_SIGNING_SECRET to preserve.");
    }
  }

  const deploy = await renderRequest(
    credentials,
    `/services/${encodeURIComponent(serviceId)}/deploys`,
    { method: "POST", body: JSON.stringify({ deployMode: "deploy_only" }) }
  );

  console.log(JSON.stringify({
    ok: true,
    serviceId,
    keysVerified: [...updates.keys()],
    secretValuesPrinted: false,
    deployId: deploy?.id || deploy?.deploy?.id || "",
    deployStatus: deploy?.status || deploy?.deploy?.status || "requested",
  }, null, 2));
}

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exitCode = 1;
});
