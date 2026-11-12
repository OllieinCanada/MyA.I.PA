const { isDeepStrictEqual } = require('node:util');

function parseObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function firstObject(...values) {
  for (const value of values) {
    const parsed = parseObject(value);
    if (Object.keys(parsed).length) return parsed;
  }
  return {};
}

function toolArgumentValues(source) {
  const wrapped = source?.toolCall;
  return [source?.parameters, source?.arguments, source?.function?.parameters, source?.function?.arguments,
    wrapped?.parameters, wrapped?.arguments, wrapped?.function?.parameters, wrapped?.function?.arguments,
    source?.functionCall?.parameters, source?.functionCall?.arguments];
}

// Wire-format admission only. Domain validation, trusted tenant routing and
// authorization remain separate requirements. Never include arguments or JSON
// parser diagnostics in this result: they can contain caller data and secrets.
function validateVapiToolArguments(source) {
  const invalid = errorCode => ({ ok: false, errorCode, executionState: 'not_started',
    actionAttempted: false, priorExecution: 'not_checked', requiresCorrection: true });
  const objects = [];
  for (const value of toolArgumentValues(source)) {
    // Preserve empty alias placeholders used alongside real Vapi arguments.
    if (value == null || typeof value === 'string' && !value.trim()) continue;
    let parsed = value;
    if (typeof value === 'string') {
      try { parsed = JSON.parse(value); } catch { return invalid('VAPI_TOOL_ARGUMENTS_INVALID'); }
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(parsed))) return invalid('VAPI_TOOL_ARGUMENTS_INVALID');
    objects.push(parsed);
  }
  if (!objects.length) return invalid('VAPI_TOOL_ARGUMENTS_REQUIRED');
  // Empty objects retain the historical placeholder semantics, but conflicting
  // nonempty aliases must not silently choose a recipient, time or request.
  const nonempty = objects.filter(value => Object.keys(value).length);
  if (nonempty.some(value => !isDeepStrictEqual(value, nonempty[0]))) return invalid('VAPI_TOOL_ARGUMENTS_CONFLICT');
  return { ok: true };
}

function normalizeVapiToolCall(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const wrapped = source.toolCall && typeof source.toolCall === "object" ? source.toolCall : {};
  const sourceFunction = source.function && typeof source.function === "object" ? source.function : {};
  const wrappedFunction = wrapped.function && typeof wrapped.function === "object" ? wrapped.function : {};
  const functionCall = source.functionCall && typeof source.functionCall === "object" ? source.functionCall : {};

  const id = String(
    source.id
      || source.toolCallId
      || source.tool_call_id
      || wrapped.id
      || functionCall.id
      || ""
  ).trim();
  const name = String(
    source.name
      || sourceFunction.name
      || wrapped.name
      || wrappedFunction.name
      || functionCall.name
      || ""
  ).trim();
  const parameters = firstObject(...toolArgumentValues(source));

  return {
    ...source,
    id,
    name,
    parameters,
  };
}

function cleanString(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function safeCalendarEventUrl(value, provider) {
  const candidate = cleanString(value, 2000);
  if (!candidate) return "";
  try {
    const parsed = new URL(candidate);
    const allowedHosts = provider === "GOOGLE"
      ? new Set(["calendar.google.com"])
      : new Set(["outlook.live.com", "outlook.office.com", "outlook.office365.com"]);
    return parsed.protocol === "https:" && allowedHosts.has(parsed.hostname.toLowerCase())
      ? parsed.toString()
      : "";
  } catch {
    return "";
  }
}

function summarizeVapiCalendarSync(calendarSync, appointmentStatus) {
  const status = cleanString(appointmentStatus, 40).toUpperCase();
  const sync = calendarSync && typeof calendarSync === "object" && !Array.isArray(calendarSync)
    ? calendarSync
    : null;
  if (!sync) {
    return status === "CONFIRMED"
      ? { ok: false, status: "NOT_REPORTED" }
      : null;
  }

  const externalEvent = sync.externalEvent && typeof sync.externalEvent === "object" && !Array.isArray(sync.externalEvent)
    ? sync.externalEvent
    : {};
  const providerValue = cleanString(sync.provider || externalEvent.provider, 20).toUpperCase();
  const provider = ["GOOGLE", "MICROSOFT"].includes(providerValue) ? providerValue : "";
  const externalStatus = cleanString(externalEvent.status, 40).toUpperCase();
  const syncStatus = sync.ok === true
    ? (externalStatus || "SYNCED")
    : (sync.skipped === true ? "SKIPPED" : "ERROR");
  const eventId = cleanString(externalEvent.externalEventId, 500);
  const eventUrl = safeCalendarEventUrl(externalEvent.webLink, provider);
  const reasonValue = cleanString(sync.reason, 100).toLowerCase();
  const reason = ["email_invites_only", "no_connected_calendar", "not_confirmed"].includes(reasonValue)
    ? reasonValue
    : "";

  return {
    ok: sync.ok === true,
    status: syncStatus,
    ...(provider ? { provider } : {}),
    ...(eventId ? { eventId } : {}),
    ...(eventUrl ? { eventUrl } : {}),
    ...(!sync.ok && reason ? { reason } : {}),
  };
}

function buildVapiAppointmentExecutionResult(booking = {}) {
  const source = booking && typeof booking === "object" && !Array.isArray(booking) ? booking : {};
  const appointment = source.appointment && typeof source.appointment === "object" && !Array.isArray(source.appointment)
    ? source.appointment
    : {};
  const status = cleanString(source.status || appointment.status, 40).toUpperCase();
  const appointmentId = cleanString(appointment.id, 180);
  const customerMessage = cleanString(source.customerMessage, 500);

  return {
    ok: source.ok !== false,
    ...(appointmentId ? { appointmentId } : {}),
    ...(status ? { status } : {}),
    ...(customerMessage ? { customerMessage } : {}),
    calendarSync: summarizeVapiCalendarSync(source.calendarSync, status),
  };
}

module.exports = {
  buildVapiAppointmentExecutionResult,
  normalizeVapiToolCall,
  parseObject,
  summarizeVapiCalendarSync,
  validateVapiToolArguments,
};
