const SIGNUP_TOOL_NAMES = Object.freeze(["begin_myaipa_signup", "start_myaipa_signup"]);

async function hasCompletedSignupForCall({ prisma, callExternalId }) {
  const normalizedCallId = String(callExternalId || "").trim();
  if (!normalizedCallId || !prisma?.vapiToolExecution?.findFirst) return false;
  const execution = await prisma.vapiToolExecution.findFirst({
    where: {
      callExternalId: normalizedCallId,
      toolName: { in: [...SIGNUP_TOOL_NAMES] },
      status: "COMPLETED",
    },
    select: { id: true },
  });
  return Boolean(execution);
}

function signupOnlyMessageResult() {
  return {
    ok: false,
    skipped: true,
    status: "blocked_signup_call",
    reason: "signup_verification_only",
    message: "Signup calls can send only the verification link.",
  };
}

module.exports = { SIGNUP_TOOL_NAMES, hasCompletedSignupForCall, signupOnlyMessageResult };
