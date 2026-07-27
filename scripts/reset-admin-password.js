const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { loadProjectEnv, rootPath } = require("./_helpers");

const env = loadProjectEnv();
const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const confirmation = rawArgs.find((arg) => arg.startsWith("--confirm="))?.slice("--confirm=".length) || "";
const confirmationPhrase = "RESET_MYAIPA_ADMIN_PASSWORD";
const serviceId = String(env.RENDER_SERVICE_ID || "").trim();
const renderConfigPath = path.join(process.env.USERPROFILE || process.env.HOME || "", ".render", "cli.yaml");
const localEnvPath = rootPath(".env.local");
const statePath = rootPath("diagnostics", "admin", "password-reset-latest.json");

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
  if (!response.ok) {
    throw new Error(`Render request failed with HTTP ${response.status}.`);
  }
  return payload;
}

function envValue(payload) {
  return String(payload?.value ?? payload?.envVar?.value ?? "").trim();
}

async function getRemoteEnv(credentials, key) {
  return envValue(await renderRequest(
    credentials,
    `/services/${encodeURIComponent(serviceId)}/env-vars/${encodeURIComponent(key)}`
  ));
}

async function putRemoteEnv(credentials, key, value) {
  await renderRequest(
    credentials,
    `/services/${encodeURIComponent(serviceId)}/env-vars/${encodeURIComponent(key)}`,
    {
      method: "PUT",
      body: JSON.stringify({ value }),
    }
  );
}

function upsertEnv(source, key, value) {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  if (pattern.test(source)) return source.replace(pattern, line);
  return `${source.replace(/\s*$/, "")}\n${line}\n`;
}

async function main() {
  if (!args.has("--apply")) {
    console.log(`Dry run only. Re-run with --apply --confirm=${confirmationPhrase} after explicit authorization.`);
    return;
  }
  if (confirmation !== confirmationPhrase) {
    throw new Error(`Refusing to rotate production credentials without --confirm=${confirmationPhrase}.`);
  }
  if (!serviceId) throw new Error("RENDER_SERVICE_ID is not configured.");

  const credentials = readRenderCredentials();
  const oldPassword = await getRemoteEnv(credentials, "ADMIN_PASSWORD");
  const oldSessionSecret = await getRemoteEnv(credentials, "ADMIN_SESSION_SECRET");
  if (!oldPassword || !oldSessionSecret) {
    throw new Error("The existing Render admin credentials could not be read safely.");
  }

  const newPassword = `Myaipa-${crypto.randomBytes(24).toString("base64url")}`;
  const newSessionSecret = crypto.randomBytes(48).toString("base64url");
  const oldLocalSource = fs.existsSync(localEnvPath) ? fs.readFileSync(localEnvPath, "utf8") : "";
  let remotePasswordUpdated = false;
  let remoteSessionUpdated = false;

  try {
    await putRemoteEnv(credentials, "ADMIN_PASSWORD", newPassword);
    remotePasswordUpdated = true;
    await putRemoteEnv(credentials, "ADMIN_SESSION_SECRET", newSessionSecret);
    remoteSessionUpdated = true;

    const nextLocalSource = upsertEnv(
      upsertEnv(oldLocalSource, "ADMIN_PASSWORD", newPassword),
      "ADMIN_SESSION_SECRET",
      newSessionSecret
    );
    fs.writeFileSync(localEnvPath, nextLocalSource, "utf8");

    const deploy = await renderRequest(
      credentials,
      `/services/${encodeURIComponent(serviceId)}/deploys`,
      {
        method: "POST",
        body: JSON.stringify({ deployMode: "deploy_only" }),
      }
    );
    const report = {
      schemaVersion: 1,
      requestedAt: new Date().toISOString(),
      serviceId,
      deployId: deploy?.id || deploy?.deploy?.id || "",
      deployStatus: deploy?.status || deploy?.deploy?.status || "requested",
      updatedKeys: ["ADMIN_PASSWORD", "ADMIN_SESSION_SECRET"],
      passwordStoredAt: ".env.local",
      secretPrinted: false,
    };
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    if (remotePasswordUpdated) {
      await putRemoteEnv(credentials, "ADMIN_PASSWORD", oldPassword).catch(() => {});
    }
    if (remoteSessionUpdated) {
      await putRemoteEnv(credentials, "ADMIN_SESSION_SECRET", oldSessionSecret).catch(() => {});
    }
    fs.writeFileSync(localEnvPath, oldLocalSource, "utf8");
    throw error;
  }
}

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exitCode = 1;
});
