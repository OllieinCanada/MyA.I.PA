const { loadProjectEnv } = require("./_helpers");

const env = loadProjectEnv();
const baseUrl = String(env.MAKE_API_BASE_URL || "https://us2.make.com/api/v2").replace(/\/+$/, "");
const token = String(env.MAKE_API_TOKEN || env.MAKE_TOKEN || env.MAKE_API_KEY || "").trim();
const scenarioId = String(env.MAKE_SCENARIO_ID || "3530157").trim();
const requestedState = String(
  process.argv.find((argument) => argument.startsWith("--state="))?.split("=")[1] || ""
).trim().toLowerCase();
const shouldApply = process.argv.includes("--apply");
const expectedConfirmation = `SET_MAKE_SCENARIO_${requestedState.toUpperCase()}`;
const confirmation = String(
  process.argv.find((argument) => argument.startsWith("--confirm="))?.split("=")[1] || ""
).trim();

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Token ${token}`,
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
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
    throw new Error(
      `Make request failed (${response.status}): ${String(body.message || body.error || "request failed").slice(0, 300)}`
    );
  }
  return body;
}

function readScenario(body) {
  return body?.scenario || body?.response?.scenario || body || {};
}

async function readState() {
  const scenario = readScenario(await request(`/scenarios/${encodeURIComponent(scenarioId)}`));
  return {
    id: String(scenario.id || scenarioId),
    name: String(scenario.name || ""),
    active: Boolean(scenario.isActive),
  };
}

async function main() {
  if (!token) throw new Error("MAKE_API_TOKEN is not configured.");
  if (!scenarioId) throw new Error("MAKE_SCENARIO_ID is not configured.");
  if (!["active", "inactive"].includes(requestedState)) {
    throw new Error("Use --state=active or --state=inactive.");
  }

  const before = await readState();
  const desiredActive = requestedState === "active";
  console.log(JSON.stringify({ mode: shouldApply ? "apply" : "dry-run", desiredActive, before }, null, 2));

  if (before.active === desiredActive) {
    console.log("No change is required.");
    return;
  }

  if (!shouldApply) {
    console.log(`Dry run only. Re-run with --apply --confirm=${expectedConfirmation} to change the scenario.`);
    return;
  }
  if (confirmation !== expectedConfirmation) {
    throw new Error(`Refusing to change the scenario without --confirm=${expectedConfirmation}.`);
  }

  const action = desiredActive ? "start" : "stop";
  await request(`/scenarios/${encodeURIComponent(scenarioId)}/${action}`, { method: "POST" });
  const after = await readState();
  if (after.active !== desiredActive) {
    throw new Error(`Make scenario ${scenarioId} did not reach the requested ${requestedState} state.`);
  }
  console.log(JSON.stringify({ changed: true, after }, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
