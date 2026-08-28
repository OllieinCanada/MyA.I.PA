const crypto = require("crypto");

const FAILED_MESSAGE_STATUSES = new Set(["canceled", "failed", "undelivered"]);

function normalizeStatus(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z_-]+/g, "")
    .slice(0, 40);
}

function normalizeProviderCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_.:-]+/g, "_")
    .slice(0, 40);
}

function messageReference(value) {
  const sid = String(value || "").trim();
  return sid
    ? crypto.createHash("sha256").update(sid).digest("hex").slice(0, 12)
    : "not-available";
}

function buildTwilioMessageStatusIncident(body = {}) {
  const status = normalizeStatus(body.MessageStatus || body.SmsStatus);
  if (!FAILED_MESSAGE_STATUSES.has(status)) return null;
  const providerCode = normalizeProviderCode(body.ErrorCode) || "TWILIO_MESSAGE_UNDELIVERED";
  const reference = messageReference(body.MessageSid || body.SmsSid);
  const error = new Error("Twilio reported a terminal text-message delivery failure.");
  error.code = providerCode;
  error.provider = "twilio";
  error.providerCode = providerCode;
  return {
    error,
    context: {
      area: "text-message delivery",
      provider: "twilio",
      operation: "message delivery status callback",
      reasonCode: providerCode,
      whatFailed: "Twilio reported that a text message was not delivered",
      impact: "The intended recipient may not have received the message, so its associated handoff or confirmation remains incomplete.",
      snapshot: {
        "Delivery status": status,
        "Provider code": providerCode,
        "Message reference": reference,
      },
      lastCheckpoint: "Twilio accepted the message request and later reported this terminal delivery status.",
      dedupeFingerprint: `twilio-message-status:${reference}:${status}:${providerCode}`,
    },
  };
}

module.exports = {
  FAILED_MESSAGE_STATUSES,
  buildTwilioMessageStatusIncident,
  messageReference,
  normalizeProviderCode,
  normalizeStatus,
};
