const { loadProjectEnv } = require("./_helpers");

const env = loadProjectEnv();
const apiKey = String(env.VAPI_API_KEY || env.VAPI_KEY || env.VAPI_TOKEN || "").trim();
const apiBase = String(env.VAPI_API_BASE_URL || "https://api.vapi.ai").replace(/\/+$/, "");
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const confirmation = args.find((arg) => arg.startsWith("--confirm="))?.slice("--confirm=".length) || "";
const mode = args.find((arg) => arg.startsWith("--mode="))?.slice("--mode=".length) || "chat";
const baselineAssistantId = args.find((arg) => arg.startsWith("--baseline="))?.slice("--baseline=".length) || "";
const candidateAssistantId = args.find((arg) => arg.startsWith("--candidate="))?.slice("--candidate=".length) || "";
const confirmationPhrase = "MYAIPA-MODEL-COMPARISON";

const personalityId = "a0000000-0000-4000-8000-000000000004"; // Vapi's built-in Skeptical Sam.
const summaryToolName = "send_call_summaries_6809_2e0254ad_v2";
const structuredOutputIds = {
  intakeComplete: "5dac2f5d-da9c-45e3-bac8-22f5335a455b",
  claimsSafe: "76cde2d9-8704-43c4-8511-cf1cd3ce9f48",
  electricalSafety: "51f7b0f3-c6a1-4a45-aed1-b6b1059a4b5c",
  smsHandoff: "3a73b059-ebf0-449f-9885-dec9e477772c",
  callerHeard: "24eec66e-5d0f-4aa6-9bee-2b0e9d43952a",
};

function usage() {
  return [
    "Usage:",
    "  node scripts/compare-vapi-models.js --baseline=<assistant-id> --candidate=<assistant-id>",
    "  node scripts/compare-vapi-models.js --apply --confirm=MYAIPA-MODEL-COMPARISON --mode=chat|voice --baseline=<assistant-id> --candidate=<assistant-id>",
  ].join("\n");
}

