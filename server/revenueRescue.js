const OUTCOME_STATUSES = new Set(["NEW", "REVIEWED", "CONTACTED", "WON", "LOST", "ARCHIVED"]);
const MAX_REVENUE_CENTS = 1_000_000_000;

function clean(value, maxLength = 500) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function normalizeCents(value, { allowNull = true } = {}) {
  if (value == null || value === "") return allowNull ? null : 0;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > MAX_REVENUE_CENTS) {
    const error = new Error("Revenue values must be non-negative whole cents.");
    error.statusCode = 400;
    throw error;
  }
  return parsed;
}

function normalizeLeadOutcomeInput(input = {}) {
  const status = clean(input.status, 40).toUpperCase();
  if (!OUTCOME_STATUSES.has(status)) {
    const error = new Error("Choose a valid lead outcome.");
    error.statusCode = 400;
    throw error;
  }
  const estimatedValueCents = normalizeCents(input.estimatedValueCents);
  let actualRevenueCents = normalizeCents(input.actualRevenueCents);
  if (status === "LOST") actualRevenueCents = 0;
  if (status === "WON" && actualRevenueCents == null) {
    const error = new Error("Actual revenue is required when a lead is marked won.");
    error.statusCode = 400;
    throw error;
  }
  return {
    status,
    estimatedValueCents,
    actualRevenueCents,
    reason: clean(input.reason, 500) || null,
    source: clean(input.source, 80) || "OWNER_DASHBOARD",
  };
}

async function recordLeadOutcome({ prisma, businessId, leadId, input }) {
  const resolvedBusinessId = Number(businessId);
  const resolvedLeadId = Number(leadId);
  if (!Number.isInteger(resolvedBusinessId) || !Number.isInteger(resolvedLeadId)) {
    const error = new Error("A valid business and lead are required.");
    error.statusCode = 400;
    throw error;
  }
  const normalized = normalizeLeadOutcomeInput(input);
  const lead = await prisma.lead.findFirst({ where: { id: resolvedLeadId, businessId: resolvedBusinessId } });
  if (!lead) {
    const error = new Error("Lead not found for this business.");
    error.statusCode = 404;
    throw error;
  }
  const recordedAt = new Date();
  const estimatedValueCents = normalized.estimatedValueCents ?? lead.estimatedValueCents ?? null;
  const actualRevenueCents = normalized.status === "WON"
    ? normalized.actualRevenueCents
    : (normalized.status === "LOST" ? 0 : normalized.actualRevenueCents ?? lead.actualRevenueCents ?? null);

  return prisma.$transaction(async (tx) => {
    const updated = await tx.lead.update({
      where: { id: lead.id },
      data: {
        status: normalized.status,
        estimatedValueCents,
        actualRevenueCents,
        outcomeReason: normalized.reason,
        outcomeRecordedAt: recordedAt,
        outcomeSource: normalized.source,
      },
    });
    await tx.leadOutcomeEvent.create({
      data: {
        leadId: lead.id,
        businessId: resolvedBusinessId,
        fromStatus: lead.status,
        toStatus: normalized.status,
        estimatedValueCents,
        actualRevenueCents,
        reason: normalized.reason,
        source: normalized.source,
        recordedAt,
      },
    });
    return updated;
  });
}

function handoffSlaResult(handoff) {
  const sentAt = handoff.ownerAcceptedAt ? new Date(handoff.ownerAcceptedAt) : null;
  const acknowledgedAt = handoff.acknowledgedAt ? new Date(handoff.acknowledgedAt) : null;
  const slaMinutes = Math.max(1, Number(handoff.acknowledgementSlaMinutes || 2));
  const dueAt = handoff.acknowledgementDueAt
    ? new Date(handoff.acknowledgementDueAt)
    : (sentAt ? new Date(sentAt.getTime() + slaMinutes * 60 * 1000) : null);
  const acknowledgementSeconds = sentAt && acknowledgedAt
    ? Math.max(0, Math.round((acknowledgedAt.getTime() - sentAt.getTime()) / 1000))
    : null;
  return {
    dueAt,
    acknowledgementSeconds,
    metSla: Boolean(acknowledgedAt && dueAt && acknowledgedAt.getTime() <= dueAt.getTime()),
  };
}

function summarizeRevenueRescue({ leads = [], handoffs = [], averageJobValueCents = 0 } = {}) {
  const won = leads.filter((lead) => lead.status === "WON");
  const lost = leads.filter((lead) => lead.status === "LOST");
  const active = leads.filter((lead) => !["WON", "LOST", "ARCHIVED"].includes(lead.status));
  const recoveredRevenueCents = won.reduce((sum, lead) => sum + Number(lead.actualRevenueCents || 0), 0);
  const pipelineValueCents = active.reduce(
    (sum, lead) => sum + Number(lead.estimatedValueCents || averageJobValueCents || 0),
    0
  );
  const measured = won.length + lost.length;
  const slaRows = handoffs.filter((handoff) => handoff.ownerAcceptedAt).map((handoff) => handoffSlaResult(handoff));
  const acknowledged = slaRows.filter((row) => row.acknowledgementSeconds != null);
  const metSla = acknowledged.filter((row) => row.metSla).length;
  const overdue = handoffs.filter((handoff) => {
    if (handoff.acknowledgedAt || !handoff.ownerAcceptedAt) return false;
    const row = handoffSlaResult(handoff);
    return row.dueAt && row.dueAt.getTime() < Date.now();
  }).length;
  const sortedSeconds = acknowledged.map((row) => row.acknowledgementSeconds).sort((a, b) => a - b);
  const medianAcknowledgementSeconds = sortedSeconds.length
    ? sortedSeconds[Math.floor(sortedSeconds.length / 2)]
    : null;

  return {
    qualifiedLeads: leads.length,
    activeLeads: active.length,
    wonLeads: won.length,
    lostLeads: lost.length,
    measuredLeads: measured,
    conversionRate: measured ? Number(((won.length / measured) * 100).toFixed(1)) : null,
    recoveredRevenueCents,
    pipelineValueCents,
    handoffSla: {
      targetMinutes: Math.max(1, Number(handoffs[0]?.acknowledgementSlaMinutes || 2)),
      sent: slaRows.length,
      acknowledged: acknowledged.length,
      metSla,
      metSlaRate: acknowledged.length ? Number(((metSla / acknowledged.length) * 100).toFixed(1)) : null,
      overdue,
      medianAcknowledgementSeconds,
    },
  };
}

module.exports = {
  handoffSlaResult,
  normalizeLeadOutcomeInput,
  recordLeadOutcome,
  summarizeRevenueRescue,
};
