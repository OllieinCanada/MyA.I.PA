function normalizeVerificationChannel(value) {
  return String(value || "").trim().toLowerCase() === "sms" ? "sms" : "email";
}

function buildVerificationState(channel, existing = {}, verifiedAt = new Date().toISOString()) {
  const normalized = normalizeVerificationChannel(channel);
  return {
    ...existing,
    identityVerified: true,
    identityVerifiedAt: verifiedAt,
    verificationChannel: normalized,
    emailVerified: Boolean(existing.emailVerified || normalized === "email"),
    smsVerified: Boolean(existing.smsVerified || normalized === "sms"),
  };
}

function isContactVerified(value = {}) {
  const verification = value.verification && typeof value.verification === "object" ? value.verification : value;
  return Boolean(
    verification.identityVerified || verification.identityVerifiedAt
    || verification.emailVerified || verification.emailVerifiedAt
    || verification.smsVerified || verification.smsVerifiedAt
  );
}

function createVerificationChannelProof(token, channel, secret) {
  return crypto.createHmac("sha256", String(secret || ""))
    .update(`signup-verification-channel:v1:${String(token || "")}:${normalizeVerificationChannel(channel)}`)
    .digest("base64url");
}

function verifyVerificationChannelProof(token, channel, proof, secret) {
  const expected = createVerificationChannelProof(token, channel, secret);
  const actual = String(proof || "");
  if (!actual || actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

function createVerificationConfirmationProof(token, channel, secret) {
  return crypto.createHmac("sha256", String(secret || ""))
    .update(`signup-verification-confirmation:v1:${String(token || "")}:${normalizeVerificationChannel(channel)}`)
    .digest("base64url");
}

function verifyVerificationConfirmationProof(token, channel, proof, secret) {
  const expected = createVerificationConfirmationProof(token, channel, secret);
  const actual = String(proof || "");
  return actual.length === expected.length
    && crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

module.exports = {
  buildVerificationState,
  createVerificationChannelProof,
  createVerificationConfirmationProof,
  isContactVerified,
  normalizeVerificationChannel,
  verifyVerificationChannelProof,
  verifyVerificationConfirmationProof,
};
const crypto = require("crypto");
