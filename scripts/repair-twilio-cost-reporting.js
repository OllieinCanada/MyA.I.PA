const fs = require("fs");
const path = require("path");

const { loadProjectEnv, rootPath } = require("./_helpers");

const env = loadProjectEnv();
const rawArgs = process.argv.slice(2);
const apply = rawArgs.includes("--apply");
const confirmation = rawArgs.find((arg) => arg.startsWith("--confirm="))?.slice("--confirm=".length) || "";
const confirmationPhrase = "REPAIR_TWILIO_COST_REPORTING";
const serviceId = String(env.RENDER_SERVICE_ID || "").trim();
const renderConfigPath = path.join(process.env.USERPROFILE || process.env.HOME || "", ".render", "cli.yaml");
const reportPath = rootPath("diagnostics", "costs", "twilio-cost-auth-latest.json");
const remoteKeys = [
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_API_KEY_SID",
  "TWILIO_API_KEY_SECRET",
];

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

async function getRemoteEnv(credentials, key) {
  try {
    return envValue(await renderRequest(
      credentials,
      `/services/${encodeURIComponent(serviceId)}/env-vars/${encodeURIComponent(key)}`
    ));
  } catch (error) {
    if (/HTTP 404/.test(error?.message || "")) return "";
    throw error;
  }
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

function candidatesFrom(source, values) {
  const accountSid = String(values.TWILIO_ACCOUNT_SID || "").trim();
  const authToken = String(values.TWILIO_AUTH_TOKEN || "").trim();
  const apiKeySid = String(values.TWILIO_API_KEY_SID || "").trim();
  const apiKeySecret = String(values.TWILIO_API_KEY_SECRET || "").trim();
  const candidates = [];
  if (accountSid && apiKeySid && apiKeySecret) {
    candidates.push({
      source,
      mode: "api-key",
      accountSid,
      username: apiKeySid,
      password: apiKeySecret,
      values: {
        TWILIO_ACCOUNT_SID: accountSid,
        TWILIO_API_KEY_SID: apiKeySid,
        TWILIO_API_KEY_SECRET: apiKeySecret,
      },
    });
  }
  if (accountSid && authToken) {
    candidates.push({
      source,
      mode: "auth-token",
      accountSid,
      username: accountSid,
      password: authToken,
      values: {
        TWILIO_ACCOUNT_SID: accountSid,
        TWILIO_AUTH_TOKEN: authToken,
      },
    });
  }
  return candidates;
}

async function validateCandidate(candidate) {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(candidate.accountSid)}/Usage/Records.json?PageSize=1`;
  const response = await fetch(url, {
    headers: {
      authorization: `Basic ${Buffer.from(`${candidate.username}:${candidate.password}`).toString("base64")}`,
      accept: "application/json",
    },
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  return {
    valid: response.ok,
    status: response.status,
    error: response.ok ? "" : String(payload?.message || payload?.error || `HTTP ${response.status}`).slice(0, 160),
  };
}

function presence(values) {
  const accountSid = String(values.TWILIO_ACCOUNT_SID || "").trim();
  const authToken = String(values.TWILIO_AUTH_TOKEN || "").trim();
  const apiKeySid = String(values.TWILIO_API_KEY_SID || "").trim();
  const apiKeySecret = String(values.TWILIO_API_KEY_SECRET || "").trim();
  return {
    accountSid: Boolean(accountSid),
    authToken: Boolean(authToken),
    apiKeySid: Boolean(apiKeySid),
    apiKeySecret: Boolean(apiKeySecret),
    apiKeyComplete: Boolean(accountSid && apiKeySid && apiKeySecret),
  };
}

async function main() {
  if (!serviceId) throw new Error("RENDER_SERVICE_ID is not configured.");
  const renderCredentials = readRenderCredentials();
  const remoteValues = Object.fromEntries(await Promise.all(
    remoteKeys.map(async (key) => [key, await getRemoteEnv(renderCredentials, key)])
  ));
  const localReportingValues = {
    ...env,
    TWILIO_ACCOUNT_SID: String(env.TWILIO_ACCOUNT_SID || remoteValues.TWILIO_ACCOUNT_SID || "").trim(),
  };
  const candidates = [
    ...candidatesFrom("render", remoteValues),
    ...candidatesFrom("local", localReportingValues),
  ];
  const checks = [];
  let validCandidate = null;
  for (const candidate of candidates) {
    const check = await validateCandidate(candidate);
    checks.push({
      source: candidate.source,
      mode: candidate.mode,
      valid: check.valid,
      status: check.status,
      error: check.error,
    });
    if (!validCandidate && check.valid) validCandidate = candidate;
  }

  const report = {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    serviceId,
    mode: apply ? "apply" : "diagnose",
    ready: Boolean(validCandidate && validCandidate.source === "render"),
    remote: presence(remoteValues),
    local: presence(env),
    checks,
    selected: validCandidate ? { source: validCandidate.source, mode: validCandidate.mode } : null,
    secretPrinted: false,
    nextAction: "",
  };

  if (!validCandidate) {
    report.nextAction = remoteValues.TWILIO_ACCOUNT_SID
      ? "Create a Twilio API key, save TWILIO_API_KEY_SID and TWILIO_API_KEY_SECRET in .env.local, then rerun this command with --apply."
      : "Create a Twilio API key, save TWILIO_ACCOUNT_SID, TWILIO_API_KEY_SID, and TWILIO_API_KEY_SECRET in .env.local, then rerun this command with --apply.";
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = 2;
    return;
  }

  if (validCandidate.source === "render") {
    report.nextAction = "Render already has a valid reporting credential. Deploy code that supports the selected credential mode.";
  } else if (!apply) {
    report.nextAction = `A valid local ${validCandidate.mode} credential is ready. Re-run with --apply --confirm=${confirmationPhrase}.`;
  } else {
    if (confirmation !== confirmationPhrase) {
      throw new Error(`Refusing to update production credentials without --confirm=${confirmationPhrase}.`);
    }
    for (const [key, value] of Object.entries(validCandidate.values)) {
      await putRemoteEnv(renderCredentials, key, value);
    }
    const deploy = await renderRequest(
      renderCredentials,
      `/services/${encodeURIComponent(serviceId)}/deploys`,
      {
        method: "POST",
        body: JSON.stringify({ deployMode: "deploy_only" }),
      }
    );
    report.ready = true;
    report.updatedKeys = Object.keys(validCandidate.values);
    report.deployId = deploy?.id || deploy?.deploy?.id || "";
    report.deployStatus = deploy?.status || deploy?.deploy?.status || "requested";
    report.nextAction = "Wait for the deployment, then run npm run report:admin-stats and confirm that cost warnings are empty.";
  }

  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exitCode = 1;
});
