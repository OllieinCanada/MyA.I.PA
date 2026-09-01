const assert = require("node:assert/strict");
const test = require("node:test");

const { classifyOperationalError } = require("../server/operationalErrorClassifier");
const { buildRuntimeIncident } = require("../server/runtimeAlerts");

test("explicit Twilio balance errors become platform-funding instructions", () => {
  const classified = classifyOperationalError(
    Object.assign(new Error("Twilio account balance is insufficient; add funds"), { statusCode: 402 }),
    { provider: "twilio", operation: "purchase Canadian number" }
  );
  assert.equal(classified.category, "platform_funding");
  assert.equal(classified.reasonCode, "PROVIDER_ACCOUNT_FUNDING_REQUIRED");
  assert.match(classified.nextAction, /Add funds.*Twilio Billing/i);
  assert.equal(classified.retryable, false);
});

test("Twilio 401 and 20003 incidents require a billing-first account check before credential changes", () => {
  const classified = classifyOperationalError(
    Object.assign(new Error("Twilio could not deliver the SMS request."), {
      providerStatus: 401,
      providerCode: 20003,
      providerSignal: "TWILIO_ACCOUNT_ACCESS_AMBIGUOUS",
    }),
    { provider: "twilio", operation: "send dashboard login code" }
  );
  assert.equal(classified.category, "account_access");
  assert.equal(classified.reasonCode, "TWILIO_ACCOUNT_ACCESS_REJECTED");
  assert.match(classified.nextAction, /First open Twilio Billing/i);
  assert.match(classified.nextAction, /Only when billing is healthy.*Account status is active.*credential/i);
  assert.match(classified.reason, /does not by itself prove.*credentials/i);
  assert.doesNotMatch(classified.reason, /rejected.*configured credential/i);

  const incident = buildRuntimeIncident(
    Object.assign(new Error("Twilio could not deliver the SMS request."), {
      providerStatus: 401,
      providerCode: 20003,
      providerSignal: "TWILIO_ACCOUNT_ACCESS_AMBIGUOUS",
    }),
    { provider: "twilio", operation: "send dashboard login code" }
  );
  assert.equal(incident.reasonCode, "TWILIO_ACCOUNT_ACCESS_REJECTED");
  assert.equal(incident.snapshot["Provider signal"], "TWILIO_ACCOUNT_ACCESS_AMBIGUOUS");
  assert.match(incident.signInDestination, /Billing overview.*Account status/i);
});

test("an explicit Twilio billing signal wins before ambiguous 401 authentication handling", () => {
  const classified = classifyOperationalError(
    Object.assign(new Error("Twilio could not deliver the SMS request."), {
      providerStatus: 401,
      providerCode: 20003,
      providerSignal: "TWILIO_BILLING_RESTRICTED",
    }),
    { provider: "twilio", operation: "send dashboard login code" }
  );
  assert.equal(classified.category, "platform_funding");
  assert.equal(classified.reasonCode, "PROVIDER_ACCOUNT_FUNDING_REQUIRED");
  assert.match(classified.nextAction, /Add funds.*Twilio Billing/i);
});

test("non-Twilio 401 failures remain credential incidents", () => {
  const classified = classifyOperationalError(
    Object.assign(new Error("Unauthorized"), { providerStatus: 401 }),
    { provider: "vapi", operation: "create assistant" }
  );
  assert.equal(classified.category, "authentication");
  assert.equal(classified.reasonCode, "PROVIDER_AUTHENTICATION_FAILED");
});

test("Stripe card declines are customer-payment failures, not platform funding", () => {
  const classified = classifyOperationalError(
    Object.assign(new Error("card declined"), { code: "card_declined", statusCode: 402 }),
    { provider: "stripe", operation: "start subscription" }
  );
  assert.equal(classified.category, "customer_payment");
  assert.equal(classified.reasonCode, "CUSTOMER_PAYMENT_FAILED");
  assert.match(classified.nextAction, /Do not add funds to Vapi or Twilio/i);
});

test("Stripe HTTP 402 remains a customer-payment issue even when the decline code is absent", () => {
  const classified = classifyOperationalError(
    Object.assign(new Error("payment request failed"), { statusCode: 402 }),
    { provider: "stripe", operation: "confirm checkout payment" }
  );
  assert.equal(classified.category, "customer_payment");
  assert.match(classified.signInDestination, /Stripe Dashboard.*Payments/i);
});

