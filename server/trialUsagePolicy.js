const DEFAULT_TRIAL_WARNING_SECONDS = 20 * 60;
const DEFAULT_TRIAL_LIMIT_SECONDS = 60 * 60;
const DEFAULT_COMPLETION_RESERVE_SECONDS = 5 * 60;
const DEFAULT_MAX_CALL_SECONDS = 5 * 60;
const DEFAULT_MIN_CALL_SECONDS = 15;

const PAID_STATUSES = new Set(["active", "paid"]);
const CLOSED_STATUSES = new Set([
  "canceled",
  "cancelled",
  "expired",
  "incomplete_expired",
  "paused",
  "past_due",
  "unpaid",
]);

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function timestamp(value) {
  if (value == null || value === "") return 0;
  const direct = Number(value);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function getTrialWindow(signup = {}) {
  return {
    startAt: timestamp(signup.trialStartAt || signup.periodStartAt || signup.signedUpAt || signup.createdAt),
    endAt: timestamp(signup.trialEndAt || signup.currentPeriodEndAt || signup.periodEndAt),
  };
}

function getTrialLifecycle(signup = {}, now = Date.now()) {
  const status = String(
    signup.subscriptionStatus || signup.paymentStatus || signup.checkoutStatus || signup.status || ""
  ).trim().toLowerCase().replace(/^subscription_/, "");
  const window = getTrialWindow(signup);

  if (PAID_STATUSES.has(status)) return { state: "paid", status, ...window };
  if (CLOSED_STATUSES.has(status)) return { state: "ended", status, ...window };
  if (window.endAt && window.endAt <= now) return { state: "ended", status: status || "expired", ...window };
  if (
    status === "trialing"
    || (window.startAt && window.endAt && window.startAt <= now && now < window.endAt)
  ) {
    return { state: "trial", status: status || "trialing", ...window };
  }
  return { state: "unmanaged", status: status || "unknown", ...window };
}

function sumCallDurationSeconds(calls = [], { startAt = 0, endAt = 0 } = {}) {
  return Math.max(0, Math.floor(calls.reduce((total, call) => {
    const startedAt = timestamp(call?.startedAt || call?.createdAt);
    if (startAt && (!startedAt || startedAt < startAt)) return total;
    if (endAt && startedAt && startedAt > endAt) return total;
    const duration = Number(call?.durationSec || 0);
    return total + (Number.isFinite(duration) && duration > 0 ? duration : 0);
  }, 0)));
}

function getTrialUsage({
  usedSeconds = 0,
  warningSeconds = DEFAULT_TRIAL_WARNING_SECONDS,
  limitSeconds = DEFAULT_TRIAL_LIMIT_SECONDS,
  completionReserveSeconds = DEFAULT_COMPLETION_RESERVE_SECONDS,
} = {}) {
  const warning = positiveInteger(warningSeconds, DEFAULT_TRIAL_WARNING_SECONDS);
  const limit = Math.max(warning, positiveInteger(limitSeconds, DEFAULT_TRIAL_LIMIT_SECONDS));
  const completionReserve = Math.min(
    limit,
    positiveInteger(completionReserveSeconds, DEFAULT_COMPLETION_RESERVE_SECONDS)
  );
  const newCallCutoff = Math.max(warning, limit - completionReserve);
  const used = Math.max(0, Math.floor(Number(usedSeconds) || 0));
  const remaining = Math.max(0, limit - used);
  const newCallSecondsRemaining = Math.max(0, newCallCutoff - used);
  return {
    usedSeconds: used,
    usedMinutes: Number((used / 60).toFixed(1)),
    remainingSeconds: remaining,
    remainingMinutes: Number((remaining / 60).toFixed(1)),
    warningSeconds: warning,
    warningMinutes: Number((warning / 60).toFixed(1)),
    limitSeconds: limit,
    limitMinutes: Number((limit / 60).toFixed(1)),
    completionReserveSeconds: completionReserve,
    completionReserveMinutes: Number((completionReserve / 60).toFixed(1)),
    newCallCutoffSeconds: newCallCutoff,
    newCallCutoffMinutes: Number((newCallCutoff / 60).toFixed(1)),
    newCallSecondsRemaining,
    newCallMinutesRemaining: Number((newCallSecondsRemaining / 60).toFixed(1)),
    percentUsed: Math.max(0, Math.min(100, Math.round((used / limit) * 100))),
    warningReached: used >= warning,
    newCallsPaused: used >= newCallCutoff,
    limitReached: used >= limit,
  };
}

function decideTrialCall({
  lifecycle,
  usedSeconds = 0,
  reservedSeconds = 0,
  assistantMaxSeconds = DEFAULT_MAX_CALL_SECONDS,
  warningSeconds = DEFAULT_TRIAL_WARNING_SECONDS,
  limitSeconds = DEFAULT_TRIAL_LIMIT_SECONDS,
  completionReserveSeconds = DEFAULT_COMPLETION_RESERVE_SECONDS,
  minCallSeconds = DEFAULT_MIN_CALL_SECONDS,
} = {}) {
  const state = String(lifecycle?.state || lifecycle || "unmanaged");
  const usage = getTrialUsage({
    usedSeconds,
    warningSeconds,
    limitSeconds,
    completionReserveSeconds,
  });
  const maxCall = positiveInteger(assistantMaxSeconds, DEFAULT_MAX_CALL_SECONDS);
  const minimum = positiveInteger(minCallSeconds, DEFAULT_MIN_CALL_SECONDS);
  const reserved = Math.max(0, Math.floor(Number(reservedSeconds) || 0));

  if (state === "paid") {
    return { action: "allow-saved", allowanceSeconds: maxCall, reservedSeconds: reserved, ...usage };
  }
  if (state !== "trial") {
    return {
      action: "block",
      reason: state === "ended" ? "trial-ended" : "trial-status-unverified",
      allowanceSeconds: 0,
      reservedSeconds: reserved,
      ...usage,
    };
  }

  const availableSeconds = Math.max(0, usage.limitSeconds - usage.usedSeconds - reserved);
  const committedSeconds = usage.usedSeconds + reserved;
  if (committedSeconds >= usage.newCallCutoffSeconds) {
    return {
      action: "block",
      reason: availableSeconds < minimum ? "minute-limit-reached" : "completion-reserve-active",
      allowanceSeconds: 0,
      reservedSeconds: reserved,
      committedSeconds,
      availableSeconds,
      ...usage,
    };
  }
  if (availableSeconds < minimum) {
    return {
      action: "block",
      reason: "minute-limit-reached",
      allowanceSeconds: 0,
      reservedSeconds: reserved,
      availableSeconds,
      ...usage,
    };
  }

  const allowanceSeconds = Math.min(maxCall, availableSeconds);
  return {
    action: allowanceSeconds < maxCall ? "allow-transient" : "allow-saved",
    allowanceSeconds,
    reservedSeconds: reserved,
    availableSeconds,
    ...usage,
  };
}

function normalizeE164(value) {
  const text = String(value || "").trim();
  const digits = text.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (text.startsWith("+") && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return "";
}

function buildTrialFallbackDestination({
  fallbackPhone,
  aiPhone,
  connectingMessage = "Please hold while we connect you to the business.",
  unavailableMessage = "The team is unavailable right now. Please try again shortly.",
} = {}) {
  const number = normalizeE164(fallbackPhone);
  const aiNumber = normalizeE164(aiPhone);
  if (!number || (aiNumber && number === aiNumber)) return null;
  return {
    destination: {
      type: "number",
      number,
      numberE164CheckEnabled: true,
      message: String(connectingMessage),
      transferPlan: {
        mode: "blind-transfer",
        dialTimeout: 25,
        timeout: 30,
        fallbackPlan: {
          message: String(unavailableMessage),
          endCallEnabled: true,
        },
      },
    },
  };
}

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function sanitizeTransientAssistant(
  sourceAssistant = {},
  {
    maxDurationSeconds,
    serverUrl,
    serverSecret,
  } = {}
) {
  const assistant = cloneJson(sourceAssistant) || {};
  for (const key of [
    "id",
    "orgId",
    "createdAt",
    "updatedAt",
    "isServerUrlSecretSet",
    "serverUrlSecret",
  ]) {
    delete assistant[key];
  }

  assistant.maxDurationSeconds = positiveInteger(maxDurationSeconds, DEFAULT_MIN_CALL_SECONDS);
  assistant.serverMessages = [...new Set([
    ...(Array.isArray(assistant.serverMessages) ? assistant.serverMessages.map(String) : []),
    "end-of-call-report",
    "tool-calls",
  ])];
  if (serverUrl) {
    assistant.server = {
      ...(assistant.server && typeof assistant.server === "object" ? assistant.server : {}),
      url: String(serverUrl),
      ...(serverSecret ? { secret: String(serverSecret) } : {}),
    };
  }
  return assistant;
}

function getPendingTrialMilestone({
  usedSeconds,
  callCount = 0,
  estimatedCallsRemaining = null,
  warningSentAt,
  fifteenRemainingSentAt,
  fiveRemainingSentAt,
  limitSentAt,
  warningSeconds,
  limitSeconds,
  completionReserveSeconds,
} = {}) {
  const usage = {
    ...getTrialUsage({
      usedSeconds,
      warningSeconds,
      limitSeconds,
      completionReserveSeconds,
    }),
    callCount: Math.max(0, Math.floor(Number(callCount) || 0)),
    estimatedCallsRemaining: Number.isFinite(Number(estimatedCallsRemaining))
      ? Math.max(0, Math.floor(Number(estimatedCallsRemaining)))
      : null,
  };
  const fifteenRemainingThreshold = Math.max(
    usage.warningSeconds,
    usage.limitSeconds - 15 * 60
  );
  if (usage.limitReached && !limitSentAt) return { milestone: "limit", usage };
  if (usage.newCallsPaused && !fiveRemainingSentAt && !limitSentAt) {
    return { milestone: "five-remaining", usage };
  }
  if (
    usage.usedSeconds >= fifteenRemainingThreshold
    && !fifteenRemainingSentAt
    && !fiveRemainingSentAt
    && !limitSentAt
  ) {
    return { milestone: "fifteen-remaining", usage };
  }
  if (
    usage.warningReached
    && !warningSentAt
    && !fifteenRemainingSentAt
    && !fiveRemainingSentAt
    && !limitSentAt
  ) {
    return { milestone: "warning", usage };
  }
  return { milestone: "", usage };
}

function buildTrialUsageNotification({
  milestone,
  businessName,
  trialEndAt,
  usage,
  dashboardUrl = "https://www.myaipa.ca/#/dashboard",
} = {}) {
  const name = String(businessName || "your business").trim();
  const endDate = timestamp(trialEndAt)
    ? new Date(timestamp(trialEndAt)).toLocaleDateString("en-CA", {
        year: "numeric",
        month: "long",
        day: "numeric",
        timeZone: "America/Toronto",
      })
    : "";
  const callSummary = usage.callCount
    ? ` My AI PA has handled ${usage.callCount} ${usage.callCount === 1 ? "call" : "calls"} so far.`
    : "";
  if (milestone === "limit") {
    return {
      subject: `Your My AI PA trial has reached 60 call minutes`,
      text: [
        `Your My AI PA trial for ${name} has used its ${usage.limitMinutes} AI call minutes.`,
        "AI answering is paused, and new calls will continue through your fallback routing.",
        `Open your dashboard to review calls or activate service: ${dashboardUrl}`,
      ].join(" "),
    };
  }
  if (milestone === "five-remaining") {
    return {
      subject: `Your My AI PA trial has 5 protected call minutes remaining`,
      text: [
        `My AI PA update for ${name}: ${usage.usedMinutes} of ${usage.limitMinutes} AI minutes have been used.${callSummary}`,
        `${usage.completionReserveMinutes} minutes are reserved so a call already in progress can finish.`,
        "New calls will now use your fallback routing.",
        `Open your dashboard to review calls or activate service: ${dashboardUrl}`,
      ].join(" "),
    };
  }
  if (milestone === "fifteen-remaining") {
    return {
      subject: `Your My AI PA trial has 15 call minutes remaining`,
      text: [
        `My AI PA update for ${name}: ${usage.usedMinutes} of ${usage.limitMinutes} AI minutes have been used.${callSummary}`,
        `${usage.remainingMinutes} minutes remain.`,
        "Activate service now to keep AI answering uninterrupted.",
        `Open your dashboard: ${dashboardUrl}`,
      ].join(" "),
    };
  }
  return {
    subject: `Your My AI PA trial is one-third used`,
    text: [
      `Your My AI PA trial for ${name} has used ${usage.warningMinutes} of ${usage.limitMinutes} AI call minutes (one-third).${callSummary}`,
      `You have ${usage.remainingMinutes} minutes remaining${endDate ? `, and the trial ends ${endDate}` : ""}.`,
      `Review your calls: ${dashboardUrl}`,
    ].join(" "),
  };
}

module.exports = {
  DEFAULT_TRIAL_WARNING_SECONDS,
  DEFAULT_TRIAL_LIMIT_SECONDS,
  DEFAULT_COMPLETION_RESERVE_SECONDS,
  DEFAULT_MAX_CALL_SECONDS,
  DEFAULT_MIN_CALL_SECONDS,
  buildTrialFallbackDestination,
  getTrialWindow,
  getTrialLifecycle,
  sumCallDurationSeconds,
  getTrialUsage,
  decideTrialCall,
  sanitizeTransientAssistant,
  getPendingTrialMilestone,
  buildTrialUsageNotification,
};
