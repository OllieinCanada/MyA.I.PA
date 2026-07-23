const fs = require("fs");
const path = require("path");

const PLAYBOOK_DIR = path.join(__dirname, "..", "config", "playbooks");
const PLAYBOOK_ID_PATTERN = /^[a-z0-9-]{3,80}$/;

function getTradePlaybook(playbookId = "electrician-v1") {
  const id = String(playbookId || "").trim().toLowerCase();
  if (!PLAYBOOK_ID_PATTERN.test(id)) throw new Error("Invalid trade playbook identifier.");
  const filePath = path.join(PLAYBOOK_DIR, `${id}.json`);
  const playbook = JSON.parse(fs.readFileSync(filePath, "utf8"));
  validateTradePlaybook(playbook);
  return playbook;
}

function validateTradePlaybook(playbook) {
  const requiredArrays = [
    playbook?.scope?.allowed,
    playbook?.scope?.redirect,
    playbook?.safety?.emergencySignals,
    playbook?.safety?.requiredResponse,
    playbook?.truthPolicy,
    playbook?.conversation,
    playbook?.handoff?.summaryFields,
  ];
  if (!playbook?.id || !playbook?.trade || !playbook?.version || requiredArrays.some((value) => !Array.isArray(value) || !value.length)) {
    throw new Error("Trade playbook is missing required safety, scope, truth, or handoff rules.");
  }
  if (!playbook.requestTypes || !Object.keys(playbook.requestTypes).length) throw new Error("Trade playbook has no request types.");
  return true;
}

function numbered(items = []) {
  return items.map((item, index) => `${index + 1}. ${item}`).join("\n");
}

function buildTradePlaybookPrompt(playbook) {
  validateTradePlaybook(playbook);
  const requestTypes = Object.entries(playbook.requestTypes).map(([key, value]) => [
    `${key.toUpperCase()}:`,
    `Required intake: ${(value.requiredFields || []).join(", ")}.`,
    ...(value.rules || []),
  ].join(" ")).join("\n");
  return `MYAIPA VERIFIED TRADE PLAYBOOK — ${playbook.id} (${playbook.version})
Purpose: ${playbook.purpose}

ALLOWED ELECTRICAL SCOPE
${numbered(playbook.scope.allowed)}

REDIRECT OR REFUSE
${numbered(playbook.scope.redirect)}

EMERGENCY SIGNALS
${numbered(playbook.safety.emergencySignals)}

MANDATORY SAFETY RESPONSE
${numbered(playbook.safety.requiredResponse)}

REQUEST FLOWS
${requestTypes}

VERIFIED TRUTH POLICY
${numbered(playbook.truthPolicy)}

CONVERSATION AND TOOL RULES
${numbered(playbook.conversation)}

PRIORITY HANDOFF SIGNALS
${numbered(playbook.handoff.prioritySignals)}

OWNER HANDOFF FIELDS
${numbered(playbook.handoff.summaryFields)}`;
}

module.exports = { buildTradePlaybookPrompt, getTradePlaybook, validateTradePlaybook };
