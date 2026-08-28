const {
  buildProvisioningAccountKey,
  buildProvisioningResourceName,
} = require("./signupProvisioning");

const PROVISIONING_STAGES = Object.freeze([
  "twilio-number",
  "vapi-assistant",
  "vapi-import",
]);

function reconciliationError(message, code, statusCode = 409, provider = "") {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  if (provider) error.provider = provider;
  return error;
}

function getSignupProvisioningIdentity(signup = {}) {
  const ownerEmail = String(signup.ownerEmail || "").trim().toLowerCase();
  const ownerPhone = String(signup.ownerPhone || signup.businessPhone || "").trim();
  let accountKey;
  try {
    accountKey = buildProvisioningAccountKey(ownerEmail, ownerPhone);
  } catch (_error) {
    throw reconciliationError(
      "The duplicate signup does not have enough verified identity data for a safe provider reconciliation.",
      "SIGNUP_SUPERSESSION_IDENTITY_INCOMPLETE",
      409
    );
  }
  return {
    ownerEmail,
    accountKey,
    resourceNames: {
      twilioNumber: buildProvisioningResourceName("twilio-number", accountKey),
      vapiAssistant: buildProvisioningResourceName("vapi-assistant", accountKey),
      vapiPhone: buildProvisioningResourceName("vapi-phone", accountKey),
    },
  };
}

function durableStepHasActivity(step = {}) {
  const data = step?.data && typeof step.data === "object" && !Array.isArray(step.data)
    ? step.data
    : {};
  return Boolean(
    String(data.status || "").trim()
      || data.result
      || data.claimToken
      || data.claimedAt
      || data.completedAt
      || data.failedAt
      || Number(data.attempts || 0) > 0
  );
}

function getProviderResourceName(record = {}) {
  return String(
    record.name
      || record.friendly_name
      || record.friendlyName
      || record.assistant?.name
      || record.metadata?.name
      || ""
  ).trim();
}

function requireCompleteCollection(value, provider) {
  if (!Array.isArray(value)) {
    throw reconciliationError(
      `${provider} did not return a complete resource inventory, so supersession was stopped safely.`,
      "SIGNUP_SUPERSESSION_RECONCILIATION_INCOMPLETE",
      503,
      provider.toLowerCase()
    );
  }
  // The existing provider loaders request at most 1,000 Vapi records. Reaching
  // the boundary means absence cannot be established without pagination.
  if (provider === "Vapi" && value.length >= 1000) {
    throw reconciliationError(
      "Vapi resource inventory reached its read limit, so supersession was stopped safely.",
      "SIGNUP_SUPERSESSION_RECONCILIATION_INCOMPLETE",
      503,
      "vapi"
    );
  }
  return value;
}

async function loadSafely(provider, loader) {
  try {
    return await loader();
  } catch (error) {
    if (String(error?.code || "").startsWith("SIGNUP_SUPERSESSION_")) throw error;
    throw reconciliationError(
      `${provider} resource reconciliation is unavailable, so no signup state was changed.`,
      "SIGNUP_SUPERSESSION_RECONCILIATION_UNAVAILABLE",
      503,
      provider.toLowerCase()
    );
  }
}

async function readDurableProvisioningSnapshot(accountKey, loadDurableStep) {
  if (typeof loadDurableStep !== "function") {
    throw reconciliationError(
      "Durable provisioning reconciliation is unavailable, so no signup state was changed.",
      "SIGNUP_SUPERSESSION_RECONCILIATION_UNAVAILABLE",
      503,
      "database"
    );
  }
  return Promise.all(PROVISIONING_STAGES.map((kind) => loadSafely(
    "Database",
    () => loadDurableStep({ kind, idempotencyKey: accountKey })
  )));
}

function assertNoDurableProvisioningActivity(snapshots = []) {
  if (snapshots.some(durableStepHasActivity)) {
    throw reconciliationError(
      "Durable provisioning history shows that a paid provider step may have started. Manual reconciliation is required.",
      "SIGNUP_DURABLE_PROVISIONING_REQUIRES_REVIEW",
      409,
      "database"
    );
  }
}

async function reconcileSignupSupersessionResources({
  signup = {},
  loadDurableStep,
  loadTwilioNumbers,
  loadVapiAssistants,
  loadVapiPhoneNumbers,
  loadStripeResources,
} = {}) {
  const identity = getSignupProvisioningIdentity(signup);
  const firstDurableSnapshot = await readDurableProvisioningSnapshot(identity.accountKey, loadDurableStep);
  assertNoDurableProvisioningActivity(firstDurableSnapshot);

  if (
    typeof loadTwilioNumbers !== "function"
    || typeof loadVapiAssistants !== "function"
    || typeof loadVapiPhoneNumbers !== "function"
    || typeof loadStripeResources !== "function"
  ) {
    throw reconciliationError(
      "Provider reconciliation is unavailable, so no signup state was changed.",
      "SIGNUP_SUPERSESSION_RECONCILIATION_UNAVAILABLE",
      503
    );
  }

  const [twilioRaw, vapiAssistantsRaw, vapiPhonesRaw, stripeSummary] = await Promise.all([
    loadSafely("Twilio", loadTwilioNumbers),
    loadSafely("Vapi", loadVapiAssistants),
    loadSafely("Vapi", loadVapiPhoneNumbers),
    loadSafely("Stripe", () => loadStripeResources({
      ownerEmail: identity.ownerEmail,
      accountKey: identity.accountKey,
    })),
  ]);
  const twilioNumbers = requireCompleteCollection(twilioRaw, "Twilio");
  const vapiAssistants = requireCompleteCollection(vapiAssistantsRaw, "Vapi");
  const vapiPhones = requireCompleteCollection(vapiPhonesRaw, "Vapi");
  if (!stripeSummary || typeof stripeSummary !== "object") {
    throw reconciliationError(
      "Stripe did not return a complete billing-resource result, so supersession was stopped safely.",
      "SIGNUP_SUPERSESSION_RECONCILIATION_INCOMPLETE",
      503,
      "stripe"
    );
  }

  const providerResourceFound = Boolean(
    twilioNumbers.some((record) => getProviderResourceName(record) === identity.resourceNames.twilioNumber)
      || vapiAssistants.some((record) => getProviderResourceName(record) === identity.resourceNames.vapiAssistant)
      || vapiPhones.some((record) => getProviderResourceName(record) === identity.resourceNames.vapiPhone)
      || stripeSummary.hasResources === true
      || Number(stripeSummary.customerCount || 0) > 0
      || Number(stripeSummary.subscriptionCount || 0) > 0
      || Number(stripeSummary.checkoutSessionCount || 0) > 0
  );
  if (providerResourceFound) {
    throw reconciliationError(
      "A provider or billing resource matches this signup. Manual reconciliation is required before supersession.",
      "SIGNUP_PROVIDER_RESOURCES_REQUIRE_REVIEW",
      409
    );
  }

  // Re-read durable state after the network inventories. A provisioning claim
  // that started during provider inspection makes absence ambiguous and blocks
  // the mutation instead of racing it.
  const finalDurableSnapshot = await readDurableProvisioningSnapshot(identity.accountKey, loadDurableStep);
  assertNoDurableProvisioningActivity(finalDurableSnapshot);

  return {
    complete: true,
    resourcesProvisioned: false,
    durableProvisioning: "absent",
    twilioResources: "absent",
    vapiResources: "absent",
    stripeResources: "absent",
  };
}

module.exports = {
  PROVISIONING_STAGES,
  durableStepHasActivity,
  getProviderResourceName,
  getSignupProvisioningIdentity,
  reconcileSignupSupersessionResources,
};
