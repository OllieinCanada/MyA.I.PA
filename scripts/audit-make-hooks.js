const crypto = require("crypto");
const { loadProjectEnv } = require("./_helpers");

const env = loadProjectEnv();
const baseUrl = String(env.MAKE_API_BASE_URL || "https://us2.make.com/api/v2").replace(/\/+$/, "");
const token = String(env.MAKE_API_TOKEN || env.MAKE_TOKEN || env.MAKE_API_KEY || "").trim();
const seedScenarioId = String(env.MAKE_SCENARIO_ID || "3530157").trim();
const inactiveCandidates = new Set([
  "12492021724", "12492092994", "12492942573", "12492947547", "12494020467", "12494023117", "12494024844",
  "12494025367", "12494026945", "12494027114", "12494029111", "12494212544", "12494213497", "12494217616",
  "12494217750", "12494219002", "12494219856", "12494443364", "12494683413", "12494683936", "12494683961",
  "12494687285", "12494753155", "12494810811", "12494814884", "12494865572", "12494915023", "12494936834",
  "12494956464", "12495004574", "12495033725", "12495040274", "12495054889", "12495069259", "12495232223",
  "12495280178", "12495290194", "12495592388", "12497008891", "12497021521", "12497035723", "12498060615",
  "12498065190", "13656755015", "17754168362",
]);

function fingerprint(value) {
  return crypto.createHash("sha256").update(String(value || "").trim()).digest("hex").slice(0, 12);
}

function safeUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return { host: url.hostname.toLowerCase(), fingerprint: fingerprint(url.toString()) };
  } catch {
    return null;
  }
}

async function getJson(path) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { Authorization: `Token ${token}`, Accept: "application/json" },
  });
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = {}; }
  if (!response.ok) throw new Error(`Make ${path} failed with HTTP ${response.status}: ${body.message || body.error || "request failed"}`);
  return body;
}

function listFrom(value, keys) {
  if (Array.isArray(value)) return value;
  for (const key of keys) if (Array.isArray(value?.[key])) return value[key];
  return [];
}

function moduleNames(value) {
  const names = new Set();
  const seen = new Set();
  function visit(item) {
    if (!item || typeof item !== "object" || seen.has(item)) return;
    seen.add(item);
    if (typeof item.module === "string") names.add(item.module);
    if (typeof item.name === "string" && /twilio|vapi|webhook|phone|assistant/i.test(item.name)) names.add(item.name);
    Object.values(item).forEach(visit);
  }
  visit(value);
  return [...names].sort();
}

function matchingPaths(value, predicate) {
  const matches = [];
  const seen = new Set();
  function visit(item, path) {
    if (typeof item === "string") {
      if (predicate(item)) matches.push(path);
      return;
    }
    if (!item || typeof item !== "object" || seen.has(item)) return;
    seen.add(item);
    if (Array.isArray(item)) item.forEach((entry, index) => visit(entry, `${path}[${index}]`));
    else Object.entries(item).forEach(([key, entry]) => visit(entry, `${path}.${key}`));
  }
  visit(value, "$.");
  return matches.slice(0, 100);
}

