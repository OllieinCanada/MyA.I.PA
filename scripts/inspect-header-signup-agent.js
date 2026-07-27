const crypto = require("crypto");
const { loadProjectEnv, redact } = require("./_helpers");

const env = loadProjectEnv();
const apiBaseUrl = String(env.VAPI_API_BASE_URL || "https://api.vapi.ai").replace(/\/+$/, "");
const apiKey = String(env.VAPI_API_KEY || env.VAPI_KEY || env.VAPI_TOKEN || "").trim();
const makeApiBaseUrl = String(env.MAKE_API_BASE_URL || "https://us2.make.com/api/v2").replace(/\/+$/, "");
const makeApiToken = String(env.MAKE_API_TOKEN || env.MAKE_TOKEN || env.MAKE_API_KEY || "").trim();
const makeSeedScenarioId = String(env.MAKE_SCENARIO_ID || "3530157").trim();
const args = process.argv.slice(2);
const targetNumberArg = args.find((value) => !value.startsWith("--"));
const targetNumber = String(targetNumberArg || "+12495033301").replace(/[^\d+]/g, "");
const verbose = args.includes("--verbose");

function asList(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.phoneNumbers)) return value.phoneNumbers;
  if (Array.isArray(value?.tools)) return value.tools;
  if (Array.isArray(value?.hooks)) return value.hooks;
  if (Array.isArray(value?.scenarios)) return value.scenarios;
  return [];
}

async function getJson(path) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Vapi request failed (${response.status}): ${body.slice(0, 300)}`);
  }
  return body ? JSON.parse(body) : {};
}

async function getMakeJson(path) {
  const response = await fetch(`${makeApiBaseUrl}${path}`, {
    headers: {
      Authorization: `Token ${makeApiToken}`,
      Accept: "application/json",
    },
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Make request failed (${response.status}): ${body.slice(0, 300)}`);
  }
  return body ? JSON.parse(body) : {};
}

function fingerprint(value) {
  return crypto.createHash("sha256").update(String(value || "").trim()).digest("hex").slice(0, 12);
}

function collectModules(flow, target = []) {
  for (const module of Array.isArray(flow) ? flow : []) {
    target.push(module);
    for (const route of module.routes || []) collectModules(route.flow || route, target);
  }
  return target;
}

async function resolveDynamicMakeAssistant(phone) {
  const serverUrl = String(phone?.server?.url || phone?.serverUrl || "").trim();
  if (!serverUrl || !makeApiToken) return null;

  const seedResponse = await getMakeJson(`/scenarios/${encodeURIComponent(makeSeedScenarioId)}`);
  const seed = seedResponse.scenario || seedResponse;
  const teamId = String(seed?.teamId || seed?.team?.id || "").trim();
  if (!teamId) return null;

  const [hooksResponse, scenariosResponse] = await Promise.all([
    getMakeJson(`/hooks?teamId=${encodeURIComponent(teamId)}&pg%5Blimit%5D=1000`),
    getMakeJson(`/scenarios?teamId=${encodeURIComponent(teamId)}&pg%5Blimit%5D=1000`),
  ]);
  const hooks = asList(hooksResponse);
  const scenarios = asList(scenariosResponse);
  const targetFingerprint = fingerprint(serverUrl);
  const hook = hooks.find((entry) =>
    Object.values(entry || {}).some((value) =>
      typeof value === "string" && /^https?:\/\//i.test(value) && fingerprint(value) === targetFingerprint
    )
  );
  const scenarioId = String(hook?.scenarioId || hook?.scenario?.id || "").trim();
  if (!scenarioId) return null;

  const blueprintResponse = await getMakeJson(`/scenarios/${encodeURIComponent(scenarioId)}/blueprint`);
  const blueprint = blueprintResponse?.response?.blueprint || blueprintResponse?.blueprint || blueprintResponse;
  const responseBodies = collectModules(blueprint.flow)
    .filter((module) => module?.module === "gateway:WebhookRespond")
    .map((module) => String(module?.mapper?.body || ""));
  const assistantIds = [...new Set(responseBodies.flatMap((body) =>
    [...body.matchAll(/"assistantId"\s*:\s*"([^"]+)"/g)].map((match) => match[1])
  ))];
  const scenario = scenarios.find((entry) => String(entry?.id || "") === scenarioId);
  return {
    hookId: String(hook?.id || ""),
    hookName: String(hook?.name || ""),
    scenarioId,
    scenarioName: String(scenario?.name || ""),
    assistantIds,
  };
}

