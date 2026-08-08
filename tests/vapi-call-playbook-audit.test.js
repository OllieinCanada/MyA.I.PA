const test = require("node:test");
const assert = require("node:assert/strict");
const { analyzeCall } = require("../scripts/audit-vapi-call-playbooks");

const context = {
  phoneById: new Map(),
  assistantById: new Map(),
  ownedPhones: new Set(),
  testCallerNumbers: new Set(),
};

function analyze(transcript, overrides = {}) {
  return analyzeCall({
    id: `test-${Math.random()}`,
    createdAt: "2026-08-08T00:00:00.000Z",
    _assistantName: "First Class Rentals Niagara AI",
    transcript,
    endedReason: "assistant-ended-call",
    ...overrides,
  }, context);
}

test("explicit safety negatives are not reported as an unhandled emergency", () => {
  const result = analyze([
    "AI: Are there any safety concerns?",
    "User: There is no smoke, gas smell, or carbon monoxide alarm.",
    "AI: Thank you. What is the property address?",
  ].join("\n"));
  assert.equal(result.flags.includes("safety_response_unconfirmed"), false);
});

test("an affirmative gas-smell report requires a safety response", () => {
  const result = analyze([
    "AI: How can I help?",
    "User: I smell gas beside the furnace.",
    "AI: What is the property address?",
  ].join("\n"));
  assert.equal(result.flags.includes("safety_response_unconfirmed"), true);
});

test("re-asking an unanswered field after storing another answer is allowed", () => {
  const result = analyze([
    "AI: What callback number should we use?",
    "User: The address is 10 Test Street.",
    "AI: Thank you for the address. What callback number should we use?",
  ].join("\n"));
  assert.equal(result.flags.includes("repeated_questions"), false);
});

test("re-asking a confirmed callback number is reported", () => {
  const result = analyze([
    "AI: What callback number should we use?",
    "User: Use the number I am calling from.",
    "AI: What callback number should we use?",
  ].join("\n"));
  assert.equal(result.flags.includes("repeated_questions"), true);
  assert.equal(result.flags.includes("calling_number_not_reused"), true);
});

test("a caller ending after the approved closing is not treated as forced disconnect", () => {
  const result = analyze([
    "AI: Is there anything else you would like me to add?",
    "User: No thanks. Goodbye.",
    "AI: Thanks for calling First Class Rentals Niagara. Take care.",
  ].join("\n"), { endedReason: "customer-ended-call" });
  assert.equal(result.flags.includes("caller_had_to_disconnect"), false);
  assert.equal(result.flags.includes("missing_closing_after_goodbye"), false);
});

test("spoken First Class Rentals name drift is reported", () => {
  const result = analyze([
    "AI: Thanks for calling First Cloud Rentals Niagara.",
    "User: I need to leave a maintenance message.",
  ].join("\n"));
  assert.equal(result.flags.includes("business_name_drift"), true);
});