test("an unattributed HTTP 402 never invents a provider-account funding instruction", () => {
  const classified = classifyOperationalError(
    Object.assign(new Error("payment required"), { statusCode: 402 }),
    { operation: "unidentified upstream request" }
  );
  assert.equal(classified.category, "unknown");
  assert.doesNotMatch(`${classified.reason} ${classified.nextAction}`, /add funds/i);
});

test("rate limits never claim that adding money is the fix", () => {
  const classified = classifyOperationalError(
    Object.assign(new Error("Too Many Requests"), { statusCode: 429 }),
    { provider: "vapi", operation: "create assistant" }
  );
  assert.equal(classified.category, "rate_limit");
  assert.equal(classified.reasonCode, "PROVIDER_RATE_LIMITED");
  assert.doesNotMatch(`${classified.reason} ${classified.nextAction}`, /add funds/i);
});

test("OpenAI insufficient-quota codes are billing/credit failures, not ordinary rate limits", () => {
  const classified = classifyOperationalError(
    Object.assign(new Error("AI responses are temporarily unavailable."), {
      provider: "openai",
      providerCode: "insufficient_quota",
      providerStatus: 429,
    }),
    { operation: "assistant response" }
  );
  assert.equal(classified.category, "platform_funding");
  assert.equal(classified.reasonCode, "PROVIDER_ACCOUNT_FUNDING_REQUIRED");
  assert.match(classified.nextAction, /OpenAI.*Billing/i);
});

test("missing provider configuration is not mislabeled as an outage", () => {
  const classified = classifyOperationalError(
    Object.assign(new Error("VAPI_API_KEY is not configured."), { statusCode: 503 }),
    { provider: "vapi", operation: "create assistant" }
  );
  assert.equal(classified.category, "configuration");
  assert.match(classified.signInDestination, /Render.*Environment/i);
  assert.doesNotMatch(classified.reason, /unavailable|outage/i);
});

test("email authentication, timeout, and recipient rejection remain distinct", () => {
  assert.equal(classifyOperationalError(
    Object.assign(new Error("email provider delivery failed"), { code: "SMTP_AUTH_FAILED", provider: "smtp" })
  ).category, "authentication");
  assert.equal(classifyOperationalError(
    Object.assign(new Error("email provider delivery failed"), { code: "SMTP_TIMEOUT", provider: "smtp" })
  ).category, "timeout");
  assert.equal(classifyOperationalError(
    Object.assign(new Error("email provider delivery failed"), { code: "SMTP_RECIPIENT_REJECTED", provider: "smtp" })
  ).category, "delivery");
});

test("Twilio inventory and delivery codes retain their distinct causes", () => {
  assert.equal(classifyOperationalError(
    Object.assign(new Error("Twilio rejected inventory request"), { code: 21452 }),
    { provider: "twilio" }
  ).category, "inventory");
  assert.equal(classifyOperationalError(
    Object.assign(new Error("Twilio message failed"), { code: 30003 }),
    { provider: "twilio" }
  ).category, "delivery");
});

test("observed Twilio destination, compliance, and daily-limit codes get exact categories", () => {
  for (const code of [21211, 21265, 21266]) {
    assert.equal(classifyOperationalError(
      Object.assign(new Error("Twilio rejected the message request"), { code }),
      { provider: "twilio" }
    ).category, "configuration");
  }
  for (const code of [21268, 21608, 21610, 30034]) {
    assert.equal(classifyOperationalError(
      Object.assign(new Error("Twilio blocked this destination"), { code }),
      { provider: "twilio" }
    ).category, "permission_or_compliance");
  }
  const dailyLimit = classifyOperationalError(
    Object.assign(new Error("Twilio daily limit reached"), { code: 63038 }),
    { provider: "twilio" }
  );
  assert.equal(dailyLimit.category, "rate_limit");
  assert.match(dailyLimit.reason, /rolling daily message limit/i);
  assert.doesNotMatch(`${dailyLimit.reason} ${dailyLimit.nextAction}`, /add funds/i);

  const invalidDestination = classifyOperationalError(
    Object.assign(new Error("Twilio rejected the message request"), { code: 21211 }),
    { provider: "twilio" }
  );
  assert.match(invalidDestination.reason, /To number.*E\.164/i);
  const landline = classifyOperationalError(
    Object.assign(new Error("Twilio delivery failed"), { code: 30006 }),
    { provider: "twilio" }
  );
  assert.match(landline.reason, /landline|carrier cannot receive/i);
  const unknownCarrier = classifyOperationalError(
    Object.assign(new Error("Twilio delivery failed"), { code: 30008 }),
    { provider: "twilio" }
  );
  assert.match(unknownCarrier.reason, /without enough detail/i);
});

