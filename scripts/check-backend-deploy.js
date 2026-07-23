const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { rootPath, readJson } = require("./_helpers");

const failures = [];

function fail(message) {
  failures.push(message);
}

function readText(relativePath) {
  const filePath = rootPath(relativePath);
  if (!fs.existsSync(filePath)) {
    fail(`${relativePath} is missing`);
    return "";
  }
  return fs.readFileSync(filePath, "utf8");
}

function expectIncludes(relativePath, expected) {
  const text = readText(relativePath);
  if (text && !text.includes(expected)) {
    fail(`${relativePath} should include ${expected}`);
  }
}

function runNodeScript(relativePath) {
  const result = spawnSync(process.execPath, [rootPath(relativePath)], {
    cwd: rootPath(),
    encoding: "utf8",
    stdio: "pipe",
  });

  if (result.status !== 0) {
    fail(`${relativePath} failed:\n${result.stderr || result.stdout}`.trim());
  }
}

const packageJson = readJson(rootPath("package.json"));
for (const script of ["server:prod", "backend:prepare", "render:validate", "data:migrate-json"]) {
  if (!packageJson.scripts || !packageJson.scripts[script]) {
    fail(`package.json is missing script ${script}`);
  }
}

for (const file of [
  "render.yaml",
  "Procfile",
  "Dockerfile",
  ".dockerignore",
  "config/backend.env.example",
  "scripts/migrate-json-stores-to-db.js",
  "scripts/validate-render-blueprint.js",
  "server/safeWebsiteFetch.js",
  "server/twilioSms.js",
  "server/vapiSms.js",
  "server/leadHandoffs.js",
  "server/revenueRescue.js",
  "server/jobberIntegration.js",
  "server/tradePlaybooks.js",
  "config/playbooks/electrician-v1.json",
]) {
  readText(file);
}

expectIncludes("server/index.js", 'app.get("/api/health"');
expectIncludes("server/index.js", "ALLOWED_ORIGINS");
expectIncludes("server/index.js", "DATA_DIR");
expectIncludes("server/index.js", 'req.headers["x-vapi-secret"]');
expectIncludes("server/index.js", "requireIntegrationKey");
expectIncludes("server/index.js", "JSON_BODY_LIMIT");
expectIncludes("server/index.js", '"/api/admin/support-reports/:id/github-issue"');
expectIncludes("server/index.js", '"/api/admin/support-reports/:id/codex-task"');
expectIncludes("prisma/schema.prisma", "model RuntimeStore");
expectIncludes("prisma/schema.prisma", "model SupportReport");
expectIncludes("prisma/schema.prisma", "githubIssueUrl");
expectIncludes("prisma/schema.prisma", "codexTaskPrompt");
expectIncludes("Procfile", "npm run server:prod");
expectIncludes("Dockerfile", 'CMD ["npm", "run", "server:prod"]');
expectIncludes("render.yaml", "healthCheckPath: /api/health");
expectIncludes("render.yaml", "preDeployCommand: npm run db:push");
expectIncludes("render.yaml", "mountPath: /data");
expectIncludes("render.yaml", "api.myaipa.ca");
expectIncludes("render.yaml", "GITHUB_SUPPORT_TOKEN");
expectIncludes("render.yaml", "GITHUB_SUPPORT_REPO");
expectIncludes("render.yaml", "TELEGRAM_BOT_TOKEN");
expectIncludes("render.yaml", "TELEGRAM_CHAT_ID");
expectIncludes("config/backend.env.example", "ALLOWED_ORIGINS=");
expectIncludes("config/backend.env.example", "DATABASE_URL=");
expectIncludes("config/backend.env.example", "ADMIN_PASSWORD=");
expectIncludes("config/backend.env.example", "INTEGRATION_API_KEY=");
expectIncludes("config/backend.env.example", "JSON_BODY_LIMIT=");
expectIncludes("config/backend.env.example", "VAPI_SMS_ASSISTANT_ID=");
expectIncludes("config/backend.env.example", "VAPI_SMS_PHONE_NUMBER_ID=");
expectIncludes("config/backend.env.example", "LEAD_ACK_BASE_URL=");
expectIncludes("config/backend.env.example", "GITHUB_SUPPORT_TOKEN=");
expectIncludes("config/backend.env.example", "GITHUB_SUPPORT_REPO=");
expectIncludes("config/backend.env.example", "TELEGRAM_BOT_TOKEN=");
expectIncludes("config/backend.env.example", "TELEGRAM_CHAT_ID=");
expectIncludes("prisma/schema.prisma", "model LeadHandoff");
expectIncludes("prisma/schema.prisma", "model LeadOutcomeEvent");
expectIncludes("prisma/schema.prisma", "model FieldServiceConnection");
expectIncludes("prisma/schema.prisma", "model VapiToolExecution");
expectIncludes("config/backend.env.example", "VAPI_REQUIRE_BUSINESS_MAPPING=true");
expectIncludes("config/backend.env.example", "JOBBER_CLIENT_ID=");

if (fs.existsSync(rootPath("scripts/validate-render-blueprint.js"))) {
  runNodeScript("scripts/validate-render-blueprint.js");
}

if (failures.length) {
  console.error("Backend deployment preflight failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Backend deployment preflight passed");
