const MAX_TOKEN_LENGTH = 240;

function safePart(value, maxLength = 160) {
  return String(value || "").trim().slice(0, maxLength);
}

function getHeader(headers = {}, name) {
  const key = String(name || "").toLowerCase();
  if (typeof headers.get === "function") return safePart(headers.get(key), MAX_TOKEN_LENGTH);
  const match = Object.keys(headers || {}).find((candidate) => candidate.toLowerCase() === key);
  return match ? safePart(headers[match], MAX_TOKEN_LENGTH) : "";
}

function getTwilioRetryToken(headers = {}) {
  const token = getHeader(headers, "i-twilio-idempotency-token");
  return /^[A-Za-z0-9._~:+\/-]{8,240}$/.test(token) ? token : "";
}

function buildTwilioReplayIdentity({ headers = {}, body = {}, eventType = "" } = {}) {
  const retryToken = getTwilioRetryToken(headers);
  if (retryToken) return `retry:${retryToken}`;

  const type = safePart(eventType, 80).toLowerCase();
  if (type === "message_status") {
    const sid = safePart(body.MessageSid || body.SmsSid);
    const status = safePart(body.MessageStatus || body.SmsStatus, 60).toLowerCase();
    const errorCode = safePart(body.ErrorCode, 40);
    return sid && status ? `message:${sid}:${status}:${errorCode || "none"}` : "";
  }
  if (type === "inbound_sms") {
    const sid = safePart(body.MessageSid || body.SmsSid);
    return sid ? `sms:${sid}` : "";
  }
  if (type === "forwarding_verification_status") {
    const sid = safePart(body.CallSid);
    const status = safePart(body.CallStatus, 60).toLowerCase();
    const answeredBy = safePart(body.AnsweredBy, 60).toLowerCase();
    return sid && status ? `forwarding:${sid}:${status}:${answeredBy || "unknown"}` : "";
  }
  if (type === "call_status") {
    const sid = safePart(body.CallSid);
    const status = safePart(body.CallStatus, 60).toLowerCase();
    return sid && status ? `call:${sid}:${status}` : "";
  }
  return "";
}

module.exports = {
  buildTwilioReplayIdentity,
  getTwilioRetryToken,
};
