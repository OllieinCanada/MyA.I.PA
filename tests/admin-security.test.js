const test = require("node:test");
const assert = require("node:assert/strict");
const {
  decodeBase32,
  redactAuditDetails,
  totpCode,
  verifyTotpCode,
} = require("../server/adminSecurity");

test("TOTP accepts the current window and rejects invalid codes", () => {
  const secret = "JBSWY3DPEHPK3PXP";
  const atMs = Date.UTC(2026, 7, 20, 12, 0, 0);
  const code = totpCode(secret, atMs);
  assert.match(code, /^\d{6}$/);
  assert.equal(verifyTotpCode(secret, code, { atMs, window: 0 }), true);
  assert.equal(verifyTotpCode(secret, code === "000000" ? "000001" : "000000", { atMs, window: 0 }), false);
  assert.ok(decodeBase32(secret).length >= 10);
});

test("audit details redact secrets and customer contact fields", () => {
  const result = redactAuditDetails({
    action: "retry",
    password: "do-not-store",
    ownerEmail: "person@example.com",
    nested: { phoneNumber: "+19055550123", safeCode: "DELIVERY_FAILED" },
  });
  assert.equal(result.action, "retry");
  assert.equal(result.password, "[redacted]");
  assert.equal(result.ownerEmail, "[redacted]");
  assert.equal(result.nested.phoneNumber, "[redacted]");
  assert.equal(result.nested.safeCode, "DELIVERY_FAILED");
});
