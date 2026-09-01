const { normalizeNanpPhone } = require("./voiceSignup");
const { buildDemoFollowupMessage, isExplicitDemoSmsRequest } = require("./signupVoiceQuality");

const DEMO_FOLLOWUP_TOOL = "send_myaipa_demo_followup";

function isVapiDemoFollowupTool(name) {
  return String(name || "").trim().toLowerCase() === DEMO_FOLLOWUP_TOOL;
}

async function executeVapiDemoFollowup({ parameters = {}, callExternalId, prisma, sendSms, env }) {
  if (!isExplicitDemoSmsRequest(parameters.callerRequest)) {
    return { ok: false, skipped: true, reason: "explicit_caller_request_required" };
  }
  const callId = String(callExternalId || "").trim();
  if (callId) {
    const completedSignup = await prisma.vapiToolExecution.findFirst({
      where: {
        callExternalId: callId,
        toolName: { in: ["begin_myaipa_signup", "start_myaipa_signup"] },
        status: "COMPLETED",
      },
      select: { id: true },
    });
    if (completedSignup) return { ok: false, skipped: true, reason: "signup_mode_locked" };
  }
  const to = normalizeNanpPhone(parameters.rawPhoneNumber, "rawPhoneNumber");
  const message = buildDemoFollowupMessage(parameters);
  const sent = await sendSms({ to, message, env });
  return { ok: true, sent: sent?.mocked !== true, toLast4: to.slice(-4) };
}

module.exports = { DEMO_FOLLOWUP_TOOL, executeVapiDemoFollowup, isVapiDemoFollowupTool };