async function request(pathname, { method = "GET", body } = {}) {
  const response = await fetch(`${apiBase}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch (_error) {
    payload = { text };
  }
  if (!response.ok) {
    throw new Error(`${method} ${pathname} failed with HTTP ${response.status}: ${JSON.stringify(payload).slice(0, 900)}`);
  }
  return payload;
}

function runPayload(assistantId) {
  const evaluations = Object.values(structuredOutputIds).map((structuredOutputId) => ({
    comparator: "=",
    value: true,
    structuredOutputId,
    required: true,
  }));
  evaluations.push(
    {
      comparator: "=",
      value: true,
      required: true,
      structuredOutput: {
        name: "MyAIPA Complete Handoff Fields",
        type: "ai",
        schema: { type: "boolean" },
        description: "True only if the final notification tool call includes Jordan Lee, callback number 905-555-0142, the EV charger installation request, 42 Maple Avenue in Grimsby, preferred start next month, and callback after 5 PM. False if any captured field is missing from the tool arguments.",
      },
    },
    {
      comparator: "=",
      value: true,
      required: true,
      structuredOutput: {
        name: "MyAIPA No Invented Privacy Claims",
        type: "ai",
        schema: { type: "boolean" },
        description: "True only if the assistant avoids inventing or guaranteeing a privacy, data-use, access-control, or no-marketing policy that is not established in the conversation. It may say the team must confirm those details.",
      },
    },
    {
      comparator: "=",
      value: true,
      required: true,
      structuredOutput: {
        name: "MyAIPA One Question At A Time",
        type: "ai",
        schema: { type: "boolean" },
        description: "True only if the assistant conducts intake with one concise question at a time and does not present or ask a stacked list of several intake questions in one turn.",
      },
    }
  );
  return {
    simulations: [
      {
        type: "simulation",
        personalityId,
        scenario: {
          name: "MyAIPA EV installation lead comparison",
          instructions: [
            "You are Jordan Lee, a homeowner calling Grimsby Electric about a residential Level 2 EV charger installation.",
            "Agree to the recording when asked.",
            "Provide information only when asked and answer one question at a time.",
            "Your callback number is 905-555-0142.",
            "The installation address is 42 Maple Avenue, Grimsby, Ontario.",
            "You want the installation next month and prefer a callback after 5 PM.",
            "There is no immediate safety issue.",
            "When the assistant summarizes the request, correct any wrong detail.",
            "Explicitly authorize sending the request to the team when asked.",
            "End the conversation after the assistant confirms the handoff.",
          ].join(" "),
          evaluations,
          toolMocks: [
            {
              toolName: summaryToolName,
              result: JSON.stringify({
                ok: true,
                owner: { enabled: true, sent: true },
                customer: { enabled: true, sent: true },
                mocked: true,
              }),
              enabled: true,
            },
          ],
        },
      },
    ],
    target: { type: "assistant", assistantId },
    iterations: 1,
    transport: { provider: mode === "voice" ? "vapi.websocket" : "vapi.webchat" },
  };
}

async function pollRun(runId) {
  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    const run = await request(`/eval/simulation/run/${encodeURIComponent(runId)}`);
    if (run.status === "ended") return run;
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  await request(`/eval/simulation/run/${encodeURIComponent(runId)}`, {
    method: "PATCH",
    body: {},
  }).catch(() => {});
  throw new Error(`Simulation run ${runId} did not finish within ten minutes.`);
}

function evaluationSummary(item) {
  return (item?.results?.evaluations || []).map((evaluation) => ({
    name: evaluation.name || evaluation.structuredOutput?.name || evaluation.structuredOutputId,
    passed: evaluation.passed ?? evaluation.status === "pass",
    extractedValue: evaluation.extractedValue,
    expectedValue: evaluation.expectedValue ?? evaluation.value,
  }));
}

async function execute(label, assistantId) {
  const assistant = await request(`/assistant/${encodeURIComponent(assistantId)}`);
  const created = await request("/eval/simulation/run", { method: "POST", body: runPayload(assistantId) });
  const run = created.status === "ended" ? created : await pollRun(created.id);
  const items = await request(`/eval/simulation/run/${encodeURIComponent(run.id)}/item`);
  const item = Array.isArray(items) ? items[0] : items?.results?.[0] || items?.data?.[0] || {};
  const transcript = String(item?.metadata?.call?.transcript || "").trim();
  return {
    label,
    assistantId,
    model: assistant?.model?.model || "",
    mode,
    runId: run.id,
    status: item.status || run.status,
    endedReason: run.endedReason || item.failureReason || "",
    itemCounts: run.itemCounts || {},
    cost: item.cost ?? run.cost ?? null,
    durationSeconds: item.startedAt && item.completedAt
      ? Math.max(0, (new Date(item.completedAt) - new Date(item.startedAt)) / 1000)
      : null,
    evaluations: evaluationSummary(item),
    transcript,
  };
}

async function main() {
  if (!apiKey) throw new Error("VAPI_API_KEY is not configured.");
  if (!baselineAssistantId || !candidateAssistantId || !["chat", "voice"].includes(mode)) {
    throw new Error(usage());
  }
  console.log(JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    transport: mode,
    baselineAssistantId,
    candidateAssistantId,
    personalityId,
    toolMocked: summaryToolName,
    liveSmsEnabled: false,
  }, null, 2));
  if (!apply) return;
  if (confirmation !== confirmationPhrase) {
    throw new Error(`Refusing to start paid simulations without --confirm=${confirmationPhrase}.`);
  }
  const results = [];
  for (const [label, assistantId] of [
    ["baseline", baselineAssistantId],
    ["candidate", candidateAssistantId],
  ]) {
    try {
      results.push(await execute(label, assistantId));
    } catch (error) {
      results.push({ label, assistantId, mode, error: error.message || String(error) });
    }
  }
  console.log(JSON.stringify({ results }, null, 2));
  if (results.some((result) => result.error)) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
