const test = require("node:test");
const assert = require("node:assert/strict");
const {
  handoffSlaResult,
  normalizeLeadOutcomeInput,
  recordLeadOutcome,
  summarizeRevenueRescue,
} = require("../server/revenueRescue");

test("won outcomes require actual revenue and lost outcomes record zero", () => {
  assert.throws(() => normalizeLeadOutcomeInput({ status: "WON" }), /actual revenue is required/i);
  assert.equal(normalizeLeadOutcomeInput({ status: "LOST", actualRevenueCents: 999 }).actualRevenueCents, 0);
});

test("revenue rescue summary separates recovered revenue, pipeline, conversion, and SLA", () => {
  const now = Date.now();
  const summary = summarizeRevenueRescue({
    averageJobValueCents: 50000,
    leads: [
      { status: "WON", actualRevenueCents: 125000 },
      { status: "LOST", actualRevenueCents: 0 },
      { status: "CONTACTED", estimatedValueCents: 80000 },
      { status: "NEW", estimatedValueCents: null },
    ],
    handoffs: [
      { ownerAcceptedAt: new Date(now - 5 * 60 * 1000), acknowledgedAt: new Date(now - 4 * 60 * 1000), acknowledgementSlaMinutes: 2 },
      { ownerAcceptedAt: new Date(now - 5 * 60 * 1000), acknowledgedAt: null, acknowledgementSlaMinutes: 2 },
    ],
  });
  assert.equal(summary.recoveredRevenueCents, 125000);
  assert.equal(summary.pipelineValueCents, 130000);
  assert.equal(summary.conversionRate, 50);
  assert.equal(summary.handoffSla.metSlaRate, 100);
  assert.equal(summary.handoffSla.overdue, 1);
});

test("SLA result measures acknowledgement from provider acceptance", () => {
  const sent = new Date("2026-07-22T12:00:00.000Z");
  const result = handoffSlaResult({ ownerAcceptedAt: sent, acknowledgedAt: new Date(sent.getTime() + 90_000), acknowledgementSlaMinutes: 2 });
  assert.equal(result.acknowledgementSeconds, 90);
  assert.equal(result.metSla, true);
});

test("recordLeadOutcome writes the lead and an immutable outcome event in one transaction", async () => {
  const calls = [];
  const lead = { id: 7, businessId: 3, status: "NEW", estimatedValueCents: null, actualRevenueCents: null };
  const tx = {
    lead: { update: async ({ data }) => ({ ...lead, ...data }) },
    leadOutcomeEvent: { create: async ({ data }) => { calls.push(data); return data; } },
  };
  const prisma = {
    lead: { findFirst: async () => lead },
    $transaction: async (callback) => callback(tx),
  };
  const updated = await recordLeadOutcome({ prisma, businessId: 3, leadId: 7, input: { status: "WON", estimatedValueCents: 120000, actualRevenueCents: 115000, reason: "Invoice paid" } });
  assert.equal(updated.status, "WON");
  assert.equal(updated.actualRevenueCents, 115000);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].fromStatus, "NEW");
  assert.equal(calls[0].toStatus, "WON");
});
