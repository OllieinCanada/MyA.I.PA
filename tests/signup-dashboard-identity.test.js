const assert = require("node:assert/strict");
const test = require("node:test");

const {
  canRemoveSignupAlias,
  findSignupDashboardExistingKey,
  getSignupAliases,
  normalizeSignupSubmissionId,
} = require("../server/signupDashboardIdentity");

test("accepts only random UUID submission identities", () => {
  assert.equal(
    normalizeSignupSubmissionId("BF618A68-091F-4F3F-8F93-9B0F4544F512"),
    "bf618a68-091f-4f3f-8f93-9b0f4544f512"
  );
  assert.equal(normalizeSignupSubmissionId("johns-painting"), "");
  assert.equal(normalizeSignupSubmissionId("00000000-0000-0000-0000-000000000000"), "");
});

test("a new signup attempt never inherits an older signup that reused the same email", () => {
  const oldAttempt = {
    signupAttemptId: "signup_old",
    ownerEmail: "owner@example.com",
    businessName: "David Electrical",
    twilioPhoneNumber: "+12892169256",
    vapiAssistantId: "assistant-old",
  };
  const store = {
    "email:owner@example.com": oldAttempt,
  };
  const johnsAttempt = {
    signupAttemptId: "signup_johns_painting",
    ownerEmail: "owner@example.com",
    businessName: "John's Painting",
    status: "review_required",
  };

  const key = findSignupDashboardExistingKey(store, johnsAttempt);
  const merged = { ...(store[key] || {}), ...johnsAttempt };

  assert.equal(key, "attempt:signup_johns_painting");
  assert.equal(merged.twilioPhoneNumber, undefined);
  assert.equal(merged.vapiAssistantId, undefined);
  assert.equal(canRemoveSignupAlias(oldAttempt, merged), false);
});

test("updates for the same attempt retain their existing legacy dashboard record", () => {
  const store = {
    "email:owner@example.com": {
      signupAttemptId: "signup_same_attempt",
      ownerEmail: "owner@example.com",
      status: "signup_received",
    },
  };

  assert.equal(findSignupDashboardExistingKey(store, {
    signupAttemptId: "signup_same_attempt",
    ownerEmail: "owner@example.com",
    status: "review_required",
  }), "email:owner@example.com");
});

test("attempt aliases are first-class and only exact-attempt duplicates are removable", () => {
  const aliases = getSignupAliases({
    signupAttemptId: "signup_exact",
    ownerEmail: "owner@example.com",
    subscriptionId: "sub_123",
  });

  assert.equal(aliases[0], "attempt:signup_exact");
  assert.equal(canRemoveSignupAlias(
    { signupAttemptId: "signup_exact" },
    { signupAttemptId: "signup_exact" }
  ), true);
  assert.equal(canRemoveSignupAlias(
    { signupAttemptId: "signup_other" },
    { signupAttemptId: "signup_exact" }
  ), false);
});
