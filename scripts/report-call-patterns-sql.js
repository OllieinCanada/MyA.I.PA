const fs = require("fs");
const path = require("path");
const { PrismaClient, Prisma } = require("@prisma/client");

const { ensureDir, loadProjectEnv, rootPath } = require("./_helpers");

const env = loadProjectEnv();
const useLiveRenderConfig = process.argv.includes("--live");
const serviceId = String(env.RENDER_SERVICE_ID || "srv-d92503a8qa3s73crdpog").trim();
const renderConfigPath = path.join(process.env.USERPROFILE || process.env.HOME || "", ".render", "cli.yaml");
let prisma = null;

const windowDays = 30;
const outputDir = rootPath("diagnostics", "admin");
const jsonPath = path.join(outputDir, "call-patterns-sql-latest.json");
const markdownPath = path.join(outputDir, "call-patterns-sql-latest.md");

function sum(items, key) {
  return items.reduce((total, item) => total + (Number(item?.[key]) || 0), 0);
}

function money(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function markdownEscape(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function stripYamlValue(value) {
  const text = String(value || "").trim();
  if (
    (text.startsWith("\"") && text.endsWith("\""))
    || (text.startsWith("'") && text.endsWith("'"))
  ) {
    return text.slice(1, -1);
  }
  return text;
}

function readRenderCredentials() {
  const source = fs.readFileSync(renderConfigPath, "utf8");
  const apiBlock = source.match(/(?:^|\r?\n)api:\s*\r?\n([\s\S]*?)(?=\r?\n\S|\s*$)/);
  if (!apiBlock) throw new Error("The signed-in Render CLI profile does not contain an API section.");
  const key = stripYamlValue(apiBlock[1].match(/^\s+key:\s*(.+)$/m)?.[1]);
  const host = stripYamlValue(apiBlock[1].match(/^\s+host:\s*(.+)$/m)?.[1]).replace(/\/+$/, "");
  if (!key || !host) throw new Error("The signed-in Render CLI profile is incomplete.");
  return { key, host };
}

async function renderRequest(credentials, endpoint) {
  const response = await fetch(`${credentials.host}${endpoint}`, {
    headers: {
      authorization: `Bearer ${credentials.key}`,
      accept: "application/json",
    },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(`Render request failed with HTTP ${response.status}.`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

function envValue(payload) {
  return String(payload?.value ?? payload?.envVar?.value ?? "").trim();
}

function postgresIdCandidatesFromUrl(databaseUrl) {
  const configured = String(env.RENDER_POSTGRES_ID || "").trim();
  if (configured) return [configured];
  const hostname = new URL(databaseUrl).hostname;
  const match = hostname.match(/^(dpg-[a-z0-9]+(?:-a)?)(?:[.-]|$)/i);
  if (!match) {
    throw new Error("The Render Postgres ID could not be derived from DATABASE_URL.");
  }
  return [...new Set([match[1], match[1].replace(/-a$/i, "")])];
}

async function getExternalDatabaseUrl(credentials, internalDatabaseUrl) {
  for (const postgresId of postgresIdCandidatesFromUrl(internalDatabaseUrl)) {
    try {
      const connectionInfo = await renderRequest(
        credentials,
        `/postgres/${encodeURIComponent(postgresId)}/connection-info`
      );
      const externalDatabaseUrl = String(connectionInfo?.externalConnectionString || "").trim();
      if (externalDatabaseUrl) return externalDatabaseUrl;
    } catch (error) {
      if (error?.status !== 404) throw error;
    }
  }
  throw new Error("The matching live Render Postgres connection could not be found.");
}

async function getRemoteEnv(credentials, key) {
  return envValue(
    await renderRequest(
      credentials,
      `/services/${encodeURIComponent(serviceId)}/env-vars/${encodeURIComponent(key)}`
    )
  );
}

async function resolveRuntimeConfig() {
  const local = {
    databaseUrl: String(env.DATABASE_URL || "").trim(),
    adminPassword: String(env.ADMIN_PASSWORD || "").trim(),
    source: "local project environment",
  };
  if (!useLiveRenderConfig) return local;
  if (!serviceId) throw new Error("RENDER_SERVICE_ID is not configured.");
  const credentials = readRenderCredentials();
  const [databaseUrl, adminPassword] = await Promise.all([
    getRemoteEnv(credentials, "DATABASE_URL"),
    getRemoteEnv(credentials, "ADMIN_PASSWORD"),
  ]);
  if (!databaseUrl || !adminPassword) {
    throw new Error("The live Render database or admin credential could not be read safely.");
  }
  const externalDatabaseUrl = await getExternalDatabaseUrl(credentials, databaseUrl);
  return {
    databaseUrl: externalDatabaseUrl,
    adminPassword,
    source: "live Render Postgres external connection",
  };
}

async function getAdminVerification(adminPassword) {
  const apiBaseUrl = String(
    env.PUBLIC_API_BASE_URL || env.REACT_APP_API_BASE_URL || "https://api.myaipa.ca"
  ).replace(/\/+$/, "");
  if (!adminPassword) return { available: false, reason: "ADMIN_PASSWORD is not configured." };

  async function getJson(endpoint) {
    const response = await fetch(`${apiBaseUrl}${endpoint}`, {
      headers: {
        "x-admin-password": adminPassword,
        accept: "application/json",
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`${endpoint} failed with HTTP ${response.status}: ${payload.error || "request failed"}`);
    }
    return payload;
  }

  const [analyticsPayload, callsPayload] = await Promise.all([
    getJson(`/api/admin/calls/analytics?days=${windowDays}`),
    getJson("/api/admin/calls"),
  ]);
  const analytics = Array.isArray(analyticsPayload.analytics) ? analyticsPayload.analytics : [];
  const calls = Array.isArray(callsPayload.calls) ? callsPayload.calls : [];
  return {
    available: true,
    apiBaseUrl,
    metrics: {
      totalCalls: sum(analytics, "totalCalls"),
      answeredCalls: sum(analytics, "answeredCalls"),
      missedCalls: sum(analytics, "missedCalls"),
      failedCalls: sum(analytics, "failedCalls"),
      bookedCalls: sum(analytics, "bookedCalls"),
      followUps: sum(analytics, "followUps"),
      totalDurationSec: sum(analytics, "totalDurationSec"),
      visibleCallRows: calls.length,
    },
  };
}

function buildComparisons(sqlSummary, allTime, adminVerification) {
  if (!adminVerification.available) return [];
  const admin = adminVerification.metrics;
  return [
    ["30-day total calls", sqlSummary.totalCalls, admin.totalCalls],
    ["30-day answered calls", sqlSummary.answeredCalls, admin.answeredCalls],
    ["30-day missed calls", sqlSummary.missedCalls, admin.missedCalls],
    ["30-day failed calls", sqlSummary.failedCalls, admin.failedCalls],
    ["30-day booked calls", sqlSummary.bookedCalls, admin.bookedCalls],
    ["30-day follow-ups", sqlSummary.followUps, admin.followUps],
    ["30-day duration seconds", sqlSummary.totalDurationSec, admin.totalDurationSec],
    ["visible call rows", allTime.totalRows, admin.visibleCallRows],
  ].map(([metric, sqlValue, adminValue]) => ({
    metric,
    sqlValue: Number(sqlValue || 0),
    adminValue: Number(adminValue || 0),
    match: Number(sqlValue || 0) === Number(adminValue || 0),
  }));
}

function derivePatterns(summary, allTime, businesses) {
  const patterns = [];
  if (allTime.unreviewedRows > 0) {
    patterns.push({
      severity: "high",
      pattern: "Review backlog",
      evidence: `${allTime.unreviewedRows} synchronized call rows remain unreviewed.`,
      decision: "Prioritize a review queue and outcome classification before adding more reporting volume.",
    });
  }
  if (summary.followUps > 0) {
    patterns.push({
      severity: "high",
      pattern: "Follow-up workload",
      evidence: `${summary.followUps} calls in the last ${windowDays} days require follow-up.`,
      decision: "Surface owner-facing next actions and overdue follow-up status in the daily operating view.",
    });
  }
  const top = businesses[0];
  if (top && summary.totalCalls > 0) {
    const share = Math.round((Number(top.totalCalls) / Number(summary.totalCalls)) * 100);
    patterns.push({
      severity: share >= 70 ? "medium" : "low",
      pattern: "Call-volume concentration",
      evidence: `${markdownEscape(top.businessName)} accounts for ${share}% of 30-day call volume.`,
      decision: "Separate controlled/testing traffic from live-customer usage before presenting adoption metrics.",
    });
  }
  if (summary.bookedCalls === 0) {
    patterns.push({
      severity: "medium",
      pattern: "Outcome instrumentation gap",
      evidence: "No 30-day calls are classified as booked.",
      decision: "Validate outcome capture before claiming booking or revenue impact.",
    });
  }
  return patterns;
}

function renderMarkdown(report) {
  const lines = [
    "# My AI PA Call-Pattern SQL Report",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    "This is a read-only PostgreSQL report executed through Prisma `$queryRaw`. It aggregates operational fields only and excludes caller phone numbers, transcripts, recordings, and message contents.",
    "",
    "## 30-day summary",
    "",
    `- Calls: **${report.summary.totalCalls}**`,
    `- Duration: **${report.summary.totalMinutes} minutes**`,
    `- Answered / missed / failed: **${report.summary.answeredCalls} / ${report.summary.missedCalls} / ${report.summary.failedCalls}**`,
    `- Follow-ups: **${report.summary.followUps}**`,
    `- Booked outcomes: **${report.summary.bookedCalls}**`,
    `- Priced calls / recorded provider cost: **${report.summary.pricedCalls} / ${money(report.summary.totalInternalCost)}**`,
    `- All-time synchronized rows / unreviewed: **${report.allTime.totalRows} / ${report.allTime.unreviewedRows}**`,
    "",
    "## Per-business patterns",
    "",
    "| Business | Calls | Minutes | Answered | Missed | Failed | Follow-ups | Booked | Busiest hour | Cost |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---|---:|",
    ...report.businesses.map(
      (row) =>
        `| ${markdownEscape(row.businessName)} | ${row.totalCalls} | ${row.totalMinutes} | ${row.answeredCalls} | ${row.missedCalls} | ${row.failedCalls} | ${row.followUps} | ${row.bookedCalls} | ${row.busiestHourToronto} | ${money(row.totalInternalCost)} |`
    ),
    "",
    "## Patterns and decisions",
    "",
    ...report.patterns.flatMap((item) => [
      `### ${item.pattern}`,
      "",
      `- Evidence: ${item.evidence}`,
      `- Decision: ${item.decision}`,
      "",
    ]),
    "## Independent verification",
    "",
    report.verification.available
      ? `Compared with the authenticated admin API at ${report.verification.apiBaseUrl}.`
      : `Admin comparison unavailable: ${report.verification.reason}`,
    "",
    ...(report.verification.comparisons || []).map(
      (item) =>
        `- ${item.match ? "PASS" : "FAIL"} — ${item.metric}: SQL ${item.sqlValue}, admin ${item.adminValue}`
    ),
    "",
    `Overall verification: **${report.verification.verified ? "PASS" : "FAIL"}**`,
    "",
  ];
  return `${lines.join("\n")}\n`;
}

async function main() {
  const runtimeConfig = await resolveRuntimeConfig();
  if (!runtimeConfig.databaseUrl) {
    throw new Error("DATABASE_URL is not configured locally.");
  }
  prisma = new PrismaClient({
    datasources: {
      db: {
        url: runtimeConfig.databaseUrl,
      },
    },
  });

  const [summaryRows, businessRows, allTimeRows, adminVerification] = await Promise.all([
    prisma.$queryRaw(
      Prisma.sql`
        SELECT
          COUNT(*)::int AS "totalCalls",
          COUNT(*) FILTER (WHERE c.status = 'COMPLETED')::int AS "answeredCalls",
          COUNT(*) FILTER (WHERE c.status IN ('MISSED', 'ABANDONED'))::int AS "missedCalls",
          COUNT(*) FILTER (WHERE c.status = 'FAILED')::int AS "failedCalls",
          COUNT(*) FILTER (WHERE c.outcome = 'BOOKED')::int AS "bookedCalls",
          COUNT(*) FILTER (
            WHERE c."followUpNeeded" = TRUE OR c.outcome IN ('FOLLOW_UP', 'QUOTE_NEEDED')
          )::int AS "followUps",
          COUNT(*) FILTER (WHERE c.outcome = 'UNREVIEWED')::int AS "unreviewedCalls",
          COUNT(DISTINCT c."businessId")::int AS "businessesWithCalls",
          COALESCE(SUM(c."durationSec"), 0)::int AS "totalDurationSec",
          ROUND((COALESCE(SUM(c."durationSec"), 0) / 60.0)::numeric, 1)::double precision AS "totalMinutes",
          COUNT(*) FILTER (
            WHERE c."costSyncedAt" IS NOT NULL
              OR c."vapiCost" IS NOT NULL
              OR c."twilioPrice" IS NOT NULL
              OR c."totalInternalCost" IS NOT NULL
          )::int AS "pricedCalls",
          ROUND(COALESCE(SUM(c."totalInternalCost"), 0)::numeric, 4)::double precision AS "totalInternalCost"
        FROM "Call" c
        WHERE c."startedAt" >= NOW() - INTERVAL '30 days'
          AND c."startedAt" <= NOW()
      `
    ),
    prisma.$queryRaw(
      Prisma.sql`
        SELECT
          b.id AS "businessId",
          b.name AS "businessName",
          COUNT(*)::int AS "totalCalls",
          COUNT(*) FILTER (WHERE c.status = 'COMPLETED')::int AS "answeredCalls",
          COUNT(*) FILTER (WHERE c.status IN ('MISSED', 'ABANDONED'))::int AS "missedCalls",
          COUNT(*) FILTER (WHERE c.status = 'FAILED')::int AS "failedCalls",
          COUNT(*) FILTER (WHERE c.outcome = 'BOOKED')::int AS "bookedCalls",
          COUNT(*) FILTER (
            WHERE c."followUpNeeded" = TRUE OR c.outcome IN ('FOLLOW_UP', 'QUOTE_NEEDED')
          )::int AS "followUps",
          COALESCE(SUM(c."durationSec"), 0)::int AS "totalDurationSec",
          ROUND((COALESCE(SUM(c."durationSec"), 0) / 60.0)::numeric, 1)::double precision AS "totalMinutes",
          ROUND(COALESCE(SUM(c."totalInternalCost"), 0)::numeric, 4)::double precision AS "totalInternalCost",
          MODE() WITHIN GROUP (
            ORDER BY EXTRACT(HOUR FROM c."startedAt" AT TIME ZONE 'America/Toronto')
          )::int AS "busiestHour"
        FROM "Call" c
        INNER JOIN "Business" b ON b.id = c."businessId"
        WHERE c."startedAt" >= NOW() - INTERVAL '30 days'
          AND c."startedAt" <= NOW()
        GROUP BY b.id, b.name
        ORDER BY COUNT(*) DESC, b.name ASC
      `
    ),
    prisma.$queryRaw(
      Prisma.sql`
        SELECT
          COUNT(*)::int AS "totalRows",
          COUNT(*) FILTER (WHERE outcome = 'UNREVIEWED')::int AS "unreviewedRows",
          COUNT(*) FILTER (
            WHERE "followUpNeeded" = TRUE OR outcome IN ('FOLLOW_UP', 'QUOTE_NEEDED')
          )::int AS "followUpRows"
        FROM "Call"
      `
    ),
    getAdminVerification(runtimeConfig.adminPassword),
  ]);

  const summary = summaryRows[0] || {};
  const allTime = allTimeRows[0] || {};
  const businesses = businessRows.map((row) => ({
    ...row,
    busiestHourToronto: `${String(row.busiestHour ?? 0).padStart(2, "0")}:00`,
  }));
  const comparisons = buildComparisons(summary, allTime, adminVerification);
  const verified = adminVerification.available && comparisons.length > 0 && comparisons.every((item) => item.match);
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: "PostgreSQL via Prisma $queryRaw",
    credentialSource: runtimeConfig.source,
    windowDays,
    privacy: {
      readOnly: true,
      excludes: ["caller phone numbers", "transcripts", "recordings", "message contents"],
    },
    summary,
    allTime,
    businesses,
    patterns: derivePatterns(summary, allTime, businesses),
    verification: {
      ...adminVerification,
      comparisons,
      verified,
    },
  };

  ensureDir(outputDir);
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(markdownPath, renderMarkdown(report), "utf8");

  console.log(
    JSON.stringify(
      {
        jsonPath,
        markdownPath,
        summary: report.summary,
        allTime: report.allTime,
        patterns: report.patterns.length,
        verified,
      },
      null,
      2
    )
  );

  if (!verified) process.exitCode = 2;
}

main()
  .catch((error) => {
    console.error(error?.message || String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    if (prisma) await prisma.$disconnect();
  });
