const crypto = require("crypto");
const { loadProjectEnv } = require("./_helpers");

const env = loadProjectEnv();
const baseUrl = String(env.MAKE_API_BASE_URL || "https://us2.make.com/api/v2").replace(/\/+$/, "");
const token = String(env.MAKE_AUDIT_API_TOKEN || env.MAKE_API_TOKEN || env.MAKE_TOKEN || env.MAKE_API_KEY || "").trim();
const scenarioId = String(process.argv[2] || "4482406").trim();

async function getJson(path) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      Authorization: `Token ${token}`,
      Accept: "application/json",
    },
  });
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = {};
  }
  if (!response.ok) {
    throw new Error(`Make request failed (${response.status}): ${String(body.message || body.error || "request failed").slice(0, 300)}`);
  }
  return body;
}

const SAFE_PATH_HOSTS = new Set([
  "api.myaipa.ca",
  "api.twilio.com",
  "api.vapi.ai",
  "timeapi.io",
]);

function fingerprint(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 12);
}

function isMakeWebhookHost(hostname) {
  return /^hook(?:\.[a-z0-9-]+)*\.make\.com$/i.test(String(hostname || ""));
}

function safeUrl(value) {
  try {
    const url = new URL(String(value || ""));
    const origin = `${url.protocol}//${url.host}`;
    if (isMakeWebhookHost(url.hostname)) {
      return `${origin}/[redacted-webhook-path]#${fingerprint(url.pathname)}`;
    }
    if (SAFE_PATH_HOSTS.has(url.hostname.toLowerCase())) {
      return `${origin}${url.pathname}`;
    }
    if (!url.pathname || url.pathname === "/") return origin;
    return `${origin}/[path:${fingerprint(url.pathname)}]`;
  } catch {
    return "(configured URL)";
  }
}

function redactEmbeddedUrls(value) {
  return String(value || "").replace(/https?:\/\/[^\s\"'<>]+/gi, (match) => safeUrl(match));
}

function safeString(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^https?:\/\//i.test(text)) {
    return safeUrl(text);
  }
  const redacted = redactEmbeddedUrls(text);
  return redacted.length > 800 ? `${redacted.slice(0, 800)}…` : redacted;
}

function safeObject(value, parentKey = "") {
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => safeObject(item, parentKey));
  if (!value || typeof value !== "object") return safeString(value);
  const secretLabel = [value.name, value.key, value.label, parentKey]
    .map((item) => String(item || ""))
    .join(".");
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !/metadata|sample|designer/i.test(key))
      .map(([key, item]) => [
        key,
        /(?:api.?key|token|secret|authorization|password|credential)/i.test(`${secretLabel}.${key}`)
          ? "[redacted]"
          : safeObject(item, `${parentKey}.${key}`),
      ])
  );
}

function flattenModules(flow, route = "root", target = []) {
  for (const module of Array.isArray(flow) ? flow : []) {
    target.push({
      id: module.id,
      module: module.module || "",
      version: module.version || "",
      route,
      mapper: safeObject(module.mapper || {}),
      parameters: safeObject(module.parameters || {}),
      filter: safeObject(module.filter || {}),
    });
    for (const [index, branch] of (module.routes || []).entries()) {
      flattenModules(branch.flow || branch, `${route}/${module.id}:route-${index + 1}`, target);
    }
  }
  return target;
}

async function main() {
  if (!token) throw new Error("MAKE_AUDIT_API_TOKEN or MAKE_API_TOKEN is not configured.");
  if (!scenarioId) throw new Error("A Make scenario ID is required.");

  const [scenarioResponse, blueprintResponse] = await Promise.all([
    getJson(`/scenarios/${encodeURIComponent(scenarioId)}`),
    getJson(`/scenarios/${encodeURIComponent(scenarioId)}/blueprint`),
  ]);
  const scenario = scenarioResponse.scenario || scenarioResponse;
  const blueprint = blueprintResponse?.response?.blueprint || blueprintResponse?.blueprint || blueprintResponse;
  const modules = flattenModules(blueprint.flow);

  console.log(JSON.stringify({
    id: String(scenario.id || scenarioId),
    name: String(scenario.name || ""),
    active: Boolean(scenario.isActive),
    moduleCount: modules.length,
    modules,
  }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}

module.exports = {
  flattenModules,
  isMakeWebhookHost,
  safeObject,
  safeString,
  safeUrl,
};
