const fs = require("fs");
const path = require("path");
const { loadProjectEnv } = require("./_helpers");
const { getVapiCompositeToolDefinition, normalizeE164 } = require("../server/compositeCallNotifications");
const { buildIsolatedToolPayload, assistantTimingPatch, toolRejectionPlan } = require("../server/vapiIsolatedSmsProvisioning");

const env = loadProjectEnv();
const apiKey = String(env.VAPI_API_KEY || "").trim();
const localTwilioToken = String(env.TWILIO_AUTH_TOKEN || "").trim();
const vapiBase = String(env.VAPI_API_BASE_URL || "https://api.vapi.ai").replace(/\/+$/, "");
const ownerPhone = normalizeE164(env.DEAN_ALLISON_DEMO_OWNER_PHONE || "+19057885488");
const apply = process.argv.includes("--apply");
const confirmation = process.argv.find((arg) => arg.startsWith("--confirm="))?.slice(10) || "";
const confirmationPhrase = "BUY-DEAN-PRIVATE-DEMO-LINE";
const assistantName = "My AI PA — Dean Allison Private Demo";
const phoneFriendlyName = "My AI PA Dean Allison Private Demo";
const preferredAreaCode = "289";
const preferredLocality = "Grimsby";
const webhookUrl = "https://api.myaipa.ca/api/webhooks/voice";
const marker = "## MY AI PA UNOFFICIAL CONSTITUENCY DEMO POLICY v1";
const firstMessage = "Thanks for calling this private My AI PA demonstration prepared for a possible constituency-office workflow. I'm a virtual receptionist, not Dean Allison or his staff, and this line is not operated, approved, or endorsed by his office. This call may be recorded for demonstration quality. Is it okay to continue?";

function list(value, keys = []) {
  if (Array.isArray(value)) return value;
  for (const key of ["data", "results", ...keys]) if (Array.isArray(value?.[key])) return value[key];
  return [];
}

function safeJson(text) {
  try { return text ? JSON.parse(text) : {}; } catch (_error) { return {}; }
}

