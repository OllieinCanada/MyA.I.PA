const crypto = require("crypto");
const { loadProjectEnv } = require("./_helpers");
const { normalizeE164 } = require("../server/compositeCallNotifications");

const env = loadProjectEnv();
const apiKey = String(env.VAPI_API_KEY || env.VAPI_KEY || env.VAPI_TOKEN || "").trim();
const apiBase = String(env.VAPI_API_BASE_URL || "https://api.vapi.ai").trim().replace(/\/+$/, "");
const sourcePhoneNumber = normalizeE164(env.VAPI_PREVIEW_VOICE_SOURCE_PHONE || "+12494956809");
const previewName = "My AI PA Signup Preview";
const apply = process.argv.includes("--apply");
const confirmation = process.argv.find((arg) => arg.startsWith("--confirm="))?.slice(10) || "";
const confirmationPhrase = "MYAIPA-SIGNUP-PREVIEW";

function listFrom(value, keys = []) {
  if (Array.isArray(value)) return value;
  for (const key of ["data", "results", ...keys]) {
    if (Array.isArray(value?.[key])) return value[key];
  }
  return [];
}

function phoneNumber(record) {
  return normalizeE164(record?.number || record?.phoneNumber || record?.twilioPhoneNumber || record?.providerResourceId);
}

function hash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 12);
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
    payload = {};
  }
  if (!response.ok) {
    throw new Error(`${method} ${pathname} failed with HTTP ${response.status}: ${payload.message || payload.error || "request failed"}`);
  }
  return payload;
}

function buildPreviewPayload(sourceAssistant) {
  if (!sourceAssistant?.voice) throw new Error("The source assistant has no voice configuration to clone.");
  if (!sourceAssistant?.transcriber) throw new Error("The source assistant has no transcriber configuration to clone.");
  return {
    name: previewName,
    firstMessage: "Hi, thanks for calling {{businessName}}. How can I help you today?",
    firstMessageMode: "assistant-speaks-first",
    firstMessageInterruptionsEnabled: true,
    transcriber: sourceAssistant.transcriber,
    voice: sourceAssistant.voice,
    model: {
      provider: "openai",
      model: "gpt-4o-mini",
      temperature: 0.25,
      messages: [
        {
          role: "system",
          content: [
            "You are the safe, short My AI PA signup preview for {{businessName}}, a {{trade}} serving {{serviceArea}}.",
            "This is only a website demonstration. Answer one simple customer-style question naturally in no more than 25 words.",
            "Do not book appointments, send messages, call tools, collect contact details, promise follow-up, or claim any action was completed.",
            "If asked to perform an action, say this is a short preview and the full assistant can be configured after signup.",
            "Remain friendly, professional, and concise.",
          ].join(" "),
        },
      ],
      tools: [],
    },
    maxDurationSeconds: 30,
    backgroundSound: "off",
    voicemailDetection: "off",
    artifactPlan: {
      recordingEnabled: false,
      videoRecordingEnabled: false,
      pcapEnabled: false,
    },
  };
}

async function main() {
  if (!apiKey) throw new Error("VAPI_API_KEY is required.");

  const [phonesPayload, assistantsPayload] = await Promise.all([
    request("/phone-number"),
    request("/assistant"),
  ]);
  const phones = listFrom(phonesPayload, ["phoneNumbers", "phone_numbers"]);
  const assistants = listFrom(assistantsPayload, ["assistants", "agents"]);
  const sourcePhone = phones.find((record) => phoneNumber(record) === sourcePhoneNumber);
  const namedSourceAssistant = assistants.find((assistant) => /grimsby\s+electric/i.test(String(assistant?.name || "")));
  const sourceAssistantId = String(
    sourcePhone?.assistantId
    || sourcePhone?.assistant?.id
    || namedSourceAssistant?.id
    || ""
  ).trim();
  if (!sourceAssistantId) throw new Error(`No Vapi source assistant was found for ${sourcePhoneNumber} or Grimsby Electric.`);
  const sourceAssistant = await request(`/assistant/${encodeURIComponent(sourceAssistantId)}`);
  const existing = assistants.find((assistant) => String(assistant?.name || "").trim() === previewName);
  const desired = buildPreviewPayload(sourceAssistant);

  console.log("My AI PA signup preview assistant");
  console.log("=================================");
  console.log(JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    action: existing ? "update" : "create",
    sourcePhoneLast4: sourcePhoneNumber.slice(-4),
    sourceAssistantIdHash: hash(sourceAssistantId),
    previewAssistantId: existing?.id || "",
    previewName,
    maxDurationSeconds: desired.maxDurationSeconds,
    recordingEnabled: desired.artifactPlan.recordingEnabled,
    toolCount: desired.model.tools.length,
  }, null, 2));

  if (!apply) {
    console.log(`Dry run only. Re-run with --apply --confirm=${confirmationPhrase}.`);
    return;
  }
  if (confirmation !== confirmationPhrase) {
    throw new Error(`Refusing to mutate Vapi without --confirm=${confirmationPhrase}.`);
  }

  const saved = existing
    ? await request(`/assistant/${encodeURIComponent(existing.id)}`, { method: "PATCH", body: desired })
    : await request("/assistant", { method: "POST", body: desired });
  const verified = await request(`/assistant/${encodeURIComponent(saved.id)}`);
  const toolCount = Array.isArray(verified?.model?.tools) ? verified.model.tools.length : 0;
  if (toolCount !== 0 || verified?.artifactPlan?.recordingEnabled !== false || Number(verified?.maxDurationSeconds) !== 30) {
    throw new Error("Vapi preview assistant read-back failed its safety checks.");
  }

  console.log(JSON.stringify({
    status: "configured",
    assistantId: String(verified.id),
    name: verified.name,
    maxDurationSeconds: verified.maxDurationSeconds,
    recordingEnabled: verified.artifactPlan.recordingEnabled,
    toolCount,
  }, null, 2));
  console.log("Set VAPI_PREVIEW_ASSISTANT_ID to the assistantId above in Render.");
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
