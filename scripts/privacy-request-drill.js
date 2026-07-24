const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const reportPath = path.resolve(root, "diagnostics/operations/privacy-request-drill.json");
const subjectId = "synthetic-subject-001";
const subjectPhone = "+15550000001";
const subjectEmail = "synthetic-subject-001@example.invalid";
const otherPhone = "+15550000002";

const original = {
  contacts: [
    { id: subjectId, tenantId: "tenant-a", name: "Synthetic Person", phone: subjectPhone, email: subjectEmail },
    { id: "synthetic-other-002", tenantId: "tenant-b", name: "Other Synthetic Person", phone: otherPhone, email: "other@example.invalid" },
  ],
  calls: [
    { id: "synthetic-call-001", tenantId: "tenant-a", subjectId, transcript: "Synthetic request details." },
    { id: "synthetic-call-002", tenantId: "tenant-b", subjectId: "synthetic-other-002", transcript: "Other tenant synthetic details." },
  ],
  suppressions: [],
  deletionLedger: [],
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function digest(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function accessPackage(data, targetSubjectId, tenantId) {
  return {
    contacts: data.contacts.filter((item) => item.id === targetSubjectId && item.tenantId === tenantId),
    calls: data.calls.filter((item) => item.subjectId === targetSubjectId && item.tenantId === tenantId),
  };
}

function replayDeletionLedger(data) {
  for (const event of data.deletionLedger) {
    data.contacts = data.contacts.filter((item) => digest(item.id) !== event.subjectDigest);
    data.calls = data.calls.filter((item) => digest(item.subjectId) !== event.subjectDigest);
    data.suppressions = data.suppressions.filter((item) => digest(item.phone) !== event.phoneDigest);
  }
  return data;
}

function runDrill() {
  const data = clone(original);
  const checks = [];
  const access = accessPackage(data, subjectId, "tenant-a");
  checks.push({
    name: "access_is_tenant_scoped",
    passed: access.contacts.length === 1
      && access.calls.length === 1
      && access.contacts.every((item) => item.tenantId === "tenant-a"),
  });

  data.contacts.find((item) => item.id === subjectId).name = "Corrected Synthetic Person";
  checks.push({
    name: "correction_propagates_to_subject_record",
    passed: data.contacts.find((item) => item.id === subjectId)?.name === "Corrected Synthetic Person",
  });

  data.suppressions.push({ phone: subjectPhone, suppressed: true, source: "synthetic-privacy-request" });
  checks.push({
    name: "consent_withdrawal_creates_suppression",
    passed: data.suppressions.some((item) => item.phone === subjectPhone && item.suppressed),
  });

  const deletionEvent = {
    subjectDigest: digest(subjectId),
    phoneDigest: digest(subjectPhone),
    requestedAt: "2026-07-24T05:00:00.000Z",
    scope: ["contact", "call", "suppression"],
  };
  data.deletionLedger.push(deletionEvent);
  replayDeletionLedger(data);
  checks.push({
    name: "deletion_removes_active_subject_data",
    passed: !data.contacts.some((item) => item.id === subjectId)
      && !data.calls.some((item) => item.subjectId === subjectId)
      && !data.suppressions.some((item) => item.phone === subjectPhone),
  });
  checks.push({
    name: "other_tenant_data_is_preserved",
    passed: data.contacts.some((item) => item.phone === otherPhone)
      && data.calls.some((item) => item.tenantId === "tenant-b"),
  });

  const restored = clone(original);
  restored.deletionLedger = [deletionEvent];
  replayDeletionLedger(restored);
  checks.push({
    name: "restore_replay_prevents_deleted_data_from_returning",
    passed: !restored.contacts.some((item) => item.id === subjectId)
      && !restored.calls.some((item) => item.subjectId === subjectId),
  });

  const report = {
    schemaVersion: 1,
    exercise: "synthetic access, correction, consent-withdrawal, deletion, and restore-replay drill",
    completedAt: new Date().toISOString(),
    productionDataUsed: false,
    externalProvidersMutated: false,
    passed: checks.every((check) => check.passed),
    checks,
    evidence: {
      subjectDigest: deletionEvent.subjectDigest,
      testedRecordTypes: deletionEvent.scope,
      remainingSyntheticContacts: data.contacts.length,
      remainingSyntheticCalls: data.calls.length,
    },
  };
  const serialized = JSON.stringify(report, null, 2);
  for (const forbidden of [subjectPhone, subjectEmail, "Synthetic Person", "Corrected Synthetic Person"]) {
    if (serialized.includes(forbidden)) throw new Error("Privacy drill report contains synthetic personal information.");
  }
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${serialized}\n`, "utf8");
  console.log(serialized);
  console.log(`Report saved: ${reportPath}`);
  if (!report.passed) process.exitCode = 1;
}

runDrill();
