const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { loadProjectEnv } = require("./_helpers");
const { normalizeE164 } = require("../server/compositeCallNotifications");
const { deriveVapiWebhookSecret } = require("../server/vapiWebhookAuth");

const env = loadProjectEnv();
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const confirmation = args.find((arg) => arg.startsWith("--confirm="))?.slice("--confirm=".length) || "";
const confirmationPhrase = "ENABLE_MYAIPA_PHONE_SIGNUP_3301";
const targetPhone = normalizeE164(
  args.find((arg) => arg.startsWith("--phone="))?.slice("--phone=".length) || "+12495033301"
);
const vapiBase = String(env.VAPI_API_BASE_URL || "https://api.vapi.ai").replace(/\/+$/, "");
const vapiApiKey = String(env.VAPI_API_KEY || env.VAPI_KEY || env.VAPI_TOKEN || "").trim();
const makeBase = String(env.MAKE_API_BASE_URL || "https://us2.make.com/api/v2").replace(/\/+$/, "");
const makeToken = String(env.MAKE_API_TOKEN || env.MAKE_TOKEN || env.MAKE_API_KEY || "").trim();
const makeSeedScenarioId = String(env.MAKE_SCENARIO_ID || "3530157").trim();
const webhookUrl = String(env.VAPI_WEBHOOK_URL || "https://api.myaipa.ca/api/webhooks/voice").trim();
const webhookSecret = String(env.VAPI_WEBHOOK_SECRET || "").trim() || deriveVapiWebhookSecret(vapiApiKey);
const toolName = "begin_myaipa_signup";
const promptMarker = "## MY AI PA PHONE SIGNUP: begin_myaipa_signup";

function listFrom(value, keys = []) {
  if (Array.isArray(value)) return value;
  for (const key of ["data", "results", ...keys]) {
    if (Array.isArray(value?.[key])) return value[key];
  }
  return [];
}

function hash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 12);
}

function fingerprint(value) {
  return crypto.createHash("sha256").update(String(value || "").trim()).digest("hex").slice(0, 12);
}

function functionName(tool) {
  return String(tool?.function?.name || tool?.name || "").trim();
}

function systemPrompt(assistant) {
  return String(
    (assistant?.model?.messages || []).find((message) => message?.role === "system")?.content || ""
  );
}

function collectModules(flow, target = []) {
  for (const module of Array.isArray(flow) ? flow : []) {
    target.push(module);
    for (const route of module.routes || []) collectModules(route.flow || route, target);
  }
  return target;
}