test("the production Prisma void result is identified as a database implementation error", () => {
  const classified = classifyOperationalError(new Error(
    "Invalid prisma.$queryRaw() invocation: Failed to deserialize column of type 'void' from pg_advisory_xact_lock"
  ), { operation: "signup idempotency lock" });
  assert.equal(classified.category, "database_implementation");
  assert.equal(classified.reasonCode, "DATABASE_QUERY_IMPLEMENTATION_FAILED");
  assert.match(classified.nextAction, /supported advisory-lock query/i);
});

test("timeouts require reconciliation before a retry", () => {
  const classified = classifyOperationalError(
    Object.assign(new Error("request timed out"), { code: "ETIMEDOUT" }),
    { provider: "make", operation: "signup handoff" }
  );
  assert.equal(classified.category, "timeout");
  assert.equal(classified.retryable, true);
  assert.match(classified.nextAction, /reconcile/i);
});

test("database outages, network failures, and provider outages remain distinct", () => {
  assert.equal(classifyOperationalError(
    Object.assign(new Error("Cannot reach the database"), { code: "P1001" }),
    { provider: "database", operation: "save signup" }
  ).category, "database_unavailable");
  assert.equal(classifyOperationalError(
    Object.assign(new Error("connection reset"), { code: "ECONNRESET" }),
    { provider: "twilio", operation: "purchase number" }
  ).category, "network");
  assert.equal(classifyOperationalError(
    Object.assign(new Error("upstream unavailable"), { statusCode: 503 }),
    { provider: "vapi", operation: "create assistant" }
  ).category, "provider_outage");
});

test("duplicate conflicts and compliance blocks never recommend an automatic retry", () => {
  const duplicate = classifyOperationalError(
    Object.assign(new Error("provisioning already in progress"), { code: "PROVISIONING_ALREADY_IN_PROGRESS" }),
    { operation: "signup provisioning" }
  );
  const compliance = classifyOperationalError(
    Object.assign(new Error("recipient opted out"), { code: "21610" }),
    { provider: "twilio", operation: "send confirmation" }
  );
  assert.equal(duplicate.category, "duplicate_conflict");
  assert.equal(duplicate.retryable, false);
  assert.match(duplicate.nextAction, /canonical signup/i);
  assert.equal(compliance.category, "permission_or_compliance");
  assert.equal(compliance.retryable, false);
  assert.match(compliance.nextAction, /consent|compliance|permission|opt-out|opts back/i);
});

test("unknown failures remain explicitly unconfirmed", () => {
  const classified = classifyOperationalError(new Error("unfamiliar result"), { operation: "new workflow" });
  assert.equal(classified.category, "unknown");
  assert.equal(classified.known, false);
  assert.match(classified.reason, /do not establish a specific cause/i);
});

test("runtime Telegram incidents include exact safe category and provider instructions", () => {
  const incident = buildRuntimeIncident(
    Object.assign(new Error("insufficient credits for private@example.com"), { statusCode: 402 }),
    { provider: "vapi", operation: "create assistant", route: "/api/signup" }
  );
  const serialized = JSON.stringify(incident);
  assert.equal(incident.reasonCode, "PROVIDER_ACCOUNT_FUNDING_REQUIRED");
  assert.equal(incident.snapshot["Failure category"], "platform_funding");
  assert.equal(incident.snapshot.Provider, "Vapi");
  assert.match(incident.nextAction, /Add funds.*Vapi Billing/i);
  assert.doesNotMatch(serialized, /private@example\.com/);
});

test("a generic route action cannot replace a known provider funding instruction", () => {
  const incident = buildRuntimeIncident(
    Object.assign(new Error("account balance is insufficient"), { statusCode: 402 }),
    {
      provider: "twilio",
      operation: "purchase Canadian number",
      reason: "The request failed for a generic reason.",
      nextAction: "Open generic logs and retry.",
    }
  );
  assert.match(incident.nextAction, /Add funds.*Twilio Billing/i);
  assert.doesNotMatch(incident.nextAction, /generic logs/i);
  assert.match(incident.reason, /Twilio account does not have enough/i);
  assert.doesNotMatch(incident.reason, /generic reason/i);
});
