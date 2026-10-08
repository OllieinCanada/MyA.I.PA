// Shared by the form and backend: disclosure choices are not service availability.
const CHOICE_KEYS = ["includeVisitFee", "includeHourlyRate", "includeAssessment", "includePartsExtra"];

function hasIndividualPricingChoices(pricing = {}) {
  return CHOICE_KEYS.some((key) => Object.prototype.hasOwnProperty.call(pricing, key));
}

function individualPricingPolicy(pricing = {}) {
  const choices = Object.fromEntries(CHOICE_KEYS.map((key) => [key, pricing[key] === true]));
  choices.installationFreeEstimate = pricing.installationFreeEstimate === true;
  const amount = (value) => {
    const number = Number(String(value ?? "").trim());
    return Number.isFinite(number) && number > 0 ? String(number) : "";
  };
  const repairVisitFee = choices.includeVisitFee ? amount(pricing.repairVisitFee) : "";
  const repairHourlyRate = choices.includeHourlyRate ? amount(pricing.repairHourlyRate) : "";
  const statements = [
    choices.includeVisitFee && repairVisitFee ? `Minimum service visit: ${repairVisitFee} dollars.` : "",
    choices.includeHourlyRate && repairHourlyRate ? `Labour: ${repairHourlyRate} dollars per hour.` : "",
    choices.includeAssessment ? "The technician will assess the work and confirm the final price before starting." : "",
    choices.installationFreeEstimate ? "New installations: Offer a free quote." : "",
    choices.includePartsExtra ? "Parts are extra." : "",
  ].filter(Boolean);
  return {
    ...choices,
    offersServiceCalls: true,
    repairVisitFee,
    repairHourlyRate,
    freeEstimateAnswer: choices.installationFreeEstimate ? "yes we do" : "no we don't",
    repairVisitFeeText: repairVisitFee ? `${repairVisitFee} dollars` : "",
    repairHourlyRateText: repairHourlyRate ? `${repairHourlyRate} dollars per hour` : "",
    pricingScript: statements.join("\n"),
    valid: (!choices.includeVisitFee || Boolean(repairVisitFee)) && (!choices.includeHourlyRate || Boolean(repairHourlyRate)),
  };
}

function pricingSummaryOptionsFromAssistant(assistant = {}) {
  const prompt = (assistant.model?.messages || []).find((message) => message.role === "system")?.content || "";
  const matches = String(prompt).match(/^MYAIPA_PRICING_CHOICES: (.+)$/gm) || [];
  if (!matches.length) return null; // Older assistants retain their previous policy.
  if (matches.length !== 1) throw new Error("Ambiguous assistant pricing policy.");
  const parsed = JSON.parse(matches[0].slice("MYAIPA_PRICING_CHOICES: ".length));
  if (CHOICE_KEYS.some((key) => typeof parsed[key] !== "boolean") || typeof parsed.installationFreeEstimate !== "boolean") {
    throw new Error("Invalid assistant pricing policy.");
  }
  return { includePartsExtra: parsed.includePartsExtra, includeAssessment: parsed.includeAssessment };
}

module.exports = { CHOICE_KEYS, hasIndividualPricingChoices, individualPricingPolicy, pricingSummaryOptionsFromAssistant };
