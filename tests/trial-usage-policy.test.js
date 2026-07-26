const test = require("node:test");
const assert = require("node:assert/strict");

const {
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

test("the final trial call receives only the exact remaining seconds", () => {
  const decision = decideTrialCall({
    lifecycle: { state: "trial" },
    usedSeconds: 59 * 60,
    assistantMaxSeconds: 300,
  });
  assert.equal(decision.action, "allow-transient");
  assert.equal(decision.allowanceSeconds, 60);
});

test("active reservations prevent concurrent calls from exceeding 60 minutes", () => {
  const first = decideTrialCall({
    lifecycle: { state: "trial" },
    usedSeconds: 57 * 60,
    reservedSeconds: 0,
    assistantMaxSeconds: 300,
  });
  assert.equal(first.allowanceSeconds, 180);

  const second = decideTrialCall({
    lifecycle: { state: "trial" },
    usedSeconds: 57 * 60,
    reservedSeconds: first.allowanceSeconds,
    assistantMaxSeconds: 300,
  });
  assert.equal(second.action, "block");
  assert.equal(second.reason, "minute-limit-reached");
});

test("a trial at the 60-minute limit is blocked", () => {
  const decision = decideTrialCall({
    lifecycle: { state: "trial" },
    usedSeconds: 60 * 60,
  });
  assert.equal(decision.action, "block");
  assert.equal(decision.allowanceSeconds, 0);
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
  const usage = getTrialUsage({ usedSeconds: 1200 });
  const notification = buildTrialUsageNotification({
    milestone: "warning",
    businessName: "Example Electric",
    trialEndAt: "2026-08-01T12:00:00.000Z",
    usage,
  });
  assert.match(notification.text, /at least 20 of 60 AI call minutes \(one-third\)/);
  assert.match(notification.text, /40 minutes remaining/);
});
