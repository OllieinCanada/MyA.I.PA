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
const demoToolName = "send_myaipa_demo_followup";
const endCallToolId = "1bf11961-f731-43b7-9f97-d765acdb51cd";
const legacyPromptMarker = "## MY AI PA PHONE SIGNUP: begin_myaipa_signup";
const promptMarker = "## MY AI PA PHONE SIGNUP: deterministic-review-v2";

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
      description: "Prepare a deterministic My AI PA signup readback, then submit those exact reviewed details only after explicit caller confirmation. Always call action review before action submit.",
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
          action: {
            type: "string",
            enum: ["review", "submit"],
            description: "Use review after collecting the fields. Use submit only after speaking the returned readback exactly and receiving the caller's explicit confirmation.",
          },
          reviewToken: {
            type: "string",
            description: "For submit, copy the opaque reviewToken returned by the immediately preceding review call. Never speak or alter it.",
          },
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
          "action",
        ],
      },
    },
    server: {
      url: webhookUrl,
      secret: webhookSecret,
    },
  };
}

function demoFollowupToolPayload() {
  return {
    type: "function",
    function: {
      name: demoToolName,
      description: "Send the My AI PA demo follow-up only when the caller explicitly asks for a text. Never use this during or after signup.",
      parameters: {
        type: "object",
        properties: {
          rawPhoneNumber: { type: "string", description: "The explicit ten-digit mobile number supplied by the caller." },
          name: { type: "string", description: "Optional caller name." },
          callerRequest: { type: "string", description: "The caller's exact most recent words explicitly asking for a text." },
        },
        required: ["rawPhoneNumber", "callerRequest"],
      },
    },
    server: { url: webhookUrl, secret: webhookSecret },
  };
}

