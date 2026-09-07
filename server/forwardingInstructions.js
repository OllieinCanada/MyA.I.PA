const { digits10, resolveForwardingRule } = require("./callForwardingProvider");

function buildForwardingInstructions(assignedNumber) {
  try {
    return [
      ["ROGERS", "MOBILE", "Rogers mobile"],
      ["ROGERS", "LANDLINE", "Rogers Home Phone"],
      ["BELL", "LANDLINE", "Bell business landline"],
    ].map(([carrier, lineType, label]) => {
      const rule = resolveForwardingRule({ carrier, lineType, destination: assignedNumber });
      return { carrier: label, steps: rule.humanInstructions, note: rule.warnings[0] || "", supported: rule.supported };
    });
  } catch {
    return [];
  }
}

module.exports = { buildForwardingInstructions, digits10 };
