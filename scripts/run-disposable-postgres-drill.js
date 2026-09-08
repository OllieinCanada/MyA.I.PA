const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { loadProjectEnv, rootPath } = require("./_helpers");

const confirmation = process.argv.find((value) => value.startsWith("--confirm="))?.slice(10) || "";
const expectedConfirmation = "CREATE_DELETE_FREE_DATABASE";
const env = loadProjectEnv();
const serviceId = String(env.RENDER_SERVICE_ID || "srv-d92503a8qa3s73crdpog").trim();
const reportPath = rootPath("diagnostics", "shipping-readiness", "postgres-verification-gate.json");
const cliConfigPath = path.join(process.env.USERPROFILE || process.env.HOME || "", ".render", "cli.yaml");
const namePrefix = "myaipa-disposable-verification-";

function stripYamlValue(value) {
  const text = String(value || "").trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) return text.slice(1, -1);
  return text;
}

function readRenderCredentials() {
  const source = fs.readFileSync(cliConfigPath, "utf8");
  const apiBlock = source.match(/(?:^|\r?\n)api:\s*\r?\n([\s\S]*?)(?=\r?\n\S|\s*$)/);
  const key = stripYamlValue(apiBlock?.[1]?.match(/^\s+key:\s*(.+)$/m)?.[1]);
  const host = stripYamlValue(apiBlock?.[1]?.match(/^\s+host:\s*(.+)$/m)?.[1]).replace(/\/+$/, "");
  if (!key || !host) throw new Error("A valid signed-in Render CLI profile is required.");
  return { key, host };
}

async function request(credentials, endpoint, options = {}) {
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
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const error = new Error(`Render ${options.method || "GET"} ${endpoint} failed with HTTP ${response.status}: ${body.message || body.error || "request failed"}`);
    error.status = response.status;
    throw error;
  }
  return body;
}

function unwrapPostgres(value) {
  return value?.postgres || value;
}

function runChecked(command, args, databaseUrl) {
  const executable = process.platform === "win32" && command === "npx" ? "npx.cmd" : command;
  const result = spawnSync(executable, args, {
    cwd: rootPath(),
    env: { ...process.env, DATABASE_URL: databaseUrl, RUN_DATABASE_INTEGRATION: "1" },
    encoding: "utf8",
    shell: false,
  });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`);
  return String(result.stdout || "").trim();
}

async function waitForAvailable(credentials, postgresId) {
  for (let attempt = 1; attempt <= 36; attempt += 1) {
    const database = unwrapPostgres(await request(credentials, `/postgres/${encodeURIComponent(postgresId)}`));
    const status = String(database?.status || database?.state || "").toLowerCase();
    console.log(`Disposable database readiness ${attempt}/36: ${status || "pending"}`);
    if (["available", "running", "ready", "active"].includes(status)) return database;
    if (["failed", "suspended", "unavailable"].includes(status)) throw new Error(`Disposable database entered ${status} state.`);
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  throw new Error("Timed out waiting for the disposable database.");
}

async function main() {
  if (confirmation !== expectedConfirmation) throw new Error(`Use --confirm=${expectedConfirmation} to create and delete a free disposable database.`);
  const credentials = readRenderCredentials();
  const servicePayload = await request(credentials, `/services/${encodeURIComponent(serviceId)}`);
  const service = servicePayload?.service || servicePayload;
  const ownerId = String(service?.ownerId || service?.owner?.id || "").trim();
  if (!ownerId) throw new Error("Could not determine the Render workspace for the configured API service.");

  const existingPayload = await request(credentials, `/postgres?ownerId=${encodeURIComponent(ownerId)}&limit=100`);
  const existing = (Array.isArray(existingPayload) ? existingPayload : existingPayload?.data || existingPayload?.postgres || [])
    .map(unwrapPostgres);
  const existingFree = existing.filter((database) => String(database?.plan || database?.planId || "").toLowerCase() === "free");
  if (existingFree.length) throw new Error("The workspace already has a free Render Postgres instance. No resource was changed.");

  const suffix = Date.now().toString(36);
  const expectedName = `${namePrefix}${suffix}`;
  let created = null;
  let deleted = false;
  let passed = false;
  try {
    const createdPayload = await request(credentials, "/postgres", {
      method: "POST",
      body: JSON.stringify({
        name: expectedName,
        databaseName: `myaipa_verification_${suffix.replace(/[^a-z0-9]/g, "")}`,
        databaseUser: `myaipa_verifier_${suffix.replace(/[^a-z0-9]/g, "")}`,
        ownerId,
        plan: "free",
        region: "ohio",
        version: "16",
        ipAllowList: [{ cidrBlock: "0.0.0.0/0", description: "Temporary automated verification drill" }],
      }),
    });
    created = unwrapPostgres(createdPayload);
    const postgresId = String(created?.id || "").trim();
    if (!postgresId || created?.name !== expectedName) throw new Error("Render returned an unexpected database identity; cleanup was not attempted automatically.");
    if (String(created?.plan || created?.planId || "").toLowerCase() !== "free") throw new Error("Render did not create the explicitly requested free plan.");

    await waitForAvailable(credentials, postgresId);
    const connection = await request(credentials, `/postgres/${encodeURIComponent(postgresId)}/connection-info`);
    const databaseUrl = String(connection?.externalConnectionString || "").trim();
    if (!databaseUrl.startsWith("postgres")) throw new Error("The disposable database did not expose a temporary external test connection.");

    runChecked("npx", ["prisma", "db", "push", "--skip-generate"], databaseUrl);
    runChecked(process.execPath, ["--test", "tests/database-integration.test.js"], databaseUrl);
    passed = true;
  } finally {
    if (created?.id && created?.name === expectedName && String(created?.plan || created?.planId || "").toLowerCase() === "free") {
      await request(credentials, `/postgres/${encodeURIComponent(created.id)}`, { method: "DELETE" });
      deleted = true;
    }
    const report = {
      schemaVersion: 1,
      checkedAt: new Date().toISOString(),
      mode: "disposable-free-render-postgres",
      databaseName: expectedName,
      productionDatabaseTouched: false,
      freePlanRequired: true,
      schemaApplied: passed,
      databaseIntegrationPassed: passed,
      verificationConcurrencyPassed: passed,
      disposableDatabaseDeleted: deleted,
      ready: passed && deleted,
    };
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(report, null, 2));
  }
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exitCode = 1;
});
