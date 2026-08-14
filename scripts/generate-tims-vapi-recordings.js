const fs = require("fs");
const path = require("path");
const { loadProjectEnv, rootPath } = require("./_helpers");

const env = loadProjectEnv();
const apiKey = String(env.VAPI_API_KEY || "").trim();
const apiBase = String(env.VAPI_API_BASE_URL || "https://api.vapi.ai").replace(/\/+$/, "");
const apply = process.argv.includes("--apply");
const confirmation = process.argv.find((arg) => arg.startsWith("--confirm="))?.split("=").slice(1).join("=") || "";
const onlyScenario = process.argv.find((arg) => arg.startsWith("--only="))?.split("=").slice(1).join("=") || "";
const confirmationPhrase = "CREATE-TIMS-DEMO-RECORDINGS";

const scenariosPath = rootPath("config", "tims-electrical-recording-scenarios.json");
const manifestPath = rootPath("src", "timsElectricalAudioManifest.json");
const audioDir = rootPath("public", "audio", "tims-electrical");
const runDir = rootPath("artifacts", "tims-electrical-vapi-recordings");
const receiverAssistantName = "My AI PA — Tim's Recorded Demo";
const callerAssistantName = "My AI PA — Tim's Scenario Caller";
const receiverPhoneName = "My AI PA Tim's Demo Receiver";
const callerPhoneName = "My AI PA Tim's Demo Caller";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function listFrom(payload, keys = []) {
  if (Array.isArray(payload)) return payload;
  for (const key of keys) if (Array.isArray(payload?.[key])) return payload[key];
  return Array.isArray(payload?.results) ? payload.results : [];
}

async function apiRequest(endpoint, options = {}) {
  if (!apiKey) throw new Error("VAPI_API_KEY is required for live recording generation.");
  const response = await fetch(`${apiBase}${endpoint}`, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(options.timeoutMs || 45000),
  });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  if (!response.ok) {
    const detail = typeof payload === "string" ? payload : JSON.stringify(payload);
    throw new Error(`${options.method || "GET"} ${endpoint} failed (${response.status}): ${detail.slice(0, 500)}`);
  }
  return payload;
}

function receptionistPrompt() {
  return `You are the virtual receptionist in a private, fully synthetic Tim's Electrical demonstration recorded by My AI PA.

PURPOSE
- Show how a concise telephone receptionist handles new installations, repairs, maintenance, unresolved concerns, urgent outages, and genuine safety concerns.
- Everything in these calls is fictional. Never use notification, SMS, transfer, scheduling, or webhook tools.

CONVERSATION
- Sound calm, capable, local, and professional. Ask exactly one short question at a time. Never combine the name, phone, address, timing, or safety questions.
- Do not sound like a text bot. Use natural telephone language and allow interruptions.
- Collect only what is relevant: caller name, trusted callback number, service address and city, work requested or problem, preferred timing, and best callback time.
- Confirm phone numbers and addresses naturally. Do not repeatedly ask for information already supplied.
- Never diagnose electrical work, quote prices, promise service, book work, claim licensing, or promise a response time.
- If this is a repair or outage, ask once about sparks, smoke, fire, burning smells, shock, or immediate danger.

SAFETY
- For sparks, smoke, active fire, shock, or immediate danger, stop ordinary intake. Tell the caller to move to safety, call 911, and avoid touching electrical equipment. State that this demonstration cannot dispatch help. Do not ask more intake questions.

CLOSING
- When enough details are gathered, recap them in two concise sentences and explicitly say: "This demonstration would pass that organized summary to the team."
- Ask whether anything important was missed. If not, thank the caller, let the final sentence finish, then use endCall.
- If the caller says goodbye or clearly ends the call, do not ask another question. Give a short goodbye, let it finish, then use endCall.`;
}

