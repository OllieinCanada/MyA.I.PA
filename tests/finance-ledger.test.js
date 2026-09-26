const assert = require("node:assert/strict");
const test = require("node:test");

const {
  getStripeFinanceSnapshot,
  summarizeBalanceTransactions,
} = require("../server/financeLedger");
const {
  buildApiFinanceReport,
  createAdminFinanceClient,
  renderFinanceMarkdown,
} = require("../scripts/report-api-finances");

function asyncRecords(records) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const record of records) yield record;
    },
  };
}

function jsonResponse(status, payload) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async text() {
      return JSON.stringify(payload);
    },
  };
}

test("Stripe finance snapshot uses read-only list/retrieve operations and removes identifiers", async () => {
  const calls = [];
  const stripeClient = {
    balance: {
      async retrieve() {
        calls.push("balance.retrieve");
        return {
          available: [{ amount: 1250, currency: "cad", source_types: { card: 1250 } }],
          pending: [{ amount: 500, currency: "cad" }],
        };
      },
    },
    balanceTransactions: {
      list(params) {
        calls.push(["balanceTransactions.list", params]);
        return asyncRecords([
          {
            id: "txn_private_1",
            source: "ch_private_1",
            description: "Customer name must not survive",
            amount: 1000,
            fee: 59,
            net: 941,
            currency: "cad",
            reporting_category: "charge",
            type: "charge",
            status: "available",
            created: 1_788_134_400,
          },
          {
            id: "txn_private_2",
            amount: -200,
            fee: 0,
            net: -200,
            currency: "cad",
            reporting_category: "refund",
            type: "refund",
            status: "available",
            created: 1_788_220_800,
          },
        ]);
      },
    },
    payouts: {
      list(params) {
        calls.push(["payouts.list", params]);
        return asyncRecords([
          {
            id: "po_private_1",
            destination: "ba_private_1",
            amount: 700,
            currency: "cad",
            status: "paid",
          },
        ]);
      },
    },
  };

  const snapshot = await getStripeFinanceSnapshot({
    stripeClient,
    days: 30,
    now: new Date("2026-08-28T12:00:00.000Z"),
  });

  assert.equal(snapshot.readOnly, true);
  assert.equal(snapshot.mutationsPerformed, 0);
  assert.deepEqual(snapshot.readOnlyOperations, [
    "balance.retrieve",
    "balanceTransactions.list",
    "payouts.list",
  ]);
  assert.equal(snapshot.balanceTransactions.count, 2);
  assert.deepEqual(snapshot.balanceTransactions.totalsByCurrency, [{
    currency: "cad",
    count: 2,
    amountMinor: 800,
    feeMinor: 59,
    netMinor: 741,
  }]);
  assert.deepEqual(snapshot.payouts.groups, [{
    currency: "cad",
    status: "paid",
    count: 1,
    amountMinor: 700,
  }]);
  assert.ok(calls.some((call) => call === "balance.retrieve"));
  assert.ok(calls.some((call) => Array.isArray(call) && call[0] === "balanceTransactions.list"));
  assert.ok(calls.some((call) => Array.isArray(call) && call[0] === "payouts.list"));
  const serialized = JSON.stringify(snapshot);
  assert.doesNotMatch(serialized, /private|Customer name|destination|source_types/);
});

test("missing Stripe client returns an explicit non-mutating gap", async () => {
  const snapshot = await getStripeFinanceSnapshot({
    stripeClient: null,
    days: 14,
    now: new Date("2026-08-28T12:00:00.000Z"),
  });
  assert.equal(snapshot.configured, false);
  assert.equal(snapshot.readOnly, true);
  assert.equal(snapshot.mutationsPerformed, 0);
  assert.equal(snapshot.balanceTransactions.count, 0);
  assert.match(snapshot.warnings[0], /not configured/i);
});

test("Stripe provider failures are sanitized and do not leak provider messages", async () => {
  const privateError = Object.assign(new Error("secret customer and token sk_live_private"), {
    code: "api_connection_error",
  });
  const stripeClient = {
    balance: { retrieve: async () => { throw privateError; } },
    balanceTransactions: { list: () => asyncRecords([]) },
    payouts: { list: () => asyncRecords([]) },
  };
  const snapshot = await getStripeFinanceSnapshot({ stripeClient });
  assert.match(snapshot.warnings[0], /api_connection_error/);
  assert.doesNotMatch(JSON.stringify(snapshot), /sk_live_private|secret customer/);
});

test("balance-transaction ledger is deterministic and aggregated by day and category", () => {
  const input = [
    { amount: 500, fee: 25, net: 475, currency: "cad", reporting_category: "charge", type: "charge", status: "available", created: 1_788_134_400 },
    { amount: 300, fee: 15, net: 285, currency: "cad", reporting_category: "charge", type: "charge", status: "available", created: 1_788_134_400 },
  ];
  const first = summarizeBalanceTransactions(input);
  const second = summarizeBalanceTransactions(input);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal(first.dailyLedger.length, 1);
  assert.deepEqual(first.dailyLedger[0], {
    date: "2026-08-31",
    currency: "cad",
    reportingCategory: "charge",
    type: "charge",
    status: "available",
    count: 2,
    amountMinor: 800,
    feeMinor: 40,
    netMinor: 760,
  });
});

