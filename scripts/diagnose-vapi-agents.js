const { loadProjectEnv, redact } = require("./_helpers");
const { POST_SEND_CLOSING_MARKER } = require("../server/compositeCallNotifications");

const env = loadProjectEnv();

const AGENT_VERSION = "MYAIPA_AGENT_VERSION: 2026-07-12-deterministic-sms-v1";
const DETERMINISTIC_MARKER =
  "## FINAL OVERRIDE: Social response, pricing consent, deterministic SMS tools, silent tools, and clean ending";
const LEGACY_MARKER =
  "## FINAL OVERRIDE: Social response, pricing consent, detailed SMS, silent tools, and clean ending";

const CUSTOMER_TOOL_ID = "baf9269b-6f71-4694-aaec-859209fb77a5";
const OWNER_TOOL_ID = "a2b67aee-f59e-4056-bff5-bf60dbc97ab0";
const END_CALL_TOOL_ID = "1bf11961-f731-43b7-9f97-d765acdb51cd";

const VAPI_API_BASE_URL = env.VAPI_API_BASE_URL || "https://api.vapi.ai";
const MAKE_API_BASE_URL = env.MAKE_API_BASE_URL || "https://us2.make.com/api/v2";
const MAKE_SCENARIO_ID = env.MAKE_SCENARIO_ID || "3530157";
const MAKE_ASSISTANT_MODULE_ID = Number(env.MAKE_ASSISTANT_MODULE_ID || 25);

const args = new Set(process.argv.slice(2));
const jsonOutput = args.has("--json");
const verbose = args.has("--verbose");

function valueFrom(names) {
  for (const name of names) {
    if (env[name]) return env[name];
  }
  return "";
}

const VAPI_API_KEY = valueFrom(["VAPI_API_KEY", "VAPI_KEY", "VAPI_TOKEN"]);
const MAKE_API_TOKEN = valueFrom(["MAKE_API_TOKEN", "MAKE_TOKEN", "MAKE_API_KEY"]);

function ok(name, details = {}) {
  return { ok: true, name, ...details };
}

function fail(name, message, details = {}) {
  return { ok: false, name, message, ...details };
}

function hasAllProperties(schema, properties) {
  const actual = schema?.properties || {};
  return properties.every((property) => Boolean(actual[property]));
}

function systemPrompt(assistant) {
  return (assistant.model?.messages || []).find((message) => message.role === "system")?.content || "";
}

function requiredList(tool) {
  return tool.function?.parameters?.required || [];
}

function propertyMap(tool) {
  return tool.function?.parameters?.properties || {};
}

