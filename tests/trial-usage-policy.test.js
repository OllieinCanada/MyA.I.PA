const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildTrialFallbackDestination,
  buildTrialUsageNotification,
  decideTrialCall,
  getPendingTrialMilestone,
  getTrialLifecycle,
  getTrialUsage,
  sanitizeTransientAssistant,
  sumCallDurationSeconds,
} = require("../server/trialUsagePolicy");

test("20 minutes is one-third of the 60-minute trial and creates one warning", () => {
  const result = getPendingTrialMilestone({ usedSeconds: 20 * 60 });
  assert.equal(result.milestone, "warning");
  assert.equal(result.usage.warningReached, true);
  assert.equal(result.usage.limitReached, false);
  assert.equal(result.usage.remainingMinutes, 40);

  const duplicate = getPendingTrialMilestone({
    usedSeconds: 20 * 60,
    warningSentAt: "2026-07-25T12:00:00.000Z",
  });
  assert.equal(duplicate.milestone, "");
});

test("a paid subscription bypasses the trial minute gate", () => {
  const lifecycle = getTrialLifecycle({ subscriptionStatus: "active" });
  const decision = decideTrialCall({ lifecycle, usedSeconds: 6000, assistantMaxSeconds: 300 });
  assert.equal(decision.action, "allow-saved");
  assert.equal(decision.allowanceSeconds, 300);
});

test("the final five minutes are protected for a call started before the 55-minute cutoff", () => {
  const decision = decideTrialCall({
    lifecycle: { state: "trial" },
    usedSeconds: 54 * 60,
    assistantMaxSeconds: 300,
  });
  assert.equal(decision.action, "allow-saved");
  assert.equal(decision.allowanceSeconds, 300);
  assert.equal(decision.newCallMinutesRemaining, 1);
});

test("active reservations prevent concurrent calls from consuming the completion reserve", () => {
  const first = decideTrialCall({
    lifecycle: { state: "trial" },
    usedSeconds: 54 * 60,
    reservedSeconds: 0,
    assistantMaxSeconds: 300,
  });
  assert.equal(first.allowanceSeconds, 300);

  const second = decideTrialCall({
    lifecycle: { state: "trial" },
    usedSeconds: 54 * 60,
    reservedSeconds: first.allowanceSeconds,
    assistantMaxSeconds: 300,
  });
  assert.equal(second.action, "block");
  assert.equal(second.reason, "completion-reserve-active");
});

test("new AI calls pause at 55 minutes while five minutes remain protected", () => {
  const decision = decideTrialCall({
    lifecycle: { state: "trial" },
    usedSeconds: 55 * 60,
  });
  assert.equal(decision.action, "block");
  assert.equal(decision.reason, "completion-reserve-active");
  assert.equal(decision.allowanceSeconds, 0);
  assert.equal(decision.newCallsPaused, true);
  assert.equal(decision.limitReached, false);
  assert.equal(decision.remainingMinutes, 5);
});

test("a trial at the 60-minute hard limit remains blocked", () => {
  const decision = decideTrialCall({
    lifecycle: { state: "trial" },
    usedSeconds: 60 * 60,
  });
  assert.equal(decision.action, "block");
  assert.equal(decision.reason, "minute-limit-reached");
  assert.equal(decision.limitReached, true);
});

test("call totals only include calls inside the trial window", () => {
  const calls = [
    { startedAt: "2026-07-01T00:00:00.000Z", durationSec: 600 },
    { startedAt: "2026-07-10T00:00:00.000Z", durationSec: 900 },
    { startedAt: "2026-08-01T00:00:00.000Z", durationSec: 1200 },
  ];
  assert.equal(sumCallDurationSeconds(calls, {
    startAt: Date.parse("2026-07-05T00:00:00.000Z"),
    endAt: Date.parse("2026-07-20T00:00:00.000Z"),
  }), 900);
});

