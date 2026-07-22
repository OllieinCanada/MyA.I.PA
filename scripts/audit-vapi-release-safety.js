const crypto = require("crypto");
const { loadProjectEnv } = require("./_helpers");

const env = loadProjectEnv();
const apiKey = String(env.VAPI_API_KEY || env.VAPI_KEY || env.VAPI_TOKEN || "").trim();
const baseUrl = String(env.VAPI_API_BASE_URL || "https://api.vapi.ai").replace(/\/+$/, "");
const includeAll = process.argv.includes("--all");
const candidates = new Set([
  "+12492021724", "+12492092994", "+12492942573", "+12492947547", "+12494020467", "+12494023117", "+12494024844",
  "+12494025367", "+12494026945", "+12494027114", "+12494029111", "+12494212544", "+12494213497", "+12494217616",
  "+12494217750", "+12494219002", "+12494219856", "+12494443364", "+12494683413", "+12494683936", "+12494683961",
  "+12494687285", "+12494753155", "+12494810811", "+12494814884", "+12494865572", "+12494915023", "+12494936834",
  "+12494956464", "+12495004574", "+12495033725", "+12495040274", "+12495054889", "+12495069259", "+12495232223",
  "+12495280178", "+12495290194", "+12495592388", "+12497008891", "+12497021521", "+12497035723", "+12498060615",
  "+12498065190", "+13656755015", "+17754168362",
]);

function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length === 10 ? `+1${digits}` : digits ? `+${digits}` : "";
}

function listFrom(value, keys = []) {
  if (Array.isArray(value)) return value;
  for (const key of ["data", "results", ...keys]) if (Array.isArray(value?.[key])) return value[key];
  return [];
}

function shortHash(value) {
  return value ? crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 12) : "";
}

async function getJson(path) {
  const response = await fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } });
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = {}; }
  if (!response.ok) throw new Error(`Vapi ${path} failed with HTTP ${response.status}: ${body.message || body.error || "request failed"}`);
  return body;
}

function assistantToolIds(assistant) {
  return [...new Set([
    ...(Array.isArray(assistant?.model?.toolIds) ? assistant.model.toolIds : []),
    ...(Array.isArray(assistant?.toolIds) ? assistant.toolIds : []),
  ].map(String).filter(Boolean))];
}

function environmentMap(tool) {
  const entries = Array.isArray(tool?.environmentVariables) ? tool.environmentVariables : [];
  return Object.fromEntries(entries.map((item) => [String(item?.name || ""), String(item?.value || "")]).filter(([name]) => name));
}

function ownerEvidence(tools) {
  const evidence = [];
  for (const tool of tools) {
    const toolName = String(tool?.function?.name || tool?.name || "");
    const values = environmentMap(tool);
    for (const key of ["DEFAULT_OWNER_TO_NUMBER", "OWNER_TO_NUMBER", "OWNER_PHONE", "DEFAULT_TO_NUMBER"]) {
      const number = normalizePhone(values[key]);
      if (!number) continue;
      evidence.push({ toolName, envName: key, ownerLast4: number.slice(-4), ownerHash: shortHash(number) });
    }
  }
  return evidence;
}

async function main() {
  if (!apiKey) throw new Error("VAPI_API_KEY is not configured.");
  const [phonePayload, assistantPayload] = await Promise.all([
    getJson("/phone-number?limit=1000"),
    getJson("/assistant?limit=1000"),
  ]);
  const phones = listFrom(phonePayload, ["phoneNumbers", "phone_numbers"]);
  const assistants = listFrom(assistantPayload, ["assistants"]);
  const assistantSummaries = new Map(assistants.map((item) => [String(item?.id || ""), item]));
  const candidatePhones = includeAll
    ? phones
    : phones.filter((phone) => candidates.has(normalizePhone(phone?.number || phone?.phoneNumber || phone?.twilioPhoneNumber || phone?.providerResourceId)));
  const assistantIds = [...new Set(candidatePhones.map((phone) => String(phone?.assistantId || phone?.assistant?.id || "")).filter(Boolean))];
  const assistantDetails = await Promise.all(assistantIds.map(async (id) => {
    const summary = assistantSummaries.get(id) || {};
    try { return await getJson(`/assistant/${encodeURIComponent(id)}`); } catch { return summary; }
  }));
  const assistantById = new Map(assistantDetails.map((item) => [String(item?.id || ""), item]));
  const toolIds = [...new Set(assistantDetails.flatMap(assistantToolIds))];
  const toolDetails = await Promise.all(toolIds.map(async (id) => {
    try { return await getJson(`/tool/${encodeURIComponent(id)}`); } catch { return { id }; }
  }));
  const toolById = new Map(toolDetails.map((item) => [String(item?.id || ""), item]));

  const rows = candidatePhones.map((phone) => {
    const number = normalizePhone(phone?.number || phone?.phoneNumber || phone?.twilioPhoneNumber || phone?.providerResourceId);
    const assistantId = String(phone?.assistantId || phone?.assistant?.id || "");
    const assistant = assistantById.get(assistantId) || assistantSummaries.get(assistantId) || {};
    const tools = assistantToolIds(assistant).map((id) => toolById.get(id)).filter(Boolean);
    return {
      number,
      vapiPhoneName: String(phone?.name || phone?.friendlyName || ""),
      importedAt: phone?.createdAt || phone?.created_at || null,
      assistantIdHash: shortHash(assistantId),
      assistantName: String(assistant?.name || phone?.assistant?.name || ""),
      assistantCreatedAt: assistant?.createdAt || assistant?.created_at || null,
      firstMessage: String(assistant?.firstMessage || "").slice(0, 240),
      toolNames: tools.map((tool) => String(tool?.function?.name || tool?.name || "")).filter(Boolean),
      ownerEvidence: ownerEvidence(tools),
    };
  }).sort((left, right) => left.number.localeCompare(right.number));

  console.log(JSON.stringify({ mode: includeAll ? "all" : "candidates", candidateCount: candidates.size, vapiAssignedCandidateCount: rows.length, rows }, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
