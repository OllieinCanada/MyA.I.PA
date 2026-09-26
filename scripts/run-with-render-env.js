const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const DEFAULT_SERVICE_ID = "srv-d92503a8qa3s73crdpog";

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

function isUsableSecret(value) {
  const text = String(value || "").trim();
  return Boolean(
    text
    && !/^\*+$/.test(text)
    && !/^\[?redacted\]?$/i.test(text)
    && !/^(?:change-me|replace-me|todo|example)$/i.test(text)
  );
}

function readRenderCredentials({
  renderConfigPath = path.join(process.env.USERPROFILE || process.env.HOME || "", ".render", "cli.yaml"),
} = {}) {
  const source = fs.readFileSync(renderConfigPath, "utf8");
  const apiBlock = source.match(/(?:^|\r?\n)api:\s*\r?\n([\s\S]*?)(?=\r?\n\S|\s*$)/);
  if (!apiBlock) throw new Error("The signed-in Render CLI profile has no API section.");
  const key = stripYamlValue(apiBlock[1].match(/^\s+key:\s*(.+)$/m)?.[1]);
  const host = stripYamlValue(apiBlock[1].match(/^\s+host:\s*(.+)$/m)?.[1]).replace(/\/+$/, "");
  if (!key || !host) throw new Error("The signed-in Render CLI profile is incomplete.");
  return { key, host };
}

async function renderRequest(credentials, endpoint, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl(`${credentials.host}${endpoint}`, {
    headers: {
      authorization: `Bearer ${credentials.key}`,
      accept: "application/json",
    },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Render request failed with HTTP ${response.status}.`);
  return response.json();
}

function envValue(payload) {
  return String(payload?.value ?? payload?.envVar?.value ?? "").trim();
}

function parseArgs(argv) {
  const separatorIndex = argv.indexOf("--");
  const configArgs = separatorIndex === -1 ? argv : argv.slice(0, separatorIndex);
  const commandArgs = separatorIndex === -1 ? [] : argv.slice(separatorIndex + 1);
  const options = {
    serviceId: process.env.RENDER_SERVICE_ID || DEFAULT_SERVICE_ID,
    keys: [],
    optionalKeys: [],
    dryRun: false,
  };

  for (let index = 0; index < configArgs.length; index += 1) {
    const arg = configArgs[index];
    if (arg === "--keys") {
      options.keys.push(...String(configArgs[++index] || "").split(","));
    } else if (arg.startsWith("--keys=")) {
      options.keys.push(...arg.slice("--keys=".length).split(","));
    } else if (arg === "--optional-keys") {
      options.optionalKeys.push(...String(configArgs[++index] || "").split(","));
    } else if (arg.startsWith("--optional-keys=")) {
      options.optionalKeys.push(...arg.slice("--optional-keys=".length).split(","));
    } else if (arg === "--service-id") {
      options.serviceId = configArgs[++index] || "";
    } else if (arg.startsWith("--service-id=")) {
      options.serviceId = arg.slice("--service-id=".length);
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  options.keys = [...new Set(options.keys.map((key) => key.trim()).filter(Boolean))];
  options.optionalKeys = [...new Set(options.optionalKeys.map((key) => key.trim()).filter(Boolean))];
  if (!options.serviceId) throw new Error("Render service ID is required.");
  return { options, commandArgs };
}

function usage() {
  return [
    "Usage: node scripts/run-with-render-env.js --keys KEY,KEY [--optional-keys KEY] -- <command> [args...]",
    "",
    "Fetches selected Render environment variables into a child process only.",
    "Secret values are never printed or written to disk.",
  ].join("\n");
}

async function fetchRenderEnv({ serviceId, keys, optionalKeys = [], credentials, fetchImpl = fetch }) {
  const env = {};
  const required = new Set(keys);
  for (const key of [...new Set([...keys, ...optionalKeys])]) {
    const payload = await renderRequest(
      credentials,
      `/services/${encodeURIComponent(serviceId)}/env-vars/${encodeURIComponent(key)}`,
      { fetchImpl }
    );
    const value = envValue(payload);
    if (!isUsableSecret(value)) {
      if (required.has(key)) throw new Error(`Required Render env var is missing or unusable: ${key}`);
      continue;
    }
    env[key] = value;
  }
  return env;
}

async function main(argv = process.argv.slice(2)) {
  const { options, commandArgs } = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return 0;
  }
  if (!commandArgs.length && !options.dryRun) throw new Error("A command after -- is required.");
  const credentials = readRenderCredentials();
  const env = await fetchRenderEnv({
    serviceId: options.serviceId,
    keys: options.keys,
    optionalKeys: options.optionalKeys,
    credentials,
  });
  console.log(JSON.stringify({
    serviceId: options.serviceId,
    injectedKeys: Object.keys(env).sort(),
    secretValuesPrinted: false,
    mode: options.dryRun ? "dry-run" : "execute",
  }, null, 2));
  if (options.dryRun) return 0;

  const [command, ...args] = commandArgs;
  const result = spawnSync(command, args, {
    cwd: path.resolve(__dirname, ".."),
    stdio: "inherit",
    shell: false,
    env: { ...process.env, ...env },
  });
  if (result.error) throw result.error;
  return result.status || 0;
}

if (require.main === module) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error(error.message || String(error));
    process.exitCode = 1;
  });
}

module.exports = {
  envValue,
  fetchRenderEnv,
  isUsableSecret,
  parseArgs,
  readRenderCredentials,
  stripYamlValue,
};