test("transient assistant keeps behavior but removes immutable fields and caps duration", () => {
  const assistant = sanitizeTransientAssistant({
    id: "assistant-id",
    orgId: "org-id",
    createdAt: "yesterday",
    name: "Trade receptionist",
    maxDurationSeconds: 300,
    model: { provider: "openai", model: "gpt-4.1-mini" },
    serverMessages: ["status-update"],
  }, {
    maxDurationSeconds: 42,
    serverUrl: "https://api.example.com/api/webhooks/voice",
    serverSecret: "webhook-secret",
  });
  assert.equal(assistant.id, undefined);
  assert.equal(assistant.orgId, undefined);
  assert.equal(assistant.name, "Trade receptionist");
  assert.equal(assistant.maxDurationSeconds, 42);
  assert.equal(assistant.server.url, "https://api.example.com/api/webhooks/voice");
  assert.equal(assistant.server.secret, "webhook-secret");
  assert.deepEqual(assistant.serverMessages, ["status-update", "end-of-call-report", "tool-calls"]);
});

test("warning notification clearly states one-third usage", () => {
  const usage = { ...getTrialUsage({ usedSeconds: 1200 }), callCount: 12 };
  const notification = buildTrialUsageNotification({
    milestone: "warning",
    businessName: "Example Electric",
    trialEndAt: "2026-08-01T12:00:00.000Z",
    usage,
  });
  assert.match(notification.text, /20 of 60 AI call minutes \(one-third\)/);
  assert.match(notification.text, /handled 12 calls/);
  assert.match(notification.text, /40 minutes remaining/);
});

test("45- and 55-minute milestones are sent once in descending priority", () => {
  const fifteen = getPendingTrialMilestone({
    usedSeconds: 45 * 60,
    warningSentAt: "2026-07-25T12:00:00.000Z",
  });
  assert.equal(fifteen.milestone, "fifteen-remaining");
  assert.equal(fifteen.usage.remainingMinutes, 15);

  const five = getPendingTrialMilestone({
    usedSeconds: 55 * 60,
    warningSentAt: "2026-07-25T12:00:00.000Z",
    fifteenRemainingSentAt: "2026-07-25T12:20:00.000Z",
  });
  assert.equal(five.milestone, "five-remaining");
  assert.equal(five.usage.newCallsPaused, true);

  const duplicate = getPendingTrialMilestone({
    usedSeconds: 55 * 60,
    fiveRemainingSentAt: "2026-07-25T12:40:00.000Z",
  });
  assert.equal(duplicate.milestone, "");
});

test("remaining-minute notifications explain uninterrupted service and fallback routing", () => {
  const fifteen = buildTrialUsageNotification({
    milestone: "fifteen-remaining",
    businessName: "Example Electric",
    usage: { ...getTrialUsage({ usedSeconds: 45 * 60 }), callCount: 28 },
  });
  assert.match(fifteen.text, /15 minutes remain/);
  assert.match(fifteen.text, /keep AI answering uninterrupted/);

  const five = buildTrialUsageNotification({
    milestone: "five-remaining",
    businessName: "Example Electric",
    usage: { ...getTrialUsage({ usedSeconds: 55 * 60 }), callCount: 34 },
  });
  assert.match(five.text, /5 minutes are reserved/);
  assert.match(five.text, /New calls will now use your fallback routing/);
});

test("trial fallback transfers without mentioning the trial and prevents routing loops", () => {
  const fallback = buildTrialFallbackDestination({
    fallbackPhone: "(905) 788-5488",
    aiPhone: "+12494682588",
  });
  assert.equal(fallback.destination.type, "number");
  assert.equal(fallback.destination.number, "+19057885488");
  assert.match(fallback.destination.message, /connect you to the business/i);
  assert.doesNotMatch(JSON.stringify(fallback), /trial|minute/i);

  assert.equal(buildTrialFallbackDestination({
    fallbackPhone: "+12494682588",
    aiPhone: "+12494682588",
  }), null);
});