function scenarioCallerPrompt(scenario) {
  const factList = Array.isArray(scenario.facts)
    ? scenario.facts
    : Object.entries(scenario.facts || {}).map(([key, value]) => `${key}: ${value}`);
  const facts = factList.map((fact) => `- ${fact}`).join("\n");
  const opening = scenario.opening || factList[0] || "You have an electrical service question.";
  return `You are playing a fictional customer in a recorded My AI PA demonstration. You are calling a synthetic Tim's Electrical receptionist. Never claim to be a real customer.

SCENARIO: ${scenario.label || scenario.title}
OPENING REQUEST: ${opening}
FICTIONAL FACTS
- Caller name: ${scenario.callerName || "Not provided"}
${facts}

BEHAVIOUR
- Wait for the receptionist to speak first.
- After its greeting, state only the opening request. Then answer every question directly in short, natural sentences using the facts above. If asked for your name, always give the listed caller name.
- If asked for a fact not listed, say you are not sure. Do not invent extra personal information.
- If the receptionist asks about safety, answer exactly from the listed safety facts.
- Do not ask for a price, appointment, transfer, text, or real-world action unless the scenario specifically says so.
- When the receptionist gives an accurate recap and asks if anything was missed, say it covered everything and say goodbye.
- After the receptionist's goodbye, use endCall. Do not start the conversation again.`;
}

function exactDialoguePrompt(scenario, role) {
  const lines = scenario.exactDialogue.map((turn, index) => `${index + 1}. ${turn.role.toUpperCase()}: ${turn.text}`).join("\n");
  const ownedLines = scenario.exactDialogue
    .map((turn, index) => ({ ...turn, index: index + 1 }))
    .filter((turn) => turn.role === role)
    .map((turn) => `- Line ${turn.index}: ${turn.text}`)
    .join("\n");
  const finalInstruction = role === "receptionist"
    ? "After your final line has been fully spoken, remain silent. Do not use endCall; the short silence timeout will close the synthetic call cleanly."
    : "After the receptionist's final line has fully ended, say nothing at all—not even okay, good, thanks, or goodbye. Remain silent while the receptionist ends the call.";

  return `You are the ${role === "receptionist" ? "virtual receptionist" : "fictional caller"} in a private synthetic My AI PA homepage recording. This is a tightly directed voice performance between two Vapi agents. No real customer or business is contacted.

COMPLETE SCRIPT
${lines}

YOUR LINES
${ownedLines}

PERFORMANCE RULES
- Speak only your assigned lines, word for word. Do not add a greeting, filler, confirmation, question, goodbye, disclaimer, or explanation.
- Use warm, natural Canadian telephone delivery. Keep contractions natural and avoid a robotic cadence.
- Listen to the other speaker's full line. Begin your next assigned line promptly, with a short conversational beat rather than a long pause.
- Never talk over the other speaker. Never repeat a line, paraphrase it, or restart the conversation.
- ${finalInstruction}`;
}

function hasExactDialogue(scenario) {
  return Array.isArray(scenario?.exactDialogue) && scenario.exactDialogue.length > 0;
}

function exactDialogueMaxDurationSeconds(scenario) {
  return Math.max(60, (scenario?.exactDialogue?.length || 0) * 12);
}

function rolePrompt(scenario, role) {
  if (hasExactDialogue(scenario)) return exactDialoguePrompt(scenario, role);
  return role === "receptionist" ? receptionistPrompt() : scenarioCallerPrompt(scenario);
}

function firstMessageFor(scenario, role) {
  if (hasExactDialogue(scenario)) {
    const firstTurn = scenario.exactDialogue[0];
    return firstTurn?.role === role ? firstTurn.text : "";
  }
  return role === "receptionist"
    ? "Thanks for calling the Tim's Electrical recorded demonstration. I'm the virtual receptionist. This synthetic call is being recorded. How can I help today?"
    : "";
}

