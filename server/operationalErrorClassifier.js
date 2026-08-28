const PROVIDER_LABELS = Object.freeze({
  DATABASE: "Render PostgreSQL",
  DEEPGRAM: "Deepgram",
  MAKE: "Make.com",
  OPENAI: "OpenAI",
  SMTP: "email provider",
  STRIPE: "Stripe",
  TELEGRAM: "Telegram",
  TWILIO: "Twilio",
  VAPI: "Vapi",
});

const PROVIDER_DESTINATIONS = Object.freeze({
  DATABASE: "Render → PostgreSQL metrics and API logs",
  DEEPGRAM: "Deepgram Console → Usage, Billing, and API logs",
  MAKE: "Make.com → Signup scenario run history",
  OPENAI: "OpenAI Platform → Usage, Billing, and API logs",
  SMTP: "Configured email provider → Activity and authentication logs",
  STRIPE: "Stripe Dashboard → Payments and subscriptions",
  TELEGRAM: "Telegram Bot settings and My AI PA Telegram outbox",
  TWILIO: "Twilio Console → Billing, Monitor, and phone numbers",
  VAPI: "Vapi Dashboard → Billing, Logs, and phone numbers",
});

const TWILIO_CODE_CATEGORIES = Object.freeze({
  "20003": "authentication",
  "20404": "configuration",
  "21211": "configuration",
  "21265": "configuration",
  "21266": "configuration",
  "21268": "compliance",
  "21452": "inventory",
  "21608": "compliance",
  "21610": "compliance",
  "30003": "delivery",
  "30005": "delivery",
  "30006": "delivery",
  "30007": "compliance",
  "30008": "delivery",
  "30034": "compliance",
  "63038": "rate_limit",
});

const TWILIO_CODE_GUIDANCE = Object.freeze({
  "21211": {
    reason: "Twilio rejected the destination because the To number is invalid or is not in full E.164 format.",
    nextAction: "Correct the destination to +country-code and subscriber number with no spaces or punctuation, then send one new message.",
  },
  "21265": {
    reason: "Twilio rejected the destination because the To value is a short code rather than a full recipient phone number.",
    nextAction: "Replace the short-code destination with the recipient's full SMS-capable phone number before retrying.",
  },
  "21266": {
    reason: "Twilio rejected the message because the To and From numbers are the same.",
    nextAction: "Correct the owner/customer routing so the assigned Twilio sender and recipient are different, then retry once.",
  },
  "21268": {
    reason: "Twilio does not allow messages to this premium-rate or information-service destination.",
    nextAction: "Do not retry this destination. Ask for a standard SMS-capable contact number and use that instead.",
  },
  "21608": {
    reason: "Twilio blocked the message because the recipient is unverified for the current account or the required Primary Compliance Profile is not approved.",
    nextAction: "Open Twilio Trust Hub and Verified Caller IDs. Complete the Primary Compliance Profile or verify this test recipient before sending again.",
  },
  "21610": {
    reason: "Twilio blocked the message because the recipient opted out of messages from this sender.",
    nextAction: "Do not bypass the opt-out. Use another permitted contact method unless the recipient explicitly opts back in through the supported flow.",
  },
  "30003": {
    reason: "Twilio could not deliver the message because the destination handset was unreachable.",
    nextAction: "Open Twilio Messaging logs to confirm code 30003, then verify the mobile number or use another permitted contact method. Retry only if the recipient confirms the handset can receive SMS.",
  },
  "30005": {
    reason: "Twilio could not deliver the message because the destination handset is unknown or may no longer exist.",
    nextAction: "Verify the recipient's current mobile number before sending another message.",
  },
  "30006": {
    reason: "Twilio could not deliver the message because the destination is a landline or its carrier cannot receive this SMS.",
    nextAction: "Do not keep retrying the same SMS. Confirm an SMS-capable mobile number or use another permitted contact method.",
  },
  "30007": {
    reason: "Twilio or the destination carrier filtered the message under messaging or carrier policy.",
    nextAction: "Review consent, content, sender verification, and Twilio Messaging logs. Correct the compliance cause before sending again.",
  },
  "30008": {
    reason: "Twilio received a generic carrier delivery failure without enough detail to identify a more specific cause.",
    nextAction: "Open Twilio Messaging logs, verify the handset and carrier path, and retry only after checking that this was not a persistent destination or sender issue.",
  },
  "30034": {
    reason: "Twilio blocked a US-bound message because the sending 10DLC number is not attached to an approved A2P campaign.",
    nextAction: "Complete A2P 10DLC registration and attach the sender to the approved Messaging Service before sending to US recipients again.",
  },
  "63038": {
    reason: "Twilio stopped outbound messages because the account reached its rolling daily message limit.",
    nextAction: "Pause outbound messages, review the Twilio usage limit and Primary Compliance Profile, then resume only after the rolling limit resets or Twilio raises it.",
  },
});