async function requestVapi(pathname, { method = "GET", body } = {}) {
  const response = await fetch(`${vapiBase}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${vapiApiKey}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch {}
  if (!response.ok) {
    throw new Error(`Vapi ${method} ${pathname} failed (${response.status}): ${String(payload.message || payload.error || "request failed").slice(0, 300)}`);
  }
  return payload;
}

async function requestMake(pathname) {
  const response = await fetch(`${makeBase}${pathname}`, {
    headers: { Authorization: `Token ${makeToken}`, Accept: "application/json" },
  });
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch {}
  if (!response.ok) {
    throw new Error(`Make GET ${pathname} failed (${response.status}): ${String(payload.message || payload.error || "request failed").slice(0, 300)}`);
  }
  return payload;
}

async function resolveDynamicAssistant(phone) {
  const serverUrl = String(phone?.server?.url || phone?.serverUrl || "").trim();
  if (!serverUrl) throw new Error("The My AI PA phone does not have a dynamic assistant webhook.");
  const seedResponse = await requestMake(`/scenarios/${encodeURIComponent(makeSeedScenarioId)}`);
  const seed = seedResponse.scenario || seedResponse;
  const teamId = String(seed?.teamId || seed?.team?.id || "").trim();
  if (!teamId) throw new Error("The Make team could not be resolved.");
  const [hooksResponse, scenariosResponse] = await Promise.all([
    requestMake(`/hooks?teamId=${encodeURIComponent(teamId)}&pg%5Blimit%5D=1000`),
    requestMake(`/scenarios?teamId=${encodeURIComponent(teamId)}&pg%5Blimit%5D=1000`),
  ]);
  const hooks = listFrom(hooksResponse, ["hooks"]);
  const scenarios = listFrom(scenariosResponse, ["scenarios"]);
  const phoneWebhookFingerprint = fingerprint(serverUrl);
  const hook = hooks.find((entry) =>
    Object.values(entry || {}).some((value) =>
      typeof value === "string" && /^https?:\/\//i.test(value) && fingerprint(value) === phoneWebhookFingerprint
    )
  );
  const scenarioId = String(hook?.scenarioId || hook?.scenario?.id || "").trim();
  if (!scenarioId) throw new Error("No Make scenario matched the phone's dynamic assistant webhook.");
  const blueprintResponse = await requestMake(`/scenarios/${encodeURIComponent(scenarioId)}/blueprint`);
  const blueprint = blueprintResponse?.response?.blueprint || blueprintResponse?.blueprint || blueprintResponse;
  const assistantIds = [...new Set(
    collectModules(blueprint.flow)
      .filter((module) => module?.module === "gateway:WebhookRespond")
      .flatMap((module) =>
        [...String(module?.mapper?.body || "").matchAll(/"assistantId"\s*:\s*"([^"]+)"/g)]
          .map((match) => match[1])
      )
  )];
  if (assistantIds.length !== 1) {
    throw new Error(`Expected one dynamic assistant, found ${assistantIds.length}.`);
  }
  const scenario = scenarios.find((entry) => String(entry?.id || "") === scenarioId);
  return {
    assistantId: assistantIds[0],
    hookId: String(hook?.id || ""),
    hookName: String(hook?.name || ""),
    scenarioId,
    scenarioName: String(scenario?.name || ""),
  };
}

function toolPayload() {
  return {
    type: "function",
    function: {
      name: toolName,
      description: "Begin a My AI PA trial signup only after the caller has heard a complete read-back and explicitly confirmed it. The backend sends a verification link; the existing Make.com setup workflow starts only after verification.",
      parameters: {
        type: "object",
        properties: {
          ownerName: { type: "string", description: "Owner's full first and last name." },
          ownerEmail: { type: "string", description: "Owner's business email address. Read it back slowly for confirmation." },
          ownerPhone: { type: "string", description: "Owner's ten-digit Canadian or US mobile number." },
          businessName: { type: "string", description: "The legal or public-facing business name." },
          businessPhone: { type: "string", description: "The business phone number. It may match ownerPhone." },
          streetAddress: { type: "string", description: "Business street address including street number." },
          city: { type: "string", description: "Business city." },
          province: { type: "string", description: "Two-letter Canadian province or territory code, such as ON." },
          postalCode: { type: "string", description: "Canadian postal code." },
          businessType: { type: "string", description: "Primary trade or business type, such as Electrical, Plumbing, HVAC, Contracting, Roofing, or Painting." },
          serviceArea: { type: "string", description: "Cities or region the business serves." },
          services: { type: "string", description: "A concise list of the main services the AI may discuss." },
          specializations: {
            type: "array",
            items: { type: "string" },
            description: "Optional specializations, such as Residential, Commercial, or Emergency service.",
          },
          website: { type: "string", description: "Optional company website." },
          hours: { type: "string", description: "Optional business hours. Do not guess them." },
          callerConfirmed: {
            type: "boolean",
            description: "Set true only after reading every collected detail back and the caller explicitly says it is correct and should be submitted.",
          },
          confirmationText: {
            type: "string",
            description: "The caller's most recent explicit confirmation, such as 'Yes, that is correct. Start my signup.'",
          },
        },
        required: [
          "ownerName",
          "ownerEmail",
          "ownerPhone",
          "businessName",
          "businessPhone",
          "streetAddress",
          "city",
          "province",
          "postalCode",
          "businessType",
          "serviceArea",
          "services",
          "callerConfirmed",
          "confirmationText",
        ],
      },
    },
    server: {
      url: webhookUrl,
      secret: webhookSecret,
    },
  };
}

function withSignupPrompt(messages = []) {
  const override = `${promptMarker}
- If a caller asks to sign up, set up an account, or start the trial, this path takes priority over the demo.
- Explain before collecting details: the trial is fourteen days, includes up to sixty AI-handled minutes, requires no credit card, and setup does not begin until the owner verifies the link sent after this call.
- Never collect card or banking information. Never claim the account, agent, phone number, or trial is active before the tool reports success and the owner verifies the link.
- Collect one item at a time: owner full name; owner email; owner mobile number; business name; business phone; street address; city; province; postal code; trade; service area; and main services. Ask for website and hours only if the caller wants to provide them. Do not guess missing details.
- Read every collected detail back in a short, organized summary. Ask exactly: "Is all of that correct, and do you want me to submit your My AI PA signup now?"
- Call begin_myaipa_signup only after an explicit yes. Pass the caller's actual confirming words in confirmationText and set callerConfirmed true. The tool-call turn must contain the tool call only.
- If validation fails, ask only for the missing or invalid item, read the corrected summary back, and obtain a new explicit yes before retrying.
- On success, say which channel received the verification link and explain that setup begins after they open it. Do not mention Make.com, Vapi, Twilio, tools, or internal systems.
- The existing draft_signup_sms and send_signup_sms tools are demo follow-up tools only. They never submit a signup and must not be described as completing one.`;
  let sawSystem = false;
  const updated = messages.map((message) => {
    if (message?.role !== "system") return message;
    sawSystem = true;
    const content = String(message.content || "");
    const markerIndex = content.indexOf(promptMarker);
    return {
      ...message,
      content: `${markerIndex >= 0 ? content.slice(0, markerIndex).trimEnd() : content.trimEnd()}\n\n${override}`,
    };
  });
  if (!sawSystem) updated.unshift({ role: "system", content: override });
  return updated;
}

function repairedDemoTool(tool) {
  const name = functionName(tool).toLowerCase();
  if (!["draft_signup_sms", "send_signup_sms"].includes(name)) return null;
  const next = {
    type: tool.type,
    function: {
      ...tool.function,
      description: String(tool.function?.description || "")
        .replace(/Arscott Plumbing and Heating Inc\.?/gi, "My AI PA")
        .replace(/Arcsoft message-taking/gi, "My AI PA demo follow-up"),
    },
    code: String(tool.code || "")
      .replace(/Arscott Plumbing and Heating Inc\.?/gi, "My AI PA")
      .replace(/arscott plumbing and heating inc/gi, "my ai pa"),
  };
  return next;
}

async function main() {
  if (!vapiApiKey) throw new Error("VAPI_API_KEY is required.");
  if (!makeToken) throw new Error("MAKE_API_TOKEN is required.");
  if (!webhookSecret) throw new Error("VAPI_WEBHOOK_SECRET could not be resolved.");
  if (!targetPhone) throw new Error("A valid target phone number is required.");
  if (apply && confirmation !== confirmationPhrase) {
    throw new Error(`Apply mode requires --confirm=${confirmationPhrase}.`);
  }

  const [phonesResponse, assistantsResponse, toolsResponse] = await Promise.all([
    requestVapi("/phone-number?limit=1000"),
    requestVapi("/assistant?limit=1000"),
    requestVapi("/tool?limit=1000"),
  ]);
  const phones = listFrom(phonesResponse, ["phoneNumbers"]);
  const assistantSummaries = listFrom(assistantsResponse, ["assistants"]);
  const tools = listFrom(toolsResponse, ["tools"]);
  const phone = phones.find((entry) =>
    normalizeE164(entry?.number || entry?.phoneNumber || entry?.providerResourceId) === targetPhone
  );
  if (!phone) throw new Error(`My AI PA phone ending ${targetPhone.slice(-4)} was not found.`);
  const dynamicRoute = await resolveDynamicAssistant(phone);
  const assistant = await requestVapi(`/assistant/${encodeURIComponent(dynamicRoute.assistantId)}`);
  const model = assistant.model || {};
  const originalToolIds = Array.isArray(model.toolIds) ? model.toolIds.map(String) : [];
  const matchingSignupTools = tools.filter((tool) => functionName(tool).toLowerCase() === toolName);
  if (matchingSignupTools.length > 1) {
    throw new Error(`Refusing to continue: ${matchingSignupTools.length} ${toolName} tools exist.`);
  }
  const signupTool = matchingSignupTools[0] || null;
  const attachedTools = tools.filter((tool) => originalToolIds.includes(String(tool.id || "")));
  const legacyDemoTools = attachedTools.filter((tool) =>
    ["draft_signup_sms", "send_signup_sms"].includes(functionName(tool).toLowerCase())
  );
  const assistantDetails = await Promise.all(
    assistantSummaries
      .filter((entry) => entry?.id)
      .map((entry) => requestVapi(`/assistant/${encodeURIComponent(entry.id)}`))
  );
  const toolUsage = Object.fromEntries(legacyDemoTools.map((tool) => [
    String(tool.id),
    assistantDetails.filter((entry) =>
      Array.isArray(entry?.model?.toolIds) && entry.model.toolIds.map(String).includes(String(tool.id))
    ).length,
  ]));
  const promptReady = systemPrompt(assistant).includes(promptMarker);
  const toolAttached = Boolean(signupTool?.id && originalToolIds.includes(String(signupTool.id)));
  const demoTemplateNeedsRepair = legacyDemoTools.some((tool) => /arscott|arcsoft/i.test(JSON.stringify(tool)));

  console.log(JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    phoneLast4: targetPhone.slice(-4),
    assistantName: assistant.name || "",
    assistantIdHash: hash(assistant.id),
    dynamicMakeRoute: {
      scenarioId: dynamicRoute.scenarioId,
      scenarioName: dynamicRoute.scenarioName,
      hookName: dynamicRoute.hookName,
    },
    signupToolExists: Boolean(signupTool),
    signupToolAttached: toolAttached,
    signupPromptConfigured: promptReady,
    demoTemplateNeedsRepair,
    legacyDemoToolUsageCounts: Object.fromEntries(
      legacyDemoTools.map((tool) => [functionName(tool), toolUsage[String(tool.id)] || 0])
    ),
    plannedActions: [
      ...(!signupTool ? ["create guarded phone-signup tool"] : []),
      ...(!toolAttached ? ["attach phone-signup tool to Riley"] : []),
      ...(!promptReady ? ["install confirmed phone-signup conversation flow"] : []),
      ...(demoTemplateNeedsRepair ? ["replace the unrelated plumbing-company demo SMS template without changing shared assistants"] : []),
    ],
  }, null, 2));

  if (!apply) {
    console.log(`Dry run only. Re-run after the backend is deployed with --apply --confirm=${confirmationPhrase}.`);
    return;
  }

  const backupDir = path.join(process.cwd(), "diagnostics", "myaipa-phone-signup");
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  fs.writeFileSync(
    path.join(backupDir, `riley-${hash(assistant.id)}-${stamp}.json`),
    `${JSON.stringify({ createdAt: new Date().toISOString(), assistant, legacyDemoTools }, null, 2)}\n`,
    { flag: "wx" }
  );

  let createdSignupTool = null;
  const createdDemoTools = [];
  try {
    const savedSignupTool = signupTool
      ? await requestVapi(`/tool/${encodeURIComponent(signupTool.id)}`, { method: "PATCH", body: toolPayload() })
      : await requestVapi("/tool", { method: "POST", body: toolPayload() });
    if (!signupTool) createdSignupTool = savedSignupTool;
    const signupToolId = String(savedSignupTool?.id || signupTool?.id || "").trim();
    if (!signupToolId) throw new Error("Vapi did not return the phone-signup tool ID.");

    const replacements = new Map();
    for (const tool of legacyDemoTools) {
      const desired = repairedDemoTool(tool);
      if (!desired || !/arscott|arcsoft/i.test(JSON.stringify(tool))) continue;
      const usageCount = toolUsage[String(tool.id)] || 0;
      if (usageCount <= 1) {
        await requestVapi(`/tool/${encodeURIComponent(tool.id)}`, { method: "PATCH", body: desired });
      } else {
        const cloned = await requestVapi("/tool", { method: "POST", body: desired });
        createdDemoTools.push(cloned);
        replacements.set(String(tool.id), String(cloned.id));
      }
    }

    const nextToolIds = originalToolIds
      .map((id) => replacements.get(id) || id)
      .filter(Boolean);
    nextToolIds.push(signupToolId);
    const { tools: _expandedTools, ...modelWithoutExpandedTools } = model;
    await requestVapi(`/assistant/${encodeURIComponent(assistant.id)}`, {
      method: "PATCH",
      body: {
        model: {
          ...modelWithoutExpandedTools,
          toolIds: [...new Set(nextToolIds)],
          messages: withSignupPrompt(model.messages || []),
        },
      },
    });

    const verifiedAssistant = await requestVapi(`/assistant/${encodeURIComponent(assistant.id)}`);
    const verifiedToolIds = Array.isArray(verifiedAssistant?.model?.toolIds)
      ? verifiedAssistant.model.toolIds.map(String)
      : [];
    const verifiedTools = await Promise.all(
      verifiedToolIds.map((id) => requestVapi(`/tool/${encodeURIComponent(id)}`))
    );
    const checks = {
      signupToolAttached: verifiedToolIds.includes(signupToolId),
      signupPromptConfigured: systemPrompt(verifiedAssistant).includes(promptMarker),
      unrelatedToolsPreserved: originalToolIds
        .filter((id) => !replacements.has(id))
        .every((id) => verifiedToolIds.includes(id)),
      badDemoTemplateRemoved: !verifiedTools
        .filter((tool) => ["draft_signup_sms", "send_signup_sms"].includes(functionName(tool).toLowerCase()))
        .some((tool) => /arscott|arcsoft/i.test(JSON.stringify(tool))),
      toolServerConfigured: Boolean(
        verifiedTools.find((tool) => String(tool.id) === signupToolId)?.server?.url === webhookUrl
      ),
    };
    if (!Object.values(checks).every(Boolean)) {
      throw new Error("Vapi read-back did not pass every phone-signup safety check.");
    }

    console.log(JSON.stringify({
      applied: true,
      verified: true,
      assistantIdHash: hash(assistant.id),
      signupToolIdHash: hash(signupToolId),
      checks,
    }, null, 2));
  } catch (error) {
    await requestVapi(`/assistant/${encodeURIComponent(assistant.id)}`, {
      method: "PATCH",
      body: { model },
    }).catch(() => {});
    if (createdSignupTool?.id) {
      await requestVapi(`/tool/${encodeURIComponent(createdSignupTool.id)}`, { method: "DELETE" }).catch(() => {});
    }
    for (const tool of createdDemoTools) {
      if (tool?.id) await requestVapi(`/tool/${encodeURIComponent(tool.id)}`, { method: "DELETE" }).catch(() => {});
    }
    throw error;
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
