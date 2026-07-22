const { loadProjectEnv } = require("./_helpers");

const env = loadProjectEnv();
const apiBaseUrl = String(env.PUBLIC_API_BASE_URL || env.REACT_APP_API_BASE_URL || "https://api.myaipa.ca").replace(/\/+$/, "");
const adminPassword = String(env.ADMIN_PASSWORD || "").trim();
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

async function getJson(path) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    headers: { "x-admin-password": adminPassword, Accept: "application/json" },
  });
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = {}; }
  if (!response.ok) throw new Error(`${path} failed with HTTP ${response.status}: ${body.error || body.message || "request failed"}`);
  return body;
}

function candidateNumbersIn(value) {
  const matches = new Set();
  function visit(item) {
    if (typeof item === "string" || typeof item === "number") {
      const normalized = normalizePhone(item);
      if (candidates.has(normalized)) matches.add(normalized);
      return;
    }
    if (!item || typeof item !== "object") return;
    if (Array.isArray(item)) item.forEach(visit);
    else Object.values(item).forEach(visit);
  }
  visit(value);
  return [...matches].sort();
}

async function main() {
  if (!adminPassword) throw new Error("ADMIN_PASSWORD is not configured locally.");
  const [setupPayload, mappingPayload, twilioPayload] = await Promise.all([
    getJson("/api/admin/customer-setup"),
    getJson("/api/admin/vapi/mappings"),
    getJson("/api/admin/twilio/numbers?days=365"),
  ]);

  const customers = Array.isArray(setupPayload?.customers) ? setupPayload.customers : [];
  const customerMatches = customers.flatMap((customer) => {
    const numbers = candidateNumbersIn({ twilioPhoneNumber: customer?.twilioPhoneNumber, aiNumbers: customer?.aiNumbers, businessPhone: customer?.businessPhone });
    return numbers.map((number) => ({
      number,
      businessName: String(customer?.businessName || ""),
      status: String(customer?.status || customer?.overallStatus || ""),
      subscriptionStatus: String(customer?.subscriptionStatus || ""),
      callCount: Number(customer?.callCount || 0),
      lastCallAt: customer?.lastCallAt || null,
    }));
  });

  const mappings = Array.isArray(mappingPayload?.mappings) ? mappingPayload.mappings : [];
  const mappingMatches = mappings.filter((mapping) => candidates.has(normalizePhone(mapping?.matchValue))).map((mapping) => ({
    number: normalizePhone(mapping?.matchValue),
    matchType: String(mapping?.matchType || ""),
    label: String(mapping?.label || ""),
    businessName: String(mapping?.business?.name || ""),
    updatedAt: mapping?.updatedAt || null,
  }));

  const inventory = twilioPayload?.inventory || {};
  const numberRows = Array.isArray(inventory?.numbers) ? inventory.numbers : [];
  const twilioMatches = numberRows.filter((row) => candidates.has(normalizePhone(row?.phoneNumber || row?.normalizedPhoneNumber))).map((row) => ({
    number: normalizePhone(row?.phoneNumber || row?.normalizedPhoneNumber),
    status: String(row?.status || ""),
    twilioCalls: Number(row?.twilioCalls || 0),
    appCalls: Number(row?.appCalls || 0),
    lastCallAt: row?.twilioLastCallAt || row?.appLastCallAt || null,
    hasWebhookConfig: Boolean(row?.hasWebhookConfig),
    reasons: Array.isArray(row?.reasons) ? row.reasons : [],
  }));

  console.log(JSON.stringify({
    apiBaseUrl,
    customerSetupSummary: setupPayload?.summary || {},
    customerMatches,
    mappingMatches,
    twilioInventorySummary: inventory?.summary || {},
    twilioMatches,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
