function digits10(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

function buildForwardingInstructions(assignedNumber) {
  const localNumber = digits10(assignedNumber);
  if (localNumber.length !== 10) return [];
  return [
    {
      carrier: "Rogers or Fido mobile",
      steps: [`Dial *61*${localNumber}#`, "Press Call, then test from another phone."],
      note: "If voicemail answers first, ask your carrier to adjust no-answer forwarding.",
    },
    {
      carrier: "Freedom mobile",
      steps: [`Dial *61*${localNumber}#`, "Press Call, then test from another phone."],
    },
    {
      carrier: "Bell mobile",
      steps: ["Open Phone settings, then Call forwarding.", `Choose unanswered/no reply and enter ${localNumber}.`, "Wait for Bell's confirmation text, then test."],
    },
    {
      carrier: "TELUS, Koodo, or another mobile carrier",
      steps: ["Open Phone settings, then Call forwarding.", `Choose unanswered/no reply and enter ${localNumber}.`, "If that option is missing, contact your carrier and request no-answer forwarding."],
    },
    {
      carrier: "Rogers home phone",
      steps: ["Dial *92 and listen for the tone.", `Enter ${localNumber}.`, "Answer the forwarded call or stay on the line for at least five seconds, then test."],
      note: "Rogers home phone forwards after about four rings.",
    },
    {
      carrier: "Landline or business phone system",
      steps: [`Set a no-answer or overflow rule to ${localNumber}.`, "Choose roughly 15–20 seconds where your provider allows it, then test."],
    },
  ];
}

module.exports = { buildForwardingInstructions, digits10 };
