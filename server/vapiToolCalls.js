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
  const parameters = firstObject(
    source.parameters,
    source.arguments,
    sourceFunction.parameters,
    sourceFunction.arguments,
    wrapped.parameters,
    wrapped.arguments,
    wrappedFunction.parameters,
    wrappedFunction.arguments,
    functionCall.parameters,
    functionCall.arguments
  );

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
};
