const fs = require("fs");
const path = require("path");

const { loadProjectEnv, rootPath } = require("./_helpers");

const env = loadProjectEnv();
const apiBaseUrl = String(
  env.PUBLIC_API_BASE_URL || env.REACT_APP_API_BASE_URL || "https://api.myaipa.ca"
).replace(/\/+$/, "");
const adminPassword = String(env.ADMIN_PASSWORD || "").trim();
const reportPath = rootPath("diagnostics", "admin", "stats-latest.json");

async function getJson(endpoint) {
  const response = await fetch(`${apiBaseUrl}${endpoint}`, {
    headers: {
      "x-admin-password": adminPassword,
      accept: "application/json",
    },
  });
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = {};
  }
  if (!response.ok) {
    throw new Error(`${endpoint} failed with HTTP ${response.status}: ${payload.error || "request failed"}`);
  }
  return payload;
}

function countBy(items, selector) {
  return items.reduce((counts, item) => {
    const key = String(selector(item) || "unknown").trim().toLowerCase();
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function sum(items, key) {
  return items.reduce((total, item) => total + (Number(item?.[key]) || 0), 0);
}

async function main() {
  if (!adminPassword) throw new Error("ADMIN_PASSWORD is not configured locally.");

  const [
    setupPayload,
    callsPayload,
    analyticsPayload,
    signupsPayload,
    leadsPayload,
    trialHealthPayload,
    trialUsagePayload,
    stripePayload,
    handoffPayload,
    costPayload,
    inventoryPayload,
    supportPayload,
  ] = await Promise.all([
    getJson("/api/admin/customer-setup"),
    getJson("/api/admin/calls"),
    getJson("/api/admin/calls/analytics?days=30"),
    getJson("/api/admin/signups"),
    getJson("/api/admin/leads"),
    getJson("/api/admin/trial-health"),
    getJson("/api/admin/trial-usage"),
    getJson("/api/admin/stripe-trials"),
    getJson("/api/admin/lead-handoffs"),
    getJson("/api/admin/cost-audit?days=30"),
    getJson("/api/admin/vapi/inventory"),
    getJson("/api/admin/support-reports"),
  ]);

  const calls = Array.isArray(callsPayload.calls) ? callsPayload.calls : [];
  const analytics = Array.isArray(analyticsPayload.analytics) ? analyticsPayload.analytics : [];
  const signups = Array.isArray(signupsPayload.signups) ? signupsPayload.signups : [];
  const leads = Array.isArray(leadsPayload.leads) ? leadsPayload.leads : [];
  const trialAccounts = Array.isArray(trialHealthPayload.accounts) ? trialHealthPayload.accounts : [];
  const supportReports = Array.isArray(supportPayload.reports) ? supportPayload.reports : [];
  const report = {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    source: apiBaseUrl,
    businesses: setupPayload.summary || {},
    calls30Days: {
      total: sum(analytics, "totalCalls"),
      answered: sum(analytics, "answeredCalls"),
      missed: sum(analytics, "missedCalls"),
      failed: sum(analytics, "failedCalls"),
      booked: sum(analytics, "bookedCalls"),
      followUps: sum(analytics, "followUps"),
      totalMinutes: Number((sum(analytics, "totalDurationSec") / 60).toFixed(1)),
      synchronizedRowsVisible: calls.length,
      outcomes: countBy(calls, (call) => call.outcome || call.status),
    },
    signups: {
      total: signups.length,
      statuses: countBy(
        signups,
        (signup) => signup.subscriptionStatus || signup.checkoutStatus || signup.status
      ),
    },
    leads: {
      total: leads.length,
      statuses: countBy(leads, (lead) => lead.status),
      intents: countBy(leads, (lead) => lead.intent),
    },
    trials: {
      trackedAccounts: trialAccounts.length,
      health: countBy(trialAccounts, (account) => account.expiry?.color || account.status),
      usage: {
        enabled: Boolean(trialUsagePayload.enabled),
        warningMinutes: trialUsagePayload.warningMinutes ?? null,
        newCallCutoffMinutes: trialUsagePayload.newCallCutoffMinutes ?? null,
        limitMinutes: trialUsagePayload.limitMinutes ?? null,
        totals: trialUsagePayload.totals || {},
      },
      billing: stripePayload.totals || {},
      warnings: Array.isArray(stripePayload.warnings) ? stripePayload.warnings.length : 0,
    },
    leadDelivery: handoffPayload.summary || {},
    support: {
      total: supportReports.length,
      statuses: countBy(supportReports, (item) => item.status),
    },
    costs30Days: {
      totals: costPayload.audit?.totals || {},
      warnings: Array.isArray(costPayload.audit?.warnings) ? costPayload.audit.warnings : [],
    },
    phoneSystem: {
      totals: inventoryPayload.inventory?.totals || {},
      warnings: Array.isArray(inventoryPayload.inventory?.warnings)
        ? inventoryPayload.inventory.warnings
        : [],
      fetchedAt: inventoryPayload.inventory?.fetchedAt || null,
    },
  };

  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error?.message || String(error));
  process.exitCode = 1;
});