async function getJson(url, headers, label) {
  const response = await fetch(url, { headers });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${label} failed: HTTP ${response.status}: ${text.slice(0, 500)}`);
  }
  return text ? JSON.parse(text) : {};
}

async function runToolCode(code, toolArgs) {
  const calls = [];
  const fakeFetch = async (_url, options = {}) => {
    const params = new URLSearchParams(String(options.body || ""));
    calls.push({
      to: params.get("To"),
      from: params.get("From"),
      body: params.get("Body"),
      idempotencyKey: options.headers?.["Idempotency-Key"],
    });
    return {
      ok: true,
      status: 201,
      json: async () => ({ sid: "SM_DIAGNOSTIC_ONLY" }),
    };
  };
  const fakeEnv = {
    TWILIO_ACCOUNT_SID: "AC_DIAGNOSTIC_ONLY",
    TWILIO_AUTH_TOKEN: "AUTH_DIAGNOSTIC_ONLY",
    DEFAULT_FROM_NUMBER: "+12498005417",
    DEFAULT_OWNER_TO_NUMBER: "+19055550123",
  };
  const localBtoa = (value) => Buffer.from(String(value), "utf8").toString("base64");
  const runner = new Function(
    "args",
    "env",
    "fetch",
    "btoa",
    "URLSearchParams",
    `return (async () => {\n${code}\n})()`
  );
  const result = await runner(toolArgs, fakeEnv, fakeFetch, localBtoa, URLSearchParams);
  return { result, calls };
}

function checkToolSchema(tool, type) {
  const required = requiredList(tool);
  const properties = propertyMap(tool);
  const checks = [];

  checks.push(
    tool.type === "code"
      ? ok(`${type} tool is a code tool`)
      : fail(`${type} tool is a code tool`, `Expected type "code", got "${tool.type || "(missing)"}"`)
  );
  checks.push(
    /buildDeterministicBody/.test(tool.code || "")
      ? ok(`${type} tool builds body deterministically`)
      : fail(`${type} tool builds body deterministically`, "Missing buildDeterministicBody in tool code")
  );
  checks.push(
    properties.body && !required.includes("body")
      ? ok(`${type} tool keeps legacy body optional`)
      : fail(`${type} tool keeps legacy body optional`, "body should exist only as an optional fallback")
  );
  checks.push(
    properties.requestType
      ? ok(`${type} tool accepts requestType`)
      : fail(`${type} tool accepts requestType`, "Missing requestType schema property")
  );

  if (type === "customer") {
    checks.push(
      required.includes("fromNumber") && required.includes("rawPhoneNumber")
        ? ok("customer tool requires sender and customer callback number")
        : fail("customer tool requires sender and customer callback number", `Required fields: ${required.join(", ")}`)
    );
    checks.push(
      hasAllProperties(tool.function?.parameters, [
        "businessName",
        "requestType",
        "rawPhoneNumber",
        "jobDetails",
        "streetAddress",
        "city",
        "message",
        "fromNumber",
      ])
        ? ok("customer tool has structured field schema")
        : fail("customer tool has structured field schema", "Missing one or more structured customer SMS fields")
    );
  } else {
    checks.push(
      required.includes("fromNumber")
        ? ok("owner tool requires sender")
        : fail("owner tool requires sender", `Required fields: ${required.join(", ")}`)
    );
    checks.push(
      hasAllProperties(tool.function?.parameters, [
        "requestType",
        "name",
        "rawPhoneNumber",
        "jobDetails",
        "streetAddress",
        "city",
        "bestCallbackTime",
        "message",
        "fromNumber",
        "toNumber",
      ])
        ? ok("owner tool has structured field schema")
        : fail("owner tool has structured field schema", "Missing one or more structured owner SMS fields")
    );
  }

  return checks;
}

async function checkToolSimulation(customerTool, ownerTool) {
  const serviceArgs = {
    fromNumber: "+12498005417",
    toNumber: "+19055550123",
    businessName: "Example Electrical",
    requestType: "repair",
    name: "Test Caller",
    rawPhoneNumber: "+19055550000",
    jobDetails: "fix the electric around the shower",
    streetAddress: "123 Test Street",
    city: "Grimsby",
    bestCallbackTime: "11 PM",
    body: "MODEL SHOULD NOT WIN",
  };
  const messageArgs = {
    fromNumber: "+12498005417",
    toNumber: "+19055550123",
    businessName: "Example Electrical",
    requestType: "message",
    name: "Test Caller",
    rawPhoneNumber: "+19055550000",
    message: "Please call me tomorrow.",
    body: "MODEL SHOULD NOT WIN",
  };

  const simulations = {
    customerService: await runToolCode(customerTool.code, serviceArgs),
    customerMessage: await runToolCode(customerTool.code, messageArgs),
    ownerService: await runToolCode(ownerTool.code, serviceArgs),
    ownerMessage: await runToolCode(ownerTool.code, messageArgs),
  };

  const expected = {
    customerService:
      "Thanks for calling Example Electrical. We received your service request regarding fix the electric around the shower at 123 Test Street, Grimsby. Our team will call you back as soon as possible.",
    customerMessage:
      'Thanks for calling Example Electrical. We received your message: "Please call me tomorrow." Our team will call you back as soon as possible.',
    ownerService:
      "Service request (repair):\n- Name: Test Caller\n- Phone: +19055550000\n- Job Details: fix the electric around the shower\n- Address: 123 Test Street\n- City: Grimsby\n- Best Callback Time: 11 PM",
    ownerMessage:
      "Message request:\n- Name: Test Caller\n- Phone: +19055550000\n- Message: Please call me tomorrow.",
  };

  const checks = [];
  for (const [name, simulation] of Object.entries(simulations)) {
    const body = simulation.calls[0]?.body || "";
    checks.push(
      body === expected[name]
        ? ok(`${name} deterministic body matches`, verbose ? { body } : {})
        : fail(`${name} deterministic body matches`, "Generated body differed from expected", {
            expected: expected[name],
            actual: body,
          })
    );
    checks.push(
      simulation.result?.ok === true && simulation.result?.sent === true && simulation.result?.bodyBuiltByTool === true
        ? ok(`${name} simulated send succeeds through tool-built body`)
        : fail(`${name} simulated send succeeds through tool-built body`, "Tool did not report a successful diagnostic send", {
            result: simulation.result,
          })
    );
  }

  const ignoredModelBody = Object.values(simulations).every(
    (simulation) => !/MODEL SHOULD NOT WIN/.test(simulation.calls[0]?.body || "")
  );
  checks.push(
    ignoredModelBody
      ? ok("structured fields override legacy body")
      : fail("structured fields override legacy body", "A simulated SMS used the caller-provided legacy body")
  );

  return checks;
}

function assistantChecks(assistant, isolatedToolIds = new Set()) {
  const prompt = systemPrompt(assistant);
  const json = JSON.stringify(assistant);
  const toolIds = assistant.model?.toolIds || [];
  const hasIsolatedSmsTool = toolIds.some((id) => isolatedToolIds.has(id));

  return [
    prompt.includes(AGENT_VERSION)
      ? ok("has current agent version")
      : fail("has current agent version", "Missing current version tag"),
    prompt.includes(DETERMINISTIC_MARKER)
      ? ok("has deterministic final override marker")
      : fail("has deterministic final override marker", "Missing deterministic final override marker"),
    /(?:how (?:are you|can I help you) today|is that okay)\?/i.test(assistant.firstMessage || "")
      ? ok("first message opens with a caller-centered question")
      : fail("first message opens with a caller-centered question", `First message: ${assistant.firstMessage || "(missing)"}`),
    /pass structured fields only/i.test(prompt)
      ? ok("instructs structured SMS fields only")
      : fail("instructs structured SMS fields only", "Missing structured SMS field instruction"),
    /Do not compose, shorten, rewrite, or pass the SMS body/i.test(prompt)
      ? ok("forbids model-written SMS body")
      : fail("forbids model-written SMS body", "Missing body-forbidden instruction"),
    /tool-call turn must contain tool calls only/i.test(prompt)
      ? ok("has silent tool-call rule")
      : fail("has silent tool-call rule", "Missing silent tool-call rule"),
    /This'll just take a sec/i.test(prompt) && /Absolutely do not say/i.test(prompt)
      ? ok("explicitly bans filler while tools run")
      : fail("explicitly bans filler while tools run", "Missing explicit filler ban"),
    prompt.includes(POST_SEND_CLOSING_MARKER)
      && /Is there anything else I can help you with today\?/i.test(prompt)
      && /Let the entire final sentence finish before calling endCall/i.test(prompt)
      && !/Then call endCall immediately/i.test(prompt)
      ? ok("has natural post-send closing")
      : fail("has natural post-send closing", "Missing the wait-for-caller closing or a retired immediate-end instruction remains"),
    hasIsolatedSmsTool || toolIds.includes(CUSTOMER_TOOL_ID) || json.includes(CUSTOMER_TOOL_ID)
      ? ok("has customer SMS tool")
      : fail("has customer SMS tool", "Missing customer SMS tool ID"),
    hasIsolatedSmsTool || toolIds.includes(OWNER_TOOL_ID) || json.includes(OWNER_TOOL_ID)
      ? ok("has owner SMS tool")
      : fail("has owner SMS tool", "Missing owner SMS tool ID"),
    toolIds.includes(END_CALL_TOOL_ID) || json.includes(END_CALL_TOOL_ID)
      ? ok("has endCall tool")
      : fail("has endCall tool", "Missing endCall tool ID"),
    !prompt.includes(LEGACY_MARKER)
      ? ok("does not use legacy detailed-SMS marker")
      : fail("does not use legacy detailed-SMS marker", "Legacy marker is still present"),
  ];
}

function summarizeChecks(checks) {
  const failures = checks.filter((check) => !check.ok);
  return { total: checks.length, passed: checks.length - failures.length, failed: failures.length, failures };
}

async function main() {
  const setupFailures = [];
  if (!VAPI_API_KEY) setupFailures.push("Set VAPI_API_KEY, VAPI_KEY, or VAPI_TOKEN.");
  if (!MAKE_API_TOKEN) setupFailures.push("Set MAKE_API_TOKEN, MAKE_TOKEN, or MAKE_API_KEY.");
  if (setupFailures.length) {
    console.error("Vapi agent diagnostic cannot run:");
    for (const message of setupFailures) console.error(`- ${message}`);
    process.exit(1);
  }

  const vapiHeaders = { Authorization: `Bearer ${VAPI_API_KEY}` };
  const makeHeaders = { Authorization: `Token ${MAKE_API_TOKEN}` };

  const [customerTool, ownerTool, toolList, assistantList, makeBlueprintResponse] = await Promise.all([
    getJson(`${VAPI_API_BASE_URL}/tool/${CUSTOMER_TOOL_ID}`, vapiHeaders, "Fetch customer SMS tool"),
    getJson(`${VAPI_API_BASE_URL}/tool/${OWNER_TOOL_ID}`, vapiHeaders, "Fetch owner SMS tool"),
    getJson(`${VAPI_API_BASE_URL}/tool?limit=1000`, vapiHeaders, "Fetch Vapi tools"),
    getJson(`${VAPI_API_BASE_URL}/assistant?limit=1000`, vapiHeaders, "Fetch Vapi assistants"),
    getJson(`${MAKE_API_BASE_URL}/scenarios/${MAKE_SCENARIO_ID}/blueprint`, makeHeaders, "Fetch Make blueprint"),
  ]);

  const listedAssistants = Array.isArray(assistantList) ? assistantList : assistantList.data || [];
  const listedTools = Array.isArray(toolList) ? toolList : toolList.data || toolList.tools || [];
  const isolatedToolIds = new Set(listedTools
    .filter((tool) => /^send_call_summaries_(?:pilot_)?\d{4}(?:_[a-f0-9]{8})?_v\d+$/i.test(String(tool?.function?.name || tool?.name || "")))
    .map((tool) => String(tool?.id || ""))
    .filter(Boolean));
  const targetAssistantSummaries = listedAssistants.filter((assistant) => {
    const json = JSON.stringify(assistant);
    return (
      json.includes(CUSTOMER_TOOL_ID) ||
      json.includes(OWNER_TOOL_ID) ||
      json.includes(DETERMINISTIC_MARKER) ||
      json.includes(LEGACY_MARKER) ||
      json.includes(AGENT_VERSION)
    );
  });

  const assistantDetails = await Promise.all(
    targetAssistantSummaries.map((assistant) =>
      getJson(`${VAPI_API_BASE_URL}/assistant/${assistant.id}`, vapiHeaders, `Fetch assistant ${assistant.id}`)
    )
  );

  const makeModule = makeBlueprintResponse.response?.blueprint?.flow?.find(
    (module) => Number(module.id) === MAKE_ASSISTANT_MODULE_ID
  );
  const makeAssistantBody = makeModule?.mapper?.body ? JSON.parse(makeModule.mapper.body) : null;

  const toolChecks = [
    ...checkToolSchema(customerTool, "customer"),
    ...checkToolSchema(ownerTool, "owner"),
    ...(await checkToolSimulation(customerTool, ownerTool)),
  ];

  const assistantResults = assistantDetails.map((assistant) => ({
    id: assistant.id,
    name: assistant.name || "(unnamed)",
    firstMessage: assistant.firstMessage || "",
    checks: assistantChecks(assistant, isolatedToolIds),
  }));
  const assistantChecksFlat = assistantResults.flatMap((assistant) =>
    assistant.checks.map((check) => ({ ...check, assistantId: assistant.id, assistantName: assistant.name }))
  );

  const makeChecks = makeAssistantBody
    ? assistantChecks({
        id: `make-scenario-${MAKE_SCENARIO_ID}-module-${MAKE_ASSISTANT_MODULE_ID}`,
        name: "Make assistant creation module",
        firstMessage: makeAssistantBody.firstMessage,
        model: makeAssistantBody.model,
      }).filter((check) => !["has customer SMS tool", "has owner SMS tool", "has endCall tool"].includes(check.name))
    : [fail("Make assistant module exists", `Module ${MAKE_ASSISTANT_MODULE_ID} with mapper.body was not found`)];

  const summary = {
    expectedAgentVersion: AGENT_VERSION,
    config: {
      vapiApiBaseUrl: VAPI_API_BASE_URL,
      vapiApiKey: redact(VAPI_API_KEY),
      makeApiBaseUrl: MAKE_API_BASE_URL,
      makeToken: redact(MAKE_API_TOKEN),
      makeScenarioId: MAKE_SCENARIO_ID,
      makeAssistantModuleId: MAKE_ASSISTANT_MODULE_ID,
    },
    tools: summarizeChecks(toolChecks),
    assistants: {
      targetCount: assistantDetails.length,
      ...summarizeChecks(assistantChecksFlat),
      failingAssistants: assistantResults
        .filter((assistant) => assistant.checks.some((check) => !check.ok))
        .map((assistant) => ({
          id: assistant.id,
          name: assistant.name,
          firstMessage: assistant.firstMessage,
          failures: assistant.checks.filter((check) => !check.ok),
        })),
    },
    make: summarizeChecks(makeChecks),
  };

  const failed = summary.tools.failed + summary.assistants.failed + summary.make.failed;

  if (jsonOutput) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log("MyAIPA Vapi agent diagnostic");
    console.log("=============================");
    console.log(`Expected version: ${AGENT_VERSION}`);
    console.log(`Vapi API: ${VAPI_API_BASE_URL} (${redact(VAPI_API_KEY)})`);
    console.log(`Make scenario: ${MAKE_SCENARIO_ID}, module ${MAKE_ASSISTANT_MODULE_ID} (${redact(MAKE_API_TOKEN)})`);
    console.log("");
    console.log(`Tools: ${summary.tools.passed}/${summary.tools.total} checks passed`);
    console.log(
      `Assistants: ${summary.assistants.targetCount} targeted, ${summary.assistants.passed}/${summary.assistants.total} checks passed`
    );
    console.log(`Make: ${summary.make.passed}/${summary.make.total} checks passed`);

    const failures = [
      ...summary.tools.failures.map((failure) => ({ scope: "tool", ...failure })),
      ...summary.assistants.failures.map((failure) => ({ scope: "assistant", ...failure })),
      ...summary.make.failures.map((failure) => ({ scope: "make", ...failure })),
    ];

    if (failures.length) {
      console.log("");
      console.log("Failures");
      for (const failure of failures.slice(0, 30)) {
        const owner = failure.assistantName ? ` ${failure.assistantName} (${failure.assistantId})` : "";
        console.log(`- [${failure.scope}]${owner} ${failure.name}: ${failure.message || "failed"}`);
      }
      if (failures.length > 30) console.log(`- ...and ${failures.length - 30} more failures`);
    } else {
      console.log("");
      console.log("All Vapi/Make agent checks passed.");
    }
  }

  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
