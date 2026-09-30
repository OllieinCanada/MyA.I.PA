const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildFailureContext,
  classifyLoginIdentity,
  getLoginAttemptSource,
  maskEmail,
  maskPhone,
} = require("../server/customerDashboardLoginDiagnostics");
const { buildIncidentTelegramAlert } = require("../server/incidentAlerts");
const { buildRuntimeIncident } = require("../server/runtimeAlerts");

const records = [
  {
    businessName: "Super Dave's Plumbing",
    ownerEmail: "superdaveyyz@gmail.com",
    ownerPhone: "+19059647422",
  },
  {
    businessName: "Another Business",
    ownerEmail: "other@example.com",
    ownerPhone: "+19055550123",
  },
];

const helpers = {
  records,
  isValidEmail: (value) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value),
  normalizePhone: (value) => {
    const digits = String(value || "").replace(/\D/g, "");
    return digits.length === 10 ? `+1${digits}` : digits.startsWith("1") ? `+${digits}` : digits;
  },
  emailsForRecord: (record) => [record.ownerEmail.toLowerCase()],
  phonesMatch: (left, right) => String(left).replace(/\D/g, "") === String(right).replace(/\D/g, ""),
  sortRecords: (items) => [...items],
};

test("dashboard login diagnostics identify the wrong half without storing raw credentials", () => {
  const wrongEmail = classifyLoginIdentity({
    ...helpers,
    email: "typo@gmail.com",
    phone: "905-964-7422",
  });
  assert.equal(wrongEmail.reason, "email_mismatch");
  assert.equal(wrongEmail.businessName, "Super Dave's Plumbing");
  assert.equal(wrongEmail.enteredEmail, "t•••@gmail.com");
  assert.equal(wrongEmail.expectedEmail, "s•••@gmail.com");
  assert.equal(wrongEmail.candidateCount, 1);
  assert.equal(wrongEmail.enteredPhone, "••• ••• 7422");
  assert.equal(JSON.stringify(wrongEmail).includes("typo@gmail.com"), false);
  assert.equal(JSON.stringify(wrongEmail).includes("9059647422"), false);

  const wrongPhone = classifyLoginIdentity({
    ...helpers,
    email: "superdaveyyz@gmail.com",
    phone: "905-788-5488",
  });
  assert.equal(wrongPhone.reason, "phone_mismatch");
  assert.equal(wrongPhone.enteredPhone, "••• ••• 5488");
  assert.equal(wrongPhone.expectedPhone, "••• ••• 7422");

  const crossedAccounts = classifyLoginIdentity({
    ...helpers,
    email: "other@example.com",
    phone: "905-964-7422",
  });
  assert.equal(crossedAccounts.reason, "identity_pair_mismatch");
  assert.equal(crossedAccounts.expectedEmail, "not available");
  assert.equal(crossedAccounts.expectedPhone, "not available");

  const malformedPhone = classifyLoginIdentity({
    ...helpers,
    email: "superdaveyyz@gmail.com",
    phone: "123",
  });
  assert.equal(malformedPhone.reason, "invalid_input");

  const sharedPhone = classifyLoginIdentity({
    ...helpers,
    records: [
      ...records,
      { businessName: "Shared Phone Business", ownerEmail: "shared@example.com", ownerPhone: "+19059647422" },
    ],
    email: "unknown@example.com",
    phone: "905-964-7422",
  });
  assert.equal(sharedPhone.reason, "email_mismatch");
  assert.equal(sharedPhone.candidateCount, 2);
  assert.equal(sharedPhone.expectedEmail, "not available");
  assert.equal(sharedPhone.businessName, "");
});

test("dashboard login source records only a stable fingerprint and coarse device details", () => {
  const req = {
    ip: "203.0.113.42",
    headers: {
      "x-forwarded-for": "198.51.100.27, 10.0.0.8",
      "user-agent": "Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1",
    },
  };
  const first = getLoginAttemptSource(req);
  const second = getLoginAttemptSource(req);
  assert.deepEqual(first, second);
  assert.equal(first.device, "Phone");
  assert.equal(first.browser, "Safari");
  assert.match(first.sourceFingerprint, /^[a-f0-9]{12}$/);
  assert.equal(JSON.stringify(first).includes("203.0.113.42"), false);
  assert.equal(JSON.stringify(first).includes("Mozilla"), false);
});

test("Telegram dashboard-login alerts explain the mismatch without exposing raw login data", () => {
  const diagnosis = classifyLoginIdentity({
    ...helpers,
    email: "typo@gmail.com",
    phone: "905-964-7422",
  });
  const context = buildFailureContext({
    req: {
      ip: "203.0.113.42",
      headers: { "user-agent": "Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36" },
    },
    diagnosis,
  });
  const incident = buildRuntimeIncident(
    Object.assign(new Error("Customer dashboard sign-in stopped before a code was sent."), {
      code: diagnosis.reasonCode,
    }),
    context
  );
  const telegram = buildIncidentTelegramAlert(incident);

  assert.match(telegram, /entered phone matched a customer signup/i);
  assert.match(telegram, /Entered email: t•••@gmail\.com/);
  assert.match(telegram, /Saved email: s•••@gmail\.com/);
  assert.match(telegram, /Source fingerprint: [a-f0-9]{12}/);
  assert.match(telegram, /Device: Computer/);
  assert.doesNotMatch(telegram, /typo@gmail\.com/);
  assert.doesNotMatch(telegram, /superdaveyyz@gmail\.com/);
  assert.doesNotMatch(telegram, /9059647422/);
  assert.doesNotMatch(telegram, /203\.0\.113\.42/);
});

test("mask helpers never reveal a complete login value", () => {
  assert.equal(maskEmail("owner@example.com"), "o•••@example.com");
  assert.equal(maskPhone("+1 (905) 555-0123"), "••• ••• 0123");
  assert.equal(maskEmail(""), "not entered");
  assert.equal(maskPhone(""), "not entered");
});
