require("dotenv").config({
  path: process.env.OPERATIONS_ENV_FILE || ".env.local",
});

const fs = require("fs");
const path = require("path");
const { prisma } = require("../server/prisma");

const root = path.resolve(__dirname, "..");
const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const DAY_MS = 24 * 60 * 60 * 1000;
const transcriptDays = Math.max(1, Number(process.env.CALL_TRANSCRIPT_RETENTION_DAYS || 30));
const recordingDays = Math.max(1, Number(process.env.CALL_RECORDING_RETENTION_DAYS || 30));
const leadDays = Math.max(1, Number(process.env.LEAD_RETENTION_DAYS || 365));
const supportDays = Math.max(1, Number(process.env.SUPPORT_RETENTION_DAYS || 730));
const reportPath = path.resolve(
  root,
  process.env.RETENTION_AUDIT_REPORT_PATH || "diagnostics/operations/retention-audit.json"
);

function cutoff(days) {
  return new Date(Date.now() - days * DAY_MS);
}

function expiredArtifactWhere(field, expiryField, days) {
  return {
    [field]: { not: null },
    OR: [
      { [expiryField]: { lte: new Date() } },
      { [expiryField]: null, startedAt: { lt: cutoff(days) } },
    ],
  };
}

async function main() {
  if (apply && process.env.RETENTION_APPLY_CONFIRM !== "PURGE_EXPIRED_CALL_ARTIFACTS") {
    throw new Error(
      "Apply mode refused. Set RETENTION_APPLY_CONFIRM=PURGE_EXPIRED_CALL_ARTIFACTS after an authorized review."
    );
  }

  const transcriptWhere = expiredArtifactWhere(
    "transcript",
    "transcriptExpiresAt",
    transcriptDays
  );
  const recordingWhere = expiredArtifactWhere(
    "recordingUrl",
    "recordingExpiresAt",
    recordingDays
  );

  const [
    transcriptCandidates,
    recordingCandidates,
    oldCalls,
    oldLeads,
    oldSupportReports,
  ] = await Promise.all([
    prisma.call.count({ where: transcriptWhere }),
    prisma.call.count({ where: recordingWhere }),
    prisma.call.count({ where: { startedAt: { lt: cutoff(leadDays) } } }),
    prisma.lead.count({ where: { createdAt: { lt: cutoff(leadDays) } } }),
    prisma.supportReport.count({ where: { createdAt: { lt: cutoff(supportDays) } } }),
  ]);

  const applied = {
    transcriptsCleared: 0,
    recordingUrlsCleared: 0,
  };
  if (apply) {
    const [transcripts, recordings] = await prisma.$transaction([
      prisma.call.updateMany({
        where: transcriptWhere,
        data: { transcript: null, transcriptExpiresAt: null },
      }),
      prisma.call.updateMany({
        where: recordingWhere,
        data: { recordingUrl: null, recordingExpiresAt: null },
      }),
    ]);
    applied.transcriptsCleared = transcripts.count;
    applied.recordingUrlsCleared = recordings.count;
  }

  const report = {
    schemaVersion: 1,
    auditedAt: new Date().toISOString(),
    mode: apply ? "apply" : "audit",
    policy: {
      transcriptDays,
      recordingDays,
      leadReviewDays: leadDays,
      supportReviewDays: supportDays,
    },
    candidates: {
      expiredTranscripts: transcriptCandidates,
      expiredRecordingUrls: recordingCandidates,
      callsPastLeadReviewWindow: oldCalls,
      leadsPastReviewWindow: oldLeads,
      supportReportsPastReviewWindow: oldSupportReports,
    },
    applied,
    notes: [
      "Apply mode clears only expired transcript text and recording URLs.",
      "Lead, call, and support rows are report-only pending approved legal holds and deletion rules.",
      "Provider-held recordings, transcripts, messages, logs, and backups require separate provider deletion evidence.",
    ],
  };

  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
  console.log(`Report saved: ${reportPath}`);
}

main()
  .catch((error) => {
    console.error(`Retention audit failed safely: ${String(error?.message || error).slice(0, 300)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