async function vapiRequest(resource, { method = "GET", body } = {}) {
  const response = await fetch(`${vapiBase}${resource}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = safeJson(await response.text());
  if (!response.ok) throw new Error(`${method} ${resource} failed with HTTP ${response.status}: ${payload.message || payload.error || "request failed"}`);
  return payload;
}

function environmentMap(tool) {
  return Object.fromEntries((tool?.environmentVariables || []).map((item) => [String(item?.name || ""), String(item?.value || "")]).filter(([name]) => name));
}

function phoneNumber(record) {
  return normalizeE164(record?.number || record?.phoneNumber || record?.twilioPhoneNumber || record?.providerResourceId);
}

function assistantIdForPhone(record) {
  return String(record?.assistantId || record?.assistant?.id || "").trim();
}

function toolName(record) {
  return String(record?.function?.name || record?.name || "").trim();
}

function basicAuth(accountSid, token) {
  return `Basic ${Buffer.from(`${accountSid}:${token}`, "utf8").toString("base64")}`;
}

async function twilioRequest(accountSid, resource, { method = "GET", form } = {}) {
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}${resource}`, {
    method,
    headers: {
      Authorization: basicAuth(accountSid, localTwilioToken),
      Accept: "application/json",
      ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: form ? new URLSearchParams(form).toString() : undefined,
  });
  const payload = safeJson(await response.text());
  if (!response.ok) throw new Error(`Twilio ${method} ${resource} failed with HTTP ${response.status}: ${payload.message || payload.error || "request failed"}`);
  return payload;
}

async function discoverProtectedRouting(tools) {
  const candidates = tools.filter((tool) => /^send_call_summaries_/.test(toolName(tool)) && tool?.id);
  for (const candidate of candidates) {
    const tool = await vapiRequest(`/tool/${encodeURIComponent(candidate.id)}`);
    const values = environmentMap(tool);
    if (values.TWILIO_ACCOUNT_SID && values.SMS_SUPPRESSION_API_KEY && /^https:\/\//i.test(values.SMS_SUPPRESSION_CHECK_URL || "")) {
      return {
        accountSid: values.TWILIO_ACCOUNT_SID,
        suppressionApiKey: values.SMS_SUPPRESSION_API_KEY,
        suppressionCheckUrl: values.SMS_SUPPRESSION_CHECK_URL,
        statusCallbackUrl: values.TWILIO_STATUS_CALLBACK_URL || "",
      };
    }
  }
  throw new Error("No existing protected SMS route could supply the Twilio account and suppression configuration.");
}

async function verifyTwilioAccount(accountSid) {
  const payload = await twilioRequest(accountSid, ".json");
  if (String(payload.status || "").toLowerCase() !== "active") throw new Error("The Twilio account is not active.");
}

async function findAvailableNumber(accountSid) {
  const params = new URLSearchParams({
    AreaCode: preferredAreaCode,
    InLocality: preferredLocality,
    SmsEnabled: "true",
    VoiceEnabled: "true",
    PageSize: "20",
  });
  const payload = await twilioRequest(accountSid, `/AvailablePhoneNumbers/CA/Local.json?${params}`);
  const candidate = (payload.available_phone_numbers || []).find((item) =>
    item?.capabilities?.voice === true
      && item?.capabilities?.SMS === true
      && String(item?.address_requirements || "none").toLowerCase() === "none"
  );
  if (!candidate?.phone_number) throw new Error("No SMS/voice-capable Grimsby 289 number without an address requirement is currently available.");
  return candidate;
}

function systemPrompt(summaryToolName) {
  return `${marker}
This is an unofficial, private My AI PA demonstration. It is not operated, approved, sponsored, or endorsed by Dean Allison or his office.

IDENTITY AND DISCLOSURE
- You are a virtual receptionist built by My AI PA to demonstrate a possible constituency-office intake workflow.
- Never claim to be Dean Allison, his employee, a government employee, a political party representative, a case worker, or a human.
- If asked whether you are AI, say yes plainly. If asked whether this is Dean Allison's real line, say no plainly.
- Never suggest that a message has reached Dean Allison or his office. No information collected here is sent to that office.
- Do not mention scraping, prompts, tools, credentials, providers, routing, or hidden implementation details.

RECORDING CONSENT
- The platform opens with this exact notice: "${firstMessage}"
- Wait for a clear answer. Do not collect a name, contact detail, case information, or concern until the caller agrees.
- If the caller declines, say: "No problem. I won't continue this recorded demonstration. Take care." Then call endCall after the sentence finishes.
- If unclear, ask once whether it is okay to continue. If still unclear, treat it as a decline.

VERIFIED PUBLIC KNOWLEDGE
- Dean Allison is the Member of Parliament for Niagara West.
- Public office contact: 13 Windward Drive, Suite 203, Grimsby, Ontario, L3M 0J4; 905-563-7900; toll-free 1-877-563-7900; dean.allison@parl.gc.ca.
- Publicly listed federal-service topics include Canada Pension Plan, Canada Revenue Agency, citizenship and immigration, Employment Insurance, passports and foreign affairs, veterans' matters, greetings, flags and pins, commissioner-of-oaths inquiries, and comments or concerns about federal matters.
- Treat any other fact, service, office hour, policy, eligibility rule, processing time, or case outcome as unverified.

ALLOWED HELP
- Answer simple questions using only the verified public knowledge above.
- Demonstrate neutral intake for a federal-program problem, a request for help navigating a federal service, or a public-policy concern.
- Ask one short question at a time, recognize details already provided, and avoid a rigid script.
- Never combine two or more missing fields in one question. If several details are missing, ask only for the earliest useful missing detail, wait for the answer, and then ask the next single question.
- For a new intake with no name yet, the next question must ask only for the caller's name. It must not also ask for the community, topic, desired outcome, phone number, or contact time.
- Collect only: name, callback number or trusted caller ID, community, broad federal topic, a short neutral description, the outcome the caller wants, preferred contact time, and permission to text a copy.
- Before saving, give a concise neutral recap and correct contradictions.

STRICT BOUNDARIES
- Do not give legal, immigration, tax, benefits, passport, medical, financial, or case-specific advice.
- Do not predict eligibility, processing time, intervention, decisions, outcomes, or whether an office will respond.
- Do not campaign, persuade, solicit votes or donations, infer political views, or collect party affiliation or voting intention.
- Do not make appointments or promise a callback, acknowledgement, case opening, referral, escalation, or response.
- Do not ask for or retain a Social Insurance Number, passport number, UCI, immigration or tax file number, banking or card information, password, date of birth, identity-document image, or detailed medical information. If offered, interrupt politely and ask the caller not to share it.
- Do not collect a home address. A community or municipality is enough for this demonstration.
- For matters requiring official action, explain that the caller must use the public office contact independently.

SAFETY
- For immediate danger, violence, fire, medical emergency, or threats of self-harm or harm to others, stop intake and say to move to safety and call 911 now. This demonstration cannot dispatch help.
- Do not use a notification tool for an emergency report.

PRIVATE DEMO SUMMARY
- Ask for SMS permission before sending a caller copy.
- After the recap, ask exactly: "Should I save this private demo message and text you a copy?"
- Only after a clear yes, silently call ${summaryToolName} once with businessName "My AI PA private demonstration", requestType "constituent_demo", name, city as the community, jobDetails as the federal topic, preferredStartDate as the requested next step, bestCallbackTime, and message as the concise neutral concern.
- Trusted caller ID is supplied to the tool. If the caller says to use the number they are calling from, accept that. Never invent or recite digits you cannot see.
- If and only if the tool returns needsCustomerNumber true, ask for and confirm the full mobile number, then retry once with rawPhoneNumber.
- If complete is true, say: "Your private demo summary was saved for My AI PA testing and a copy was texted to you. It was not sent to Dean Allison or his office."
- If complete is false, do not claim delivery. Say: "I couldn't confirm the private demo summary was delivered. Nothing was sent to Dean Allison or his office."

CLOSING
- If the caller says goodbye, that's all, no thanks, or otherwise ends the call, do not ask another question. Say: "Thanks for trying the My AI PA private demonstration. Take care." Let the sentence finish, then call endCall.
- Never end in the middle of a sentence or immediately after a notification tool result.
- Keep responses calm, neutral, concise, and in Canadian English.`;
}

function assistantPayload(endCallToolId, summaryToolId, summaryToolName) {
  return {
    name: assistantName,
    firstMessage,
    firstMessageMode: "assistant-speaks-first",
    transcriber: { provider: "deepgram", model: "nova-3", language: "en", numerals: true, endpointing: 450 },
    model: {
      provider: "openai",
      model: "gpt-4o",
      temperature: 0.2,
      messages: [{ role: "system", content: systemPrompt(summaryToolName || "the private demo summary tool") }],
      toolIds: [endCallToolId, summaryToolId].filter(Boolean),
    },
    voice: { provider: "vapi", voiceId: "Jess" },
    maxDurationSeconds: 300,
    silenceTimeoutSeconds: 30,
    artifactPlan: {
      recordingEnabled: true,
      loggingEnabled: true,
      pcapEnabled: false,
      transcriptPlan: { enabled: true },
    },
    compliancePlan: {
      securityFilterPlan: {
        enabled: true,
        mode: "reject",
        replacementText: "I can only help with this private demonstration's permitted intake.",
        filters: [
          { type: "prompt-injection" },
          { type: "rce" },
          { type: "ssrf" },
          { type: "sql-injection" },
          { type: "xss" },
        ],
      },
    },
    server: { url: webhookUrl },
    serverMessages: ["end-of-call-report", "tool-calls"],
    ...assistantTimingPatch(),
  };
}

async function findSilentEndCallTool(tools) {
  for (const candidate of tools.filter((tool) => tool?.type === "endCall" && tool?.id)) {
    const detail = await vapiRequest(`/tool/${encodeURIComponent(candidate.id)}`);
    if (Array.isArray(detail.messages) && detail.messages.length === 0) return detail;
  }
  if (!apply) return null;
  return vapiRequest("/tool", { method: "POST", body: { type: "endCall", messages: [] } });
}

async function findExistingTwilioNumber(accountSid) {
  const payload = await twilioRequest(accountSid, "/IncomingPhoneNumbers.json?PageSize=1000");
  return (payload.incoming_phone_numbers || []).find((item) => String(item?.friendly_name || "").trim() === phoneFriendlyName) || null;
}

async function buyTwilioNumber(accountSid, candidate) {
  return twilioRequest(accountSid, "/IncomingPhoneNumbers.json", {
    method: "POST",
    form: { PhoneNumber: candidate.phone_number, FriendlyName: phoneFriendlyName },
  });
}

async function importNumber(phone, assistantId, accountSid) {
  return vapiRequest("/phone-number/import/twilio", {
    method: "POST",
    body: {
      twilioPhoneNumber: phone,
      twilioAccountSid: accountSid,
      twilioAuthToken: localTwilioToken,
      name: phoneFriendlyName,
      assistantId,
    },
  });
}

async function sendReadinessSms(accountSid, routing, fromNumber) {
  const permissionResponse = await fetch(routing.suppressionCheckUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${routing.suppressionApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ phoneNumber: ownerPhone }),
  });
  const permission = safeJson(await permissionResponse.text());
  if (!permissionResponse.ok || permission.allowed !== true) {
    return { sent: false, reason: permission.suppressed ? "recipient_opted_out" : "suppression_check_failed" };
  }
  const payload = await twilioRequest(accountSid, "/Messages.json", {
    method: "POST",
    form: {
      To: ownerPhone,
      From: fromNumber,
      Body: "MY AI PA PRIVATE DEMO — The unofficial constituency-workflow test line is configured. This line is not operated, approved, or endorsed by Dean Allison or his office.",
      ...(routing.statusCallbackUrl ? { StatusCallback: routing.statusCallbackUrl } : {}),
    },
  });
  return { sent: Boolean(payload.sid), status: payload.status || "queued", messageSidLast4: String(payload.sid || "").slice(-4) };
}

