const test = require("node:test");
const assert = require("node:assert/strict");
const {
  signupAttentionItems,
  summarizeAttention,
} = require("../server/operationalAttention");

test("failed and stuck signups become redacted attention items", () => {
  const now = new Date("2026-08-20T12:00:00.000Z");
  const items = signupAttentionItems([
    { ownerEmail: "private@example.com", status: "setup_error", makeError: "upstream failed", updatedAt: "2026-08-20T11:58:00.000Z" },
    { ownerEmail: "stuck@example.com", status: "setup_started", updatedAt: "2026-08-20T09:00:00.000Z" },
  ], now, 60);
  assert.equal(items.length, 2);
  assert.deepEqual(items.map((item) => item.kind).sort(), ["signup_failed", "signup_stuck"]);
  assert.equal(JSON.stringify(items).includes("private@example.com"), false);
  assert.equal(JSON.stringify(items).includes("upstream failed"), false);
  assert.ok(items.every((item) => item.targetId.length === 24));
  assert.deepEqual(items[0].diagnostics, {
    status: "setup_error",
    paymentStatus: "",
    makeStatus: null,
    makeError: true,
    smsRoutingStatus: "",
    signupSource: "",
    reviewRequired: false,
    emailVerified: false,
    smsVerified: false,
    hasAssignedPhone: false,
    hasAssistant: false,
    hasCheckout: false,
    hasSubscription: false,
  });
});

test("attention summary groups critical and warning issues", () => {
  const summary = summarizeAttention([
    { kind: "signup_failed", severity: "critical" },
    { kind: "owner_text_failed", severity: "critical" },
    { kind: "signup_stuck", severity: "warning" },
  ]);
  assert.equal(summary.total, 3);
  assert.equal(summary.bySeverity.critical, 2);
  assert.equal(summary.bySeverity.warning, 1);
  assert.equal(summary.byKind.signup_failed, 1);
  assert.equal(summary.healthy, false);
});

test("pending verification exposes a guarded resend action after it becomes stuck", () => {
  const now = new Date("2026-08-20T04:00:00.000Z");
  const items = signupAttentionItems([
    { ownerEmail: "owner@example.com", businessName: "Example Co", status: "pending_email_verification", updatedAt: "2026-08-20T02:30:00.000Z" },
  ], now, 60);
  assert.equal(items.length, 1);
  assert.deepEqual(items[0].actions, ["resend_signup_verification", "reopen_signup"]);
});
