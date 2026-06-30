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
]) {
  readText(file);
}

expectIncludes("server/index.js", 'app.get("/api/health"');
expectIncludes("server/index.js", "ALLOWED_ORIGINS");
expectIncludes("server/index.js", "DATA_DIR");
expectIncludes("prisma/schema.prisma", "model RuntimeStore");
expectIncludes("Procfile", "npm run server:prod");
expectIncludes("Dockerfile", 'CMD ["npm", "run", "server:prod"]');
expectIncludes("render.yaml", "healthCheckPath: /api/health");
expectIncludes("render.yaml", "mountPath: /data");
expectIncludes("render.yaml", "api.myaipa.ca");
expectIncludes("config/backend.env.example", "ALLOWED_ORIGINS=");
expectIncludes("config/backend.env.example", "DATABASE_URL=");
expectIncludes("config/backend.env.example", "ADMIN_PASSWORD=");

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
