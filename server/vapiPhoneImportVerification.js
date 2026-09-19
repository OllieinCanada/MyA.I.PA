function createBindingError(message, code, statusCode = 502) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

async function verifyVapiPhoneAssistantBinding({
  phoneRecordId,
  phoneNumber,
  assistantId,
  name,
} = {}, {
  requestResource,
  getAssistantId,
  summarize,
  sanitizeName,
} = {}) {
  const recordId = String(phoneRecordId || "").trim();
  const expectedAssistantId = String(assistantId || "").trim();
  if (!recordId) throw createBindingError("The Vapi phone record is missing its provider id.", "VAPI_PHONE_ID_MISSING");
  if (!expectedAssistantId) throw createBindingError("The Vapi assistant id is missing.", "VAPI_ASSISTANT_ID_MISSING", 400);
  if (typeof requestResource !== "function" || typeof getAssistantId !== "function" || typeof summarize !== "function") {
    throw new TypeError("Vapi phone binding verification dependencies are required.");
  }

  let liveRecord = await requestResource(`phone-number/${encodeURIComponent(recordId)}`);
  const liveAssistantId = String(getAssistantId(liveRecord) || "").trim();
  if (liveAssistantId && liveAssistantId !== expectedAssistantId) {
    throw createBindingError(
      "The Vapi phone record belongs to a different assistant.",
      "VAPI_PHONE_ASSISTANT_CONFLICT",
      409
    );
  }
  if (liveAssistantId !== expectedAssistantId) {
    await requestResource(`phone-number/${encodeURIComponent(recordId)}`, {
      method: "PATCH",
      body: {
        assistantId: expectedAssistantId,
        ...(name ? { name: typeof sanitizeName === "function" ? sanitizeName(name, `${phoneNumber} Number`) : name } : {}),
      },
    });
  }

  liveRecord = await requestResource(`phone-number/${encodeURIComponent(recordId)}`);
  const verified = summarize(liveRecord, phoneNumber);
  if (!verified.id || verified.assistantId !== expectedAssistantId) {
    throw createBindingError(
      "Vapi did not retain the assistant binding on the phone number.",
      "VAPI_PHONE_IMPORT_BINDING_UNVERIFIED"
    );
  }
  return verified;
}

module.exports = { verifyVapiPhoneAssistantBinding };
