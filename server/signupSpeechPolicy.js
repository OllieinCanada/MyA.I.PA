// Shared by initial provisioning and recovery: preserve the owner's selected
// Jess voice and never prepend a second disclosure to the opening.
const CONSENT_NOTICE = "This call will be recorded for service quality and accurate follow-up.";
const RESIDENTIAL_SERVICE_SENTENCE = "We handle residential electrical work.";
const RESIDENTIAL_HELP_QUESTION = "How can we help you today?";
const ADDITIONAL_INFORMATION_QUESTION = "I have collected all the information we need. Is there anything else you’d like to add?";
const RESIDENTIAL_SUCCESS_CLOSING = "OK, I’ll pass this on, and our service manager will get back to you shortly. Thanks for calling—have a great day!";
const RESIDENTIAL_CONVERSATION_MARKER = "## MYAIPA RESIDENTIAL ELECTRICAL CONVERSATION";
const RESIDENTIAL_CONVERSATION_END = "## END MYAIPA RESIDENTIAL ELECTRICAL CONVERSATION";
const RESIDENTIAL_CONVERSATION_POLICY = `${RESIDENTIAL_CONVERSATION_MARKER}
- The fixed first message has already said "${RESIDENTIAL_SERVICE_SENTENCE}" followed by "${RESIDENTIAL_HELP_QUESTION}" after the business greeting and recording notice. Do not repeat those sentences or an answered routing question. Briefly acknowledge the caller's actual answer, reuse details already supplied, and ask only for relevant missing information.
- Only after all required intake information has been collected, ask exactly: "${ADDITIONAL_INFORMATION_QUESTION}" Then stop speaking and listen.
- A yes to that additional-information question means the caller has something to add: collect it, update the same request, and offer that question again. A no means no additional information, not cancellation of the request. An explicit cancellation or instruction not to send still blocks execution.
- Neither answer to the additional-information question grants sending permission. After additions are finished, follow the current workflow's separate recap, confirmation and standalone permission question. Any correction requires an updated recap and fresh permission. Do not merge the additional-information question with the permission question or reuse its yes as approval.
- Preserve the existing authorization, safety, pricing, tool and duplicate-protection gates. This conversation policy does not enable dispatch or change a draft-only workflow into a sending workflow.
- Only after the current sending workflow's tool confirms a successful handoff with complete true, say exactly: "${RESIDENTIAL_SUCCESS_CLOSING}" Let the entire closing finish before invoking endCall. Do not append another goodbye or promise an appointment, a specific callback time, dispatch or scheduled work.
- A draftStored-only result is not a successful notification handoff: retain that workflow's truthful saved-draft closing instead. A failed, missing or uncertain result must receive truthful guidance rather than the success closing; accepted is not delivered. Never retry an uncertain or already accepted action to obtain the closing.
${RESIDENTIAL_CONVERSATION_END}`;
const SPEECH_POLICY_MARKER = "## MYAIPA VERIFIED SPEECH OPENING";
const CONSENT_POLICY = `${SPEECH_POLICY_MARKER}
The fixed first message has already thanked the caller, stated the recording notice once, and asked how you can help.
Do not ask "Is that okay?", ask for a yes to recording, or repeat the recording notice. Listen to the caller's request and continue the business's routing/intake flow without repeating an answered question.
If the caller objects to recording, politely end without collecting details or calling notification tools. Never claim the caller explicitly consented when they did not.
Acknowledge social cues briefly. Ask one complete question at a time, speak in complete natural sentences, and let the caller finish before responding.
Silence is not an answer. If the caller needs time, wait; never invent details or send unfinished intake.
For a completed request, wait for confirmed notification success before saying it was sent. Finish with "Thank you for calling. Goodbye." before invoking endCall; never hang up midway through speech.
## END MYAIPA VERIFIED SPEECH OPENING`;

// Scope comes from normalized, server-owned signup fields, never from a
// business name, caller text, a service-description substring or the greeting.
function isResidentialElectrical(context) {
  return /^(?:electric|electrical|electrician)(?: (?:contractor|services?))?$/i.test(String(context?.businessType || "").trim())
    && Array.isArray(context?.specializations)
    && context.specializations.some(value => typeof value === "string" && value.trim().toLowerCase() === "residential");
}

function hasResidentialConversation(prompt) {
  const value = String(prompt || "");
  return value.includes(RESIDENTIAL_CONVERSATION_POLICY)
    && value.split(RESIDENTIAL_CONVERSATION_MARKER).length === 2
    && value.split(RESIDENTIAL_CONVERSATION_END).length === 2;
}

function assistantPrompt(assistant) {
  return (assistant?.model?.messages || []).filter(message => message?.role === "system").map(message => message.content).join("\n");
}

