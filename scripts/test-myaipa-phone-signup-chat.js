const { loadProjectEnv } = require("./_helpers");

const env = loadProjectEnv();
const apiKey = String(env.VAPI_API_KEY || env.VAPI_KEY || env.VAPI_TOKEN || "").trim();
const apiBase = String(env.VAPI_API_BASE_URL || "https://api.vapi.ai").replace(/\/+$/, "");
const promptMarker = "## MY AI PA PHONE SIGNUP: begin_myaipa_signup";
const toolName = "begin_myaipa_signup";

function listFrom(value, keys = []) {
  if (Array.isArray(value)) return value;
  for (const key of ["data", "results", ...keys]) {
    if (Array.isArray(value?.[key])) return value[key];
  }
  return [];
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
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { text }; }
  if (!response.ok) {
    throw new Error(`${method} ${pathname} failed (${response.status}): ${String(payload.message || payload.error || "request failed").slice(0, 300)}`);
  }
  return payload;
}

function systemPrompt(assistant) {
  return String(
    (assistant?.model?.messages || []).find((message) => message?.role === "system")?.content || ""
  );
}

function outputText(chat) {
  return listFrom(chat?.output)
    .map((item) => String(item?.content || item?.message || item?.text || ""))
    .filter(Boolean)
    .join("\n")
    .trim();
}

async function main() {
  if (!apiKey) throw new Error("VAPI_API_KEY is required.");
  const [assistantPage, toolPage] = await Promise.all([
    request("/assistant?limit=1000"),
    request("/tool?limit=1000"),
  ]);
  const assistantSummaries = listFrom(assistantPage, ["assistants"]);
  const tools = listFrom(toolPage, ["tools"]);
  const signupTool = tools.find((tool) =>
    String(tool?.function?.name || tool?.name || "").toLowerCase() === toolName
  );
  if (!signupTool?.id) throw new Error("The live phone-signup tool was not found.");
  const candidates = await Promise.all(
    assistantSummaries
      .filter((entry) => /riley/i.test(String(entry?.name || "")))
      .map((entry) => request(`/assistant/${encodeURIComponent(entry.id)}`))
  );
  const assistant = candidates.find((entry) =>
    systemPrompt(entry).includes(promptMarker)
      && Array.isArray(entry?.model?.toolIds)
      && entry.model.toolIds.map(String).includes(String(signupTool.id))
  );
  if (!assistant) throw new Error("Riley's live phone-signup configuration was not found.");

  const prompt = systemPrompt(assistant);
  const required = signupTool?.function?.parameters?.required || [];
  const configurationChecks = {
    toolAttached: assistant.model.toolIds.map(String).includes(String(signupTool.id)),
    promptInstalled: prompt.includes(promptMarker),
    explicitConfirmationRequired: /explicit yes/i.test(prompt) && required.includes("callerConfirmed") && required.includes("confirmationText"),
    noPaymentCollection: /Never collect card or banking information/i.test(prompt),
    verificationBeforeSetup: /setup does not begin until the owner verifies/i.test(prompt),
    serverConfigured: String(signupTool?.server?.url || "") === "https://api.myaipa.ca/api/webhooks/voice",
  };

  const chat = await request("/chat", {
    method: "POST",
    body: {
      assistantId: assistant.id,
      input: "I want to sign up and start the free trial.",
      name: "myaipa-phone-signup-intent-check",
    },
  });
  const answer = outputText(chat);
  const conversationChecks = {
    explainsFourteenDays: /fourteen[\s-]?day/i.test(answer),
    explainsNoCard: /no (?:credit )?card/i.test(answer),
    explainsSixtyMinutes: /sixty/i.test(answer) && /minute/i.test(answer),
    beginsWithOwnerName: /name/i.test(answer),
    doesNotClaimActivation: !/(?:account|agent|trial).{0,20}(?:is|has been) (?:active|activated|created|ready)/i.test(answer),
  };
  const ok = [...Object.values(configurationChecks), ...Object.values(conversationChecks)].every(Boolean);
  console.log(JSON.stringify({
    ok,
    assistantName: assistant.name || "",
    configurationChecks,
    conversationChecks,
    answer,
  }, null, 2));
  if (!ok) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