function firstMessageModeFor(scenario, role) {
  if (hasExactDialogue(scenario)) {
    return scenario.exactDialogue[0]?.role === role ? "assistant-speaks-first" : "assistant-waits-for-user";
  }
  return role === "receptionist" ? "assistant-speaks-first" : "assistant-waits-for-user";
}

function assistantPayload({ name, prompt, voiceId, firstMessage, firstMessageMode, endCallToolId, waitSeconds = 0.45, endpointing = 350, maxDurationSeconds = 180, silenceTimeoutSeconds = 20, smartWaitFunction = "", modelName = "gpt-4o-mini", temperature = 0.2 }) {
  return {
    name,
    firstMessage,
    firstMessageMode,
    firstMessageInterruptionsEnabled: false,
    transcriber: { provider: "deepgram", model: "nova-3", language: "en", numerals: true, endpointing },
    model: {
      provider: "openai",
      model: modelName,
      temperature,
      messages: [{ role: "system", content: prompt }],
      toolIds: endCallToolId ? [endCallToolId] : [],
    },
    voice: { provider: "vapi", voiceId, version: 2 },
    backgroundSound: "off",
    voicemailDetection: "off",
    maxDurationSeconds,
    silenceTimeoutSeconds,
    startSpeakingPlan: {
      waitSeconds,
      smartEndpointingPlan: {
        provider: "livekit",
        ...(smartWaitFunction ? { waitFunction: smartWaitFunction } : {}),
      },
    },
    stopSpeakingPlan: { numWords: 6, voiceSeconds: 0.5, backoffSeconds: 2 },
    artifactPlan: {
      recordingEnabled: true,
      loggingEnabled: true,
      pcapEnabled: false,
      transcriptPlan: { enabled: true },
    },
  };
}

async function findEndCallTool() {
  const tools = listFrom(await apiRequest("/tool"), ["tools"]);
  const tool = tools.find((item) => item?.type === "endCall" && item?.id);
  if (!tool) throw new Error("No endCall tool exists in Vapi. Create one before generating recordings.");
  return tool;
}

async function upsertAssistant(existingAssistants, name, payload) {
  const existing = existingAssistants.find((assistant) => String(assistant?.name || "").trim() === name);
  if (existing) {
    const updated = await apiRequest(`/assistant/${encodeURIComponent(existing.id)}`, { method: "PATCH", body: payload });
    console.log(`Updated assistant: ${name}`);
    return updated;
  }
  const created = await apiRequest("/assistant", { method: "POST", body: payload });
  console.log(`Created assistant: ${name}`);
  existingAssistants.push(created);
  return created;
}

async function upsertPhone(existingPhones, name, assistantId) {
  const existing = existingPhones.find((phone) => String(phone?.name || "").trim() === name);
  if (existing) {
    if (assistantId && existing.assistantId !== assistantId) {
      const updated = await apiRequest(`/phone-number/${encodeURIComponent(existing.id)}`, {
        method: "PATCH",
        body: { name, assistantId },
      });
      console.log(`Updated demo phone: ${name}`);
      return updated;
    }
    console.log(`Reusing demo phone: ${name}`);
    return existing;
  }
  const created = await apiRequest("/phone-number", {
    method: "POST",
    body: { provider: "vapi", numberDesiredAreaCode: "716", name, ...(assistantId ? { assistantId } : {}) },
    timeoutMs: 60000,
  });
  console.log(`Created isolated Vapi demo phone: ${name}`);
  existingPhones.push(created);
  return created;
}

async function waitForPhoneActive(phone) {
  const deadline = Date.now() + (6 * 60 * 1000);
  let current = phone;
  while (Date.now() < deadline) {
    if (!current?.status || current.status === "active") return current;
    process.stdout.write(`Waiting for ${current.name || current.number || "demo phone"}: ${current.status}\r`);
    await sleep(15000);
    current = await apiRequest(`/phone-number/${encodeURIComponent(current.id)}`);
  }
  process.stdout.write("\n");
  throw new Error(`${phone.name || phone.number || "Demo phone"} did not become active within six minutes.`);
}