function normalizeToken(value, maxLength = 100) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_.:-]+/g, "_")
    .slice(0, maxLength);
}

function numericStatus(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isInteger(number) && number >= 100 && number <= 599) return number;
  }
  return 0;
}

function providerFromSource(source, code) {
  if (/\b(?:PRISMA|POSTGRES|POSTGRESQL|DATABASE)\b/i.test(source) || /^P\d{4}$/i.test(code)) return "DATABASE";
  if (/\bTWILIO\b/i.test(source) || TWILIO_CODE_CATEGORIES[code]) return "TWILIO";
  if (/\bVAPI\b/i.test(source)) return "VAPI";
  if (/\bMAKE(?:\.COM)?\b|MAKE_SIGNUP/i.test(source)) return "MAKE";
  if (/\bSTRIPE\b|CARD_DECLINED|PAYMENT_INTENT|INVOICE\.PAYMENT_FAILED/i.test(source)) return "STRIPE";
  if (/\bOPENAI\b|GPT[_ -]?\d|CHAT_COMPLETION/i.test(source)) return "OPENAI";
  if (/\bDEEPGRAM\b|NOVA[_ -]?3|FLUX/i.test(source)) return "DEEPGRAM";
  if (/\bTELEGRAM\b/i.test(source)) return "TELEGRAM";
  if (/\bSMTP\b|\bEAUTH\b|NODEMAILER|EMAIL PROVIDER/i.test(source)) return "SMTP";
  return "";
}

function providerDetails(error = {}, context = {}) {
  const nested = error?.response?.data && typeof error.response.data === "object" ? error.response.data : {};
  const code = normalizeToken(
    context.providerCode
      || error.providerCode
      || nested.code
      || nested?.error?.code
      || error.code
  );
  const status = numericStatus(
    context.upstreamStatus,
    context.providerStatus,
    error.upstreamStatus,
    error.providerStatus,
    error.statusCode,
    error.status,
    error?.response?.status
  );
  const source = [
    context.provider,
    context.operation,
    context.area,
    context.workflow,
    code,
    error.name,
    error.message,
  ].filter(Boolean).join(" ");
  const explicitProvider = normalizeToken(context.provider || error.provider);
  const provider = PROVIDER_LABELS[explicitProvider]
    ? explicitProvider
    : providerFromSource(source, code);
  return { code, provider, source, status };
}

function providerName(provider) {
  return PROVIDER_LABELS[provider] || "the affected provider";
}

function providerDestination(provider) {
  return PROVIDER_DESTINATIONS[provider] || "My AI PA admin → Needs Attention and provider logs";
}

function fundingDestination(provider) {
  if (provider === "TWILIO") return "Twilio Console → Billing overview";
  if (provider === "VAPI") return "Vapi Dashboard → Billing";
  if (provider === "OPENAI") return "OpenAI Platform → Billing and usage limits";
  if (provider === "DEEPGRAM") return "Deepgram Console → Billing and usage";
  if (provider === "MAKE") return "Make.com → Organization plan and usage";
  return providerDestination(provider);
}