async function main() {
  if (!token) throw new Error("MAKE_API_TOKEN is not configured.");
  const seed = await getJson(`/scenarios/${encodeURIComponent(seedScenarioId)}`);
  const scenario = seed?.scenario || seed;
  const teamId = String(scenario?.teamId || scenario?.team?.id || "").trim();
  if (!teamId) throw new Error("The configured Make scenario did not expose a team ID.");
  const [hookPayload, scenarioPayload] = await Promise.all([
    getJson(`/hooks?teamId=${encodeURIComponent(teamId)}&pg%5Blimit%5D=1000`),
    getJson(`/scenarios?teamId=${encodeURIComponent(teamId)}&pg%5Blimit%5D=1000`),
  ]);
  const scenarios = listFrom(scenarioPayload, ["scenarios", "data"]);
  const scenarioNames = new Map(scenarios.map((item) => [String(item?.id || ""), String(item?.name || "")]));
  const scenarioAudit = await Promise.all(scenarios.map(async (item) => {
    const scenarioId = String(item?.id || "");
    const [logPayload, blueprintPayload] = await Promise.all([
      getJson(`/scenarios/${encodeURIComponent(scenarioId)}/logs`),
      getJson(`/scenarios/${encodeURIComponent(scenarioId)}/blueprint`),
    ]);
    const logs = listFrom(logPayload, ["scenarioLogs", "logs", "data"]);
    const latest = logs.map((log) => String(log?.timestamp || log?.createdAt || "")).filter(Boolean).sort().at(-1) || null;
    const blueprint = blueprintPayload?.response?.blueprint || blueprintPayload?.blueprint || blueprintPayload;
    const blueprintText = JSON.stringify(blueprint);
    const referencedCandidateNumbers = [...inactiveCandidates].filter((number) => blueprintText.includes(number));
    return {
      id: scenarioId,
      name: String(item?.name || ""),
      isActive: Boolean(item?.isActive),
      logCountReturned: logs.length,
      latestExecutionAt: latest,
      modules: moduleNames(blueprint),
      referencedCandidateNumbers,
      candidateReferencePaths: Object.fromEntries(referencedCandidateNumbers.map((number) => [number, matchingPaths(blueprint, (text) => text.includes(number))])),
      phoneProvisioningReferencePaths: matchingPaths(blueprint, (text) => /IncomingPhoneNumbers|AvailablePhoneNumbers|phone-number\/import|api\.twilio\.com\/.*PhoneNumbers/i.test(text)),
      provisionsOrImportsPhoneNumbers: /IncomingPhoneNumbers|AvailablePhoneNumbers|phone-number\/import|api\.twilio\.com\/.*PhoneNumbers/i.test(blueprintText),
    };
  }));
  const hooks = await Promise.all(listFrom(hookPayload, ["hooks", "data"]).map(async (hook) => {
    const urlFields = Object.entries(hook || {})
      .map(([key, value]) => ({ key, safe: safeUrl(value) }))
      .filter((item) => item.safe);
    const scenarioId = String(hook?.scenarioId || hook?.scenario?.id || "");
    let logs = [];
    let logReadError = "";
    try {
      logs = listFrom(await getJson(`/hooks/${encodeURIComponent(String(hook?.id || ""))}/logs`), ["hookLogs", "logs", "data"]);
    } catch (error) {
      logReadError = String(error?.message || error);
    }
    const latest = logs.map((log) => String(log?.loggedAt || log?.timestamp || "")).filter(Boolean).sort().at(-1) || null;
    return {
      id: String(hook?.id || ""),
      name: String(hook?.name || ""),
      scenarioId,
      scenarioName: scenarioNames.get(scenarioId) || "",
      active: hook?.enabled ?? hook?.active ?? hook?.isActive ?? null,
      attached: hook?.attached ?? Boolean(scenarioId),
      logCountReturned: logs.length,
      latestLogAt: latest,
      logReadError,
      urls: urlFields.map((item) => ({ field: item.key, ...item.safe })),
    };
  }));
  let dataStores = [];
  let dataStoreReadError = "";
  try {
    const storePayload = await getJson(`/data-stores?teamId=${encodeURIComponent(teamId)}&pg%5Blimit%5D=1000`);
    const stores = listFrom(storePayload, ["dataStores", "data"]);
    dataStores = await Promise.all(stores.map(async (store) => {
      const storeId = String(store?.id || "");
      const recordPayload = await getJson(`/data-stores/${encodeURIComponent(storeId)}/data?pg%5Blimit%5D=1000`);
      const records = listFrom(recordPayload, ["records", "data"]);
      const candidateMatches = [...inactiveCandidates].filter((number) => records.some((record) => JSON.stringify(record).replace(/\D/g, "").includes(number)));
      return {
        id: storeId,
        name: String(store?.name || ""),
        declaredRecordCount: Number(store?.records || 0),
        recordsReturned: records.length,
        candidateMatches,
      };
    }));
  } catch (error) {
    dataStoreReadError = String(error?.message || error);
  }
  console.log(JSON.stringify({ teamId, scenarioCount: scenarios.length, hookCount: hooks.length, scenarios: scenarioAudit, hooks, dataStores, dataStoreReadError }, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