async function waitForCall(callId) {
  const deadline = Date.now() + (4 * 60 * 1000);
  while (Date.now() < deadline) {
    const call = await apiRequest(`/call/${encodeURIComponent(callId)}`);
    process.stdout.write(`  status=${call.status || "unknown"}\r`);
    if (["ended", "failed"].includes(call.status)) {
      process.stdout.write("\n");
      return call;
    }
    await sleep(3500);
  }
  throw new Error(`Timed out waiting for Vapi call ${callId}.`);
}

async function downloadRecording(callId, scenarioId) {
  let lastError = null;
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    try {
      const response = await fetch(`${apiBase}/call/${encodeURIComponent(callId)}/mono-recording`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        redirect: "follow",
        signal: AbortSignal.timeout(60000),
      });
      if (!response.ok) throw new Error(`recording HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length < 1024) throw new Error("recording was unexpectedly small");
      const contentType = String(response.headers.get("content-type") || "").toLowerCase();
      const extension = contentType.includes("mpeg") || bytes.subarray(0, 3).toString("ascii") === "ID3" ? "mp3" : "wav";
      fs.mkdirSync(audioDir, { recursive: true });
      const fileName = `${scenarioId}.${extension}`;
      fs.writeFileSync(path.join(audioDir, fileName), bytes);
      return { fileName, bytes: bytes.length };
    } catch (error) {
      lastError = error;
      if (attempt < 12) await sleep(5000);
    }
  }
  throw new Error(`Recording download failed: ${lastError?.message || "unknown error"}`);
}

function durationSeconds(call) {
  const start = Date.parse(call.startedAt || call.createdAt || "");
  const end = Date.parse(call.endedAt || call.updatedAt || "");
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, Math.round((end - start) / 1000)) : null;
}

function writeRunArtifact(scenario, call) {
  fs.mkdirSync(runDir, { recursive: true });
  const rawMessages = Array.isArray(call?.artifact?.messages) ? call.artifact.messages : call.messages;
  const messages = Array.isArray(rawMessages)
    ? rawMessages.filter((message) => ["assistant", "user"].includes(message?.role)).map((message) => ({
      role: message.role,
      message: message.message || message.content || "",
      secondsFromStart: message.secondsFromStart ?? null,
    }))
    : [];
  fs.writeFileSync(path.join(runDir, `${scenario.id}.json`), `${JSON.stringify({
    scenarioId: scenario.id,
    callId: call.id,
    status: call.status,
    endedReason: call.endedReason || null,
    startedAt: call.startedAt || null,
    endedAt: call.endedAt || null,
    transcript: call.transcript || null,
    messages,
    performanceMetrics: call?.artifact?.performanceMetrics || null,
  }, null, 2)}\n`);
}

async function main() {
  const scenarioConfig = JSON.parse(fs.readFileSync(scenariosPath, "utf8"));
  const allScenarios = Array.isArray(scenarioConfig) ? scenarioConfig : scenarioConfig.scenarios;
  const selectedScenarioIds = onlyScenario.split(",").map((value) => value.trim()).filter(Boolean);
  const scenarios = selectedScenarioIds.length ? allScenarios.filter((scenario) => selectedScenarioIds.includes(scenario.id)) : allScenarios;
  if (!scenarios.length) throw new Error(`No recording scenario matched ${onlyScenario || "the configuration"}.`);

  console.log("Tim's Electrical synthetic Vapi recording generator");
  console.log("=================================================");
  console.log(JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    scenarios: scenarios.map((scenario) => scenario.id),
    createsOrReuses: [receiverAssistantName, callerAssistantName, receiverPhoneName, callerPhoneName],
    liveCustomerData: false,
    smsOrWebhooks: false,
  }, null, 2));

  if (!apply) {
    console.log(`\nDry run only. Use --apply --confirm=${confirmationPhrase} to create calls and recordings.`);
    return;
  }
  if (confirmation !== confirmationPhrase) throw new Error(`Apply mode requires --confirm=${confirmationPhrase}.`);

  const [assistantsPayload, phonesPayload] = await Promise.all([
    apiRequest("/assistant"),
    apiRequest("/phone-number"),
  ]);
  const assistants = listFrom(assistantsPayload, ["assistants"]);
  const phones = listFrom(phonesPayload, ["phoneNumbers", "phone_numbers"]);
  const endCallTool = await findEndCallTool();

  let receiver = await upsertAssistant(assistants, receiverAssistantName, assistantPayload({
    name: receiverAssistantName,
    prompt: rolePrompt(scenarios[0], "receptionist"),
    voiceId: "Jess",
    firstMessage: firstMessageFor(scenarios[0], "receptionist"),
    firstMessageMode: firstMessageModeFor(scenarios[0], "receptionist"),
    endCallToolId: hasExactDialogue(scenarios[0]) ? null : endCallTool.id,
    waitSeconds: hasExactDialogue(scenarios[0]) ? 0.5 : 0.45,
    endpointing: hasExactDialogue(scenarios[0]) ? 500 : 350,
    maxDurationSeconds: hasExactDialogue(scenarios[0]) ? exactDialogueMaxDurationSeconds(scenarios[0]) : 180,
    silenceTimeoutSeconds: hasExactDialogue(scenarios[0]) ? 5 : 20,
    smartWaitFunction: hasExactDialogue(scenarios[0]) ? "4500 / (1 + exp(-10 * (x - 0.5)))" : "",
    modelName: hasExactDialogue(scenarios[0]) ? "gpt-4o" : "gpt-4o-mini",
    temperature: hasExactDialogue(scenarios[0]) ? 0 : 0.2,
  }));
  let caller = await upsertAssistant(assistants, callerAssistantName, assistantPayload({
    name: callerAssistantName,
    prompt: rolePrompt(scenarios[0], "caller"),
    voiceId: "Elliot",
    firstMessage: firstMessageFor(scenarios[0], "caller"),
    firstMessageMode: firstMessageModeFor(scenarios[0], "caller"),
    endCallToolId: hasExactDialogue(scenarios[0]) ? null : endCallTool.id,
    waitSeconds: hasExactDialogue(scenarios[0]) ? 0.6 : 1,
    endpointing: hasExactDialogue(scenarios[0]) ? 500 : 350,
    maxDurationSeconds: hasExactDialogue(scenarios[0]) ? exactDialogueMaxDurationSeconds(scenarios[0]) : 180,
    silenceTimeoutSeconds: hasExactDialogue(scenarios[0]) ? 5 : 20,
    smartWaitFunction: hasExactDialogue(scenarios[0]) ? "4500 / (1 + exp(-10 * (x - 0.5)))" : "",
    modelName: hasExactDialogue(scenarios[0]) ? "gpt-4o" : "gpt-4o-mini",
    temperature: hasExactDialogue(scenarios[0]) ? 0 : 0.2,
  }));

  const receiverPhone = await waitForPhoneActive(await upsertPhone(phones, receiverPhoneName, receiver.id));
  const callerPhone = await waitForPhoneActive(await upsertPhone(phones, callerPhoneName, caller.id));
  if (!receiverPhone?.number || !callerPhone?.id) throw new Error("Vapi did not return usable demo phone records.");

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const runSummary = [];
  for (const scenario of scenarios) {
    receiver = await apiRequest(`/assistant/${encodeURIComponent(receiver.id)}`, {
      method: "PATCH",
      body: assistantPayload({
        name: receiverAssistantName,
        prompt: rolePrompt(scenario, "receptionist"),
        voiceId: "Jess",
        firstMessage: firstMessageFor(scenario, "receptionist"),
        firstMessageMode: firstMessageModeFor(scenario, "receptionist"),
        endCallToolId: hasExactDialogue(scenario) ? null : endCallTool.id,
        waitSeconds: hasExactDialogue(scenario) ? 0.5 : 0.45,
        endpointing: hasExactDialogue(scenario) ? 500 : 350,
        maxDurationSeconds: hasExactDialogue(scenario) ? exactDialogueMaxDurationSeconds(scenario) : 180,
        silenceTimeoutSeconds: hasExactDialogue(scenario) ? 5 : 20,
        smartWaitFunction: hasExactDialogue(scenario) ? "4500 / (1 + exp(-10 * (x - 0.5)))" : "",
        modelName: hasExactDialogue(scenario) ? "gpt-4o" : "gpt-4o-mini",
        temperature: hasExactDialogue(scenario) ? 0 : 0.2,
      }),
    });
    caller = await apiRequest(`/assistant/${encodeURIComponent(caller.id)}`, {
      method: "PATCH",
      body: assistantPayload({
        name: callerAssistantName,
        prompt: rolePrompt(scenario, "caller"),
        voiceId: "Elliot",
        firstMessage: firstMessageFor(scenario, "caller"),
        firstMessageMode: firstMessageModeFor(scenario, "caller"),
        endCallToolId: hasExactDialogue(scenario) ? null : endCallTool.id,
        waitSeconds: hasExactDialogue(scenario) ? 0.6 : 1,
        endpointing: hasExactDialogue(scenario) ? 500 : 350,
        maxDurationSeconds: hasExactDialogue(scenario) ? exactDialogueMaxDurationSeconds(scenario) : 180,
        silenceTimeoutSeconds: hasExactDialogue(scenario) ? 5 : 20,
        smartWaitFunction: hasExactDialogue(scenario) ? "4500 / (1 + exp(-10 * (x - 0.5)))" : "",
        modelName: hasExactDialogue(scenario) ? "gpt-4o" : "gpt-4o-mini",
        temperature: hasExactDialogue(scenario) ? 0 : 0.2,
      }),
    });
    console.log(`\nStarting scenario: ${scenario.id}`);
    let call;
    try {
      call = await apiRequest("/call", {
        method: "POST",
        body: {
          name: `Tim's demo — ${scenario.id}`,
          assistantId: caller.id,
          phoneNumberId: callerPhone.id,
          customer: { number: receiverPhone.number },
        },
        timeoutMs: 60000,
      });
    } catch (error) {
      if (/not active|not functional|not ready|phone/i.test(error.message)) {
        console.log("Demo phone is still activating; waiting 75 seconds before one retry.");
        await sleep(75000);
        call = await apiRequest("/call", {
          method: "POST",
          body: { name: `Tim's demo — ${scenario.id}`, assistantId: caller.id, phoneNumberId: callerPhone.id, customer: { number: receiverPhone.number } },
          timeoutMs: 60000,
        });
      } else {
        throw error;
      }
    }
    const completed = await waitForCall(call.id);
    writeRunArtifact(scenario, completed);
    const recording = await downloadRecording(completed.id, scenario.id);
    const duration = durationSeconds(completed);
    manifest[scenario.id] = {
      status: "available",
      src: `/audio/tims-electrical/${recording.fileName}`,
      durationSeconds: duration,
      source: "synthetic-vapi-agents",
      recordedAt: completed.endedAt || new Date().toISOString(),
      disclosure: "Synthetic demonstration call recorded between two Vapi agents; no real customer information.",
    };
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    runSummary.push({
      scenario: scenario.id,
      status: completed.status,
      endedReason: completed.endedReason || null,
      durationSeconds: duration,
      audio: `public/audio/tims-electrical/${recording.fileName}`,
      bytes: recording.bytes,
    });
    console.log(`Saved ${recording.fileName} (${recording.bytes} bytes).`);
  }

  console.log("\nRecording run complete");
  console.log(JSON.stringify(runSummary, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