function result(details, category, overrides = {}) {
  const provider = details.provider;
  const label = providerName(provider);
  return {
    known: category !== "unknown",
    category,
    provider,
    providerLabel: label,
    providerStatus: details.status || 0,
    providerCode: details.code || "",
    signInDestination: providerDestination(provider),
    ...overrides,
  };
}

function classifyOperationalError(error = {}, context = {}) {
  const details = providerDetails(error, context);
  const { code, provider, source, status } = details;
  const label = providerName(provider);
  const exactTwilio = provider === "TWILIO" ? TWILIO_CODE_GUIDANCE[code] : null;

  if (
    provider === "DATABASE"
    && /FAILED TO DESERIALIZE COLUMN OF TYPE ['\"]?VOID|PG_ADVISORY_XACT_LOCK|PRISMA\.\$QUERYRAW/i.test(source)
  ) {
    return result(details, "database_implementation", {
      reasonCode: "DATABASE_QUERY_IMPLEMENTATION_FAILED",
      reason: "A production database query returned a PostgreSQL value that Prisma could not deserialize. The duplicate-protection lock stopped before any provider work could be trusted.",
      retryable: false,
      whatFailed: "The database-backed duplicate-protection lock failed",
      impact: "The operation was stopped before its protected work completed. A retry must wait for a code fix so it cannot create duplicate paid resources.",
      nextAction: "Deploy the supported advisory-lock query, verify the database-backed idempotency tests, then rerun one guarded canary.",
    });
  }

  if (
    provider === "DATABASE"
    && (/^(?:P1001|P1002|P1017|DATABASE_UNAVAILABLE)$/i.test(code)
      || /DATABASE (?:IS )?(?:UNAVAILABLE|UNREACHABLE)|CAN(?:NOT|'T) REACH (?:THE )?DATABASE/i.test(source))
  ) {
    return result(details, "database_unavailable", {
      reasonCode: "DATABASE_UNAVAILABLE",
      reason: "My AI PA could not establish or keep a usable connection to the production database.",
      retryable: true,
      whatFailed: "The production database connection failed",
      impact: "The affected operation stopped because its durable state could not be read or saved safely.",
      nextAction: "Check Render PostgreSQL status, connections, and API logs. Retry only after database readiness is healthy.",
    });
  }

  if (
    /(?:_NOT_CONFIGURED|_CONFIGURATION_MISSING|_INVALID_URL|_REQUIRED)$/i.test(code)
    || /NOT CONFIGURED|CONFIGURATION (?:IS )?MISSING|MISSING REQUIRED|INVALID (?:WEBHOOK )?URL/i.test(source)
  ) {
    return result(details, "configuration", {
      reasonCode: "PROVIDER_CONFIGURATION_INVALID",
      reason: `${label} is missing a required My AI PA configuration value or received an invalid one.`,
      retryable: false,
      whatFailed: `${label} configuration validation failed`,
      impact: "The provider operation did not start successfully.",
      nextAction: `Compare the Render environment and ${label} configuration with the production checklist, correct the missing or invalid value, redeploy if needed, then retry once.`,
      signInDestination: `Render → Environment; then ${providerDestination(provider)}`,
    });
  }

  if (provider === "STRIPE" && (
    status === 402
    ||
    /^(?:CARD_DECLINED|INSUFFICIENT_FUNDS|BALANCE_INSUFFICIENT|INVOICE.PAYMENT_FAILED|PAYMENT_FAILED)$/i.test(code)
    || /CARD (?:WAS )?DECLINED|CUSTOMER(?:'S)? PAYMENT|INVOICE\.PAYMENT_FAILED|INSUFFICIENT FUNDS/i.test(source)
  )) {
    return result(details, "customer_payment", {
      reasonCode: "CUSTOMER_PAYMENT_FAILED",
      reason: "The customer's Stripe payment failed or was declined. This is separate from My AI PA's Twilio and Vapi balances.",
      retryable: false,
      whatFailed: "The customer payment did not complete",
      impact: "The related paid signup or subscription step cannot be treated as complete.",
      nextAction: "Review the payment or decline in Stripe. Do not add funds to Vapi or Twilio for this issue; have the customer update their payment method if Stripe requires it.",
      signInDestination: "Stripe Dashboard → Payments and subscriptions",
    });
  }

  const platformFundingProvider = ["TWILIO", "VAPI", "OPENAI", "DEEPGRAM", "MAKE"].includes(provider);
  if (
    platformFundingProvider
    && (
      status === 402
      || /^(?:INSUFFICIENT_FUNDS|INSUFFICIENT_BALANCE|INSUFFICIENT_QUOTA|BALANCE_INSUFFICIENT|BILLING_HARD_LIMIT_REACHED|BILLING_LIMIT_REACHED|CREDITS_EXHAUSTED|PAYMENT_REQUIRED)$/i.test(code)
      || /INSUFFICIENT (?:FUNDS|BALANCE|CREDITS)|ACCOUNT BALANCE|ADD FUNDS|BILLING QUOTA|PAYMENT REQUIRED|OUT OF CREDITS/i.test(source)
    )
  ) {
    return result(details, "platform_funding", {
      reasonCode: "PROVIDER_ACCOUNT_FUNDING_REQUIRED",
      reason: `My AI PA's ${label} account does not have enough funds or credits for this operation.`,
      retryable: false,
      whatFailed: `${label} stopped the operation because the platform account needs funds`,
      impact: "The provider action did not complete, so setup or service remains safely incomplete.",
      nextAction: `Add funds or credits in ${label} Billing, confirm the account is active, then retry the operation once.`,
      signInDestination: fundingDestination(provider),
    });
  }

  if (
    status === 401
    || /^(?:20003|EAUTH|SMTP_AUTH_FAILED|AUTHENTICATION_FAILED|AUTH_FAILED|INVALID_API_KEY|UNAUTHORIZED)$/i.test(code)
    || /UNAUTHORI[ZS]ED|INVALID API KEY|INVALID CREDENTIAL|AUTHENTICATION FAILED|SMTP 535/i.test(source)
  ) {
    return result(details, "authentication", {
      reasonCode: "PROVIDER_AUTHENTICATION_FAILED",
      reason: `${label} rejected My AI PA's configured credential.`,
      retryable: false,
      whatFailed: `${label} authentication failed`,
      impact: "The provider operation was rejected before My AI PA could verify completion.",
      nextAction: `Verify the active ${label} credential in Render and the provider dashboard. Rotate it only if required, redeploy, then retry once.`,
      signInDestination: `Render → Environment; then ${providerDestination(provider)}`,
    });
  }

  if (
    status === 429
    || TWILIO_CODE_CATEGORIES[code] === "rate_limit"
    || /SMTP_RATE_LIMITED|RATE[_ -]?LIMIT|TOO MANY REQUESTS|CONCURRENCY LIMIT|RETRY_AFTER|QUOTA EXCEEDED/i.test(source)
  ) {
    return result(details, "rate_limit", {
      reasonCode: "PROVIDER_RATE_LIMITED",
      reason: exactTwilio?.reason || `${label} temporarily refused the operation because a request, usage, or concurrency limit was reached. This alone does not prove a billing problem.`,
      retryable: true,
      whatFailed: `${label} rate-limited the operation`,
      impact: "The operation did not complete during this attempt.",
      nextAction: exactTwilio?.nextAction || `Check ${label} usage and concurrency, wait for the provider retry window, verify no duplicate resource was created, then retry once.`,
    });
  }

  if (
    TWILIO_CODE_CATEGORIES[code] === "inventory"
    || /CANADIAN_NUMBER_INVENTORY_UNAVAILABLE|TWILIO_NUMBER_UNAVAILABLE|NO (?:PHONE )?NUMBERS? AVAILABLE|INVENTORY UNAVAILABLE/i.test(source)
  ) {
    return result(details, "inventory", {
      reasonCode: "PROVIDER_INVENTORY_UNAVAILABLE",
      reason: `${label} could not supply a valid number or resource from the required inventory.`,
      retryable: true,
      whatFailed: `${label} inventory could not satisfy the request`,
      impact: "No substitute resource should be presented as ready.",
      nextAction: "Check Canadian inventory and the approved regional fallback. Retry only with a valid Canadian result; never substitute an unintended country or territory.",
    });
  }

  if (
    /^(?:ABORT_ERR|ABORTERROR|ETIMEDOUT|SMTP_TIMEOUT|TIMEOUTERROR|HTTP_TIMEOUT|FETCH_TIMEOUT|REQUEST_TIMEOUT|MAKE_SIGNUP_TIMEOUT)$/i.test(code)
    || /\bTIMED? OUT\b|TIMEOUT|ABORTERROR/i.test(source)
  ) {
    return result(details, "timeout", {
      reasonCode: "PROVIDER_TIMEOUT",
      reason: `${label} did not answer before the safe timeout expired.`,
      retryable: true,
      whatFailed: `${label} timed out`,
      impact: "Completion is unknown, so retrying without reconciliation could duplicate a provider action.",
      nextAction: `Check ${label} status and logs, reconcile whether a resource was already created, then retry once only if the durable state is safe.`,
    });
  }

  if (
    /^(?:ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|SMTP_CONNECTION_FAILED|MAKE_SIGNUP_UNREACHABLE)$/i.test(code)
    || /CONNECTION (?:RESET|REFUSED)|DNS|COULD NOT BE REACHED|NETWORK (?:ERROR|FAIL)/i.test(source)
  ) {
    return result(details, "network", {
      reasonCode: "PROVIDER_CONNECTION_FAILED",
      reason: `My AI PA could not establish or keep a network connection to ${label}.`,
      retryable: true,
      whatFailed: `The connection to ${label} failed`,
      impact: "The provider result could not be verified during this attempt.",
      nextAction: `Check ${label} and Render network status, reconcile any possible partial provider action, then retry once.`,
    });
  }

  if (provider && [500, 502, 503, 504].includes(status)) {
    return result(details, "provider_outage", {
      reasonCode: "PROVIDER_UNAVAILABLE",
      reason: `${label} returned a server-availability failure.`,
      retryable: true,
      whatFailed: `${label} was unavailable`,
      impact: "The provider operation did not return a verified successful result.",
      nextAction: `Check ${label} status and logs, confirm no partial resource exists, then retry after service recovery.`,
    });
  }

  if (
    status === 409
    || /^(?:P2002|P2034|PROVISIONING_ALREADY_IN_PROGRESS|PROVISIONING_CONTEXT_MISMATCH|VAPI_.*_RECONCILIATION_AMBIGUOUS)$/i.test(code)
    || /DUPLICATE|ALREADY IN PROGRESS|CONTEXT MISMATCH|RECONCILIATION AMBIGUOUS|CONFLICT/i.test(source)
  ) {
    return result(details, "duplicate_conflict", {
      reasonCode: "DUPLICATE_OR_STATE_CONFLICT",
      reason: "My AI PA stopped because durable state indicates a duplicate, concurrent operation, or conflicting provisioning context.",
      retryable: false,
      whatFailed: "Duplicate protection or state reconciliation blocked the operation",
      impact: "The operation remains incomplete, but the stop prevents duplicate resources or charges.",
      nextAction: "Inspect the canonical signup and provider resources. Resolve or supersede the duplicate before retrying the one canonical operation.",
    });
  }

  if (
    status === 403
    || TWILIO_CODE_CATEGORIES[code] === "compliance"
    || /SMS_RECIPIENT_SUPPRESSED|OPTED OUT|CARRIER FILTER|COMPLIANCE|PERMISSION DENIED|FORBIDDEN/i.test(source)
  ) {
    return result(details, "permission_or_compliance", {
      reasonCode: "PROVIDER_PERMISSION_OR_COMPLIANCE_BLOCK",
      reason: exactTwilio?.reason || `${label} blocked the operation because of a permission, consent, or compliance rule.`,
      retryable: false,
      whatFailed: `${label} blocked the operation`,
      impact: "The provider action did not complete and must not be bypassed automatically.",
      nextAction: exactTwilio?.nextAction || `Open ${label} compliance or permission details, correct the authorized configuration or consent state, then retry only if permitted.`,
    });
  }

  if (
    TWILIO_CODE_CATEGORIES[code] === "delivery"
    || /^(?:SMTP_RECIPIENT_REJECTED|SMTP_DELIVERY_FAILED)$/i.test(code)
    || /MESSAGE (?:FAILED|UNDELIVERED)|DELIVERY (?:FAILED|FAILURE)|UNREACHABLE HANDSET|UNKNOWN DESTINATION|LANDLINE/i.test(source)
  ) {
    return result(details, "delivery", {
      reasonCode: "MESSAGE_DELIVERY_FAILED",
      reason: exactTwilio?.reason || `${label} accepted the message attempt but could not deliver it to the destination.`,
      retryable: false,
      whatFailed: "A text-message delivery failed",
      impact: "The intended recipient may not have received the message.",
      nextAction: exactTwilio?.nextAction || `Review the allowlisted delivery code in ${label}, verify the destination and consent state, then choose a safe follow-up method.`,
      signInDestination: provider === "TWILIO"
        ? "Twilio Console → Monitor → Messaging logs"
        : providerDestination(provider),
    });
  }

  if (
    [400, 404, 422].includes(status)
    || TWILIO_CODE_CATEGORIES[code] === "configuration"
    || /(?:_NOT_CONFIGURED|_INVALID_URL|_REQUIRED|INVALID REQUEST|MISSING REQUIRED|RESOURCE NOT FOUND)$/i.test(code)
    || /NOT CONFIGURED|INVALID (?:URL|REQUEST|NUMBER)|MISSING REQUIRED|COULD NOT FIND THE REQUESTED RESOURCE/i.test(source)
  ) {
    return result(details, "configuration", {
      reasonCode: "PROVIDER_CONFIGURATION_INVALID",
      reason: exactTwilio?.reason || `${label} rejected a missing, invalid, or unsupported configuration value.`,
      retryable: false,
      whatFailed: `${label} configuration or request validation failed`,
      impact: "The provider operation did not complete.",
      nextAction: exactTwilio?.nextAction || `Compare the Render environment and ${label} configuration with the expected production contract, correct the invalid value, redeploy if needed, then retry once.`,
    });
  }

  return result(details, "unknown", {
    reasonCode: "UNKNOWN_OPERATIONAL_FAILURE",
    reason: "The available safe diagnostics do not establish a specific cause. Billing, credentials, provider availability, and configuration must each be checked before retrying.",
    retryable: false,
    whatFailed: context.whatFailed || "A My AI PA operation failed for an unconfirmed reason",
    impact: "The affected operation did not finish and its provider state may need reconciliation.",
    nextAction: "Open the exact incident and provider-safe logs. Confirm the failed stage and provider state before changing funds, credentials, configuration, or retrying.",
  });
}

module.exports = {
  PROVIDER_DESTINATIONS,
  PROVIDER_LABELS,
  TWILIO_CODE_CATEGORIES,
  TWILIO_CODE_GUIDANCE,
  classifyOperationalError,
  normalizeToken,
};
