const fs = require("fs");
const path = require("path");

const { loadProjectEnv, rootPath } = require("./_helpers");

const DAY_MS = 24 * 60 * 60 * 1000;

function round(value, precision = 4) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  const scale = 10 ** precision;
  return Math.round(number * scale) / scale;
}

function daysSinceYearStart(now) {
  const date = new Date(now);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.max(1, Math.ceil((date.getTime() - yearStart.getTime()) / DAY_MS));
}

function createAdminFinanceClient({ apiBaseUrl, adminPassword, fetchImpl = fetch }) {
  const baseUrl = String(apiBaseUrl || "").replace(/\/+$/, "");
  if (!baseUrl) throw new Error("An API base URL is required.");
  if (!adminPassword) throw new Error("ADMIN_PASSWORD is not configured locally.");

  async function getJson(endpoint, { allowNotFound = false } = {}) {
    const response = await fetchImpl(`${baseUrl}${endpoint}`, {
      method: "GET",
      headers: {
        "x-admin-password": adminPassword,
        accept: "application/json",
      },
    });
    if (allowNotFound && response.status === 404) return null;
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

  async function getPeriod(days) {
    const encodedDays = encodeURIComponent(String(days));
    const unified = await getJson(`/api/admin/finance-ledger?days=${encodedDays}`, { allowNotFound: true });
    if (unified?.ledger) {
      return {
        source: "unified-finance-ledger",
        operatingCosts: unified.ledger.operatingCosts || {},
        paymentProcessor: unified.ledger.paymentProcessor || null,
        readOnly: unified.ledger.readOnly === true,
        mutationsPerformed: Number(unified.ledger.mutationsPerformed || 0),
      };
    }
    const costPayload = await getJson(`/api/admin/cost-audit?days=${encodedDays}`);
    return {
      source: "legacy-cost-audit-fallback",
      operatingCosts: costPayload.audit || {},
      paymentProcessor: null,
      readOnly: true,
      mutationsPerformed: 0,
    };
  }

  return { getJson, getPeriod };
}

function costRowsForPeriod(label, period) {
  const totals = period?.operatingCosts?.totals || {};
  return [
    ["twilio", totals.twilioCost],
    ["vapi", totals.vapiCost],
    ["fixed-infrastructure", totals.fixedCost],
  ].map(([provider, amount]) => ({
    period: label,
    provider,
    kind: "operating-expense",
    basis: "provider-aggregate",
    currency: "USD",
    amount: round(amount),
  }));
}

function normalizedPhone(value) {
  return String(value || "").replace(/\D/g, "");
}

function maskedPhone(value) {
  const digits = normalizedPhone(value);
  return digits ? `••••${digits.slice(-4)}` : "No number";
}

function groupBusinessCosts(audit = {}) {
  const summary = Array.isArray(audit.summary) ? audit.summary : [];
  const phoneOwners = new Map();
  for (const row of summary) {
    const phone = normalizedPhone(row.phoneNumber);
    if (!phone) continue;
    const owners = phoneOwners.get(phone) || new Set();
    owners.add(String(row.businessId ?? row.businessName ?? "unknown"));
    phoneOwners.set(phone, owners);
  }

  const businesses = new Map();
  for (const row of summary) {
    const businessKey = String(row.businessId ?? row.businessName ?? "unknown");
    const phone = normalizedPhone(row.phoneNumber);
    const current = businesses.get(businessKey) || {
      businessId: row.businessId ?? null,
      businessName: row.businessName || `Business ${businessKey}`,
      phoneNumbers: new Set(),
      sharedPhoneNumbers: new Set(),
      calls: 0,
      messages: 0,
      minutes: 0,
      phoneRentalUsd: 0,
      twilioUsageUsd: 0,
      vapiUsd: 0,
      allocatedTotalUsd: 0,
    };
    if (phone) {
      current.phoneNumbers.add(maskedPhone(phone));
      if ((phoneOwners.get(phone)?.size || 0) > 1) current.sharedPhoneNumbers.add(maskedPhone(phone));
    }
    current.calls += Number(row.totalCalls || 0);
    current.messages += Number(row.messageCount || 0);
    current.minutes += Number(row.totalDurationSec || 0) / 60;
    current.phoneRentalUsd += Number(row.phoneNumberCost || 0);
    current.twilioUsageUsd += Number(row.twilioCallCost || 0) + Number(row.twilioMessageCost || 0);
    current.vapiUsd += Number(row.vapiCost || 0);
    current.allocatedTotalUsd += Number(row.totalInternalCost || 0);
    businesses.set(businessKey, current);
  }

  return [...businesses.values()]
    .map((row) => ({
      ...row,
      phoneNumbers: [...row.phoneNumbers].sort(),
      sharedPhoneNumbers: [...row.sharedPhoneNumbers].sort(),
      minutes: round(row.minutes, 1),
      phoneRentalUsd: round(row.phoneRentalUsd),
      twilioUsageUsd: round(row.twilioUsageUsd),
      vapiUsd: round(row.vapiUsd),
      allocatedTotalUsd: round(row.allocatedTotalUsd),
      allocationNote: row.sharedPhoneNumbers.size
        ? "Review: at least one number also appears under another business."
        : "Current API mapping",
    }))
    .sort((left, right) => right.allocatedTotalUsd - left.allocatedTotalUsd || left.businessName.localeCompare(right.businessName));
}

function buildBusinessAllocation(audit = {}) {
  const totals = audit.totals || {};
  const businesses = groupBusinessCosts(audit);
  const allocatedTotalUsd = round(businesses.reduce((sum, row) => sum + row.allocatedTotalUsd, 0));
  const accountTotalUsd = round(totals.estimatedProviderCost);
  const phoneRentalUsd = round(totals.phoneNumberCost);
  const matchedPhoneRentalUsd = round(totals.matchedPhoneNumberCost);
  const twilioVariableUsd = round(Number(totals.twilioCost || 0) - Number(totals.phoneNumberCost || 0));
  const vapiUsd = round(totals.vapiCost);
  const fixedInfrastructureUsd = round(totals.fixedCost);
  const unallocatedPhoneRentalUsd = round(phoneRentalUsd - matchedPhoneRentalUsd);
  const unallocatedTwilioUsageUsd = round(
    Number(totals.twilioCost || 0)
      - Number(totals.phoneNumberCost || 0)
      - Number(totals.twilioCallCost || 0)
      - Number(totals.matchedTwilioMessageCost || 0)
  );
  const unallocatedTotalUsd = round(accountTotalUsd - allocatedTotalUsd);
  const activeNumbers = Number(audit.twilioPhoneBilling?.totalNumbers || audit.twilioPhoneBilling?.records?.length || 0);
  const numberUsageRecord = (audit.twilioAccountUsage?.records || []).find(
    (record) => String(record.category || "").toLowerCase() === "phonenumbers"
  );
  const billedNumberUnits = Number(numberUsageRecord?.count || numberUsageRecord?.usage || 0);
  const impliedUnitCostUsd = billedNumberUnits ? round(phoneRentalUsd / billedNumberUnits, 2) : 0;

  const summaryPhones = new Set(
    (audit.summary || []).map((row) => normalizedPhone(row.phoneNumber)).filter(Boolean)
  );
  const activePhoneNumbers = (audit.twilioPhoneBilling?.records || [])
    .map((record) => normalizedPhone(record.normalizedPhoneNumber || record.phoneNumber))
    .filter(Boolean);
  const unassignedActiveNumbers = [...new Set(activePhoneNumbers.filter((phone) => !summaryPhones.has(phone)))]
    .map(maskedPhone)
    .sort();
  const sharedPhoneNumbers = [...new Set(businesses.flatMap((row) => row.sharedPhoneNumbers))].sort();

  const percent = (amount) => accountTotalUsd ? round((Number(amount || 0) / accountTotalUsd) * 100, 1) : 0;
  return {
    accountTotalUsd,
    allocatedTotalUsd,
    unallocatedTotalUsd,
    businesses,
    costDrivers: [
      { label: "Phone-number rental", amountUsd: phoneRentalUsd, percent: percent(phoneRentalUsd) },
      { label: "Twilio calls, texts, media, and other usage", amountUsd: twilioVariableUsd, percent: percent(twilioVariableUsd) },
      { label: "Vapi AI call processing", amountUsd: vapiUsd, percent: percent(vapiUsd) },
      { label: "Configured fixed infrastructure", amountUsd: fixedInfrastructureUsd, percent: percent(fixedInfrastructureUsd) },
    ],
    unallocated: {
      phoneRentalUsd: unallocatedPhoneRentalUsd,
      twilioUsageUsd: unallocatedTwilioUsageUsd,
      fixedInfrastructureUsd,
      totalUsd: unallocatedTotalUsd,
    },
    phoneInventory: {
      activeNumbers,
      billedNumberUnits,
      impliedUnitCostUsd,
      mappedActiveNumbers: Math.max(0, activeNumbers - unassignedActiveNumbers.length),
      unassignedActiveNumbers,
      sharedPhoneNumbers,
    },
    plainEnglishReasons: [
      `${percent(phoneRentalUsd)}% of the known bill is phone-number rental, not calls.`,
      billedNumberUnits
        ? `Twilio reports ${billedNumberUnits} billed number units at about $${impliedUnitCostUsd.toFixed(2)} each across this period.`
        : "Twilio did not return a billed-number count for this period.",
      `${unassignedActiveNumbers.length} of ${activeNumbers} active numbers are not assigned to a business in this report.`,
      sharedPhoneNumbers.length
        ? `${sharedPhoneNumbers.join(", ")} appears under more than one business and needs its ownership mapping reviewed.`
        : "No phone number appears under more than one business.",
      `$${round(twilioVariableUsd + vapiUsd, 2).toFixed(2)} came from actual Twilio usage plus Vapi; the rest is rental or configured fixed cost.`,
    ],
  };
}

function coverageRow(source, status, measured, gap, nextAction) {
  return { source, status, measured, gap, nextAction };
}

function buildApiFinanceReport({
  checkedAt,
  apiBaseUrl,
  periods,
  stripeTrials,
  credentialPresence = {},
}) {
  const entries = Object.entries(periods);
  const longestPeriod = entries.reduce((best, current) => {
    const bestDays = Number(best?.[1]?.operatingCosts?.days || 0);
    const currentDays = Number(current?.[1]?.operatingCosts?.days || 0);
    return currentDays >= bestDays ? current : best;
  }, null);
  const longestAudit = longestPeriod?.[1]?.operatingCosts || {};
  const unifiedAvailable = entries.some(([, period]) => period.source === "unified-finance-ledger");
  const stripeFinanceMeasured = entries.some(([, period]) => period.paymentProcessor?.configured);
  const fixedCosts = longestAudit.fixedCosts || {};
  const twilioMeasured = Boolean(longestAudit.twilioAccountUsage?.available);
  const vapiMeasured = Boolean(longestAudit.env?.vapiConfigured);
  const databaseMeasured = Boolean(longestAudit.env?.databaseAvailable);
  const fixedMeasured = Array.isArray(fixedCosts.records) && fixedCosts.records.length > 0;
  const stripeConfigured = Boolean(stripeTrials?.configured);
  const stripePayoutsEnabled = Boolean(stripeTrials?.account?.payoutsEnabled);
  const businessAllocation = buildBusinessAllocation(longestAudit);

  const coverage = [
    coverageRow(
      "MyAIPA database",
      databaseMeasured ? "measured" : "unavailable",
      "Customers, trials, calls, and per-business cost allocation",
      databaseMeasured ? "" : "The production database did not answer the cost audit.",
      databaseMeasured ? "None" : "Restore read-only database reporting."
    ),
    coverageRow(
      "Twilio",
      twilioMeasured ? "measured" : "unavailable",
      "Whole-account usage, phone rental, calls, and messages",
      twilioMeasured ? "Bank settlement is not reconciled." : "Twilio usage was not returned.",
      twilioMeasured ? "Connect a bank feed for settlement reconciliation." : "Repair the Twilio reporting credential."
    ),
    coverageRow(
      "Vapi",
      vapiMeasured ? "measured" : "unavailable",
      "Reported call costs stored against synchronized calls",
      vapiMeasured ? "Provider invoice settlement is not reconciled." : "Vapi cost reporting is unavailable.",
      vapiMeasured ? "Connect a bank feed for settlement reconciliation." : "Repair the Vapi API credential."
    ),
    coverageRow(
      "Stripe",
      stripeFinanceMeasured ? "measured" : stripeConfigured ? "partial" : "unavailable",
      stripeFinanceMeasured
        ? "Balances, balance transactions, fees, refunds, and payouts"
        : stripeConfigured
          ? "Subscription and trial state only"
          : "Nothing",
      stripeFinanceMeasured ? "Bank settlement is not reconciled." : "Financial balance transactions are not live yet.",
      stripeFinanceMeasured ? "Connect a bank feed for settlement reconciliation." : "Deploy the read-only finance-ledger route."
    ),
    coverageRow(
      "Render, Make, OpenAI, domain, and email",
      fixedMeasured ? "estimated" : "unmeasured",
      fixedMeasured ? "Configured fixed monthly amounts" : "Nothing",
      fixedMeasured ? "Amounts are estimates rather than provider billing events." : "No billing-capable API or fixed-cost registry is connected.",
      "Connect billing-capable APIs where available; otherwise configure reviewed monthly amounts."
    ),
    coverageRow(
      "Business bank and credit card",
      "not-connected",
      "Nothing",
      "Settled cash, card purchases, fees, transfers, and miscellaneous expenses are invisible.",
      "Authorize a secure read-only bank feed; CSV exports are not required when that feed exists."
    ),
  ];

  const approvalQueue = [];
  if (!unifiedAvailable) {
    approvalQueue.push({
      id: "deploy-read-only-finance-ledger",
      approvalRequired: true,
      action: "Deploy the protected GET /api/admin/finance-ledger endpoint.",
      effect: "Adds aggregate Stripe balance, fee, refund, and payout reporting without payment mutations.",
    });
  }
  if (stripeConfigured && !stripePayoutsEnabled) {
    approvalQueue.push({
      id: "review-stripe-payouts",
      approvalRequired: true,
      action: "Review why Stripe payouts are disabled before accepting paid customers.",
      effect: "No setting will be changed automatically.",
    });
  }
  approvalQueue.push(
    {
      id: "connect-read-only-bank-feed",
      approvalRequired: true,
      action: "Authorize a read-only business bank and card transaction feed.",
      effect: "Enables settlement reconciliation without sharing credentials in chat.",
    },
    {
      id: "complete-infrastructure-costs",
      approvalRequired: true,
      action: "Approve billing integrations or reviewed fixed monthly amounts for infrastructure providers.",
      effect: "Completes Render, Make, OpenAI, domain, and email overhead coverage.",
    }
  );

  const periodSnapshots = Object.fromEntries(entries.map(([label, period]) => {
    const totals = period.operatingCosts?.totals || {};
    return [label, {
      days: Number(period.operatingCosts?.days || 0),
      source: period.source,
      knownOperatingCostUsd: round(totals.estimatedProviderCost),
      twilioCostUsd: round(totals.twilioCost),
      vapiCostUsd: round(totals.vapiCost),
      fixedInfrastructureCostUsd: round(totals.fixedCost),
      stripeBalanceTransactionCount: Number(period.paymentProcessor?.balanceTransactions?.count || 0),
      warnings: [
        ...(Array.isArray(period.operatingCosts?.warnings) ? period.operatingCosts.warnings : []),
        ...(Array.isArray(period.paymentProcessor?.warnings) ? period.paymentProcessor.warnings : []),
      ],
    }];
  }));

  return {
    schemaVersion: 1,
    checkedAt,
    source: apiBaseUrl,
    readOnly: true,
    externalMutationsPerformed: entries.reduce(
      (total, [, period]) => total + Number(period.mutationsPerformed || 0),
      0
    ),
    secretValuesPrinted: false,
    periodSnapshots,
    operatingCostRows: entries.flatMap(([label, period]) => costRowsForPeriod(label, period)),
    businessAllocation: {
      period: longestPeriod?.[0] || "Longest available period",
      ...businessAllocation,
    },
    stripe: {
      configured: stripeConfigured,
      mode: stripeTrials?.mode || "unknown",
      chargesEnabled: Boolean(stripeTrials?.account?.chargesEnabled),
      payoutsEnabled: stripePayoutsEnabled,
      subscriptionTotals: stripeTrials?.totals || {},
      financialActivityMeasured: stripeFinanceMeasured,
    },
    localCredentialPresence: Object.fromEntries(
      Object.entries(credentialPresence).map(([key, value]) => [key, Boolean(value)])
    ),
    coverage,
    approvalQueue,
  };
}

function markdownMoney(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function renderFinanceMarkdown(report) {
  const lines = [
    "# MyAIPA API finance report",
    "",
    `Generated: ${report.checkedAt}`,
    "",
    "This report is read-only. It performed zero external mutations.",
    "",
    "## Known operating costs",
    "",
    "| Period | Known cost (USD) | Twilio | Vapi | Fixed infrastructure | Source |",
    "| --- | ---: | ---: | ---: | ---: | --- |",
  ];
  for (const [label, snapshot] of Object.entries(report.periodSnapshots)) {
    lines.push(
      `| ${label} | ${markdownMoney(snapshot.knownOperatingCostUsd)} | ${markdownMoney(snapshot.twilioCostUsd)} | ${markdownMoney(snapshot.vapiCostUsd)} | ${markdownMoney(snapshot.fixedInfrastructureCostUsd)} | ${snapshot.source} |`
    );
  }
  const allocation = report.businessAllocation;
  if (allocation) {
    lines.push(
      "",
      `## Why the ${markdownMoney(allocation.accountTotalUsd)} bill is so high`,
      ""
    );
    allocation.plainEnglishReasons.forEach((reason) => lines.push(`- ${reason}`));
    lines.push(
      "",
      `## Business split — ${allocation.period}`,
      "",
      "This is the best current API allocation. The unallocated row is real account spending that cannot yet be tied safely to one business.",
      "",
      "| Business | Numbers | Calls | Texts | Minutes | Number rental | Twilio use | Vapi | Allocated total |",
      "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |"
    );
    for (const business of allocation.businesses) {
      const numberLabel = business.phoneNumbers.join(", ")
        + (business.sharedPhoneNumbers.length ? " ⚠ shared mapping" : "");
      lines.push(
        `| ${business.businessName} | ${numberLabel || "None"} | ${business.calls} | ${business.messages} | ${business.minutes.toFixed(1)} | ${markdownMoney(business.phoneRentalUsd)} | ${markdownMoney(business.twilioUsageUsd)} | ${markdownMoney(business.vapiUsd)} | ${markdownMoney(business.allocatedTotalUsd)} |`
      );
    }
    lines.push(
      `| **Unallocated/shared account cost** | ${allocation.phoneInventory.unassignedActiveNumbers.join(", ") || "—"} | — | — | — | ${markdownMoney(allocation.unallocated.phoneRentalUsd)} | ${markdownMoney(allocation.unallocated.twilioUsageUsd)} | $0.00 | **${markdownMoney(allocation.unallocated.totalUsd)}** |`,
      `| **Account total** | ${allocation.phoneInventory.activeNumbers} active numbers | — | — | — | — | — | — | **${markdownMoney(allocation.accountTotalUsd)}** |`,
      "",
      "### Simple takeaway",
      "",
      `- Businesses currently explain ${markdownMoney(allocation.allocatedTotalUsd)} of the bill.`,
      `- ${markdownMoney(allocation.unallocatedTotalUsd)} is still unallocated because historic Twilio account charges do not map cleanly to the current business/number inventory.`,
      `- Cleaning up or assigning the ${allocation.phoneInventory.unassignedActiveNumbers.length} unassigned numbers is the biggest immediate cost-control task.`
    );
  }
  lines.push(
    "",
    "## API coverage",
    "",
    "| Source | Status | Measured | Remaining gap |",
    "| --- | --- | --- | --- |"
  );
  for (const item of report.coverage) {
    lines.push(`| ${item.source} | ${item.status} | ${item.measured} | ${item.gap || "None"} |`);
  }
  lines.push("", "## Approval queue", "");
  report.approvalQueue.forEach((item, index) => {
    lines.push(`${index + 1}. ${item.action} ${item.effect}`);
  });
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const env = loadProjectEnv();
  const checkedAt = new Date().toISOString();
  const apiBaseUrl = String(
    env.PUBLIC_API_BASE_URL || env.REACT_APP_API_BASE_URL || "https://api.myaipa.ca"
  ).replace(/\/+$/, "");
  const adminPassword = String(env.ADMIN_PASSWORD || "").trim();
  const client = createAdminFinanceClient({ apiBaseUrl, adminPassword });
  const year = new Date(checkedAt).getUTCFullYear();
  const ytdDays = daysSinceYearStart(checkedAt);
  const windows = [
    ["14 days", 14],
    ["30 days", 30],
    [`${year} YTD (${ytdDays}-day API window)`, ytdDays],
  ];
  const [periodEntries, stripeTrials] = await Promise.all([
    Promise.all(windows.map(async ([label, days]) => [label, await client.getPeriod(days)])),
    client.getJson("/api/admin/stripe-trials"),
  ]);
  const credentialPresence = {
    VAPI_API_KEY: env.VAPI_API_KEY,
    TWILIO_ACCOUNT_SID: env.TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN: env.TWILIO_AUTH_TOKEN,
    STRIPE_SECRET_KEY: env.STRIPE_SECRET_KEY,
    MAKE_API_TOKEN: env.MAKE_API_TOKEN,
    OPENAI_API_KEY: env.OPENAI_API_KEY,
    OPENAI_ADMIN_KEY: env.OPENAI_ADMIN_KEY,
    RENDER_SERVICE_ID: env.RENDER_SERVICE_ID,
  };
  const report = buildApiFinanceReport({
    checkedAt,
    apiBaseUrl,
    periods: Object.fromEntries(periodEntries),
    stripeTrials,
    credentialPresence,
  });
  const outputDir = rootPath("diagnostics", "finance");
  const jsonPath = path.join(outputDir, "api-finance-latest.json");
  const markdownPath = path.join(outputDir, "api-finance-latest.md");
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(markdownPath, renderFinanceMarkdown(report), "utf8");
  console.log(renderFinanceMarkdown(report));
  console.log(`JSON report: ${jsonPath}`);
  console.log(`Markdown report: ${markdownPath}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.message || String(error));
    process.exitCode = 1;
  });
}

module.exports = {
  buildApiFinanceReport,
  createAdminFinanceClient,
  daysSinceYearStart,
  renderFinanceMarkdown,
};