function systemPrompt(assistant) {
  return (assistant?.model?.messages || [])
    .filter((message) => message?.role === "system")
    .map((message) => String(message.content || ""))
    .join("\n");
}

function safeServerUrl(tool) {
  const raw = String(
    tool?.server?.url
      || tool?.function?.server?.url
      || tool?.url
      || ""
  ).trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return "(configured)";
  }
}

async function main() {
  if (!apiKey) {
    throw new Error("Set VAPI_API_KEY, VAPI_KEY, or VAPI_TOKEN in .env.local.");
  }

  const [phoneResponse, toolResponse] = await Promise.all([
    getJson("/phone-number?limit=1000"),
    getJson("/tool?limit=1000"),
  ]);
  const phones = asList(phoneResponse);
  const tools = asList(toolResponse);
  const phone = phones.find((entry) =>
    String(entry?.number || entry?.phoneNumber || "").replace(/[^\d+]/g, "") === targetNumber
  );

  if (!phone) {
    console.log(JSON.stringify({
      ok: false,
      targetNumber,
      reason: "Phone number was not found in the connected Vapi account.",
      visiblePhoneCount: phones.length,
    }, null, 2));
    process.exitCode = 2;
    return;
  }

  let assistantId = String(phone.assistantId || phone.assistant?.id || "").trim();
  let dynamicMakeRouting = null;
  if (!assistantId) {
    dynamicMakeRouting = await resolveDynamicMakeAssistant(phone);
    if (dynamicMakeRouting?.assistantIds?.length === 1) {
      [assistantId] = dynamicMakeRouting.assistantIds;
    }
  }
  const assistant = assistantId ? await getJson(`/assistant/${assistantId}`) : null;
  const toolIds = new Set([
    ...(assistant?.model?.toolIds || []),
    ...(assistant?.toolIds || []),
  ].map(String));
  const attachedTools = tools
    .filter((tool) => toolIds.has(String(tool?.id || "")))
    .map((tool) => ({
      id: tool.id,
      name: tool?.function?.name || tool?.name || "(unnamed)",
      type: tool.type || "",
      serverUrl: safeServerUrl(tool),
      ...(verbose ? {
        description: tool?.function?.description || "",
        parameters: tool?.function?.parameters || {},
        environmentVariableNames: Array.isArray(tool?.environmentVariables)
          ? tool.environmentVariables.map((entry) => String(entry?.name || "")).filter(Boolean)
          : [],
        codeHash: tool?.code ? fingerprint(tool.code) : "",
      } : {}),
    }));
  const prompt = systemPrompt(assistant);

  console.log(JSON.stringify({
    ok: true,
    targetNumber,
    vapiApiKey: redact(apiKey),
    phone: {
      id: phone.id || "",
      name: phone.name || "",
      provider: phone.provider || phone.credentialId || "",
      assistantId,
      routingSource: dynamicMakeRouting ? "make.com-dynamic-assistant" : "vapi-fixed-assistant",
      serverUrl: safeServerUrl(phone),
    },
    dynamicMakeRouting,
    assistant: assistant ? {
      id: assistant.id,
      name: assistant.name || "",
      firstMessage: assistant.firstMessage || "",
      toolCount: attachedTools.length,
      attachedTools,
      ...(verbose ? { systemPrompt: prompt } : {}),
      signupSignals: {
        mentionsSignup: /\bsign[\s-]?up\b/i.test(prompt),
        mentionsTrial: /\btrial\b/i.test(prompt),
        mentionsMake: /\bmake\.?com\b|\bmake workflow\b/i.test(prompt),
        asksForBusinessEmail: /business email|owner email|email address/i.test(prompt),
        asksForBusinessAddress: /business address|street address|postal code/i.test(prompt),
      },
    } : null,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
