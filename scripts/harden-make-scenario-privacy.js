const crypto = require("crypto");

const { loadProjectEnv } = require("./_helpers");

const CONFIRMATION = "HARDEN_MAKE_SCENARIO_PRIVACY";

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function fingerprint(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex").slice(0, 16);
}

function scenarioBlueprint(payload) {
  const blueprint = payload?.response?.blueprint || payload?.blueprint || payload;
  if (!blueprint || !Array.isArray(blueprint.flow)) throw new Error("Make did not return a valid scenario blueprint.");
  return blueprint;
}

function withConfidentialHistory(blueprint) {
  const copy = JSON.parse(JSON.stringify(blueprint));
  if (!copy.metadata || typeof copy.metadata !== "object") copy.metadata = {};
  if (!copy.metadata.scenario || typeof copy.metadata.scenario !== "object") copy.metadata.scenario = {};
  copy.metadata.scenario.confidential = true;
  return copy;
}

function immutableFingerprint(blueprint) {
  const copy = JSON.parse(JSON.stringify(blueprint));
  if (copy.metadata?.scenario) delete copy.metadata.scenario.confidential;
  return fingerprint(copy);
}

function parseScenarioIds(argv) {
  const value = argv.find((item) => item.startsWith("--scenarios="))?.slice("--scenarios=".length) || "";
  const ids = [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
  if (!ids.length || ids.some((id) => !/^\d+$/.test(id))) {
    throw new Error("Provide numeric Make scenario IDs with --scenarios=id,id.");
  }
  return ids;
}

async function main() {
  const env = loadProjectEnv();
  const token = String(env.MAKE_API_TOKEN || env.MAKE_TOKEN || env.MAKE_API_KEY || "").trim();
  if (!token) throw new Error("MAKE_API_TOKEN is not configured.");
  const baseUrl = String(env.MAKE_API_BASE_URL || "https://us2.make.com/api/v2").replace(/\/+$/, "");
  const argv = process.argv.slice(2);
  const ids = parseScenarioIds(argv);
  const apply = argv.includes("--apply");
  const confirmation = argv.find((item) => item.startsWith("--confirm="))?.slice("--confirm=".length) || "";
  if (apply && confirmation !== CONFIRMATION) throw new Error(`Apply mode requires --confirm=${CONFIRMATION}.`);

  const request = async (route, options = {}) => {
    const response = await fetch(`${baseUrl}${route}`, {
      ...options,
      headers: {
        Authorization: `Token ${token}`,
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
    });
    if (!response.ok) throw new Error(`Make request failed with HTTP ${response.status}.`);
    const text = await response.text();
    return text ? JSON.parse(text) : {};
  };

  const results = [];
  for (const id of ids) {
    const before = scenarioBlueprint(await request(`/scenarios/${encodeURIComponent(id)}/blueprint`));
    const beforeFingerprint = immutableFingerprint(before);
    const alreadyConfidential = before.metadata?.scenario?.confidential === true;
    if (!apply || alreadyConfidential) {
      results.push({ id, changed: false, alreadyConfidential, immutableFingerprint: beforeFingerprint });
      continue;
    }
    const candidate = withConfidentialHistory(before);
    await request(`/scenarios/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ blueprint: JSON.stringify(candidate) }),
    });
    const after = scenarioBlueprint(await request(`/scenarios/${encodeURIComponent(id)}/blueprint`));
    if (after.metadata?.scenario?.confidential !== true) throw new Error(`Scenario ${id} did not enable confidential history.`);
    if (immutableFingerprint(after) !== beforeFingerprint) {
      throw new Error(`Scenario ${id} changed outside the confidential-history setting.`);
    }
    results.push({ id, changed: true, alreadyConfidential: false, immutableFingerprint: beforeFingerprint });
  }

  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", results, secretValuesPrinted: false }, null, 2));
  if (!apply) console.log(`Dry run only. Re-run with --apply --confirm=${CONFIRMATION}.`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}

module.exports = {
  immutableFingerprint,
  parseScenarioIds,
  scenarioBlueprint,
  withConfidentialHistory,
};
