// Shared by initial provisioning and recovery: preserve the owner's selected
// Jess voice and never prepend a second disclosure to the opening.
const CONSENT_NOTICE = "This call will be recorded for service quality and accurate follow-up.";
const SPEECH_POLICY_MARKER = "## MYAIPA VERIFIED SPEECH OPENING";
const CONSENT_POLICY = `${SPEECH_POLICY_MARKER}
The fixed first message has already thanked the caller, stated the recording notice once, and asked how you can help.
Do not ask "Is that okay?", ask for a yes to recording, or repeat the recording notice. Listen to the caller's request and continue the business's routing/intake flow without repeating an answered question.
If the caller objects to recording, politely end without collecting details or calling notification tools. Never claim the caller explicitly consented when they did not.
Acknowledge every opening request, substantive answer and correction briefly in natural, content-specific words before the next necessary question, not only social cues or named projects. Do not mechanically repeat the caller's words or add a separate acknowledgement turn.
Only use installation/service/repair routing when relevant to the verified business scope. For a broad request such as "I need some electrical services", acknowledge the request, then clarify the missing request type once. For a clear in-scope repair or installation request, acknowledge that request and continue its matching path without asking the installation/service/repair question again. Do not infer a specific task from a vague request.
Reuse all details already supplied, even when several arrive in one answer. Ask only the next missing or genuinely unclear field; do not restart the greeting, routing or intake checklist. If the caller asks a question, answer from verified business facts (or say the team must confirm) before returning to the next missing detail.
For a correction, acknowledge the corrected fact, replace the old value in the same request, and follow the current readback and fresh-approval rules before submission. Acknowledgement is not recording consent, pricing agreement, confirmation of uncertain details, or permission to save or send.
Safety directions take priority over conversational acknowledgement; never delay them for small talk. Use calm, appropriate wording for hazards, refusals and distress, not an automatic "Great". Respect refusals and recording objections; do not use acknowledgement to continue an unwanted intake.
After pricing, wait for the caller's answer; acknowledgement must not skip that wait or any submission gate. Do not insert a spoken acknowledgement between final submission approval and its tool call; preserve the existing silent-execution rules. At closing, acknowledge thanks briefly without restarting intake or claiming an unverified save, send, delivery, booking or dispatch.
Ask one complete question at a time, speak in complete natural sentences, and let the caller finish before responding.
Silence is not an answer. If the caller needs time, wait; never invent details or send unfinished intake.
For a completed request, wait for confirmed notification success before saying it was sent. Finish with "Thank you for calling. Goodbye." before invoking endCall; never hang up midway through speech.
## END MYAIPA VERIFIED SPEECH OPENING`;

function fixedConsentOpening(firstMessage = "") {
  const source = String(firstMessage).trim();
  if (/^https?:\/\//i.test(source)) throw new Error("An audio opening needs explicit review before speech-policy migration.");
  const match = source.match(/(Thanks for calling .+?\.)(?=\s+(?:How|I'm|Before|This)\b|$)/i);
  const greeting = match?.[1] || "Thanks for calling.";
  return `${greeting} ${CONSENT_NOTICE} How can I help you today?`;
}

function normalizeConsentPrompt(prompt) {
  const cleaned = String(prompt || "")
    .replace(/\n*## MYAIPA VERIFIED SPEECH OPENING[\s\S]*?## END MYAIPA VERIFIED SPEECH OPENING/g, "")
    .replace(/After recording consent, say exactly:/g, "After the recording notice, say exactly:")
    // Migrate only the known generated unconditional routing line, retaining
    // its business scope. Leave unrelated/custom exact wording untouched.
    .replace(/^After the recording notice, say exactly: ("We handle [^"\r\n]+\. Are you looking for a new installation, service, or repair today\?")[ \t\r]*$/gm,
      "Only if the caller's request type is still unclear, briefly acknowledge what they said, then ask: $1")
    .replace(/again after recording consent|again after consent/g, "again")
    .split("\n")
    .filter(line => !/The opening asks|The first message has already greeted|After the caller answers how they are|Opening sequence: the first message|After the opening greeting and the caller's social response/.test(line))
    .join("\n").trimEnd();
  // Keep the base-playbook consent policy ahead of the separately audited SMS
  // override. Content verification deliberately strips that SMS-only block.
  const boundary = cleaned.indexOf("\n## MYAIPA ISOLATED SMS ROUTING");
  return boundary < 0 ? `${cleaned}\n\n${CONSENT_POLICY}`
    : `${cleaned.slice(0, boundary).trimEnd()}\n\n${CONSENT_POLICY}\n\n${cleaned.slice(boundary).trimStart()}`;
}

function signupSpeechPatch(assistant = {}) {
  return {
    firstMessage: fixedConsentOpening(assistant.firstMessage),
    firstMessageMode: "assistant-speaks-first",
    firstMessageInterruptionsEnabled: false,
    // Keep the original Jess voice. Speech/consent fixes must not silently
    // replace the owner's voice choice. Avoid reusing cached opening audio.
    voice: { provider: "vapi", voiceId: "Jess", version: "2", cachingEnabled: false },
    // Preserve the actual generated text for diagnosis rather than allowing
    // assistant-channel ASR mistakes to become the next turn's model history.
    modelOutputInMessagesEnabled: true,
  };
}

function inspectSignupSpeech(assistant = {}) {
  const voice = assistant.voice || {};
  const prompt = (assistant.model?.messages || []).filter(m => m.role === "system").map(m => m.content).join("\n");
  return {
    fixedConsentOpeningInstalled: assistant.firstMessage === fixedConsentOpening(assistant.firstMessage)
      && (String(assistant.firstMessage).match(/recorded/gi) || []).length === 1,
    speechVoicePinned: voice.provider === "vapi" && String(voice.version) === "2" && voice.voiceId === "Jess" && voice.cachingEnabled === false,
    openingNotInterruptible: assistant.firstMessageInterruptionsEnabled === false && assistant.firstMessageMode === "assistant-speaks-first",
    generatedTextHistoryEnabled: assistant.modelOutputInMessagesEnabled === true,
    consentPolicyInstalled: prompt.includes(CONSENT_POLICY),
    delayedDisclosureRemoved: !/After the caller answers how they are.*recording notice|After the opening greeting and the caller's social response.*recorded/.test(prompt),
  };
}

module.exports = { CONSENT_NOTICE, CONSENT_POLICY, SPEECH_POLICY_MARKER, fixedConsentOpening, normalizeConsentPrompt, signupSpeechPatch, inspectSignupSpeech };
