// Shared by initial provisioning and recovery: preserve the owner's selected
// Jess voice and never prepend a second disclosure to the opening.
const CONSENT_NOTICE = "This call will be recorded for service quality and accurate follow-up.";
const SPEECH_POLICY_MARKER = "## MYAIPA VERIFIED SPEECH OPENING";
const CONSENT_POLICY = `${SPEECH_POLICY_MARKER}
The fixed first message has already thanked the caller, stated the recording notice once, and asked how you can help.
Do not ask "Is that okay?", ask for a yes to recording, or repeat the recording notice. Listen to the caller's request and continue the business's routing/intake flow without repeating an answered question.
If the caller objects to recording, politely end without collecting details or calling notification tools. Never claim the caller explicitly consented when they did not.
Acknowledge social cues briefly. Ask one complete question at a time, speak in complete natural sentences, and let the caller finish before responding.
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