function scopeFor(prompt, context) {
  // Existing, exact server-generated policy may survive a tool-only migration;
  // never infer a new scope when the caller provides no trusted context.
  return context === undefined ? hasResidentialConversation(prompt) : isResidentialElectrical(context);
}

function openingForScope(firstMessage, residential) {
  const source = String(firstMessage).trim();
  if (/^https?:\/\//i.test(source)) throw new Error("An audio opening needs explicit review before speech-policy migration.");
  const match = source.match(/(Thanks for calling .+?\.)(?=\s+(?:How|I'm|Before|This|We handle residential electrical work)\b|$)/i);
  const greeting = match?.[1] || "Thanks for calling.";
  return residential
    ? `${greeting} ${CONSENT_NOTICE} ${RESIDENTIAL_SERVICE_SENTENCE} ${RESIDENTIAL_HELP_QUESTION}`
    : `${greeting} ${CONSENT_NOTICE} How can I help you today?`;
}

function fixedConsentOpening(firstMessage = "", context) {
  return openingForScope(firstMessage, isResidentialElectrical(context));
}

function consentPolicy(residential) {
  return residential ? CONSENT_POLICY.replace('Finish with "Thank you for calling. Goodbye." before invoking endCall; never hang up midway through speech.',
    'Use the exact result-appropriate closing in the residential conversation policy before invoking endCall; never hang up midway through speech.') : CONSENT_POLICY;
}

function normalizeConsentPrompt(prompt, context) {
  const source = String(prompt || "");
  if ((source.includes(RESIDENTIAL_CONVERSATION_MARKER) || source.includes(RESIDENTIAL_CONVERSATION_END)) && !hasResidentialConversation(source)) {
    throw new Error("RESIDENTIAL_CONVERSATION_REVIEW_REQUIRED");
  }
  const residential = scopeFor(source, context);
  const cleaned = source.replace(/\n*## MYAIPA RESIDENTIAL ELECTRICAL CONVERSATION[\s\S]*?## END MYAIPA RESIDENTIAL ELECTRICAL CONVERSATION/g, "")
    .replace(/\n*## MYAIPA VERIFIED SPEECH OPENING[\s\S]*?## END MYAIPA VERIFIED SPEECH OPENING/g, "")
    .replace(/After recording consent, say exactly:/g, "After the recording notice, say exactly:")
    .replace(/again after recording consent|again after consent/g, "again")
    .split("\n")
    .filter(line => !/The opening asks|The first message has already greeted|After the caller answers how they are|Opening sequence: the first message|After the opening greeting and the caller's social response/.test(line))
    .join("\n").trimEnd();
  const policy = `${consentPolicy(residential)}${residential ? `\n\n${RESIDENTIAL_CONVERSATION_POLICY}` : ""}`;
  // Keep the base-playbook consent policy ahead of the separately audited SMS
  // override. Content verification deliberately strips that SMS-only block.
  const boundary = cleaned.indexOf("\n## MYAIPA ISOLATED SMS ROUTING");
  return boundary < 0 ? `${cleaned}\n\n${policy}`
    : `${cleaned.slice(0, boundary).trimEnd()}\n\n${policy}\n\n${cleaned.slice(boundary).trimStart()}`;
}

function signupSpeechPatch(assistant = {}, context) {
  return {
    firstMessage: openingForScope(assistant.firstMessage, scopeFor(assistantPrompt(assistant), context)),
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
  const prompt = assistantPrompt(assistant);
  const residential = hasResidentialConversation(prompt);
  return {
    fixedConsentOpeningInstalled: assistant.firstMessage === openingForScope(assistant.firstMessage, residential)
      && (String(assistant.firstMessage).match(/recorded/gi) || []).length === 1,
    speechVoicePinned: voice.provider === "vapi" && String(voice.version) === "2" && voice.voiceId === "Jess" && voice.cachingEnabled === false,
    openingNotInterruptible: assistant.firstMessageInterruptionsEnabled === false && assistant.firstMessageMode === "assistant-speaks-first",
    generatedTextHistoryEnabled: assistant.modelOutputInMessagesEnabled === true,
    consentPolicyInstalled: prompt.includes(consentPolicy(residential)),
    delayedDisclosureRemoved: !/After the caller answers how they are.*recording notice|After the opening greeting and the caller's social response.*recorded/.test(prompt),
  };
}

module.exports = { CONSENT_NOTICE, CONSENT_POLICY, SPEECH_POLICY_MARKER, fixedConsentOpening, normalizeConsentPrompt, signupSpeechPatch, inspectSignupSpeech,
  isResidentialElectrical, hasResidentialConversation, RESIDENTIAL_SERVICE_SENTENCE, RESIDENTIAL_HELP_QUESTION,
  ADDITIONAL_INFORMATION_QUESTION, RESIDENTIAL_SUCCESS_CLOSING, RESIDENTIAL_CONVERSATION_POLICY };