async function main() {
  if (!apiKey) throw new Error("VAPI_API_KEY is not configured.");
  if (!localTwilioToken) throw new Error("TWILIO_AUTH_TOKEN is not configured.");
  if (!ownerPhone) throw new Error("DEAN_ALLISON_DEMO_OWNER_PHONE must be a valid phone number.");
  if (apply && confirmation !== confirmationPhrase) throw new Error(`Apply mode requires --confirm=${confirmationPhrase}.`);

  const [phonesPayload, assistantsPayload, toolsPayload] = await Promise.all([
    vapiRequest("/phone-number?limit=1000"),
    vapiRequest("/assistant?limit=1000"),
    vapiRequest("/tool?limit=1000"),
  ]);
  const phones = list(phonesPayload, ["phoneNumbers", "phone_numbers"]);
  const assistants = list(assistantsPayload, ["assistants"]);
  const tools = list(toolsPayload, ["tools"]);
  const routing = await discoverProtectedRouting(tools);
  await verifyTwilioAccount(routing.accountSid);

  let assistant = assistants.find((item) => String(item?.name || "").trim() === assistantName) || null;
  let twilioNumber = await findExistingTwilioNumber(routing.accountSid);
  const purchasedNow = !twilioNumber;
  const vapiPhone = phones.find((item) => phoneNumber(item) && phoneNumber(item) === normalizeE164(twilioNumber?.phone_number));
  const available = twilioNumber ? null : await findAvailableNumber(routing.accountSid);
  const preview = {
    mode: apply ? "apply" : "dry-run",
    unofficialPrivateDemo: true,
    ownerPhoneLast4: ownerPhone.slice(-4),
    existingAssistant: Boolean(assistant),
    existingTwilioNumber: Boolean(twilioNumber),
    existingVapiImport: Boolean(vapiPhone),
    proposedAreaCode: preferredAreaCode,
    proposedLocality: preferredLocality,
    proposedNumberLast4: String(available?.phone_number || twilioNumber?.phone_number || "").slice(-4),
    capabilities: available?.capabilities || twilioNumber?.capabilities || {},
    addressRequirements: available?.address_requirements || "none",
  };
  console.log(JSON.stringify(preview, null, 2));
  if (!apply) return;

  const endCallTool = await findSilentEndCallTool(tools);
  if (!endCallTool?.id) throw new Error("A silent Vapi end-call tool is unavailable.");
  if (!assistant) {
    assistant = await vapiRequest("/assistant", { method: "POST", body: assistantPayload(endCallTool.id, "", "the private demo summary tool") });
  } else {
    assistant = await vapiRequest(`/assistant/${encodeURIComponent(assistant.id)}`);
  }

  if (!twilioNumber) twilioNumber = await buyTwilioNumber(routing.accountSid, available);
  const purchasedPhone = normalizeE164(twilioNumber.phone_number);
  if (!purchasedPhone) throw new Error("Twilio did not return the purchased phone number.");

  let importedPhone = phones.find((item) => phoneNumber(item) === purchasedPhone) || null;
  if (!importedPhone) importedPhone = await importNumber(purchasedPhone, assistant.id, routing.accountSid);

  const freshToolsPayload = await vapiRequest("/tool?limit=1000");
  const freshTools = list(freshToolsPayload, ["tools"]);
  const smsPayload = buildIsolatedToolPayload({
    aiNumber: purchasedPhone,
    ownerNumber: ownerPhone,
    twilioAccountSid: routing.accountSid,
    twilioAuthToken: localTwilioToken,
    statusCallbackUrl: routing.statusCallbackUrl,
    suppressionCheckUrl: routing.suppressionCheckUrl,
    suppressionApiKey: routing.suppressionApiKey,
  });
  smsPayload.function = { ...getVapiCompositeToolDefinition().function, name: smsPayload.function.name };
  smsPayload.rejectionPlan = toolRejectionPlan();
  let summaryTool = freshTools.find((tool) => toolName(tool) === smsPayload.function.name) || null;
  if (summaryTool) {
    summaryTool = await vapiRequest(`/tool/${encodeURIComponent(summaryTool.id)}`, { method: "PATCH", body: smsPayload });
  } else {
    summaryTool = await vapiRequest("/tool", { method: "POST", body: smsPayload });
  }

  const currentAssistant = await vapiRequest(`/assistant/${encodeURIComponent(assistant.id)}`);
  const patchedAssistant = await vapiRequest(`/assistant/${encodeURIComponent(assistant.id)}`, {
    method: "PATCH",
    body: assistantPayload(endCallTool.id, summaryTool.id, toolName(summaryTool)),
  });
  if (assistantIdForPhone(importedPhone) !== assistant.id) {
    importedPhone = await vapiRequest(`/phone-number/${encodeURIComponent(importedPhone.id)}`, {
      method: "PATCH",
      body: { assistantId: assistant.id, name: phoneFriendlyName },
    });
  }

  const [verifiedAssistant, verifiedTool, verifiedPhone, verifiedTwilio] = await Promise.all([
    vapiRequest(`/assistant/${encodeURIComponent(assistant.id)}`),
    vapiRequest(`/tool/${encodeURIComponent(summaryTool.id)}`),
    vapiRequest(`/phone-number/${encodeURIComponent(importedPhone.id)}`),
    twilioRequest(routing.accountSid, `/IncomingPhoneNumbers/${encodeURIComponent(twilioNumber.sid)}.json`),
  ]);
  const verifiedEnv = environmentMap(verifiedTool);
  const prompt = (verifiedAssistant.model?.messages || []).find((message) => message.role === "system")?.content || "";
  const attachedToolIds = (verifiedAssistant.model?.toolIds || []).map(String);
  const checks = {
    assistantDisclosure: prompt.includes(marker) && prompt.includes("not operated, approved, sponsored, or endorsed"),
    noImpersonation: prompt.includes("Never claim to be Dean Allison"),
    noOfficialDeliveryClaim: prompt.includes("No information collected here is sent to that office"),
    sensitiveDataGuard: prompt.includes("Social Insurance Number") && prompt.includes("immigration or tax file number"),
    politicalNeutrality: prompt.includes("Do not campaign, persuade, solicit votes or donations"),
    emergencyRedirect: prompt.includes("call 911 now"),
    recordingAndTranscript: verifiedAssistant.artifactPlan?.recordingEnabled === true && verifiedAssistant.artifactPlan?.transcriptPlan?.enabled === true,
    webhook: String(verifiedAssistant.server?.url || verifiedAssistant.serverUrl || "") === webhookUrl,
    summaryToolAttached: attachedToolIds.includes(String(verifiedTool.id)),
    endCallToolAttached: attachedToolIds.includes(String(endCallTool.id)),
    senderProtected: normalizeE164(verifiedEnv.DEFAULT_FROM_NUMBER) === purchasedPhone,
    ownerProtected: normalizeE164(verifiedEnv.DEFAULT_OWNER_TO_NUMBER) === ownerPhone,
    callerIdProtected: verifiedEnv.CALLER_NUMBER === "{{ customer.number }}",
    suppressionProtected: Boolean(verifiedEnv.SMS_SUPPRESSION_API_KEY) && /^https:\/\//i.test(verifiedEnv.SMS_SUPPRESSION_CHECK_URL || ""),
    numberAssigned: assistantIdForPhone(verifiedPhone) === assistant.id,
    twilioVoiceRoutedToVapi: /vapi\.ai/i.test(String(verifiedTwilio.voice_url || "")),
    voiceAndSmsCapable: verifiedTwilio.capabilities?.voice === true && verifiedTwilio.capabilities?.sms === true,
  };
  const readinessSms = purchasedNow
    ? await sendReadinessSms(routing.accountSid, routing, purchasedPhone)
    : { sent: true, status: "not_repeated_existing_line" };
  checks.readinessSmsSent = readinessSms.sent === true;
  const verified = Object.values(checks).every(Boolean);

  const outputDir = path.join(process.cwd(), "diagnostics", "dean-allison-live");
  fs.mkdirSync(outputDir, { recursive: true });
  const state = {
    createdAt: new Date().toISOString(),
    unofficialPrivateDemo: true,
    phoneNumber: purchasedPhone,
    assistantId: verifiedAssistant.id,
    phoneNumberId: verifiedPhone.id,
    summaryToolId: verifiedTool.id,
    summaryToolName: toolName(verifiedTool),
    ownerPhoneLast4: ownerPhone.slice(-4),
    readinessSms,
    checks,
    verified,
  };
  fs.writeFileSync(path.join(outputDir, "private-demo-state.json"), `${JSON.stringify(state, null, 2)}\n`);
  console.log(JSON.stringify(state, null, 2));
  if (!verified) throw new Error("Provisioning completed but one or more read-back checks failed.");
  void currentAssistant;
  void patchedAssistant;
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
