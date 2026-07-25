const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildVapiAppointmentExecutionResult,
  normalizeVapiToolCall,
  parseObject,
  summarizeVapiCalendarSync,
} = require("../server/vapiToolCalls");
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

test("confirmed Vapi bookings expose sanitized Google sync proof", () => {
  const result = buildVapiAppointmentExecutionResult({
    ok: true,
    status: "CONFIRMED",
    customerMessage: "Your appointment is confirmed.",
    appointment: { id: "appointment-17", calendarToken: "must-not-leak" },
    calendarSync: {
      ok: true,
      provider: "GOOGLE",
      connectionId: "must-not-leak",
      externalEvent: {
        provider: "GOOGLE",
        status: "SYNCED",
        externalEventId: "google-event-17",
        webLink: "https://calendar.google.com/calendar/event?eid=17",
        etag: "must-not-leak",
        accessTokenEncrypted: "must-not-leak",
      },
    },
  });

  assert.deepEqual(result, {
    ok: true,
    appointmentId: "appointment-17",
    status: "CONFIRMED",
    customerMessage: "Your appointment is confirmed.",
    calendarSync: {
      ok: true,
      status: "SYNCED",
      provider: "GOOGLE",
      eventId: "google-event-17",
      eventUrl: "https://calendar.google.com/calendar/event?eid=17",
    },
  });
  assert.doesNotMatch(JSON.stringify(result), /calendarToken|connectionId|etag|accessToken|must-not-leak/i);
});

test("confirmed bookings no longer imply calendar success when sync proof is absent", () => {
  const result = buildVapiAppointmentExecutionResult({
    status: "CONFIRMED",
    appointment: { id: "appointment-18" },
    customerMessage: "Your appointment is confirmed.",
  });
  assert.deepEqual(result.calendarSync, { ok: false, status: "NOT_REPORTED" });
});

test("calendar sync failures expose a bounded state without provider error details", () => {
  const result = summarizeVapiCalendarSync({
    ok: false,
    provider: "GOOGLE",
    error: "Provider error with private customer and token details",
  }, "CONFIRMED");
  assert.deepEqual(result, { ok: false, status: "ERROR", provider: "GOOGLE" });
  assert.doesNotMatch(JSON.stringify(result), /private|token|customer/i);
});

test("pending bookings do not claim a calendar sync result", () => {
  const result = buildVapiAppointmentExecutionResult({
    status: "PENDING",
    appointment: { id: "appointment-19" },
  });
  assert.equal(result.calendarSync, null);
});

test("unsafe provider links are omitted from Vapi calendar proof", () => {
  for (const webLink of [
    "javascript:alert(document.domain)",
    "https://attacker.example/calendar?token=must-not-leak",
  ]) {
    const result = summarizeVapiCalendarSync({
      ok: true,
      provider: "GOOGLE",
      externalEvent: {
        externalEventId: "google-event-20",
        webLink,
      },
    }, "CONFIRMED");
    assert.deepEqual(result, {
      ok: true,
      status: "SYNCED",
      provider: "GOOGLE",
      eventId: "google-event-20",
    });
  }
});
