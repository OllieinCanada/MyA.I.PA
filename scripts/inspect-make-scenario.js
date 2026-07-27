const { loadProjectEnv } = require("./_helpers");

const env = loadProjectEnv();
const baseUrl = String(env.MAKE_API_BASE_URL || "https://us2.make.com/api/v2").replace(/\/+$/, "");
const token = String(env.MAKE_API_TOKEN || env.MAKE_TOKEN || env.MAKE_API_KEY || "").trim();
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

function safeString(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^https?:\/\//i.test(text)) {
    try {
      const url = new URL(text);
      return `${url.protocol}//${url.host}${url.pathname}`;
    } catch {
      return "(configured URL)";
    }
  }
  return text.length > 800 ? `${text.slice(0, 800)}…` : text;
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
  if (!token) throw new Error("MAKE_API_TOKEN is not configured.");
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

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
