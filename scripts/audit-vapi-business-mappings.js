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

const NON_CUSTOMER_PATTERNS = [
  /\bcanary\b/i,
  /\bsynthetic\b/i,
  /\bscenario caller\b/i,
  /\brecorded demo\b/i,
  /\bprivate demo\b/i,
  /\bpricing test\b/i,
  /\bsandbox\b/i,
  /\btest only\b/i,
  /\bcontrolled qa\b/i,
  /(?:^|\n)my ai pa(?:\n|$)/i,
];

function classifyInventoryPurpose(...values) {
  const evidence = values.map((value) => String(value || "").trim()).filter(Boolean).join("\n");
  return NON_CUSTOMER_PATTERNS.some((pattern) => pattern.test(evidence))
    ? "non_customer"
    : "customer_or_unknown";
}

function buildMappingReadinessReport({ phones = [], assistants = [], mappings = [], businesses = [], customerAccounts = [], warnings = [] }) {
  const mappedValues = mappingValueSet(mappings);
  const assistantsById = new Map(assistants.map((assistant) => [String(assistant.id || ""), assistant]));
  const businessesByPhone = new Map(
    businesses
      .map((business) => [normalizePhone(business?.phone), business])
      .filter(([phone]) => phone)
  );
  const accountStateByBusinessName = new Map();
  for (const account of customerAccounts) {
    const name = String(account?.businessName || account?.name || "").trim().toLowerCase();
    if (!name) continue;
    const payment = String(account?.paymentStatus || account?.subscriptionStatus || account?.trial?.status || "").trim().toLowerCase();
    const setup = String(account?.setupStatus || account?.status || "").trim().toLowerCase();
    const current = accountStateByBusinessName.get(name) || [];
    current.push({ payment, setup });
    accountStateByBusinessName.set(name, current);
  }

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
    const mappedBusiness = phone.mappedBusiness || assistant?.mappedBusiness || businessPhoneMatch || null;
    const businessName = String(mappedBusiness?.name || mappedBusiness?.businessName || "").trim();
    const accountStates = accountStateByBusinessName.get(businessName.toLowerCase()) || [];
    const expectedActive = accountStates.some((state) => ["active", "trialing"].includes(state.payment));
    const explicitlyPaused = accountStates.length > 0 && !expectedActive && accountStates.every((state) => (
      /paused|unpaid|canceled|cancelled|incomplete_expired/.test(state.payment)
      || /subscription_paused|abandoned_archived/.test(state.setup)
    ));
    const serviceState = expectedActive ? "expected_active" : explicitlyPaused ? "paused" : "unknown";
    const purpose = classifyInventoryPurpose(
      phone.name,
      phone.assistantName,
      assistant?.name,
      assistant?.firstMessage,
      businessName,
    );
    return {
      phoneId: safeId(id),
      phone: safePhone(number),
      assistantId: safeId(assistantId),
      assistantName: String(phone.assistantName || assistant?.name || "").slice(0, 120),
      business: businessName,
      purpose,
      serviceState,
      routeMode: String(phone.routeMode || "unknown"),
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
      purpose: classifyInventoryPurpose(assistant.name, assistant.firstMessage),
      mapped: Boolean(
        assistant.mappedBusiness ||
        mappedValues.has(String(assistant.id || "").trim().toLowerCase())
      ),
      business: assistant.mappedBusiness?.name || "",
    }));

  const customerPhones = phoneCoverage.filter((phone) => phone.purpose === "customer_or_unknown");
  const nonCustomerPhones = phoneCoverage.filter((phone) => phone.purpose === "non_customer");
  const unmappedPhones = customerPhones.filter((phone) => !phone.effectivelyMapped);
  const customerPhonesWithoutAssistants = customerPhones.filter((phone) => (
    !phone.assistantId && phone.routeMode !== "trial_gate" && phone.serviceState !== "paused"
  ));
  const pausedCustomerPhonesWithoutAssistants = customerPhones.filter((phone) => (
    !phone.assistantId && phone.routeMode !== "trial_gate" && phone.serviceState === "paused"
  ));
  const trialGatedCustomerPhones = customerPhones.filter((phone) => phone.routeMode === "trial_gate");
  const unmappedAttachedAssistants = attachedAssistants.filter((assistant) => (
    assistant.purpose === "customer_or_unknown" && !assistant.mapped
  ));
  const nonCustomerUnmappedPhones = nonCustomerPhones.filter((phone) => !phone.effectivelyMapped);

  return {
    checkedAt: new Date().toISOString(),
    policy: "Customer calls must match a trusted phone, assistant, metadata, or business-number mapping. Demos and canaries are reported separately and never treated as customer-ready.",
    summary: {
      phoneNumbers: phones.length,
      customerOrUnknownPhoneNumbers: customerPhones.length,
      nonCustomerPhoneNumbers: nonCustomerPhones.length,
      assignedPhoneNumbers: phoneCoverage.filter((phone) => phone.assistantId).length,
      effectivelyMappedCustomerPhones: customerPhones.filter((phone) => phone.effectivelyMapped).length,
      unmappedCustomerPhones: unmappedPhones.length,
      customerPhonesWithoutAssistants: customerPhonesWithoutAssistants.length,
      pausedCustomerPhonesWithoutAssistants: pausedCustomerPhonesWithoutAssistants.length,
      trialGatedCustomerPhones: trialGatedCustomerPhones.length,
      unmappedNonCustomerPhones: nonCustomerUnmappedPhones.length,
      attachedAssistants: attachedAssistants.length,
      unmappedCustomerAssistants: unmappedAttachedAssistants.length,
      databaseMappings: mappings.length,
      providerWarnings: warnings.length,
    },
    ready: unmappedPhones.length === 0
      && unmappedAttachedAssistants.length === 0
      && customerPhonesWithoutAssistants.length === 0,
    unmappedPhones,
    customerPhonesWithoutAssistants,
    pausedCustomerPhonesWithoutAssistants,
    trialGatedCustomerPhones,
    unmappedAttachedAssistants,
    nonCustomerUnmappedPhones,
    phoneCoverage,
    providerWarnings: warnings,
  };
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

  const [inventoryPayload, mappingPayload, customerSetupPayload] = await Promise.all([
    getJson("/api/admin/vapi/inventory"),
    getJson("/api/admin/vapi/mappings"),
    getJson("/api/admin/customer-setup"),
  ]);
  const inventory = inventoryPayload.inventory || {};
  const phones = Array.isArray(inventory.phoneNumbers) ? inventory.phoneNumbers : [];
  const assistants = Array.isArray(inventory.assistants) ? inventory.assistants : [];
  const mappings = Array.isArray(mappingPayload.mappings) ? mappingPayload.mappings : [];
  const businesses = Array.isArray(mappingPayload.businesses) ? mappingPayload.businesses : [];
  const report = {
    apiBaseUrl,
    ...buildMappingReadinessReport({
      phones,
      assistants,
      mappings,
      businesses,
      customerAccounts: Array.isArray(customerSetupPayload.customers) ? customerSetupPayload.customers : [],
      warnings: Array.isArray(inventory.warnings) ? inventory.warnings : [],
    }),
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

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}

module.exports = {
  buildMappingReadinessReport,
  classifyInventoryPurpose,
  normalizePhone,
};