test("admin finance client uses GET only and falls back safely before deployment", async () => {
  const requests = [];
  const client = createAdminFinanceClient({
    apiBaseUrl: "https://api.example.test",
    adminPassword: "test-only-password",
    async fetchImpl(url, init) {
      requests.push({ url, init });
      if (url.includes("/api/admin/finance-ledger")) return jsonResponse(404, { error: "not found" });
      return jsonResponse(200, { audit: { days: 30, totals: { twilioCost: 4, vapiCost: 1 } } });
    },
  });
  const period = await client.getPeriod(30);
  assert.equal(period.source, "legacy-cost-audit-fallback");
  assert.equal(period.readOnly, true);
  assert.equal(period.mutationsPerformed, 0);
  assert.ok(requests.length === 2);
  assert.ok(requests.every((request) => request.init.method === "GET"));
  assert.ok(requests.every((request) => request.init.body === undefined));
});

test("unified report strips secrets and keeps missing sources explicit", () => {
  const period = {
    source: "legacy-cost-audit-fallback",
    readOnly: true,
    mutationsPerformed: 0,
    operatingCosts: {
      days: 30,
      totals: { twilioCost: 17.5, vapiCost: 2.5, fixedCost: 0, estimatedProviderCost: 20 },
      twilioAccountUsage: { available: true },
      fixedCosts: { available: true, records: [] },
      env: { databaseAvailable: true, vapiConfigured: true },
      warnings: [],
    },
    paymentProcessor: null,
  };
  const report = buildApiFinanceReport({
    checkedAt: "2026-08-28T12:00:00.000Z",
    apiBaseUrl: "https://api.example.test",
    periods: { "30 days": period },
    stripeTrials: {
      configured: true,
      mode: "live",
      account: { id: "acct_private", chargesEnabled: true, payoutsEnabled: false },
      totals: { activeTrialCount: 4 },
    },
    credentialPresence: {
      OPENAI_API_KEY: "sk-private",
      MAKE_API_TOKEN: "make-private",
    },
  });
  assert.equal(report.readOnly, true);
  assert.equal(report.externalMutationsPerformed, 0);
  assert.equal(report.stripe.financialActivityMeasured, false);
  assert.equal(report.localCredentialPresence.OPENAI_API_KEY, true);
  assert.ok(report.coverage.some((item) => item.source === "Business bank and credit card" && item.status === "not-connected"));
  assert.ok(report.approvalQueue.some((item) => item.id === "deploy-read-only-finance-ledger"));
  const serialized = JSON.stringify(report);
  assert.doesNotMatch(serialized, /acct_private|sk-private|make-private/);
  assert.match(renderFinanceMarkdown(report), /zero external mutations/i);
});

test("finance report groups multiple numbers by business and isolates unallocated costs", () => {
  const period = {
    source: "unified-finance-ledger",
    readOnly: true,
    mutationsPerformed: 0,
    operatingCosts: {
      days: 240,
      totals: {
        twilioCost: 110,
        phoneNumberCost: 90,
        matchedPhoneNumberCost: 45,
        twilioCallCost: 2,
        matchedTwilioMessageCost: 3,
        vapiCost: 10,
        fixedCost: 0,
        estimatedProviderCost: 120,
      },
      summary: [
        { businessId: 1, businessName: "Alpha", phoneNumber: "+19055550111", totalCalls: 4, messageCount: 2, totalDurationSec: 600, phoneNumberCost: 15, twilioCallCost: 1, twilioMessageCost: 1, vapiCost: 3, totalInternalCost: 20 },
        { businessId: 1, businessName: "Alpha", phoneNumber: "+19055550222", totalCalls: 2, messageCount: 1, totalDurationSec: 300, phoneNumberCost: 15, twilioCallCost: 0, twilioMessageCost: 1, vapiCost: 2, totalInternalCost: 18 },
        { businessId: 2, businessName: "Beta", phoneNumber: "+19055550222", totalCalls: 1, messageCount: 0, totalDurationSec: 60, phoneNumberCost: 15, twilioCallCost: 1, twilioMessageCost: 1, vapiCost: 5, totalInternalCost: 22 },
      ],
      twilioAccountUsage: {
        available: true,
        records: [{ category: "phonenumbers", count: 6, usage: 6, price: 90 }],
      },
      twilioPhoneBilling: {
        totalNumbers: 4,
        records: [
          { phoneNumber: "+19055550111" },
          { phoneNumber: "+19055550222" },
          { phoneNumber: "+19055550333" },
          { phoneNumber: "+19055550444" },
        ],
      },
      fixedCosts: { available: true, records: [] },
      env: { databaseAvailable: true, vapiConfigured: true },
      warnings: [],
    },
    paymentProcessor: { configured: true, balanceTransactions: { count: 0 }, warnings: [] },
  };
  const report = buildApiFinanceReport({
    checkedAt: "2026-08-28T12:00:00.000Z",
    apiBaseUrl: "https://api.example.test",
    periods: { "2026 YTD": period },
    stripeTrials: { configured: true, account: { chargesEnabled: true, payoutsEnabled: true } },
  });
  const allocation = report.businessAllocation;
  assert.equal(allocation.businesses.length, 2);
  assert.equal(allocation.businesses[0].businessName, "Alpha");
  assert.equal(allocation.businesses[0].allocatedTotalUsd, 38);
  assert.deepEqual(allocation.businesses[0].sharedPhoneNumbers, ["••••0222"]);
  assert.equal(allocation.allocatedTotalUsd, 60);
  assert.equal(allocation.unallocatedTotalUsd, 60);
  assert.equal(allocation.unallocated.phoneRentalUsd, 45);
  assert.equal(allocation.unallocated.twilioUsageUsd, 15);
  assert.deepEqual(allocation.phoneInventory.unassignedActiveNumbers, ["••••0333", "••••0444"]);
  const markdown = renderFinanceMarkdown(report);
  assert.match(markdown, /Why the \$120\.00 bill is so high/);
  assert.match(markdown, /Unallocated\/shared account cost/);
  assert.doesNotMatch(markdown, /\+1905555/);
});