function withSignupPrompt(messages = []) {
  const override = `${promptMarker}
- If a caller asks to sign up, set up an account, or start the trial, this path takes priority over the demo.
- Explain before collecting details: the trial is fourteen days, includes up to sixty AI-handled minutes, requires no credit card, and setup does not begin until the owner verifies the link sent after this call.
- Never collect card or banking information. Never claim the account, agent, phone number, or trial is active before the tool reports success and the owner verifies the link.
- Collect one item at a time: owner full name; owner email; owner mobile number; business name; business phone; street address; city; province; postal code; trade; service area; and main services. Ask for website and hours only if the caller wants to provide them. Do not guess missing details.
- After collecting every required field, call begin_myaipa_signup with action review and callerConfirmed false. Do not perform your own summary first.
- When the review result returns, say its readback exactly as written, then say its confirmationQuestion exactly. Do not paraphrase, merge labels, add punctuation words, repeat a field, or invent text. Never speak the reviewToken or instruction.
- The backend formats email, phone, and Canadian postal-code characters for unambiguous speech. Do not reformat them.
- Stop after the confirmationQuestion and wait for the caller's next answer. Do not ask "are you still there" unless there has been genuine silence after the complete question.
- If a short yes or no is not captured, pause briefly and ask once: "Sorry, I may have missed that — was that yes or no?"
- Only if the caller's immediately following answer explicitly confirms both that the details are correct and that they want submission, call begin_myaipa_signup again with action submit, the unchanged fields, the exact reviewToken, callerConfirmed true, and their exact words in confirmationText. Never invent or paraphrase confirmationText. A yes to any other question is not authorization. The tool-call turn must contain the tool call only.
- If validation fails, ask only for the missing or invalid item, read the corrected summary back, and obtain a new explicit yes before retrying.
- On success, repeat the tool's channel-accurate message without adding a delivery channel. Do not mention Make.com, Vapi, Twilio, tools, or internal systems.
- Once signup intent is identified, remain in signup mode for the rest of the call. Never call a demo follow-up tool in signup mode.
- send_myaipa_demo_followup is only for a non-signup demo caller who explicitly asks for a text. Pass the caller's exact request in callerRequest. A general yes is not permission to text.
- After a successful signup response, ask once whether the caller needs anything else. If they say no, thanks, goodbye, or equivalent, say "Thanks for calling My A I P A. Take care." Let it finish, then call endCall. Do not ask an unrelated question.`;
  let sawSystem = false;
  const updated = messages.map((message) => {
    if (message?.role !== "system") return message;
    sawSystem = true;
    const content = String(message.content || "")
      .replace(/^.*never (?:output|use|say) digits.*$/gmi, "")
      .replace(/^.*spell out every number.*$/gmi, "");
    const markerIndexes = [content.indexOf(promptMarker), content.indexOf(legacyPromptMarker)].filter((index) => index >= 0);
    const markerIndex = markerIndexes.length ? Math.min(...markerIndexes) : -1;
    return {
      ...message,
      content: `${markerIndex >= 0 ? content.slice(0, markerIndex).trimEnd() : content.trimEnd()}\n\n${override}`,
    };
  });
  if (!sawSystem) updated.unshift({ role: "system", content: override });
  return updated;
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
  const matchingDemoTools = tools.filter((tool) => functionName(tool).toLowerCase() === demoToolName);
  if (matchingDemoTools.length > 1) throw new Error(`Refusing to continue: ${matchingDemoTools.length} ${demoToolName} tools exist.`);
  const guardedDemoTool = matchingDemoTools[0] || null;
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
  const signupToolSchemaReady = Boolean(
    signupTool?.function?.parameters?.properties?.action
      && signupTool?.function?.parameters?.properties?.reviewToken
      && signupTool?.function?.parameters?.required?.includes("action")
  );

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
    signupToolReviewSchemaConfigured: signupToolSchemaReady,
    signupPromptConfigured: promptReady,
    legacyDemoToolUsageCounts: Object.fromEntries(
      legacyDemoTools.map((tool) => [functionName(tool), toolUsage[String(tool.id)] || 0])
    ),
    legacyDemoToolEnvironmentVariables: Object.fromEntries(
      legacyDemoTools.map((tool) => [
        functionName(tool),
        Array.isArray(tool.environmentVariables)
          ? tool.environmentVariables.map((entry) => String(entry?.name || "")).filter(Boolean)
          : [],
      ])
    ),
    plannedActions: [
      ...(!signupTool ? ["create guarded phone-signup tool"] : []),
      ...(signupTool && !signupToolSchemaReady ? ["upgrade phone-signup tool to deterministic review and signed submission"] : []),
      ...(!guardedDemoTool ? ["create server-gated demo follow-up tool"] : []),
      ...(!toolAttached ? ["attach phone-signup tool to Riley"] : []),
      ...(!promptReady ? ["install confirmed phone-signup conversation flow"] : []),
      ...(legacyDemoTools.length ? ["detach obsolete draft/send demo SMS tools from Riley"] : []),
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
    const savedDemoTool = guardedDemoTool
      ? await requestVapi(`/tool/${encodeURIComponent(guardedDemoTool.id)}`, { method: "PATCH", body: demoFollowupToolPayload() })
      : await requestVapi("/tool", { method: "POST", body: demoFollowupToolPayload() });
    if (!guardedDemoTool) createdDemoTools.push(savedDemoTool);
    const guardedDemoToolId = String(savedDemoTool?.id || guardedDemoTool?.id || "").trim();
    if (!guardedDemoToolId) throw new Error("Vapi did not return the guarded demo follow-up tool ID.");

    const legacyDemoToolIds = new Set(legacyDemoTools.map((tool) => String(tool.id)));
    const nextToolIds = originalToolIds
      .filter((id) => !legacyDemoToolIds.has(id))
      .filter(Boolean);
    nextToolIds.push(signupToolId, guardedDemoToolId, endCallToolId);
    const { tools: _expandedTools, ...modelWithoutExpandedTools } = model;
    await requestVapi(`/assistant/${encodeURIComponent(assistant.id)}`, {
      method: "PATCH",
      body: {
        transcriber: {
          ...(assistant.transcriber || {}),
          provider: assistant.transcriber?.provider || "deepgram",
          model: assistant.transcriber?.model || "nova-3",
          language: assistant.transcriber?.language || "en",
          endpointing: Math.min(350, Number(assistant.transcriber?.endpointing) || 350),
        },
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
      guardedDemoToolAttached: verifiedToolIds.includes(guardedDemoToolId),
      endCallAttached: verifiedToolIds.includes(endCallToolId),
      signupPromptConfigured: systemPrompt(verifiedAssistant).includes(promptMarker),
      unrelatedToolsPreserved: originalToolIds
        .filter((id) => !legacyDemoToolIds.has(id))
        .every((id) => verifiedToolIds.includes(id)),
      legacyDemoToolsDetached: !verifiedTools.some((tool) => ["draft_signup_sms", "send_signup_sms"].includes(functionName(tool).toLowerCase())),
      toolServerConfigured: Boolean(
        verifiedTools.find((tool) => String(tool.id) === signupToolId)?.server?.url === webhookUrl
      ),
      reviewWorkflowToolSchema: Boolean(
        verifiedTools.find((tool) => String(tool.id) === signupToolId)?.function?.parameters?.properties?.action
          && verifiedTools.find((tool) => String(tool.id) === signupToolId)?.function?.parameters?.properties?.reviewToken
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
      body: { model, transcriber: assistant.transcriber },
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
