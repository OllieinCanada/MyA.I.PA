// Shared by initial provisioning and recovery: a recovery must not restore the
// retired voice or prepend a second disclosure to the opening.
const CONSENT_NOTICE = "This call will be recorded for service quality and accurate follow-up. Is that okay?";
const SPEECH_POLICY_MARKER = "## MYAIPA VERIFIED SPEECH OPENING";
const CONSENT_POLICY = `${SPEECH_POLICY_MARKER}
The fixed first message has already greeted the caller and asked for recording consent.
Stop and wait for an explicit yes before collecting service, contact, address, or job details or calling any tool.
Do not repeat the recording notice or ask how they are before consent. A social answer such as "I'm fine" is not consent; ask only "Is it okay to record this call?" and wait.
If consent is declined, politely end without collecting details or calling notification tools.
After consent, acknowledge any social cue briefly and continue the business's existing routing/intake flow.
## END MYAIPA VERIFIED SPEECH OPENING`;

function fixedConsentOpening(firstMessage = "") {
  const source = String(firstMessage).trim();
  if (/^https?:\/\//i.test(source)) throw new Error("An audio opening needs explicit review before speech-policy migration.");
  const match = source.match(/(Thanks for calling .+?\.)(?=\s+(?:How|I'm|Before|This)\b|$)/i);
  const greeting = match?.[1] || "Thanks for calling.";
  return `${greeting} ${CONSENT_NOTICE}`;
}

function normalizeConsentPrompt(prompt) {
  const cleaned = String(prompt || "")
    .replace(/\n*## MYAIPA VERIFIED SPEECH OPENING[\s\S]*?## END MYAIPA VERIFIED SPEECH OPENING/g, "")
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
    // Do not reuse the retired voice's cached audio. Keep this separate from
    // LLM choice: the observed model output was already correct.
    voice: { provider: "openai", model: "tts-1", voiceId: "alloy", cachingEnabled: false },
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
    speechVoicePinned: voice.provider === "openai" && voice.model === "tts-1" && voice.voiceId === "alloy" && voice.cachingEnabled === false,
    openingNotInterruptible: assistant.firstMessageInterruptionsEnabled === false && assistant.firstMessageMode === "assistant-speaks-first",
    generatedTextHistoryEnabled: assistant.modelOutputInMessagesEnabled === true,
    consentPolicyInstalled: prompt.includes(CONSENT_POLICY),
    delayedDisclosureRemoved: !/After the caller answers how they are.*recording notice|After the opening greeting and the caller's social response.*recorded/.test(prompt),
  };
}

module.exports = { CONSENT_NOTICE, CONSENT_POLICY, SPEECH_POLICY_MARKER, fixedConsentOpening, normalizeConsentPrompt, signupSpeechPatch, inspectSignupSpeech };
