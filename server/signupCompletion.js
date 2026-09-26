function normalizeAssignedPhone(value) {
  const raw = String(value || "").trim();
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (raw.startsWith("+") && digits.length >= 10 && digits.length <= 15) return `+${digits}`;
  return "";
}

function formatAssignedPhone(value) {
  const phone = normalizeAssignedPhone(value);
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return phone;
}

function buildSignupCompletionContent({ ownerName, businessName, assignedPhone, dashboardUrl } = {}) {
  const phone = normalizeAssignedPhone(assignedPhone);
  if (!phone) {
    const error = new Error("A valid assigned phone number is required for the setup-complete follow-up.");
    error.code = "SIGNUP_COMPLETION_PHONE_INVALID";
    throw error;
  }
  const displayPhone = formatAssignedPhone(phone);
  const greeting = ownerName ? `Hi ${String(ownerName).trim()},` : "Hi,";
  const business = String(businessName || "your business").trim();
  const dashboard = String(dashboardUrl || "").trim();
  const lines = [
    greeting,
    "",
    `Your My AI PA setup for ${business} is ready.`,
    `Your assigned AI phone number is ${displayPhone}.`,
    "Call it now to test the assistant before sharing it with customers.",
    dashboard ? `Open your dashboard for setup details and next steps: ${dashboard}` : "",
  ].filter((line, index, values) => line || (index > 0 && values[index - 1] !== ""));
  const text = lines.join("\n");
  return {
    phone,
    displayPhone,
    subject: `Your My AI PA number for ${business} is ready`,
    sms: `My AI PA setup for ${business} is ready. Your AI number is ${displayPhone}. Call it now to test it.${dashboard ? ` Dashboard: ${dashboard}` : ""}`,
    text,
  };
}

async function deliverSignupCompletion({
  ownerPhone,
  ownerEmail,
  ownerName,
  businessName,
  assignedPhone,
  dashboardUrl,
  priorStatus,
  sendSms,
  sendEmail,
} = {}) {
  if (["sent", "partial"].includes(String(priorStatus || "").toLowerCase())) {
    return { status: "skipped", skipped: true, reason: "already_delivered", channels: [], errors: [] };
  }

  const content = buildSignupCompletionContent({ ownerName, businessName, assignedPhone, dashboardUrl });
  const channels = [];
  const errors = [];
  const attempts = [];

  if (String(ownerPhone || "").trim() && typeof sendSms === "function") {
    attempts.push((async () => {
      try {
        await sendSms({ to: ownerPhone, message: content.sms });
        channels.push("sms");
      } catch (error) {
        errors.push({ channel: "sms", code: String(error?.providerCode || error?.code || "SMS_DELIVERY_FAILED") });
      }
    })());
  }

  if (String(ownerEmail || "").trim() && typeof sendEmail === "function") {
    attempts.push((async () => {
      try {
        await sendEmail({
          to: ownerEmail,
          subject: content.subject,
          text: content.text,
          content,
        });
        channels.push("email");
      } catch (error) {
        errors.push({ channel: "email", code: String(error?.providerCode || error?.code || "EMAIL_DELIVERY_FAILED") });
      }
    })());
  }

  await Promise.all(attempts);
  if (!attempts.length) errors.push({ channel: "none", code: "SIGNUP_COMPLETION_NO_DELIVERY_CHANNEL" });
  return {
    status: channels.length ? (errors.length ? "partial" : "sent") : "failed",
    skipped: false,
    channels: channels.sort(),
    errors,
    content,
  };
}

module.exports = {
  buildSignupCompletionContent,
  deliverSignupCompletion,
  formatAssignedPhone,
  normalizeAssignedPhone,
};
