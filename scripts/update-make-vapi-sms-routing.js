const { loadProjectEnv, redact } = require("./_helpers");
const {
  POST_SEND_CLOSING_MARKER,
  postSendClosingPrompt,
  removeLegacyAbruptClosingInstructions,
} = require("../server/compositeCallNotifications");

const env = loadProjectEnv();
const MAKE_API_BASE_URL = env.MAKE_API_BASE_URL || "https://us2.make.com/api/v2";
const MAKE_SCENARIO_ID = env.MAKE_SCENARIO_ID || "3530157";
const MAKE_ASSISTANT_MODULE_ID = Number(env.MAKE_ASSISTANT_MODULE_ID || 25);
const MAKE_API_TOKEN = env.MAKE_API_TOKEN || env.MAKE_TOKEN || env.MAKE_API_KEY || "";
const apply = process.argv.includes("--apply");

const START_MARKER = "## MYAIPA SMS ROUTING (DO NOT GUESS)";
const END_MARKER = "## END MYAIPA SMS ROUTING";
const ROUTING_BLOCK = [
  START_MARKER,
  "- Assigned AI/Twilio sender number: {{9.data.phone_number}}",
  "- Owner notification number: {{21.setupDetails.ownerPhone}}",
  "- For both SMS tools, pass the assigned sender number above as fromNumber.",
  "- For send_owner_sms_dynamic, pass the owner notification number above as toNumber.",
  "- Never substitute a placeholder, example number, caller number, or another customer's number.",
  postSendClosingPrompt(),
  END_MARKER,
].join("\n");

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function upsertRoutingBlock(prompt) {
  const withoutExisting = removeLegacyAbruptClosingInstructions(String(prompt || "")
    .replace(new RegExp(`${escapeRegExp(START_MARKER)}[\\s\\S]*?${escapeRegExp(END_MARKER)}`, "g"), "")
    .trim());
  return `${withoutExisting}\n\n${ROUTING_BLOCK}`;
}

async function requestJson(path, options = {}) {
  const response = await fetch(`${MAKE_API_BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Token ${MAKE_API_TOKEN}`,
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  if (!response.ok) throw new Error(`Make API ${options.method || "GET"} ${path} failed with HTTP ${response.status}.`);
  return data;
}

function updateBlueprint(data) {
  const blueprint = data.response?.blueprint;
  if (!blueprint || !Array.isArray(blueprint.flow)) throw new Error("Make blueprint flow was not returned.");
  const module = blueprint.flow.find((item) => Number(item.id) === MAKE_ASSISTANT_MODULE_ID);
  if (!module?.mapper?.body) throw new Error(`Make assistant module ${MAKE_ASSISTANT_MODULE_ID} was not found.`);
  const body = JSON.parse(module.mapper.body);
  const messages = body.model?.messages;
  if (!Array.isArray(messages)) throw new Error("The Make assistant body has no model messages.");
  const system = messages.find((message) => message.role === "system");
  if (!system) throw new Error("The Make assistant body has no system prompt.");
  system.content = upsertRoutingBlock(system.content);
  module.mapper.body = JSON.stringify(body);
  return blueprint;
}

function verifyBlueprint(data) {
  const module = data.response?.blueprint?.flow?.find((item) => Number(item.id) === MAKE_ASSISTANT_MODULE_ID);
  const body = module?.mapper?.body ? JSON.parse(module.mapper.body) : {};
  const prompt = body.model?.messages?.find((message) => message.role === "system")?.content || "";
  return {
    senderNumberMapped: prompt.includes("Assigned AI/Twilio sender number: {{9.data.phone_number}}"),
    ownerNumberMapped: prompt.includes("Owner notification number: {{21.setupDetails.ownerPhone}}"),
    naturalPostSendClosingMapped: prompt.includes(POST_SEND_CLOSING_MARKER)
      && prompt.includes("I've sent your information to the team. Someone will contact you to discuss the request and arrange the next step.")
      && prompt.includes("Let the entire final sentence finish before calling endCall"),
  };
}

async function main() {
  if (!MAKE_API_TOKEN) throw new Error("Set MAKE_API_TOKEN, MAKE_TOKEN, or MAKE_API_KEY.");
  const current = await requestJson(`/scenarios/${MAKE_SCENARIO_ID}/blueprint`);
  const blueprint = updateBlueprint(current);

  if (!apply) {
    console.log(`Dry run: scenario ${MAKE_SCENARIO_ID}, module ${MAKE_ASSISTANT_MODULE_ID} is ready to update.`);
    console.log("Run with --apply to publish the routing fix to Make.");
    return;
  }

  await requestJson(`/scenarios/${MAKE_SCENARIO_ID}`, {
    method: "PATCH",
    body: JSON.stringify({ blueprint: JSON.stringify(blueprint) }),
  });
  const verified = verifyBlueprint(await requestJson(`/scenarios/${MAKE_SCENARIO_ID}/blueprint`));
  if (!verified.senderNumberMapped || !verified.ownerNumberMapped || !verified.naturalPostSendClosingMapped) {
    throw new Error("Make accepted the update, but the SMS routing or natural closing instructions did not verify.");
  }
  console.log(`Updated Make scenario ${MAKE_SCENARIO_ID}, module ${MAKE_ASSISTANT_MODULE_ID}.`);
  console.log(`Make API token: ${redact(MAKE_API_TOKEN)}`);
  console.log("Verified: assigned AI sender, owner notification, and natural post-send closing instructions are present.");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
