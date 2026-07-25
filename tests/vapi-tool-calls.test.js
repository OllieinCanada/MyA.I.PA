const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeVapiToolCall, parseObject } = require("../server/vapiToolCalls");
const { getVapiToolExecutionIdentity } = require("../server/vapiToolSecurity");

const booking = {
  customerName: "API Calendar Test",
  customerPhone: "+19055555488",
  service: "Calendar integration test",
  requestedStart: "2026-07-27T10:00:00-04:00",
  durationMinutes: 60,
  timezone: "America/Toronto",
};

test("normalizes the legacy Vapi top-level parameters shape", () => {
  const normalized = normalizeVapiToolCall({
    id: "legacy-call",
    name: "request_appointment",
    parameters: booking,
  });
  assert.equal(normalized.id, "legacy-call");
  assert.equal(normalized.name, "request_appointment");
  assert.deepEqual(normalized.parameters, booking);
});

test("normalizes the current documented Vapi arguments shape", () => {
  const normalized = normalizeVapiToolCall({
    id: "documented-call",
    name: "request_appointment",
    arguments: booking,
  });
  assert.equal(normalized.id, "documented-call");
  assert.equal(normalized.name, "request_appointment");
  assert.deepEqual(normalized.parameters, booking);
});

test("normalizes nested function calls with JSON arguments from Vapi chat", () => {
  const normalized = normalizeVapiToolCall({
    id: "chat-call",
    type: "function",
    function: {
      name: "request_appointment",
      arguments: JSON.stringify(booking),
    },
  });
  assert.equal(normalized.id, "chat-call");
  assert.equal(normalized.name, "request_appointment");
  assert.deepEqual(normalized.parameters, booking);
});

test("normalizes toolWithToolCallList wrapper entries", () => {
  const normalized = normalizeVapiToolCall({
    type: "function",
    toolCall: {
      id: "wrapped-call",
      function: {
        name: "request_appointment",
        parameters: booking,
      },
    },
  });
  assert.equal(normalized.id, "wrapped-call");
  assert.equal(normalized.name, "request_appointment");
  assert.deepEqual(normalized.parameters, booking);
});

test("normalized calls retain idempotent execution identity", () => {
  const normalized = normalizeVapiToolCall({
    id: "chat-call",
    function: {
      name: "request_appointment",
      arguments: booking,
    },
  });
  const identity = getVapiToolExecutionIdentity({
    toolCall: normalized,
    businessId: 7,
    call: { id: "chat-session" },
  });
  assert.equal(identity.toolName, "request_appointment");
  assert.equal(identity.toolCallId, "chat-call");
  assert.equal(identity.businessId, 7);
});

test("invalid serialized tool arguments safely become an empty object", () => {
  assert.deepEqual(parseObject("{not-json"), {});
  assert.deepEqual(normalizeVapiToolCall({
    id: "invalid-call",
    function: { name: "request_appointment", arguments: "{not-json" },
  }).parameters, {});
});
