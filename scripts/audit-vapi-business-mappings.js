const fs = require("fs");
const path = require("path");
const { loadProjectEnv, rootPath } = require("./_helpers");

const env = loadProjectEnv();
const apiBaseUrl = String(
  env.PUBLIC_API_BASE_URL || env.REACT_APP_API_BASE_URL || "https://api.myaipa.ca"
).replace(/\/+$/, "");
const adminPassword = String(env.ADMIN_PASSWORD || "").trim();
const outputArgIndex = process.argv.indexOf("--out");
const outputPath = outputArgIndex >= 0 ? process.argv[outputArgIndex + 1] : "";

function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 10) return `1${digits}`;
  return digits;
}

function safeId(value) {
  const id = String(value || "").trim();
  return id ? `${id.slice(0, 6)}…${id.slice(-4)}` : "";
}

function safePhone(value) {
  const phone = normalizePhone(value);
  return phone ? `•••${phone.slice(-4)}` : "";
}

async function getJson(route) {
  const response = await fetch(`${apiBaseUrl}${route}`, {
    headers: {
      Accept: "application/json",
      "x-admin-password": adminPassword,
    },
  });
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${route} returned invalid JSON.`);
  }
  if (!response.ok) {
    throw new Error(`${route} failed with HTTP ${response.status}: ${body.error || "request failed"}`);
  }
  return body;
}

function mappingValueSet(mappings) {
  return new Set(
    mappings
      .map((mapping) => String(mapping?.matchValue || "").trim().toLowerCase())
      .filter(Boolean)
  );
}

async function main() {
  if (!adminPassword) throw new Error("ADMIN_PASSWORD is not configured locally.");

  const [inventoryPayload, mappingPayload] = await Promise.all([
    getJson("/api/admin/vapi/inventory"),
    getJson("/api/admin/vapi/mappings"),
  ]);
  const inventory = inventoryPayload.inventory || {};
  const phones = Array.isArray(inventory.phoneNumbers) ? inventory.phoneNumbers : [];
  const assistants = Array.isArray(inventory.assistants) ? inventory.assistants : [];
  const mappings = Array.isArray(mappingPayload.mappings) ? mappingPayload.mappings : [];
  const businesses = Array.isArray(mappingPayload.businesses) ? mappingPayload.businesses : [];
  const mappedValues = mappingValueSet(mappings);
  const assistantsById = new Map(assistants.map((assistant) => [String(assistant.id || ""), assistant]));
  const businessesByPhone = new Map(
    businesses
      .map((business) => [normalizePhone(business?.phone), business])
      .filter(([phone]) => phone)
  );

  const phoneCoverage = phones.map((phone) => {
    const id = String(phone.id || "").trim();
    const number = normalizePhone(phone.number);
    const assistantId = String(phone.assistantId || "").trim();
    const assistant = assistantsById.get(assistantId);
    const directPhoneMapping = Boolean(
      phone.mappedBusiness ||
      mappedValues.has(id.toLowerCase()) ||
      (number && mappedValues.has(number.toLowerCase()))
    );
    const assistantMapping = Boolean(
      assistant?.mappedBusiness ||
      (assistantId && mappedValues.has(assistantId.toLowerCase()))
    );
    const businessPhoneMatch = businessesByPhone.get(number);
    return {
      phoneId: safeId(id),
      phone: safePhone(number),
      assistantId: safeId(assistantId),
      assistantName: String(phone.assistantName || assistant?.name || "").slice(0, 120),
      business:
        phone.mappedBusiness?.name ||
        assistant?.mappedBusiness?.name ||
        businessPhoneMatch?.name ||
        "",
      directPhoneMapping,
      assistantMapping,
      businessPhoneFallback: Boolean(businessPhoneMatch),
      effectivelyMapped: directPhoneMapping || assistantMapping || Boolean(businessPhoneMatch),
    };
  });

  const activeAssistantIds = new Set(
    phones.map((phone) => String(phone.assistantId || "").trim()).filter(Boolean)
  );
  const attachedAssistants = assistants
    .filter((assistant) => activeAssistantIds.has(String(assistant.id || "").trim()))
    .map((assistant) => ({
      assistantId: safeId(assistant.id),
      name: String(assistant.name || "").slice(0, 120),
      phoneCount: Array.isArray(assistant.phoneNumbers) ? assistant.phoneNumbers.length : 0,
      mapped: Boolean(
        assistant.mappedBusiness ||
        mappedValues.has(String(assistant.id || "").trim().toLowerCase())
      ),
      business: assistant.mappedBusiness?.name || "",
    }));

  const unmappedPhones = phoneCoverage.filter((phone) => !phone.effectivelyMapped);
  const unmappedAttachedAssistants = attachedAssistants.filter((assistant) => !assistant.mapped);
  const report = {
    checkedAt: new Date().toISOString(),
    apiBaseUrl,
    policy: "Calls must match a trusted phone, assistant, metadata, or business-number mapping. No default tenant guessing.",
    summary: {
      phoneNumbers: phones.length,
      assignedPhoneNumbers: phoneCoverage.filter((phone) => phone.assistantId).length,
      effectivelyMappedPhoneNumbers: phoneCoverage.filter((phone) => phone.effectivelyMapped).length,
      unmappedPhoneNumbers: unmappedPhones.length,
      attachedAssistants: attachedAssistants.length,
      unmappedAttachedAssistants: unmappedAttachedAssistants.length,
      databaseMappings: mappings.length,
      providerWarnings: Array.isArray(inventory.warnings) ? inventory.warnings.length : 0,
    },
    ready: unmappedPhones.length === 0 && unmappedAttachedAssistants.length === 0,
    unmappedPhones,
    unmappedAttachedAssistants,
    phoneCoverage,
    providerWarnings: Array.isArray(inventory.warnings) ? inventory.warnings : [],
  };

  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (outputPath) {
    const finalPath = rootPath(outputPath);
    fs.mkdirSync(path.dirname(finalPath), { recursive: true });
    fs.writeFileSync(finalPath, json);
    console.log(`Vapi mapping audit written to ${finalPath}`);
  }
  console.log(json.trim());
  if (!report.ready) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
