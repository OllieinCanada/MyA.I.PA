const fs = require("fs");
const YAML = require("yaml");
const { rootPath } = require("./_helpers");

const renderPath = rootPath("render.yaml");
const blueprint = YAML.parse(fs.readFileSync(renderPath, "utf8"));
const failures = [];

function fail(message) {
  failures.push(message);
}

function hasEnv(service, key, predicate) {
  const item = (service.envVars || []).find((envVar) => envVar.key === key);
  if (!item) return false;
  return predicate ? predicate(item) : true;
}

function expectEqual(label, actual, expected) {
  if (actual !== expected) {
    fail(`${label} should be ${JSON.stringify(expected)} but was ${JSON.stringify(actual)}`);
  }
}

function expectEnvValue(service, key, expected) {
  if (!hasEnv(service, key, (item) => item.value === expected)) {
    fail(`${key} should be ${JSON.stringify(expected)}`);
  }
}

if (!blueprint || typeof blueprint !== "object") {
  fail("render.yaml must parse to an object");
}

const database = (blueprint.databases || []).find((item) => item.name === "myaipa-postgres");
if (!database) {
  fail("database myaipa-postgres is missing");
} else {
  expectEqual("databaseName", database.databaseName, "myaipa");
  expectEqual("database user", database.user, "myaipa");
  expectEqual("database plan", database.plan, "basic-256mb");
  expectEqual("database region", database.region, "ohio");
}

const service = (blueprint.services || []).find((item) => item.name === "myaipa-api");
if (!service) {
  fail("web service myaipa-api is missing");
} else {
  expectEqual("service type", service.type, "web");
  expectEqual("service runtime", service.runtime, "node");
  expectEqual("service plan", service.plan, "starter");
  expectEqual("service region", service.region, "ohio");
  expectEqual("service branch", service.branch, "main");
  expectEqual("buildCommand", service.buildCommand, "npm install --include=dev --legacy-peer-deps && npm run backend:prepare");
  expectEqual("preDeployCommand", service.preDeployCommand, "npm run db:push");
  expectEqual("startCommand", service.startCommand, "npm run server:prod");
  expectEqual("healthCheckPath", service.healthCheckPath, "/api/health");

  expectEqual("disk name", service.disk && service.disk.name, "myaipa-data");
  expectEqual("disk mountPath", service.disk && service.disk.mountPath, "/data");
  expectEqual("disk sizeGB", service.disk && service.disk.sizeGB, 1);

  if (!Array.isArray(service.domains) || !service.domains.includes("api.myaipa.ca")) {
    fail("service domains should include api.myaipa.ca");
  }

  if (!hasEnv(service, "DATA_DIR", (item) => item.value === "/data")) {
    fail("DATA_DIR=/data env var is missing");
  }
  if (!hasEnv(service, "PUBLIC_APP_URL", (item) => item.value === "https://api.myaipa.ca")) {
    fail("PUBLIC_APP_URL=https://api.myaipa.ca env var is missing");
  }
  if (!hasEnv(service, "ALLOWED_ORIGINS", (item) => String(item.value || "").includes("https://www.myaipa.ca"))) {
    fail("ALLOWED_ORIGINS should include https://www.myaipa.ca");
  }
  if (!hasEnv(service, "STRIPE_SUCCESS_URL", (item) => item.value === "https://www.myaipa.ca/#/signup?payment=success")) {
    fail("STRIPE_SUCCESS_URL should return successful checkout users to www.myaipa.ca");
  }
  if (!hasEnv(service, "STRIPE_CANCEL_URL", (item) => item.value === "https://www.myaipa.ca/#/signup?payment=cancelled")) {
    fail("STRIPE_CANCEL_URL should return cancelled checkout users to www.myaipa.ca");
  }
  expectEnvValue(service, "STRIPE_TRIAL_DAYS", 14);
  expectEnvValue(service, "STRIPE_ALLOW_PROMOTION_CODES", false);
  expectEnvValue(service, "TRIAL_HALFWAY_REMINDER_DAYS", 7);
  expectEnvValue(service, "TRIAL_REMINDER_CHECK_INTERVAL_MS", 3600000);
  expectEnvValue(service, "TRIAL_REMINDER_DISABLE", true);
  expectEnvValue(service, "SIGNUP_REQUIRE_MANUAL_APPROVAL", false);
  expectEnvValue(service, "SIGNUP_REQUIRE_VERIFICATION", false);
  expectEnvValue(service, "SIGNUP_IP_WINDOW_MS", 900000);
  expectEnvValue(service, "SIGNUP_IP_MAX_REQUESTS", 5);
  expectEnvValue(service, "SIGNUP_IDENTITY_WINDOW_MS", 3600000);
  expectEnvValue(service, "SIGNUP_IDENTITY_MAX_REQUESTS", 2);
  expectEnvValue(service, "SIGNUP_DUPLICATE_WINDOW_MS", 600000);
  expectEnvValue(service, "SIGNUP_MIN_ELAPSED_MS", 2500);
  expectEnvValue(service, "SIGNUP_REVIEW_DUPLICATES", true);
  expectEnvValue(service, "CUSTOMER_DASHBOARD_IP_WINDOW_MS", 900000);
  expectEnvValue(service, "CUSTOMER_DASHBOARD_IP_MAX_REQUESTS", 30);
  expectEnvValue(service, "CUSTOMER_DASHBOARD_LOOKUP_WINDOW_MS", 3600000);
  expectEnvValue(service, "CUSTOMER_DASHBOARD_LOOKUP_MAX_REQUESTS", 8);
  expectEnvValue(service, "SIGNUP_VERIFICATION_TTL_MS", 86400000);
  expectEnvValue(service, "SIGNUP_VERIFICATION_BASE_URL", "https://api.myaipa.ca");
  expectEnvValue(service, "EMAIL_VERIFICATION_DEV_MODE", false);
  expectEnvValue(service, "OPENAI_ASSISTANT_MODEL", "gpt-4o-mini");
  expectEnvValue(service, "OPENAI_TRANSCRIBE_MODEL", "whisper-1");
  expectEnvValue(service, "OPENAI_TRANSCRIBE_LANGUAGE", "en");
  if (!hasEnv(service, "DATABASE_URL", (item) => item.fromDatabase && item.fromDatabase.name === "myaipa-postgres")) {
    fail("DATABASE_URL should come from myaipa-postgres");
  }
  if (!hasEnv(service, "ADMIN_PASSWORD", (item) => item.sync === false)) {
    fail("ADMIN_PASSWORD should be a non-synced Render secret");
  }
  if (!hasEnv(service, "ADMIN_SESSION_SECRET", (item) => item.generateValue === true)) {
    fail("ADMIN_SESSION_SECRET should be generated by Render");
  }
  for (const key of [
    "MAKE_SIGNUP_WEBHOOK_URL",
    "MAKE_SIGNUP_WEBHOOK_API_KEY",
    "OPENAI_API_KEY",
    "VAPI_API_KEY",
    "STRIPE_SECRET_KEY",
    "STRIPE_PRICE_ID",
    "STRIPE_WEBHOOK_SECRET",
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN",
    "TWILIO_FROM_NUMBER",
    "OWNER_SMS_FROM",
    "TURNSTILE_SECRET_KEY",
  ]) {
    if (!hasEnv(service, key, (item) => item.sync === false)) {
      fail(`${key} should be a non-synced Render secret`);
    }
  }
}

if (failures.length) {
  console.error("render.yaml validation failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("render.yaml validation passed");
